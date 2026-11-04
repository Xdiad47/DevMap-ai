import Link from "next/link";
import { Card } from "@/components/ui/card";
import { enforce } from "@/lib/auth/viewer";

export default async function ChooseRolePage() {
  await enforce("/onboard");
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">How will you use DevMap?</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/onboard/talent" className="block">
          <Card className="h-full transition-colors hover:border-emerald-500">
            <h2 className="font-semibold">I offer my skills</h2>
            <p className="mt-1 text-sm text-slate-600">Developer, designer or marketer. Free to list.</p>
          </Card>
        </Link>
        <Link href="/onboard/recruiter" className="block">
          <Card className="h-full transition-colors hover:border-emerald-500">
            <h2 className="font-semibold">I&apos;m hiring</h2>
            <p className="mt-1 text-sm text-slate-600">Find local, verified talent. First preview free.</p>
          </Card>
        </Link>
      </div>
    </div>
  );
}
