"use client";

import {
  AlertTriangle,
  CalendarPlus,
  Copy,
  Globe,
  Percent,
  Receipt,
  TrendingUp,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CardShell } from "@/components/home/card-shell";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatCurrency } from "@/lib/formatters";
import type { Anomaly, AnomalyType } from "@/lib/types";

const ICON: Record<AnomalyType, typeof Receipt> = {
  "duplicate-charge": Copy,
  "foreign-charge": Globe,
  "merchant-outlier": TrendingUp,
  "price-creep": Percent,
  "new-subscription": CalendarPlus,
  "interest-charge": Receipt,
  "fee-spike": Receipt,
};

export function AnomaliesCard({ anomalies }: { anomalies: Anomaly[] }) {
  const t = useTranslations("anomalies");
  const locale = useLocale() as Locale;
  const fc = (n: number, currency: string | null) =>
    formatCurrency(Math.abs(n), currency ?? "ILS", locale);

  return (
    <CardShell
      label={t("title")}
      description={anomalies.length > 0 ? t("subtitle", { count: anomalies.length }) : undefined}
      icon={<AlertTriangle />}
    >
      {anomalies.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-10 text-center">
          <p className="text-sm font-medium">{t("emptyTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("emptyBody")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {anomalies.map((a) => {
            const Icon = ICON[a.type];
            const amount = a.amount != null ? fc(a.amount, a.currency) : "";
            const amount2 = a.amount2 != null ? fc(a.amount2, a.currency) : "";
            const percent = a.percent != null ? Math.round(a.percent) : 0;
            const values = {
              merchant: a.merchant ?? "",
              category: a.categoryName ?? "",
              amount,
              amount2,
              percent,
            };
            const isFlag = a.severity === "flag";
            return (
              <li key={a.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                    isFlag
                      ? "bg-status-over/12 text-status-over"
                      : "bg-status-heads-up/12 text-status-heads-up"
                  }`}
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {t(`anom_${a.type}_title`, values)}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t(`anom_${a.type}_body`, values)}
                  </div>
                </div>
                {isFlag ? (
                  <Link
                    href="/review"
                    className="shrink-0 rounded-full bg-status-over/12 px-2.5 py-1 text-xs font-semibold text-status-over"
                  >
                    {t("reviewCta")}
                  </Link>
                ) : (
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground tabular-nums">
                    {amount}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
}
