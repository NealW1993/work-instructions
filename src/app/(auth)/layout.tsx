import { LoginHeroMedia } from "@/components/auth/login-hero-media";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-8">
      <div className="grid min-h-[calc(100vh-3.5rem)] gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="lg:min-h-full">
          <LoginHeroMedia />
        </section>
        <section className="flex items-center justify-center lg:min-h-full">
          <div className="w-full max-w-2xl">{children}</div>
        </section>
      </div>
    </main>
  );
}
