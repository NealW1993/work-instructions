import { NextRequest, NextResponse } from "next/server";

import { getRequestProfile } from "@/lib/api-auth";
import { serverEnv } from "@/lib/env.server";
import { sendLoginHelpRequestEmail } from "@/lib/mailer";

interface HelpBody {
  name?: string;
  message?: string;
  source?: string;
}

function normalizeSourceLabel(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 80);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as HelpBody;
  const message = body.message?.trim() ?? "";
  const authProfile = await getRequestProfile(request);
  const name = authProfile ? authProfile.full_name.trim() : body.name?.trim() ?? "";
  const requesterEmail = authProfile ? authProfile.email.trim().toLowerCase() : "";
  const sourceLabel =
    normalizeSourceLabel(body.source) ?? (authProfile ? "Account Menu" : "Login Page");

  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  if (name.length > 120) {
    return NextResponse.json({ error: "Name is too long (max 120 characters)." }, { status: 400 });
  }

  if (!message) {
    return NextResponse.json({ error: "Help message is required." }, { status: 400 });
  }

  if (message.length > 4000) {
    return NextResponse.json(
      { error: "Help message is too long (max 4000 characters)." },
      { status: 400 },
    );
  }

  const adminEmail = serverEnv.SYSTEM_ADMIN_EMAIL.trim().toLowerCase();
  if (!adminEmail) {
    return NextResponse.json(
      { error: "Help endpoint is not configured." },
      { status: 503 },
    );
  }

  try {
    await sendLoginHelpRequestEmail({
      to: adminEmail,
      name,
      requesterEmail: requesterEmail || null,
      sourceLabel,
      replyTo: requesterEmail || undefined,
      message,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const normalizedMessage =
      error instanceof Error ? error.message : "Unable to send help request.";

    return NextResponse.json({ error: normalizedMessage }, { status: 500 });
  }
}
