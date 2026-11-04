import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { Card } from "@/components/ui/card";
import { sanitizeNext } from "@/lib/auth/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = sanitizeNext(typeof params.next === "string" ? params.next : undefined);
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <Card className="mx-auto w-full max-w-md space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Sign in to DevMap</h1>
        <p className="mt-1 text-sm text-slate-600">
          Developers: sign in with GitHub so we can score your real work. Designers, marketers and recruiters: use your email.
        </p>
      </div>
      <LoginForm next={next} initialError={error} />
    </Card>
  );
}
