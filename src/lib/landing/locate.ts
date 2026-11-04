import { inIndia, nearest, type LatLng } from "./globe-math";

/** "Asia/Kolkata" is India's only IANA zone (the old spelling is "Asia/Calcutta"). */
export function isIndianTimeZone(tz: string | undefined | null): boolean {
  return tz === "Asia/Kolkata" || tz === "Asia/Calcutta";
}

/**
 * Without asking anyone for anything, the browser's time zone is a decent hint. In India we say so; anywhere else we
 * explain that DevMap is built for India, and still show the same globe.
 */
export function greetingFor(tz: string | undefined | null): { inIndia: boolean; line: string } {
  return isIndianTimeZone(tz)
    ? { inIndia: true, line: "Showing builders across India. Allow location to zoom in on your city." }
    : { inIndia: false, line: "DevMap connects businesses with verified talent across India. Here's who you'd find." };
}

export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

export type NearMe = { ok: true; at: LatLng; inIndia: boolean } | { ok: false; reason: "denied" | "unavailable" };

/** Asks the browser for location ONLY when the visitor taps the button. The position never leaves the page. */
export function askForLocation(): Promise<NearMe> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve({ ok: false, reason: "unavailable" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const at: LatLng = [p.coords.latitude, p.coords.longitude];
        resolve({ ok: true, at, inIndia: inIndia(at) });
      },
      (e) => resolve({ ok: false, reason: e.code === 1 ? "denied" : "unavailable" }),
      { timeout: 8000, maximumAge: 600_000 },
    );
  });
}

export { nearest };
