import { describe, expect, it } from "vitest";
import { sanitizeNext } from "./safe-redirect";

describe("sanitizeNext (open-redirect protection)", () => {
  it("keeps legitimate in-app paths, including query strings", () => {
    expect(sanitizeNext("/dashboard/talent")).toBe("/dashboard/talent");
    expect(sanitizeNext("/onboard/talent?role=developer")).toBe("/onboard/talent?role=developer");
    expect(sanitizeNext("/explore")).toBe("/explore");
  });
  it("rejects other origins and tricks", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "http://localhost:3000/dashboard",
      "///evil.example/dashboard",
      "/\\/evil.example",
    ]) {
      expect(sanitizeNext(bad)).toBe("/dashboard");
    }
  });
  it("rejects paths outside the app areas", () => {
    expect(sanitizeNext("/login")).toBe("/dashboard");
    expect(sanitizeNext("/api/secret")).toBe("/dashboard");
    expect(sanitizeNext("/dashboardx")).toBe("/dashboard");
  });
  it("falls back on empty / missing / huge input", () => {
    expect(sanitizeNext(null)).toBe("/dashboard");
    expect(sanitizeNext("")).toBe("/dashboard");
    expect(sanitizeNext("/dashboard/" + "a".repeat(400))).toBe("/dashboard");
    expect(sanitizeNext("nope", "/explore")).toBe("/explore");
  });
});
