# Purchase-date vs billing-date toggle — design

Date: 2026-06-16
Branch: `feat/card-purchase-vs-billing-date`

## Problem

Budgeteer attributes every transaction to its **purchase date** (`local_date`,
a precomputed Asia/Jerusalem date derived from the scraper `date`). A
credit-card purchase made on May 3 is therefore counted in May, even though the
card company bills it to the bank in June. A bank statement, by contrast, is
**cash-basis**: it counts the bill on the day it is paid.

This is why the app's "May expense" (₪25,450) does not match the bank's May
figure (₪26,117): they are two legitimate accounting views (accrual vs cash) of
the same money. Users reconciling against their bank need a way to see the
billing-date view, while keeping purchase date as the default because it is the
correct basis for budgeting ("what did I spend in May").

## Goal

Let the user switch the spend views between **purchase date** (default) and
**billing date**, and explain, in-context, that credit-card spending is counted
on its purchase date.

Non-goal: changing how transfers / credit-card-bill matching work. Unmatched
card bills stay counted as a single expense (the hybrid is intentional, so spend
on un-connected cards is never lost).

## Scope decisions (agreed)

- **Reach:** global-style control, but only the views that compare to the bank
  re-base: **Home (cash flow + trend)** and **Transactions**. **Budget and
  Insights stay locked to purchase date**, because their rolling averages and
  anomaly baselines assume purchase timing and would be confusing on a cash
  basis.
- **Default basis:** `purchase` (today's behaviour). Unchanged on first run.
- **Explanation:** an inline muted caption near the totals/toggle on the two
  spend pages, **plus** a dedicated "Purchase vs billing date" help-panel section
  (with the worked credit-card example) on Home and Transactions.

## Architecture

### 1. Billing-date column (`billing_local_date`)

The billing axis must be an Asia/Jerusalem date string to match how `local_date`
is grouped, not the raw UTC `processed_date` instant (a `21:00Z` charge belongs
to the next Israel day). We mirror the existing `local_date` mechanism exactly:

- **Migration** `027_billing_local_date.sql`:
  - `ALTER TABLE transactions ADD COLUMN billing_local_date TEXT;`
  - `CREATE INDEX IF NOT EXISTS idx_transactions_ws_billing_local_date ON transactions(workspace_id, billing_local_date);`
- **Drizzle schema** (`src/server/db/schema.ts`): add
  `billingLocalDate: text("billing_local_date")` next to `localDate` so the ORM
  and `knip` stay in sync.
- **Backfill** `src/server/db/backfill-billing-local-date.ts`, wired into
  `getDb()` init right after `backfillLocalDate(db)`:
  - For rows where `billing_local_date IS NULL AND processed_date IS NOT NULL`,
    set `billing_local_date = toJerusalemDate(processed_date)`.
  - Runs automatically at startup; no data drop or re-sync required.
- **Insert population** in `upsertTransactions` (`queries/transactions.ts`):
  populate `billing_local_date` from `processed_date` on insert, alongside
  `local_date`. Like `local_date`, it is only refreshed while a row is still
  `pending` (a settled row keeps its first value).

`processed_date` is non-null for all current rows (CAL + Leumi). Where it is ever
null (e.g. a volatile pending row), queries `COALESCE(billing_local_date,
local_date)` so the row still appears, on its purchase date, rather than
vanishing.

### 2. Date-basis store + request plumbing (mirrors account filter)

- `src/lib/date-basis-store.ts`: a localStorage-backed `useSyncExternalStore`,
  exactly like `account-store.ts`. Value: `"purchase" | "billing"`, default
  `"purchase"`. Exports `getDateBasisSync`, `setDateBasis`, `useDateBasis`.
  Storage key `budgeteer.dateBasis`.
- `withScopeHeaders` (`src/lib/api.ts`): add an `x-date-basis` header from
  `getDateBasisSync()` when it is `"billing"` (omit header for the default, so
  existing behaviour is byte-identical when off).
- `src/server/lib/date-basis-context.ts`: `getDateBasisFromRequest(req):
  "purchase" | "billing"` reading the `x-date-basis` header (default
  `"purchase"`).
- Toggling calls `queryClient.invalidateQueries()` (same as the account filter)
  so all data refetches.

### 3. Query layer

A single resolver picks the column:

```
type DateBasis = "purchase" | "billing";
function dateColumn(basis: DateBasis, alias = ""):
  basis === "billing"
    ? `COALESCE(${alias}billing_local_date, ${alias}local_date)`
    : `${alias}local_date`;
```

Threaded as an optional `dateBasis` parameter (default `"purchase"`, so all
existing callers and tests are unaffected) into exactly three places:

- `queryTransactions` — the `from`/`to` range filter and the sort/group date.
- `getCashFlow` (home.ts) — income/expense range filter.
- `getHistoricalTrend` (home.ts) — per-month range filter.

`getTypicalMonthly`, budgets, insights, forecast, and category detail are **not**
threaded — they remain purchase-basis.

The API routes for transactions, summary (cash flow + trend) read the basis via
`getDateBasisFromRequest` and pass it down. Budget/insights routes ignore it.

### 4. UI

- `src/components/layout/date-basis-toggle.tsx`: a small segmented control
  (Purchase / Billing) styled like the existing top-bar controls. Rendered in the
  same top-bar slot as `GlobalAccountFilter`, but only on Home and Transactions
  (`pathname` allow-list, mirroring the account filter's `HIDDEN_PREFIXES`
  pattern). On change: `setDateBasis(next)` + `invalidateQueries()`.
- Inline caption: a muted one-liner near the totals on Home and Transactions,
  reading "Credit-card spending is counted on its purchase date." in purchase
  mode and the billing-date equivalent in billing mode. New i18n keys.
- Help panels: a new `dateBasis` section added to the `home` and `transactions`
  entries in `HELP_SECTIONS`, with `title` / `body` / `example` copy (en + he),
  reusing the worked credit-card example. Icon `CalendarRange` (already mapped).

## Data flow

1. User toggles Purchase ↔ Billing in the top bar (Home or Transactions).
2. `setDateBasis` writes localStorage + notifies; `invalidateQueries` refetches.
3. Client fetchers attach `x-date-basis: billing` (only when billing).
4. Transactions / summary routes resolve the basis and pass `dateBasis` to the
   queries, which select `local_date` or `COALESCE(billing_local_date,
   local_date)` for both filtering and grouping.
5. Budget and Insights routes ignore the header and stay on purchase date.

## Error handling / edge cases

- **Null `processed_date`:** `COALESCE` to `local_date` so the row still shows.
- **Pending rows:** billing date refreshes only while pending, like `local_date`.
- **Default off:** when basis is `purchase`, no header is sent and queries use
  `local_date` verbatim — zero behavioural change from today.
- **Toggle on non-applicable pages:** not rendered there, so it can never appear
  to "do nothing".

## Testing

Pure-logic tests only (better-sqlite3 cannot load under `bun test`; verify the
DB-touching pieces via the dev server):

- `dateColumn` resolver: returns the right SQL fragment per basis and alias.
- `date-basis-store`: default `"purchase"`, set/get round-trip, subscriber
  notification (jsdom-free, mirroring how account-store is exercised).
- `getDateBasisFromRequest`: header present/absent/garbage → correct basis.
- `toJerusalemDate(processed_date)` boundary: a `…T21:00:00Z` instant maps to the
  next Israel day (reuses existing date-utils tests as the model).
- Help-content parity test already covers the new `dateBasis` keys via the
  existing en/he loop.

Manual verification via the dev server on demo data: toggle on Home and
Transactions, confirm May totals shift between the accrual and cash figures, and
that Budget/Insights are unchanged.

## Out of scope

- Forcing unmatched card bills into transfers.
- Any change to budgets, insights, forecast, or category detail.
- A per-account or per-transaction basis override (global only).
