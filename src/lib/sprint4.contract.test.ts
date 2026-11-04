/**
 * CONTRACT TEST (Sprint 4): the REAL admin read-side + decision functions and the REAL attestation service against the
 * real migrations, through supabase-js -> PostgREST -> Postgres. An "admin" here is a signed JWT carrying
 * app_metadata.role = 'admin', exactly what Supabase Auth issues. Run with: npm run test:contract
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TALENT_CONSENTS } from "@/lib/constants";
import { attestationDecision, banDecision, ghostDecision, portfolioDecision, talentDecision } from "@/lib/admin/decisions";
import { attestationCase, getItem, ghostCase, listItems, queueCounts, recentAudit, talentFile } from "@/lib/admin/queue";
import { requestAttestation, type AttestationDeps } from "@/lib/attestation/service";
import { hashToken } from "@/lib/attestation/token";
import { createTalentProfile, recordMissingConsents, syncPhoneVerification } from "@/lib/rpc";
import { CONTAINER, clientFor, confirmPhone, newUser, seedId, sql, startProxy } from "@/lib/testing/contract-harness";
import { buildCreateTalentArgs } from "@/lib/validation/talent";

let proxy: { url: string; close: () => void };
let db: SupabaseClient; // service role = the admin pages' read client
let adminSb: SupabaseClient; // the admin's own session
let userSb: SupabaseClient; // an ordinary signed-in user
let anon: SupabaseClient; // the client who gets the e-mailed link

beforeAll(async () => {
  if (!CONTAINER) return;
  proxy = await startProxy();
  db = clientFor(proxy.url, { service: true });
  adminSb = clientFor(proxy.url, { userId: newUser(), admin: true });
  userSb = clientFor(proxy.url, { userId: newUser() });
  anon = clientFor(proxy.url, null);
});
afterAll(() => proxy?.close());

const paidUnlock = (talent: string) => {
  const rec = randomUUID();
  sql(`insert into recruiters(id, phone_e164, is_phone_verified, company_name) values ('${rec}','+91${String(Math.floor(Math.random() * 9e9) + 1e9)}',true,'Contract Co')`);
  const unlock = randomUUID();
  sql(`insert into lead_unlocks(id, recruiter_id, talent_id, tier_at_unlock, credits_deducted, is_trial, talent_online_at_unlock, has_clicked_whatsapp, whatsapp_clicked_at)
        values ('${unlock}','${rec}','${talent}','standard',2,false,true,true,now()-interval '30 hours')`);
  return { rec, unlock };
};
const report = (talent: string, disputed: boolean) => {
  const { rec, unlock } = paidUnlock(talent);
  const id = randomUUID();
  sql(`insert into ghost_reports(id, unlock_id, recruiter_id, talent_id, talent_deadline, recruiter_note) values ('${id}','${unlock}','${rec}','${talent}', now()+interval '10 hours','no reply in 30h')`);
  if (disputed) sql(`select set_config('request.jwt.claims','{"role":"service_role"}',false); select public.submit_ghost_dispute('${id}', (select telegram_chat_id from talent_private where talent_id='${talent}'), 'I did reply', array['telegram:photo:AgACAgUAAxkBAAIX','https://wa.me/proof'])`);
  return { id, rec };
};

describe.skipIf(!CONTAINER)("admin: who may act", () => {
  it("an ordinary signed-in user is refused by the database itself", async () => {
    const r = await talentDecision(userSb, { talentId: randomUUID(), decision: "ban", notes: "trying my luck" });
    expect(r).toMatchObject({ error: expect.stringMatching(/admin role/) });
  });
  it("anon cannot reach the queue tables or the audit log", async () => {
    expect((await anon.from("review_queue").select("*")).data ?? []).toHaveLength(0);
    expect((await anon.from("admin_audit_log").select("*")).error?.code).toBe("42501");
    expect((await userSb.from("admin_audit_log").select("*")).error?.code).toBe("42501");
  });
  it("an admin session works on the admin functions", async () => {
    const r = await talentDecision(adminSb, { talentId: randomUUID(), decision: "restore", notes: "no such person" });
    expect(r).toEqual({ error: "That profile no longer exists." }); // not 'forbidden': the admin claim was accepted
  });
});

describe.skipIf(!CONTAINER)("admin: portfolio queue", () => {
  let designer = "";
  let queueId = "";
  it("a designer who signs up enters the queue (and is not listed yet)", async () => {
    const uid = newUser();
    const sb = clientFor(proxy.url, { userId: uid });
    await recordMissingConsents(sb, TALENT_CONSENTS);
    designer = await createTalentProfile(sb, buildCreateTalentArgs({
      role: "designer", fullName: "Dipti Rajkhowa", email: "dipti@example.com", state: "Assam", city: "Jorhat", nativeLanguage: "Assamese",
      secondaryLanguages: [], skills: ["figma"], hourlyRate: "500", whatsapp: "9811100501", portfolioUrl: "https://dipti.example/work",
    }));
    confirmPhone(uid, "+919811100501");
    await syncPhoneVerification(sb);
    const { items, talents } = await listItems(db, "portfolio", "open");
    const mine = items.find((i) => i.talent_id === designer)!;
    expect(mine).toBeDefined();
    queueId = mine.id;
    expect(mine.type).toBe("designer_portfolio");
    expect(talents.get(designer)?.masked_name).toBe("Dipti R.");
    expect(sql(`select is_listed from talent_public where id='${designer}'`)).toBe("f");
    expect((await queueCounts(db)).portfolio).toBeGreaterThanOrEqual(1);
  });
  it("the reviewer's file shows links and name, but no phone, e-mail or Telegram id", async () => {
    const f = await talentFile(db, designer);
    expect(f).toMatchObject({ full_name: "Dipti Rajkhowa", role: "designer" });
    expect(JSON.stringify(f)).toContain("dipti.example/work");
    const text = JSON.stringify(f);
    expect(text).not.toMatch(/phone|9811100501|dipti@example\.com|telegram/i);
  });
  it("scoring it lists the designer and closes the item, under the admin's own id", async () => {
    const r = await portfolioDecision(adminSb, db, { talentId: designer, queueId, tier: "reviewed", s1: "8", s2: "6", s3: "7", s4: "5", notes: "solid case studies" });
    expect(r).toEqual({ ok: true, group: "portfolio" });
    expect(sql(`select review_status||' '||proof_score||' '||is_listed from talent_public where id='${designer}'`)).toBe("reviewed 36 true"); // 26 work + 10 reviewed
    const item = await getItem(db, queueId);
    expect(item).toMatchObject({ status: "approved" });
    expect(item!.reviewer_notes).toMatch(/Case-study depth 8\/10.*solid case studies/);
    expect(sql(`select reviewer_id is not null from review_queue where id='${queueId}'`)).toBe("t");
    expect((await recentAudit(db, designer))[0]).toMatchObject({ action: "set_review:reviewed:26" });
  });
  it("rejecting zeroes the work depth whatever the sliders said", async () => {
    const uid = newUser();
    const sb = clientFor(proxy.url, { userId: uid });
    await recordMissingConsents(sb, TALENT_CONSENTS);
    const m = await createTalentProfile(sb, buildCreateTalentArgs({ role: "marketer", fullName: "Mukul Bora", email: "mukul@example.com", state: "Assam", city: "Guwahati", nativeLanguage: "Assamese", secondaryLanguages: [], skills: ["seo"], hourlyRate: "400", whatsapp: "9811100502", portfolioUrl: "" }));
    const qid = (await listItems(db, "portfolio", "open")).items.find((i) => i.talent_id === m)!.id;
    const r = await portfolioDecision(adminSb, db, { talentId: m, queueId: qid, tier: "unverified", s1: "9", s2: "9", s3: "9", s4: "9", notes: "campaign screenshots are stock images" });
    expect(r).toEqual({ ok: true, group: "portfolio" });
    expect(sql(`select review_status||' '||(score_breakdown->>'work_depth') from talent_public where id='${m}'`)).toBe("unverified 0");
    expect((await getItem(db, qid))!.status).toBe("rejected");
  });
  it("the form's validation runs before the database", async () => {
    expect(await portfolioDecision(adminSb, db, { talentId: designer, queueId, tier: "reviewed", s1: "", s2: "5", s3: "5", s4: "5" })).toMatchObject({ error: expect.stringMatching(/whole number/) });
    expect(await portfolioDecision(adminSb, db, { talentId: seedId(1), queueId, tier: "reviewed", s1: "5", s2: "5", s3: "5", s4: "5" })).toEqual({ error: "Only designers and marketers are reviewed by hand." });
  });
});

describe.skipIf(!CONTAINER)("admin: ghost disputes", () => {
  it("the reviewer sees both sides and the evidence; upholding refunds exactly what was paid and strikes", async () => {
    const { id, rec } = report(seedId(2), true);
    const queued = (await listItems(db, "ghost", "open")).items.find((i) => i.related_id === id)!;
    expect(queued).toBeDefined();

    const c = (await ghostCase(db, id))!;
    expect(c).toMatchObject({ recruiter_note: "no reply in 30h", talent_dispute_note: "I did reply", status: "under_review", recruiter_company: "Contract Co" });
    expect(c.unlock).toMatchObject({ credits_deducted: 2 });
    expect(c.evidence_urls).toEqual(["telegram:photo:AgACAgUAAxkBAAIX", "https://wa.me/proof"]);
    expect(JSON.stringify(c)).not.toMatch(/phone|\+91/);

    expect(await ghostDecision(adminSb, { reportId: id, queueId: queued.id, decision: "uphold", notes: "screenshot predates the unlock" })).toEqual({ ok: true, group: "ghost" });
    expect(sql(`select status from ghost_reports where id='${id}'`)).toBe("upheld");
    expect(sql(`select credits_balance from recruiters where id='${rec}'`)).toBe("2");
    expect(sql(`select count(*) from strikes where report_id='${id}'`)).toBe("1");
    expect((await getItem(db, queued.id))!.status).toBe("approved");
  });
  it("rejecting leaves no strike and no refund; resolving twice is harmless", async () => {
    const { id, rec } = report(seedId(3), true);
    const q = (await listItems(db, "ghost", "open")).items.find((i) => i.related_id === id)!;
    expect(await ghostDecision(adminSb, { reportId: id, queueId: q.id, decision: "reject", notes: "reply is clearly visible" })).toEqual({ ok: true, group: "ghost" });
    expect(sql(`select count(*) from strikes where report_id='${id}'`)).toBe("0");
    expect(sql(`select credits_balance from recruiters where id='${rec}'`)).toBe("0");
    expect(await ghostDecision(adminSb, { reportId: id, queueId: q.id, decision: "reject", notes: "reply is clearly visible" })).toEqual({ ok: true, group: "ghost" });
    expect(sql(`select status from ghost_reports where id='${id}'`)).toBe("rejected");
  });
  it("a reason is mandatory", async () => {
    expect(await ghostDecision(adminSb, { reportId: randomUUID(), queueId: randomUUID(), decision: "uphold", notes: "" })).toMatchObject({ error: expect.stringMatching(/reason/) });
  });
});

describe.skipIf(!CONTAINER)("admin: strike 3 / bans", () => {
  const talent = seedId(4);
  let queueId = "";
  it("the third strike opens a ban review; the file lists the strikes", async () => {
    for (let i = 0; i < 3; i++) {
      const { id } = report(talent, false);
      sql(`select private.apply_strike('${talent}','${id}')`);
    }
    const item = (await listItems(db, "ban", "open")).items.find((i) => i.talent_id === talent)!;
    expect(item).toBeDefined();
    queueId = item.id;
    const f = (await talentFile(db, talent))!;
    expect(f.strikes.filter((s) => s.status === "active")).toHaveLength(3);
    expect(f.is_banned).toBe(false);
  });
  it("'no ban' closes the item once; a second attempt says it's already resolved", async () => {
    expect(await banDecision(adminSb, { talentId: talent, queueId, decision: "dismiss", notes: "first offence in a year" })).toEqual({ ok: true, group: "ban" });
    expect(await banDecision(adminSb, { talentId: talent, queueId, decision: "dismiss", notes: "first offence in a year" })).toEqual({ error: "Someone already resolved this item." });
  });
  it("ban blocklists phone + GitHub hashes; restoring (an appeal) reverses it", async () => {
    const t = seedId(5);
    expect(await talentDecision(adminSb, { talentId: t, decision: "ban", notes: "fabricated projects" })).toMatchObject({ ok: true });
    expect(sql(`select is_banned from talent_public where id='${t}'`)).toBe("t");
    expect(sql(`select count(*) from blocklist where reason='fabricated projects'`)).toBe("2");
    expect(sql(`select count(*) from blocklist where value_hash like '%9000000005%'`)).toBe("0"); // hashes, never the number
    expect(await talentDecision(adminSb, { talentId: t, decision: "restore", notes: "appeal accepted" })).toMatchObject({ ok: true, talentId: t });
    expect(sql(`select is_banned from talent_public where id='${t}'`)).toBe("f");
    expect((await recentAudit(db, t)).map((a) => a.action)).toEqual(["restore", "ban"]);
  });
  it("dismissing without a queue item is refused", async () => {
    expect(await banDecision(adminSb, { talentId: talent, decision: "dismiss", notes: "nothing to close" })).toEqual({ error: "Nothing to dismiss: this isn't a queue item." });
  });
});

describe.skipIf(!CONTAINER)("client attestation, end to end through the database", () => {
  const talentId = seedId(8);
  const sent: { to: string; text: string }[] = [];
  const projectId = randomUUID();
  const deps = (over: Partial<AttestationDeps> = {}): AttestationDeps => ({
    hmacSecret: "contract-test-secret-contract-test-secret",
    siteUrl: "https://devmap.test",
    async createRow(a) {
      const r = await db.rpc("create_client_attestation", { p_project: a.projectId, p_channel: a.channel, p_contact_masked: a.contactMasked, p_contact_hmac: a.contactHmac, p_token_hash: a.tokenHash });
      if (r.error) throw new Error(r.error.message);
      return r.data as string;
    },
    async expireRow(id) {
      await db.from("client_attestations").update({ status: "expired" }).eq("id", id);
    },
    sendMail: async (m) => void sent.push({ to: m.to, text: m.text }),
    ...over,
  });
  // one talent may send only 5 requests a day (that limit is tested in SQL), so tests spread across seed talents
  const project = (title: string, url: string, owner = talentId) => {
    const id = randomUUID();
    sql(`insert into projects(id, talent_id, generic_title, live_url) values ('${id}','${owner}','${title}','${url}')`);
    return { id, generic_title: title, live_url: url, is_ownership_verified: false };
  };
  const talent = { maskedName: "Mitali S.", emails: ["mitali@example.com"], phones: ["+919000000008"] };
  const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]{43})/.exec(text)![1];

  it("request -> e-mail -> client previews and confirms with no account -> project verified (attested)", async () => {
    void projectId;
    const p = project("Client bakery site", "https://bakery.example.test");
    const res = await requestAttestation(deps(), { project: p, talent, channel: "email", contact: "owner@bakery.example" });
    expect(res).toEqual({ channel: "email", sentTo: "o***@bakery.example" });
    expect(sent.at(-1)!.to).toBe("owner@bakery.example");
    const token = tokenFrom(sent.at(-1)!.text);

    // the database holds only a hash and a mask
    expect(sql(`select token_hash='${hashToken(token)}' from client_attestations where project_id='${p.id}'`)).toBe("t");
    expect(sql(`select contact_masked from client_attestations where project_id='${p.id}'`)).toBe("o***@bakery.example");
    expect(sql(`select count(*) from client_attestations where contact_masked ilike '%owner@bakery%'`)).toBe("0");

    const preview = await anon.rpc("attestation_preview", { p_token: token });
    expect(preview.data).toMatchObject({ talent_name: expect.any(String), title: "Client bakery site", site: "https://bakery.example.test" });
    expect(JSON.stringify(preview.data)).not.toMatch(/owner@|hmac/);
    // opening the link changed nothing
    expect(sql(`select status from client_attestations where project_id='${p.id}'`)).toBe("pending");

    const answer = await anon.rpc("respond_client_attestation", { p_token: token, p_confirm: true });
    expect(answer.data).toBe("confirmed");
    expect(sql(`select verification_method||' '||is_ownership_verified from projects where id='${p.id}'`)).toBe("client_attestation true");
    expect((await anon.rpc("respond_client_attestation", { p_token: token, p_confirm: true })).data).toBe("invalid"); // single use
    expect((await anon.rpc("attestation_preview", { p_token: token })).data).toBeNull();
  });

  it("the talent cannot see anyone else's project through RLS (which is what the server action relies on)", async () => {
    const other = project("Another talents site", "https://other-site.example.test");
    const uid = newUser();
    const sb = clientFor(proxy.url, { userId: uid });
    const r = await sb.from("projects").select("id").eq("id", other.id).maybeSingle();
    expect(r.data).toBeNull();
  });

  it("limits: 2 confirmations per client per 30 days (at request AND at confirmation), 3 requests per client per day", async () => {
    const contact = "busy.client@agency.example";
    const tokens: string[] = [];
    for (const [t, u] of [["Site one", "https://p1.example.test"], ["Site two", "https://p2.example.test"], ["Site three", "https://p3.example.test"]] as const) {
      await requestAttestation(deps(), { project: project(t, u), talent, channel: "email", contact });
      tokens.push(tokenFrom(sent.at(-1)!.text));
    }
    await expect(requestAttestation(deps(), { project: project("Site four", "https://p4.example.test"), talent, channel: "email", contact })).rejects.toMatchObject({ code: "contact_rate_limited" });
    expect((await anon.rpc("respond_client_attestation", { p_token: tokens[0], p_confirm: true })).data).toBe("confirmed");
    expect((await anon.rpc("respond_client_attestation", { p_token: tokens[1], p_confirm: true })).data).toBe("confirmed");
    expect((await anon.rpc("respond_client_attestation", { p_token: tokens[2], p_confirm: true })).data).toBe("limit_reached");
  });

  it("a failed e-mail releases the slot", async () => {
    const p = project("Mail-failure site", "https://mailfail.example.test", seedId(11));
    await expect(requestAttestation(deps({ sendMail: async () => { throw new Error("smtp down"); } }), { project: p, talent, channel: "email", contact: "x@mailfail.example" })).rejects.toMatchObject({ code: "mail_failed" });
    expect(sql(`select status from client_attestations where project_id='${p.id}'`)).toBe("expired");
  });

  it("WhatsApp-channel confirmations always reach the spot-check queue, the admin sees them and can void them", async () => {
    const p = project("WhatsApp-sent site", "https://wa-site.example.test", seedId(9));
    const res = await requestAttestation(deps(), { project: p, talent, channel: "whatsapp", contact: "98111 77001" });
    const token = tokenFrom(decodeURIComponent(res.waLink!));
    expect((await anon.rpc("respond_client_attestation", { p_token: token, p_confirm: true })).data).toBe("confirmed");

    const item = (await listItems(db, "attestation", "open")).items.find((i) => i.related_id && sql(`select project_id from client_attestations where id='${i.related_id}'`) === p.id)!;
    expect(item).toBeDefined();
    const c = (await attestationCase(db, item.related_id!))!;
    expect(c).toMatchObject({ channel: "whatsapp", status: "confirmed", contact_masked: "+91 ••••• ••001" });
    expect(c.project).toMatchObject({ generic_title: "WhatsApp-sent site", is_ownership_verified: true });
    expect(JSON.stringify(c)).not.toMatch(/hmac/i);

    expect(await attestationDecision(adminSb, { attestationId: c.id, queueId: item.id, decision: "reject", notes: "client says never heard of them" })).toEqual({ ok: true, group: "attestation" });
    expect(sql(`select is_ownership_verified||' '||verification_method from projects where id='${p.id}'`)).toBe("false none");
    expect(sql(`select status from client_attestations where id='${c.id}'`)).toBe("declined");
  });

  it("the same logic as the page: nothing is verified by merely asking, and declining verifies nothing", async () => {
    const p = project("Declined site", "https://declined.example.test", seedId(10));
    await requestAttestation(deps(), { project: p, talent, channel: "email", contact: "no@declined.example" });
    expect(sql(`select is_ownership_verified from projects where id='${p.id}'`)).toBe("f");
    expect((await anon.rpc("respond_client_attestation", { p_token: tokenFrom(sent.at(-1)!.text), p_confirm: false })).data).toBe("declined");
    expect(sql(`select is_ownership_verified from projects where id='${p.id}'`)).toBe("f");
  });
});

vi.setConfig({ testTimeout: 20_000 });
