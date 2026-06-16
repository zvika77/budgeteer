import "server-only";

import type Database from "better-sqlite3";
import { toJerusalemDate } from "@/server/lib/date-utils";

export function backfillBillingLocalDate(db: Database.Database): void {
  const rows = db
    .prepare(
      "SELECT id, processed_date FROM transactions WHERE billing_local_date IS NULL AND processed_date IS NOT NULL",
    )
    .all() as { id: number; processed_date: string }[];
  if (rows.length === 0) return;

  const update = db.prepare("UPDATE transactions SET billing_local_date = ? WHERE id = ?");
  db.transaction(() => {
    for (const row of rows) {
      update.run(toJerusalemDate(row.processed_date), row.id);
    }
  })();
}
