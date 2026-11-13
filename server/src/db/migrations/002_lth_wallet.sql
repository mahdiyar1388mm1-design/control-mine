-- CENTRAL MINE — Migration 002: LOTH COIN (LTH) Wallet, PoS Staking, 24h Multi-Server Reward Engine & Accounting Ledger

-- Extend payments table CHECK constraint cleanly (SQLite 12-step rebuild) to support lth_purchase_id
CREATE TABLE payments_v2 (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT REFERENCES orders(id),
  service_request_id TEXT,
  lth_purchase_id    TEXT,
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
  CHECK (order_id IS NOT NULL OR service_request_id IS NOT NULL OR lth_purchase_id IS NOT NULL)
);

INSERT INTO payments_v2 (
  id, order_id, service_request_id, lth_purchase_id, amount_toman, status,
  gateway, gateway_ref, callback_token, paid_at, failure_reason, created_at, updated_at
)
SELECT
  id, order_id, service_request_id, NULL, amount_toman, status,
  gateway, gateway_ref, callback_token, paid_at, failure_reason, created_at, updated_at
FROM payments;

DROP TABLE payments;
ALTER TABLE payments_v2 RENAME TO payments;
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_request ON payments(service_request_id);
CREATE INDEX idx_payments_lth_purchase ON payments(lth_purchase_id);

CREATE TABLE lth_settings (
  id                         INTEGER PRIMARY KEY CHECK (id = 1),
  price_irr                  TEXT NOT NULL DEFAULT '4840000000',
  reward_per_min_unit_atoms  TEXT NOT NULL DEFAULT '340000',
  stake_bps                  INTEGER NOT NULL DEFAULT 7000
                             CHECK (stake_bps >= 0 AND stake_bps <= 10000),
  withdrawable_bps           INTEGER NOT NULL DEFAULT 3000
                             CHECK (withdrawable_bps >= 0 AND withdrawable_bps <= 10000 AND stake_bps + withdrawable_bps = 10000),
  lockup_days                INTEGER NOT NULL DEFAULT 3285
                             CHECK (lockup_days >= 1 AND lockup_days <= 36500),
  reward_interval_sec        INTEGER NOT NULL DEFAULT 86400
                             CHECK (reward_interval_sec >= 60),
  packages_toman_json        TEXT NOT NULL DEFAULT '[22000000,11000000,8000000,1000000,220000]',
  logo_path                  TEXT NOT NULL DEFAULT '/uploads/lth-logo-default.svg',
  updated_at                 TEXT NOT NULL
);

INSERT INTO lth_settings (
  id, price_irr, reward_per_min_unit_atoms, stake_bps, withdrawable_bps,
  lockup_days, reward_interval_sec, packages_toman_json, logo_path, updated_at
) VALUES (
  1, '4840000000', '340000', 7000, 3000,
  3285, 86400, '[22000000,11000000,8000000,1000000,220000]', '/uploads/lth-logo-default.svg', '2026-01-01T00:00:00.000Z'
);

CREATE TABLE lth_wallets (
  user_id                   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wallet_serial             TEXT NOT NULL UNIQUE,
  base_atoms                TEXT NOT NULL DEFAULT '0',
  staked_atoms              TEXT NOT NULL DEFAULT '0',
  withdrawable_reward_atoms TEXT NOT NULL DEFAULT '0',
  reserved_atoms            TEXT NOT NULL DEFAULT '0',
  total_purchased_atoms     TEXT NOT NULL DEFAULT '0',
  total_rewarded_atoms      TEXT NOT NULL DEFAULT '0',
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);

CREATE TABLE lth_purchase_orders (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  user_id        TEXT NOT NULL REFERENCES users(id),
  payment_id     TEXT UNIQUE REFERENCES payments(id),
  package_toman  INTEGER,
  amount_toman   INTEGER NOT NULL CHECK (amount_toman >= 1000),
  amount_irr     TEXT NOT NULL,
  unit_price_irr TEXT NOT NULL,
  lth_atoms      TEXT NOT NULL,
  lockup_days    INTEGER NOT NULL,
  status         TEXT NOT NULL
                 CHECK (status IN ('pending_payment','fulfilled','failed','canceled','refunded')),
  fulfilled_at   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_lth_purchases_user ON lth_purchase_orders(user_id);
CREATE INDEX idx_lth_purchases_payment ON lth_purchase_orders(payment_id);

CREATE TABLE lth_holdings (
  id                        TEXT PRIMARY KEY,
  contract_code             TEXT NOT NULL UNIQUE,
  user_id                   TEXT NOT NULL REFERENCES users(id),
  purchase_order_id         TEXT UNIQUE REFERENCES lth_purchase_orders(id),
  initial_base_atoms        TEXT NOT NULL,
  active_base_atoms         TEXT NOT NULL,
  accrued_staked_atoms      TEXT NOT NULL DEFAULT '0',
  accrued_withdrawable_atoms TEXT NOT NULL DEFAULT '0',
  unit_price_irr_snapshot   TEXT NOT NULL,
  lockup_days               INTEGER NOT NULL,
  purchased_at_ms           INTEGER NOT NULL,
  purchased_at              TEXT NOT NULL,
  stake_unlock_at_ms        INTEGER NOT NULL,
  stake_unlock_at           TEXT NOT NULL,
  stake_unlocked            INTEGER NOT NULL DEFAULT 0,
  last_reward_cycle         INTEGER NOT NULL DEFAULT 0,
  next_reward_at_ms         INTEGER NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN ('active','closed')),
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX idx_lth_holdings_user ON lth_holdings(user_id);
CREATE INDEX idx_lth_holdings_due ON lth_holdings(status, next_reward_at_ms);

CREATE TABLE lth_reward_cycles (
  id                        TEXT PRIMARY KEY,
  holding_id                TEXT NOT NULL REFERENCES lth_holdings(id),
  user_id                   TEXT NOT NULL REFERENCES users(id),
  cycle_number              INTEGER NOT NULL CHECK (cycle_number >= 1),
  base_atoms_snapshot       TEXT NOT NULL,
  reward_per_min_unit_atoms TEXT NOT NULL,
  stake_bps                 INTEGER NOT NULL,
  withdrawable_bps          INTEGER NOT NULL,
  total_reward_atoms        TEXT NOT NULL,
  staked_reward_atoms       TEXT NOT NULL,
  withdrawable_reward_atoms TEXT NOT NULL,
  server_instance_id        TEXT NOT NULL,
  due_at_ms                 INTEGER NOT NULL,
  credited_at               TEXT NOT NULL,
  UNIQUE (holding_id, cycle_number)
);
CREATE INDEX idx_lth_reward_cycles_user ON lth_reward_cycles(user_id);

CREATE TABLE lth_ledger (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL REFERENCES users(id),
  entry_type               TEXT NOT NULL
                           CHECK (entry_type IN (
                             'purchase_base',
                             'reward_credit',
                             'stake_unlock',
                             'sheba_withdraw_reserve',
                             'sheba_withdraw_paid',
                             'sheba_withdraw_refund',
                             'sell_liquidate_reserve',
                             'p2p_transfer_out',
                             'p2p_transfer_in',
                             'purchase_refund'
                           )),
  delta_base_atoms         TEXT NOT NULL DEFAULT '0',
  delta_staked_atoms       TEXT NOT NULL DEFAULT '0',
  delta_withdrawable_atoms TEXT NOT NULL DEFAULT '0',
  delta_reserved_atoms     TEXT NOT NULL DEFAULT '0',
  price_irr_snapshot       TEXT NOT NULL,
  irr_value_snapshot       TEXT NOT NULL,
  ref_type                 TEXT NOT NULL,
  ref_id                   TEXT NOT NULL,
  note                     TEXT,
  created_at               TEXT NOT NULL
);
CREATE INDEX idx_lth_ledger_user ON lth_ledger(user_id, created_at);

CREATE TABLE lth_sheba_withdrawals (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  user_id             TEXT NOT NULL REFERENCES users(id),
  kind                TEXT NOT NULL CHECK (kind IN ('sheba_withdrawal','sell_lth')),
  sheba_iban          TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  from_reward_atoms   TEXT NOT NULL,
  from_base_atoms     TEXT NOT NULL,
  total_atoms         TEXT NOT NULL,
  unit_price_irr      TEXT NOT NULL,
  amount_irr          TEXT NOT NULL,
  amount_toman        INTEGER NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending','paid','rejected','canceled')),
  bank_ref            TEXT,
  review_note         TEXT,
  reviewed_by         TEXT REFERENCES users(id),
  reviewed_at         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_lth_withdrawals_user ON lth_sheba_withdrawals(user_id);
CREATE INDEX idx_lth_withdrawals_status ON lth_sheba_withdrawals(status);

CREATE TABLE lth_transfers (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  sender_id         TEXT NOT NULL REFERENCES users(id),
  recipient_id      TEXT NOT NULL REFERENCES users(id),
  from_reward_atoms TEXT NOT NULL,
  from_base_atoms   TEXT NOT NULL,
  total_atoms       TEXT NOT NULL,
  unit_price_irr    TEXT NOT NULL,
  irr_equivalent    TEXT NOT NULL,
  note              TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_lth_transfers_sender ON lth_transfers(sender_id);
CREATE INDEX idx_lth_transfers_recipient ON lth_transfers(recipient_id);

CREATE TABLE distributed_scheduler_leases (
  job_name            TEXT PRIMARY KEY,
  holder_instance_id  TEXT NOT NULL,
  leased_until_ms     INTEGER NOT NULL,
  last_run_at         TEXT,
  last_cycles_settled INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL
);
