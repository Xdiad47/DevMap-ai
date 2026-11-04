import { redirect } from "next/navigation";
import { enforce } from "@/lib/auth/viewer";
import { homeFor } from "@/lib/routing";

/** /dashboard is a signpost: send each user to the right home. */
export default async function DashboardIndex() {
  const viewer = await enforce("/dashboard"); // enforce() already redirects via guard(); this is the fallback
  redirect(homeFor({ talent: !!viewer.talent, recruiter: !!viewer.recruiter }));
}
