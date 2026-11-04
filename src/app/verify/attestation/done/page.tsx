import type { Metadata } from "next";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Thank you", robots: { index: false, follow: false } };

const COPY: Record<string, { title: string; body: string }> = {
  confirmed: { title: "Thank you, that's confirmed ✓", body: "The project is now marked as verified on their profile." },
  declined: { title: "Thanks for letting us know", body: "We've recorded that you didn't work with them. Nothing is verified." },
  limit_reached: { title: "We can't accept this one", body: "To prevent abuse, one client can confirm at most 2 projects in 30 days, and you've reached that limit. Nothing was verified." },
  invalid: { title: "This link has expired or was already used", body: "If you still want to confirm, ask them to send a new request." },
};

export default async function Done({ searchParams }: PageProps<"/verify/attestation/done">) {
  const { r } = await searchParams;
  const c = COPY[typeof r === "string" ? r : ""] ?? COPY.invalid;
  return (
    <Card className="mx-auto max-w-lg space-y-2">
      <h1 className="text-xl font-semibold">{c.title}</h1>
      <p className="text-sm text-slate-600">{c.body}</p>
    </Card>
  );
}
