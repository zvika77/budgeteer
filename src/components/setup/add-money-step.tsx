"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ImportPanel } from "@/components/import/import-panel";
import { Button } from "@/components/ui/button";

interface AddMoneyStepProps {
  onComplete: () => void;
  onBack: () => void;
}

export function AddMoneyStep({ onComplete, onBack }: AddMoneyStepProps) {
  const t = useTranslations("setup");
  const tc = useTranslations("common");
  const [imported, setImported] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-6">
      <header className="space-y-2">
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {t("addMoneyStep")}
        </div>
        <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight">
          {t("addMoneyTitle")}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("addMoneyDescription")}</p>
      </header>

      <div className="rounded-xl border border-border bg-card p-5">
        <ImportPanel onImported={() => setImported(true)} />
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-3">
        <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
          <Info className="size-3" />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("addMoneyBankNote")}</p>
      </div>

      <footer className="flex items-center justify-between pt-1">
        <Button variant="outline" onClick={onBack}>
          ← {tc("back")}
        </Button>
        <Button onClick={onComplete}>{imported ? `${tc("continue")} →` : t("addMoneySkip")}</Button>
      </footer>
    </div>
  );
}
