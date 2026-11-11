-- Rollback Migration 002: LOTH COIN (LTH) Wallet, PoS Staking & Accounting Ledger

DROP TABLE IF EXISTS distributed_scheduler_leases;
DROP TABLE IF EXISTS lth_transfers;
DROP TABLE IF EXISTS lth_sheba_withdrawals;
DROP TABLE IF EXISTS lth_ledger;
DROP TABLE IF EXISTS lth_reward_cycles;
DROP TABLE IF EXISTS lth_holdings;
DROP TABLE IF EXISTS lth_purchase_orders;
DROP TABLE IF EXISTS lth_wallets;
DROP TABLE IF EXISTS lth_settings;

DELETE FROM payment_events WHERE payment_id IN (SELECT id FROM payments WHERE lth_purchase_id IS NOT NULL);
DELETE FROM refunds WHERE payment_id IN (SELECT id FROM payments WHERE lth_purchase_id IS NOT NULL);
DELETE FROM payments WHERE lth_purchase_id IS NOT NULL;

CREATE TABLE payments_v1 (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT REFERENCES orders(id),
  service_request_id TEXT,
  amount_toman       INTEGER NOT NULL CHECK (amount_toman >= 0),
  status             TEXT NOT NULL
                     CHECK (status IN ('pending','paid','failed','canceled','expired','refunded')),
  gateway            TEXT NOT NULL DEFAULT 'sandbox',
  gateway_ref        TEXT,
  callback_token     TEXT NOT NULL UNIQUE,
  paid_at            TEXT,
  failure_reason     TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  CHECK (order_id IS NOT NULL OR service_request_id IS NOT NULL)
);

INSERT INTO payments_v1 (
  id, order_id, service_request_id, amount_toman, status,
  gateway, gateway_ref, callback_token, paid_at, failure_reason, created_at, updated_at
)
SELECT
  id, order_id, service_request_id, amount_toman, status,
  gateway, gateway_ref, callback_token, paid_at, failure_reason, created_at, updated_at
FROM payments;

DROP TABLE payments;
ALTER TABLE payments_v1 RENAME TO payments;
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_request ON payments(service_request_id);
