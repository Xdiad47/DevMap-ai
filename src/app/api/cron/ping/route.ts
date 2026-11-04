import { type NextRequest } from "next/server";
import { json } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCronAuth } from "@/lib/workers/auth";
import { createGithubApi } from "@/lib/workers/github";
import { databasePingStore, runPings } from "@/lib/workers/ping";
import { databaseVerifyStore, runVerification } from "@/lib/workers/verify";

export const maxDuration = 60;

// Node runtime on purpose (the default for route handlers): the SSRF guard needs socket-level control (`node:https`
// with a pinned `lookup`), which the Edge runtime does not offer.

/** Run every ~10 minutes: first check ownership proofs for new projects, then ping what is due (each site ~4x/day, at random). */
async function run(request: NextRequest) {
  if (!verifyCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET)) return json({ error: "unauthorized" }, 401);
  try {
    const admin = createAdminClient();
    const verification = await runVerification(databaseVerifyStore(admin), createGithubApi(process.env.GITHUB_TOKEN));
    const pings = await runPings(databasePingStore(admin));
    return json({ verification, pings });
  } catch (e) {
    console.error("[cron:ping]", e);
    return json({ error: "ping_failed" }, 500);
  }
}
export { run as GET, run as POST };
