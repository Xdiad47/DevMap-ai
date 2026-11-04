import { describe, expect, it } from "vitest";
import { buildCreateTalentArgs, validateTalentStep, type TalentFormValues } from "./talent";

const valid: TalentFormValues = {
  role: "developer",
  fullName: "Rahul Sharma",
  email: "Rahul@Example.com",
  state: "Assam",
  city: "Guwahati",
  nativeLanguage: "Assamese",
  secondaryLanguages: ["English", "Assamese"],
  skills: ["flutter", "kotlin"],
  hourlyRate: "600",
  whatsapp: "98765 43210",
  portfolioUrl: "",
};

describe("buildCreateTalentArgs", () => {
  it("produces exactly the RPC argument names, in the DB's units", () => {
    const a = buildCreateTalentArgs(valid);
    expect(Object.keys(a).sort()).toEqual(
      [
        "p_role", "p_full_name", "p_city", "p_state", "p_latitude", "p_longitude", "p_native_language",
        "p_secondary_languages", "p_skills", "p_hourly_rate_paise", "p_phone_e164", "p_whatsapp_number",
        "p_email", "p_portfolio_links",
      ].sort(),
    );
    expect(a.p_hourly_rate_paise).toBe(60000); // rupees -> paise
    expect(a.p_whatsapp_number).toBe("+919876543210");
    expect(a.p_phone_e164).toBe("+919876543210");
    expect(a.p_email).toBe("rahul@example.com");
    expect(a.p_secondary_languages).toEqual(["English"]); // native language removed from "other"
    expect(a.p_latitude).toBeCloseTo(26.1445, 3);
  });
  it("beta: the WhatsApp number is the one contact number (no OTP, no separate verification number)", () => {
    const a = buildCreateTalentArgs({ ...valid, whatsapp: "91234 56789" });
    expect(a.p_phone_e164).toBe("+919123456789");
    expect(a.p_whatsapp_number).toBe("+919123456789");
  });
  it("throws on invalid input instead of sending it", () => {
    expect(() => buildCreateTalentArgs({ ...valid, hourlyRate: "299" })).toThrow();
    expect(() => buildCreateTalentArgs({ ...valid, skills: [] })).toThrow();
  });
});

describe("place: any state, with a city that really is in it", () => {
  it("accepts talent from anywhere in India and uses the city centre for the map", () => {
    const a = buildCreateTalentArgs({ ...valid, state: "Gujarat", city: "Surat", nativeLanguage: "Gujarati" });
    expect(a.p_state).toBe("Gujarat");
    expect(a.p_city).toBe("Surat");
    expect(a.p_latitude).toBeCloseTo(21.17, 1);
  });
  it("rejects a city that is not in the chosen state", () => {
    expect(validateTalentStep("place", { ...valid, state: "Kerala", city: "Surat" }).city).toMatch(/Kerala/);
  });
  it("asks for a state when none is chosen, and rejects made-up ones", () => {
    expect(validateTalentStep("place", { ...valid, state: "" }).state).toMatch(/state/i);
    expect(validateTalentStep("place", { ...valid, state: "Narnia" }).state).toBeDefined();
  });
  it("accepts every scheduled language as a native language", () => {
    for (const l of ["Tamil", "Kashmiri", "Bodo", "Santali", "Sanskrit"] as const) expect(validateTalentStep("place", { ...valid, nativeLanguage: l }).nativeLanguage).toBeUndefined();
  });
});

describe("validateTalentStep", () => {
  it("enforces the Rs 300/hr floor (DB: hourly_rate_paise >= 30000)", () => {
    expect(validateTalentStep("work", { ...valid, hourlyRate: "299" }).hourlyRate).toMatch(/300/);
    expect(validateTalentStep("work", { ...valid, hourlyRate: "300" }).hourlyRate).toBeUndefined();
  });
  it("allows at most 12 skills (DB: cardinality(skills) <= 12)", () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => `s${i}`);
    expect(validateTalentStep("work", { ...valid, skills: thirteen }).skills).toBeDefined();
    expect(validateTalentStep("work", { ...valid, skills: thirteen.slice(0, 12) }).skills).toBeUndefined();
  });
  it("only reports errors for the step being validated", () => {
    const broken = { ...valid, fullName: "", hourlyRate: "1" };
    expect(Object.keys(validateTalentStep("about", broken))).toEqual(["fullName"]);
    expect(Object.keys(validateTalentStep("work", broken))).toEqual(["hourlyRate"]);
  });
  it("requires a valid WhatsApp number", () => {
    expect(validateTalentStep("contact", { ...valid, whatsapp: "123" }).whatsapp).toBeDefined();
    expect(validateTalentStep("contact", valid).whatsapp).toBeUndefined();
  });
  it("rejects non-https portfolio links", () => {
    expect(validateTalentStep("contact", { ...valid, portfolioUrl: "http://x.in" }).portfolioUrl).toBeDefined();
    expect(validateTalentStep("contact", { ...valid, portfolioUrl: "https://me.dev/work" }).portfolioUrl).toBeUndefined();
  });
});
