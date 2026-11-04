import nodemailer from "nodemailer";
import type { MailConfig } from "./mail-config";

export type Mail = { to: string; subject: string; text: string; html: string };
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** No secrets live in this file (the config is passed in), so tests can import it. */
export function createMailer(cfg: MailConfig): Mailer {
  if (cfg.mode === "mock") {
    return {
      async send(m) {
        console.info(`[mail:mock] to=${m.to.replace(/^(.).*(@.*)$/, "$1***$2")} subject="${m.subject}"`);
      },
    };
  }
  const transport = nodemailer.createTransport({ url: cfg.url, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000 });
  return {
    async send(m) {
      await transport.sendMail({ from: cfg.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    },
  };
}
