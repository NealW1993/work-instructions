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

export async function sendPasswordResetEmail(options: {
  to: string;
  fullName: string;
  resetLink: string;
}) {
  const mailer = getTransporter();

  await mailer.sendMail({
    from: serverEnv.SMTP_FROM,
    to: options.to,
    subject: "Work Instructions Password Reset",
    text: `Hi ${options.fullName},\n\nUse the link below to reset your password:\n${options.resetLink}\n\nThis link expires in 60 minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;">
        <h2>Password Reset</h2>
        <p>Hi ${options.fullName},</p>
        <p>Use the link below to reset your password:</p>
        <p><a href="${options.resetLink}">${options.resetLink}</a></p>
        <p>This link expires in 60 minutes.</p>
      </div>
    `,
  });
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
