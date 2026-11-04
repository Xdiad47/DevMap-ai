import { describe, expect, it } from "vitest";
import { guard, homeFor, isProtectedPath } from "./routing";

const none = { talent: false, recruiter: false };
const talent = { talent: true, recruiter: false };
const recruiter = { talent: false, recruiter: true };
const both = { talent: true, recruiter: true };

describe("homeFor", () => {
  it("sends each kind of user to their home", () => {
    expect(homeFor(none)).toBe("/onboard");
    expect(homeFor(talent)).toBe("/dashboard/talent");
    expect(homeFor(recruiter)).toBe("/explore");
    expect(homeFor(both)).toBe("/dashboard/talent");
  });
});

describe("guard: incomplete profiles go to their onboarding step", () => {
  it("talent dashboard without a talent profile -> talent onboarding", () => {
    expect(guard("/dashboard/talent", none)).toBe("/onboard/talent");
    expect(guard("/dashboard/talent", recruiter)).toBe("/onboard/talent");
  });
  it("explore without a recruiter profile -> recruiter onboarding (or talent home if they are talent)", () => {
    expect(guard("/explore", none)).toBe("/onboard/recruiter");
    expect(guard("/explore", talent)).toBe("/dashboard/talent");
  });
  it("bare /dashboard is a signpost", () => {
    expect(guard("/dashboard", none)).toBe("/onboard");
    expect(guard("/dashboard", talent)).toBe("/dashboard/talent");
    expect(guard("/dashboard", recruiter)).toBe("/explore");
  });
});

describe("guard: finished profiles skip onboarding", () => {
  it("talent with a profile cannot re-enter /onboard/talent", () => {
    expect(guard("/onboard/talent", talent)).toBe("/dashboard/talent");
    expect(guard("/onboard/talent", none)).toBeNull();
  });
  it("recruiter with a profile cannot re-enter /onboard/recruiter", () => {
    expect(guard("/onboard/recruiter", recruiter)).toBe("/explore");
    expect(guard("/onboard/recruiter", none)).toBeNull();
  });
  it("a talent may still become a recruiter too", () => {
    expect(guard("/onboard/recruiter", talent)).toBeNull();
  });
  it("role chooser is skipped once any profile exists", () => {
    expect(guard("/onboard", none)).toBeNull();
    expect(guard("/onboard", talent)).toBe("/dashboard/talent");
    expect(guard("/onboard", recruiter)).toBe("/explore");
  });
  it("phone verification page is always reachable", () => {
    for (const s of [none, talent, recruiter, both]) expect(guard("/onboard/verify-phone", s)).toBeNull();
  });
});

describe("isProtectedPath", () => {
  it("protects app areas but not public pages", () => {
    for (const p of ["/dashboard", "/dashboard/talent", "/onboard", "/onboard/talent", "/explore"]) {
      expect(isProtectedPath(p)).toBe(true);
    }
    for (const p of ["/", "/login", "/auth/callback", "/terms", "/dashboardx", "/exploration"]) {
      expect(isProtectedPath(p)).toBe(false);
    }
  });
});
