-- CENTRAL MINE — Migration 003: LTH Protocol Treasury ("خزانه" 15,000,000 LTH), Stake/Base Return Accounting & Fee Ledger

CREATE TABLE lth_treasury_config (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  total_supply_atoms TEXT NOT NULL DEFAULT '150000000000000000000000',
  transfer_fee_bps   INTEGER NOT NULL DEFAULT 0
                     CHECK (transfer_fee_bps >= 0 AND transfer_fee_bps <= 2000),
  sell_fee_bps       INTEGER NOT NULL DEFAULT 0
                     CHECK (sell_fee_bps >= 0 AND sell_fee_bps <= 2000),
  updated_at         TEXT NOT NULL
);

INSERT INTO lth_treasury_config (id, total_supply_atoms, transfer_fee_bps, sell_fee_bps, updated_at)
VALUES (1, '150000000000000000000000', 0, 0, '2026-01-01T00:00:00.000Z');

CREATE TABLE lth_unlocked_stake_pools (
  user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  unlocked_stake_atoms TEXT NOT NULL DEFAULT '0',
  updated_at           TEXT NOT NULL
);

CREATE TABLE lth_treasury_ledger (
  id         TEXT PRIMARY KEY,
  event_type TEXT NOT NULL
             CHECK (event_type IN ('return_base','return_stake','return_reward','collect_fee')),
  atoms      TEXT NOT NULL,
  user_id    TEXT REFERENCES users(id),
  ref_type   TEXT NOT NULL,
  ref_id     TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_lth_treasury_ledger_type ON lth_treasury_ledger(event_type, created_at);
