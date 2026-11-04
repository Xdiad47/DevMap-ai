import type { Role } from "@/lib/constants";

/**
 * One colour per kind of talent, used by the map pins, the legend, the cards and the filters so the eye can connect them.
 * Full class names are written out on purpose: Tailwind only generates classes it can see in the source.
 */
export const ROLE_STYLE: Record<Role, { label: string; hex: string; chip: string; bar: string; active: string; soft: string }> = {
  developer: { label: "Developers", hex: "#6366f1", chip: "bg-indigo-100 text-indigo-800", bar: "border-l-indigo-500", active: "bg-indigo-600 text-white ring-indigo-600", soft: "from-indigo-50" },
  designer: { label: "Designers", hex: "#ec4899", chip: "bg-pink-100 text-pink-800", bar: "border-l-pink-500", active: "bg-pink-600 text-white ring-pink-600", soft: "from-pink-50" },
  marketer: { label: "Marketers", hex: "#f59e0b", chip: "bg-amber-100 text-amber-800", bar: "border-l-amber-500", active: "bg-amber-500 text-white ring-amber-500", soft: "from-amber-50" },
};
