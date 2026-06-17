# Manual Card-Bill Linking and Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user rebuild card-payment matching on demand and manually link/unlink a bank bill row to one of the workspace's cards, so unmatched bills stop double-counting against spend.

**Architecture:** A durable override table (`manual_card_bill_links`) keyed on the bill transaction id stores "this bill belongs to card X". `reclassifyCardPayments` reads the overrides each run and force-creates a `credit_card_statement` linking the bill to that card's purchases in the nearest billing cycle, ignoring amount mismatch. A Settings "Card matching" section (and a transactions-row shortcut) drives link/unlink and rebuild through new `/api/matching/*` routes. Card-grouping/proposal logic stays in pure, unit-tested functions in `matching.ts`; DB orchestration is verified via the dev server (better-sqlite3 cannot load under `bun test`).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, better-sqlite3 + Drizzle, React Query + sonner toasts, shadcn/base-ui, Tailwind v4, next-intl, Bun test runner.

---

## File Structure

- `src/server/db/migrations/029_manual_card_bill_links.sql` — new table (DDL).
- `src/server/db/schema.ts` — add `manualCardBillLinks` Drizzle table.
- `src/server/db/queries/manual-card-bill-links.ts` — override CRUD (`getManualCardBillLinks`, `upsertManualCardBillLink`, `deleteManualCardBillLink`) + the unmatched-bill list query `getCardBillMatchingRows`.
- `src/server/lib/matching.ts` — add pure `selectNearestCycleGroup` and `buildManualStatementProposals`; add `manualBillIds` to `ProposeOptions` and skip those bills in the credit-card loop.
- `src/server/lib/matching.test.ts` — unit tests for the two new pure functions and the skip behavior.
- `src/server/db/queries/financial-events.ts` — `reclassifyCardPayments` loads overrides, excludes overridden bills from the heuristic, applies manual statements, returns `{ warnings }`.
- `src/server/db/queries/reclassify-card-payments.test.ts` — extend mocked-tx test for override load + exclusion.
- `src/app/api/matching/rebuild/route.ts`, `src/app/api/matching/links/route.ts`, `src/app/api/matching/route.ts` — new API.
- `src/lib/api.ts` + `src/lib/types.ts` — client fetchers and shared types.
- `src/app/[locale]/settings/matching/page.tsx` — new Settings section.
- `src/components/settings/settings-nav.tsx` — nav entry.
- `src/components/dashboard/transactions-table.tsx` — row shortcut.
- `src/i18n/messages/en.json`, `src/i18n/messages/he.json` — strings.
- `README.md` + `public/screenshots/*.png` — docs.

---

## Task 1: Override table (migration + schema)

**Files:**
- Create: `src/server/db/migrations/029_manual_card_bill_links.sql`
- Modify: `src/server/db/schema.ts` (append after `matchRules`)

- [ ] **Step 1: Write the migration**

Create `src/server/db/migrations/029_manual_card_bill_links.sql`:

```sql
-- Manual overrides linking a bank bill row to a specific card account.
--
-- The auto-matcher pairs a card's monthly bill (bank side) with that card's
-- purchases (card-issuer side) by amount and billing day. When a refund, fee,
-- or same-day ambiguity throws off the amount, the match fails and the bill
-- double-counts as spend. This table lets the user state the card explicitly.
-- Rebuild re-materializes the statement from this override every run, so the
-- link survives re-syncs and absorbs newly-arrived purchases in the cycle.

CREATE TABLE manual_card_bill_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bill_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  account_number TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_manual_card_bill_links_bill
  ON manual_card_bill_links (workspace_id, bill_transaction_id);
```

- [ ] **Step 2: Add the Drizzle table**

Append to `src/server/db/schema.ts`:

```typescript
export const manualCardBillLinks = sqliteTable("manual_card_bill_links", {
  id: integer().primaryKey({ autoIncrement: true }),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  billTransactionId: integer("bill_transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  accountNumber: text("account_number").notNull(),
  createdAt: createdAt(),
});
```

- [ ] **Step 3: Verify migration applies**

Run: `bun dev` and load `http://127.0.0.1:3000` once (migrations run on first DB open via `runMigrations`).
Then: `sqlite3 data/budgeteer.db ".schema manual_card_bill_links"`
Expected: prints the `CREATE TABLE manual_card_bill_links ...` statement and the unique index.

- [ ] **Step 4: Verify typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/migrations/029_manual_card_bill_links.sql src/server/db/schema.ts
git commit -m "feat: add manual_card_bill_links override table"
```

---

## Task 2: Override CRUD + unmatched-bill list query

**Files:**
- Create: `src/server/db/queries/manual-card-bill-links.ts`

DB code (better-sqlite3) is verified via the dev server in later tasks, consistent with the repo's "tests are pure-logic only" rule.

- [ ] **Step 1: Write the queries**

Create `src/server/db/queries/manual-card-bill-links.ts`:

```typescript
import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { getOrm } from "@/server/db/orm";
import { financialEvents, manualCardBillLinks, transactions } from "@/server/db/schema";

export interface ManualCardBillLink {
  billTransactionId: number;
  accountNumber: string;
}

export interface CardBillMatchingRow {
  billTransactionId: number;
  date: string;
  description: string;
  chargedAmount: number;
  chargedCurrency: string | null;
  linkedAccountNumber: string | null;
}

export function getManualCardBillLinks(workspaceId: number): ManualCardBillLink[] {
  return getOrm()
    .select({
      billTransactionId: manualCardBillLinks.billTransactionId,
      accountNumber: manualCardBillLinks.accountNumber,
    })
    .from(manualCardBillLinks)
    .where(eq(manualCardBillLinks.workspaceId, workspaceId))
    .all();
}

export function upsertManualCardBillLink(
  workspaceId: number,
  billTransactionId: number,
  accountNumber: string,
): void {
  getOrm()
    .insert(manualCardBillLinks)
    .values({ workspaceId, billTransactionId, accountNumber })
    .onConflictDoUpdate({
      target: [manualCardBillLinks.workspaceId, manualCardBillLinks.billTransactionId],
      set: { accountNumber, createdAt: sql`datetime('now')` },
    })
    .run();
}

export function deleteManualCardBillLink(workspaceId: number, billTransactionId: number): void {
  getOrm()
    .delete(manualCardBillLinks)
    .where(
      and(
        eq(manualCardBillLinks.workspaceId, workspaceId),
        eq(manualCardBillLinks.billTransactionId, billTransactionId),
      ),
    )
    .run();
}
```

- [ ] **Step 2: Add the matching-rows list query**

Append to the same file. It returns every bill that is either an unmatched card payment (`credit_card_payment` event) or already has an override, annotated with the current linked card. The repo runs raw SQL via `getDb().prepare(...)` (better-sqlite3), so follow that pattern — add `import { getDb } from "@/server/db/index";` to the file:

```typescript
export function getCardBillMatchingRows(workspaceId: number): CardBillMatchingRow[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id AS bill_transaction_id,
              t.date AS date,
              t.description AS description,
              t.charged_amount AS charged_amount,
              t.charged_currency AS charged_currency,
              l.account_number AS linked_account_number
       FROM transactions t
       LEFT JOIN manual_card_bill_links l
         ON l.workspace_id = t.workspace_id AND l.bill_transaction_id = t.id
       LEFT JOIN financial_events e
         ON e.id = t.event_id
       WHERE t.workspace_id = ?
         AND (
           l.bill_transaction_id IS NOT NULL
           OR (e.event_type = 'credit_card_payment' AND e.status != 'rejected')
         )
       ORDER BY t.date DESC`,
    )
    .all(workspaceId) as Array<{
    bill_transaction_id: number;
    date: string;
    description: string;
    charged_amount: number;
    charged_currency: string | null;
    linked_account_number: string | null;
  }>;
  return rows.map((r) => ({
    billTransactionId: r.bill_transaction_id,
    date: r.date,
    description: r.description,
    chargedAmount: r.charged_amount,
    chargedCurrency: r.charged_currency,
    linkedAccountNumber: r.linked_account_number,
  }));
}
```

Note: the CRUD functions above use Drizzle (`getOrm()`); this list query uses `getDb()` raw SQL. Both imports are needed at the top of the file. Remove the unused `financialEvents`/`transactions` schema imports if Drizzle does not reference them (the CRUD functions only reference `manualCardBillLinks`).

- [ ] **Step 3: Verify typecheck and knip**

Run: `bun run typecheck && bun run knip`
Expected: no errors. (knip may report the new exports as unused until Task 4/5 consume them; if so, proceed — they are consumed by the end of the plan. Re-run knip at Task 9 for the final gate.)

- [ ] **Step 4: Commit**

```bash
git add src/server/db/queries/manual-card-bill-links.ts
git commit -m "feat: queries for manual card-bill link overrides"
```

---

## Task 3: Pure nearest-cycle selection

**Files:**
- Modify: `src/server/lib/matching.ts`
- Test: `src/server/lib/matching.test.ts`

`CardBillingGroup` (already defined in `matching.ts`) has shape `{ credentialId, accountNumber, issuer, billingDay, amount, transactionIds }`. `dayNumber(date)` is an existing helper in `matching.ts`.

- [ ] **Step 1: Write the failing test**

Append to `src/server/lib/matching.test.ts`, inside a new `describe` block at the end of the file:

```typescript
import { selectNearestCycleGroup } from "@/server/lib/matching";

describe("selectNearestCycleGroup", () => {
  const g = (billingDay: number, amount: number): CardBillingGroup => ({
    credentialId: 9,
    accountNumber: "5052",
    issuer: "cal",
    billingDay,
    amount,
    transactionIds: [billingDay],
  });

  test("returns null when there are no groups", () => {
    expect(selectNearestCycleGroup("2026-05-09", [])).toBeNull();
  });

  test("picks the group whose billing day is closest to the bill date", () => {
    const dayJun = Math.floor(Date.parse("2026-06-09") / 86_400_000);
    const dayMay = Math.floor(Date.parse("2026-05-09") / 86_400_000);
    const chosen = selectNearestCycleGroup("2026-05-10", [g(dayJun, 1417.69), g(dayMay, 449.79)]);
    expect(chosen?.billingDay).toBe(dayMay);
  });

  test("breaks ties by the earlier billing day for determinism", () => {
    const billDay = Math.floor(Date.parse("2026-05-09") / 86_400_000);
    const chosen = selectNearestCycleGroup("2026-05-09", [
      g(billDay + 2, 10),
      g(billDay - 2, 20),
    ]);
    expect(chosen?.billingDay).toBe(billDay - 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions react-server src/server/lib/matching.test.ts`
Expected: FAIL — `selectNearestCycleGroup` is not exported / not a function.

- [ ] **Step 3: Implement the function**

Add to `src/server/lib/matching.ts` (near `matchBillToGroup`):

```typescript
export function selectNearestCycleGroup(
  billDate: string,
  groups: readonly CardBillingGroup[],
): CardBillingGroup | null {
  if (groups.length === 0) return null;
  const billDay = dayNumber(billDate);
  let best: CardBillingGroup | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const group of groups) {
    const distance = Math.abs(group.billingDay - billDay);
    if (distance < bestDistance || (distance === bestDistance && best && group.billingDay < best.billingDay)) {
      best = group;
      bestDistance = distance;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --conditions react-server src/server/lib/matching.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/matching.ts src/server/lib/matching.test.ts
git commit -m "feat: selectNearestCycleGroup for manual bill linking"
```

---

## Task 4: Manual statement proposals + heuristic skip (pure)

**Files:**
- Modify: `src/server/lib/matching.ts`
- Test: `src/server/lib/matching.test.ts`

`ProposedEvent`, `ProposedMember`, `MatchCandidate`, `ProposeOptions`, `buildCardBillingGroups`, `eventKeyFor` already exist in `matching.ts`. A `ManualBillLink` input is `{ billTransactionId, accountNumber }`.

- [ ] **Step 1: Write the failing test for `buildManualStatementProposals`**

Append to `src/server/lib/matching.test.ts`:

```typescript
import { buildManualStatementProposals } from "@/server/lib/matching";

describe("buildManualStatementProposals", () => {
  const billCand = (over: Partial<MatchCandidate>): MatchCandidate => ({
    id: 100,
    credentialId: null,
    accountNumber: "946-354388_73",
    provider: "leumi",
    date: "2026-05-09",
    processedDate: "2026-05-09",
    chargedAmount: -449.79,
    chargedCurrency: "ILS",
    description: "כרטיסי אשראי",
    kind: "transfer",
    dedupHash: "hbill",
    dedupSequence: 0,
    ...over,
  });
  const purchaseCand = (id: number, amount: number): MatchCandidate => ({
    id,
    credentialId: 9,
    accountNumber: "5052",
    provider: "cal",
    date: "2026-05-09",
    processedDate: "2026-05-09T00:00:00.000Z",
    chargedAmount: amount,
    chargedCurrency: "ILS",
    description: "p",
    kind: "expense",
    dedupHash: `h${id}`,
    dedupSequence: 0,
  });

  test("links the bill to the nearest cycle of the chosen card despite amount mismatch", () => {
    const candidates = [billCand({}), purchaseCand(1, -347.89), purchaseCand(2, -50)];
    const { proposals, warnings } = buildManualStatementProposals(candidates, [
      { billTransactionId: 100, accountNumber: "5052" },
    ]);
    expect(warnings).toEqual([]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].eventType).toBe("credit_card_statement");
    const bill = proposals[0].members.find((m) => m.role === "bill_payment");
    expect(bill?.transactionId).toBe(100);
    expect(bill?.flipKindTo).toBe("transfer");
    const purchaseIds = proposals[0].members
      .filter((m) => m.role === "purchase")
      .map((m) => m.transactionId)
      .sort();
    expect(purchaseIds).toEqual([1, 2]);
  });

  test("warns and produces no proposal when the card has no purchases", () => {
    const { proposals, warnings } = buildManualStatementProposals([billCand({})], [
      { billTransactionId: 100, accountNumber: "5052" },
    ]);
    expect(proposals).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("5052");
  });

  test("ignores an override whose bill transaction is not in the candidate set", () => {
    const { proposals, warnings } = buildManualStatementProposals([purchaseCand(1, -10)], [
      { billTransactionId: 999, accountNumber: "5052" },
    ]);
    expect(proposals).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions react-server src/server/lib/matching.test.ts`
Expected: FAIL — `buildManualStatementProposals` is not exported.

- [ ] **Step 3: Implement `buildManualStatementProposals`**

Add to `src/server/lib/matching.ts`:

```typescript
export interface ManualBillLink {
  billTransactionId: number;
  accountNumber: string;
}

export interface ManualStatementResult {
  proposals: ProposedEvent[];
  warnings: string[];
}

export function buildManualStatementProposals(
  candidates: readonly MatchCandidate[],
  links: readonly ManualBillLink[],
): ManualStatementResult {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const proposals: ProposedEvent[] = [];
  const warnings: string[] = [];

  for (const link of links) {
    const bill = byId.get(link.billTransactionId);
    if (!bill) continue;

    const cardPurchases = candidates.filter(
      (c) => c.accountNumber === link.accountNumber && c.id !== bill.id && c.kind !== "transfer",
    );
    const groups = buildCardBillingGroupsForAccount(cardPurchases, link.accountNumber);
    const group = selectNearestCycleGroup(bill.date, groups);
    if (!group) {
      warnings.push(`Card ${link.accountNumber} has no purchases to link to bill ${bill.id}`);
      continue;
    }

    const purchases = group.transactionIds
      .map((id) => byId.get(id))
      .filter((p): p is MatchCandidate => p != null);
    const members: ProposedMember[] = [
      {
        transactionId: bill.id,
        role: "bill_payment",
        flipKindTo: "transfer",
        priorKind: bill.kind,
        grouping: true,
      },
      ...purchases.map((p) => ({
        transactionId: p.id,
        role: "purchase" as EventRole,
        flipKindTo: null,
        priorKind: p.kind,
        grouping: false,
      })),
    ];
    proposals.push({
      eventType: "credit_card_statement",
      members,
      canonicalTransactionId: null,
      confidence: 1,
      reasons: [`Manually linked to card ${link.accountNumber}`],
      eventKey: eventKeyFor("credit_card_statement", [bill, ...purchases]),
      needsReview: false,
    });
  }

  return { proposals, warnings };
}
```

- [ ] **Step 4: Add the account-scoped grouping helper**

`buildCardBillingGroups` filters by connected issuers; the manual path must group a specific account regardless of connection. Add to `src/server/lib/matching.ts`:

```typescript
function buildCardBillingGroupsForAccount(
  candidates: readonly MatchCandidate[],
  accountNumber: string,
): CardBillingGroup[] {
  const byKey = new Map<string, CardBillingGroup>();
  for (const c of candidates) {
    if (c.accountNumber !== accountNumber) continue;
    const billingDay = dayNumber(c.processedDate);
    if (Number.isNaN(billingDay)) continue;
    const key = String(billingDay);
    const existing = byKey.get(key);
    if (existing) {
      existing.amount += Math.abs(c.chargedAmount);
      existing.transactionIds.push(c.id);
    } else {
      byKey.set(key, {
        credentialId: c.credentialId,
        accountNumber: c.accountNumber,
        issuer: c.provider as CardIssuer,
        billingDay,
        amount: Math.abs(c.chargedAmount),
        transactionIds: [c.id],
      });
    }
  }
  return [...byKey.values()];
}
```

- [ ] **Step 5: Add `manualBillIds` to `ProposeOptions` and skip those bills**

In `src/server/lib/matching.ts`, extend the `ProposeOptions` interface:

```typescript
  manualBillIds?: ReadonlySet<number>;
```

Then in the `credit_card_payment` loop inside `proposeEvents`, add a skip right after `if (used.has(cand.id)) continue;`:

```typescript
      if (opts.manualBillIds?.has(cand.id)) continue;
```

- [ ] **Step 6: Write the failing test for the skip**

Append to the `proposeEvents` describe block in `src/server/lib/matching.test.ts`:

```typescript
  test("skips a bill that is reserved for a manual link", () => {
    const events = proposeEvents(
      [cand({ id: 5, provider: "leumi", kind: "transfer", description: "תשלום לכ.א.ל" })],
      SETTINGS,
      { treatAtmAsTransfers: false, connectedCardIssuers: withCal, manualBillIds: new Set([5]) },
    );
    expect(events).toHaveLength(0);
  });
```

- [ ] **Step 7: Run tests to verify pass**

Run: `bun test --conditions react-server src/server/lib/matching.test.ts`
Expected: PASS, all green.

- [ ] **Step 8: Commit**

```bash
git add src/server/lib/matching.ts src/server/lib/matching.test.ts
git commit -m "feat: manual card-statement proposals and heuristic skip"
```

---

## Task 5: Wire overrides into reclassifyCardPayments

**Files:**
- Modify: `src/server/db/queries/financial-events.ts`
- Modify: `src/server/db/queries/reclassify-card-payments.test.ts`
- Modify callers: `src/app/api/setup/bank/route.ts`, `src/app/api/integrations/[id]/route.ts`, `src/server/sync/orchestrator.ts` (return value now `{ warnings }`, callers ignore it)

- [ ] **Step 1: Change `reclassifyCardPayments` to load overrides, exclude bills, apply manual statements, return warnings**

In `src/server/db/queries/financial-events.ts`:

Add import:

```typescript
import { getManualCardBillLinks } from "@/server/db/queries/manual-card-bill-links";
import { buildManualStatementProposals } from "@/server/lib/matching";
```

Change the signature and the proposal section. Replace:

```typescript
export function reclassifyCardPayments(
  workspaceId: number,
  connectedCardIssuers: ReadonlySet<CardIssuer>,
): void {
```

with:

```typescript
export function reclassifyCardPayments(
  workspaceId: number,
  connectedCardIssuers: ReadonlySet<CardIssuer>,
): { warnings: string[] } {
```

After the `getOrm().transaction(...)` clear block and the `const candidates = ...` line, replace the proposal/apply section:

```typescript
  const settings = getMatchSettingsMap(workspaceId);
  const links = getManualCardBillLinks(workspaceId);
  const manualBillIds = new Set(links.map((l) => l.billTransactionId));
  const proposals = proposeEvents(candidates, settings, {
    treatAtmAsTransfers: false,
    connectedCardIssuers,
    manualBillIds,
  });
  applyProposedEvents(workspaceId, proposals);

  const manual = buildManualStatementProposals(candidates, links);
  applyProposedEvents(workspaceId, manual.proposals);
```

At the end of the function, return warnings:

```typescript
  return { warnings: manual.warnings };
```

(The existing `creditCardCategory` block stays; the function now ends with the `return`.)

- [ ] **Step 2: Update the mocked-tx test for override loading and exclusion**

In `src/server/db/queries/reclassify-card-payments.test.ts`, add a mock for the overrides query and the new matching export. Add near the other `mock.module` calls:

```typescript
mock.module("@/server/db/queries/manual-card-bill-links", () => ({
  getManualCardBillLinks: () => [{ billTransactionId: 42, accountNumber: "5052" }],
}));
```

Extend the existing `mock.module("@/server/lib/matching", ...)` factory to also export `buildManualStatementProposals` and to capture `manualBillIds`:

```typescript
mock.module("@/server/lib/matching", () => ({
  proposeEvents: (
    candidates: Array<{ id: number; kind: string }>,
    _settings: unknown,
    options: { connectedCardIssuers: ReadonlySet<CardIssuer>; manualBillIds?: ReadonlySet<number> },
  ) => {
    capturedCandidateIds.push(candidates.map((c) => c.id));
    capturedCandidateKinds.push(candidates.map((c) => ({ id: c.id, kind: c.kind })));
    connectedIssuersSeen.push(options.connectedCardIssuers);
    capturedManualBillIds.push(options.manualBillIds ?? new Set<number>());
    if (options.connectedCardIssuers.has("cal" as CardIssuer)) return [];
    return [{ members: [{ transactionId: 42, role: "bill_payment", flipKindTo: "expense" }] }];
  },
  buildManualStatementProposals: () => ({ proposals: [], warnings: [] }),
}));
```

Add the capture array near the other captures:

```typescript
const capturedManualBillIds: ReadonlySet<number>[] = [];
```

Add a test:

```typescript
  test("reserves manually-linked bills from the heuristic", () => {
    capturedManualBillIds.length = 0;
    reclassifyCardPayments(fakeWorkspaceId, new Set<CardIssuer>());
    expect(capturedManualBillIds[0]?.has(42)).toBe(true);
  });
```

- [ ] **Step 3: Update callers to ignore the new return value**

These three call sites already call `reclassifyCardPayments(...)` as a statement; no code change is required because the return value is simply unused. Verify each still typechecks:
- `src/app/api/setup/bank/route.ts:77`
- `src/app/api/integrations/[id]/route.ts:109`
- `src/server/sync/orchestrator.ts:437`

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test --conditions react-server && bun run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/queries/financial-events.ts src/server/db/queries/reclassify-card-payments.test.ts
git commit -m "feat: apply manual card-bill overrides during rebuild"
```

---

## Task 6: API routes

**Files:**
- Create: `src/app/api/matching/rebuild/route.ts`
- Create: `src/app/api/matching/links/route.ts`
- Create: `src/app/api/matching/route.ts`

Pattern reference: `src/app/api/events/route.ts` uses `getWorkspaceIdFromRequest` and `NextResponse`.

- [ ] **Step 1: Rebuild route**

Create `src/app/api/matching/rebuild/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getConnectedCardIssuers } from "@/server/db/queries/bank-credentials";
import { reclassifyCardPayments } from "@/server/db/queries/financial-events";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { warnings } = reclassifyCardPayments(workspaceId, getConnectedCardIssuers(workspaceId));
  return NextResponse.json({ ok: true, warnings });
}
```

- [ ] **Step 2: Links route (upsert + delete)**

Create `src/app/api/matching/links/route.ts`:

```typescript
import { NextResponse } from "next/server";
import {
  deleteManualCardBillLink,
  upsertManualCardBillLink,
} from "@/server/db/queries/manual-card-bill-links";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json().catch(() => ({}))) as {
    billId?: unknown;
    accountNumber?: unknown;
  };
  const billId = Number(body.billId);
  const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber : "";
  if (!Number.isFinite(billId) || billId <= 0 || accountNumber === "") {
    return NextResponse.json({ error: "billId and accountNumber are required" }, { status: 400 });
  }
  upsertManualCardBillLink(workspaceId, billId, accountNumber);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json().catch(() => ({}))) as { billId?: unknown };
  const billId = Number(body.billId);
  if (!Number.isFinite(billId) || billId <= 0) {
    return NextResponse.json({ error: "billId is required" }, { status: 400 });
  }
  deleteManualCardBillLink(workspaceId, billId);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: List route (unmatched bills + workspace cards)**

Create `src/app/api/matching/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { BANK_PROVIDERS } from "@/lib/types";
import { listBankAccounts } from "@/server/db/queries/bank-accounts";
import { getCardBillMatchingRows } from "@/server/db/queries/manual-card-bill-links";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const cardProviders = new Set(
    BANK_PROVIDERS.filter((b) => b.kind === "card").map((b) => b.id),
  );
  const seen = new Set<string>();
  const cards = listBankAccounts(workspaceId)
    .filter((a) => cardProviders.has(a.provider) && !seen.has(a.accountNumber) && seen.add(a.accountNumber))
    .map((a) => ({
      accountNumber: a.accountNumber,
      name: a.name,
      provider: a.provider,
    }));
  return NextResponse.json({ bills: getCardBillMatchingRows(workspaceId), cards });
}
```

`listBankAccounts(workspaceId)` returns `BankAccount[]` with `provider`, `accountNumber`, and non-null `name`. The `seen` set dedupes shared cards that surface under more than one credential.

- [ ] **Step 4: Verify routes respond**

Run `bun dev`, then:

```bash
curl -s -X POST http://localhost:3000/api/matching/rebuild -H "Origin: http://localhost:3000"
curl -s http://localhost:3000/api/matching -H "Origin: http://localhost:3000"
```

Expected: rebuild returns `{"ok":true,"warnings":[...]}`; list returns `{"bills":[...],"cards":[...]}`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/matching
git commit -m "feat: /api/matching rebuild, links, and list routes"
```

---

## Task 7: Client API + types

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add shared types**

Append to `src/lib/types.ts`:

```typescript
export interface CardBillMatchingRow {
  billTransactionId: number;
  date: string;
  description: string;
  chargedAmount: number;
  chargedCurrency: string | null;
  linkedAccountNumber: string | null;
}

export interface MatchingCardOption {
  accountNumber: string;
  name: string | null;
  provider: string;
}

export interface CardBillMatchingData {
  bills: CardBillMatchingRow[];
  cards: MatchingCardOption[];
}
```

- [ ] **Step 2: Add client fetchers**

Append to `src/lib/api.ts` (using the existing `fetchJSON` helper):

```typescript
export function getCardBillMatching() {
  return fetchJSON<CardBillMatchingData>("/api/matching");
}

export function rebuildCardMatching() {
  return fetchJSON<{ ok: true; warnings: string[] }>("/api/matching/rebuild", { method: "POST" });
}

export function linkCardBill(billId: number, accountNumber: string) {
  return fetchJSON<{ ok: true }>("/api/matching/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ billId, accountNumber }),
  });
}

export function unlinkCardBill(billId: number) {
  return fetchJSON<{ ok: true }>("/api/matching/links", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ billId }),
  });
}
```

Add `CardBillMatchingData` to the existing type import from `@/lib/types` at the top of `src/lib/api.ts`.

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/api.ts
git commit -m "feat: client API for card-bill matching"
```

---

## Task 8: Settings "Card matching" section

**Files:**
- Create: `src/app/[locale]/settings/matching/page.tsx`
- Modify: `src/components/settings/settings-nav.tsx`
- Modify: `src/i18n/messages/en.json`, `src/i18n/messages/he.json`

Pattern reference: `src/app/[locale]/settings/general/page.tsx` (uses `SectionShell`, `SettingCard`, React Query, `toast`, `useTranslations`). Select pattern: `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` from `@/components/ui/select` (base-ui; `onValueChange` yields `string | null`).

- [ ] **Step 1: Add the nav entry**

In `src/components/settings/settings-nav.tsx`, import an icon and add an item after the `bank` entry:

```typescript
import { CreditCard } from "lucide-react";
```

```typescript
  {
    href: "/settings/matching",
    labelKey: "matching",
    Icon: CreditCard,
    match: (p) => p.startsWith("/settings/matching"),
  },
```

- [ ] **Step 2: Add i18n strings**

In `src/i18n/messages/en.json`, under `settings.sidebar` add `"matching": "Card matching"`. Add a new `settings.matching` block:

```json
"matching": {
  "title": "Card matching",
  "description": "Link credit-card bills to the right card so spend is counted once.",
  "rebuildTitle": "Rebuild card matching",
  "rebuildDescription": "Re-checks every credit-card bill against your cards and applies your manual links. Run this if a bill shows the wrong total or after you change a link.",
  "rebuildButton": "Rebuild now",
  "rebuilding": "Rebuilding...",
  "rebuildDone": "Card matching rebuilt",
  "unmatchedTitle": "Unmatched bills",
  "unmatchedDescription": "Pick the card each bill belongs to, then apply. The matched purchases are pulled in automatically.",
  "auto": "Auto",
  "applyButton": "Apply & rebuild",
  "applying": "Applying...",
  "noBills": "No unmatched bills. Everything is matched.",
  "warning": "{count, plural, one {# bill could not be matched: its card has no purchases.} other {# bills could not be matched: their cards have no purchases.}}"
}
```

In `src/i18n/messages/he.json`, add the parallel Hebrew block (every plural branch must contain `#`):

```json
"matching": {
  "title": "התאמת כרטיסים",
  "description": "קשר חיובי כרטיס אשראי לכרטיס הנכון כדי שההוצאה תיספר פעם אחת.",
  "rebuildTitle": "בנייה מחדש של ההתאמות",
  "rebuildDescription": "בודק מחדש כל חיוב כרטיס אשראי מול הכרטיסים שלך ומחיל את הקישורים הידניים. הרץ זאת אם חיוב מציג סכום שגוי או אחרי שינוי קישור.",
  "rebuildButton": "בנה מחדש",
  "rebuilding": "בונה מחדש...",
  "rebuildDone": "ההתאמות נבנו מחדש",
  "unmatchedTitle": "חיובים ללא התאמה",
  "unmatchedDescription": "בחר את הכרטיס שאליו שייך כל חיוב ולחץ החל. העסקאות התואמות יצורפו אוטומטית.",
  "auto": "אוטומטי",
  "applyButton": "החל ובנה מחדש",
  "applying": "מחיל...",
  "noBills": "אין חיובים ללא התאמה. הכול מותאם.",
  "warning": "{count, plural, one {# חיוב לא ניתן להתאמה: לכרטיס שלו אין עסקאות.} other {# חיובים לא ניתנו להתאמה: לכרטיסים שלהם אין עסקאות.}}"
}
```

- [ ] **Step 3: Build the page**

Create `src/app/[locale]/settings/matching/page.tsx`:

```typescript
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { SectionShell, SettingCard } from "@/components/settings/section-shell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Locale } from "@/i18n/routing";
import {
  getCardBillMatching,
  linkCardBill,
  rebuildCardMatching,
  unlinkCardBill,
} from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";

const AUTO = "__auto__";

export default function MatchingSettingsPage() {
  const t = useTranslations("settings.matching");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["cardBillMatching"], queryFn: getCardBillMatching });

  const [pending, setPending] = useState<Record<number, string>>({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["cardBillMatching"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["summary"] });
  };

  const rebuild = useMutation({
    mutationFn: rebuildCardMatching,
    onSuccess: (res) => {
      invalidate();
      toast.success(t("rebuildDone"));
      if (res.warnings.length > 0) {
        toast.warning(t("warning", { count: res.warnings.length }));
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : tCommon("error")),
  });

  const apply = useMutation({
    mutationFn: async () => {
      for (const [billIdStr, value] of Object.entries(pending)) {
        const billId = Number(billIdStr);
        if (value === AUTO) await unlinkCardBill(billId);
        else await linkCardBill(billId, value);
      }
      return rebuildCardMatching();
    },
    onSuccess: (res) => {
      setPending({});
      invalidate();
      toast.success(t("rebuildDone"));
      if (res.warnings.length > 0) {
        toast.warning(t("warning", { count: res.warnings.length }));
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : tCommon("error")),
  });

  const bills = data?.bills ?? [];
  const cards = data?.cards ?? [];
  const dirty = Object.keys(pending).length > 0;

  return (
    <SectionShell title={t("title")} description={t("description")}>
      <SettingCard title={t("rebuildTitle")} description={t("rebuildDescription")}>
        <div className="flex justify-end">
          <Button onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>
            {rebuild.isPending ? t("rebuilding") : t("rebuildButton")}
          </Button>
        </div>
      </SettingCard>

      <SettingCard title={t("unmatchedTitle")} description={t("unmatchedDescription")}>
        {bills.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noBills")}</p>
        ) : (
          <div className="space-y-3">
            {bills.map((bill) => {
              const current =
                pending[bill.billTransactionId] ?? bill.linkedAccountNumber ?? AUTO;
              return (
                <div
                  key={bill.billTransactionId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{bill.description}</p>
                    <p className="text-xs text-muted-foreground">{bill.date.slice(0, 10)}</p>
                  </div>
                  <span className="shrink-0 tabular-nums text-sm">
                    {formatCurrency(bill.chargedAmount, bill.chargedCurrency ?? "ILS", locale)}
                  </span>
                  <Select
                    value={current}
                    onValueChange={(v) =>
                      v &&
                      setPending((p) => ({ ...p, [bill.billTransactionId]: v }))
                    }
                  >
                    <SelectTrigger className="w-40 shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO}>{t("auto")}</SelectItem>
                      {cards.map((c) => (
                        <SelectItem key={c.accountNumber} value={c.accountNumber}>
                          {c.name ? `${c.name} (${c.accountNumber})` : c.accountNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
            <div className="flex justify-end">
              <Button onClick={() => apply.mutate()} disabled={!dirty || apply.isPending}>
                {apply.isPending ? t("applying") : t("applyButton")}
              </Button>
            </div>
          </div>
        )}
      </SettingCard>
    </SectionShell>
  );
}
```

- [ ] **Step 4: Verify in the browser**

Run `bun dev`, open `http://127.0.0.1:3000/en/settings/matching`. Confirm: the section renders, the rebuild button works (toast), unmatched bills list with card dropdowns, "Apply & rebuild" links and refreshes. Use the preview tools to check console for errors and capture a screenshot.

- [ ] **Step 5: Verify i18n check**

Run: `bun run i18n:check`
Expected: no missing/orphan keys.

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/settings/matching/page.tsx" src/components/settings/settings-nav.tsx src/i18n/messages/en.json src/i18n/messages/he.json
git commit -m "feat: Card matching settings section with rebuild and per-bill linking"
```

---

## Task 9: Transactions-table row shortcut

**Files:**
- Modify: `src/components/dashboard/transactions-table.tsx`
- Modify: `src/i18n/messages/en.json`, `src/i18n/messages/he.json`

The row dropdown is in `transactions-table.tsx` around lines 579-614. A bill row is identified by `txn.eventRole === "bill_payment"`. The workspace cards come from a `getCardBillMatching` query (reuse the same fetcher).

- [ ] **Step 1: Add i18n strings**

In `en.json` under `transactions` add:

```json
"linkToCard": "Link to card",
"unlinkCard": "Auto (unlink)",
"cardLinked": "Linked to card"
```

In `he.json` under `transactions` add:

```json
"linkToCard": "קשר לכרטיס",
"unlinkCard": "אוטומטי (בטל קישור)",
"cardLinked": "קושר לכרטיס"
```

- [ ] **Step 2: Add the submenu to the row dropdown**

In `src/components/dashboard/transactions-table.tsx`:

Add imports:

```typescript
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { getCardBillMatching, linkCardBill, rebuildCardMatching, unlinkCardBill } from "@/lib/api";
```

Inside the component, add a query for cards and handlers:

```typescript
  const matchingQuery = useQuery({ queryKey: ["cardBillMatching"], queryFn: getCardBillMatching });
  const cards = matchingQuery.data?.cards ?? [];

  const handleLinkCard = async (billId: number, accountNumber: string | null) => {
    try {
      if (accountNumber) await linkCardBill(billId, accountNumber);
      else await unlinkCardBill(billId);
      await rebuildCardMatching();
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["cardBillMatching"] });
      toast.success(t("cardLinked"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tCommon("error"));
    }
  };
```

(`tCommon` is `useTranslations("common")`; add it if the component does not already have it.)

In the `DropdownMenuContent` of the row actions (after the kind items, before the exclude items), add:

```typescript
                            {txn.eventRole === "bill_payment" && cards.length > 0 && (
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  {t("linkToCard")}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  <DropdownMenuItem onClick={() => handleLinkCard(txn.id, null)}>
                                    {t("unlinkCard")}
                                  </DropdownMenuItem>
                                  {cards.map((c) => (
                                    <DropdownMenuItem
                                      key={c.accountNumber}
                                      onClick={() => handleLinkCard(txn.id, c.accountNumber)}
                                    >
                                      {c.name ? `${c.name} (${c.accountNumber})` : c.accountNumber}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                            )}
```

First confirm the sub-menu primitives exist: `grep -n "DropdownMenuSub" src/components/ui/dropdown-menu.tsx`. If they are not exported, add thin wrappers following the existing exports in that file (base-ui `Menu.SubmenuRoot`, `Menu.SubmenuTrigger`, `Menu.Popup`), mirroring the pattern already used for `DropdownMenuContent`.

- [ ] **Step 3: Verify in the browser**

Run `bun dev`, open the transactions table, find a bill row (e.g. a `כרטיסי אשראי` row), open its actions menu, confirm "Link to card" submenu lists the cards and "Auto (unlink)". Link one and confirm the table/summary refresh. Check console via preview tools; capture a screenshot.

- [ ] **Step 4: Verify i18n + typecheck**

Run: `bun run i18n:check && bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/transactions-table.tsx src/i18n/messages/en.json src/i18n/messages/he.json
git commit -m "feat: link/unlink card from the transactions row menu"
```

---

## Task 10: README, screenshot, full CI gate

**Files:**
- Modify: `README.md`
- Modify/Create: `public/screenshots/*.png` (only from synthetic/mock data — never the live `data/budgeteer.db`)

- [ ] **Step 1: Update the README**

Add a short subsection describing the new Settings "Card matching" section (rebuild + per-bill linking) and the transactions-row "Link to card" shortcut, under the existing settings/features documentation.

- [ ] **Step 2: Regenerate affected screenshots from a mock DB**

Per CLAUDE.md: seed a throwaway mock database and point the app at it with `BUDGETEER_DATA_DIR`, capture the new Settings "Card matching" screen, and save to `public/screenshots/`. Never capture from the live DB. If no settings screenshot is referenced by the README, skip this step.

- [ ] **Step 3: Run the full CI gate**

Run: `bun run format && bun run ci`
Expected: `format:check`, `i18n:check`, `knip`, `react:doctor`, and `bun test` all pass. (The `security` step may flag the pre-existing `hono` transitive advisory unrelated to this work; the five strict checks above are the gate.)

- [ ] **Step 4: Manual end-to-end verification on the dev server**

With `bun dev` running and a real linked-bill scenario:
1. Settings → Card matching: an unmatched bill appears.
2. Pick its card, Apply & rebuild.
3. The bill flips out of spend (no longer double-counted); the matched statement shows in transactions.
4. Unlink (set to Auto), Apply & rebuild: the bill reverts to counting as spend.

- [ ] **Step 5: Commit**

```bash
git add README.md public/screenshots
git commit -m "docs: document card matching settings and row shortcut"
```

---

## Self-Review notes

- **Spec coverage:** override table (Task 1), CRUD + list (Task 2), nearest-cycle (Task 3), manual proposals + heuristic skip (Task 4), rebuild integration returning warnings (Task 5), three API routes (Task 6), client API/types (Task 7), Settings section with rebuild + bulk (Task 8), row shortcut (Task 9), error-handling warnings surfaced in UI (Tasks 5/8), docs + CI (Task 10). All spec sections map to a task.
- **No-purchases guard:** implemented in `buildManualStatementProposals` (Task 4) and surfaced as toast warnings (Tasks 5/8).
- **Type consistency:** `reclassifyCardPayments` returns `{ warnings: string[] }` everywhere (Tasks 5, 6); `ManualBillLink`/`buildManualStatementProposals`/`selectNearestCycleGroup` signatures match across tasks; `manualBillIds` added to `ProposeOptions` (Task 4) and supplied in Task 5.
- **Tests:** pure functions unit-tested under `bun test --conditions react-server`; DB orchestration verified via dev server, per repo norms.
```
