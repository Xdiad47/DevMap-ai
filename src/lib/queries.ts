/**
 * Every column list the app selects, in one place. The contract test (rpc.contract.test.ts) runs
 * these exact strings against the real migration, so a renamed or missing column fails a test
 * instead of failing a page in production.
 */
export const TALENT_COLUMNS =
  "id, role, masked_name, city, state, is_listed, is_online, proof_score, response_velocity_score, composite_rank_score, review_status, state_rank, state_cohort_size";
export const TALENT_PRIVATE_COLUMNS = "phone_e164, whatsapp_number, is_phone_verified";
export const RECRUITER_COLUMNS = "id, company_name, is_phone_verified, credits_balance, trial_unlocks_remaining";
export const PROJECT_COLUMNS = "id, generic_title, is_ownership_verified, verification_method, verification_token";
export const LEDGER_COLUMNS = "id, delta, balance_after, reason, created_at";
export const SKILL_COLUMNS = "slug, label, role, category";
export const CONSENT_COLUMNS = "consent_type, withdrawn_at";

/** Public card fields (everything here is readable by any signed-in user via the `talent_public` RLS policy). */
export const CARD_COLUMNS =
  "id, role, masked_name, city, state, latitude, longitude, native_language, secondary_languages, skills, hourly_rate_paise, is_online, is_at_daily_cap, is_pro, review_status, proof_score, response_velocity_score, composite_rank_score, verified_live_apps, uptime_30d_avg, state_rank, state_cohort_size, last_active_at";
export const UNLOCK_COLUMNS = "talent_id, tier_at_unlock, credits_deducted, is_trial, refunded_at, has_clicked_whatsapp";
export const BUNDLE_COLUMNS = "id, label, credits, price_paise, sort_order";
