/**
 * The maths behind the landing-page globe. Pure functions (unit-tested) so the animation can be reasoned about without a GPU.
 *
 * The projection below is a transcription of what the `cobe` library does inside its shader (see node_modules/cobe/dist),
 * so our own DOM overlays (pulsing rings, name tags) land exactly on cobe's markers:
 *   - a [lat, lng] becomes a point on a sphere,
 *   - the globe is rotated by `phi` (spin around the poles) and `theta` (tilt),
 *   - the sphere has radius 0.8 of the canvas half-width, plus the marker's elevation.
 */
const RAD = Math.PI / 180;
export const SPHERE_RADIUS = 0.8;

export type LatLng = [lat: number, lng: number];

function toVec([lat, lng]: LatLng): [number, number, number] {
  const r = lat * RAD;
  const a = lng * RAD - Math.PI;
  const c = Math.cos(r);
  return [-c * Math.cos(a), Math.sin(r), c * Math.sin(a)];
}

/** Where on the canvas (0..1 from the top-left) a place appears, and whether it faces us. `aspect` = width / height. */
export function project(place: LatLng, phi: number, theta: number, opts: { elevation?: number; aspect?: number; scale?: number } = {}): { x: number; y: number; visible: boolean } {
  const { elevation = 0, aspect = 1, scale = 1 } = opts;
  const k = SPHERE_RADIUS + elevation;
  const [vx, vy, vz] = toVec(place).map((n) => n * k) as [number, number, number];
  const cosT = Math.cos(theta), sinT = Math.sin(theta), cosP = Math.cos(phi), sinP = Math.sin(phi);
  const c = cosP * vx + sinP * vz;
  const s = sinP * sinT * vx + cosT * vy - cosP * sinT * vz;
  const depth = -sinP * cosT * vx + sinT * vy + cosP * cosT * vz;
  // behind the globe but still inside its silhouette = hidden; behind but outside the silhouette (the limb) is still seen
  const visible = depth >= 0 || c * c + s * s >= 0.64;
  return { x: ((c / aspect) * scale + 1) / 2, y: (-s * scale + 1) / 2, visible };
}

/** The spin (phi) that brings this longitude to the middle of the view. */
export const phiFor = (lng: number) => normalize(1.5 * Math.PI - lng * RAD);
/** The tilt (theta) that brings this latitude to the middle of the view. */
export const thetaFor = (lat: number) => lat * RAD;

/** Wrap an angle to (-π, π]. */
export function normalize(a: number): number {
  const t = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return t === -Math.PI ? Math.PI : t;
}

/** The short way round from `from` to `to`. */
export const shortestAngle = (from: number, to: number) => normalize(to - from);

/**
 * The idle motion, in two layers:
 *   1. a slow, small sway around the home view (always on), so the globe never looks frozen;
 *   2. every so often a half-turn SWEEP: the globe eases away to one side (about 110 degrees, never a full rotation),
 *      shows the other side of the world, and glides back. Sweeps alternate left and right.
 */
export function swing(
  t: number,
  { sway = 0.2, swayPeriod = 15, sweep = 1.9, every = 38, delay = 9, duration = 13, tilt = 0.06 }: { sway?: number; swayPeriod?: number; sweep?: number; every?: number; delay?: number; duration?: number; tilt?: number } = {},
) {
  const gentle = sway * Math.sin((2 * Math.PI * t) / swayPeriod);
  const k = Math.floor(t / every);
  const local = t - k * every - delay;
  let big = 0;
  if (local > 0 && local < duration) {
    const bump = (1 - Math.cos((2 * Math.PI * local) / duration)) / 2; // 0 -> 1 -> 0, smooth at both ends
    big = (k % 2 === 0 ? 1 : -1) * sweep * bump;
  }
  return { dPhi: gentle + big, dTheta: tilt * Math.sin((2 * Math.PI * t) / (swayPeriod * 1.7) + 1) };
}

/** Frame-rate independent smoothing: moves `value` toward `target`; `rate` is how quickly (per second). */
export function damp(value: number, target: number, rate: number, dt: number): number {
  return value + (target - value) * (1 - Math.exp(-rate * dt));
}

/** Same as damp(), but for angles: always turns the short way round. */
export function dampAngle(value: number, target: number, rate: number, dt: number): number {
  return normalize(value + shortestAngle(value, target) * (1 - Math.exp(-rate * dt)));
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b[0] - a[0]) * RAD, dLng = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Rough box around India (mainland + islands), enough to tell "somewhere in India" from "elsewhere". */
export const inIndia = ([lat, lng]: LatLng) => lat >= 6 && lat <= 37.5 && lng >= 68 && lng <= 97.5;

export function nearest<T extends { at: LatLng }>(from: LatLng, items: T[], n = 1): (T & { km: number })[] {
  return items.map((i) => ({ ...i, km: haversineKm(from, i.at) })).sort((a, b) => a.km - b.km).slice(0, n);
}

/** A deterministic scatter (so server and client agree) of up to ~0.35 degrees (about 40 km) around a point. */
export function jitter(seed: number): [number, number] {
  const f = (n: number) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
  return [(f(seed) - 0.5) * 0.7, (f(seed + 7) - 0.5) * 0.7];
}

/**
 * After the visitor allows location: always show India, filling the view. If they are inside India we also mark where they
 * are; outside India we still show the country (it is where DevMap is launching) and say so.
 */
export function indiaFit(at: LatLng): { you: LatLng | null; outside: boolean } {
  const inside = inIndia(at);
  return { you: inside ? at : null, outside: !inside };
}
