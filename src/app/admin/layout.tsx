import Link from "next/link";

/** Chrome only. Access is enforced by requireAdmin() in EVERY page/action/route (a layout is not re-run on client navigation). */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-4 border-b border-slate-200 pb-3 text-sm">
        <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">Admin</span>
        <Link href="/admin/review-queue" className="font-medium text-slate-700 hover:text-slate-900">Review queues</Link>
      </nav>
      {children}
    </div>
  );
}
