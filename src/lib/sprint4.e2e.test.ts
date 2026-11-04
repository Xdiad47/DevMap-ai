/**
 * END-TO-END against the REAL local Supabase stack (real GoTrue + Mailpit), no mocks except the human:
 *  - an admin is made the way production does it (service key writes app_metadata.role) and Auth really puts the claim in the
 *    JWT the database checks; an ordinary user, and a user who edits their OWN metadata, are refused
 *  - a client-attestation e-mail really leaves through SMTP, lands in Mailpit, and its link works against the database
 *
 * Run:  npm run test:e2e     (needs `npx supabase start`)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createMailer } from "@/lib/attestation/mailer";
import { requestAttestation } from "@/lib/attestation/service";
import { isAdminUser } from "@/lib/admin/guard";

const API = process.env.E2E_API_URL;
const ANON = process.env.E2E_ANON_KEY ?? "";
const SERVICE = process.env.E2E_SERVICE_KEY ?? "";
const MAIL = process.env.E2E_MAIL_URL ?? "http://127.0.0.1:54324";
const SMTP = process.env.E2E_SMTP_URL ?? "smtp://127.0.0.1:54325";
const RUN = randomUUID().slice(0, 8);

const client = (key: string): SupabaseClient => createClient(API!, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const psql = (q: string) => execFileSync("docker", ["exec", "-i", process.env.E2E_DB_CONTAINER ?? "supabase_db_devmap", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q", "-c", q], { encoding: "utf8" }).trim();

async function userWithPassword(tag: string, appMetadata?: Record<string, unknown>) {
  const email = `${tag}-${RUN}@s4e2e.test`;
  const password = "Passw0rd!s4";
  const admin = client(SERVICE);
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: appMetadata });
  expect(created.error).toBeNull();
  const sb = client(ANON);
  const signed = await sb.auth.signInWithPassword({ email, password });
  expect(signed.error).toBeNull();
  return { sb, email, id: created.data.user!.id, token: signed.data.session!.access_token };
}
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

async function mailTo(to: string): Promise<{ text: string; html: string; subject: string }> {
  for (let i = 0; i < 40; i++) {
    const list = (await (await fetch(`${MAIL}/api/v1/messages`)).json()) as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
    const hit = list.messages.find((m) => m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()));
    if (hit) {
      const msg = (await (await fetch(`${MAIL}/api/v1/message/${hit.ID}`)).json()) as { Text: string; HTML: string };
      return { text: msg.Text, html: msg.HTML, subject: hit.Subject };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email for ${to}`);
}

describe.skipIf(!API || !SERVICE)("admin role through real Supabase Auth", () => {
  beforeAll(() => {
    if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(API ?? "")) throw new Error("local stack only");
  });

  it("app_metadata.role=admin set with the service key is inside the signed-in user's JWT, and the database accepts it", async () => {
    const a = await userWithPassword("admin", { role: "admin" });
    expect(claims(a.token).app_metadata.role).toBe("admin");
    expect(isAdminUser((await a.sb.auth.getUser()).data.user)).toBe(true);
    const r = await a.sb.rpc("admin_restore_talent", { p_talent: randomUUID(), p_notes: "e2e" });
    expect(r.error?.message).toContain("talent_not_found"); // got past the admin check
  });

  it("an ordinary user is refused by the database", async () => {
    const u = await userWithPassword("user");
    const r = await u.sb.rpc("admin_restore_talent", { p_talent: randomUUID(), p_notes: "e2e" });
    expect(r.error?.message).toContain("forbidden");
    expect(isAdminUser((await u.sb.auth.getUser()).data.user)).toBe(false);
  });

  it("a user who writes role=admin into their OWN metadata gains nothing", async () => {
    const u = await userWithPassword("sneaky");
    const upd = await u.sb.auth.updateUser({ data: { role: "admin" } });
    expect(upd.error).toBeNull(); // Auth allows this: it is user_metadata
    const refreshed = await u.sb.auth.refreshSession();
    const user = (await u.sb.auth.getUser()).data.user;
    expect(user?.user_metadata.role).toBe("admin");
    expect(user?.app_metadata.role).toBeUndefined();
    expect(isAdminUser(user)).toBe(false);
    expect(claims(refreshed.data.session!.access_token).user_metadata.role).toBe("admin"); // present in the token, and ignored
    const r = await u.sb.rpc("admin_ban_talent", { p_talent: randomUUID(), p_notes: "e2e" });
    expect(r.error?.message).toContain("forbidden");
  });

  it("a user cannot write app_metadata themselves", async () => {
    const u = await userWithPassword("selfgrant");
    // the client API has no way to set app_metadata; the admin endpoint refuses a user token
    const res = await fetch(`${API}/auth/v1/admin/users/${u.id}`, { method: "PUT", headers: { apikey: ANON, authorization: `Bearer ${u.token}`, "content-type": "application/json" }, body: JSON.stringify({ app_metadata: { role: "admin" } }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(isAdminUser((await u.sb.auth.getUser()).data.user)).toBe(false);
  });
});

describe.skipIf(!API || !SERVICE)("client attestation e-mail through real SMTP", () => {
  it("is delivered to Mailpit, carries a working one-time link, and the client's answer verifies the project", async () => {
    const service = client(SERVICE);
    const talentId = "00000000-0000-4000-8000-000000000012";
    const projectId = randomUUID();
    psql(`insert into public.projects(id, talent_id, generic_title, live_url) values ('${projectId}','${talentId}','E2E bakery site','https://bakery-${RUN}.example.test')`);
    const clientAddress = `owner-${RUN}@s4e2e.test`;

    const res = await requestAttestation(
      {
        hmacSecret: "e2e-secret-e2e-secret-e2e-secret-xx",
        siteUrl: "http://localhost:3000",
        async createRow(a) {
          const r = await service.rpc("create_client_attestation", { p_project: a.projectId, p_channel: a.channel, p_contact_masked: a.contactMasked, p_contact_hmac: a.contactHmac, p_token_hash: a.tokenHash });
          if (r.error) throw new Error(r.error.message);
          return r.data as string;
        },
        async expireRow(id) {
          await service.from("client_attestations").update({ status: "expired" }).eq("id", id);
        },
        sendMail: (m) => createMailer({ mode: "smtp", url: SMTP, from: "DevMap <no-reply@devmap.in>" }).send(m),
      },
      { project: { id: projectId, generic_title: "E2E bakery site", live_url: `https://bakery-${RUN}.example.test`, is_ownership_verified: false }, talent: { maskedName: "Jyoti P.", emails: ["jyoti@example.com"], phones: [] }, channel: "email", contact: clientAddress },
    );
    expect(res.sentTo).toMatch(/^o\*\*\*@s4e2e\.test$/);

    const mail = await mailTo(clientAddress);
    expect(mail.subject).toBe("Did Jyoti P. build E2E bakery site for you?");
    const m = /http:\/\/localhost:3000\/verify\/attestation\?token=([A-Za-z0-9_-]{43})/.exec(mail.text);
    expect(m, "the e-mail must contain the one-time link").toBeTruthy();
    expect(mail.html).toContain(`token=${m![1]}`);

    const anon = client(ANON);
    expect((await anon.rpc("attestation_preview", { p_token: m![1] })).data).toMatchObject({ title: "E2E bakery site" });
    expect((await anon.rpc("respond_client_attestation", { p_token: m![1], p_confirm: true })).data).toBe("confirmed");
    expect(psql(`select verification_method||' '||is_ownership_verified from public.projects where id='${projectId}'`)).toBe("client_attestation true");
  });
});
