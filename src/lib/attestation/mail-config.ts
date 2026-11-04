type Env = Record<string, string | undefined>;
export type MailConfig = { mode: "smtp"; url: string; from: string } | { mode: "mock"; from: string };

/**
 * Pure decision logic (unit-tested). SMTP_URL (e.g. smtp://127.0.0.1:54325 for the local Mailpit, or your provider's
 * SMTP URL) is how mail leaves the app, so any provider works. MAIL_MODE=mock only logs: impossible in production.
 */
export function resolveMailConfig(env: Env): MailConfig {
  const from = env.MAIL_FROM || "DevMap <no-reply@devmap.in>";
  if (env.MAIL_MODE === "mock") {
    if (env.NODE_ENV === "production") throw new Error("MAIL_MODE=mock is not allowed in production.");
    return { mode: "mock", from };
  }
  if (!env.SMTP_URL || !/^smtps?:\/\//.test(env.SMTP_URL)) throw new Error("SMTP_URL is missing or not an smtp:// / smtps:// URL.");
  if (env.NODE_ENV === "production" && /127\.0\.0\.1|localhost/.test(env.SMTP_URL)) throw new Error("SMTP_URL points at localhost in production.");
  return { mode: "smtp", url: env.SMTP_URL, from };
}
