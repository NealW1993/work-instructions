"use client";

import Link from "next/link";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="mx-auto grid max-w-xl justify-items-start gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-8">
      <AlertCircle aria-hidden="true" size={30} className="text-amber-600 dark:text-amber-400" />
      <div className="grid gap-2">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">This page could not be loaded</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Try loading it again. If the problem continues, share the page address and reference below with your administrator.</p>
        {error.digest ? <p className="text-xs text-slate-500">Reference: <code>{error.digest}</code></p> : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-800"><RefreshCw size={15} aria-hidden="true" />Try again</button>
        <Link href="/dashboard" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Go to dashboard</Link>
      </div>
    </section>
  );
}
