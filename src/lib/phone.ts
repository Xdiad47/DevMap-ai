/**
 * Indian mobile numbers -> E.164 ("+919876543210").
 * The database column checks `^\+[1-9][0-9]{7,14}$`; Supabase Auth stores the same number
 * without the "+". `sync_phone_verification()` compares digits only, so both forms match.
 */
const IN_MOBILE_10 = /^[6-9]\d{9}$/;

export function normalizeIndianMobile(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let ten = digits;
  if (digits.length === 12 && digits.startsWith("91")) ten = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) ten = digits.slice(1);
  return IN_MOBILE_10.test(ten) ? `+91${ten}` : null;
}

/** "+919876543210" -> "+91 98765 43210" */
export function formatIndianMobile(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

export function digitsOnly(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}
