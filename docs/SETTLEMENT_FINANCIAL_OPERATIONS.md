# PIKAS Settlement & Financial Operations

Implemented locally on 2026-10-24 (the planned FIN 5 + FIN 6). It builds on FIN 2
(`docs/PIKAS_CASH_FINANCIAL_FOUNDATION.md`), FIN 3 (`docs/PIKAS_CASH_FINANCE_OPERATIONS.md`) and
FIN 4 (`docs/FIN4_CAFETERIA_CASH_COLLECTION.md`) and changes none of their financial semantics.

- **Migrations:** `202611200001_settlement_financial_operations.sql`, `202611210001_settlement_after_activation_ends.sql` and
  `202611220001_historical_refund_correction.sql`.
- **Tests:**
  - Database: `supabase/tests/settlement_financial_operations.test.sql` (93 assertions) and
    `supabase/tests/settlement_activation_end.test.sql` (35 assertions) and
    `supabase/tests/settlement_historical_refund.test.sql` (34 assertions).
  - App routes: `app/api/platform/finance/settlement/route.test.ts`, `app/api/cafeteria/settlements/route.test.ts`.
  - Pages: `app/platform/finanzas/liquidaciones/settlements.test.tsx`.
  - Real Chromium: `components/settlements.browser.test.tsx`.
- **Status:** not deployed. No customer is activated, and no Platform role holds settlement authority.

> **Settlement records and reconciles obligations. It does not independently move money through a bank.**
> Payments are made outside PIKAS (transfer or deposit). Platform finance records them by reference.

## What already existed (FIN 2) and what settlement adds

FIN 2 already records every obligation, in both directions, with its settlement week. Each obligation is immutable and
has exactly one source.

| Obligation | Direction | Amount |
|---|---|---|
| `cash_collection` (FIN 4) | Cafetería → clearing | Gross cash received |
| `wallet_purchase_fulfillment` | clearing → Cafetería | The wallet-funded amount of the sale |
| `wallet_refund_correction` | Cafetería → clearing | The refunded wallet amount (corrects the sale's payable, never beyond it) |
| `legacy_purchase_refund` | Cafetería → clearing | Refund of a sale made before activation |
| `cash_collection_reversal` | clearing → Cafetería | A reversed cash collection |

**Wallet-sale payables already existed, so nothing new is created for them.** The POS has one tender per purchase. A
cash-paid sale creates no payable: the Cafetería already holds the cash. Settlement adds no obligation and
recalculates no fee. The 3 % replenishment fee was recorded at replenishment, and there is no settlement fee.

Settlement adds three append-only tables:

- **`settlements`:** one authoritative snapshot per Cafetería and week. It holds gross Cafetería → clearing, gross
  clearing → Cafetería, net direction, net amount, line counts, due date and status.
- **`settlement_lines`:** each included obligation, unique per obligation, so an obligation can never be settled twice.
- **`settlement_events`:** finalization, payment confirmation, payment mismatch and review transitions, each with its
  request key.

## Calendar

- **Week:** Monday 00:00:00 through Sunday 23:59:59, `America/Santo_Domingo`.
- **Due:** the following Tuesday (`week_start + 8`).
- **Placement:** an obligation belongs to the week of its own financial event (`settlement_week_start(occurred_at)`).
  Boundaries are computed in the named zone, never assumed in UTC.
- **Example:** Monday Oct 19 → Sunday Oct 25 is due Tuesday Oct 27.
- **Verified:** Sunday 23:59:59 local belongs to that week, and Monday 00:00:00 starts the next. Every 2026 week is
  exactly 7 days and starts at 04:00 UTC (the named zone has no DST).

## Netting

Net = gross Cafetería → clearing − gross clearing → Cafetería.

| Case | Example | Result |
|---|---|---|
| Cafetería owes | Cash RD$ 10,000 vs wallet sales RD$ 7,500 | «La cafetería debe enviar a PIKAS» RD$ 2,500 |
| PIKAS owes | Cash RD$ 4,000 vs wallet sales RD$ 8,000 | «PIKAS debe pagar a la cafetería» RD$ 4,000 |
| Zero | Equal | RD$ 0. Settled at finalization; no payment is recorded |

The gross components are always preserved next to the net, and every line remains inspectable.

## Lifecycle

| State | Spanish | Meaning |
|---|---|---|
| open (derived) | Semana en curso / Abierta | The week has not ended; totals are an estimate |
| ready (derived) | Por liquidar | The week has ended and has unsettled obligations |
| `due` | Pendiente de pago | Finalized; payment or payout outstanding |
| `in_review` | En revisión | A discrepancy or a payment mismatch is being reviewed |
| `settled` | Liquidada | Paid and confirmed, or net zero |

- **Allowed transitions:** `due → in_review`, `in_review → due`, `due → settled` and `in_review → settled`.
- **Settled is final.** Snapshot columns can never change. Lines and events cannot be updated or deleted.
- **Open and ready are not stored.** They are derived from unattached obligations, so there is nothing to create
  each Monday.

## Finalization and scheduling

- `platform_finance_settlement_finalize(cafeteria, week, key)` finalizes one ended week.
- `platform_finance_settlement_run(key)` finalizes every ended week of every activated customer Cafetería, oldest
  first. This is the **scheduling boundary**: today a finance operator triggers it («Liquidar semanas cerradas»).
  A scheduler can later call the same internal function without changing semantics.

Finalization takes a per-Cafetería lock and re-checks authority after the wait. Then:

1. It returns the existing settlement if the week already has one (idempotent by Cafetería and week).
2. It refuses an open week (`PERIOD_NOT_ENDED`).
3. It refuses when an earlier ended week of the same Cafetería is still unsettled (`EARLIER_PERIOD_PENDING`).
4. Otherwise it snapshots every unattached obligation of that week or earlier, in one read.

## Late activity

An obligation can commit after its own week was finalized, for example a sale that commits while the week closes, or
a later refund of a sale from a closed week.

- **The finalized settlement is never rewritten.**
- The obligation stays unattached and is carried into the **next settlement** the Cafetería gets. It is marked
  *late* with its original week, shown as «registrado después de su liquidación».
- If no later week has ended yet, it waits in the open week.

The same rule covers refunds. A refund in the same week reduces that week's payable. A refund after the week closed
appears as a Cafetería → clearing line in a later settlement. Partial and itemized refunds are FIN 2 behavior (the
correction never exceeds the original), and no refund model was invented here.

## Payment confirmation and review

| Action | Effect |
|---|---|
| **Confirm payment or payout** («Confirmar pago recibido» / «Confirmar pago a la cafetería») | Requires amount, reference (3–120 characters) and a payment date that is not in the future. An optional note is allowed |
| Amount equals the net | → `settled` |
| Any other amount | Recorded as `payment_mismatch` and the settlement goes to `in_review`. **No partial settlement** |
| **Review** | Platform opens it from `due` with a reason (cash differs, sales differ, refund missing, payment differs, Cafetería dispute, other), and resolves it back to `due` with a note |

- **Totals never change.** Corrections happen through proper financial events, which enter a later settlement.
- **Idempotency:** every request carries an Idempotency-Key, which is the database request key. The same key with the
  same payload replays. The same key with another payload, or from another operator, gets `IDEMPOTENCY_CONFLICT`.
- **In-place retry:** the browser keeps the exact request until PIKAS answers, so a retry after an uncertain answer
  reuses it. The same defect was fixed in FIN 3 Finanzas.

## Authority

| Who | Settlement |
|---|---|
| Platform finance with `platform:finance:read` | Queue, history, ready-week preview and detail (with operator names) |
| Platform finance with `platform:finance:settlement:manage` | Finalize, run, confirm payment or payout, open or resolve a review |
| Platform Admin | Nothing by default. The capability is granted to **no role** |
| Cafetería Admin with `cafeteria:finance:obligations:read` (granted here) | Read its own settlements: open week, weeks in calculation, settlements, lines and history. PIKAS operators are not named. No state change |
| School, Account Admin, POS cashier and supervisor | None. The School sees student-level support only |
| Sandbox customer or Demo POV | Refused (`SETTLEMENT_SANDBOX_REFUSED`, `finance_authority_required`, `demo_mode_active`) |
| Customer whose activation ended, or that is suspended or closed; Cafetería suspended or inactive | Platform finance still settles its historical obligations (see *Activation ending and lifecycle*). The tenant gets no new financial activity and no reopened access |

**Recommended initial production finance bundle when the owner approves one:**

- `platform:finance:read`
- `platform:finance:replenishments:verify`
- `platform:finance:replenishments:reverse`
- `platform:finance:settlement:manage`

It must not include `platform:finance:adjustments:fund`.

## Activation ending and lifecycle

**Financial activation governs NEW financial activity, not the settlement of obligations that already exist.**

- **New events need an active policy, unchanged.** Cash collection, bank-transfer posting and PIKAS-funded adjustments
  are refused with `FINANCIAL_POLICY_NOT_ACTIVE`. After activation ends, a POS sale is the pre-activation model again
  and creates no obligation.
- **Existing obligations stay settleable.** Every obligation was created under an active policy (FIN 2 writes none
  otherwise), so settlement eligibility is the obligation itself. This was fixed by
  `202611210001_settlement_after_activation_ends.sql`; before it, finalization was refused once activation ended.
  After the end, Platform finance can still:
  - see the ready week;
  - finalize it (explicitly or through the run);
  - put it in review;
  - confirm its payment or payout.
- **Refunds follow the original purchase** (`202611220001_historical_refund_correction.sql`).
  - **The rule:** a refund of a PIKAS Cash sale that created a clearing → Cafetería payable always records
    `stored_value_restored` plus a `wallet_refund_correction` (Cafetería → clearing) for exactly the refunded wallet
    amount. This holds even after activation ends.
  - **The evidence** is the original purchase's payable. A sale made before activation, or after it ended, and a cash
    sale have no payable, so their refunds create no PIKAS correction. Arbitrary obligations are impossible.
  - **Partial and itemized refunds** correct only what they refund. The FIN 2 guard still caps corrections at the
    payable.
  - **Settlement:** a refund of a sale whose week is finalized enters a later settlement as a late line, traceable to
    the original payable inside the original settlement.
  - **No replenishment, fee or new funding** is created.
  - **Before the fix:** after activation ended, the wallet was restored but the payable was not corrected, which
    overpaid the Cafetería.
- **Customer and Cafetería lifecycle** (suspended, closed, inactive) never gates Platform settlement. Tenant
  operational access is not reopened: the Cafetería read still requires an active Cafetería Admin scope, so a
  suspended customer's Cafetería cannot read until it is reactivated. While its access is active, the Cafetería keeps
  seeing its settlements after activation ends.
- **Finalized snapshots never change.**
- **Re-activation** creates a new activation and duplicates nothing. It recreates no obligation, no settlement and no
  line. New obligations settle in their own later settlement.
- **Sandbox** stays refused.

## Owner decisions (2026-10-24)

- **Cafetería read access approved:** read-only access to its own settlements via `cafeteria:finance:obligations:read`.
- **Production finance bundle approved:**
  - `platform:finance:read`
  - `platform:finance:replenishments:verify`
  - `platform:finance:replenishments:reverse`
  - `platform:finance:settlement:manage`

  Never `platform:finance:adjustments:fund` by default. No production finance member until separately approved.
- **Calculation stays manual** in this release. Recorded for Pilot Hardening: evaluate automatic calculation of ended
  weeks each Monday through the same idempotent engine.
- **Financial activation stays blocked** behind the legal/accounting gate.

## Security and audit

- **Function security:** every new public function is SECURITY DEFINER with an empty search path. It is executable
  only by `authenticated`, never by PUBLIC, `anon` or `service_role`. Private helpers are executable by no client
  role.
- **Tables:** the three tables have forced RLS and no client privileges. The migration fails closed if any of this
  differs, or if `settlement:manage` is granted.
- **Audit:** `audit_events` records `settlement_finalized`, `settlement_payment_confirmed`, `settlement_payment_mismatch`,
  `settlement_review_opened` and `settlement_review_resolved`. Each row holds the real operator, old and new status,
  direction, amount, payment reference and date.

## Experience

- **Platform · Finanzas → Liquidaciones** is kept distinct from transfer review («Por verificar» / «Historial»). It
  shows closed weeks ready to calculate (each with a preview of every movement), settlements pending payment or in
  review (with «Vencida» when past due), history, and a detail page with every line and the event history.
- **Cafetería · Liquidaciones** shows the open week (estimate), weeks PIKAS is calculating, and settlements. The
  detail groups cash received for PIKAS Cash, PIKAS Cash sales, and refunds and corrections, each line with its
  REC- reference or receipt number.
- **Language:** operational wording such as «Debes enviar a PIKAS», «PIKAS te debe» and «Sin saldo pendiente».
  Direction is never shown by color alone.
- **States:** UX14 error states and the Pikando busy region. Verified at 390 px: no overflow, labelled dialogs with
  focus inside, `inputmode="decimal"` on amounts, and 44 px targets.

## Not included

- No bank integration, no money movement, no file upload and no partial payments.
- Register cash reconciliation is not a prerequisite. Lines carry REC- references and receipt numbers for
  investigation.
- No broad reporting (UX10 stays paused), no activation UI, and no production activation.
