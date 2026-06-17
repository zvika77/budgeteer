# Manual card-bill linking and rebuild

## Goal

Give the user two self-service tools, so they never again need a developer to fix card-bill matching:

1. A **Rebuild** button that re-runs card-payment classification for the workspace on demand.
2. The ability to **manually link / unlink** a bank bill row to one of the workspace's cards, so bills the heuristic could not match get attributed correctly. After linking, a rebuild nets the bill out and the spend numbers become correct.

## Background

A card's monthly statement appears twice in the data: once on the bank side as a single "bill" row (e.g. Leumi `כרטיסי אשראי` ₪449.79) and once on the card-issuer side as the individual purchases that make up that statement. Spend is computed as `kind = 'expense' AND is_excluded = 0`.

When the heuristic matches a bill to its purchases, the bill is flipped to `transfer` (netted out) and the purchases remain as expenses, so the money is counted once. When the heuristic **cannot** match a bill, the bill stays an `expense` (categorized "Credit Card") **and** the purchases also count as expenses, double-counting that statement.

The heuristic fails per billing cycle, not per card: a refund, fee, rounding difference, or same-day ambiguity throws off the amount for that one month, while the card's other months still match. The bank labels every card's bill with the same generic description, so the amount is the only thing that distinguishes one card's bill from another's on a shared bank account. There is therefore no reliable per-card identity on the bank side to key an automatic rule on; manual resolution is inherently per bill row.

## Approach

Linking is **per bill row**. The user picks which card a specific unmatched bill belongs to. A "bulk" experience is achieved by setting the card on several unmatched bills and applying them together, not by an inferred per-card rule.

The link is stored as a **durable override** keyed on the bill transaction id. Rebuild reads the overrides each time and re-materializes the match, so links survive re-syncs and automatically absorb newly-arrived purchases in the cycle.

## Data model

New table `manual_card_bill_links` (migration `029_manual_card_bill_links.sql`):

| column | type | notes |
| --- | --- | --- |
| `id` | integer PK | |
| `workspace_id` | integer not null | FK to `workspaces` |
| `bill_transaction_id` | integer not null | FK to `transactions`, the bank bill row |
| `account_number` | text not null | the card the bill is linked to |
| `created_at` | text not null | `datetime('now')` |

Unique index on `(workspace_id, bill_transaction_id)` — a bill links to at most one card. `ON DELETE CASCADE` from both `workspaces` and `transactions`, so deleting the bill or the workspace removes the override.

The override stores the **card account number, not the purchase rows**. The purchases are re-derived on every rebuild by billing cycle, which is what lets new purchases get included and keeps the override stable across re-syncs.

## Rebuild integration

`reclassifyCardPayments(workspaceId, connectedCardIssuers)` gains one step. The existing flow (clear non-rejected card events, free card rows stuck in internal transfers, run `proposeEvents`, apply, categorize) is unchanged. The new step runs after the heuristic proposals are applied:

1. Load all overrides for the workspace.
2. For each override:
   - Look up the bill transaction. If it is missing, skip (a stale override; it will be cleaned by the cascade on next delete).
   - Build the linked card's billing groups (reuse `buildCardBillingGroups`) and select the group whose `billingDay` is **nearest the bill's date**. Unlike the heuristic, do not require the amount to match.
   - If a group is found, force-create a `credit_card_statement` event: bill as `bill_payment` flipped to `transfer`, the group's purchases as `purchase` members, `source = 'user'`, `status = 'confirmed'`, confidence `1`, reason noting the manual link.
   - If no purchases exist in any cycle for that card, **do not** flip the bill. Leave it counting as spend and record a warning for the response (see Error handling).
3. Bills that have an override are excluded from the heuristic's own card-payment proposals, so a bill is never both a manual statement and a heuristic "counted as spend" event.

Because rebuild already clears non-rejected card events first, manual statements are rebuilt fresh from the overrides each run; there is no frozen state to go stale.

## API

All under `/api/matching`:

- `POST /api/matching/rebuild` — runs `reclassifyCardPayments` for the request's workspace. Returns `{ ok: true, warnings: string[] }` where warnings list any overrides that found no purchases.
- `POST /api/matching/links` — body `{ billId: number, accountNumber: string }`. Upserts an override (replace on conflict). Does **not** rebuild on its own; the caller decides when to rebuild.
- `DELETE /api/matching/links` — body `{ billId: number }`. Removes the override (unlink).

Workspace is resolved with the existing `getWorkspaceIdFromRequest` helper, consistent with `/api/events`.

## UI

### Settings "Card matching" section (primary surface)

A new section on the Settings page containing:

- A short two-line description of what rebuild does and when to use it, plus a **Rebuild** button (`POST /api/matching/rebuild`) with a success toast. If the response carries warnings, show them.
- A list of the workspace's **unmatched card bills** (rows whose description matches a card-payment pattern and that are not part of a `credit_card_statement`). Each entry shows date, description, amount, and a **card dropdown** populated from the workspace's card accounts, plus an "Auto" option meaning no override. Pre-select the current override if one exists.
- An **Apply & Rebuild** button: writes the changed overrides (`POST`/`DELETE /api/matching/links`) and then calls `POST /api/matching/rebuild`. Setting several rows before applying is the bulk path.

### Transactions table shortcut (secondary surface)

On an unmatched card-bill row, the existing row dropdown gains:

- **Link to card ▸** submenu listing the workspace's cards. Selecting one calls `POST /api/matching/links` then `POST /api/matching/rebuild` and invalidates the transactions query.
- **Unlink card** (shown only when the row already has an override) calls `DELETE /api/matching/links` then rebuilds.

## Error handling

- **Linked card has no purchases in any cycle:** the override is kept, but rebuild does not flip the bill (it keeps counting as spend). Rebuild returns a warning string per such override; the Settings section surfaces it so the user understands why a bill they linked still counts as spend.
- **Bill transaction deleted:** the `ON DELETE CASCADE` removes the override automatically. The rebuild loop also skips a missing bill defensively.
- **Linking a non-bill row:** the API does not validate that the chosen transaction "looks like" a bill (the user may know better than the heuristic). The UI only surfaces the action on bill-like rows, but the API stays permissive.

## Testing

Following the repo rule that tests are pure-logic only (better-sqlite3 does not load under `bun test`):

- New pure function `selectNearestCycleGroup(billDate, groups)` (in `matching.ts`) with unit tests: picks the nearest billing cycle, handles ties deterministically, returns null when there are no groups.
- Extend the mocked-tx `reclassify-card-payments.test.ts` to assert that overrides are loaded and that a bill with an override is excluded from the heuristic candidate set passed to `proposeEvents`.
- DB-level behavior (migration, override CRUD, full rebuild producing the statement) verified via the dev server, consistent with how `reclassifyCardPayments` is already validated.

## Out of scope

- A persistent per-card rule that auto-attributes all of a card's future bills (infeasible because bank bills for different cards are indistinguishable except by amount).
- Letting the user hand-pick individual purchase rows for a bill (the nearest-cycle grouping covers the real cases).
- Editing or splitting an already-matched statement.
