"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/layout/app-shell";
import { Link } from "@/i18n/navigation";
import { ImportPanel } from "./import-panel";

export function ImportPage() {
  const t = useTranslations("import");
  return (
    <>
      <PageHeader title={t("pageTitle")} />
      <div className="p-4 md:p-6 lg:p-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-5">
            <h2 className="text-xl font-semibold tracking-tight">{t("introTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("introBody")}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <ImportPanel />
          </div>
          <div className="mt-4 flex justify-end">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
            >
              {t("goToDashboard")}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
