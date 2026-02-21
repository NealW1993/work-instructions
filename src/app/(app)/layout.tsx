import { AppHeader } from "@/components/layout/app-header";
import { requireAuthenticatedUser } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireAuthenticatedUser();

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
        {children}
      </main>
    </div>
  );
}