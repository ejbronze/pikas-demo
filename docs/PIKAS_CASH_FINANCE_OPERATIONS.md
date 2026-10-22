# PIKAS FIN 3 — Finance operations

Implemented locally on 2026-10-22. It builds on the dormant FIN 2 foundation
(`docs/PIKAS_CASH_FINANCIAL_FOUNDATION.md`) and does not change its financial semantics.

- **Migration:** `202611120001_pikas_cash_finance_operations.sql`, read functions only.
- **Tests:** `supabase/tests/fin3_finance_operations.test.sql`.
- **Status:** not deployed.

> **CENTRAL CLEARING REQUIRES LEGAL/ACCOUNTING APPROVAL BEFORE REAL-MONEY ACTIVATION.**
> FIN 3 adds no activation path. No customer is activated, and no finance capability is
> granted.

## What it adds

A Platform destination, **Finanzas** (`/platform/finanzas`), for authorized PIKAS finance
operators. It answers one question: *what needs financial review right now?*

- **Por verificar:** pending bank-transfer replenishment requests, oldest first. Each card
  shows:
  - the `REC-` reference;
  - the student and their code;
  - the customer and colegio;
  - gross → PIKAS fee (3 %) → net to PIKAS Cash;
  - when it was submitted;
  - the bank reference, and whether a proof reference exists.
- **Historial:** recent decisions (verified, rejected, reversed) with the operator and time.
  It can be filtered by status (`?vista=historial&estado=verificadas|rechazadas|revertidas`)
  and searched by reference, customer or student (`?q=`).
- **Limits:** at most 50 rows per view, with a note when more exist. Invalid filters are
  refused before the read and never broaden it.
- **Review page** (`/platform/finanzas/REC-NNNNNNNN`):
  - amounts as a small statement: Pagado, Cargo PIKAS (3 %), Se acredita a PIKAS Cash;
  - who receives the credit;
  - the manual transfer evidence: bank reference, payer, payer note, proof reference, and
    who submitted it and when. A notice says PIKAS does not confirm bank transactions
    automatically;
  - the decision, and the reversal if any.

No raw identifiers are rendered. Operational history only: no reports, charts or settlement.

## Operator workflow

| Action | Capability | What happens |
|---|---|---|
| Open Finanzas, queue, history, review | `platform:finance:read` | Read only |
| Verificar transferencia | `platform:finance:replenishments:verify` | FIN 2 posting: the wallet receives the **net** through a normal replenishment; gross, fee and issued entries; request `posted`; audited |
| Rechazar | `platform:finance:replenishments:verify` | Reason required (3–500 characters). No credit, fee, replenishment or obligation. Final: a rejected request can never post |
| Revertir transferencia | `platform:finance:replenishments:reverse` | FIN 2 finance reversal: counters net, fee and gross and corrects obligations; the original is kept |

- **Verify:** opens a task that shows the student, gross, fee and net. The final button
  names the credit ("Verificar y acreditar RD$ 1,940.00"), so posting always takes two
  deliberate steps.
- **Reject and reverse:** a details step, then a confirmation step.
- **Retries and duplicates:**
  - Each request is sent with an `Idempotency-Key`, which becomes the FIN 2 decision or
    reversal key.
  - It is kept in the tab's session storage until PIKAS answers. An uncertain outcome
    offers only "Reintentar la misma operación", which cannot duplicate.
  - A double click, a stale tab or a second operator gets "Esta solicitud ya fue
    procesada." and then the authoritative state.
- **Reversal eligibility:** the database decides it. When part of the credit was spent, the
  result is `FINANCIAL_RESOLUTION_REQUIRED`, shown as "No se puede revertir automáticamente
  porque parte del saldo acreditado ya fue utilizado. Este caso requiere resolución
  financiera.", and nothing is written. The review page warns in advance ("Parte del
  crédito ya se utilizó") but does not block the attempt.
- **Error messages:** known business errors become factual Spanish messages: already
  processed, already reversed, not authorized, customer not activated, frozen wallet or no
  active enrollment, not found. Unknown errors never reach the screen.

## Authority

- **Read and mutation boundaries:** the queue, history and review need
  `platform:finance:read`; each action needs its own capability.
  - Read cannot mutate.
  - Verify does not imply reverse, nor read.
  - Reverse does not imply funded adjustments.

  The navigation item and home card appear only with finance read.
- **Re-checks:** the database re-checks every capability (after the per-student lock for
  reversals). It refuses a sandbox POV for reads and mutations alike, and grants no tenant
  membership, wallet read or impersonation.
- **No grants:** no capability is granted to Platform Admin, Edwin or any tenant role.
- **Role name:** the app now recognises the Platform role code `platform_finance_operator`
  (it already names FIN 2's finance actor role). Authority still comes only from the
  capabilities a role holds.
- **Production state:** production has no such role. Creating it and choosing its grants is
  an owner decision for release.
- **Local tests:** used a fictional role with exactly read, verify and reverse, then removed
  it.

## School-safe attribution

`school_wallet_read` now returns finance actions as PIKAS. This applies to:

- bank-transfer credits verified by finance;
- finance reversals;
- clearing-funded adjustments.

For these rows, `actor` is null and `actor_kind = 'pikas'`. The adjustment role is
`pikas`, never `platform_finance_operator`.

The School history shows "Recarga por transferencia", "Reversión realizada por PIKAS",
"Ajuste realizado por PIKAS", origin "Transferencia bancaria verificada por PIKAS" and
"Registrado por PIKAS". This is privacy reduction only:

- the operator stays in `audit_events` and in the Platform finance reads ("Verificada …
  por <operador>");
- tenant actions keep their person exactly as before;
- the School no longer sees a "Revertir recarga" button on fee-era credits, which only
  finance may reverse. Legacy credits keep it.

## Database additions (read only)

- `platform_finance_replenishments_read(view, status, query)`: queue or history rows,
  bank transfers only.
- `platform_finance_replenishment_detail(reference)`: identity, amounts, evidence,
  decisions, the reversal, and, while a reversal is possible, the wallet status, balance
  and whether it covers the net.
- `pikas_private.finance_request_status`: pending, posted, rejected or reversed, derived
  from FIN 2 state.

Both reads require `platform:finance:read` and refuse a sandbox POV. They carry no internal
UUIDs. No table, grant or capability is added (the RLS count stays 66).

## Not in FIN 3

- No activation UI, customer finance onboarding or CEPOINT activation.
- No Cafetería cash collection (`cafeteria:wallets:collect_cash` is still not created) and
  no Cafetería replenishment authority.
- No settlement batches, payouts or weekly closing.
- No reporting dashboards, proof upload, bank integration, family-facing replenishment or
  School financial management.

## FIN 4 handoff

- Cafetería cash collection: the `cafeteria:wallets:collect_cash` capability and a POS
  wrapper over `finance_post_cash_replenishment`.
- The Cafetería obligations statement on `cafeteria_financial_obligations_read`.
- Cash reversals appear in Finanzas once FIN 4 widens the reads beyond bank transfers.
- Before activation, the owner decides the production finance role and its grants.
- The legal/accounting gate above remains open.
