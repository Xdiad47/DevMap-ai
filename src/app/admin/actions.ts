"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/access";
import { attestationDecision, banDecision, ghostDecision, portfolioDecision, talentDecision, type Outcome } from "@/lib/admin/decisions";

/**
 * Every admin action: (1) requireAdmin() again (a layout check is not a lock), (2) hand the form to the decision function
 * (validate + call the database AS THE ADMIN'S OWN SESSION so the audit trail names a person), (3) redirect back to the queue.
 * The database re-checks the admin claim inside each function; these checks are the first of two locks.
 */
export type FormState = { error?: string } | undefined;

const fields = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string"));

function finish(o: Outcome): FormState {
  if ("error" in o) return { error: o.error };
  if (o.talentId) {
    revalidatePath(`/admin/talent/${o.talentId}`);
    redirect(`/admin/talent/${o.talentId}?done=1`);
  }
  revalidatePath("/admin/review-queue");
  redirect(`/admin/review-queue?group=${o.group}&done=1`);
}

export async function reviewPortfolio(_prev: FormState, fd: FormData): Promise<FormState> {
  const { sb, db } = await requireAdmin();
  return finish(await portfolioDecision(sb, db, fields(fd)));
}
export async function resolveGhost(_prev: FormState, fd: FormData): Promise<FormState> {
  const { sb } = await requireAdmin();
  return finish(await ghostDecision(sb, fields(fd)));
}
/** Strike-3 review (with a queue item). */
export async function decideBan(_prev: FormState, fd: FormData): Promise<FormState> {
  const { sb } = await requireAdmin();
  return finish(await banDecision(sb, fields(fd)));
}
export async function reviewAttestation(_prev: FormState, fd: FormData): Promise<FormState> {
  const { sb } = await requireAdmin();
  return finish(await attestationDecision(sb, fields(fd)));
}
/** From /admin/talent/[id] (e.g. an appeal that arrived by e-mail): no queue item involved. */
export async function decideTalent(_prev: FormState, fd: FormData): Promise<FormState> {
  const { sb } = await requireAdmin();
  return finish(await talentDecision(sb, fields(fd)));
}
