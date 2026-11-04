/**
 * Facts about the business that the legal pages and footer print. NOTHING here is invented: whatever you haven't
 * configured is simply left out of the page (never a made-up address or officer). Set these before launch:
 *
 *   NEXT_PUBLIC_COMPANY_LEGAL_NAME   e.g. "DevMap Technologies Private Limited"
 *   NEXT_PUBLIC_COMPANY_ADDRESS      the registered address (Razorpay requires it on /contact)
 *   NEXT_PUBLIC_COMPANY_GSTIN        shown on /pricing and /contact when GST-registered
 *   NEXT_PUBLIC_GRIEVANCE_NAME       the Grievance Officer's name (required by the DPDP Act / IT Rules)
 *   NEXT_PUBLIC_SUPPORT_EMAIL        defaults to SUPPORT_EMAIL, then diadem.xeiver@gmail.com
 *   NEXT_PUBLIC_SUPPORT_HOURS        defaults to "Monday to Saturday, 10 am to 6 pm IST"
 *   NEXT_PUBLIC_JURISDICTION         city whose courts the Terms name, e.g. "Mumbai, Maharashtra". Until set, the Terms say
 *                                    "the place of our registered office in India" rather than guess a city.
 */
export function getCompany(env: Record<string, string | undefined> = process.env) {
  const clean = (v: string | undefined) => v?.trim() || null;
  const supportEmail = clean(env.NEXT_PUBLIC_SUPPORT_EMAIL) ?? clean(env.SUPPORT_EMAIL) ?? "diadem.xeiver@gmail.com";
  return {
    brand: "DevMap.in",
    legalName: clean(env.NEXT_PUBLIC_COMPANY_LEGAL_NAME),
    address: clean(env.NEXT_PUBLIC_COMPANY_ADDRESS),
    gstin: clean(env.NEXT_PUBLIC_COMPANY_GSTIN),
    supportEmail,
    grievanceName: clean(env.NEXT_PUBLIC_GRIEVANCE_NAME),
    grievanceEmail: supportEmail,
    hours: clean(env.NEXT_PUBLIC_SUPPORT_HOURS) ?? "Monday to Saturday, 10 am to 6 pm IST",
    replyTime: "2 working days",
    jurisdiction: clean(env.NEXT_PUBLIC_JURISDICTION) ?? "the place of our registered office in India",
    updated: "3 November 2026",
  };
}
