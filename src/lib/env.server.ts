import "server-only";

import { clientEnv } from "@/lib/env.client";

export const serverEnv = {
  ...clientEnv,
  SUPABASE_URL_INTERNAL: process.env.SUPABASE_URL_INTERNAL ?? "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY?.trim() ?? "",
  OPENAI_ENHANCE_MODEL: process.env.OPENAI_ENHANCE_MODEL?.trim() ?? "gpt-4.1-mini",
  SMTP_HOST: process.env.SMTP_HOST ?? "mailpit",
  SMTP_PORT: Number.parseInt(process.env.SMTP_PORT ?? "1025", 10),
  SMTP_USER: process.env.SMTP_USER ?? "",
  SMTP_PASS: process.env.SMTP_PASS ?? "",
  SMTP_FROM: process.env.SMTP_FROM ?? "Work Instructions <noreply@local.test>",
  SYSTEM_ADMIN_EMAIL: process.env.SYSTEM_ADMIN_EMAIL ?? "",
};

export function assertServerEnv(): void {
  const required: Array<keyof typeof serverEnv> = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];

  const missing = required.filter((key) => !serverEnv[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
}
