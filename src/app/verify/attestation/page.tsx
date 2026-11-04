import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { safeHttpUrl } from "@/lib/url";
import { createPublicClient } from "@/lib/supabase/public";
import { answerAttestation } from "./actions";

// The token is in this page's URL: keep it out of Referer headers and search engines.
export const metadata: Metadata = { title: "Confirm a project", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Preview = { talent_name: string; title: string; site: string; expires_at: string };

export default async function AttestationPage({ searchParams }: PageProps<"/verify/attestation">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  let preview: Preview | null = null;
  if (/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    const { data } = await createPublicClient().rpc("attestation_preview", { p_token: token });
    preview = (data as Preview | null) ?? null;
  }

  if (!preview) {
    return (
      <Card className="mx-auto max-w-lg space-y-2">
        <h1 className="text-xl font-semibold">This link has expired or was already used</h1>
        <p className="text-sm text-slate-600">Each confirmation link works once and lasts 7 days. If you still want to confirm, ask the person to send a new request from their DevMap profile.</p>
      </Card>
    );
  }
  const site = safeHttpUrl(preview.site);
  return (
    <Card className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Did {preview.talent_name} build this for you?</h1>
        <p className="mt-2 text-sm text-slate-700">
          <strong>{preview.talent_name}</strong> lists <strong>{preview.title}</strong> on DevMap.in as work they delivered for a client.
        </p>
        <p className="mt-1 break-all text-sm text-slate-700">
          Site: {site ? <a href={site} target="_blank" rel="noopener noreferrer nofollow" className="text-emerald-700 underline">{site}</a> : preview.site}
        </p>
      </div>
      <form action={answerAttestation} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" name="choice" value="yes" className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-medium text-white hover:bg-emerald-700">
            Yes, they built this for me
          </button>
          <button type="submit" name="choice" value="no" className="rounded-lg bg-white px-5 py-3 text-sm font-medium text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50">
            No
          </button>
        </div>
        <p className="text-xs text-slate-500">No account needed. We use your answer only to verify this project; we don&apos;t keep your contact details.</p>
      </form>
    </Card>
  );
}
