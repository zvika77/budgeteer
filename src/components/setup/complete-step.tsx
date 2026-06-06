"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function CompleteStep({ onFinish }: { onFinish: () => void }) {
  const t = useTranslations("setup");
  const tips = [t("completeTip1"), t("completeTip2"), t("completeTip3")];

  return (
    <div className="mx-auto w-full max-w-[520px] space-y-7 pt-4 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 14, stiffness: 160, delay: 0.05 }}
        className="mx-auto flex size-24 items-center justify-center rounded-full bg-primary/15"
      >
        {/* Brand mark; local static SVG, next/image adds no value here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Budgeteer" className="size-14" />
      </motion.div>

      <div>
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
          {t("completeStep")}
        </div>
        <motion.h1
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="mt-2 text-4xl font-semibold leading-tight tracking-tight"
        >
          {t("completeTitle")}
        </motion.h1>
        <motion.p
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.22 }}
          className="mx-auto mt-2 max-w-md text-sm text-muted-foreground"
        >
          {t("completeDescription")}
        </motion.p>
      </div>

      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="rounded-xl border border-border bg-card p-4 text-start"
      >
        <ul className="flex flex-col gap-2.5">
          {tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Check className="size-3" />
              </span>
              <span className="text-muted-foreground">{tip}</span>
            </li>
          ))}
        </ul>
      </motion.div>

      <div className="flex justify-center">
        <Button size="lg" onClick={onFinish}>
          {t("completeOpenDashboard")}
        </Button>
      </div>
    </div>
  );
}
