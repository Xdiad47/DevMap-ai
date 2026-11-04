import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/access";

export default async function AdminIndex() {
  await requireAdmin("/admin");
  redirect("/admin/review-queue");
}
