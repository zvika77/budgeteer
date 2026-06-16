"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { DateBasis } from "@/lib/date-basis";
import { setDateBasis, useDateBasis } from "@/lib/date-basis-store";

export function DateBasisToggle() {
  const t = useTranslations("transactions");
  const queryClient = useQueryClient();
  const basis = useDateBasis();

  const select = (next: DateBasis) => {
    if (next === basis) return;
    setDateBasis(next);
    queryClient.invalidateQueries();
  };

  const options: { value: DateBasis; label: string }[] = [
    { value: "purchase", label: t("dateBasisPurchase") },
    { value: "billing", label: t("dateBasisBilling") },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="inline-flex rounded-full border border-border/70 bg-background p-0.5"
        role="group"
        aria-label={t("dateBasisAriaLabel")}
      >
        {options.map((opt) => {
          const active = opt.value === basis;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => select(opt.value)}
              className={
                active
                  ? "rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background transition-colors"
                  : "rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-muted-foreground">
        {basis === "billing" ? t("dateBasisCaptionBilling") : t("dateBasisCaptionPurchase")}
      </span>
    </div>
  );
}
