ALTER TABLE transactions ADD COLUMN billing_local_date TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_ws_billing_local_date
  ON transactions(workspace_id, billing_local_date);
