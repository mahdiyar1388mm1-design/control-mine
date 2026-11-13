-- Rollback for 012_lth_protocol_tax_and_base_flow
-- Restores the original four-event CHECK from 003 and drops the derived rows.

DROP INDEX IF EXISTS idx_lth_treasury_ledger_ref;
DROP INDEX IF EXISTS idx_lth_treasury_ledger_type;

-- Tax events and backfilled issue rows have no meaning on the old schema.
DELETE FROM lth_treasury_ledger WHERE event_type IN ('tax_accrued', 'tax_settled');
DELETE FROM lth_treasury_ledger WHERE event_type = 'issue_base';

CREATE TABLE lth_treasury_ledger_old (
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

INSERT INTO lth_treasury_ledger_old (id, event_type, atoms, user_id, ref_type, ref_id, note, created_at)
SELECT id, event_type, atoms, user_id, ref_type, ref_id, note, created_at FROM lth_treasury_ledger;

DROP TABLE lth_treasury_ledger;
ALTER TABLE lth_treasury_ledger_old RENAME TO lth_treasury_ledger;

CREATE INDEX idx_lth_treasury_ledger_type ON lth_treasury_ledger(event_type, created_at);

DELETE FROM settings WHERE key IN (
  'lth_protocol_tax_bps', 'lth_protocol_tax_label', 'lth_base_row_label'
);
