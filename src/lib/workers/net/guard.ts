import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicAddress } from "./ip";

export class SsrfError extends Error {
  constructor(readonly reason: string) {
    super(`blocked:${reason}`);
  }
}

export type Resolved = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<Resolved[]>;

/** A and AAAA together (getaddrinfo with all:true). `verbatim` keeps the OS ordering. */
export const systemResolver: Resolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((a) => ({ address: a.address, family: a.family as 4 | 6 }));
};

const BAD_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".localdomain"];

/**
 * Step 1 of every outbound request: is this URL even allowed to be looked up?
 * https only, no credentials, no custom port, and a real DNS name (never an IP literal).
 */
export function parseProbeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("invalid_url");
  }
  if (url.protocol !== "https:") throw new SsrfError("scheme");
  if (url.username || url.password) throw new SsrfError("credentials");
  if (url.port) throw new SsrfError("port");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.startsWith("[") || isIP(host) !== 0) throw new SsrfError("ip_literal");
  if (!host.includes(".") || host === "localhost" || BAD_SUFFIXES.some((s) => host.endsWith(s))) throw new SsrfError("internal_name");
  return url;
}

/**
 * Step 2: resolve ONCE and judge EVERY answer. If any address is non-public the whole host is refused
 * (a host that resolves to both a public and a private address is a rebinding setup, not a website).
 * The caller must then connect to the address returned here, not look the name up again.
 */
export async function resolvePublic(
  hostname: string,
  resolve: Resolver = systemResolver,
  isAllowed: (ip: string) => boolean = isPublicAddress,
): Promise<Resolved> {
  let answers: Resolved[];
  try {
    answers = await resolve(hostname);
  } catch {
    throw new Error("dns_failed");
  }
  if (answers.length === 0) throw new Error("dns_failed");
  for (const a of answers) if (!isAllowed(a.address)) throw new SsrfError("private_address");
  return answers[0];
}
