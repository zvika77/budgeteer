import "server-only";

import { anyWorkspaceHasBankCredentials } from "../db/queries/bank-credentials";
import { getGlobalSetting, setGlobalSetting } from "../db/queries/settings";
import { anyWorkspaceHasTransactions } from "../db/queries/transactions";

/**
 * Whether the user has finished onboarding and the main app should be shown.
 * Local-first: any imported/manual transactions count, not just a bank
 * connection. An explicit `onboarded` flag covers the case where someone
 * finished the wizard without importing yet (so they are not bounced back).
 */
export function isAppOnboarded(): boolean {
  if (getGlobalSetting("onboarded") === "true") return true;
  return anyWorkspaceHasBankCredentials() || anyWorkspaceHasTransactions();
}

export function markOnboarded(): void {
  setGlobalSetting("onboarded", "true");
}
