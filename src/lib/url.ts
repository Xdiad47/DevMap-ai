/**
 * Portfolio links are typed by the talent, so before putting one in an <a href> we make sure it is a plain
 * http(s) URL. Otherwise a link like `javascript:alert(1)` would run script in the recruiter's browser.
 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
