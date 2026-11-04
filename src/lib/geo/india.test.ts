import { describe, expect, it } from "vitest";
import { SCHEDULED_LANGUAGES, LANGUAGES } from "@/lib/languages";
import { CITIES, STATES, citiesOf, findCity, isState } from "./india";

describe("India geography", () => {
  it("covers all 28 states and 8 union territories", () => {
    expect(STATES).toHaveLength(36);
    for (const s of ["Assam", "Kerala", "Gujarat", "Delhi", "Ladakh", "Lakshadweep", "Jammu and Kashmir", "Andaman and Nicobar Islands"]) expect(STATES).toContain(s);
  });
  it("every state has at least one city, and city names are unique (a city alone identifies its state)", () => {
    for (const s of STATES) expect(citiesOf(s).length).toBeGreaterThan(0);
    expect(new Set(CITIES.map((c) => c.name)).size).toBe(CITIES.length);
  });
  it("every city sits inside India's bounding box", () => {
    for (const c of CITIES) {
      expect(c.lat).toBeGreaterThan(6);
      expect(c.lat).toBeLessThan(37.5);
      expect(c.lng).toBeGreaterThan(68);
      expect(c.lng).toBeLessThan(98);
    }
  });
  it("lookups", () => {
    expect(findCity("Surat")).toMatchObject({ state: "Gujarat" });
    expect(findCity("Atlantis")).toBeUndefined();
    expect(findCity(undefined)).toBeUndefined();
    expect(isState("Kerala")).toBe(true);
    expect(isState("Narnia")).toBe(false);
  });
});

describe("languages", () => {
  it("includes all 22 scheduled languages, plus English", () => {
    expect(SCHEDULED_LANGUAGES).toHaveLength(22);
    expect(new Set(SCHEDULED_LANGUAGES).size).toBe(22);
    for (const l of SCHEDULED_LANGUAGES) expect(LANGUAGES).toContain(l);
    expect(LANGUAGES).toContain("English");
  });
  it("has no duplicates", () => expect(new Set(LANGUAGES).size).toBe(LANGUAGES.length));
});
