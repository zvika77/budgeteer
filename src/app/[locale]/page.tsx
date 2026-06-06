import { redirect } from "next/navigation";
import { HomePage } from "@/components/home/home-page";
import { AppShell } from "@/components/layout/app-shell";
import { isAppOnboarded } from "@/server/lib/app-state";

export const dynamic = "force-dynamic";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  if (!isAppOnboarded()) {
    const { locale } = await params;
    redirect(`/${locale}/setup`);
  }

  return (
    <AppShell>
      <HomePage />
    </AppShell>
  );
}
