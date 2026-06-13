# Connected-issuer-aware credit-card-payment classification

Date: 2026-06-13
Status: Approved (design)

## Problem

A bank-side credit-card bill payment (e.g. a Leumi debit described `כרטיסי אשראי` /
`ויזה כ.א.ל`) is not new spending on its own. It settles a card whose individual
purchases are pulled separately. To avoid double-counting, `detectKind`
(`src/server/lib/transfers.ts`) classifies any description matching
`CREDIT_CARD_PAYMENT_PATTERNS` on a bank provider as `kind = "transfer"`, and every
spending query filters `kind = 'expense'`, so the bill payment is excluded from
totals, the "where the money went" breakdown, and the forecast.

That exclusion is correct **only when the card's itemized purchases are actually in
the database** (the card issuer is connected). For a **bank-only** user the bill
payment is the sole record of that spend, so it silently vanishes:

- Transactions "all activity" total: 22,613 (includes 10,033 of card bill payments).
- "Where the money went" donut: 12,580 (excludes the 10,033).
- The 10,033 is invisible in every spend view and in the forecast.

## Goal

Count a bank-side card bill payment as spending **unless** the matching card issuer
is connected (in which case keep excluding it, because the itemized purchases are
counted instead). When we cannot determine the issuer, default to excluding it but
flag it for the user to confirm.

## Decisions (locked)

- **Placement (hybrid):** `detectKind` is unchanged — it still marks card-payment
  patterns as `transfer` at insert. The matching engine owns all connected-issuer
  logic, review flagging, and re-derivation.
- **Mapping granularity:** per-issuer where the description names the issuer;
  network-only descriptions are treated as ambiguous.
- **Ambiguous fallback:** keep as transfer but flag for review.
- **Category for newly-counted bills:** a dedicated seeded `Credit Card` expense
  category, mirroring `Cash & ATM`.
- **Re-derivation scope:** all-time on every card connect/disconnect.

## Design

### 1. Per-issuer pattern mapping — `src/server/lib/transfers.ts`

Add a structured issuer map and a resolver. Do **not** change
`matchesCreditCardPayment` or `detectKind`; the resolver is additive.

```ts
export type CardIssuer = "isracard" | "cal" | "max" | "amex";
export type CardPaymentMatch = { issuer: CardIssuer } | { issuer: "ambiguous" } | null;

export function matchCardPaymentIssuer(description: string): CardPaymentMatch;
```

Issuer-specific signals:

- `isracard`: `ישראכרט`, `ישראכארד`, `ISRACARD`
- `cal`: `כ.א.ל`, `כאל`, `CAL`
- `max`: `מקס`, `מקסימום`, `לאומי קארד`, `MAX`, `LEUMI CARD`
- `amex`: `אמקס`, `אמריקן אקספרס`, `AMEX`, `AMERICAN EXPRESS`

Network-only (carried by multiple issuers) → `{ issuer: "ambiguous" }`:

- `ויזה` / `VISA`, `מאסטרקארד` / `MASTERCARD`, `דיינרס` / `DINERS`,
  and the generic forms `תשלום אשראי`, `כרטיס אשראי`, `חיוב כרטיס`.

The union of all of these must equal the set currently matched by
`matchesCreditCardPayment`, so detection coverage is unchanged; only the issuer
resolution is new.

### 2. Connected issuers — new query

`getConnectedCardIssuers(workspaceId): Set<CardIssuer>`:
read `listBankCredentials(workspaceId)` and keep providers whose
`BANK_PROVIDERS[].kind === "card"` (`isracard`, `cal`, `max`, `amex`).

### 3. Matching engine — extend the `credit_card_payment` branch

`src/server/lib/matching.ts` `ProposeOptions` gains
`connectedCardIssuers: Set<CardIssuer>`. `runMatchingStep`
(`src/server/sync/matching-step.ts`) passes it in from the new query.

For each candidate that is `kind === "transfer"`, a bank provider, and matches a
card payment, resolve the issuer and decide (rows evaluated top-to-bottom; the first
match wins, so a workspace with zero connected cards always counts the bill
regardless of issuer/ambiguity):

| Situation | `flipKindTo` | Event status | Result |
|---|---|---|---|
| No card issuers connected at all | `expense` | confirmed | counts as spend |
| Issuer identified AND connected | `null` (stays transfer) | confirmed | excluded (current) |
| Issuer identified but NOT connected | `expense` | confirmed | counts as spend |
| Ambiguous AND >=1 card connected | `null` (stays transfer) | suggested (`needsReview`) | excluded, flagged |

`applyProposedEvents` already applies `flipKindTo` to `transactions.kind` and sets
`needsReview = 1` when the proposal is `needsReview`. The event still records the
`bill_payment` member with `priorKind`, so confirm/reject already restore the prior
state. Reasons strings are set per branch (e.g. `"<issuer> not connected; bill
counted as spend"`, `"card issuer undetermined; assumed covered — confirm"`).

### 4. Newly-counted bills get a category

Mirror the ATM precedent in `src/server/sync/orchestrator.ts`: after matching, for
card-payment transactions that ended up `kind = 'expense'` and uncategorized, assign
the seeded `Credit Card` category via `batchUpdateCategories`.

Seeding the category touches three places (same as `Cash & ATM`):

- New migration `025_seed_credit_card_category.sql` — insert `Credit Card` for
  existing workspaces and map its parent to `Money Movement`
  (see `017_seed_category_parents.sql`).
- `src/server/db/queries/workspaces.ts` per-workspace seed list (currently seeds
  `Cash & ATM` at line ~154).
- `src/server/db/queries/categories.ts` parent map (`Cash & ATM` → `Money Movement`
  at line ~264) gains `Credit Card` → `Money Movement`.

Color/icon: follow the existing palette migrations; a card icon (`credit-card`).

### 5. Re-derivation on integration change — `reclassifyCardPayments(workspaceId)`

Because events dedup by `eventKey` and `kind` is sticky once flipped, connecting or
removing a card must rebuild classification. New function (in
`src/server/db/queries/financial-events.ts` or a dedicated module):

1. Delete `financial_events` of `eventType = 'credit_card_payment'` for the
   workspace; for each member, reset the transaction to its `priorKind` (transfer),
   and clear `eventId`, `eventRole`, `needsReview`. Also clear the auto-assigned
   `Credit Card` category from those transactions so step 2 re-decides cleanly.
2. Re-run the `credit_card_payment` matching over all-time candidates with the fresh
   `connectedCardIssuers` set, then re-run the orchestrator's category-assignment
   pass for any that flipped to expense.

Hook it (card-kind providers only) into:

- `POST /api/setup/bank` (`src/app/api/setup/bank/route.ts`) after a card credential
  is saved.
- `DELETE /api/integrations/[id]` (`src/app/api/integrations/[id]/route.ts`) after a
  card credential is removed.

Scope is all-time: on local SQLite the one-time pass per integration change is cheap.

### 6. Surfacing the review flag

Ambiguous, flagged bill payments carry `needs_review = 1`, so they already appear in
the categorization review queue (`getReviewTransactions`, which selects
`t.needs_review = 1`) and as `suggested` financial events via `GET /api/events`.
Confirm keeps them excluded (transfer); reject flips them to expense via the existing
`priorKind` restore path. No new UI is required.

## Components and boundaries

- `transfers.ts` — pure text→issuer resolution. No DB, no workspace state.
- `getConnectedCardIssuers` — pure read of credentials → issuer set.
- `proposeEvents` — pure decision over candidates + settings + connected issuers.
- `reclassifyCardPayments` — orchestrates invalidate + re-run; the only stateful
  piece, isolated to one function and triggered by integration-change routes.

## Testing

- `matchCardPaymentIssuer`: each issuer, each ambiguous/network form, non-matches,
  and that the union equals `matchesCreditCardPayment`'s coverage.
- `proposeEvents`: the four rows in the table above, varying `connectedCardIssuers`
  (none / matching / non-matching / ambiguous-with-card).
- `reclassifyCardPayments`: connect a matching card → bill flips transfer and loses
  the `Credit Card` category; disconnect → flips back to expense with the category;
  ambiguous stays transfer + `needsReview`.
- Orchestrator: bank-only sync leaves card bills as `expense` categorized
  `Credit Card`; bank+card sync excludes them.

## Out of scope

- Amount/period matching of a bill against the sum of itemized purchases (option 3
  in brainstorming) — the connected-issuer heuristic is the v1.
- A user-facing setting to force-count or force-exclude card payments globally.
- Handling a bill paid from a bank for a card connected under a *different*
  workspace.

## Migration / compatibility

- `detectKind` and `CREDIT_CARD_PAYMENT_PATTERNS` are unchanged, so existing inserts
  and migration `021_reclassify_credit_card_transfers.sql` behave as before.
- New workspaces get `Credit Card`; existing workspaces get it via migration `025`.
- First sync after deploy re-runs matching over its window; a card connect/disconnect
  triggers the all-time rebuild.
