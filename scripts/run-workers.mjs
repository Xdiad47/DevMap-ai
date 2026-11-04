/**
 * Local / small-VPS scheduler for the two cron routes (on Vercel's free plan, call them from a crontab: see DEPLOY.md).
 *   CRON_SECRET=... APP_URL=http://localhost:3000 npm run workers
 *
 * Cadence: pings + ownership checks every 10 minutes (each site is only due ~4 times a day, at random), GitHub scorer every 15 minutes
 * (it only processes the few developers that are due).
 */
const APP = process.env.APP_URL ?? "http://localhost:3000";
const SECRET = process.env.CRON_SECRET;
if (!SECRET) throw new Error("Set CRON_SECRET (the same value the app uses).");

const JOBS = [
  { name: "ping", every: 600 },
  { name: "github-score", every: 900 },
];
let running = new Set();

async function tick(job) {
  if (running.has(job.name)) return; // never overlap a slow run with the next one
  running.add(job.name);
  try {
    const res = await fetch(`${APP}/api/cron/${job.name}`, { headers: { authorization: `Bearer ${SECRET}` }, signal: AbortSignal.timeout(90_000) });
    const body = await res.text();
    console.log(`${new Date().toISOString()} ${job.name} -> ${res.status} ${body.slice(0, 200)}`);
  } catch (e) {
    console.error(`${new Date().toISOString()} ${job.name} failed:`, e instanceof Error ? e.message : e);
  } finally {
    running.delete(job.name);
  }
}

for (const job of JOBS) {
  tick(job);
  setInterval(() => tick(job), job.every * 1000);
}
console.log(`workers running against ${APP}: ${JOBS.map((j) => `${j.name}/${j.every}s`).join(", ")}  (Ctrl-C to stop)`);
