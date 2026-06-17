# Export transactions to CSV

## Goal

Add an "Export CSV" button to the transactions page that downloads every
transaction matching the current month and active filters as a CSV file.

## Scope

- Exports all rows matching the current `from`/`to` month plus the active
  `search`, `categoryIds`, and `kind` filters, honoring the current sort. Not
  limited to the visible 50-row page.
- Core columns only: Date, Description, Category, Account, Amount, Currency.

Out of scope: server endpoint, other formats (OFX/XLSX), per-column picker,
exporting across all history regardless of filters.

## Approach

Client-side generation, no new API route.

1. On click, call the existing `getTransactions(...)` with the same filters the
   page holds (`from`, `to`, `search`, `categoryIds`, `kind`, `sort`, `order`)
   and a high `limit` with `offset: 0` to pull the full filtered set in one
   request. The existing endpoint already applies the date-basis context.
2. Build the CSV string with a pure helper `buildTransactionsCsv` in
   `src/lib/transactions-csv.ts`, kept dependency-free so it is unit-testable
   under `bun test`.
3. Trigger the download via a `Blob` and a temporary `<a download>` element with
   a filename derived from the selected month, e.g.
   `budgeteer-transactions-2026-06.csv`.

## Components

- `src/lib/transactions-csv.ts` — pure: takes rows, date basis, a header-label
  map, and an uncategorized fallback label; returns the CSV text. Handles RFC
  4180 escaping (quote fields containing `, " \n`) and CSV-injection guarding
  (prefix a leading `=+-@` cell with `'`).
- `src/components/transactions/export-csv-button.tsx` — client button that wires
  the fetch, builds the CSV via the helper, and triggers download. Disabled and
  shows a spinner while fetching; toast on error.
- `transactions-page.tsx` — renders the button in the page header actions and
  passes the current filter state.

## Columns

| Column | Source |
| --- | --- |
| Date | `billingLocalDate` or `localDate` per date basis, raw `YYYY-MM-DD` |
| Description | `description` |
| Category | `categoryName` or the uncategorized fallback label |
| Account | `accountName` / `accountLabel` / `accountNumber` |
| Amount | raw numeric `chargedAmount` |
| Currency | `chargedCurrency` (default `ILS`) |

Header row labels are localized via the `transactions` i18n namespace.

## i18n

New keys in `en.json` and `he.json` under `transactions`: `exportCsv`
(button label), `exportEmpty` (nothing-to-export toast), `exportFailed`
(error toast), and `csvHeader*` for the localized column headers.

## Edge cases

- Empty filtered result: button disabled, or a toast "Nothing to export".
- Fetch failure: error toast, no download.

## Testing

Pure unit tests for `buildTransactionsCsv`: escaping, injection guard, date
basis selection, uncategorized fallback, header row. Manual verification of the
download via the dev server.

## Docs

Update README and regenerate the transactions screenshot from mock data in the
same PR, per project rules.
