import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ImportPage } from "@/components/import/import-page";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("import") };
}

export default function Import() {
  return (
    <AppShell>
      <ImportPage />
    </AppShell>
  );
}
