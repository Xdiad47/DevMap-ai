import { cn } from "@/components/ui/cn";

const PALETTE = ["#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ef4444", "#14b8a6", "#6366f1", "#ec4899"];
const colorFor = (id: string) => PALETTE[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

/**
 * Privacy-by-design avatar (PRD §3.3). We never show a real photo, and never a GitHub/LinkedIn picture (that
 * would allow reverse-image search to find the person). Before unlock the circle is a blurred gradient: it
 * hints "there is a person here" without identifying anyone. Initials come from the already-masked name.
 */
export function Avatar({ id, maskedName, locked, size = 48 }: { id: string; maskedName: string; locked: boolean; size?: number }) {
  const initials = maskedName
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}]/gu, "")[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const c = colorFor(id);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <div
        className={cn("flex size-full items-center justify-center rounded-full font-semibold text-white", locked && "blur-[3px]")}
        style={{ background: `linear-gradient(135deg, ${c}, ${c}99)`, fontSize: size * 0.36 }}
      >
        {initials}
      </div>
      {locked && (
        <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-white text-[10px] shadow ring-1 ring-slate-200">🔒</span>
      )}
    </div>
  );
}
