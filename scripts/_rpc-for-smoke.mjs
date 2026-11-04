// Minimal JS twins of src/lib/rpc.ts (plain Node can't import the TS file). Argument names must match the migration.
export async function recordMissingConsents(sb, types) {
  for (const t of types) { const r = await sb.rpc("record_consent", { p_type: t, p_policy_version: "2026-11-02" }); if (r.error) throw r.error; }
}
export async function createTalentProfile(sb, args) { const r = await sb.rpc("create_talent_profile", args); if (r.error) throw r.error; return r.data; }
export async function createRecruiterProfile(sb, args) { const r = await sb.rpc("create_recruiter_profile", args); if (r.error) throw r.error; return r.data; }
