import Link from "next/link";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

interface ResetPasswordPageProps {
  searchParams: Promise<{
    token?: string;
    email?: string;
  }>;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params.token;
  const email = params.email;

  if (!token || !email) {
    return (
      <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-sm text-rose-700 dark:text-rose-200">
        Invalid reset link.
        <div>
          <Link href="/login" className="underline">
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
        Reset Password
      </h1>
      <ResetPasswordForm email={email} token={token} />
      <Link href="/login" className="text-sm underline">
        Back to login
      </Link>
    </div>
  );
}