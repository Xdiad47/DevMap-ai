"use server";

import { redirect } from "next/navigation";
import { isClientAnswer } from "@/lib/attestation/service";
import { createPublicClient } from "@/lib/supabase/public";

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/** The client's button press. State changes ONLY here (a POST), never on opening the link, so mail scanners can't confirm anything. */
export async function answerAttestation(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const yes = fd.get("choice") === "yes";
  let result = "invalid";
  if (TOKEN.test(token)) {
    const { data, error } = await createPublicClient().rpc("respond_client_attestation", { p_token: token, p_confirm: yes });
    if (error) throw new Error(`respond_client_attestation failed: ${error.message}`);
    if (isClientAnswer(data)) result = data;
  }
  redirect(`/verify/attestation/done?r=${result}`);
}
