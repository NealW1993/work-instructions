export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full items-center justify-center px-4 py-6 md:px-8 md:py-8">
      <div className="w-full max-w-6xl">{children}</div>
    </main>
  );
}
