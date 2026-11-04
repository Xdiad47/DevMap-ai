"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { friendlyMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";

/**
 * Two ways in:
 *   GitHub  – developers (the profile function REQUIRES a GitHub identity for the developer role)
 *   Email   – designers, marketers and recruiters: we send a link AND a 6-digit code; use whichever is handier
 * OAuth scopes are left at Supabase's defaults for GitHub (read your public profile + email):
 * no repository access is requested.
 */
export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState<null | "github" | "email" | "code">(null);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const callback = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function oauth(provider: "github") {
    setBusy(provider);
    setError(null);
    const { error } = await createClient().auth.signInWithOAuth({ provider, options: { redirectTo: callback() } });
    if (error) {
      setError(friendlyMessage(error));
      setBusy(null);
    } // on success the browser is already navigating to the provider
  }

  async function sendEmail() {
    setBusy("email");
    setError(null);
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callback(), shouldCreateUser: true },
    });
    setBusy(null);
    if (error) return setError(friendlyMessage(error));
    setStage("code");
  }

  async function verifyEmailCode() {
    setBusy("code");
    setError(null);
    const { error } = await createClient().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) {
      setBusy(null);
      return setError(friendlyMessage(error));
    }
    router.replace(next);
    router.refresh(); // re-run server components now that the session cookie exists
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3">
        <Button variant="secondary" onClick={() => oauth("github")} loading={busy === "github"} disabled={!!busy}>
          Continue with GitHub <span className="text-xs font-normal text-slate-500">(required for developers)</span>
        </Button>
      </div>

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" /> designers, marketers and recruiters: use email <span className="h-px flex-1 bg-slate-200" />
      </div>

      {stage === "email" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void sendEmail();
          }}
        >
          <Field label="Email address" htmlFor="email">
            <TextInput
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={busy === "email"} disabled={!!busy || !email.includes("@")} className="w-full">
            Email me a sign-in link and code
          </Button>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verifyEmailCode();
          }}
        >
          <Alert tone="info">
            We emailed <strong>{email}</strong>. Click the link in it, or type the 6-digit code here.
          </Alert>
          <Field label="6-digit code" htmlFor="code">
            <TextInput
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <div className="flex gap-3">
            <Button type="submit" loading={busy === "code"} disabled={!!busy || code.length !== 6}>
              Sign in
            </Button>
            <Button variant="ghost" onClick={() => setStage("email")} disabled={!!busy}>
              Use a different email
            </Button>
          </div>
        </form>
      )}

      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
