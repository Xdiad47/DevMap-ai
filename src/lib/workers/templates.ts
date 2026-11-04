/**
 * "A site spun up from a starter template is not proof of work" (PRD §8.2). We look at the page <title> only:
 * cheap, hard to false-positive on (a real site rarely keeps the stock title), and easy to extend.
 */
const DEFAULT_TITLES = new Set(
  [
    "create next app",
    "vite + react",
    "vite + react + ts",
    "vite + vue",
    "vite + svelte",
    "vite + preact",
    "vite + vanilla",
    "vite app",
    "react app",
    "vue app",
    "welcome to nginx!",
    "apache2 ubuntu default page: it works",
    "apache2 debian default page: it works",
    "test page for the apache http server on fedora",
    "iis windows server",
    "default web site page",
    "index of /",
    "it works!",
  ].map((s) => s.toLowerCase()),
);

export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html.slice(0, 65_536));
  if (!m) return null;
  return m[1].replace(/\s+/g, " ").trim();
}

export function isDefaultTemplate(html: string): boolean {
  const title = extractTitle(html);
  return title !== null && DEFAULT_TITLES.has(title.toLowerCase());
}
