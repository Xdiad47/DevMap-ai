import type { ReactNode } from "react";
import { getCompany } from "@/lib/company";
import { POLICY_VERSION } from "@/lib/constants";

export type LegalSection = { id: string; title: string; body: ReactNode };

/**
 * Shared design for the legal pages: a colourful header, a table of contents that follows you down the page (large
 * screens), and readable body text. The `Prose` rules below style the plain <p>/<ul>/<table> inside each section.
 */
export function LegalPage({ title, summary, sections, accent = "from-emerald-500 to-indigo-600", showVersion = false }: { title: string; summary: string; sections: LegalSection[]; accent?: string; showVersion?: boolean }) {
  const c = getCompany();
  return (
    <div className="mx-auto max-w-4xl">
      <header className={`rounded-3xl bg-gradient-to-r ${accent} p-7 text-white shadow-lg sm:p-9`}>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-white/90">{summary}</p>
        <p className="mt-4 text-xs text-white/75">
          Last updated {c.updated}
          {showVersion ? ` · policy version ${POLICY_VERSION}` : ""}
        </p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ol className="sticky top-6 space-y-1 border-l-2 border-slate-200 text-sm">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="-ml-0.5 block border-l-2 border-transparent py-1 pl-3 text-slate-600 hover:border-indigo-500 hover:text-indigo-700">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="space-y-6">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 flex items-center gap-3 text-xl font-semibold text-slate-900">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">{i + 1}</span>
                {s.title}
              </h2>
              <div className="space-y-3 text-[15px] leading-7 text-slate-700 [&_a]:font-medium [&_a]:text-indigo-700 [&_a]:underline [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_strong]:text-slate-900 [&_table]:w-full [&_table]:text-sm [&_td]:border-b [&_td]:border-slate-100 [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top [&_th]:border-b-2 [&_th]:border-slate-200 [&_th]:py-2 [&_th]:pr-3 [&_th]:text-left [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A highlighted plain-language summary box used inside sections. */
export function Plain({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900 ring-1 ring-emerald-200">{children}</div>;
}
