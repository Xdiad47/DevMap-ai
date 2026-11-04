/**
 * Shared plumbing for tests that talk to a REAL Postgres + PostgREST (see scripts/contract-test.sh):
 * signed JWTs, a proxy that adds supabase-js's `/rest/v1` prefix, and tiny helpers. Test-only code.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

export const CONTAINER = process.env.CT_CONTAINER;
export const REST_URL = process.env.CT_POSTGREST_URL;
const SECRET = process.env.CT_JWT_SECRET ?? "";
const DB = process.env.CT_DB ?? "devmap_test";

export const sql = (query: string) =>
  execFileSync("docker", ["exec", "-i", CONTAINER!, "psql", "-U", "postgres", "-d", DB, "-At", "-q", "-c", query], { encoding: "utf8" }).trim();

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
export function jwt(claims: Record<string, unknown>) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}

export async function startProxy(): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const up = http.request(REST_URL! + req.url!.replace(/^\/rest\/v1/, ""), { method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 500, r.headers);
      r.pipe(res);
    });
    req.pipe(up);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

export type Who = { userId: string } | { userId: string; admin: true } | { service: true } | null;
export function clientFor(apiUrl: string, who: Who): SupabaseClient {
  const bearer =
    who === null ? undefined
    : "service" in who ? jwt({ role: "service_role" })
    : "admin" in who ? jwt({ sub: who.userId, role: "authenticated", app_metadata: { role: "admin" } })  // what Auth issues after app_metadata.role is set
    : jwt({ sub: who.userId, role: "authenticated" });
  return createClient(apiUrl, jwt({ role: "anon" }), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), "x-forwarded-for": "203.0.113.9" } },
  });
}

export function newUser(): string {
  const id = randomUUID();
  sql(`insert into auth.users(id,email) values ('${id}','${id.slice(0, 8)}@example.com')`);
  return id;
}
export const confirmPhone = (userId: string, e164: string) =>
  sql(`update auth.users set phone='${e164.replace(/\D/g, "")}', phone_confirmed_at=now() where id='${userId}'`);

/** The deterministic ids from supabase/seed.sql. */
export const SEED_PREFIX = "00000000-0000-4000-8000-";
export const seedId = (n: number) => `${SEED_PREFIX}${String(n).padStart(12, "0")}`;
export const isSeed = (id: string) => id.startsWith(SEED_PREFIX);
export const seedNumbers = (rows: { id: string }[]) =>
  rows
    .filter((r) => isSeed(r.id))
    .map((r) => Number(r.id.slice(SEED_PREFIX.length)))
    .sort((a, b) => a - b);
