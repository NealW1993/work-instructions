export const clientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "",
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "http://localhost:3000",
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? "",
  NEXT_PUBLIC_POSTHOG_HOST:
    process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() ?? "https://us.i.posthog.com",
} as const;

export function hasRequiredClientEnv(): boolean {
  return (
    Boolean(clientEnv.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}
