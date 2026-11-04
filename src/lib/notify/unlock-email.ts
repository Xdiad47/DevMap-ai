/** The e-mail a talent gets when a recruiter unlocks their contact. Pure (no secrets, no I/O) so it can be unit-tested. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type UnlockEmailInput = {
  talentName: string; // the masked name they see on DevMap, e.g. "Rahul S."
  recruiterCompany: string | null;
  dashboardUrl: string;
  supportEmail: string;
};

export function unlockEmail(i: UnlockEmailInput): { subject: string; text: string; html: string } {
  const who = i.recruiterCompany?.trim() ? i.recruiterCompany.trim() : "A recruiter";
  const subject = "A recruiter unlocked your contact on DevMap";
  const text = [
    `Hi ${i.talentName},`,
    "",
    `${who} just unlocked your WhatsApp number on DevMap. Expect a message from them soon.`,
    "",
    "A few tips:",
    "- Reply as soon as you can. Fast replies raise your rank.",
    "- Recruiters can report a lead that stays unanswered for 24 hours, and our team reviews every report.",
    "- Tap Online on your dashboard when you are free for work, so recruiters see you first.",
    "",
    `Your dashboard: ${i.dashboardUrl}`,
    "",
    `Questions? Reply to this email or write to ${i.supportEmail}.`,
    "",
    "DevMap",
  ].join("\n");
  const html = `<p>Hi ${esc(i.talentName)},</p>
<p><strong>${esc(who)}</strong> just unlocked your WhatsApp number on DevMap. Expect a message from them soon.</p>
<ul>
<li>Reply as soon as you can. Fast replies raise your rank.</li>
<li>Recruiters can report a lead that stays unanswered for 24 hours, and our team reviews every report.</li>
<li>Tap <strong>Online</strong> on your dashboard when you are free for work, so recruiters see you first.</li>
</ul>
<p><a href="${esc(i.dashboardUrl)}">Open your dashboard</a></p>
<p style="color:#64748b;font-size:13px">Questions? Reply to this email or write to ${esc(i.supportEmail)}.</p>`;
  return { subject, text, html };
}
