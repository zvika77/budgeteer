import "server-only";

import { completeSyncRun, createSyncRun } from "../db/queries/sync-runs";
import {
  type ImportedTransactionInput,
  insertImportedTransactions,
} from "../db/queries/transactions";
import { toLocalISODate } from "../lib/date-utils";

export type ImportSource = "csv" | "manual";

export interface CommitImportRow {
  date: string;
  description: string;
  /** Signed: negative = expense, positive = income. */
  amount: number;
  currency?: string;
  memo?: string | null;
}

export interface CommitImportInput {
  accountName: string;
  rows: CommitImportRow[];
  source: ImportSource;
}

export interface CommitImportResult {
  added: number;
  updated: number;
  accountName: string;
}

const MAX_ROWS = 50_000;

/**
 * Persist a batch of locally-imported transactions: open a sync_run for the
 * audit trail, insert (idempotently) and close it. Shared by the CSV upload and
 * the manual single-entry routes.
 */
export function commitImport(workspaceId: number, input: CommitImportInput): CommitImportResult {
  const accountName =
    input.accountName.trim() || (input.source === "manual" ? "Manual" : "Imported");
  const rows = input.rows.slice(0, MAX_ROWS).filter((r) => r.date && Number.isFinite(r.amount));

  const today = toLocalISODate(new Date());
  const fromDate = rows.reduce((min, r) => (r.date < min ? r.date : min), today);

  const syncRunId = createSyncRun(workspaceId, input.source, null, fromDate);
  const mapped: ImportedTransactionInput[] = rows.map((r) => ({
    accountNumber: accountName,
    date: r.date,
    description: r.description,
    amount: r.amount,
    currency: r.currency ?? "ILS",
    memo: r.memo ?? null,
  }));
  const result = insertImportedTransactions(workspaceId, mapped, input.source, syncRunId);
  completeSyncRun(syncRunId, result.added, result.updated);

  return { added: result.added, updated: result.updated, accountName };
}
