# Phase 5C.3 — Administrative Wallet Adjustments

Implemented and verified locally on 2026-10-20. Not yet applied to production. With
5C.3, the defined Phase 5C correction milestones (5C.1 refunds, 5C.2 replenishment
reversals, 5C.3 administrative adjustments) are implemented. 5C.1 and 5C.2 are
production accepted and frozen; 5C.3 still needs a controlled production checkpoint.

## Purpose and distinction

An administrative adjustment is an exceptional balance correction that is not a
purchase refund, a replenishment reversal or a normal verified replenishment. It is
always a new immutable wallet ledger movement (`entry_type = 'adjustment'`). A wallet
balance is never overwritten. The UI starts with "¿Qué necesitas corregir?":
- **Una compra** → Reembolso, from the POS "Reembolsos" tab.
- **Una recarga incorrecta** → "Revertir recarga" in the wallet history.
- **Otra corrección excepcional de saldo** → the adjustment form.

Nothing is created automatically, and the refund and reversal workflows are not
duplicated.

## Model

- Reuses the existing `wallet_adjustments` table and ledger type, with additive columns
  for 5C.3 rows: `student_id`, `balance_before_minor`, `balance_after_minor`,
  `actor_role`, `actor_scope_kind`, `cafeteria_id`, `cafeteria_customer_id` and
  `actor_source`.
- A check constraint enforces the evidence: before + amount = after, role/scope/cafeteria
  consistency, an explanation of at least 5 characters, and reason/direction consistency.
- Legacy Phase 3A rows and the legacy `post_student_wallet_adjustment` are unchanged.
- **Signed amount.** Positive (credit) or negative (debit), never zero. The resulting
  balance is computed authoritatively under the existing per-student lock.
- **Reasons:** Corrección de saldo inicial, Corrección administrativa, Corrección de
  migración/datos, Crédito autorizado (positive only), Débito autorizado (negative only),
  Otro. Every reason requires a written explanation. Reasons that duplicate refunds or
  reversals (for example the legacy "duplicate manual credit") are not offered.
- **Immutable.** Adjustments cannot be updated or deleted; there is no edit or
  adjustment-reversal workflow. An erroneous adjustment is corrected with another
  explicit adjustment, so the full history stays visible.

## Authority

- **Account Admin:** students in schools of their account
  (`school:wallets:administrative_adjust`, recorded with `actor_scope_kind = 'account'`).
- **School Admin:** students of their assigned school (same capability, recorded with
  `actor_scope_kind = 'school'`).
- **Cafeteria Admin:** only students connected to a cafeteria they administer
  (`cafeteria:wallets:administrative_adjust`). "Connected" uses the existing relationship:
  an active `cafeteria_customers` row, an active school share and `basic_identification`
  enabled. This is the same relationship as the POS customer search and the cafeteria
  balance lookup. It is never school-wide; the customer row is recorded.
- **POS Supervisor and Cashier:** no authority.
- **Sandbox POV:** no real financial authority.
- **Platform Admin / PIKAS employee:** no standing tenant authority. The owner intends
  future adjustments by PIKAS employees through an explicit customer-authorized support
  context, preserving the real employee and their platform role. That is **deferred**.
  The `actor_source` column currently allows only `tenant_admin`; a future support
  context must add its own value and evidence rather than reuse a tenant role. No support
  fields or events were invented.
- **No mandatory second-person approval for Beta.** Accountability comes from strict
  authority, explicit attribution and immutable evidence. Configurable approvals,
  thresholds, alerts and notifications are deferred.

## Balance, purchases and register

- Negative results are allowed: the ledger-integrity trigger now accepts a negative
  result for adjustments as well as reversals. Example: RD$50 − RD$100 = −RD$50, which
  stays visible and auditable.
- The existing checkout rule (balance ≥ total) keeps blocking PIKAS Cash purchases until
  positive movements restore enough balance. No extra lock was added.
- No register cash: no inflow or outflow, no open register required, and expected cash
  is unchanged.

## Audit and analytics

Each adjustment stores:
- the adjustment ID, account, school and student;
- the signed amount and the balance before and after;
- the reason and explanation;
- the actor, their actual role, the scope kind, and the cafeteria/customer for
  cafeteria scope;
- the timestamp, the idempotency key and payload fingerprint, and the immutable ledger
  entry.

The audit event `wallet_administrative_adjustment_posted` carries direction, amount,
whether the result was negative, and `actor_source`. Reports can therefore separate
replenishments, reversals, purchases, refunds, and positive and negative adjustments by
student, context, actor, role and reason. No dashboards are built in 5C.3.

## Contracts

- `school_wallet_adjust(school, student, amount, reason, explanation, request_key)` and
  `cafeteria_wallet_adjust(cafeteria, student, …)` share
  `pikas_private.post_administrative_adjustment`.
- Authority is checked, the per-student advisory lock is taken, and authority (and, for
  cafeteria scope, the locked customer/share relationship) is re-checked before the
  wallet row lock.
- An exact retry returns the original adjustment; a changed payload is rejected.
- `school_wallet_read` exposes the reason, the actor role and the balance before.
  `school_wallet_access` exposes `adjust`.
- `/api/school/wallet` and `/api/cafeteria/wallet` gain `adjust`.
- UI: the `WalletAdjustmentDialog` modal, opened from "Corregir saldo" in the student
  wallet and in the cafeteria lookup. The request is kept locally until a result is
  confirmed.
- Migration: `202610200001_administrative_wallet_adjustments.sql` (additive).

## Visual semantics (changed surfaces only)

On the wallet history, the adjustment dialog and the cafeteria balance list:
- positive movements show `+` in green;
- negative movements show `−` in red;
- a negative balance is shown in red;
- labels and signs are always present, so meaning never depends on colour alone.

The cross-product visual-language audit remains a separate planned milestone.

## Local validation

```
python3 scripts/setup-step4d6-local.py
# Run phase5c3_administrative_adjustments.test.sql with psql against supabase_db_pikas-4d6.
python3 scripts/test-phase5c3-adjustment-races.py
node scripts/test-phase5c3-adjustment-browser.mjs
```

- **pgTAP: 42/42.** Covers:
  - Account Admin positive and negative adjustments; School Admin in and out of scope;
  - Cafeteria Admin for a connected student, and denial for an unconnected student,
    another cafeteria and school-wide use;
  - Supervisor, cashier, Platform and sandbox denial;
  - required reason, explanation and direction;
  - correct ledger and balances, a negative result, purchases blocked then restored,
    and no register cash;
  - actor, role, scope, reason, explanation and before/after preserved; exact retry;
  - immutability, and revoked authority or relationship.
- **Races: 7/7 with observed `pg_blocking_pids` blocking.** Covers duplicate retry,
  concurrent positive/negative adjustments, adjustment vs. purchase, replenishment and
  reversal, authority revoked while waiting, and cafeteria relationship revoked while
  waiting.
- **Regression:**
  - phase3a 106/106, Phase 5B wallet operations 50/50, 5C.1 60/60 and 5C.2 40/40.
  - Phase 5B authority 58/58, where only the exact capability-list and access-JSON
    assertions were updated for the new capabilities.
- **Web:** focused tests pass. The full suite is 883/884; the single failure is the
  pre-existing `app/platform/equipo` mock failure.
- **Production-mode browser** (`next build --webpack`, real local Auth) at 390/768/1440px,
  with no overflow and no page errors:
  1. A School Admin opens "Corregir saldo" from the wallet. The guidance distinguishes
     Reembolso, Revertir recarga and ajuste.
  2. A +RD$25 adjustment shows the preview (RD$50 → RD$75) and appears as a green "+"
     movement.
  3. A −RD$100 "Débito autorizado" adjustment shows the warning without blocking and
     leaves a red −RD$25.00 balance. The role, reason, balance before and explanation
     are visible.
  4. A Cafeteria Admin sees and adjusts only the connected student (+RD$10 → −RD$15.00).
     The unconnected student is not listed and is refused by the API, and school-wide
     adjustment is refused.
