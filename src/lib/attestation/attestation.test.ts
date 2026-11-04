import { describe, expect, it, vi, type Mock } from "vitest";
import { contactHmac, isOwnContact, maskContact, normalizeContact, normalizeEmail } from "./contact";
import { attestationEmail, whatsappText } from "./email";
import { resolveMailConfig } from "./mail-config";
import { AttestationError, requestAttestation, type AttestationDeps, type AttestationInput } from "./service";
import { hashToken, newToken } from "./token";

describe("contacts", () => {
  it("normalises e-mails and Indian mobiles; rejects junk", () => {
    expect(normalizeContact("email", "  Client@Acme.IN ")).toBe("client@acme.in");
    expect(normalizeContact("whatsapp", "98765 43210")).toBe("+919876543210");
    expect(normalizeContact("whatsapp", "+91 98765-43210")).toBe("+919876543210");
    for (const bad of ["", "not-an-email", "a@b", "a b@c.in", "x".repeat(300) + "@a.in"]) expect(normalizeEmail(bad)).toBeNull();
    for (const bad of ["12345", "5876543210", "98765"]) expect(normalizeContact("whatsapp", bad)).toBeNull();
    expect(normalizeContact("email", "9876543210")).toBeNull();
  });
  it("masks without revealing the address", () => {
    expect(maskContact("email", "rahul@acme.in")).toBe("r***@acme.in");
    expect(maskContact("whatsapp", "+919876543210")).toBe("+91 ••••• ••210");
  });
  it("the HMAC is stable, keyed and channel-separated", () => {
    const a = contactHmac("secret-1", "email", "a@b.in");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(contactHmac("secret-1", "email", "a@b.in")).toBe(a);
    expect(contactHmac("secret-2", "email", "a@b.in")).not.toBe(a);
    expect(contactHmac("secret-1", "whatsapp", "a@b.in")).not.toBe(a);
    expect(a).not.toContain("a@b.in");
  });
  it("a talent cannot vouch for themselves, including gmail dot/plus aliases and number formats", () => {
    const own = { emails: ["Rahul.Sharma@gmail.com", "work@rahul.dev"], phones: ["+919876543210", "9811100077"] };
    expect(isOwnContact("email", "rahulsharma@gmail.com", own)).toBe(true);
    expect(isOwnContact("email", "rahul.sharma+shop@gmail.com", own)).toBe(true);
    expect(isOwnContact("email", "work@rahul.dev", own)).toBe(true);
    expect(isOwnContact("email", "client@acme.in", own)).toBe(false);
    expect(isOwnContact("email", "work+x@rahul.dev", own)).toBe(true);
    expect(isOwnContact("whatsapp", "+919876543210", own)).toBe(true);
    expect(isOwnContact("whatsapp", "+919811100077", own)).toBe(true);
    expect(isOwnContact("whatsapp", "+919000000001", own)).toBe(false);
    expect(isOwnContact("email", "a@b.in", { emails: [null], phones: [undefined] })).toBe(false);
  });
});

describe("tokens", () => {
  it("are long, random, URL-safe, and hash to SHA-256 hex", () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(t);
    expect(hashToken("tok-abc")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("matches Postgres' encode(digest(token,'sha256'),'hex') for a known value", () => {
    // sha256("abc")
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("e-mail content", () => {
  it("escapes everything the talent typed (HTML part) and keeps the link intact", () => {
    const m = attestationEmail({ talentName: "<b>Evil</b>", title: 'x"><script>alert(1)</script>', site: "https://a.in/?a=1&b=2", link: "https://devmap.in/verify/attestation?token=abc", days: 7 });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>Evil</b>");
    expect(m.html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(m.html).toContain('href="https://devmap.in/verify/attestation?token=abc"');
    expect(m.text).toContain("https://devmap.in/verify/attestation?token=abc");
    expect(m.subject.length).toBeLessThanOrEqual(140);
  });
  it("says what is stored and what happens if the client doesn't know the talent", () => {
    const m = attestationEmail({ talentName: "Rahul S.", title: "Shop", site: "https://a.in", link: "https://x/y", days: 7 });
    expect(m.text).toMatch(/do not store your email/);
    expect(m.text).toMatch(/choose "No"/);
  });
  it("the WhatsApp text carries the link", () => expect(whatsappText({ talentName: "Rahul S.", title: "Shop", link: "https://x/y?token=t" })).toContain("https://x/y?token=t"));
});

describe("mail config", () => {
  it("needs SMTP or mock; mock is impossible in production; localhost SMTP is refused in production", () => {
    expect(() => resolveMailConfig({})).toThrow(/SMTP_URL/);
    expect(() => resolveMailConfig({ SMTP_URL: "http://x" })).toThrow(/SMTP_URL/);
    expect(resolveMailConfig({ MAIL_MODE: "mock" }).mode).toBe("mock");
    expect(() => resolveMailConfig({ MAIL_MODE: "mock", NODE_ENV: "production" })).toThrow(/production/);
    expect(resolveMailConfig({ SMTP_URL: "smtp://127.0.0.1:54325" }).mode).toBe("smtp");
    expect(() => resolveMailConfig({ SMTP_URL: "smtp://localhost:25", NODE_ENV: "production" })).toThrow(/localhost/);
    expect(resolveMailConfig({ SMTP_URL: "smtps://u:p@smtp.example.com:465", NODE_ENV: "production", MAIL_FROM: "X <x@y.in>" })).toMatchObject({ from: "X <x@y.in>" });
  });
});

describe("requestAttestation", () => {
  const project = { id: "p1", generic_title: "Client shop", live_url: "https://client.example.in", is_ownership_verified: false };
  const talent = { maskedName: "Rahul S.", emails: ["rahul@example.com"], phones: ["+919876543210"] };
  type Spied = AttestationDeps & { createRow: Mock; expireRow: Mock; sendMail: Mock };
  function setup(over: Partial<Record<keyof AttestationDeps, unknown>> = {}): Spied {
    return {
      hmacSecret: "s".repeat(32), siteUrl: "https://devmap.in/",
      createRow: vi.fn(async () => "att-1"), expireRow: vi.fn(async () => {}), sendMail: vi.fn(async () => {}),
      ...over,
    } as Spied;
  }
  const input = (over: Partial<AttestationInput> = {}): AttestationInput => ({ project, talent, channel: "email", contact: "client@acme.in", ...over });

  it("email: stores only masked + hmac + token HASH, and mails the link containing the raw token", async () => {
    const deps = setup();
    const r = await requestAttestation(deps, input());
    expect(r).toEqual({ channel: "email", sentTo: "c***@acme.in" });
    const row = (deps.createRow.mock.calls as unknown as [Record<string, string>][])[0][0];
    expect(row).toMatchObject({ projectId: "p1", channel: "email", contactMasked: "c***@acme.in" });
    expect(JSON.stringify(row)).not.toContain("client@acme.in");
    const mail = (deps.sendMail.mock.calls as unknown as [{ to: string; text: string }][])[0][0];
    expect(mail.to).toBe("client@acme.in");
    const token = /token=([A-Za-z0-9_-]{43})/.exec(mail.text)![1];
    expect(hashToken(token)).toBe(row.tokenHash);
    expect(mail.text).toContain("https://devmap.in/verify/attestation?token=");
    expect(row.contactHmac).toBe(contactHmac(deps.hmacSecret, "email", "client@acme.in"));
  });
  it("whatsapp: nothing is sent by us; the talent gets a ready-made wa.me link", async () => {
    const deps = setup();
    const r = await requestAttestation(deps, input({ channel: "whatsapp", contact: "98111 22233" }));
    expect(deps.sendMail).not.toHaveBeenCalled();
    expect(r.waLink).toMatch(/^https:\/\/wa\.me\/919811122233\?text=/);
    expect(decodeURIComponent(r.waLink!)).toContain("/verify/attestation?token=");
    expect(r.sentTo).toBe("+91 ••••• ••233");
  });
  it("refuses an invalid contact, the talent's own contact, and an already-verified project BEFORE touching the database", async () => {
    const deps = setup();
    await expect(requestAttestation(deps, input({ contact: "nope" }))).rejects.toMatchObject({ code: "invalid_contact" });
    await expect(requestAttestation(deps, input({ contact: "Rahul@example.com" }))).rejects.toMatchObject({ code: "own_contact" });
    await expect(requestAttestation(deps, input({ channel: "whatsapp", contact: "9876543210" }))).rejects.toMatchObject({ code: "own_contact" });
    await expect(requestAttestation(deps, input({ project: { ...project, is_ownership_verified: true } }))).rejects.toMatchObject({ code: "already_verified" });
    expect(deps.createRow).not.toHaveBeenCalled();
    expect(deps.sendMail).not.toHaveBeenCalled();
  });
  it.each([
    ["attestor_limit_reached", /two projects in the last 30 days/],
    ["too_many_pending", /3 requests waiting/],
    ["contact_rate_limited", /3 times today/],
    ["talent_rate_limited", /5 confirmation requests today/],
  ])("maps the database's %s to a message a talent can act on, and sends nothing", async (code, re) => {
    const deps = setup({ createRow: vi.fn(async () => { throw new Error(`${code}`); }) });
    const e = await requestAttestation(deps, input()).catch((x) => x);
    expect(e).toBeInstanceOf(AttestationError);
    expect(e.code).toBe(code);
    expect(e.message).toMatch(re);
    expect(deps.sendMail).not.toHaveBeenCalled();
  });
  it("an unknown database error is not swallowed", async () => {
    const deps = setup({ createRow: vi.fn(async () => { throw new Error("connection reset"); }) });
    await expect(requestAttestation(deps, input())).rejects.toThrow("connection reset");
  });
  it("if the e-mail can't be sent, the request is released (expired) and the talent is told nothing was used up", async () => {
    const deps = setup({ sendMail: vi.fn(async () => { throw new Error("ECONNREFUSED smtp.internal:25 user:pass"); }) });
    const e = await requestAttestation(deps, input()).catch((x) => x);
    expect(e).toMatchObject({ code: "mail_failed" });
    expect(e.message).not.toContain("smtp.internal");
    expect(deps.expireRow).toHaveBeenCalledWith("att-1");
  });
});
