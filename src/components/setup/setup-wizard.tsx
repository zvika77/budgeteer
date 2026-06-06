"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { AddMoneyStep } from "@/components/setup/add-money-step";
import { BalanceStep } from "@/components/setup/balance-step";
import { CompleteStep } from "@/components/setup/complete-step";
import { WelcomeStep } from "@/components/setup/welcome-step";
import { WorkspaceNameStep } from "@/components/setup/workspace-name-step";
import { useRouter } from "@/i18n/navigation";
import { completeSetup, createWorkspace } from "@/lib/api";
import { GITHUB_REPO_URL } from "@/lib/constants";
import { setActiveWorkspaceId } from "@/lib/workspace-store";

export type SetupMode = "first-run" | "new-workspace";

type Step = "name" | "welcome" | "money" | "balance" | "done";

interface StepDef {
  key: Step;
  labelKey: string;
}

const FIRST_RUN_STEPS: StepDef[] = [
  { key: "welcome", labelKey: "stepWelcome" },
  { key: "money", labelKey: "stepAddMoney" },
  { key: "balance", labelKey: "stepBalance" },
  { key: "done", labelKey: "stepDone" },
];

const NEW_WORKSPACE_STEPS: StepDef[] = [
  { key: "name", labelKey: "stepName" },
  { key: "money", labelKey: "stepAddMoney" },
  { key: "balance", labelKey: "stepBalance" },
  { key: "done", labelKey: "stepDone" },
];

export function SetupWizard({ mode = "first-run" }: { mode?: SetupMode }) {
  const t = useTranslations("setup");
  const router = useRouter();
  const queryClient = useQueryClient();
  const steps = mode === "new-workspace" ? NEW_WORKSPACE_STEPS : FIRST_RUN_STEPS;
  const [step, setStep] = useState<Step>(mode === "new-workspace" ? "name" : "welcome");
  const [creating, setCreating] = useState(false);

  async function handleNameSubmit(name: string) {
    setCreating(true);
    try {
      const ws = await createWorkspace(name);
      setActiveWorkspaceId(ws.id);
      queryClient.invalidateQueries();
      setStep("money");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("workspaceCreateFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function handleFinish() {
    try {
      await completeSetup();
    } catch {
      // The onboarded flag is best-effort; imported data also unlocks the app.
    }
    queryClient.invalidateQueries();
    router.push("/");
  }

  const firstStep: Step = mode === "new-workspace" ? "name" : "welcome";

  return (
    <div className="relative min-h-screen bg-background">
      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-6 md:px-8">
        <BrandMark />
        <DotStepper step={step} steps={steps} />
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="hidden text-xs text-muted-foreground hover:text-foreground md:inline"
        >
          {t("docs")}
        </a>
      </header>

      <main className="relative z-10 mx-auto px-6 pb-16 md:px-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.2, 0.7, 0.3, 1] }}
          >
            {step === "name" && (
              <WorkspaceNameStep onComplete={handleNameSubmit} submitting={creating} />
            )}
            {step === "welcome" && <WelcomeStep onComplete={() => setStep("money")} />}
            {step === "money" && (
              <AddMoneyStep
                onComplete={() => setStep("balance")}
                onBack={() => setStep(firstStep)}
              />
            )}
            {step === "balance" && (
              <BalanceStep onComplete={() => setStep("done")} onBack={() => setStep("money")} />
            )}
            {step === "done" && <CompleteStep onFinish={handleFinish} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function BrandMark() {
  const tNav = useTranslations("nav");
  return (
    <div className="flex items-center gap-2.5">
      {/* Brand mark; local static SVG, next/image adds no value here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="Budgeteer" className="h-8 w-8" />
      <div>
        <div className="text-lg font-semibold leading-none tracking-tight">Budgeteer</div>
        <div className="mt-1 text-[8px] font-bold tracking-[0.18em] text-muted-foreground">
          {tNav("brandTagline")}
        </div>
      </div>
    </div>
  );
}

function DotStepper({ step, steps }: { step: Step; steps: ReadonlyArray<StepDef> }) {
  const t = useTranslations("setup");
  const currentIdx = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const state = i < currentIdx ? "done" : i === currentIdx ? "active" : "todo";
        return (
          <div key={s.key} className="flex items-center gap-2">
            <DotLabel label={t(s.labelKey)} state={state} />
            {i < steps.length - 1 && (
              <motion.div
                animate={{ background: i < currentIdx ? "var(--primary)" : "var(--border)" }}
                transition={{ duration: 0.35 }}
                className="h-px w-3.5 rounded-full"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DotLabel({ label, state }: { label: string; state: "todo" | "active" | "done" }) {
  return (
    <div className="flex items-center gap-1.5">
      <motion.div
        animate={{
          background:
            state === "active"
              ? "var(--foreground)"
              : state === "done"
                ? "var(--primary)"
                : "var(--border)",
          scale: state === "active" ? 1.4 : 1,
        }}
        transition={{ duration: 0.25 }}
        className="h-1.5 w-1.5 rounded-full"
      />
      <span
        className={`text-[9px] font-bold uppercase tracking-[0.14em] transition-colors ${
          state === "active"
            ? "text-foreground"
            : state === "done"
              ? "text-primary"
              : "text-muted-foreground/60"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
