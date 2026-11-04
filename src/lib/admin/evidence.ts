import { safeHttpUrl } from "@/lib/url";

/**
 * `ghost_reports.evidence_urls` holds whatever evidence a case carries: links (e.g. a chat screenshot hosted somewhere),
 * or plain text an admin pasted after talking to the talent by e-mail. Anything that is not a plain http(s) link is shown as
 * inert text, never as a link.
 */
export type Evidence = { kind: "link"; url: string } | { kind: "text"; text: string };

export function parseEvidence(items: string[] | null | undefined): Evidence[] {
  return (items ?? []).map((raw): Evidence => {
    const url = safeHttpUrl(raw);
    return url ? { kind: "link", url } : { kind: "text", text: raw.slice(0, 200) };
  });
}
