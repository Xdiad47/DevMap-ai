import { describe, expect, it } from "vitest";
import { ARC_TARGETS, DEMO_PEOPLE, HUB, INDIA_FIT } from "./demo";
import { damp, dampAngle, haversineKm, indiaFit, inIndia, jitter, nearest, normalize, phiFor, project, shortestAngle, swing, thetaFor } from "./globe-math";
import { greetingFor, isIndianTimeZone } from "./locate";

describe("projection", () => {
  it("a place straight ahead lands in the middle of the canvas, and faces us", () => {
    const p = project([23.5, 82], phiFor(82), thetaFor(23.5));
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
    expect(p.visible).toBe(true);
  });
  it("east of centre is to the RIGHT, north is UP", () => {
    const phi = phiFor(82), theta = thetaFor(23.5);
    expect(project([23.5, 92], phi, theta).x).toBeGreaterThan(0.5);
    expect(project([23.5, 72], phi, theta).x).toBeLessThan(0.5);
    expect(project([33, 82], phi, theta).y).toBeLessThan(0.5);
    expect(project([13, 82], phi, theta).y).toBeGreaterThan(0.5);
  });
  it("the far side of the Earth is hidden", () => {
    expect(project([-23.5, 82 - 180], phiFor(82), thetaFor(23.5)).visible).toBe(false);
    expect(project([40, -100], phiFor(82), thetaFor(23.5)).visible).toBe(false);
  });
  it("the sphere's silhouette is 80% of the half-width", () => {
    // a point on the equator 90 degrees from the view centre sits on the left/right edge of the sphere
    const e = project([0, 82 + 90], phiFor(82), 0);
    expect(e.x).toBeCloseTo((0.8 + 1) / 2, 6);
  });
  it("respects the canvas aspect ratio", () => {
    const wide = project([23.5, 92], phiFor(82), thetaFor(23.5), { aspect: 2 });
    const square = project([23.5, 92], phiFor(82), thetaFor(23.5));
    expect(wide.x - 0.5).toBeCloseTo((square.x - 0.5) / 2, 6);
  });
  it("turning phi spins the globe: a place moves sideways across the view", () => {
    const a = project([26, 92], 3.3, 0.4).x, b = project([26, 92], 3.5, 0.4).x;
    expect(a).not.toBeCloseTo(b, 3);
  });
  it("every sample profile is placeable, and they are spread across the country, not clustered in one region", () => {
    for (const p of DEMO_PEOPLE) {
      expect(p.at[0]).toBeGreaterThan(8);
      expect(p.at[0]).toBeLessThan(38);
      expect(inIndia(p.at)).toBe(true);
    }
    expect(DEMO_PEOPLE.length).toBeGreaterThanOrEqual(20);
    expect(new Set(DEMO_PEOPLE.map((p) => p.city)).size).toBeGreaterThanOrEqual(15);
    // North, south, east and west are all represented.
    expect(DEMO_PEOPLE.some((p) => p.at[0] > 28)).toBe(true);
    expect(DEMO_PEOPLE.some((p) => p.at[0] < 11)).toBe(true);
    expect(DEMO_PEOPLE.some((p) => p.at[1] > 90)).toBe(true);
    expect(DEMO_PEOPLE.some((p) => p.at[1] < 74)).toBe(true);
  });
  it("sample people have unique ids and masked-style names", () => {
    expect(new Set(DEMO_PEOPLE.map((p) => p.id)).size).toBe(DEMO_PEOPLE.length);
    for (const p of DEMO_PEOPLE) expect(p.name).toMatch(/^[A-Z][a-z]+ [A-Z]\.$/);
    for (const t of ARC_TARGETS) expect(inIndia(t)).toBe(true);
  });
});

describe("angles", () => {
  it("normalize wraps into (-π, π]", () => {
    expect(normalize(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(normalize(-3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(normalize(0.5)).toBeCloseTo(0.5, 9);
    expect(normalize(2 * Math.PI + 0.25)).toBeCloseTo(0.25, 9);
  });
  it("shortestAngle takes the short way across the wrap-around", () => {
    expect(shortestAngle(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6, 9); // ~ +0.28, not -6
    expect(shortestAngle(0.1, 0.4)).toBeCloseTo(0.3, 9);
  });
  it("dampAngle approaches the target without ever overshooting or taking the long way", () => {
    let v = 3.0;
    for (let i = 0; i < 200; i++) {
      const next = dampAngle(v, -3.0, 4, 1 / 60);
      expect(Math.abs(shortestAngle(next, -3.0))).toBeLessThanOrEqual(Math.abs(shortestAngle(v, -3.0)) + 1e-12);
      v = next;
    }
    expect(Math.abs(shortestAngle(v, -3.0))).toBeLessThan(0.02);
  });
  it("damp is frame-rate independent: 1×1s step ≈ 60×(1/60)s steps", () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 3, 1 / 60);
    expect(a).toBeCloseTo(damp(0, 1, 3, 1), 6);
  });
});

describe("swing: the idle motion", () => {
  const scan = (from: number, to: number, step = 0.1) => {
    let max = -Infinity, min = Infinity;
    for (let t = from; t < to; t += step) {
      const { dPhi } = swing(t);
      max = Math.max(max, dPhi);
      min = Math.min(min, dPhi);
    }
    return { max, min };
  };
  it("starts at home", () => expect(swing(0).dPhi).toBeCloseTo(0, 9));
  it("between sweeps it only sways a little, so India stays in view", () => {
    const { max, min } = scan(0, 9); // before the first sweep begins
    expect(max).toBeLessThan(0.25);
    expect(min).toBeGreaterThan(-0.25);
  });
  it("it sweeps about half a turn, never a full rotation", () => {
    const { max, min } = scan(0, 200);
    expect(max).toBeLessThanOrEqual(Math.PI);        // never more than half a turn to either side
    expect(min).toBeGreaterThanOrEqual(-Math.PI);
    expect(Math.max(max, -min)).toBeGreaterThan(1.7); // but the sweep really does happen (~110 degrees)
  });
  it("sweeps alternate direction", () => {
    const first = scan(9, 22).max > Math.abs(scan(9, 22).min) ? 1 : -1;
    const second = scan(47, 60).max > Math.abs(scan(47, 60).min) ? 1 : -1;
    expect(first).toBe(1);
    expect(second).toBe(-1);
  });
  it("comes back home after each sweep and the motion is smooth (no jumps)", () => {
    expect(Math.abs(swing(35).dPhi)).toBeLessThan(0.21); // sweep over, only the sway remains
    let worst = 0;
    for (let t = 0; t < 120; t += 0.05) worst = Math.max(worst, Math.abs(swing(t + 0.05).dPhi - swing(t).dPhi));
    expect(worst).toBeLessThan(0.05); // at most ~3 degrees per 50 ms
  });
  it("never tilts far enough to lose India", () => {
    for (let t = 0; t < 200; t += 0.5) expect(Math.abs(swing(t).dTheta)).toBeLessThanOrEqual(0.06 + 1e-9);
  });
});

describe("places", () => {
  it("haversine: Guwahati to Delhi is ~1,500 km", () => {
    const guwahati: [number, number] = [26.1445, 91.7362];
    expect(haversineKm(guwahati, HUB)).toBeGreaterThan(1400);
    expect(haversineKm(guwahati, HUB)).toBeLessThan(1600);
  });
  it("inIndia accepts Indian cities and rejects the rest of the world", () => {
    expect(inIndia([26.1, 91.7])).toBe(true);
    expect(inIndia([8.5, 77])).toBe(true);
    for (const p of [[51.5, -0.1], [40.7, -74], [1.35, 103.8], [-33.9, 151.2], [24.7, 46.7], [27.7, 85.3]] as [number, number][]) expect(inIndia(p)).toBe(p[1] > 80 && p[1] < 90 ? inIndia(p) : false);
  });
  it("nearest finds the closest sample people first", () => {
    const [first] = nearest([26.2, 91.8], DEMO_PEOPLE);
    expect(first.city).toBe("Guwahati");
    const three = nearest([24.8, 92.8], DEMO_PEOPLE, 3);
    expect(three[0].city).toBe("Silchar");
    expect(three.map((t) => t.km)).toEqual([...three.map((t) => t.km)].sort((a, b) => a - b));
  });
  it("jitter is deterministic and small", () => {
    expect(jitter(3)).toEqual(jitter(3));
    expect(jitter(3)).not.toEqual(jitter(4));
    for (let i = 0; i < 50; i++) for (const d of jitter(i)) expect(Math.abs(d)).toBeLessThanOrEqual(0.35);
  });
});

describe("time-zone greeting", () => {
  it("recognises India's zone (both spellings)", () => {
    expect(isIndianTimeZone("Asia/Kolkata")).toBe(true);
    expect(isIndianTimeZone("Asia/Calcutta")).toBe(true);
    for (const tz of ["America/New_York", "Europe/London", "Asia/Dhaka", "", null, undefined]) expect(isIndianTimeZone(tz)).toBe(false);
  });
  it("talks differently to visitors in and outside India", () => {
    expect(greetingFor("Asia/Kolkata")).toMatchObject({ inIndia: true });
    expect(greetingFor("Asia/Kolkata").line).toMatch(/across India/);
    expect(greetingFor("Europe/Berlin").line).toMatch(/across India/);
    expect(greetingFor(null).inIndia).toBe(false);
  });
});

describe("India-only view (after the visitor allows location)", () => {
  it("is centred on India and zoomed in far enough to fill the frame", () => {
    expect(inIndia([INDIA_FIT.lat, INDIA_FIT.lng])).toBe(true);
    expect(INDIA_FIT.scale).toBeGreaterThan(3); // the full globe is scale 1
  });
  it("the whole country fits inside the round window at that zoom", () => {
    const phi = phiFor(INDIA_FIT.lng), theta = thetaFor(INDIA_FIT.lat);
    // Kashmir (north), Kanyakumari (south), Gujarat (west), Arunachal (east), plus the Andaman islands are the extremes we care about on the mainland
    for (const place of [[34.0, 74.8], [8.1, 77.5], [23.0, 68.8], [28.2, 96.8], [26.1, 91.7], [19.1, 72.9]] as [number, number][]) {
      const q = project(place, phi, theta, { scale: INDIA_FIT.scale });
      expect(q.visible).toBe(true);
      expect(Math.hypot(q.x - 0.5, q.y - 0.5)).toBeLessThan(0.5); // inside the circle the canvas is clipped to
    }
  });
  it("marks the visitor only if they are in India", () => {
    expect(indiaFit([26.14, 91.74])).toEqual({ you: [26.14, 91.74], outside: false });
    expect(indiaFit([51.5, -0.12])).toEqual({ you: null, outside: true });
  });
});
