import { describe, expect, it } from "vitest";
import { unlockEmail } from "./unlock-email";

const base = { talentName: "Rahul S.", recruiterCompany: "Acme Pvt Ltd", dashboardUrl: "https://devmap.scanlyy.in/dashboard/talent", supportEmail: "diadem.xeiver@gmail.com" };

describe("unlockEmail", () => {
  it("names the recruiter's company, the talent's masked name, and links to the dashboard", () => {
    const m = unlockEmail(base);
    expect(m.subject).toBe("A recruiter unlocked your contact on DevMap");
    expect(m.text).toContain("Hi Rahul S.");
    expect(m.text).toContain("Acme Pvt Ltd just unlocked your WhatsApp number");
    expect(m.text).toContain("https://devmap.scanlyy.in/dashboard/talent");
    expect(m.text).toContain("diadem.xeiver@gmail.com");
  });
  it("says 'A recruiter' when there is no company name", () => {
    expect(unlockEmail({ ...base, recruiterCompany: null }).text).toContain("A recruiter just unlocked");
    expect(unlockEmail({ ...base, recruiterCompany: "   " }).text).toContain("A recruiter just unlocked");
  });
  it("never leaks the recruiter's own details beyond the company they chose to show", () => {
    const m = unlockEmail(base);
    expect(m.text + m.html).not.toMatch(/@acme|phone|\+91/i);
  });
  it("escapes HTML in names so a company called <script> cannot inject markup", () => {
    const m = unlockEmail({ ...base, recruiterCompany: '<script>alert("x")</script>' });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });
});
