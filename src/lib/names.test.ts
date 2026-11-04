import { describe, expect, it } from "vitest";
import { maskName } from "./names";

// These cases are copied from the SQL behaviour tests of private.mask_name().
describe("maskName matches the database function", () => {
  it.each([
    ["Rahul Sharma", "Rahul S."],
    ["rahul", "Rahul"],
    ["  anil  kumar  verma ", "Anil V."],
    ["PRIYA BORA", "Priya B."],
    ["", "Talent"],
    ["   ", "Talent"],
    ["mary o'brien", "Mary O."],
    ["jyoti prasad agarwala", "Jyoti A."],
  ])("%j -> %j", (input, expected) => {
    expect(maskName(input)).toBe(expected);
  });
});
