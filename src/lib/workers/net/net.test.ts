import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { guardedGet } from "./fetch";
import { parseProbeUrl, resolvePublic, SsrfError } from "./guard";
import { isPublicAddress } from "./ip";

describe("isPublicAddress: the deny-list", () => {
  const blocked = [
    // IPv4: every range in PRD §8.4, at both edges
    "0.0.0.0", "0.255.255.255", "10.0.0.0", "10.255.255.255", "100.64.0.0", "100.127.255.255", "127.0.0.1", "127.255.255.255",
    "169.254.169.254", "169.254.0.1", "172.16.0.0", "172.31.255.255", "192.168.0.1", "192.168.255.255", "224.0.0.1", "239.255.255.255",
    "240.0.0.1", "255.255.255.255", "192.0.0.5", "192.0.2.1", "198.18.0.1", "198.19.255.255", "198.51.100.7", "203.0.113.9",
    // IPv6
    "::", "::1", "fc00::1", "fd12:3456:789a::1", "fe80::1", "febf::1", "ff02::1", "2001:db8::1", "2001::1", "100::1", "::127.0.0.1",
    // IPv4 smuggled inside IPv6
    "::ffff:10.0.0.1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::a00:1", "64:ff9b::7f00:1", "2002:7f00:1::", "2002:a00:1::",
  ];
  const allowed = [
    "8.8.8.8", "1.1.1.1", "142.250.77.46", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "169.253.0.1", "192.169.0.1", "223.255.255.255",
    "2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001::1", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::",
  ];
  it.each(blocked)("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
  it.each(allowed)("allows %s", (ip) => expect(isPublicAddress(ip)).toBe(true));
  it.each(["", "localhost", "1.2.3.4.5", "256.1.1.1", "1.2.3", "gggg::1", "fe80::1%eth0", "0x7f.0.0.1", "2130706433", "[::1]"])(
    "treats the non-address %j as not public",
    (s) => expect(isPublicAddress(s)).toBe(false),
  );
});

describe("parseProbeUrl", () => {
  const rejected: [string, string][] = [
    ["http://example.com", "scheme"],
    ["ftp://example.com", "scheme"],
    ["https://user:pw@example.com", "credentials"],
    ["https://example.com:8443", "port"],
    ["https://127.0.0.1/", "ip_literal"],
    ["https://169.254.169.254/latest/meta-data", "ip_literal"],
    ["https://[::1]/", "ip_literal"],
    ["https://2130706433/", "ip_literal"], // decimal form of 127.0.0.1: the URL parser normalises it, we then refuse literals
    ["https://0x7f.1/", "ip_literal"],
    ["https://localhost/", "internal_name"],
    ["https://app.localhost/", "internal_name"],
    ["https://intranet/", "internal_name"],
    ["https://db.internal/", "internal_name"],
    ["https://printer.local/", "internal_name"],
    ["not a url", "invalid_url"],
  ];
  it.each(rejected)("refuses %s (%s)", (url, reason) => {
    expect(() => parseProbeUrl(url)).toThrowError(new SsrfError(reason));
  });
  it("accepts an ordinary https site", () => expect(parseProbeUrl("https://my-portfolio.vercel.app/work?x=1").hostname).toBe("my-portfolio.vercel.app"));
});

describe("resolvePublic", () => {
  it("accepts a host whose every answer is public", async () => {
    const r = await resolvePublic("a.example", async () => [{ address: "8.8.8.8", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }]);
    expect(r.address).toBe("8.8.8.8");
  });
  it("refuses a host that resolves to a private address", async () => {
    await expect(resolvePublic("a.example", async () => [{ address: "10.0.0.5", family: 4 }])).rejects.toThrowError("blocked:private_address");
  });
  it("refuses if ANY answer is private (public + private = a rebinding setup)", async () => {
    await expect(
      resolvePublic("a.example", async () => [{ address: "8.8.8.8", family: 4 }, { address: "::ffff:192.168.1.1", family: 6 }]),
    ).rejects.toThrowError("blocked:private_address");
  });
  it("reports DNS failure as a plain error, not an SSRF block", async () => {
    await expect(resolvePublic("a.example", async () => { throw new Error("ENOTFOUND"); })).rejects.toThrowError("dns_failed");
    await expect(resolvePublic("a.example", async () => [])).rejects.toThrowError("dns_failed");
  });
});

// ---- real TLS server on loopback: proves pinning, SNI, redirects, caps and timeouts end to end ----
let openssl = true;
try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
  openssl = false;
}

describe.skipIf(!openssl)("guardedGet against a real local HTTPS server", () => {
  let server: https.Server;
  let port: number;
  let cert: string;
  const seen: { host?: string; sni?: string; path?: string; ua?: string; cookie?: string }[] = [];

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "devmap-tls-"));
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"),
      "-days", "2", "-subj", "/CN=site.test", "-addext", "subjectAltName=DNS:site.test,DNS:other.test",
    ], { stdio: "ignore" });
    cert = readFileSync(path.join(dir, "c.pem"), "utf8");
    server = https.createServer({ key: readFileSync(path.join(dir, "k.pem")), cert }, (req, res) => {
      seen.push({ host: req.headers.host, sni: (req.socket as unknown as { servername?: string }).servername, path: req.url, ua: req.headers["user-agent"], cookie: req.headers.cookie });
      const url = req.url ?? "/";
      if (url === "/hop1") { res.writeHead(302, { location: "https://other.test/final" }); return res.end(); }
      if (url === "/hop2") { res.writeHead(302, { location: "/hop1" }); return res.end(); }
      if (url === "/to-http") { res.writeHead(302, { location: "http://site.test/x" }); return res.end(); }
      if (url === "/to-private") { res.writeHead(302, { location: "https://evil.test/x" }); return res.end(); }
      if (url === "/big") { res.writeHead(200); return res.end(Buffer.alloc(3 * 1024 * 1024, 97)); }
      if (url === "/slow") { return void setTimeout(() => res.end("late"), 1500); }
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>Hello</title>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const loopbackOnly = (ip: string) => ip === "127.0.0.1";
  const base = () => ({ port, tls: { ca: cert }, isAllowed: loopbackOnly });
  const map = (table: Record<string, string>) => async (host: string) => {
    if (!table[host]) throw new Error("ENOTFOUND");
    return [{ address: table[host], family: 4 as const }];
  };

  it("connects to the validated IP but speaks to the ORIGINAL hostname (Host header + SNI + certificate)", async () => {
    seen.length = 0;
    const r = await guardedGet("https://site.test/page", { ...base(), resolve: map({ "site.test": "127.0.0.1" }) });
    expect(r.status).toBe(200);
    expect(r.body.toString()).toContain("Hello");
    expect(seen[0]).toMatchObject({ host: "site.test", sni: "site.test", path: "/page", ua: "DevMapBot/1.0 (+https://devmap.in/bot)" });
    expect(seen[0].cookie).toBeUndefined();
  });

  it("with the default policy, a hostname resolving to loopback is refused before any connection", async () => {
    seen.length = 0;
    await expect(guardedGet("https://site.test/", { port, tls: { ca: cert }, resolve: map({ "site.test": "127.0.0.1" }) })).rejects.toThrowError("blocked:private_address");
    expect(seen).toHaveLength(0);
  });

  it("DNS pinning: the name is resolved exactly once per hop, so a rebinding DNS server never gets a second answer", async () => {
    let calls = 0;
    const rebinding = async () => {
      calls++;
      return [{ address: calls === 1 ? "127.0.0.1" : "10.0.0.9", family: 4 as const }]; // 2nd lookup would be the attack
    };
    const r = await guardedGet("https://site.test/", { ...base(), resolve: rebinding });
    expect(r.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("follows exactly one redirect, re-resolving and re-validating the target", async () => {
    const r = await guardedGet("https://site.test/hop1", { ...base(), resolve: map({ "site.test": "127.0.0.1", "other.test": "127.0.0.1" }) });
    expect(r.status).toBe(200);
    expect(r.redirects).toBe(1);
    expect(r.finalUrl).toBe("https://other.test/final");
  });

  it("refuses a second redirect", async () => {
    await expect(guardedGet("https://site.test/hop2", { ...base(), resolve: map({ "site.test": "127.0.0.1", "other.test": "127.0.0.1" }) })).rejects.toThrowError("too_many_redirects");
  });

  it("refuses a redirect to a private host (open-redirect SSRF)", async () => {
    await expect(guardedGet("https://site.test/to-private", { ...base(), resolve: map({ "site.test": "127.0.0.1", "evil.test": "10.0.0.5" }) })).rejects.toThrowError("blocked:private_address");
  });

  it("refuses a redirect downgrade to http", async () => {
    await expect(guardedGet("https://site.test/to-http", { ...base(), resolve: map({ "site.test": "127.0.0.1" }) })).rejects.toThrowError("blocked:scheme");
  });

  it("caps the body at maxBytes", async () => {
    const r = await guardedGet("https://site.test/big", { ...base(), resolve: map({ "site.test": "127.0.0.1" }), maxBytes: 1_048_576 });
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBe(1_048_576);
  });

  it("times out", async () => {
    await expect(guardedGet("https://site.test/slow", { ...base(), resolve: map({ "site.test": "127.0.0.1" }), timeoutMs: 300 })).rejects.toThrowError("timeout");
  });

  it("verifies TLS: an untrusted certificate is an error, not a pass", async () => {
    await expect(guardedGet("https://site.test/", { port, isAllowed: loopbackOnly, resolve: map({ "site.test": "127.0.0.1" }) })).rejects.toThrowError(/self.signed|certificate/i);
  });

  it("verifies the certificate NAME against the hostname, not the pinned IP", async () => {
    await expect(guardedGet("https://wrong.test/", { ...base(), resolve: map({ "wrong.test": "127.0.0.1" }) })).rejects.toThrowError(/altnames|Hostname\/IP does not match/i);
  });
});
