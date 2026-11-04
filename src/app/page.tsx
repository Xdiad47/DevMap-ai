import Link from "next/link";
import { GlobeLoader } from "@/components/landing/GlobeLoader";

const STEPS = [
  { n: "1", title: "Talent proves it", body: "Real GitHub activity, live projects that stay online, and reviewed portfolios. Rank is earned, never bought.", tint: "from-indigo-500 to-violet-500" },
  { n: "2", title: "You find your match", body: "Filter by role, city and language on a live map. See who is online right now. Names stay hidden until you unlock.", tint: "from-fuchsia-500 to-pink-500" },
  { n: "3", title: "Talk on WhatsApp", body: "Unlock a contact with credits and speak directly. No chat inside DevMap, no commission on your project.", tint: "from-emerald-500 to-teal-500" },
];

const PROMISES = [
  { label: "Zero commission", note: "Pay for the introduction, keep the whole project" },
  { label: "Proof over claims", note: "Ranked on live, verified work" },
  { label: "In your language", note: "Hindi, Tamil, Bengali, Marathi and all 22 scheduled languages" },
  { label: "Across India", note: "Bengaluru to Bhubaneswar, Surat to Silchar. Local trust, remote work" },
];

export default function Home() {
  return (
    <div className="-mt-8 space-y-16">
      {/* Full-bleed hero: dark, with an aurora of colour behind a slowly swaying globe */}
      <section className="relative left-1/2 w-screen -translate-x-1/2 overflow-hidden bg-[#0b1020] text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 size-[28rem] rounded-full bg-violet-600/40 blur-[110px]" />
          <div className="absolute right-[-6rem] top-10 size-[30rem] rounded-full bg-fuchsia-500/25 blur-[120px]" />
          <div className="absolute bottom-[-8rem] left-1/3 size-[26rem] rounded-full bg-cyan-400/20 blur-[120px]" />
          <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]" />
        </div>

        <div className="relative mx-auto grid max-w-5xl items-center gap-6 px-4 py-12 sm:py-16 lg:grid-cols-[0.95fr_1.05fr] lg:py-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-medium text-indigo-100 ring-1 ring-white/20 backdrop-blur">
              <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_10px_3px_rgba(52,211,153,.7)]" /> Open across India
            </p>
            <h1 className="font-display mt-5 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              Hire verified local talent,{" "}
              <span className="bg-gradient-to-r from-emerald-300 via-cyan-300 to-fuchsia-300 bg-clip-text text-transparent">free right now.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-indigo-100/90">
              Developers, designers and marketers ranked on real, live work, who speak your language. Unlock a contact, talk on WhatsApp, keep every rupee of your project.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login?next=/onboard/recruiter" className="rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-6 py-3.5 text-sm font-bold text-slate-900 shadow-lg shadow-emerald-500/25 transition hover:brightness-110">
                Find talent: first preview free
              </Link>
              <Link href="/login?next=/onboard/talent" className="rounded-xl bg-white/10 px-6 py-3.5 text-sm font-semibold text-white ring-1 ring-white/30 backdrop-blur transition hover:bg-white/20">
                Join as talent
              </Link>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 text-center">
              {[["0%", "commission"], ["3", "kinds of talent"], ["8h", "auto-offline, so “online” is true"]].map(([v, l]) => (
                <div key={l} className="rounded-2xl bg-white/5 px-3 py-3 ring-1 ring-white/10">
                  <dt className="font-display text-2xl font-bold text-white">{v}</dt>
                  <dd className="mt-0.5 text-[11px] leading-4 text-indigo-200/80">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <GlobeLoader />
        </div>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="font-display text-center text-3xl font-bold tracking-tight text-slate-900">How it works</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="relative overflow-hidden rounded-3xl border border-white bg-white p-6 shadow-[0_10px_40px_-12px_rgba(79,70,229,.25)]">
              <span className={`flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br ${s.tint} text-lg font-bold text-white shadow-lg`}>{s.n}</span>
              <h3 className="font-display mt-4 text-xl font-bold text-slate-900">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-7 text-slate-600">{s.body}</p>
              <div aria-hidden className={`absolute -bottom-10 -right-10 size-32 rounded-full bg-gradient-to-br ${s.tint} opacity-10 blur-xl`} />
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-8 text-white shadow-xl shadow-indigo-500/20">
          <h2 className="font-display text-2xl font-bold">I&apos;m a developer, designer or marketer</h2>
          <p className="mt-2 leading-7 text-indigo-50/90">List yourself for free. Your rank comes from shipped, live work, not from who bids lowest. Get an email the moment a recruiter unlocks you.</p>
          <Link href="/login?next=/onboard/talent" className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-bold text-indigo-700 transition hover:bg-indigo-50">Join as talent →</Link>
        </div>
        <div className="rounded-3xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 p-8 text-white shadow-xl shadow-emerald-500/20">
          <h2 className="font-display text-2xl font-bold">I&apos;m hiring</h2>
          <p className="mt-2 leading-7 text-emerald-50/95">Founders, agencies and local businesses: find someone nearby who is available today. Your first preview is free; credits start at ₹99.</p>
          <Link href="/login?next=/onboard/recruiter" className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-bold text-teal-700 transition hover:bg-emerald-50">Find talent →</Link>
        </div>
      </section>

      <section aria-label="Our promises" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PROMISES.map((p, i) => (
          <div key={p.label} className="rounded-2xl border border-indigo-100 bg-white/70 p-5 backdrop-blur">
            <span className={`mb-3 block h-1.5 w-10 rounded-full bg-gradient-to-r ${["from-indigo-500 to-violet-500", "from-fuchsia-500 to-pink-500", "from-amber-400 to-orange-500", "from-emerald-500 to-teal-500"][i]}`} />
            <p className="font-display font-bold text-slate-900">{p.label}</p>
            <p className="mt-1 text-sm text-slate-600">{p.note}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
