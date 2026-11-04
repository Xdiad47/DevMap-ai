"use client";

import dynamic from "next/dynamic";

// WebGL needs a browser, so the globe is never rendered on the server. The placeholder keeps the layout from jumping.
const HeroGlobe = dynamic(() => import("./HeroGlobe"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto flex aspect-square w-full max-w-[640px] items-center justify-center">
      <div className="size-[72%] animate-pulse rounded-full bg-gradient-to-br from-indigo-500/40 via-violet-500/30 to-fuchsia-500/30 blur-sm" />
    </div>
  ),
});

export function GlobeLoader() {
  return <HeroGlobe />;
}
