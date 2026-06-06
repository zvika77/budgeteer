import { redirect } from "next/navigation";
import { SetupWizard } from "@/components/setup/setup-wizard";
import { isAppOnboarded } from "@/server/lib/app-state";

export const dynamic = "force-dynamic";

interface SetupPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ force?: string; mode?: string }>;
}

export default async function SetupPage({ params, searchParams }: SetupPageProps) {
  const { force, mode } = await searchParams;

  const newWorkspaceMode = mode === "new-workspace";

  if (!newWorkspaceMode && force !== "1" && isAppOnboarded()) {
    const { locale } = await params;
    redirect(`/${locale}`);
  }

  return <SetupWizard mode={newWorkspaceMode ? "new-workspace" : "first-run"} />;
}
