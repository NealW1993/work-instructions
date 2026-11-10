import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-4 py-12">
      <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-8">
        <FileQuestion aria-hidden="true" size={30} className="text-slate-400" />
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Page unavailable</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">This address may have changed, or the content may no longer be available to your account. Use the document library to find the current version.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/doc-center" className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800">Open document library</Link>
          <Link href="/dashboard" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Go to dashboard</Link>
        </div>
      </section>
    </main>
  );
}
