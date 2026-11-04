import { isIP } from "node:net";

/**
 * "Is this address safe to connect to from our server?" = "is it a public, globally-routable address?".
 * Parsing is done by hand into integers/BigInts and compared against CIDR ranges, because string tricks
 * (`::ffff:10.0.0.1`, `0x7f.1`, leading zeros) are exactly how SSRF filters get bypassed.
 *
 * Anything we cannot parse is treated as NOT public.
 */

function parseV4(s: string): number | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function parseV6(input: string): bigint | null {
  let s = input;
  if (s.includes("%")) return null; // zone ids (fe80::1%eth0) have no business in a public answer
  let tailV4: number | null = null;
  const lastColon = s.lastIndexOf(":");
  if (s.includes(".")) {
    tailV4 = parseV4(s.slice(lastColon + 1));
    if (tailV4 === null) return null;
    s = s.slice(0, lastColon + 1) + "0:0"; // placeholder for the two 16-bit groups, replaced below
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array(missing).fill("0"), ...tail];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  if (tailV4 !== null) n = (n & ~0xffffffffn) | BigInt(tailV4);
  return n;
}

const v4 = (a: number, b: number, c: number, d: number, bits: number): [number, number] => [((a * 256 + b) * 256 + c) * 256 + d, bits];
const DENY_V4: [number, number][] = [
  v4(0, 0, 0, 0, 8), // "this network"
  v4(10, 0, 0, 0, 8), // RFC 1918
  v4(100, 64, 0, 0, 10), // carrier-grade NAT
  v4(127, 0, 0, 0, 8), // loopback
  v4(169, 254, 0, 0, 16), // link-local incl. cloud metadata 169.254.169.254
  v4(172, 16, 0, 0, 12), // RFC 1918
  v4(192, 0, 0, 0, 24), // IETF protocol assignments
  v4(192, 0, 2, 0, 24), // documentation
  v4(192, 88, 99, 0, 24), // 6to4 relay (deprecated)
  v4(192, 168, 0, 0, 16), // RFC 1918
  v4(198, 18, 0, 0, 15), // benchmarking
  v4(198, 51, 100, 0, 24), // documentation
  v4(203, 0, 113, 0, 24), // documentation
  v4(224, 0, 0, 0, 4), // multicast
  v4(240, 0, 0, 0, 4), // reserved + broadcast
];

function inV4(n: number, [base, bits]: [number, number]): boolean {
  const size = 2 ** (32 - bits);
  return Math.floor(n / size) === Math.floor(base / size);
}

const v6 = (hex: string, bits: number): [bigint, number] => [BigInt("0x" + hex.padEnd(32, "0")), bits];
const DENY_V6: [bigint, number][] = [
  v6("0", 96), // ::/96  unspecified, loopback ::1, deprecated IPv4-compatible
  v6("0064ff9b0001", 48), // 64:ff9b:1::/48 local-use NAT64
  v6("0100000000000000", 64), // 100::/64 discard-only
  v6("20010000", 32), // 2001::/32 Teredo
  v6("20010db8", 32), // 2001:db8::/32 documentation
  v6("fc", 7), // fc00::/7 unique local (RFC 4193)
  v6("fe8", 10), // fe80::/10 link-local
  v6("fec", 10), // fec0::/10 site-local (deprecated)
  v6("ff", 8), // ff00::/8 multicast
];

function inV6(n: bigint, [base, bits]: [bigint, number]): boolean {
  const shift = BigInt(128 - bits);
  return n >> shift === base >> shift;
}

export function isPublicIPv4(n: number): boolean {
  return !DENY_V4.some((c) => inV4(n, c));
}

export function isPublicIPv6(n: bigint): boolean {
  const low32 = Number(n & 0xffffffffn);
  if (n >> 32n === 0xffffn) return isPublicIPv4(low32); // ::ffff:a.b.c.d  IPv4-mapped -> judge the embedded v4
  // 64:ff9b::/96 NAT64 -> judge the embedded v4
  if (n >> 32n === 0x0064ff9b0000000000000000n) return isPublicIPv4(low32);
  // 2002::/16 6to4 -> the embedded v4 is bits 16..47
  if (n >> 112n === 0x2002n) return isPublicIPv4(Number((n >> 80n) & 0xffffffffn));
  return !DENY_V6.some((c) => inV6(n, c));
}

/** True only for a syntactically valid IP that is publicly routable. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = parseV4(ip);
    return n !== null && isPublicIPv4(n);
  }
  if (kind === 6) {
    const n = parseV6(ip);
    return n !== null && isPublicIPv6(n);
  }
  return false;
}

