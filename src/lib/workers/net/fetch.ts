import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { parseProbeUrl, resolvePublic, SsrfError, type Resolver } from "./guard";

export const USER_AGENT = "DevMapBot/1.0 (+https://devmap.in/bot)";

export type GuardedResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer; // at most maxBytes
  truncated: boolean;
  latencyMs: number;
  finalUrl: string;
  redirects: number;
};

export type GuardedOptions = {
  timeoutMs?: number; // per attempt, INCLUDING DNS and redirects. Default 3500.
  maxBytes?: number; // default 1 MiB
  maxRedirects?: number; // default 1
  // Test seams. Production code never passes these.
  resolve?: Resolver;
  isAllowed?: (ip: string) => boolean;
  tls?: { ca?: string | Buffer };
  port?: number; // tests run a local HTTPS server on a random port
};

const REDIRECT = new Set([301, 302, 303, 307, 308]);

/**
 * GET a user-supplied URL without letting it reach our network.
 *
 *   validate URL -> resolve (A + AAAA) -> every answer must be public -> connect to THAT ip, with the original
 *   hostname as Host header, SNI and certificate name -> read <= 1 MiB -> on a redirect, start again from the top.
 *
 * "Connect to that ip" is the DNS-pinning rule: the `lookup` hook below returns the address we already
 * validated, so the socket layer never asks DNS again and a rebinding server cannot swap in 127.0.0.1.
 * TLS verification is left at Node's default (strict); we never set rejectUnauthorized=false.
 */
export async function guardedGet(rawUrl: string, opts: GuardedOptions = {}): Promise<GuardedResponse> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 3500;
  const maxRedirects = opts.maxRedirects ?? 1;
  const deadline = started + timeoutMs;

  let url = rawUrl;
  for (let hop = 0; ; hop++) {
    const parsed = parseProbeUrl(url);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("timeout");
    const target = await withTimeout(resolvePublic(parsed.hostname, opts.resolve, opts.isAllowed), remaining);

    const res = await requestPinned(parsed, target.address, target.family, deadline, opts);
    if (REDIRECT.has(res.status) && res.headers.location) {
      if (hop >= maxRedirects) throw new Error("too_many_redirects");
      try {
        url = new URL(res.headers.location, parsed).toString();
      } catch {
        throw new SsrfError("invalid_redirect");
      }
      continue; // the next loop iteration re-validates and re-resolves the new target
    }
    return { ...res, latencyMs: Date.now() - started, finalUrl: parsed.toString(), redirects: hop };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

function requestPinned(
  url: URL,
  address: string,
  family: 4 | 6,
  deadline: number,
  opts: GuardedOptions,
): Promise<Omit<GuardedResponse, "latencyMs" | "finalUrl" | "redirects">> {
  const maxBytes = opts.maxBytes ?? 1_048_576;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };
    const req = https.request(
      {
        host: url.hostname, // keeps SNI + certificate-name checks on the ORIGINAL name
        servername: url.hostname,
        port: opts.port ?? 443,
        path: url.pathname + url.search,
        method: "GET",
        agent: false, // no connection pooling across hosts, no keep-alive reuse
        headers: { host: url.hostname, "user-agent": USER_AGENT, accept: "text/html,*/*;q=0.8", "accept-encoding": "identity" }, // no cookies, ever
        // The pin: return the address validated above; never consult DNS again.
        lookup: (_host, options, cb) => {
          if (options && (options as { all?: boolean }).all) {
            (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
          } else {
            cb(null, address, family);
          }
        },
        ca: opts.tls?.ca,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            truncated = true;
            chunks.push(c.subarray(0, c.length - (size - maxBytes)));
            res.destroy(); // stop downloading; what we have is enough
            return;
          }
          chunks.push(c);
        });
        const finish = () => done(() => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated }));
        res.on("end", finish);
        res.on("close", finish); // fires after destroy() on the size cap
        res.on("error", (e) => (truncated ? finish() : done(() => reject(e))));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(() => reject(new Error("timeout")));
    }, Math.max(1, deadline - Date.now()));
    req.on("error", (e) => done(() => reject(e)));
    req.end();
  });
}
