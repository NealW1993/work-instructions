export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-6xl items-center px-4 py-10 md:px-8">
      <div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr] md:items-center">
        <section>
          <h1 className="text-4xl font-extrabold leading-tight text-slate-900 dark:text-slate-100 md:text-5xl">
            Fast, visual work instructions that you create.
          </h1>
        </section>
        <section>{children}</section>
      </div>
    </main>
  );
}
