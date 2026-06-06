"use client";

import { motion } from "framer-motion";
import { HeartHandshake, Laptop, Lock, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function WelcomeStep({ onComplete }: { onComplete: () => void }) {
  const t = useTranslations("setup");
  const points = [
    { Icon: Laptop, title: t("welcomePointLocalTitle"), body: t("welcomePointLocalBody") },
    { Icon: Lock, title: t("welcomePointPrivateTitle"), body: t("welcomePointPrivateBody") },
    { Icon: HeartHandshake, title: t("welcomePointFreeTitle"), body: t("welcomePointFreeBody") },
  ];

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-7 pt-6 text-center">
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 14, stiffness: 160 }}
        className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary/12 text-primary"
      >
        <Sparkles className="size-8" />
      </motion.div>
      <div className="space-y-2">
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {t("welcomeStep")}
        </div>
        <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight">
          {t("welcomeTitle")}
        </h1>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("welcomeDescription")}
        </p>
      </div>

      <div className="grid gap-3 text-start sm:grid-cols-3">
        {points.map(({ Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-border bg-card p-4">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </span>
            <div className="mt-2.5 text-sm font-semibold">{title}</div>
            <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{body}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-center">
        <Button size="lg" onClick={onComplete}>
          {t("welcomeCta")}
        </Button>
      </div>
    </div>
  );
}
