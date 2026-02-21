export const clientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
  NEXT_PUBLIC_POSTHOG_HOST:
    process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
} as const;

export function hasRequiredClientEnv(): boolean {
  return (
    Boolean(clientEnv.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}