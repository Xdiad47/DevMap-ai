/**
 * END-TO-END against a REAL local Supabase stack (`npx supabase start`): real GoTrue (Auth), real
 * Kong gateway, real PostgREST, the real migration. Nothing is simulated except the human reading an email.
 *
 * Proves the Sprint-1 acceptance path with the app's own code:
 *   email code sign-in -> phone verification with the test number -> consent -> create profile
 *   -> recruiter's free preview appears in credits_ledger.
 *
 * Run:  npm run test:e2e     (needs `npx supabase start` running)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { RECRUITER_CONSENTS, TALENT_CONSENTS } from "@/lib/constants";
import { AppError } from "@/lib/errors";
import { RECRUITER_COLUMNS, TALENT_PRIVATE_COLUMNS } from "@/lib/queries";
import { createRecruiterProfile, createTalentProfile, recordMissingConsents } from "@/lib/rpc";
import { buildCreateRecruiterArgs } from "@/lib/validation/recruiter";
import { buildCreateTalentArgs, type TalentFormValues } from "@/lib/validation/talent";

const API = process.env.E2E_API_URL;
const ANON = process.env.E2E_ANON_KEY ?? "";
const MAIL = process.env.E2E_MAIL_URL ?? "http://127.0.0.1:54324";

/**
 * Auth allows one user per phone number and the test-OTP list is fixed, so every run must start clean.
 * LOCAL ONLY: refuses to run against anything but a localhost stack, then wipes test users and app data.
 */
function resetLocalTestData() {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(API ?? "")) throw new Error("refusing to reset a non-local database");
  const run = (q: string) =>
    execFileSync("docker", ["exec", "-i", process.env.E2E_DB_CONTAINER ?? "supabase_db_devmap", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-c", q]);
  run("truncate public.recruiters, public.talent_public, public.consents, public.blocklist, public.review_queue cascade");
  run("delete from auth.users where email like '%@example.com'");
  // The truncate above also removed the 15 seed profiles; put them back so other suites still find them.
  execFileSync("docker", ["exec", "-i", process.env.E2E_DB_CONTAINER ?? "supabase_db_devmap", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: readFileSync("supabase/seed.sql"),
    stdio: ["pipe", "ignore", "ignore"],
  });
}

const newClient = (): SupabaseClient =>
  createClient(API!, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

/** Reads the most recent email sent to `to` from Mailpit and returns its text. Retries while it arrives. */
async function latestMail(to: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const list = (await (await fetch(`${MAIL}/api/v1/messages`)).json()) as { messages: { ID: string; To: { Address: string }[] }[] };
    const hit = list.messages.find((m) => m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()));
    if (hit) {
      const msg = (await (await fetch(`${MAIL}/api/v1/message/${hit.ID}`)).json()) as { Text: string; HTML: string };
      return `${msg.Text}\n${msg.HTML}`;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email for ${to}`);
}

async function signInByEmailCode(email: string): Promise<SupabaseClient> {
  const sb = newClient();
  const sent = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  expect(sent.error).toBeNull();
  const mail = await latestMail(email);
  const code = /\b(\d{6})\b/.exec(mail)?.[1];
  expect(code, "the email must contain the 6-digit code from our template").toBeTruthy();
  const verified = await sb.auth.verifyOtp({ email, token: code!, type: "email" });
  expect(verified.error).toBeNull();
  expect(verified.data.session).not.toBeNull();
  return sb;
}

/** Real Supabase Phone Auth, exactly as PhoneVerifier does it. Test numbers come from config.toml. */
async function verifyPhoneWithTestOtp(sb: SupabaseClient, e164: string) {
  const sent = await sb.auth.updateUser({ phone: e164 });
  expect(sent.error, `updateUser({phone}) failed: ${sent.error?.message}`).toBeNull();
  const ok = await sb.auth.verifyOtp({ phone: e164, token: "123456", type: "phone_change" });
  expect(ok.error, `verifyOtp failed: ${ok.error?.message}`).toBeNull();
}

const uniqueEmail = (tag: string) => `${tag}-${randomUUID().slice(0, 8)}@example.com`;

const designerForm = (over: Partial<TalentFormValues> = {}): TalentFormValues => ({
  role: "designer",
  fullName: "Anita Das",
  email: "anita@example.com",
  state: "Assam",
  city: "Jorhat",
  nativeLanguage: "Assamese",
  secondaryLanguages: ["English", "Hindi"],
  skills: ["figma", "web-design"],
  hourlyRate: "450",
  whatsapp: "9876543211",
  portfolioUrl: "",
  ...over,
});

describe.skipIf(!API)("Sprint 1 acceptance, against real Supabase Auth", () => {
  beforeAll(resetLocalTestData);

  it("RECRUITER: email code -> phone OTP -> consent -> profile -> free preview in credits_ledger", async () => {
    const sb = await signInByEmailCode(uniqueEmail("recruiter"));
    await verifyPhoneWithTestOtp(sb, "+919876543210");

    const { data: me } = await sb.auth.getUser();
    expect(me.user?.phone).toBe("919876543210"); // Supabase stores it without "+"
    expect(me.user?.phone_confirmed_at).toBeTruthy();

    await recordMissingConsents(sb, RECRUITER_CONSENTS);
    await createRecruiterProfile(sb, buildCreateRecruiterArgs({ companyName: "Acme Pvt Ltd", gstin: "" }));

    const ledger = await sb.from("credits_ledger").select("reason, delta").eq("reason", "trial_grant");
    expect(ledger.data).toEqual([{ reason: "trial_grant", delta: 0 }]);
    const rec = await sb.from("recruiters").select(RECRUITER_COLUMNS).maybeSingle();
    expect(rec.data).toMatchObject({ is_phone_verified: true, trial_unlocks_remaining: 1, credits_balance: 0 });
  });

  it("TALENT (designer): email sign-in -> consent -> profile, with no phone step (beta)", async () => {
    const sb = await signInByEmailCode(uniqueEmail("designer"));
    await recordMissingConsents(sb, TALENT_CONSENTS);
    await createTalentProfile(sb, buildCreateTalentArgs(designerForm()));

    // The WhatsApp number the person typed is the one contact number; nothing waits for an SMS code.
    const priv = await sb.from("talent_private").select(TALENT_PRIVATE_COLUMNS).maybeSingle();
    expect(priv.data?.is_phone_verified).toBe(true);
    expect(priv.data?.phone_e164).toBe(priv.data?.whatsapp_number);
  });

  it("DEVELOPER without a GitHub identity is refused with a friendly message", async () => {
    const sb = await signInByEmailCode(uniqueEmail("dev"));
    await recordMissingConsents(sb, TALENT_CONSENTS);
    const err = await createTalentProfile(sb, buildCreateTalentArgs(designerForm({ role: "developer", skills: ["flutter"], whatsapp: "9876543215" }))).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toMatch(/GitHub/);
  });

  it("SECURITY: asking for a code does NOT verify the phone (guards the 'phone confirmations' setting)", async () => {
    const sb = await signInByEmailCode(uniqueEmail("noautoconfirm"));
    const sent = await sb.auth.updateUser({ phone: "+919876543213" });
    expect(sent.error).toBeNull();
    const { data } = await sb.auth.getUser();
    // If autoconfirm were on, the number would already be the user's confirmed phone with no code entered.
    expect(data.user?.phone_confirmed_at ?? null).toBeNull();
    expect(data.user?.phone ?? "").not.toBe("919876543213");
    // And a wrong code must be rejected.
    const wrong = await sb.auth.verifyOtp({ phone: "+919876543213", token: "000000", type: "phone_change" });
    expect(wrong.error).not.toBeNull();
  });

  it("anonymous visitors still cannot read contact data through the real gateway", async () => {
    const anon = newClient();
    expect((await anon.from("talent_private").select("full_name")).error).not.toBeNull();
    expect((await anon.from("skills").select("slug")).data?.length).toBe(19);
  });
});

