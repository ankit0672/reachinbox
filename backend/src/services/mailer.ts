import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";
import type { Sender } from "../generated/prisma/client.js";

// One pooled SMTP transport per sender, created lazily and reused.
const transports = new Map<string, Transporter>();

function transportFor(sender: Sender): Transporter {
  let transport = transports.get(sender.id);
  if (!transport) {
    transport = nodemailer.createTransport({
      pool: true,
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: sender.smtpPort === 465,
      auth: { user: sender.smtpUser, pass: sender.smtpPass },
      // Bounded (nodemailer's socket default is 10 min) so a hung send can't
      // outlive STALE_PROCESSING_MS and be mistaken for a crashed one.
      connectionTimeout: env.SMTP_TIMEOUT_MS,
      greetingTimeout: env.SMTP_TIMEOUT_MS,
      socketTimeout: env.SMTP_TIMEOUT_MS,
    });
    transports.set(sender.id, transport);
  }
  return transport;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  messageId?: string;
}

export interface SentMail {
  messageId: string;
  previewUrl: string | null;
}

export async function sendMail(sender: Sender, mail: OutgoingMail): Promise<SentMail> {
  const info = await transportFor(sender).sendMail({
    from: `"${sender.label}" <${sender.email}>`,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    messageId: mail.messageId,
  });
  const previewUrl = nodemailer.getTestMessageUrl(info);
  return { messageId: info.messageId, previewUrl: previewUrl || null };
}

export function closeTransports(): void {
  for (const transport of transports.values()) transport.close();
  transports.clear();
}
