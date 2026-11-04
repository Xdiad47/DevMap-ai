/**
 * What may a recruiter do with an unlock RIGHT NOW? A pure mirror of the rules inside the database functions
 * `submit_lead_feedback()` and `report_ghosting()`. The database is the authority (it re-checks everything and
 * the UI shows its error if the two ever disagree); this exists so the screen can show the right buttons and
 * tell people *when* a button will unlock instead of letting them click into an error.
 */
export const REPORT_MIN_WAIT_HOURS = 24; // app_config.ghost_report_min_wait_hours
export const REPORT_MAX_AGE_DAYS = 7; // app_config.ghost_report_max_age_days

export type LeadRow = {
  id: string;
  talent_id: string;
  created_at: string;
  is_trial: boolean;
  credits_deducted: number;
  has_clicked_whatsapp: boolean;
  whatsapp_clicked_at: string | null;
  refunded_at: string | null;
};
export type ReportStatus = "awaiting_talent" | "under_review" | "upheld" | "rejected";
export type LeadReport = { unlock_id: string; status: ReportStatus; talent_deadline: string };
export type Rating = "responsive" | "not_fit";

export type LeadView = {
  rating: Rating | null;
  canRate: boolean;
  report: LeadReport | null;
  canReport: boolean;
  /** Why 🚩 is unavailable, in words for a recruiter. null when it IS available or already filed. */
  reportHint: string | null;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

export function leadView(lead: LeadRow, rating: Rating | null, report: LeadReport | null, now: Date = new Date()): LeadView {
  const refunded = lead.refunded_at !== null;
  const canRate = lead.has_clicked_whatsapp && rating === null;

  let canReport = false;
  let reportHint: string | null = null;
  if (report) {
    // already filed: nothing to explain here, the status line says it
  } else if (refunded) {
    reportHint = "This unlock was already refunded.";
  } else if (lead.is_trial) {
    reportHint = "Free previews can't be reported, since no credit was spent.";
  } else if (!lead.has_clicked_whatsapp || !lead.whatsapp_clicked_at) {
    reportHint = "Open WhatsApp first. A report is only possible after you've tried to reach them.";
  } else {
    const opensAt = new Date(lead.whatsapp_clicked_at).getTime() + REPORT_MIN_WAIT_HOURS * HOUR;
    const closesAt = new Date(lead.created_at).getTime() + REPORT_MAX_AGE_DAYS * DAY;
    if (now.getTime() > closesAt) reportHint = `The ${REPORT_MAX_AGE_DAYS}-day window for reporting this lead has closed.`;
    else if (now.getTime() < opensAt) reportHint = `If they still haven't replied, you can report from ${formatWhen(new Date(opensAt).toISOString())} IST (${REPORT_MIN_WAIT_HOURS} hours after you opened WhatsApp).`;
    else canReport = true;
  }
  return { rating, canRate, report, canReport, reportHint };
}

export function reportStatusLine(r: LeadReport): { tone: "info" | "success" | "warn"; text: string } {
  switch (r.status) {
    case "awaiting_talent":
      return { tone: "info", text: `Report sent. They have until ${formatWhen(r.talent_deadline)} IST to respond; if they don't, your credit is refunded automatically.` };
    case "under_review":
      return { tone: "info", text: "The talent disputed the report. Our team is reviewing it; you'll see the result here." };
    case "upheld":
      return { tone: "success", text: "Report upheld. Your credit was refunded." };
    case "rejected":
      return { tone: "warn", text: "Report reviewed: the talent showed they replied, so no refund was made." };
  }
}
