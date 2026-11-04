import Link from "next/link";
import { isAdminUser } from "@/lib/admin/guard";
import { getUser } from "@/lib/auth/viewer";

export async function SiteHeader() {
  const user = await getUser();
  return (
    <header className="sticky top-0 z-40 border-b border-indigo-100/80 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-display text-xl font-extrabold tracking-tight text-slate-900">
          Dev<span className="bg-gradient-to-r from-emerald-500 to-indigo-600 bg-clip-text text-transparent">Map</span>.in
        </Link>
        {user ? (
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-slate-500 sm:inline">{user.email ?? user.phone}</span>
            <Link href="/dashboard" className="font-medium text-slate-700 hover:text-slate-900">
              Dashboard
            </Link>
            {isAdminUser(user) && (
              <Link href="/admin/review-queue" className="font-medium text-slate-700 hover:text-slate-900">
                Admin
              </Link>
            )}
            <form action="/auth/signout" method="post">
              <button type="submit" className="rounded-lg px-3 py-1.5 text-slate-700 hover:bg-slate-100">
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <Link href="/login" className="rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:brightness-110">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
