/**
 * Mirror of `private.mask_name()` in the migration, so the onboarding form can preview
 * exactly what recruiters will see. The server is the source of truth: it recomputes the
 * masked name itself, so this can never be used to spoof a name.
 *
 *   "Rahul Sharma"        -> "Rahul S."
 *   "rahul"               -> "Rahul"
 *   "  anil  kumar verma" -> "Anil V."
 */
function initcap(word: string): string {
  // PostgreSQL's initcap(): upper-case the first letter of every alphanumeric run, lower-case the rest.
  return word
    .toLowerCase()
    .replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function maskName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Talent";
  if (parts.length === 1) return initcap(parts[0]);
  const last = parts[parts.length - 1];
  return `${initcap(parts[0])} ${Array.from(last)[0].toUpperCase()}.`;
}
