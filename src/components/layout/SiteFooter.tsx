import Link from "next/link";
import { getCompany } from "@/lib/company";

const LINKS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refunds", label: "Refunds & Cancellation" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact" },
];

/** Legal links on every page (payment providers also require them to be easy to find). */
export function SiteFooter() {
  const c = getCompany();
  return (
    <footer className="mt-12 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-slate-300">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="text-lg font-bold text-white">
            Dev<span className="text-emerald-400">Map</span>.in
          </p>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
            Verified local developers, designers and digital marketers, ranked on real, live work. Zero commission. Open across India.
          </p>
          <p className="mt-3 text-sm">
            Questions? <a href={`mailto:${c.supportEmail}`} className="font-medium text-emerald-300 hover:underline">{c.supportEmail}</a>
          </p>
        </div>
        <nav aria-label="Legal" className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-1">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-slate-300 hover:text-white hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-t border-white/10 px-4 py-4 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} {c.legalName ?? c.brand}. All prices include GST. Made in India.
      </div>
    </footer>
  );
}
