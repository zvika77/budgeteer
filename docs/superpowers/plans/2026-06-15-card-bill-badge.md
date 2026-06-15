# Card Bill Status Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a stateful badge on every bank card-bill row showing whether it was matched to a connected card ("Matched · 8682") or not ("No match").

**Architecture:** Three layers. (1) Data: extend the transaction query with a LEFT JOIN subquery so every `TransactionWithCategory` includes `matchedCardNumber` (the purchase card's `account_number`, or null). (2) Logic: a pure `getCardBillBadgeState` helper turns those two fields into a typed badge state. (3) UI: replace the existing flat "Card payment" chip in `transactions-table.tsx` with the stateful badge; add the badge to `review-page.tsx` (for flagged unmatched bills) and `flagged-transactions.tsx`.

**Tech Stack:** better-sqlite3 raw SQL for the JOIN (Drizzle ORM doesn't support lateral-style subquery joins cleanly), TypeScript strict, next-intl for i18n strings, Tailwind CSS v4 for badge styling, `bun test --conditions react-server` for unit tests.

---

## File Map

| File | Action |
|------|--------|
| `src/lib/types.ts` | Add `matchedCardNumber: string \| null` to `TransactionWithCategory` |
| `src/server/db/queries/transactions.ts` | Add subquery LEFT JOIN; update `TransactionRow` + `mapTransactionRow` |
| `src/lib/card-bill-badge.ts` | New — pure badge-state helper |
| `src/lib/card-bill-badge.test.ts` | New — unit tests for helper |
| `src/i18n/messages/en.json` | Add 4 new i18n keys |
| `src/i18n/messages/he.json` | Add 4 new i18n keys (Hebrew) |
| `src/components/dashboard/transactions-table.tsx` | Replace flat chip with stateful badge |
| `src/components/review/review-page.tsx` | Add badge to `ReviewRow` for bill_payment rows |
| `src/components/home/flagged-transactions.tsx` | Add badge to `FlaggedRow` for bill_payment rows |

---

## Task 1: Extend TransactionWithCategory with matchedCardNumber

**Files:**
- Modify: `src/lib/types.ts` (add field to interface)
- Modify: `src/server/db/queries/transactions.ts` (SQL + mapping)

### Background

A `credit_card_statement` event has a `bill_payment` member (the bank transaction) plus `purchase` members (the card transactions). All purchase members share the same `account_number` (e.g., "8682"). By LEFT JOINing on event_members, we can pick that account_number up for the bill row without changing the transactions table.

The subquery:
```sql
SELECT em.workspace_id, em.event_id, tp.account_number AS matched_card_number
FROM event_members em
JOIN transactions tp ON tp.id = em.transaction_id
WHERE em.role = 'purchase'
GROUP BY em.workspace_id, em.event_id
```
…grouped to give one row per event (safe because all purchases in one statement belong to the same card). Joined on `mc.workspace_id = t.workspace_id AND mc.event_id = t.event_id AND t.event_role = 'bill_payment'` so the field is NULL for all non-bill-payment rows.

- [ ] **Step 1: Add `matchedCardNumber` to `TransactionWithCategory` in `src/lib/types.ts`**

Find `TransactionWithCategory` (line ~52) and add the field:

```ts
export interface TransactionWithCategory extends Transaction {
  categoryName: string | null;
  categoryColor: string | null;
  isExcluded: boolean;
  matchedCardNumber: string | null;
}
```

- [ ] **Step 2: Update `TRANSACTION_LIST_FROM` in `src/server/db/queries/transactions.ts`**

Current constant (line ~227):
```ts
const TRANSACTION_LIST_FROM = `
  FROM transactions t
  LEFT JOIN categories c ON t.category_id = c.id
  LEFT JOIN bank_credentials bc ON t.credential_id = bc.id
  LEFT JOIN bank_accounts ba ON ba.workspace_id = t.workspace_id
    AND ba.credential_id = t.credential_id
    AND ba.account_number = t.account_number`;
```

Replace with:
```ts
const TRANSACTION_LIST_FROM = `
  FROM transactions t
  LEFT JOIN categories c ON t.category_id = c.id
  LEFT JOIN bank_credentials bc ON t.credential_id = bc.id
  LEFT JOIN bank_accounts ba ON ba.workspace_id = t.workspace_id
    AND ba.credential_id = t.credential_id
    AND ba.account_number = t.account_number
  LEFT JOIN (
    SELECT em.workspace_id, em.event_id, tp.account_number AS matched_card_number
    FROM event_members em
    JOIN transactions tp ON tp.id = em.transaction_id
    WHERE em.role = 'purchase'
    GROUP BY em.workspace_id, em.event_id
  ) mc ON mc.workspace_id = t.workspace_id
       AND mc.event_id = t.event_id
       AND t.event_role = 'bill_payment'`;
```

- [ ] **Step 3: Update `TRANSACTION_LIST_SELECT` to include the new column**

Current (line ~235):
```ts
const TRANSACTION_LIST_SELECT = `
  SELECT t.*, c.name AS category_name, c.color AS category_color,
         bc.label AS account_label, ba.name AS account_name
  ${TRANSACTION_LIST_FROM}`;
```

Replace with:
```ts
const TRANSACTION_LIST_SELECT = `
  SELECT t.*, c.name AS category_name, c.color AS category_color,
         bc.label AS account_label, ba.name AS account_name,
         mc.matched_card_number
  ${TRANSACTION_LIST_FROM}`;
```

- [ ] **Step 4: Add `matched_card_number` to `TransactionRow` interface (line ~916)**

```ts
interface TransactionRow {
  // ... existing fields ...
  category_name?: string | null;
  category_color?: string | null;
  account_label?: string | null;
  account_name?: string | null;
  matched_card_number?: string | null;
}
```

- [ ] **Step 5: Map `matched_card_number` in `mapTransactionRow` (line ~952)**

At the end of the return object, after `categoryColor`, add:

```ts
    categoryColor: r.category_color ?? null,
    matchedCardNumber: r.matched_card_number ?? null,
```

- [ ] **Step 6: Run CI to verify no TypeScript errors**

```bash
cd /Users/zvikag/budgeteer && bun run ci
```

Expected: all gates pass. TypeScript will catch any missing field in the interface.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/server/db/queries/transactions.ts
git commit -m "feat: expose matched card number on TransactionWithCategory"
```

---

## Task 2: Badge state helper + unit tests

**Files:**
- Create: `src/lib/card-bill-badge.ts`
- Create: `src/lib/card-bill-badge.test.ts`

### Background

A bill transaction's badge state is determined by two fields already on `TransactionWithCategory`:
- `eventRole` — must be `"bill_payment"` (otherwise not a card bill at all, return null)
- `kind` — `"transfer"` means matched; `"expense"` means unmatched
- `matchedCardNumber` — non-null when matched, confirms the matched state

- [ ] **Step 1: Write the failing test**

Create `src/lib/card-bill-badge.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { getCardBillBadgeState } from "@/lib/card-bill-badge";

describe("getCardBillBadgeState", () => {
  test("returns null for non-bill-payment roles", () => {
    expect(getCardBillBadgeState("debit", "expense", null)).toBeNull();
    expect(getCardBillBadgeState("purchase", "expense", null)).toBeNull();
    expect(getCardBillBadgeState(null, "expense", null)).toBeNull();
  });

  test("returns matched when kind is transfer and card number is known", () => {
    const state = getCardBillBadgeState("bill_payment", "transfer", "8682");
    expect(state).toEqual({ matched: true, cardNumber: "8682" });
  });

  test("returns unmatched when kind is expense (no statement found)", () => {
    const state = getCardBillBadgeState("bill_payment", "expense", null);
    expect(state).toEqual({ matched: false });
  });

  test("returns unmatched when transfer but matchedCardNumber is null (edge case)", () => {
    const state = getCardBillBadgeState("bill_payment", "transfer", null);
    expect(state).toEqual({ matched: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/zvikag/budgeteer && bun test src/lib/card-bill-badge.test.ts --conditions react-server
```

Expected: FAIL — "Cannot find module '@/lib/card-bill-badge'"

- [ ] **Step 3: Implement `src/lib/card-bill-badge.ts`**

```ts
import type { EventRole } from "@/lib/types";

export type CardBillBadgeState =
  | { matched: true; cardNumber: string }
  | { matched: false }
  | null;

export function getCardBillBadgeState(
  eventRole: EventRole | null,
  kind: "expense" | "income" | "transfer",
  matchedCardNumber: string | null,
): CardBillBadgeState {
  if (eventRole !== "bill_payment") return null;
  if (kind === "transfer" && matchedCardNumber !== null) {
    return { matched: true, cardNumber: matchedCardNumber };
  }
  return { matched: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/zvikag/budgeteer && bun test src/lib/card-bill-badge.test.ts --conditions react-server
```

Expected: 4 tests pass.

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/zvikag/budgeteer && bun run ci
```

Expected: all gates pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/card-bill-badge.ts src/lib/card-bill-badge.test.ts
git commit -m "feat: add card bill badge state helper"
```

---

## Task 3: i18n strings for badge

**Files:**
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/he.json`

Both files have a `"transactions"` section containing `"eventCardPayment"`. Add 4 new keys adjacent to the existing ones (after line 218 in both files).

- [ ] **Step 1: Add keys to `src/i18n/messages/en.json`**

After line 218 (`"eventBadgeTooltip": "..."`), insert:

```json
    "eventCardMatched": "Matched · {card}",
    "eventCardMatchedTooltip": "This bill is covered by card {card} — individual purchases are already counted as spending",
    "eventCardUnmatched": "No match",
    "eventCardUnmatchedTooltip": "Could not match this bill to a connected card — counting as spending",
```

- [ ] **Step 2: Add keys to `src/i18n/messages/he.json`**

After line 218 (`"eventBadgeTooltip": "..."`), insert:

```json
    "eventCardMatched": "מותאם · {card}",
    "eventCardMatchedTooltip": "חשבונית זו מכוסה על ידי כרטיס {card} — הרכישות הפרטניות כבר נספרות כהוצאה",
    "eventCardUnmatched": "ללא התאמה",
    "eventCardUnmatchedTooltip": "לא ניתן לשייך חשבונית זו לכרטיס מחובר — נספרת כהוצאה",
```

- [ ] **Step 3: Run i18n check**

```bash
cd /Users/zvikag/budgeteer && bun run i18n:check
```

Expected: passes with no missing/orphaned keys.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/messages/en.json src/i18n/messages/he.json
git commit -m "feat: add i18n keys for card bill match badge"
```

---

## Task 4: Stateful badge in transactions-table

**Files:**
- Modify: `src/components/dashboard/transactions-table.tsx`

### Background

Currently `transactions-table.tsx` shows a flat chip on event rows (line ~407):

```tsx
{txn.eventId != null && txn.eventRole != null && (
  <span ... >
    <ArrowLeftRight className="h-3 w-3" />
    {txn.eventRole === "bill_payment"
      ? t("eventCardPayment")
      : t("eventTransfer")}
  </span>
)}
```

We need to replace the `eventRole === "bill_payment"` branch with the stateful badge. The "Transfer" branch (for other event types like internal_transfer) stays unchanged.

The badge needs:
- `import { getCardBillBadgeState } from "@/lib/card-bill-badge";` (new import)
- `useTranslations("transactions")` already present as `t`
- Matched badge: green-ish tint using `var(--status-on-track)` with opacity
- Unmatched badge: amber tint using `var(--status-heads-up)` with opacity (matches the existing `needsReview` chip style)

- [ ] **Step 1: Add the import**

Find the existing imports at the top of the file. Add:

```ts
import { getCardBillBadgeState } from "@/lib/card-bill-badge";
```

- [ ] **Step 2: Replace the chip JSX**

Find the chip block (it spans roughly lines 407-418):

```tsx
{txn.eventId != null && txn.eventRole != null && (
  <span
    className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
    style={{ backgroundColor: "var(--muted)" }}
    title={t("eventBadgeTooltip")}
  >
    <ArrowLeftRight className="h-3 w-3" />
    {txn.eventRole === "bill_payment"
      ? t("eventCardPayment")
      : t("eventTransfer")}
  </span>
)}
```

Replace with:

```tsx
{txn.eventId != null && txn.eventRole != null && (() => {
  const billBadge = getCardBillBadgeState(txn.eventRole, txn.kind, txn.matchedCardNumber);
  if (billBadge !== null) {
    return billBadge.matched ? (
      <span
        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
        style={{
          backgroundColor: "color-mix(in oklch, var(--status-on-track) 18%, transparent)",
          color: "var(--status-on-track)",
        }}
        title={t("eventCardMatchedTooltip", { card: billBadge.cardNumber })}
      >
        <ArrowLeftRight className="h-3 w-3" />
        {t("eventCardMatched", { card: billBadge.cardNumber })}
      </span>
    ) : (
      <span
        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
        style={{
          backgroundColor: "color-mix(in oklch, var(--status-heads-up) 18%, transparent)",
          color: "var(--status-heads-up)",
        }}
        title={t("eventCardUnmatchedTooltip")}
      >
        <ArrowLeftRight className="h-3 w-3" />
        {t("eventCardUnmatched")}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
      style={{ backgroundColor: "var(--muted)" }}
      title={t("eventBadgeTooltip")}
    >
      <ArrowLeftRight className="h-3 w-3" />
      {t("eventTransfer")}
    </span>
  );
})()}
```

- [ ] **Step 3: Run CI**

```bash
cd /Users/zvikag/budgeteer && bun run ci
```

Expected: all gates pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/transactions-table.tsx
git commit -m "feat: show matched/unmatched badge on card bill rows in transactions table"
```

---

## Task 5: Badge on review-page and flagged-transactions

**Files:**
- Modify: `src/components/review/review-page.tsx`
- Modify: `src/components/home/flagged-transactions.tsx`

### Background

Unmatched bills (`kind = "expense"`, `eventRole = "bill_payment"`, `needsReview = true`) appear in:
- Review page → `groups.flagged` → `ReviewRow`
- Flagged-transactions widget → `FlaggedRow`

Matched bills (`kind = "transfer"`) do NOT appear in either view (they have `needsReview = false` and `kind = "transfer"` so `getReviewTransactions` skips them). But we still call `getCardBillBadgeState` so future edge cases are handled correctly.

### review-page.tsx

In `ReviewRow` (line ~466), there is a meta line under the description:

```tsx
<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
  <span className="tabular-nums">{formatDate(txn.date)}</span>
  <span aria-hidden>·</span>
  <SourceMeta txn={txn} />
</div>
```

Add the badge after `<SourceMeta>` (conditionally).

- [ ] **Step 1: Add imports to review-page.tsx**

Add at the top:
```ts
import { getCardBillBadgeState } from "@/lib/card-bill-badge";
```

- [ ] **Step 2: Add badge in ReviewRow's meta line**

Replace the meta div:

```tsx
<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
  <span className="tabular-nums">{formatDate(txn.date)}</span>
  <span aria-hidden>·</span>
  <SourceMeta txn={txn} />
  {(() => {
    const billBadge = getCardBillBadgeState(txn.eventRole, txn.kind, txn.matchedCardNumber);
    if (billBadge === null) return null;
    return (
      <>
        <span aria-hidden>·</span>
        {billBadge.matched ? (
          <span
            className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium"
            style={{
              backgroundColor: "color-mix(in oklch, var(--status-on-track) 18%, transparent)",
              color: "var(--status-on-track)",
            }}
            title={t("eventCardMatchedTooltip", { card: billBadge.cardNumber })}
          >
            {t("eventCardMatched", { card: billBadge.cardNumber })}
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium"
            style={{
              backgroundColor: "color-mix(in oklch, var(--status-heads-up) 18%, transparent)",
              color: "var(--status-heads-up)",
            }}
            title={t("eventCardUnmatchedTooltip")}
          >
            {t("eventCardUnmatched")}
          </span>
        )}
      </>
    );
  })()}
</div>
```

Note: `ReviewRow` already uses `const t = useTranslations("review")` — but the new keys are in the `"transactions"` namespace. You need a second `useTranslations` call. Add to the top of `ReviewRow`:

```tsx
function ReviewRow({ txn, categories, invalidate }: { ... }) {
  const t = useTranslations("review");
  const tTxn = useTranslations("transactions");
  // ... existing code ...
```

Then use `tTxn("eventCardMatched", { card: billBadge.cardNumber })` etc. in the badge JSX.

Full updated ReviewRow top:

```tsx
function ReviewRow({
  txn,
  categories,
  invalidate,
}: {
  txn: TransactionWithCategory;
  categories: Category[];
  invalidate: () => void;
}) {
  const bucket = bucketOf(txn);
  const kind = txn.kind === "income" ? "income" : "expense";
  const { busy, accept, keepTransfer, exclude, categorize } = useReviewActions(txn, invalidate);
  const t = useTranslations("review");
  const tTxn = useTranslations("transactions");
```

And the meta div:

```tsx
<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
  <span className="tabular-nums">{formatDate(txn.date)}</span>
  <span aria-hidden>·</span>
  <SourceMeta txn={txn} />
  {(() => {
    const billBadge = getCardBillBadgeState(txn.eventRole, txn.kind, txn.matchedCardNumber);
    if (billBadge === null) return null;
    return (
      <>
        <span aria-hidden>·</span>
        {billBadge.matched ? (
          <span
            className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium"
            style={{
              backgroundColor: "color-mix(in oklch, var(--status-on-track) 18%, transparent)",
              color: "var(--status-on-track)",
            }}
            title={tTxn("eventCardMatchedTooltip", { card: billBadge.cardNumber })}
          >
            {tTxn("eventCardMatched", { card: billBadge.cardNumber })}
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium"
            style={{
              backgroundColor: "color-mix(in oklch, var(--status-heads-up) 18%, transparent)",
              color: "var(--status-heads-up)",
            }}
            title={tTxn("eventCardUnmatchedTooltip")}
          >
            {tTxn("eventCardUnmatched")}
          </span>
        )}
      </>
    );
  })()}
</div>
```

### flagged-transactions.tsx

In `FlaggedRow` (line ~70), add the badge in the "tags row" beside the category, after the existing `HelpCircle` badge.

- [ ] **Step 3: Add imports to flagged-transactions.tsx**

Add:
```ts
import { getCardBillBadgeState } from "@/lib/card-bill-badge";
```

The component already has `useTranslations("home")` but needs transactions namespace for badge strings:

```tsx
function FlaggedRow({ txn }: { txn: TransactionWithCategory }) {
  const t = useTranslations("home");
  const tTxn = useTranslations("transactions");
  // existing ...
```

- [ ] **Step 4: Add badge in FlaggedRow after the HelpCircle span**

Find the existing `<span>` showing `HelpCircle` (around line 110-120):

```tsx
<span
  className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium"
  style={{
    backgroundColor: "color-mix(in oklch, var(--status-heads-up) 18%, transparent)",
    color: "var(--status-heads-up)",
  }}
>
  <HelpCircle className="h-3 w-3" />
  {txn.aiConfidence != null
    ? t("flaggedConfidence", { score: txn.aiConfidence })
    : t("flaggedUnsure")}
</span>
```

After that closing `</span>`, add:

```tsx
{(() => {
  const billBadge = getCardBillBadgeState(txn.eventRole, txn.kind, txn.matchedCardNumber);
  if (billBadge === null) return null;
  return billBadge.matched ? (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium"
      style={{
        backgroundColor: "color-mix(in oklch, var(--status-on-track) 18%, transparent)",
        color: "var(--status-on-track)",
      }}
      title={tTxn("eventCardMatchedTooltip", { card: billBadge.cardNumber })}
    >
      {tTxn("eventCardMatched", { card: billBadge.cardNumber })}
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium"
      style={{
        backgroundColor: "color-mix(in oklch, var(--status-heads-up) 18%, transparent)",
        color: "var(--status-heads-up)",
      }}
      title={tTxn("eventCardUnmatchedTooltip")}
    >
      {tTxn("eventCardUnmatched")}
    </span>
  );
})()}
```

- [ ] **Step 5: Run CI**

```bash
cd /Users/zvikag/budgeteer && bun run ci
```

Expected: all gates pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/review/review-page.tsx src/components/home/flagged-transactions.tsx
git commit -m "feat: show card bill match badge on review and flagged-transactions"
```

---

## Self-Review

### Spec coverage

- [x] `מותאם · 8682` badge for matched bills → Task 4 (transactions-table), Task 5 (review + flagged)
- [x] `ללא התאמה` badge for unmatched bills → same tasks
- [x] Data source: `matchedCardNumber` derived from purchase members via subquery JOIN → Task 1
- [x] Pure helper function for badge state → Task 2
- [x] i18n keys for both badge states + tooltips → Task 3
- [x] Badge shown in transactions table → Task 4
- [x] Badge shown in review page → Task 5
- [x] Badge shown in flagged-transactions → Task 5

Phase 3 (manual mapping action) is out of scope for this plan.

### Placeholder scan

None — all steps contain complete code.

### Type consistency

- `CardBillBadgeState` defined in Task 2, consumed in Tasks 4 and 5
- `getCardBillBadgeState(eventRole, kind, matchedCardNumber)` signature matches call sites
- `matchedCardNumber: string | null` added to `TransactionWithCategory` in Task 1, available at call sites in Tasks 4 and 5
- i18n keys `eventCardMatched`, `eventCardMatchedTooltip`, `eventCardUnmatched`, `eventCardUnmatchedTooltip` defined in Task 3, used in Tasks 4 and 5 via `tTxn`
