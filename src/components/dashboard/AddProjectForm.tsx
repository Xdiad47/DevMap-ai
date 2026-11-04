"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { friendlyMessage } from "@/lib/errors";
import { addProject, type AddedProject } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/client";

/** Same shape the database enforces: https only, no port, no credentials. */
const LIVE_URL = /^https:\/\/[^/\s:@]+(\/\S*)?$/;

export function AddProjectForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<AddedProject | null>(null);

  async function submit() {
    setError(null);
    if (title.trim().length < 3) return setError("Give the project a short generic name, e.g. “Logistics Android app”.");
    if (!LIVE_URL.test(url.trim())) return setError("Use the full live address starting with https:// (no port number).");
    setBusy(true);
    try {
      const res = await addProject(createClient(), title.trim(), url.trim());
      setAdded(res);
      setTitle("");
      setUrl("");
      router.refresh();
    } catch (e) {
      setError(friendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project name" htmlFor="pname" hint="Generic on purpose, shown publicly (no client brand names).">
          <TextInput id="pname" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="B2B logistics mobile app" />
        </Field>
        <Field label="Live URL" htmlFor="purl" hint="Hidden until a recruiter unlocks you.">
          <TextInput id="purl" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://my-app.example.in" />
        </Field>
      </div>
      <Button onClick={submit} loading={busy}>
        Add project
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
      {added && (
        <Alert tone="info">
          <p className="font-medium">Prove it&apos;s yours.</p>
          <p className="mt-1">
            Create a file at <code className="rounded bg-white/70 px-1">{added.verify_file_path}</code> on that site containing:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-white/70 p-2 text-xs">{added.verify_file_content}</pre>
          <p className="mt-2 text-xs">Our checker verifies it automatically. You can also add a client confirmation later.</p>
        </Alert>
      )}
    </div>
  );
}
