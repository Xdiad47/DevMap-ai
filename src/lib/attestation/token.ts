import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token for the client's link. Only its SHA-256 is stored; the SQL uses the identical hash. */
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
