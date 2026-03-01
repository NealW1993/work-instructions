import "server-only";

import nodemailer from "nodemailer";

import { serverEnv } from "@/lib/env.server";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: serverEnv.SMTP_HOST,
      port: serverEnv.SMTP_PORT,
      secure: false,
      auth:
        serverEnv.SMTP_USER && serverEnv.SMTP_PASS
          ? {
              user: serverEnv.SMTP_USER,
              pass: serverEnv.SMTP_PASS,
            }
          : undefined,
    });
  }

  return transporter;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendAnonymousFeedbackEmail(options: {
  to: string;
  message: string;
}) {
  const mailer = getTransporter();
  const submittedAt = new Date().toISOString();
  const safeMessage = escapeHtml(options.message);

  await mailer.sendMail({
    from: serverEnv.SMTP_FROM,
    to: options.to,
    subject: "Anonymous Work Instructions Feedback",
    text:
      "Anonymous feedback received from the login page.\n\n" +
      `Submitted at (UTC): ${submittedAt}\n\n` +
      options.message,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;">
        <h2>Anonymous Login Feedback</h2>
        <p><strong>Submitted at (UTC):</strong> ${submittedAt}</p>
        <p style="white-space:pre-wrap;">${safeMessage}</p>
      </div>
    `,
  });
}

export async function sendLoginHelpRequestEmail(options: {
  to: string;
  name: string;
  requesterEmail?: string | null;
  sourceLabel?: string;
  replyTo?: string;
  message: string;
}) {
  const mailer = getTransporter();
  const submittedAt = new Date().toISOString();
  const safeName = escapeHtml(options.name);
  const safeEmail = escapeHtml(options.requesterEmail?.trim() ?? "");
  const sourceLabel = options.sourceLabel?.trim() || "Login Page";
  const safeMessage = escapeHtml(options.message);
  const hasEmail = safeEmail.length > 0;

  await mailer.sendMail({
    from: serverEnv.SMTP_FROM,
    to: options.to,
    replyTo: options.replyTo?.trim() || undefined,
    subject: "User Help Request",
    text:
      "Help request received.\n\n" +
      `Source: ${sourceLabel}\n` +
      `Name: ${options.name}\n` +
      (options.requesterEmail ? `Email: ${options.requesterEmail}\n` : "") +
      `Submitted at (UTC): ${submittedAt}\n\n` +
      options.message,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;">
        <h2>User Help Request</h2>
        <p><strong>Source:</strong> ${escapeHtml(sourceLabel)}</p>
        <p><strong>Name:</strong> ${safeName}</p>
        ${
          hasEmail
            ? `<p><strong>Email:</strong> ${safeEmail}</p>`
            : ""
        }
        <p><strong>Submitted at (UTC):</strong> ${submittedAt}</p>
        <p style="white-space:pre-wrap;">${safeMessage}</p>
      </div>
    `,
  });
}
