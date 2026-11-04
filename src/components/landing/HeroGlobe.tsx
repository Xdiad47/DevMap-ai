"use client";

import createGlobe, { type Marker } from "cobe";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { ARC_TARGETS, DEMO_PEOPLE, HUB, INDIA_FIT, INDIA_VIEW, type DemoPerson } from "@/lib/landing/demo";
import { damp, dampAngle, indiaFit, nearest, phiFor, project, swing, thetaFor, type LatLng } from "@/lib/landing/globe-math";
import { askForLocation, browserTimeZone, greetingFor } from "@/lib/landing/locate";
import { ROLE_STYLE } from "@/lib/role-style";

/** cobe wants colours as 0..1 triples. */
const RGB: Record<DemoPerson["role"], [number, number, number]> = {
  developer: [0.39, 0.4, 0.95],
  designer: [0.93, 0.28, 0.6],
  marketer: [0.96, 0.62, 0.04],
};
const ELEVATION = 0.02;
const BASE_SCALE = 1.22; // 1.25 is the most that still shows the whole round globe inside the canvas
const FOCUS_SCALE = 1.7;

type Near = { people: (DemoPerson & { km: number })[] } | { note: string } | null;

/**
 * The landing-page globe.
 *  - Idle: it sways slowly back and forth around India (never a full turn) while the people on it pulse; every few seconds a
 *    sample person is picked out with a name tag.
 *  - Hover (or tap): the camera glides to a random person, zooms in, and shows who they are; then moves on to the next.
 *  - "Near me" asks the browser for a location ONLY when tapped; the position never leaves the page.
 * Everything on it is a SAMPLE profile and the caption says so.
 */
export default function HeroGlobe() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const rings = useRef(new Map<string, HTMLSpanElement>());
  const you = useRef<HTMLSpanElement>(null);
  const live = useRef({ hover: false, spot: null as DemoPerson | null, spotSince: 0, home: { ...INDIA_VIEW }, px: 0.5, py: 0.5, focusFromHover: false, zoom: false, you: null as LatLng | null });
  const api = useRef<{ enterZoom: () => void; exitZoom: () => void } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [spot, setSpot] = useState<DemoPerson | null>(null);
  const [near, setNear] = useState<Near>(null);
  // This component only ever renders in the browser (see GlobeLoader), so reading the time zone here is safe.
  const [greeting] = useState(() => greetingFor(browserTimeZone()));
  const [locating, setLocating] = useState(false);

  const people = DEMO_PEOPLE;
  const online = useMemo(() => people.filter((p) => p.online), [people]);

  // Zoomed in on India the same world-size pins would be huge, so they shrink; the visitor's own spot gets a bright marker.
  const markersFor = useCallback((spotId: string | null, zoom: boolean, me: LatLng | null): Marker[] => {
    const k = zoom ? 0.3 : 1;
    const out: Marker[] = people.map((p) => ({
      location: p.at,
      id: p.id,
      size: (p.id === spotId ? 0.13 : p.online ? 0.065 : 0.055) * k,
      color: RGB[p.role],
    }));
    if (zoom && me) out.push({ location: me, id: "you", size: 0.09 * k, color: [0.3, 1, 0.95] });
    return out;
  }, [people]);

  useEffect(() => {
    const cv = canvas.current, box = wrap.current;
    if (!cv || !box) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const small = box.clientWidth < 420;
    // Where the globe rests: India as a whole, whoever is looking.
    live.current.home = { ...INDIA_VIEW };

    let phi = phiFor(live.current.home.lng) + (reduce ? 0 : 1.9);
    let theta = thetaFor(live.current.home.lat);
    let scale = BASE_SCALE;

    const globe = createGlobe(cv, {
      devicePixelRatio: dpr, width: 900, height: 900, phi, theta, scale,
      dark: 1, diffuse: 1.25, mapSamples: small ? 8000 : 13000, mapBrightness: 11, mapBaseBrightness: 0.06,
      baseColor: [0.2, 0.17, 0.58], markerColor: [1, 0.5, 0.8], glowColor: [0.42, 0.3, 0.95],
      markers: markersFor(null, false, null), markerElevation: ELEVATION,
      arcs: ARC_TARGETS.map((to) => ({ from: HUB, to })), arcColor: [0.25, 0.9, 0.8], arcWidth: 0.45, arcHeight: 0.28,
    });

    let size = box.clientWidth;
    const ro = new ResizeObserver(() => { size = box.clientWidth; });
    ro.observe(box);

    let raf = 0, last = performance.now();
    const t0 = last;
    let running = true;
    let nextAuto = t0 + 2500;
    let lastSpotId: string | null = null;

    // Point at a random person, never the same one twice in a row.
    const choose = (pool: DemoPerson[]) => {
      const options = pool.filter((p) => p.id !== lastSpotId);
      return options[Math.floor(Math.random() * options.length)] ?? pool[0];
    };
    const setSpotlight = (p: DemoPerson | null, now: number, fromHover: boolean) => {
      live.current.spot = p;
      live.current.spotSince = now;
      live.current.focusFromHover = fromHover;
      lastSpotId = p?.id ?? lastSpotId;
      setSpot(p);
      globe.update({ markers: markersFor(p?.id ?? null, live.current.zoom, live.current.you) });
    };
    (live.current as { choose?: typeof choose; setSpotlight?: typeof setSpotlight }).choose = choose;
    (live.current as { setSpotlight?: typeof setSpotlight }).setSpotlight = setSpotlight;

    // Allow-location: glide in until only India fills the round window, with more land dots so the country stays legible.
    api.current = {
      enterZoom: () => {
        live.current.zoom = true;
        setSpotlight(null, performance.now(), false);
        globe.update({ mapSamples: 70000, mapBrightness: 5.5, mapBaseBrightness: 0.03, markers: markersFor(null, true, live.current.you) });
        nextAuto = performance.now() + 1800;
      },
      exitZoom: () => {
        live.current.zoom = false;
        live.current.you = null;
        setSpotlight(null, performance.now(), false);
        globe.update({ mapSamples: small ? 8000 : 13000, mapBrightness: 11, mapBaseBrightness: 0.06, markers: markersFor(null, false, null) });
      },
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.2); // cap only guards against a long pause (tab switch)
      last = now;
      const t = (now - t0) / 1000;
      const L = live.current;

      // --- what is the camera aiming at?
      const sw = reduce ? { dPhi: 0, dTheta: 0 } : swing(t);
      let aimPhi = phiFor(L.home.lng) + sw.dPhi;
      let aimTheta = thetaFor(L.home.lat) + sw.dTheta;
      let aimScale = BASE_SCALE;
      let rate = 1.4;
      if (L.zoom) { // India only: steady, centred, barely swaying (no sweeps)
        aimPhi = phiFor(INDIA_FIT.lng) + 0.03 * Math.sin(t / 5);
        aimTheta = thetaFor(INDIA_FIT.lat);
        aimScale = INDIA_FIT.scale;
        rate = 1.7;
      } else if (L.spot && L.focusFromHover) {
        aimPhi = phiFor(L.spot.at[1]);
        aimTheta = Math.min(0.75, thetaFor(L.spot.at[0]) * 0.85);
        aimScale = FOCUS_SCALE;
        rate = 2.6;
      }
      if (L.hover) { // the globe leans toward the pointer a little (less when zoomed: the country should stay put)
        const lean = L.zoom ? 0.12 : 1;
        aimPhi += (L.px - 0.5) * 0.28 * lean;
        aimTheta += (L.py - 0.5) * 0.14 * lean;
      }
      phi = dampAngle(phi, aimPhi, rate, dt);
      theta = damp(theta, aimTheta, rate, dt);
      scale = damp(scale, aimScale, L.zoom || scale > 2 ? 1.5 : 2.2, dt);

      // --- who is highlighted?
      if (!reduce) {
        if (L.hover && !L.zoom) {
          if (!L.spot || !L.focusFromHover || now - L.spotSince > 3200) setSpotlight(choose(people), now, true);
        } else if (L.spot && L.focusFromHover) {
          setSpotlight(null, now, false); // pointer left: stop pointing, drift home
          nextAuto = now + 3500;
        } else if (L.spot && now - L.spotSince > 3000) {
          setSpotlight(null, now, false);
          nextAuto = now + 3200;
        } else if (!L.spot && now > nextAuto) {
          setSpotlight(choose(L.zoom ? people : online), now, false);
        }
      }

      globe.update({ phi, theta, scale });

      // --- our overlays follow the markers (same maths cobe uses)
      const h = size;
      for (const p of online) {
        const el = rings.current.get(p.id);
        if (!el) continue;
        const q = project(p.at, phi, theta, { elevation: ELEVATION, scale });
        el.style.transform = `translate3d(${q.x * h}px, ${q.y * h}px, 0)`;
        el.style.opacity = q.visible && q.x > 0.02 && q.x < 0.98 && q.y > 0.02 && q.y < 0.98 ? "1" : "0";
      }
      const yr = you.current;
      if (yr) {
        if (L.zoom && L.you) {
          const q = project(L.you, phi, theta, { elevation: ELEVATION, scale });
          yr.style.transform = `translate3d(${q.x * h}px, ${q.y * h}px, 0)`;
          yr.style.opacity = q.visible ? "1" : "0";
        } else yr.style.opacity = "0";
      }
      const sp = L.spot;
      const tg = tag.current;
      if (tg) {
        if (sp) {
          const q = project(sp.at, phi, theta, { elevation: ELEVATION, scale });
          const x = Math.min(Math.max(q.x * h, 12), h - 12), y = Math.min(Math.max(q.y * h, 12), h - 12);
          tg.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          tg.dataset.side = q.x > 0.58 ? "left" : "right";
          tg.style.opacity = q.visible ? "1" : "0";
        } else tg.style.opacity = "0";
      }
    };
    raf = requestAnimationFrame(frame);

    // Stop work when the tab or the globe isn't on screen.
    const io = new IntersectionObserver(([e]) => { running = e.isIntersecting && !document.hidden; last = performance.now(); }, { threshold: 0.05 });
    io.observe(box);
    const vis = () => { running = !document.hidden; last = performance.now(); };
    document.addEventListener("visibilitychange", vis);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", vis);
      globe.destroy();
    };
  }, [markersFor, online, people, greeting.inIndia]);

  const onMove = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    live.current.px = (e.clientX - r.left) / r.width;
    live.current.py = (e.clientY - r.top) / r.height;
  };
  const enter = () => { live.current.hover = true; };
  const leave = () => { live.current.hover = false; };
  // Touch screens have no hover: a tap points at the next person instead.
  const tap = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    const L = live.current as typeof live.current & { choose?: (p: DemoPerson[]) => DemoPerson; setSpotlight?: (p: DemoPerson | null, now: number, hover: boolean) => void };
    L.setSpotlight?.(L.choose?.(people) ?? null, performance.now(), true);
  };

  async function findMe() {
    setLocating(true);
    const r = await askForLocation();
    setLocating(false);
    if (!r.ok) return setNear({ note: r.reason === "denied" ? "No problem. We didn't use your location." : "Your browser couldn't tell us where you are." });
    // Allowed: show India only, zoomed in. Inside India we also mark where they are; outside, we still show the whole country.
    const fit = indiaFit(r.at as LatLng);
    live.current.you = fit.you;
    api.current?.enterZoom();
    setZoomed(true);
    setNear(fit.outside ? { note: "You're outside India, so here's the whole country DevMap serves." } : { people: nearest(r.at as LatLng, people, 3) });
  }

  function backToGlobe() {
    api.current?.exitZoom();
    setZoomed(false);
    setNear(null);
  }

  return (
    <div className="mx-auto w-full max-w-[640px]">
      <div
        ref={wrap}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onPointerMove={onMove}
        onPointerDown={tap}
        className="relative aspect-square w-full cursor-crosshair touch-pan-y select-none"
        role="img"
        aria-label="An animated globe of India with sample profiles of developers, designers and marketers"
      >
        {/* Circular lens: when the camera zooms in, the globe is clipped to a circle instead of the canvas' square corners. */}
        <div className={cn("size-full overflow-hidden rounded-full transition-shadow duration-700", zoomed && "shadow-[0_0_0_2px_rgba(255,255,255,.28),0_0_70px_rgba(129,140,248,.45)]")}>
          <canvas ref={canvas} className="size-full" aria-hidden />
        </div>

        {online.map((p) => (
          <span
            key={p.id}
            ref={(el) => { if (el) rings.current.set(p.id, el); else rings.current.delete(p.id); }}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 opacity-0 transition-opacity duration-300"
          >
            <span className="dm-ring" style={{ ["--ring" as string]: ROLE_STYLE[p.role].hex }} />
          </span>
        ))}

        <span ref={you} aria-hidden className="pointer-events-none absolute left-0 top-0 opacity-0 transition-opacity duration-300">
          <span className="dm-ring dm-ring--you" />
          <span className="absolute left-3 top-2 whitespace-nowrap rounded-full bg-cyan-300 px-2 py-0.5 text-[10px] font-bold text-slate-900 shadow">You are here</span>
        </span>

        <div ref={tag} aria-hidden={!spot} data-side="right" className="dm-tag pointer-events-none absolute left-0 top-0 opacity-0 transition-opacity duration-300">
          {spot && (
            <div className="dm-tag-card">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: ROLE_STYLE[spot.role].hex }} />
                <p className="text-sm font-semibold text-white">{spot.name}</p>
                {spot.online && <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-400" /> Online</span>}
              </div>
              <p className="mt-0.5 text-xs text-indigo-100/90">{spot.skill}</p>
              <p className="mt-0.5 text-[11px] text-indigo-200/70">
                {spot.city} · ₹{spot.rate}/hr · <span className="uppercase tracking-wide">sample</span>
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-indigo-100/80">
        {(["developer", "designer", "marketer"] as const).map((r) => (
          <span key={r} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: ROLE_STYLE[r].hex }} />{ROLE_STYLE[r].label}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,.7)]" />Online now</span>
      </div>

      <p className="mt-2 text-center text-sm text-indigo-100">{greeting.line}</p>
      <div className="mt-3 flex flex-col items-center gap-2">
        {zoomed && (
          <button type="button" onClick={backToGlobe} className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/30 backdrop-blur transition hover:bg-white/20">
            ← Back to the globe
          </button>
        )}
        <button
          type="button"
          onClick={findMe}
          disabled={locating || zoomed}
          className={cn("rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/30 backdrop-blur transition hover:bg-white/20 disabled:opacity-60")}
        >
          {locating ? "Finding you…" : zoomed ? "📍 Showing India" : "📍 Show builders near me"}
        </button>
        {near && "note" in near && <p className="text-center text-xs text-indigo-100/80">{near.note}</p>}
        {near && "people" in near && (
          <ul className="flex flex-wrap justify-center gap-2 text-xs text-white">
            {near.people.map((p) => (
              <li key={p.id} className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/20">
                {p.name} · {p.city} · {p.km < 5 ? "right here" : `${Math.round(p.km)} km`}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-indigo-200/60">Sample profiles for illustration. Your location, if you share it, never leaves this page.</p>
      </div>

      <ul className="sr-only">
        {people.map((p) => <li key={p.id}>{p.name}, {p.role}, {p.city}</li>)}
      </ul>
    </div>
  );
}

