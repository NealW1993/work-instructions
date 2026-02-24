import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { sendAnonymousFeedbackEmail } from "@/lib/mailer";

interface FeedbackBody {
  message?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as FeedbackBody;
  const message = body.message?.trim() ?? "";

  if (!message) {
    return NextResponse.json({ error: "Feedback message is required." }, { status: 400 });
  }

  if (message.length > 4000) {
    return NextResponse.json(
      { error: "Feedback is too long (max 4000 characters)." },
      { status: 400 },
    );
  }

  const adminEmail = serverEnv.SYSTEM_ADMIN_EMAIL.trim().toLowerCase();
  if (!adminEmail) {
    return NextResponse.json(
      { error: "Feedback endpoint is not configured." },
      { status: 503 },
    );
  }

  try {
    await sendAnonymousFeedbackEmail({
      to: adminEmail,
      message,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const normalizedMessage =
      error instanceof Error ? error.message : "Unable to send feedback.";

    return NextResponse.json({ error: normalizedMessage }, { status: 500 });
  }
}
