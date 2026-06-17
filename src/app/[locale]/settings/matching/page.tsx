"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { SectionShell, SettingCard } from "@/components/settings/section-shell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Locale } from "@/i18n/routing";
import { getCardBillMatching, linkCardBill, rebuildCardMatching, unlinkCardBill } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/formatters";

const AUTO = "__auto__";

export default function MatchingSettingsPage() {
  const t = useTranslations("settings.matching");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["cardBillMatching"], queryFn: getCardBillMatching });

  const [pending, setPending] = useState<Record<number, string>>({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["cardBillMatching"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["summary"] });
  };

  const rebuild = useMutation({
    mutationFn: rebuildCardMatching,
    onSuccess: (res) => {
      invalidate();
      toast.success(t("rebuildDone"));
      if (res.warnings.length > 0) {
        toast.warning(t("warning", { count: res.warnings.length }));
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : tCommon("saveFailed")),
  });

  const apply = useMutation({
    mutationFn: async () => {
      for (const [billIdStr, value] of Object.entries(pending)) {
        const billId = Number(billIdStr);
        if (value === AUTO) await unlinkCardBill(billId);
        else await linkCardBill(billId, value);
      }
      return rebuildCardMatching();
    },
    onSettled: () => {
      setPending({});
      invalidate();
    },
    onSuccess: (res) => {
      toast.success(t("rebuildDone"));
      if (res.warnings.length > 0) {
        toast.warning(t("warning", { count: res.warnings.length }));
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : tCommon("saveFailed")),
  });

  const bills = data?.bills ?? [];
  const cards = data?.cards ?? [];
  const dirty = Object.keys(pending).length > 0;

  return (
    <SectionShell title={t("title")} description={t("description")}>
      <SettingCard title={t("rebuildTitle")} description={t("rebuildDescription")}>
        <div className="flex justify-end">
          <Button onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>
            {rebuild.isPending ? t("rebuilding") : t("rebuildButton")}
          </Button>
        </div>
      </SettingCard>

      <SettingCard title={t("unmatchedTitle")} description={t("unmatchedDescription")}>
        {data === undefined ? (
          <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
        ) : bills.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noBills")}</p>
        ) : (
          <div className="space-y-3">
            {bills.map((bill) => {
              const current = pending[bill.billTransactionId] ?? bill.linkedAccountNumber ?? AUTO;
              return (
                <div
                  key={bill.billTransactionId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{bill.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(bill.date.slice(0, 10))}
                    </p>
                  </div>
                  <span className="shrink-0 tabular-nums text-sm">
                    {formatCurrency(bill.chargedAmount, bill.chargedCurrency ?? "ILS", locale)}
                  </span>
                  <Select
                    value={current}
                    onValueChange={(v) => {
                      if (!v) return;
                      const serverValue = bill.linkedAccountNumber ?? AUTO;
                      setPending((p) => {
                        const next = { ...p };
                        if (v === serverValue) delete next[bill.billTransactionId];
                        else next[bill.billTransactionId] = v;
                        return next;
                      });
                    }}
                  >
                    <SelectTrigger className="min-w-[10rem] max-w-[14rem] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO}>{t("auto")}</SelectItem>
                      {cards.map((c) => (
                        <SelectItem key={c.accountNumber} value={c.accountNumber}>
                          {c.name ? `${c.name} (${c.accountNumber})` : c.accountNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
            <div className="flex justify-end">
              <Button onClick={() => apply.mutate()} disabled={!dirty || apply.isPending}>
                {apply.isPending ? t("applying") : t("applyButton")}
              </Button>
            </div>
          </div>
        )}
      </SettingCard>
    </SectionShell>
  );
}
