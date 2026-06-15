# Israel-Local Date Bucketing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bucket and display every transaction by its Asia/Jerusalem calendar date so monthly aggregates stop dropping end-of-month transactions into a gap between months.

**Architecture:** Add a `local_date` (`YYYY-MM-DD`, Jerusalem) column, populated at insert via `Intl` and backfilled once in JS. All month/day range filters, groupings, and the date display switch from the raw UTC `date` to `local_date`. "Current month / trend month" boundaries are derived from a Jerusalem-anchored today.

**Tech Stack:** Next.js 16, TypeScript strict, better-sqlite3 (raw prepared statements), Bun test (`--conditions react-server`).

---

## Background facts (do not re-derive)

- `date` is stored as the scraper's UTC ISO instant, e.g. `2026-05-31T21:00:00.000Z`.
- For an Israel-based viewer that instant is June 1; the current SQL filter
  `date <= '2026-05-31'` excludes it from May, and `date >= '2026-06-01'` excludes it
  from June, so it is counted in no month.
- Verified target: with the fix, May income for the live selection is **24,999.34**.
- The DB cannot be loaded under `bun test` (better-sqlite3). Only pure-logic code is
  unit-tested; DB behavior is verified via `bun dev` (project memory).
- Do NOT touch matching (`src/server/lib/matching.ts`) or the match-candidate query
  (`getMatchCandidates`, the `gte(date, from)` drizzle query) - matching works on
  instants/`processed_date` and is out of scope.

---

## Task 1: `toJerusalemDate` utility + tests

**Files:**
- Modify: `src/server/lib/date-utils.ts`
- Test: `src/server/lib/date-utils.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/server/lib/date-utils.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { toJerusalemDate } from "@/server/lib/date-utils";

describe("toJerusalemDate", () => {
  test("summer evening UTC rolls to next Jerusalem day", () => {
    expect(toJerusalemDate("2026-05-31T21:00:00.000Z")).toBe("2026-06-01");
    expect(toJerusalemDate("2026-04-30T21:00:00.000Z")).toBe("2026-05-01");
  });
  test("winter evening UTC rolls to next Jerusalem day", () => {
    expect(toJerusalemDate("2025-12-31T22:00:00.000Z")).toBe("2026-01-01");
  });
  test("midday UTC stays on the same Jerusalem day", () => {
    expect(toJerusalemDate("2026-05-15T10:00:00.000Z")).toBe("2026-05-15");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions react-server src/server/lib/date-utils.test.ts`
Expected: FAIL (`toJerusalemDate` is not exported).

- [ ] **Step 3: Implement**

In `src/server/lib/date-utils.ts`, add below the existing `toLocalISODate`:

```ts
const JERUSALEM_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toJerusalemDate(iso: string): string {
  return JERUSALEM_DATE.format(new Date(iso));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --conditions react-server src/server/lib/date-utils.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/date-utils.ts src/server/lib/date-utils.test.ts
git commit -m "feat: add toJerusalemDate util for canonical date bucketing"
```

---

## Task 2: Jerusalem month-range helpers + tests

**Files:**
- Modify: `src/server/lib/date-utils.ts`
- Test: `src/server/lib/date-utils.test.ts`

These pure helpers let boundary derivations (Task 8) avoid server-local `Date` methods.

- [ ] **Step 1: Write the failing test**

Append to `src/server/lib/date-utils.test.ts`:

```ts
import { jerusalemToday, monthStart, monthEnd, shiftMonth } from "@/server/lib/date-utils";

describe("month-range helpers", () => {
  test("monthStart returns first of month", () => {
    expect(monthStart("2026-05-31")).toBe("2026-05-01");
  });
  test("monthEnd returns last day, handling 30/31/28", () => {
    expect(monthEnd("2026-05-15")).toBe("2026-05-31");
    expect(monthEnd("2026-04-10")).toBe("2026-04-30");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
  });
  test("shiftMonth moves by N months keeping first-of-month", () => {
    expect(shiftMonth("2026-05-01", -1)).toBe("2026-04-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
  });
  test("jerusalemToday returns a YYYY-MM-DD string", () => {
    expect(jerusalemToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions react-server src/server/lib/date-utils.test.ts`
Expected: FAIL (helpers not exported).

- [ ] **Step 3: Implement**

Append to `src/server/lib/date-utils.ts`:

```ts
export function jerusalemToday(): string {
  return toJerusalemDate(new Date().toISOString());
}

export function monthStart(localDate: string): string {
  return `${localDate.slice(0, 7)}-01`;
}

export function monthEnd(localDate: string): string {
  const [y, m] = localDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${localDate.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

export function shiftMonth(localDate: string, delta: number): string {
  const [y, m] = localDate.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + delta, 1));
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --conditions react-server src/server/lib/date-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/date-utils.ts src/server/lib/date-utils.test.ts
git commit -m "feat: add Jerusalem month-range date helpers"
```

---

## Task 3: `formatDate` renders a local-date string + tests

**Files:**
- Modify: `src/lib/formatters.ts:53-59`
- Test: `src/lib/formatters.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/formatters.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { formatDate } from "@/lib/formatters";

describe("formatDate", () => {
  test("renders YYYY-MM-DD as dd/mm/yyyy with no timezone shift", () => {
    expect(formatDate("2026-06-01")).toBe("01/06/2026");
    expect(formatDate("2026-12-31")).toBe("31/12/2026");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions react-server src/lib/formatters.test.ts`
Expected: FAIL (current `formatDate` parses via `new Date` and would shift / differ).

- [ ] **Step 3: Implement**

Replace `src/lib/formatters.ts:53-59`:

```ts
export function formatDate(localDate: string): string {
  const [year, month, day] = localDate.split("-");
  return `${day}/${month}/${year}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --conditions react-server src/lib/formatters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/formatters.ts src/lib/formatters.test.ts
git commit -m "feat: formatDate renders canonical local-date string"
```

---

## Task 4: Migration - add `local_date` column + index

**Files:**
- Create: `src/server/db/migrations/026_local_date.sql`
- Modify: `src/server/db/schema.ts:104` (transactions table; add column after `processedDate`)

- [ ] **Step 1: Create the migration**

Create `src/server/db/migrations/026_local_date.sql`:

```sql
ALTER TABLE transactions ADD COLUMN local_date TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_ws_local_date
  ON transactions(workspace_id, local_date);
```

- [ ] **Step 2: Add the column to the drizzle schema**

In `src/server/db/schema.ts`, inside `export const transactions = sqliteTable("transactions", { ... })`, directly after the `processedDate: text("processed_date").notNull(),` line, add:

```ts
  localDate: text("local_date"),
```

- [ ] **Step 3: Verify migration applies**

Run: `bun dev` (let it boot once), then in another shell:
`sqlite3 data/budgeteer.db "PRAGMA table_info(transactions);" | grep local_date`
Expected: a `local_date|TEXT` row. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/migrations/026_local_date.sql src/server/db/schema.ts
git commit -m "feat: add local_date column and index to transactions"
```

---

## Task 5: Populate `local_date` on insert + one-time backfill

**Files:**
- Modify: `src/server/db/queries/transactions.ts` (insert statement, params, ON CONFLICT)
- Create: `src/server/db/backfill-local-date.ts`
- Modify: `src/server/db/index.ts:32` (call backfill after `runMigrations`)

- [ ] **Step 1: Add `local_date` to the INSERT column list and VALUES**

In `src/server/db/queries/transactions.ts`, in the `INSERT INTO transactions ( ... )`
statement, add `local_date` to the column list (after `processed_date`) and
`@localDate` to the VALUES list (after `@processedDate`):

```sql
    INSERT INTO transactions (
      workspace_id, account_number, date, processed_date, local_date, original_amount, original_currency,
      ...
    ) VALUES (
      @workspaceId, @accountNumber, @date, @processedDate, @localDate, @originalAmount, @originalCurrency,
      ...
    )
```

- [ ] **Step 2: Recompute `local_date` in the ON CONFLICT branch**

In the same statement's `ON CONFLICT(...) DO UPDATE SET`, add a line so pending
rows whose instant shifts on resync get a fresh `local_date`:

```sql
      local_date = CASE WHEN transactions.status = 'pending' THEN excluded.local_date ELSE transactions.local_date END,
```

(Place it next to the existing `processed_date = CASE ...` line.)

- [ ] **Step 3: Set `localDate` in the params object**

Import the util at the top of `src/server/db/queries/transactions.ts` (with the
other `@/server/lib/...` imports):

```ts
import { toJerusalemDate } from "@/server/lib/date-utils";
```

In the `params` object built inside `batchInsert`, add after `date: txn.date,`:

```ts
        localDate: toJerusalemDate(txn.date),
```

- [ ] **Step 4: Create the backfill module**

Create `src/server/db/backfill-local-date.ts`:

```ts
import "server-only";

import type Database from "better-sqlite3";
import { toJerusalemDate } from "@/server/lib/date-utils";

export function backfillLocalDate(db: Database.Database): void {
  const rows = db
    .prepare("SELECT id, date FROM transactions WHERE local_date IS NULL")
    .all() as { id: number; date: string }[];
  if (rows.length === 0) return;

  const update = db.prepare("UPDATE transactions SET local_date = ? WHERE id = ?");
  db.transaction(() => {
    for (const row of rows) {
      update.run(toJerusalemDate(row.date), row.id);
    }
  })();
}
```

- [ ] **Step 5: Call backfill after migrations**

In `src/server/db/index.ts`, add the import near the top:

```ts
import { backfillLocalDate } from "@/server/db/backfill-local-date";
```

Then in `createDatabase()`, immediately after `runMigrations(db);`:

```ts
  runMigrations(db);
  backfillLocalDate(db);
```

- [ ] **Step 6: Verify on the dev server**

Run: `bun dev` (boot once), then:
`sqlite3 data/budgeteer.db "SELECT COUNT(*) FROM transactions WHERE local_date IS NULL;"`
Expected: `0`.
`sqlite3 data/budgeteer.db "SELECT date, local_date FROM transactions WHERE id IN (2390,2412);"`
Expected: `2026-05-31T21:00:00.000Z|2026-06-01` and `2026-04-30T21:00:00.000Z|2026-05-01`.
Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/queries/transactions.ts src/server/db/backfill-local-date.ts src/server/db/index.ts
git commit -m "feat: populate and backfill local_date on transactions"
```

---

## Task 6: Expose `localDate` in the transaction payload

**Files:**
- Modify: `src/lib/types.ts:20-50` (add to `Transaction`)
- Modify: `src/server/db/queries/transactions.ts` (`TransactionRow`, `mapTransactionRow`, `TRANSACTION_LIST_SELECT`)

- [ ] **Step 1: Add `localDate` to the `Transaction` type**

In `src/lib/types.ts`, in `interface Transaction`, after `processedDate: string;` add:

```ts
  localDate: string;
```

- [ ] **Step 2: Add `local_date` to `TransactionRow`**

In `src/server/db/queries/transactions.ts`, in the `TransactionRow` interface
(the row shape used by `mapTransactionRow`), add near `processed_date`:

```ts
  local_date: string;
```

- [ ] **Step 3: Map it**

In `mapTransactionRow`, after `processedDate: r.processed_date,` add:

```ts
    localDate: r.local_date,
```

- [ ] **Step 4: Confirm the column is selected**

`TRANSACTION_LIST_SELECT` uses `SELECT t.*, ...`, so `local_date` is already
included. No SQL change needed. Confirm by grepping:
Run: `grep -n "t.\*" src/server/db/queries/transactions.ts`
Expected: the `SELECT t.*, c.name ...` line exists.

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors (every `mapTransactionRow` consumer now gets `localDate`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/server/db/queries/transactions.ts
git commit -m "feat: expose localDate in transaction payload"
```

---

## Task 7: Switch range filters and groupings to `local_date` (transactions.ts)

**Files:**
- Modify: `src/server/db/queries/transactions.ts`

Every month/day range filter and date-part grouping must read `local_date`. The
`from`/`to` arguments are unchanged (already `YYYY-MM-DD`).

- [ ] **Step 1: Range-bound conditions**

In each of these functions, change the date-range bound conditions from `date`
to `local_date` (and the `t.`-aliased variants from `t.date` to `t.local_date`).
The conditions read like `"date >= ?"`, `"date <= ?"`, `"t.date >= ?"`,
`"t.date <= ?"`:

- `queryTransactions` (lines ~258-264: `t.date >= ?` / `t.date <= ?`)
- `getMonthlySummary`
- `getCategoryMonthlySpend`
- `getMerchantMonthlySpend`
- `getMerchantChargeDays`
- `getTransactionsForAnomalies`
- `getTopMerchants`
- `getCategoryBreakdown`
- `getCategorySpendInRange`
- `getTopMerchantPerCategory`
- `getTopMerchantsForCategory`
- `getPeriodTotal`
- `getPeriodCount`

Only the **range bound** comparisons change. Do NOT change `ORDER BY t.date`,
`SUM(...charged_amount)`, or unrelated `date` references.

- [ ] **Step 2: Month/day groupings and day-keyed joins**

- `getMonthlySummary`: `strftime('%Y-%m', date)` -> `substr(local_date, 1, 7)` (the
  `as month` select and `GROUP BY month`/`ORDER BY month` keep the `month` alias).
- `getCategoryMonthlySpend`: `strftime('%Y-%m', date)` -> `substr(local_date, 1, 7)`,
  and the lower bound `date >= date('now', 'start of month', ...)` -> compare against
  `local_date` is not applicable here because the bound is computed in SQL; replace
  the whole `date >= date('now', ...)` clause with a parameter. **See Task 8** which
  changes this function's signature to take an explicit `from`. For now, in this task,
  only change the `strftime` and any plain range bounds; leave the `date('now', ...)`
  clauses for Task 8.
- `getMerchantMonthlySpend`: `strftime('%Y-%m', date)` -> `substr(local_date, 1, 7)`.
- `getMerchantChargeDays`: `CAST(strftime('%d', date) AS INTEGER) as day` ->
  `CAST(substr(local_date, 9, 2) AS INTEGER) as day`.
- `getCategorySpendByDay` and `getDailySpendTotals`: the join key
  `substr(t.date, 1, 10) = days.d` -> `t.local_date = days.d`.

- [ ] **Step 3: Typecheck + tests**

Run: `bunx tsc --noEmit && bun test --conditions react-server`
Expected: typecheck clean, 0 test failures.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/queries/transactions.ts
git commit -m "feat: bucket transactions.ts queries by local_date"
```

---

## Task 8: Switch range filters in home.ts and budgets.ts; anchor boundaries to Jerusalem

**Files:**
- Modify: `src/server/db/queries/home.ts`
- Modify: `src/server/db/queries/budgets.ts`
- Modify: `src/server/db/queries/transactions.ts` (`getCategoryMonthlySpend`, `getMerchantMonthlySpend`, `getMerchantChargeDays` `date('now', ...)` lower bounds)
- Modify: `src/app/api/summary/route.ts:37-38`
- Modify: `src/server/insights/compute.ts:32-51`
- Modify: `src/server/insights/compute.test.ts`

- [ ] **Step 1: home.ts range filters**

In `getHomeSummary` (income and expense statements) and `getTypicalMonthly`,
change the range bounds `date >= ? AND date <= ?` to `local_date >= ? AND local_date <= ?`.

In `getHistoricalTrend`:
- Change the per-month statement bound to `local_date >= ? AND local_date <= ?`.
- Replace the month-loop boundary derivation (which uses `now.getFullYear()/getMonth()`)
  with the Jerusalem helpers. At the top of the function:

```ts
import { jerusalemToday, monthStart, monthEnd, shiftMonth } from "@/server/lib/date-utils";
```

and rewrite the month list build:

```ts
  const today = jerusalemToday();
  const currentMonthStart = monthStart(today);
  const currentMonthKey = currentMonthStart.slice(0, 7);

  const months: { key: string; label: string; from: string; to: string }[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const from = shiftMonth(currentMonthStart, -i);
    const key = from.slice(0, 7);
    const [y, m] = from.split("-").map(Number);
    months.push({
      key,
      label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short" }),
      from,
      to: monthEnd(from),
    });
  }
```

(`isCurrent` comparison stays `m.key === currentMonthKey`.)

- [ ] **Step 2: budgets.ts range filter**

In `getAutoBudgetAverage`, the periods loop runs queries with
`date >= ? AND date <= ?`. Change those bounds to `local_date >= ? AND local_date <= ?`.
The `periods` are already `{from, to}` `YYYY-MM-DD` strings.

- [ ] **Step 3: transactions.ts `date('now', ...)` lower bounds**

`getCategoryMonthlySpend`, `getMerchantMonthlySpend`, and `getMerchantChargeDays`
compute their lower bound in SQL via `date('now', 'start of month', '-' || ? || ' months')`,
which is server-UTC, not Jerusalem. Replace each such SQL clause with a bound
parameter computed in JS. For each function, add at the top:

```ts
import { jerusalemToday, monthStart, shiftMonth } from "@/server/lib/date-utils";
```

and compute:

```ts
  const fromMonth = shiftMonth(monthStart(jerusalemToday()), -monthsBack);
```

Then change the SQL condition from
`AND date >= date('now', 'start of month', '-' || ? || ' months')`
to `AND local_date >= ?`, and pass `fromMonth` in place of the `monthsBack`
parameter in the `.all(...)` call (keep argument order aligned with the `?`
placeholders).

- [ ] **Step 4: summary route default range**

In `src/app/api/summary/route.ts`, add the import:

```ts
import { jerusalemToday, monthStart, monthEnd } from "@/server/lib/date-utils";
```

Replace lines 37-39:

```ts
  const today = jerusalemToday();
  const defaultFrom = monthStart(today);
  const defaultTo = monthEnd(today);
```

(Remove the now-unused `now`/`toLocalISODate` for defaults if they become unused;
keep `toLocalISODate` if still referenced elsewhere in the file - it is used for
`prevFrom`/`prevTo`, so leave its import.)

- [ ] **Step 5: insights computeMonthRanges anchored to Jerusalem**

In `src/server/insights/compute.ts`, change `computeMonthRanges` to derive the
current year/month from the Jerusalem date of the passed instant rather than
server-local getters. Add import:

```ts
import { toJerusalemDate } from "@/server/lib/date-utils";
```

Replace the `const year = now.getFullYear(); const month = now.getMonth();` lines
(and any `now.getDate()` used for MTD day) with values parsed from the Jerusalem
date string:

```ts
  const todayLocal = toJerusalemDate(now.toISOString());
  const [year, monthOneBased, day] = todayLocal.split("-").map(Number);
  const month = monthOneBased - 1;
```

Use `day` wherever the prior code used `now.getDate()` for the MTD cutoff.

- [ ] **Step 6: Update computeMonthRanges test to be timezone-deterministic**

In `src/server/insights/compute.test.ts`, change the inputs from local
constructors to explicit UTC instants that are unambiguous in Jerusalem:

```ts
const r = computeMonthRanges(new Date("2026-03-10T08:00:00.000Z"));
```
and the `2026,2,31` case to `new Date("2026-03-31T08:00:00.000Z")`. Adjust any
expected MTD day to match (March 10 / March 31). Run the test to confirm
expectations still describe March.

- [ ] **Step 7: Typecheck + tests**

Run: `bunx tsc --noEmit && bun test --conditions react-server`
Expected: typecheck clean, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/server/db/queries/home.ts src/server/db/queries/budgets.ts src/server/db/queries/transactions.ts src/app/api/summary/route.ts src/server/insights/compute.ts src/server/insights/compute.test.ts
git commit -m "feat: bucket home/budgets/insights ranges by Jerusalem local date"
```

---

## Task 9: Display call sites use `localDate`

**Files:**
- Modify: `src/components/dashboard/transactions-table.tsx:410`
- Modify: `src/components/review/review-page.tsx`
- Modify: `src/components/home/flagged-transactions.tsx`
- Modify: `src/components/home/recent-activity.tsx`
- Modify: `src/components/dashboard/budget-detail-sheet.tsx`

- [ ] **Step 1: Repoint each `formatDate(... .date)` call**

In each file, find `formatDate(<txn>.date)` and change it to `formatDate(<txn>.localDate)`.
Grep to find them all:

Run: `grep -rn "formatDate(" src/components/`
Change every call that passes a transaction's `.date` to pass `.localDate`. If any
call passes a non-transaction date string already in `YYYY-MM-DD`, leave it.
For `budget-detail-sheet.tsx` and `recent-activity.tsx`, confirm the object passed
is a `Transaction`/`TransactionWithCategory` (it has `localDate`); if it is a
different shape, add `localDate` to that shape's source query/mapping.

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors. (If a call site passes an object lacking `localDate`, TS will
flag it - fix by sourcing `localDate` from the same query that builds that object.)

- [ ] **Step 3: Commit**

```bash
git add src/components/
git commit -m "feat: render transaction dates from canonical localDate"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full CI gate**

Run: `bun run ci`
Expected: all green (format, lint, typecheck, i18n, knip, react-doctor, security, test).

- [ ] **Step 2: Verify the headline number on the dev server**

Run: `bun dev`. In the app, select the same account set the user used (the 8
accounts excluding `965-140006_43`) and open the home/trends view. Confirm May
income reads **24,999.34** (or the live value matching
`sqlite3 data/budgeteer.db "SELECT ROUND(SUM(CASE WHEN kind='income' THEN charged_amount ELSE 0 END),2) FROM transactions WHERE workspace_id=3 AND account_number!='965-140006_43' AND local_date>='2026-05-01' AND local_date<='2026-05-31' AND status='completed' AND is_excluded=0;"`).

- [ ] **Step 3: Verify no transaction falls in a gap**

Run:
```bash
sqlite3 data/budgeteer.db "SELECT COUNT(*) FROM transactions WHERE local_date IS NULL;"
sqlite3 data/budgeteer.db "SELECT date, local_date FROM transactions WHERE id IN (2389,2390,2391,2412);"
```
Expected: `0` NULLs; the `...05-31T21:00Z` rows show `2026-06-01`, the `...04-30T21:00Z` row shows `2026-05-01`. Confirm in the transactions list that these rows display under those Jerusalem dates. Stop the dev server.

- [ ] **Step 4: Update README screenshots if the date display visibly changed**

Per project PR rules, if any user-facing screen changed, regenerate the affected
`public/screenshots/*.png` from synthetic/mock data only (never the real
`data/budgeteer.db`). The date-format output (`dd/mm/yyyy`) is unchanged, so
screenshots likely do not need regeneration; confirm visually and skip if identical.

---

## Done

After Task 10, use **superpowers:finishing-a-development-branch** to merge `fix/date-bucketing-timezone`.
