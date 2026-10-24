# PIKAS FIN 4 — Cafetería cash collection

Implemented locally on 2026-10-24. It builds on the FIN 2 foundation
(`docs/PIKAS_CASH_FINANCIAL_FOUNDATION.md`) and FIN 3 Finanzas
(`docs/PIKAS_CASH_FINANCE_OPERATIONS.md`) and does not change their financial semantics.

- **Migrations:**
  - `202611190001_cafeteria_cash_collection.sql`
  - `202611190002_cafeteria_cash_collection_replay.sql`
  - `202611190003_school_replenish_access_after_activation.sql`
- **Tests:** `supabase/tests/fin4_cafeteria_cash_collection.test.sql` (100 assertions);
  `apps/web/app/api/cafeteria/cash-collection/route.test.ts`,
  `apps/web/lib/cafeteria/cash-collection.test.ts`,
  `apps/web/components/cash-collection.browser.test.tsx`.
- **Status:** not deployed. No customer is activated; CEPOINT and production are untouched.

> **FIN 4 creates obligations. FIN 4 does not settle them.**
> Every cash collection records what the Cafetería owes PIKAS clearing. Nothing in FIN 4
> pays, nets, batches or closes an obligation. Settlement is a later milestone and still
> requires legal/accounting approval before real money moves.

## Economics (locked)

| Field | Rule |
|---|---|
| Efectivo recibido (gross) | The cash the Cafetería physically received, integer centavos |
| Cargo por recarga PIKAS (fee) | 3 % (300 bps) of gross, rounded half-up: `div(gross × bps + 5000, 10000)` |
| Se acredita al monedero (net) | gross − fee, credited to the student's PIKAS Cash |
| Cafetería owes clearing | **gross**, as a `cash_collection` obligation |

- The fee is charged only at replenishment. Spending PIKAS Cash carries no fee and POS
  pricing is unchanged.
- Examples: RD$ 2,000.00 → fee RD$ 60.00 → credit RD$ 1,940.00; RD$ 333.33 → fee RD$ 10.00
  → credit RD$ 323.33. The browser preview computes the same half-up rule with BigInt so it
  matches the database exactly.
- Posting reuses FIN 2 unchanged (`finance_post_cash_replenishment` → `finance_create_request`
  → `finance_post_request`): one `REC-` reference, a normal wallet replenishment of the net
  (source `cafeteria_cash_collected`) with its ledger entry, the entries
  `replenishment_gross_collected`, `replenishment_fee_earned` and `stored_value_issued`, and
  the `cash_collection` obligation. The deferred completeness trigger rejects a partial
  posting, so everything commits together or nothing does.

## Authority

| Role | Cash collection |
|---|---|
| Administrador de cafetería | `cafeteria:wallets:collect_cash` in its own Cafetería, for students the School shares with it |
| Supervisor POS / Cajero | None. Whether POS staff should collect is an open owner decision |
| Administrador escolar / de cuenta | None. After activation the School cannot post positive replenishments (`collection_source_required`) and «Recargar» is no longer offered |
| Plataforma | None. Finance reads and reverses (FIN 3 capabilities); it never collects |
| POV sandbox / Demo | Refused (`demo_mode_active`); sandbox customers are refused |

- The retired `cafeteria:wallets:replenish` is not resurrected.
- `public.cafeteria_wallet_collect_cash` checks, in order:
  - customer-operations context, Demo and sandbox are refused;
  - `require_cafeteria_admin`, then the capability on account, school and Cafetería;
  - the per-student advisory lock, then **every check again after the wait**: active
    membership and Cafetería, active `basic_identification` share, active link and student
    (`student_not_served_by_cafeteria`), active wallet and enrollment, financial activation
    (`FINANCIAL_POLICY_NOT_ACTIVE`).
- Audit: `wallet_cash_collected` with gross, fee, net, fee bps, policy version and reference;
  the operator's person is recorded.

## Activation

Cash collection works only for a customer with an active financial activation. Activation
stays backend-only (`pikas_private.finance_activate_customer`). For a customer that is not
activated the Cafetería sees «Las recargas en efectivo no están habilitadas para este
cliente» and no action; a direct call returns `FINANCIAL_POLICY_NOT_ACTIVE` and writes
nothing. Legacy (pre-activation) School replenishment rules are unchanged.

`school_wallet_access` now reports `replenish = false` once the customer is activated, so
the School's «Recargar» button matches what the database already refused.

«Corregir saldo» follows the same rule (app only; the database already refuses positive tenant
adjustments after activation with `finance_adjustment_authority_required`). For an activated
customer the School and the Cafetería are offered only «− Disminuir saldo», with the reason:
value is added only by cash at the Cafetería or a transfer verified by PIKAS, and an exceptional
increase is made by PIKAS (`platform:finance:adjustments:fund`). Negative corrections keep their
existing tenant authority.

- **School signal:** adjustment without replenish. Every role holding
  `school:wallets:administrative_adjust` also holds `school:wallets:replenish` (asserted in the FIN 4
  database test), so `replenish` turns false only on activation.
- **Cafetería signal:** `enabled` from `cafeteria_cash_collections_read`. If it cannot be read,
  the dialog fails closed to a decrease and says it could not confirm.

## Idempotency and retries

- Every collection carries a request key, sent as the `Idempotency-Key` header and stored in
  the tab's journal (`pikas:cash-collection:<actor>:<cafetería>`) until PIKAS answers.
- **Replay first:** the wrapper looks up the key before re-checking scope. The same submitter
  with the identical payload (method, Cafetería, student, gross, payer) gets the original
  result with `replayed = true`, even if a share or link changed in between. A different
  operator, or any change in the payload, gets `IDEMPOTENCY_CONFLICT`. Nothing is posted twice.
- A named refusal is definite and clears the journal. Anything else is uncertain: the task
  offers only «Reintentar la misma recarga», which resends exactly the original key and
  payload. A failed retry does not mean the original failed.

## Reversal

Cash collections are reversed by Platform finance with the FIN 3 reversal
(`platform_finance_reverse_replenishment`, `platform:finance:replenishments:reverse`):

- net, fee and gross are countered (`replenishment_fee_reversed`,
  `replenishment_gross_reversed`, stored value cancelled) and a `cash_collection_reversal`
  obligation offsets the gross;
- when the wallet no longer covers the full net the result is
  `FINANCIAL_RESOLUTION_REQUIRED` and nothing is written;
- the Cafetería history shows «Revertida por PIKAS».

The School cannot reverse a fee-era cash credit; only legacy credits keep its
«Revertir recarga».

## Experience

- **Cafetería · PIKAS Cash → «Recargas en efectivo»:** «Recibir efectivo» opens a task:
  Estudiante → Efectivo → Revisar. The student search lists only shared students; a frozen
  wallet cannot be chosen. The review shows Efectivo recibido, Cargo por recarga PIKAS
  (3 %), Se acredita al monedero, the estimated balance and the payer, and posting requires
  the explicit check «Recibí RD$ … en efectivo.» A double click posts once. Success shows
  the reference and the credit.
- **History:** 25 per page with the reference, student, gross/fee/net, status, operator and
  time (`cafeteria_cash_collections_read`).
- **School:** the student's history shows «Recarga en efectivo» with Efectivo recibido,
  Cargo por recarga PIKAS, Acreditado al monedero and the Cafetería (`school_wallet_read`).
- **Platform Finanzas:** history includes cash collections («Efectivo en {cafetería}»,
  status «Acreditada»); the review page shows «Efectivo recibido en la cafetería». The
  verification queue stays bank-transfer only.
- Errors follow UX 14 (factual Spanish messages, unknown errors never reach the screen),
  loading uses Pikando, and the task is a labelled dialog that works at 390 px.

## Database additions

- `cafeteria_wallet_collect_cash(cafeteria, student, gross, payer_name, request_key)`.
- `cafeteria_cash_collections_read(cafeteria, before)`.
- Capability grant `cafeteria_admin → cafeteria:wallets:collect_cash`.
- Widened reads: `platform_finance_replenishments_read` (history includes cash; adds method,
  Cafetería and submitter), `platform_finance_replenishment_detail` (accepts cash),
  `school_wallet_read` (method, gross, fee, net and collecting Cafetería),
  `school_wallet_access` (activation-aware `replenish`).
- Explicit ACLs with a fail-closed check. No table is added.

## Verification (local)

- Ten browser scenarios on a fictional fixture: preview and posting; half-up rounding;
  retry replay; frozen wallet; other Cafetería and unshared student; not-activated
  customer; Finanzas history, detail and reversal; reversal blocked after spending; School
  view; 390 px and accessibility. Each asserted only the expected money changes.
- Races in independent sessions, each with observed `pg_blocking_pids` blocking: the same
  key twice (one request, one audit row); a collection racing a wallet sale (delta net −
  price); a finance reversal racing a new collection; membership suspended during the lock
  wait (refused with `cafeteria_authority_required`, nothing written). Afterwards every
  wallet matched its ledger, every collection had exactly one gross obligation and
  gross = fee + net.
- The fixture was removed and the local financial fingerprint matched the starting one.

## Not in FIN 4

- No settlement, payouts, batches, weekly closing or reconciliation against register cash.
- No Cafetería obligations statement UI.
- No activation UI and no CEPOINT or production activation.
- No POS (cashier/supervisor) collection, family-facing replenishment or receipts printing
  for collections.

## Owner decisions

Decided at owner review (2026-10-24): FIN 4 releases dormant; no production finance role is
created or assigned (the future bundle is read + verify + reverse, never `adjustments:fund` or
settlement by default); no customer is activated; collection stays with the Cafetería Admin only;
«Corregir saldo» offers only decreases after activation. Still open, behind the
legal/accounting gate: the activation procedure, stored-value custody, the Cafetería collection
relationship, fee treatment, record retention, reversals, outstanding obligations and settlement terms.
