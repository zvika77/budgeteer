import { redirect } from "next/navigation";
import { isAppOnboarded } from "@/server/lib/app-state";

export const dynamic = "force-dynamic";

export default async function SettingsRoot({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isAppOnboarded()) {
    redirect(`/${locale}/setup`);
  }
  redirect(`/${locale}/settings/general`);
}
