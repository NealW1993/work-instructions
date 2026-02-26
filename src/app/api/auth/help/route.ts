import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { sendLoginHelpRequestEmail } from "@/lib/mailer";

interface HelpBody {
  name?: string;
  message?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as HelpBody;
  const name = body.name?.trim() ?? "";
  const message = body.message?.trim() ?? "";

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
      message,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const normalizedMessage =
      error instanceof Error ? error.message : "Unable to send help request.";

    return NextResponse.json({ error: normalizedMessage }, { status: 500 });
  }
}
