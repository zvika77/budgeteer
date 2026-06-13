-- Seed a dedicated "Credit Card" expense category so bank-side card bill
-- payments that count as spend (no matching card connected) have a clear home,
-- mirroring "Cash & ATM". Parented under "Money Movement" like other money-flow
-- categories. Idempotent via INSERT OR IGNORE on the per-workspace unique name.

INSERT OR IGNORE INTO categories
  (workspace_id, parent_id, name, color, icon, kind, budget_mode, description)
SELECT w.id, NULL, 'Credit Card', '#C7B27A', 'credit-card', 'expense', 'tracking',
       'Lump credit-card bill payments from a bank when the card itself is not connected.'
FROM workspaces w;

UPDATE categories
SET parent_id = (
  SELECT p.id FROM categories p
  WHERE p.workspace_id = categories.workspace_id
    AND p.parent_id IS NULL
    AND p.name = 'Money Movement'
)
WHERE name = 'Credit Card' AND kind = 'expense';
