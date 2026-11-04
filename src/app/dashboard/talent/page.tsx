import type { Metadata } from "next";
import Link from "next/link";
import { AddProjectForm } from "@/components/dashboard/AddProjectForm";
import { AttestationRequest, type AttestationRow } from "@/components/dashboard/AttestationRequest";
import { ChecklistItem } from "@/components/dashboard/ChecklistItem";
import { OnlineToggle } from "@/components/dashboard/OnlineToggle";
import { Alert, Card } from "@/components/ui/card";
import { enforceTalent } from "@/lib/auth/viewer";
import { PROJECT_COLUMNS } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your dashboard" };

type ProjectRow = {
  id: string;
  generic_title: string;
  is_ownership_verified: boolean;
  verification_method: string;
  verification_token: string;
};

export default async function TalentDashboard() {
  const { talent } = await enforceTalent("/dashboard/talent");

  const supabase = await createClient();
  const [{ data, error }, attRes] = await Promise.all([
    supabase.from("projects").select(PROJECT_COLUMNS).order("created_at"),
    supabase.from("client_attestations").select("id, project_id, channel, contact_masked, status, expires_at, created_at").order("created_at", { ascending: false }),
  ]);
  if (error) throw new Error(`could not load projects: ${error.message}`);
  if (attRes.error) throw new Error(`could not load attestations: ${attRes.error.message}`);
  const projects = (data ?? []) as ProjectRow[];
  const attestations = (attRes.data ?? []) as AttestationRow[];
  const verifiedCount = projects.filter((p) => p.is_ownership_verified).length;

  const projectsDone = projects.length > 0;

  // Why isn't this profile on the map yet? Mirrors the database's listing gate exactly:
  //   is_listed = (proof_score > 0 OR review_status = 'reviewed')
  const blockers: string[] = [];
  if (talent.proof_score === 0 && talent.review_status === "unverified") {
    blockers.push(
      talent.role === "developer"
        ? "Waiting for your first GitHub activity score. This runs automatically; add a live project to speed it up."
        : "Waiting for our team to review your portfolio (usually within 48 hours).",
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {talent.masked_name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Recruiters will see you as <strong>{talent.masked_name}</strong> in {talent.city}, {talent.state}.
        </p>
      </div>

      <Card>
        <h2 className="text-lg font-semibold">Get on the map</h2>
        <ul className="mt-2 divide-y divide-slate-100">
          <ChecklistItem done title="Profile created" detail="Your details are saved and your consents are on record." />

          <ChecklistItem
            done={projectsDone}
            title="Projects added"
            detail={
              projectsDone
                ? `${projects.length} added, ${verifiedCount} verified. Verified live projects raise your rank.`
                : "Add a live project you built. It's what recruiters (and your rank) are based on."
            }
          />
        </ul>

        {projects.length > 0 && (
          <ul className="mt-2 space-y-2 border-t border-slate-100 pt-4">
            {projects.map((p) => (
              <li key={p.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{p.generic_title}</span>
                  <span className={p.is_ownership_verified ? "text-emerald-700" : "text-amber-700"}>
                    {p.is_ownership_verified ? "Verified" : "Not verified yet"}
                  </span>
                </div>
                {!p.is_ownership_verified && (
                  <>
                    <p className="mt-1 text-xs text-slate-500">
                      Put <code>devmap-verify={p.verification_token}</code> in a file at <code>/devmap-verify.txt</code> on your site. We check automatically every few minutes.
                    </p>
                    <AttestationRequest projectId={p.id} requests={attestations.filter((a) => a.project_id === p.id)} />
                  </>
                )}
                {p.is_ownership_verified && p.verification_method === "client_attestation" && (
                  <p className="mt-1 text-xs text-slate-500">Confirmed by your client. Verify the site yourself with <code>devmap-verify.txt</code> to earn full points.</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {projects.length < 5 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="mb-3 text-sm font-semibold">Add a project</h3>
            <AddProjectForm />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Availability</h2>
        <p className="mt-1 text-sm text-slate-600">
          Recruiters pay to unlock your WhatsApp number, and we <strong>email you</strong> each time it happens. Tap Online when you can reply quickly.
        </p>
        <div className="mt-4">
          <OnlineToggle online={talent.is_online} canGoOnline={talent.is_listed} expiryHours={8} />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Listing status</h2>
        {talent.is_listed ? (
          <Alert tone="success" className="mt-3">
            <p className="font-medium">You&apos;re on the map ✓</p>
            <p className="mt-1">
              Proof score {talent.proof_score}/100
              {talent.state_rank ? ` · #${talent.state_rank} of ${talent.state_cohort_size} ${talent.role}s in ${talent.state}` : " · rank appears after the next daily update"}
            </p>
          </Alert>
        ) : (
          <div className="mt-3 space-y-3">
            <Alert tone="warn">
              <p className="font-medium">Not visible to recruiters yet.</p>
              <ul className="mt-1 list-inside list-disc">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Alert>
            <p className="text-xs text-slate-500">
              The rule: you need a score above zero (a live, verified project or GitHub activity) or a reviewed portfolio.
            </p>
          </div>
        )}
        <dl className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
          <Stat label="Proof" value={talent.proof_score} />
          <Stat label="Responsiveness" value={talent.response_velocity_score} />
          <Stat label="Overall" value={Number(talent.composite_rank_score).toFixed(1)} />
        </dl>
      </Card>

      <p className="text-center text-sm text-slate-500">
        Also hiring?{" "}
        <Link href="/onboard/recruiter" className="font-medium text-emerald-700 underline">
          Set up a recruiter account
        </Link>
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold">{value}</dd>
    </div>
  );
}
