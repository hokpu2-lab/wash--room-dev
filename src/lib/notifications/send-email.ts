import "server-only";

import nodemailer from "nodemailer";

export async function sendNotificationEmail(input: {
  to: string;
  subject: string;
  text: string;
}) {
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.trim();
  const from = process.env.NOTIFICATION_EMAIL_FROM?.trim() || gmailUser;
  if (gmailUser && gmailAppPassword && from) {
    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: gmailUser, pass: gmailAppPassword },
      });
      await transporter.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
      return { ok: true as const, reason: "sent" as const };
    } catch {
      return { ok: false as const, reason: "failed" as const };
    }
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!from || !apiKey) {
    return { ok: false as const, reason: "not_configured" as const };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    }),
  });
  return response.ok
    ? { ok: true as const, reason: "sent" as const }
    : { ok: false as const, reason: "failed" as const };
}
