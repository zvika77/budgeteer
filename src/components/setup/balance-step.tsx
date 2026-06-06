"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, InputGroup } from "@/components/ui/input";
import { updateSettings } from "@/lib/api";

interface BalanceStepProps {
  onComplete: () => void;
  onBack: () => void;
}

export function BalanceStep({ onComplete, onBack }: BalanceStepProps) {
  const t = useTranslations("setup");
  const tc = useTranslations("common");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const parsed = value.trim() === "" ? null : Number(value);
  const valid = parsed == null || Number.isFinite(parsed);

  async function save(balance: number | null) {
    setSaving(true);
    try {
      await updateSettings({ currentBalance: balance });
      onComplete();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[520px] space-y-6">
      <header className="space-y-2">
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {t("balanceStep")}
        </div>
        <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight">
          {t("balanceTitle")}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("balanceDescription")}</p>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-3">
        <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
          <Info className="size-3" />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("balanceInfo")}</p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="current-balance"
          className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground"
        >
          {t("balanceLabel")}
        </label>
        <InputGroup prefix="₪">
          <Input
            id="current-balance"
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder={t("balancePlaceholder")}
            className="text-end tabular-nums"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: first field of a focused step
            autoFocus
          />
        </InputGroup>
        <p className="text-[11px] text-muted-foreground">{t("balanceChangeHint")}</p>
      </div>

      <footer className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={onBack} disabled={saving}>
          ← {tc("back")}
        </Button>
        <Button onClick={() => save(valid ? parsed : null)} disabled={saving || !valid}>
          {saving ? tc("saving") : `${tc("continue")} →`}
        </Button>
      </footer>

      <div className="flex justify-center pt-1">
        <button
          type="button"
          onClick={() => save(null)}
          disabled={saving}
          className="text-[11px] text-muted-foreground underline decoration-muted-foreground/30 underline-offset-4 transition-colors hover:text-foreground"
        >
          {t("balanceSkip")}
        </button>
      </div>
    </div>
  );
}
