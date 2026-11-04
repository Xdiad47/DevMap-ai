const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The message a client receives. Names and titles are typed by the talent, so everything is escaped in the HTML part and
 * the plain-text part is the canonical one. The link only OPENS a page; nothing is confirmed until the client presses a
 * button there (mail scanners that pre-fetch links therefore can't confirm anything).
 */
export function attestationEmail(p: { talentName: string; title: string; site: string; link: string; days: number }) {
  const subject = `Did ${p.talentName} build ${p.title} for you?`.slice(0, 140);
  const text = [
    `Hello,`,
    ``,
    `${p.talentName} says they built "${p.title}" (${p.site}) for you, and listed it as proof of work on DevMap.in.`,
    ``,
    `Could you confirm? It takes one click and you don't need an account:`,
    p.link,
    ``,
    `If you don't know ${p.talentName} or didn't work with them, just choose "No" on that page (or ignore this email).`,
    `This link works once and expires in ${p.days} days. We only use your answer to verify the project; we do not store your email address.`,
    ``,
    `DevMap.in`,
  ].join("\n");
  const html = `<p>Hello,</p>
<p><strong>${esc(p.talentName)}</strong> says they built <strong>${esc(p.title)}</strong> (${esc(p.site)}) for you, and listed it as proof of work on DevMap.in.</p>
<p>Could you confirm? It takes one click and you don't need an account:</p>
<p><a href="${esc(p.link)}">Confirm or decline</a></p>
<p style="color:#555;font-size:13px">If you don't know ${esc(p.talentName)} or didn't work with them, choose &ldquo;No&rdquo; on that page or ignore this email. The link works once and expires in ${p.days} days. We only use your answer to verify the project; we do not store your email address.</p>`;
  return { subject, text, html };
}

/** For the WhatsApp channel the TALENT sends the message from their own phone (we don't use the WhatsApp Business API). */
export function whatsappText(p: { talentName: string; title: string; link: string }) {
  return `Hi, it's ${p.talentName}. I listed "${p.title}", which I built for you, on DevMap.in. Could you confirm it with one tap? ${p.link}`;
}
