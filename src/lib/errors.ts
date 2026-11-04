/**
 * Database functions fail with short machine codes (`raise exception 'consent_required'`), and
 * constraint failures carry Postgres wording. Users should never see either. This maps both to
 * plain language; unknown errors get a generic message (the raw text is kept for logs).
 */
const KNOWN: [match: string, message: string][] = [
  ["consent_required", "Please accept the required consents to continue."],
  ["profile_exists", "You already have a profile. Taking you to it…"],
  ["github_login_required", "Developers must connect a GitHub account before creating a profile."],
  ["account_blocked", "This account can't be registered. Contact support if you think this is a mistake."],
  ["not_authenticated", "Your session expired. Please sign in again."],
  ["unknown_skill", "One of the selected skills isn't recognised. Reload and try again."],
  ["hourly_rate_paise", "The minimum hourly rate is ₹300."],
  ["talent_private_phone_e164_key", "That mobile number is already registered with another profile."],
  ["recruiters_phone_e164_key", "That mobile number is already registered with another recruiter."],
  ["talent_private_github_user_id_key", "That GitHub account already has a DevMap profile."],
  ["recruiters_gstin_check", "That GSTIN isn't valid."],
  ["phone_verification_required", "Verify your mobile number first."],
  // unlock_talent_contact() / open_whatsapp() / ghost reports
  ["talent_daily_limit_reached", "This person has reached today's limit of contacts. Try again tomorrow or pick someone else."],
  ["insufficient_credits", "You don't have enough credits for this unlock."],
  ["talent_unavailable", "This profile is no longer available."],
  ["unlock_refunded", "This unlock was refunded, so the contact is no longer available."],
  ["cannot_unlock_self", "You can't unlock your own profile."],
  ["recruiter_profile_required", "Set up your recruiter account first."],
  ["unlock_not_found", "Unlock this profile first."],
  // feedback + ghost reports
  ["whatsapp_not_opened", "Open WhatsApp first. A rating or report is only possible after you've tried to reach them."],
  ["delivery_window_open", "It's too soon to report. Give them 24 hours after you opened WhatsApp."],
  ["report_window_closed", "The 7-day window for reporting this lead has closed."],
  ["already_reported", "You've already reported this lead."],
  ["already_refunded", "This lead was already refunded."],
  ["monthly_report_cap_reached", "You've reached this month's limit of 2 reports."],
  ["trial_unlocks_not_reportable", "Free previews can't be reported, since no credit was spent."],
  ["lead_feedback_unlock_id_key", "You've already rated this lead."],
];

export class AppError extends Error {
  constructor(
    message: string,
    public readonly raw?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function friendlyMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  const raw = rawMessage(err);
  const hit = KNOWN.find(([m]) => raw.includes(m));
  if (hit) return hit[1];
  if (/rate limit|too many/i.test(raw)) return "Too many attempts. Please wait a minute and try again.";
  if (/expired|invalid.*(token|otp|code)|token.*(invalid|expired)/i.test(raw)) return "That code is wrong or has expired. Request a new one.";
  if (/network|failed to fetch/i.test(raw)) return "Network problem. Check your connection and try again.";
  return "Something went wrong. Please try again.";
}

export function rawMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return "";
}

/** True when the failure just means "this profile already exists", which is a success for onboarding. */
export function isProfileExists(err: unknown): boolean {
  const raw = err instanceof AppError ? (err.raw ?? "") : rawMessage(err);
  return raw.includes("profile_exists");
}
