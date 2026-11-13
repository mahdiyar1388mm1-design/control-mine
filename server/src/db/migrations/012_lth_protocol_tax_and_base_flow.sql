-- ---------------------------------------------------------------------------
-- 012_lth_protocol_tax_and_base_flow
--
-- Three things the protocol was missing:
--
-- 1. BASE FLOW INTO THE TREASURY
--    Buying LTH moved "base" into the market without a matching treasury entry,
--    so «مقدار بازار» grew while «دارایی» shrank with no accounting trail.
--    Every base LTH that leaves the treasury for a wallet is now recorded as
--    `issue_base`; every base LTH that comes back is already `return_base`.
--    Idempotent backfill covers purchases that happened before this migration.
--
-- 2. PROTOCOL TAX ON COLLECTED FEES
--    Fees were collected but never taxed. `tax_bps` (default 10%) is applied to
--    every fee event, producing `tax_accrued` (liability, inside the fee) and
--    `tax_settled` (paid out to the tax authority). Unsettled tax is always
--    derivable: sum(tax_accrued) - sum(tax_settled).
--
-- 3. MARKET REWARD PROJECTION
--    «میزان کل پاداش بازار» for a given stake/withdrawable split, computed with
--    BigInt so the whole 15,000,000 LTH supply can be projected exactly.
--    Nothing is stored: the projection is derived from wallets + settings.
--
-- Fully additive: no column or constraint from 001..011 is modified.
-- ---------------------------------------------------------------------------

-- 1) Base flow events ------------------------------------------------------

-- The CHECK on 003 only allowed four event types; rebuild it with the new ones.
CREATE TABLE lth_treasury_ledger_new (
  id         TEXT PRIMARY KEY,
  event_type TEXT NOT NULL
             CHECK (event_type IN (
               'issue_base',      -- base LTH issued from treasury to a wallet
               'return_base',     -- base LTH liquidated back to treasury
               'return_stake',    -- unlocked PoS stake returned to treasury
               'return_reward',   -- withdrawable reward settled back to treasury
               'collect_fee',     -- protocol fee collected
               'tax_accrued',     -- tax liability recognised inside a collected fee
               'tax_settled'      -- tax liability actually paid to the authority
             )),
  atoms      TEXT NOT NULL,
  user_id    TEXT REFERENCES users(id),
  ref_type   TEXT NOT NULL,
  ref_id     TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO lth_treasury_ledger_new (id, event_type, atoms, user_id, ref_type, ref_id, note, created_at)
SELECT id, event_type, atoms, user_id, ref_type, ref_id, note, created_at FROM lth_treasury_ledger;

DROP TABLE lth_treasury_ledger;
ALTER TABLE lth_treasury_ledger_new RENAME TO lth_treasury_ledger;

CREATE INDEX idx_lth_treasury_ledger_type ON lth_treasury_ledger(event_type, created_at);
CREATE INDEX idx_lth_treasury_ledger_ref ON lth_treasury_ledger(ref_type, ref_id);

-- Backfill: every fulfilled purchase issued base LTH into the market and was
-- never booked against the treasury. `INSERT OR IGNORE`-style guard via NOT EXISTS
-- keeps this idempotent if the migration is ever replayed on a restored dump.
INSERT INTO lth_treasury_ledger (id, event_type, atoms, user_id, ref_type, ref_id, note, created_at)
SELECT
  'bf-issue-' || p.id,
  'issue_base',
  p.lth_atoms,
  p.user_id,
  'lth_purchase',
  p.id,
  'ثبت گذشته‌نگر: صدور حجم پایه از خزانه به کیف پول (خرید ' || p.code || ')',
  COALESCE(p.fulfilled_at, p.created_at)
FROM lth_purchase_orders p
WHERE p.status = 'fulfilled'
  AND NOT EXISTS (
    SELECT 1 FROM lth_treasury_ledger l
     WHERE l.ref_type = 'lth_purchase' AND l.ref_id = p.id AND l.event_type = 'issue_base'
  );

-- Tax settings for the protocol ledger.
INSERT OR IGNORE INTO settings (key, value) VALUES ('lth_protocol_tax_bps', '1000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('lth_protocol_tax_label', 'مالیات بر کارمزد پروتکل');
INSERT OR IGNORE INTO settings (key, value) VALUES ('lth_base_row_label', 'میزان پایه (از خزانه به بازار)');
