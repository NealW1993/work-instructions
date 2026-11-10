import "server-only";

import nodemailer from "nodemailer";

import { serverEnv } from "@/lib/env.server";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: serverEnv.SMTP_HOST,
      port: serverEnv.SMTP_PORT,
      secure: false,
      // Fail fast when the mail server is unreachable instead of holding work open for minutes.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
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

function resolveAppUrl(href: string | null | undefined) {
  if (!href) {
    return null;
  }

  try {
    return new URL(href, serverEnv.NEXT_PUBLIC_APP_URL || "http://localhost:3000").toString();
  } catch {
    return null;
  }
}

export async function sendUserNotificationEmail(options: {
  to: string;
  recipientName?: string | null;
  title: string;
  body: string;
  href?: string | null;
  actorName?: string | null;
}) {
  const mailer = getTransporter();
  const safeTitle = escapeHtml(options.title);
  const safeBody = escapeHtml(options.body);
  const safeRecipientName = escapeHtml(options.recipientName?.trim() || "there");
  const safeActorName = escapeHtml(options.actorName?.trim() || "Work Instructions");
  const actionUrl = resolveAppUrl(options.href);
  const safeActionUrl = actionUrl ? escapeHtml(actionUrl) : null;

  await mailer.sendMail({
    from: serverEnv.SMTP_FROM,
    to: options.to,
    subject: options.title,
    text:
      `${options.title}\n\n` +
      `${options.body}\n\n` +
      `From: ${options.actorName?.trim() || "Work Instructions"}\n` +
      (actionUrl ? `Open: ${actionUrl}\n` : ""),
    html: `
      <div style="margin:0;background:#f3f6fb;padding:24px;font-family:Arial,sans-serif;color:#111827;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;border-collapse:collapse;">
          <tr>
            <td style="padding:0 0 12px 0;">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0e7490;">Work Instructions</div>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #d8dee9;border-radius:14px;padding:26px;box-shadow:0 16px 36px rgba(15,23,42,0.10);">
              <p style="margin:0 0 14px 0;font-size:15px;line-height:1.45;color:#475569;">Hi ${safeRecipientName},</p>
              <h1 style="margin:0 0 12px 0;font-size:24px;line-height:1.2;color:#0f172a;">${safeTitle}</h1>
              <p style="margin:0 0 20px 0;font-size:16px;line-height:1.55;color:#334155;">${safeBody}</p>
              ${
                safeActionUrl
                  ? `<a href="${safeActionUrl}" style="display:inline-block;border-radius:10px;background:#0891b2;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;">Open in system</a>`
                  : ""
              }
              <p style="margin:22px 0 0 0;font-size:12px;line-height:1.45;color:#64748b;">Notification from ${safeActorName}. Change delivery preferences anytime in Account Settings.</p>
            </td>
          </tr>
        </table>
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
