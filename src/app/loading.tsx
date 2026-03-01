export default function RootLoading() {
  return (
    <div className="min-h-screen">
      <div className="h-20 border-b border-slate-300/60 bg-slate-200/80 dark:border-slate-700/70 dark:bg-slate-950/85" />
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
        <div className="grid gap-6 animate-pulse">
          <section className="rounded-3xl border border-slate-300/70 bg-white/70 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/50">
            <div className="h-8 w-72 rounded-lg bg-slate-300/80 dark:bg-slate-700/70" />
            <div className="mt-4 h-12 w-full rounded-xl bg-slate-200/80 dark:bg-slate-800/70" />
            <div className="mt-3 h-16 w-full rounded-xl bg-slate-200/70 dark:bg-slate-800/60" />
          </section>
          <section className="grid gap-4 lg:grid-cols-3">
            <div className="h-64 rounded-3xl border border-slate-300/70 bg-white/70 dark:border-slate-700 dark:bg-slate-900/50" />
            <div className="h-64 rounded-3xl border border-slate-300/70 bg-white/70 dark:border-slate-700 dark:bg-slate-900/50" />
            <div className="h-64 rounded-3xl border border-slate-300/70 bg-white/70 dark:border-slate-700 dark:bg-slate-900/50" />
          </section>
        </div>
      </div>
    </div>
  );
}
