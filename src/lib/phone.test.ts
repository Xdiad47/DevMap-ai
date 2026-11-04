import { describe, expect, it } from "vitest";
import { formatIndianMobile, normalizeIndianMobile } from "./phone";

describe("normalizeIndianMobile", () => {
  it("accepts the common ways people type a number", () => {
    for (const v of ["9876543210", "98765 43210", "+91 98765 43210", "+919876543210", "919876543210", "09876543210", "(+91) 98765-43210"]) {
      expect(normalizeIndianMobile(v)).toBe("+919876543210");
    }
  });
  it("rejects numbers that are not Indian mobiles", () => {
    for (const v of ["", "12345", "5876543210", "98765432", "98765432101", "+14155550123", "abcdefghij"]) {
      expect(normalizeIndianMobile(v)).toBeNull();
    }
  });
  it("output always satisfies the DB check ^\\+[1-9][0-9]{7,14}$", () => {
    expect(normalizeIndianMobile("9876543210")).toMatch(/^\+[1-9][0-9]{7,14}$/);
  });
  it("formats for display", () => {
    expect(formatIndianMobile("+919876543210")).toBe("+91 98765 43210");
  });
});
