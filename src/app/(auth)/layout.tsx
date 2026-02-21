export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-6xl items-center px-4 py-10 md:px-8">
      <div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr] md:items-center">
        <section className="space-y-4">
          <p className="inline-flex rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-200">
            Internal Operations
          </p>
          <h1 className="text-4xl font-extrabold leading-tight text-slate-900 dark:text-slate-100 md:text-5xl">
            Fast, visual work instructions for the floor.
          </h1>
          <p className="max-w-xl text-slate-600 dark:text-slate-300">
            Search by part number or mold number, attach photos/videos directly
            from tablets, and keep revision history centralized.
          </p>
        </section>
        <section>{children}</section>
      </div>
    </main>
  );
}