import { type NextRequest } from "next/server";
import { json } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCronAuth } from "@/lib/workers/auth";
import { createGithubApi, databaseGithubStore, runGithubScoring } from "@/lib/workers/github";

export const maxDuration = 60;

/**
 * Run every ~15 minutes. Each run scores the few developers who are due (oldest score first, ~daily per person),
 * which keeps GitHub API use inside its hourly limit. Set GITHUB_TOKEN (a classic PAT with NO scopes is enough:
 * public data only) to raise the limit from 60 to 5,000 requests/hour.
 */
async function run(request: NextRequest) {
  if (!verifyCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET)) return json({ error: "unauthorized" }, 401);
  try {
    const summary = await runGithubScoring(databaseGithubStore(createAdminClient()), createGithubApi(process.env.GITHUB_TOKEN));
    return json(summary);
  } catch (e) {
    console.error("[cron:github-score]", e);
    return json({ error: "github_score_failed" }, 500);
  }
}
export { run as GET, run as POST };
