# Phase 5C.2 — Replenishment Reversals

Implemented and verified locally on 2026-10-19. Not yet applied to production.
This is 5C.2 only. Phase 5C is not complete: 5C.3 (administrative adjustments, approval
rules and related notifications) remains deferred. Phase 5C.1 refunds are unchanged.

## Semantics

- A reversal corrects an erroneous verified PIKAS Cash replenishment (`manual_verified`).
  It is a new immutable record (`wallet_replenishment_reversals`) with a new negative
  ledger entry (`entry_type = 'replenishment_reversal'`), linked to exactly one original
  replenishment.
- The original replenishment and its ledger entry are never edited or deleted. Both events
  remain independently visible in wallet history; historical balance snapshots are not
  rewritten.
- **Amount:** always the exact original amount (enforced by a guard trigger). There are no
  partial reversals and no generic adjustments.
- **At most one reversal per replenishment** (unique constraint). Reversing a reversal is
  not supported. If the wrong replenishment is reversed, correct it with a legitimate new
  replenishment carrying an appropriate reference or note. Unusual corrections belong to
  5C.3.
- **Reasons:** Monto incorrecto, Estudiante incorrecto, Recarga duplicada,
  Pago/verificación incorrecta, Otro. "Otro" requires an explanation; otherwise an
  optional administrative note is kept. The UI uses the existing product term *recarga*
  ("Revertir recarga", "Reversión de recarga").

## Authority

- Account Admin (schools in their account) and School Admin (their assigned school) only,
  through the new capability `school:wallets:reverse_replenishment`.
- Uses the existing `require_school_admin` guard, revalidated after the per-student lock.
- Cafeteria Admin, POS Supervisor, cashiers and Platform have no reversal authority.
  Sandbox POV remains excluded.

## Negative balance and purchases

- A reversal is allowed even if the funds were already spent, and the wallet may become
  negative. Example: balance RD$25, reversing a RD$100 replenishment leaves −RD$75.
- The non-negative checks on `student_wallets` and `wallet_ledger_entries` were removed;
  the ledger-integrity trigger allows a negative result **only** for reversals. Purchases
  and administrative adjustments keep their own non-negative guards.
- No new lock was added. The existing checkout rule (balance ≥ total) blocks PIKAS Cash
  purchases until legitimate replenishments restore enough balance. For example, from
  −RD$75, +RD$50 leaves −RD$25 (still blocked), and +RD$100 leaves RD$75 (purchases
  resume under normal rules).
- **Negative values are displayed and accepted:**
  - The wallet page shows the negative balance and a warning.
  - The reversal modal warns, but does not block, when the result would be negative.
  - The POS purchase context and the cafeteria balance lookup accept signed balances.
  - `formatMinor` renders negative amounts correctly.
- **Fixed:** the Phase 5B replenishment and adjustment overflow guards computed
  `max − balance` in bigint, which overflowed for a negative balance, so a legitimate
  credit could not restore a negative wallet. They now compare in numeric; nothing else
  changed.

## Register accounting

A reversal is not physical cash. No register inflow or outflow is created, and expected
register cash is unchanged.

## Audit and analytics data

Each reversal stores:
- the reversal ID and linked replenishment;
- account, school, student and wallet;
- currency and amount;
- reason and note;
- actor and actor role (`account_admin` or `school_admin`);
- timestamp and request key;
- the negative ledger entry and its resulting balance.

An audit event `wallet_replenishment_reversed` records the reason, the amount and whether
the result was negative. Together these support later reporting of gross, reversed and
net replenishments, reversal counts and values, negative-balance students, and actor/reason
patterns. No dashboards are built in 5C.2.

## Idempotency and concurrency

`school_wallet_reverse_replenishment(school, student, replenishment, reason, note, request_key)`:
- authorizes, then takes the existing per-student advisory lock, revalidates authority
  and locks the wallet;
- an exact retry (same key and payload) returns the original reversal; a changed payload
  is rejected; a different key on an already reversed replenishment returns
  `REPLENISHMENT_ALREADY_REVERSED`.

The web client keeps the exact reversal request until a result is confirmed.

## Contracts and changes

- Migration `202610190001_replenishment_reversals.sql`: the capability, the reversal table
  and guard, the ledger column and type, the integrity trigger, the RPC, extended
  `school_wallet_read` and `school_wallet_access` (`reverse` flag), and numeric overflow
  guards for replenishment and adjustment.
- `/api/school/wallet` gains the `reverse` operation. The wallet page and the
  `WalletReversalDialog` modal implement the UI.

## Local validation

```
python3 scripts/setup-step4d6-local.py
# Run phase5c2_replenishment_reversals.test.sql with psql against supabase_db_pikas-4d6.
python3 scripts/test-phase5c2-reversal-races.py
node scripts/test-phase5c2-reversal-browser.mjs
```

- **pgTAP: 40/40.** Covers:
  - authority: School and Account Admin allowed; cross-school, cross-account, Cafeteria
    Admin, Supervisor, cashier, Platform and sandbox POV denied;
  - exact amount, immutable original, linked negative entry, resulting balance and a
    negative result;
  - purchases blocked until restored, register cash unaffected;
  - a single reversal, exact retry and changed-payload rejection;
  - "Otro" text, the recorded actor/role/reason/note/timestamp/link, and history fields.
- **Races: 5/5 with observed `pg_blocking_pids` blocking.** Covers duplicate retry,
  different keys on the same replenishment, authority revoked while waiting, reversal vs.
  wallet purchase, and reversal vs. replenishment.
- **Regression:**
  - Phase 5B wallet operations 50/50 and 5C.1 refunds 60/60.
  - Phase 5B authority 58/58 and phase3a 106/106. In these, only the assertions encoding
    the superseded capability sets, the RLS table count and the "no negative balance"
    rule were updated.
- **Web:** focused tests pass. The full suite is 865/866; the single failure is the
  pre-existing `app/platform/equipo` mock failure.
- **Production-mode browser** (`next build --webpack`, real local Auth) at 390/768/1440px,
  with no overflow and no page errors:
  1. A School Admin sees "Revertir recarga" on both replenishments.
  2. The modal shows the original amount, reference and resulting balance.
  3. The RD$25 reversal (RD$75 → RD$50) shows both entries; the original is marked
     "Revertida" and loses its action.
  4. The RD$100 reversal shows the negative warning, requires "Otro" text and leaves
     −RD$50, with the negative banner persisting after reload.
  5. A PIKAS Cash purchase is blocked (`INSUFFICIENT_BALANCE`) and register expected cash
     stays RD$0.

## Deferred

5C.3 administrative adjustments, approval rules and notifications; reversal of reversals;
partial reversals; analytics dashboards; Platform support access.
