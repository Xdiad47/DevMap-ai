"use server";

import { revalidatePath } from "next/cache";
import { enforceTalent } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export type OnlineState = { error?: string } | undefined;

/**
 * Go Online / Offline. Runs as the signed-in talent, so Row Level Security and the column grants decide what is allowed.
 * The database stamps `online_since` and switches the flag off again by itself after the expiry window, so "Online" stays true.
 */
export async function setOnline(_prev: OnlineState, fd: FormData): Promise<OnlineState> {
  const { talent } = await enforceTalent("/dashboard/talent");
  const wantOnline = fd.get("online") === "1";
  if (wantOnline && !talent.is_listed) return { error: "You can go Online once you appear on the map." };

  const sb = await createClient();
  const { error } = await sb.from("talent_public").update({ is_online: wantOnline }).eq("id", talent.id);
  if (error) {
    console.error("[online] update failed:", error.message);
    return { error: "Couldn't change your status. Please try again." };
  }
  revalidatePath("/dashboard/talent");
  revalidatePath("/explore");
  return undefined;
}
