# Phase 5D — Reporting & Reconciliation (plan)

**Status:** owner decisions D1–D13 **RESOLVED** (§24). **5D.1 (reporting foundation +
sales summary), 5D.2 (top products), 5D.3 (reconciliation), 5D.4 (Transacciones lookup)
and 5D.5 (School PIKAS Cash report) implemented locally**; see the implementation status
sections below and, for 5D.4, the Wave E + 5D.4 record in
`UX_UI_PRODUCT_ARCHITECTURE_AUDIT.md` §29. The optional account-wide roll-up (5D.5b) is not
implemented, and 5D.6 is deferred (D9). Nothing is deployed.

Established baseline:
- Phase 5C closure: `efd668cb`.
- UX/UI audit: `925fe352`.
- UX Foundation A: `965d53ae`.

Phase 5A–5C financial behavior is frozen. This plan only *reads* what those phases
write.

Sources reconstructed for this plan:
- [Phase 5A](PHASE_5A_TRANSACTION_REGISTER_OPERATIONS.md), [Phase 5B](PHASE_5B_PIKAS_CASH_WALLET_OPERATIONS.md),
  [5C.1](PHASE_5C1_REFUNDS.md), [5C.2](PHASE_5C2_REPLENISHMENT_REVERSALS.md),
  [5C.3](PHASE_5C3_ADMINISTRATIVE_ADJUSTMENTS.md).
- [Permissions](ADMINISTRATION_AND_PERMISSIONS.md), [POS financial model](POS_FINANCIAL_MODEL.md)
  (historical demo), [UX foundations](UX_FOUNDATIONS.md), [UX audit](UX_UI_AUDIT_PRE_PHASE_5D.md).
- Migrations `202610040001` (purchases), `202610050001` (refunds), `202610030001`
  (register sessions), `202610070001` (staff receivables), `202610010002` (wallet
  ledger) and `202610160001` (register cash summary and close reconciliation).

## 5D.1 implementation status (local)

**Surface.** Cafeteria Admin → **Reportes** (`/admin/cafeteria/reportes?cafeteria=…`). It
sits in the sidebar after Transacciones, and in the mobile "Más" menu.
- It is listed only when the server-derived cafeteria read grants
  `cafeteria:pos:purchases:read` on a customer tenant.
- A sandbox tenant gets an explanation instead of figures.
- No charts. No other 5D slice is implemented.

**Function.** `public.cafeteria_report_read(p_cafeteria_id, p_kind, p_period, p_from,
p_to)`, kind `sales_summary` only. Migration `202610210001_cafeteria_sales_report.sql`.
- Read-only, `security definer`, executable by `authenticated` only.
- Authority: `begin_sandbox_admin_command('cafeteria_admin')`, then
  `require_financial_admin(cafeteria, 'cafeteria:pos:purchases:read')`. This is the same
  guard as the Phase 5A Transacciones read, and it is revalidated after reading.
- Denied: School and Account Admin (D1/D2), cashiers, POS supervisors without a
  cafeteria-admin membership, platform-only actors, admin sandbox POVs (the frozen POV
  allowlist excludes purchase reads) and other cafeterias.
- No new capability.
- All totals are computed in one SQL statement, so the result comes from one snapshot.
  Arithmetic is PostgreSQL `numeric`, and amounts are returned as integer minor-unit
  strings.
- Route: `POST /api/cafeteria/reports` (same-origin, strict Zod, `no-store`); contract in
  `apps/web/lib/cafeteria/reports.ts`.

**Metric definitions implemented** (single cafeteria, the cafeteria's catalog currency):

| Metric | Definition |
| --- | --- |
| Ventas brutas | Σ `purchases.total_minor` with `business_date` in the period, all tenders (cash, PIKAS Cash, staff credit; D5). Never reduced by refunds. |
| Reembolsos | Σ `refunds.amount_minor` with the refund's own `business_date` in the period (D3), with count and split by tender (cash / PIKAS Cash). Returned as a positive magnitude; displayed as a deductive movement `−RD$`. |
| Ventas netas | Ventas brutas − Reembolsos. Signed and never clamped. A refund-only period is negative. |
| Transacciones | Count of committed purchases with `business_date` in the period. Later refunds never remove a purchase. |
| Ticket promedio | Ventas brutas ÷ Transacciones (gross, not net), rounded to the nearest minor unit (PostgreSQL `round`, half away from zero). `null` when Transacciones = 0; displayed as "Sin transacciones". |
| Método de pago | Per authoritative `purchase_tenders.tender_type` (cash, student_wallet, staff_credit): transaction count and gross amount of the purchases. Not ledger or register data. |

Three domains stay separate: recargas, reversals and administrative adjustments are
never read. Register cash is not read.

**Periods and time.**
- Presets: Hoy, Últimos 7 días, Últimos 30 días (**default**) and Personalizado
  (inclusive dates, at most 92 days, end not after today).
- "Hoy" is derived server-side from `schools.business_timezone` of the cafeteria's school.
  That is the existing authoritative, validated IANA zone (default
  `America/Santo_Domingo`), snapshotted by checkout and refunds into `business_date`.
- Purchases and refunds filter on those stored business dates; no historical timestamp
  is reinterpreted.
- The UI renders the returned dates as plain calendar dates and names the zone. The
  browser does no timezone conversion, so G4 is not extended.
- `pikas_private.report_clock()` is a private test seam, like `refund_clock()`.
- G1 (wallet ledger dates) is untouched, because 5D.1 reads no wallet data.

**G3 index decision: no index added.** The query filters
`(account_id, school_id, cafeteria_id)` by equality, plus a `purchased_at` window of the
period ±2 days. Any IANA offset is under a day, so that window strictly contains every
purchase whose business date is in range, and lets the existing
`purchases_cafeteria_time_idx (account_id, school_id, cafeteria_id, purchased_at)` bound
the scan. `business_date` stays the authoritative filter. Refunds use the existing
`refunds_business_date (cafeteria_id, business_date)` index; local EXPLAIN shows an index
range scan.
- Limitation: local data is too small for the planner to demonstrate behaviour at
  volume. Revisit with EXPLAIN on pilot-scale data before 5D.2 adds product aggregation.

**Presentation.**
- Shared `MoneyValue` intents:
  - Ventas brutas, Ticket promedio and tender amounts use `amount` (neutral).
  - Reembolsos use `movement` (−, red).
  - Ventas netas use `balance` (neutral, red if negative).
- Every total has an explicit label and a help line; there is no bare "Ventas".
- Tender rows: Efectivo and PIKAS Cash are always listed; a zero row reads "Sin ventas en
  este período", not a misleading RD$ amount. Crédito de personal appears only when it
  has sales in the period.
- "Sin ventas ni reembolsos en este período" explains a no-activity period.
- A failed or malformed response shows an alert with "Reintentar" and **no figures**.

**Validation (local, fictional fixtures).**
- pgTAP `supabase/tests/phase5d1_sales_report.test.sql`: **52/52**. It covers:
  - authority for every role;
  - cross-cafeteria isolation;
  - recarga and adjustment exclusion;
  - cash, PIKAS Cash and staff-credit gross;
  - partial and full refunds;
  - a cross-period refund and negative net;
  - zero-transaction average;
  - tender sums;
  - preset, custom, 92/93-day, reversed and future ranges;
  - the business-time boundary (02:30 UTC Nov 1 = Oct 31 local).
- Focused web tests: 69/69 (7 files, including the 5A operations route regression).
  TypeScript, ESLint and `supabase db lint` are clean; the production build succeeds.
- Production-mode browser at 390/768/1440: discovery via the nav, the default 30-day
  report, preset and custom switching, >92 days rejected (UI and API), values matching
  the fixtures, negative net on a refund-only day, no overflow, 44–46px controls. School,
  cashier and account roles see no Reportes link and are denied by URL.
- No concurrency suite: the report is a single read-only statement with no locks or
  writes, so no race can produce inconsistent totals.

**Limitations / deferred.** Reconciliation (5D.3), Transacciones
filters and refund badge (5D.4), PIKAS Cash reporting (5D.5) and CSV (5D.6 / D9) are not
implemented. Other limitations:
- No "Ayer" preset (not in the approved 5D.1 set).
- No register or staff filters (D12).
- No multi-cafeteria roll-up.
- No multi-currency support: rows outside the cafeteria's catalog currency are excluded.

## 5D.2 implementation status (local)

**Surface.** A "Productos principales" section on the same Reportes page.
- It uses the **same selected period** as the sales summary: no second date picker and no
  separate filters. "Últimos 30 días" remains the default report period (D4), not a
  hardcoded window.
- Shown per product, as a compact ranked list: name, net units, sold units and refunded
  units. No revenue, charts or category analytics.
- Units are period activity, **not inventory**; the help text says so.

**Function and API.**
- Migration `202610220001_cafeteria_top_products_report.sql` replaces
  `public.cafeteria_report_read` with the identical signature, guard and period/time
  resolution, and adds kind `top_products`.
- The 5D.1 `sales_summary` statement is copied byte-for-byte. The 5D.1 migration is not
  edited.
- `POST /api/cafeteria/reports` now takes a required `kind`, and validates the result
  schema for that kind. A response of another kind is rejected.
- Authority is unchanged: the same Cafeteria Admin purchase-read guard covers both kinds.

**Definitions (event period, consistent with 5D.1 / D3):**

| Field | Definition |
| --- | --- |
| Unidades vendidas (gross) | Σ `purchase_items.quantity` where the purchase `business_date` is in the period |
| Unidades reembolsadas | Σ `refund_items.quantity` where the refund's own `business_date` is in the period, from authoritative item rows only |
| Unidades netas | vendidas − reembolsadas. May be negative (refund-only period); never clamped |

- Eligible products have gross > 0 or refunded > 0 in the period, so a refund-only
  product appears with negative net.
- A refund on a later day never moves units back to the sale day.
- **Ranking:** net units descending, then `product_id` ascending (deterministic). At
  most 10 rows. `product_count` reports how many products had activity
  ("Mostrando 10 de N").

**G2 (refunds without item detail).** A refund with no `refund_items` rows is reliably
detectable: 5C.1 writes item rows atomically, and the legacy amount-only
`create_purchase_refund` writes none.
- Such refunds are never allocated to products: no proportional split and no inference
  from the amount.
- Their amounts remain in 5D.1 Reembolsos.
- The report returns `refunds_without_item_detail` for the period, and the UI shows a
  one-line note when it is > 0.

**G5 (product names).** Activity is grouped by the authoritative `product_id`.
- Same-named products stay separate, and a renamed product is never split.
- The name shown is the `product_name_snapshot` of the most recent purchase line
  contributing to the period (sold or refunded line). There is no name-history table
  and no rewrite.

**Index: NO INDEX ADDED — RECHECK WITH PILOT-SCALE DATA.** Local EXPLAIN shows every new
join is index-backed:
- purchases via the cafeteria prefix (as 5D.1);
- `purchase_items` by `purchase_id`;
- refunds by `refunds_business_date`;
- `refund_items` by its primary key (`refund_id`);
- the refunded line by `purchase_items_pkey`.

**Validation (local, fictional).**
- pgTAP `phase5d2_top_products.test.sql`: **42/42**. It covers:
  - authority (all roles) and cross-cafeteria isolation;
  - ranking by net, not gross;
  - deterministic ties;
  - the 10-row cap;
  - partial, multiple and full item refunds;
  - legacy amount-only refund not fabricated, and detected;
  - cross-period refund (original day unchanged; refund-only day −2; spanning range nets);
  - empty period;
  - same-name and renamed products;
  - period presets / >92 / business-date boundary;
  - `sales_summary` regression through the replaced function.
- 5D.1 suite rerun: **52/52**.
- Focused web tests 81/81 (7 files). TypeScript, ESLint and `supabase db lint` are clean;
  the production build succeeds.
- Production-mode browser at 390/768/1440, existing fictional data (no new data):
  - 30 days: 1. Sándwich 3/0/3; 2. Fruta 1/0/1; 3. Agua 2 sold · 1 refunded, net 1.
    Fruta precedes Agua on the product_id tie.
  - Hoy (refund-only): Agua −1 neta.
  - The empty period is explicit.
  - Both sections request the same period on every change; rapid 30 días → Hoy ends on
    Hoy in both.
  - No overflow.
- No concurrency suite: single read-only statement, no locks or writes.

## 5D.3 implementation status (local)

**Surface.** Two sections on the same Reportes page, after Productos principales:
- **Conciliación de caja** (period-scoped): four counts, then the closed sessions, newest
  close first, at most 50 ("Mostrando las 50 más recientes de N").
  - Each row shows register, close time, operator, Esperado, Contado and the labelled
    discrepancy.
  - The full 5A breakdown sits behind a native "Ver desglose" disclosure: Fondo inicial,
    Ventas en efectivo, Cobros de cuentas de personal, Reembolsos en efectivo, esperado,
    contado, diferencia, apertura, and cierre (type and closer). No modal.
- **Cajas abiertas ahora** (current state), in a separate card. Each open register is
  labelled "Abierta · sin conciliar", with "Abierta desde", the operator, "Efectivo
  esperado ahora" and the same breakdown.
- Same single period selector; no second date picker. No mutation actions; a link points
  to Cajas.
- Shown only when the server-derived read grants `cafeteria:pos:sessions:read`. The RPC
  enforces it again.

**Phase 5A source reused (never recomputed).**
- Closed session:
  - `pikas_private.register_close_reconciliations.summary` (captured at close by the 5A
    trigger): `opening_minor`, `cash_sales_minor`, `cash_settlements_minor`,
    `cash_refunds_minor`, `expected_minor`;
  - `.difference_minor`;
  - `register_sessions.counted_cash_minor`.
- Open session: the live `pikas_private.register_cash_summary(session)`. This is the same
  function, and the same expected value, that the admin Caja read already shows.
- Expected is the frozen 5A formula: opening + cash sales + cash staff-receivable
  settlements − cash refund outflows. PIKAS Cash and staff-credit sales, recargas,
  reversals and wallet adjustments are not register cash.

**Discrepancy sign: no normalization needed.** 5A stores
`difference_minor = counted − expected`, the required convention.
- 0 → **Cuadrada** (neutral).
- > 0 → **Sobrante**, with an explicit `+` amount.
- < 0 → **Faltante**, with an explicit `−` amount.
- Status is classified in SQL from the stored difference. The client only checks that the
  status matches the sign.
- Rendered with the shared `MoneyValue` `movement` intent (signed, toned) next to the text
  label, so meaning never depends on color.
- This supersedes the §13 note on the `balance` intent, because the owner's 5D.3
  instruction requires an explicit `+` for overages.

**Period membership (closed sessions).** A closed session belongs to the period by its close
business date, `(closed_at at time zone business_timezone_snapshot)::date`.
- 5A stores no closing business date. This is the same convention 5A enforces for
  `opened_business_date`, applied to the immutable `closed_at` and the session's own
  snapshotted zone.
- This supersedes the earlier §13/§15 "`opened_business_date`" proposal, per the owner's
  5D.3 instruction ("authoritative close/business date").
- A session open across midnight belongs to the day it closed.
- Rows outside the cafeteria's catalog currency are excluded, as in 5D.1.

**Summary definitions (closed sessions in the period).**
- Sesiones cerradas = all of them.
- Cuadradas: difference = 0.
- Con faltante: difference < 0.
- Con sobrante: difference > 0.
- Sin captura al cierre: closes with no 5A capture (pre-5A). They show counted cash only
  and are never classified, derived or recomputed.
- Sesiones cerradas = the sum of the four.
- **Counts only.** No net discrepancy and no money aggregate: a −RD$500 and a +RD$500 are
  two exceptions, never "RD$0".

**Open vs closed.**
- Open sessions are never counted in the summary and carry no counted cash, difference or
  status. The response schema rejects such keys.
- They are listed whatever the selected period, because they are current state.
- When no session closed in the period and no register is open, a single "Sin actividad
  de caja" message replaces both sections. Each section otherwise has its own empty
  message.
- A failure shows an alert with "Reintentar" and no figures. The sales and products
  sections load and fail independently.

**Function and API.**
- Migration `202610230001_cafeteria_reconciliation_report.sql` replaces
  `public.cafeteria_report_read`, keeping the identical signature, period/time resolution,
  grants and byte-identical `sales_summary` / `top_products` statements. It adds kind
  `reconciliation`.
- The guard capability now follows the kind, as in the 5A operations read:
  `cafeteria:pos:purchases:read` for sales and products, `cafeteria:pos:sessions:read`
  for reconciliation. Both go through `require_financial_admin` and are revalidated after
  reading.
- The current-state open section comes from the same response (one call), reusing the 5A
  live summary rather than the paginated Caja list, which could omit an old open session.
- `POST /api/cafeteria/reports` accepts `kind: reconciliation`, with a strict Zod result
  schema. Closes and wall times are formatted from server-provided school-local strings;
  the browser does no timezone conversion.

**Authority.**
- Allowed: Cafeteria Admin of that cafeteria. This includes a person who is also a POS
  Supervisor, through the admin membership.
- Denied: unrelated Cafeteria Admin, School Admin, Account Admin, cashier, POS
  Supervisor without an admin membership (D7), Platform Admin, the sandbox Cafeteria
  Admin POV (the frozen allowlist excludes session reads), and customer admins reading a
  sandbox cafeteria.
- Cashiers get nothing new: no page, route result or POS total; the blind close is
  unchanged (D6/D8).

**Index: NO INDEX ADDED.** Local EXPLAIN:
- the session scan is bounded by the existing cafeteria-prefixed
  `register_sessions_purchase_scope_key`, plus an `opened_at < to+3d` bound
  (`closed_at ≥ opened_at`);
- operator and closer use `persons_pkey`; the capture is read by its primary key;
- open sessions are at most one per register.

Volume is about one session per register per day. Recheck with pilot-scale data.

**Validation (local, fictional).**
- pgTAP `phase5d3_reconciliation.test.sql`: **68/68**. It covers:
  - authority for every role, the sandbox POV and cross-cafeteria isolation;
  - presets, custom, 92/93-day, reversed, future and preset-with-dates ranges;
  - the business-date boundary: a close at 23:30 local is on its local date, not its UTC
    date;
  - exact equality with the stored 5A captures;
  - the A/B/C/D fixture (below);
  - a pre-5A close with no derived values;
  - a historical close not rewritten by later refunds and sales;
  - `sales_summary` / `top_products` regression and their authority.

  The A/B/C/D fixture:
  - A: cash sales, PIKAS Cash, staff credit, a cash collection, a cash refund, and a
    recarga plus a wallet adjustment during the session. Expected 15500, counted 15000:
    Faltante −500.
  - B: balanced.
  - C: a later session paying a cash refund of A's sale. Sobrante +500, opposing A without
    netting.
  - D: open, live expected 8000, nothing fabricated.

  Back-dated and pre-5A sessions are inserted through the frozen guard's single closed
  transition inside the rolled-back test.
- 5D.1 suite rerun **52/52**; 5D.2 suite rerun **42/42**.
- Focused web tests 90/90 (8 files: reporting contract/route/UI, admin shell, 5A Caja
  operations route/contract/UI, shared money semantics). TypeScript, ESLint and `supabase db lint` are clean; the
  production build succeeds.
- Production-mode browser (isolated UX-audit stage, loopback adapter) at 390/768/1440,
  "Cafetería Ficticia Auditoría":
  - counts 3/1/1/1;
  - Faltante −RD$ 25.00 (3,000 / 2,975), Sobrante +RD$ 25.00 (3,000 / 3,025), Cuadrada
    (0 / 0), matching the stored captures;
  - open Caja Principal shown separately with expected RD$ 3,425.00 and no status;
  - a custom empty period still shows the open register;
  - rapid 30 días → Hoy ends on Hoy in every section;
  - sales and products still update;
  - no overflow; 44px disclosure;
  - cashier, POS Supervisor and School Admin get 403 from the route, and the cashier POS
    shows no expected cash.
- Local fictional data added for the browser check: the supervisor closed its existing open
  "Caja Patio" session (0/0), then opened and closed two more (3,000/2,975 and
  3,000/3,025). "Caja Principal" was left open.
- No concurrency suite: single read-only statement, no locks or writes.

**Deferred.** 5D.4 (Transacciones filters / refund status), 5D.5 (PIKAS Cash reporting)
and 5D.6 (CSV) are untouched. Also not implemented:
- the 5D.3 "live open-session summary in admin Caja" bullet (§25): Caja already shows
  live expected for open sessions;
- a register filter;
- cashier or supervisor views;
- alerts, explanations or approval of discrepancies.

## 5D.5 implementation status (local)

**Contract.** Migration `202610250001_school_wallet_report.sql` adds
`public.school_wallet_report(p_school_id, p_period, p_from, p_to)`. It is read-only and
additive (security definer, execute for `authenticated` only), with route
`POST /api/school/wallet-report` and the School Admin page **PIKAS Cash**
(`/admin/escuela/pikas-cash`).

**Authority.**
- Allowed: `require_school_admin(.., 'school:wallets:read')`, revalidated after reading.
  That is the School Admin of the school, and the Account Admin of its account through the
  existing Beta wallet policy.
- Denied: the sandbox admin POV (explicitly, as `school_wallet_access` already reports),
  Cafeteria Admin (D13), POS roles, Platform Admin, other schools and other accounts.
- The nav item appears only with the server-derived wallet read.

**Semantics (final, §12 / D10).**
- **Ahora (point-in-time):**
  - Σ `student_wallets.current_balance_minor` of the school's DOP wallets;
  - wallet count, active and frozen (stored `status`);
  - negative balances (count and total).

  These never derive from period movements. "Monedero activo" means only the stored status.
- **Period (event date):** ledger entries whose `occurred_at` falls on the school's business
  dates (schools.business_timezone, gap G1), using local-day boundaries.
  - **Recargas:** `replenishment` entries.
  - **Reversiones de recarga:** `replenishment_reversal` entries. They are shown separately,
    never as a purchase refund, and never re-dated.
  - **Recargas netas:** Recargas − Reversiones.
  - **Compras con PIKAS Cash:** |`purchase` entries|, wallet-paid only.
  - **Reembolsos a PIKAS Cash:** `refund` entries on their refund date.
  - **Ajustes administrativos:** 5C.3 adjustments (`actor_role` set), split into credits and
    debits.
  - **Ajustes históricos:** pre-5C.3 adjustments, as a net amount, shown only when present.
  - **Movimiento neto:** Σ of all entries.
- **¿Dónde se usó PIKAS Cash? (D10):** per cafeteria, PIKAS Cash purchases
  (`wallet_purchase_debits.cafeteria_id`) and PIKAS Cash refunds
  (`wallet_refund_credits.cafeteria_id`) with counts.
  - Replenishments, reversals and adjustments are never attributed to a cafeteria.
  - No net per cafeteria (not defined).
- **Never returned:** cash or staff-credit sales, gross/net sales, all-tender transaction
  counts, average ticket or register data. Wallet spending is labelled "not the
  cafeteria's total sales".

**Index: NO INDEX ADDED.** Local EXPLAIN on PostgreSQL 17.6, in a rolled-back fixture with
10,000 ledger entries in one school:
- `wallet_ledger_wallet_time_idx` carries the `occurred_at` bound as an index condition;
- Hoy over all 10,000 entries took 37 ms; a past month with none of them took 11 ms.

Recheck with pilot-scale history. A school-level `(account_id, school_id, occurred_at)` index
is the candidate if needed.

**Validation (local, fictional).**
- pgTAP `phase5d5_school_wallet_report.test.sql`: **56/56**. It covers:
  - privileges, RLS kept, and authority for every role, the sandbox POV, sibling school and
    other account;
  - presets, custom, 92/93-day, reversed, future and incomplete ranges, and the business-day
    boundary;
  - each event type (two replenishments, a reversal, credit and debit adjustments, PIKAS
    Cash purchases at two cafeterias, a PIKAS Cash refund), with cash and staff-credit sales
    excluded;
  - the identity Σ movements = change in total balance;
  - current balance independent of the period;
  - cafeteria attribution and the breakdown summing to Compras;
  - no sales, cash, register or all-tender fields;
  - no leakage to the sibling school; the Account Admin sees the same report;
  - read-only.
- Route **12/12**; browser component **4/4**; production-mode browser at 390/768/1440 matched
  an independent ledger query (see the audit §30).
- 5C.1 60/60 and 5D.1–5D.4 52/42/68/86 pass.
- The 5B, 5C.2 and 5C.3 suites show failures that assume a freshly seeded wallet 5201. Local
  seed data from 2026-10-17 holds a balance there. They fail identically with the 5D.5
  function dropped (the accepted 1fda44d state), so this is local data, not 5D.5.

**Deferred.**
- Account-wide roll-up across schools (5D.5b, optional).
- Historical balance at a past date and trends.
- Per-student rankings (not in 5D).
- Export (5D.6 / D9).

## 1. Objective

Phase 5D gives tenant operators read-only visibility of what their own operation
recorded. It answers:
- What happened?
- How much was sold, and how was it paid?
- Which products perform?
- What happened with physical register cash, and are there discrepancies?
- What PIKAS Cash activity occurred?

Each number has exactly one authoritative derivation, and each role sees only what its
existing authority already covers.

## 2. Scope

- **Cafeteria Admin "Reportes"** (new, single cafeteria):
  - sales summary (gross, refunds, net, counts, payment-method mix);
  - top products;
  - period register reconciliation.
- **Cafeteria Admin "Caja":** a live summary of each open session, for the admin only.
- **Cafeteria Admin "Transacciones":** date and payment-method filters, refund status,
  and refund events in the detail. This keeps lookup of a specific sale outside
  Reportes.
- **School Admin / Account Admin PIKAS Cash report** (school scope), from the wallet
  ledger they are already authorized to read.
- Shared date/time and filter contracts, and dedicated read-only reporting RPCs.

## 3. Non-goals

- No change to any financial write path: checkout, refunds, reversals, adjustments,
  replenishments or register open/close.
- No new financial authority; no access widened because a report is "read-only".
- No POS checkout, refund-discovery, session-expiry, wallet-layout, global-navigation or
  dashboard redesign.
- No spending-limit UI, POS direct routing or session restoration.
- No Phase 5E platform analytics, cross-customer data or Platform Admin tenant access.
- No Phase 6 hardening. No charts or BI tooling. No materialized analytics store.
- No reporting for sandbox POVs. No mixing of sandbox and customer data.

## 4. Financial definitions (three separate domains)

Three domains are never summed together or presented as one number.

| Domain | What it measures | Authoritative records | Never includes |
| --- | --- | --- | --- |
| **A. Sales (Ventas)** | Committed commercial purchases at a cafeteria | `purchases`, `purchase_items`, `purchase_tenders`; corrections in `refunds`, `refund_items` | Recargas, reversals, adjustments, staff-receivable settlements |
| **B. PIKAS Cash** | Wallet value and its movements | `student_wallets`, `wallet_ledger_entries` and linked typed records | Cash sales, register cash |
| **C. Register cash (Caja)** | Physical cash expected in a register session | `register_sessions`, `pikas_private.register_cash_summary`, `pikas_private.register_close_reconciliations` | PIKAS Cash and staff-credit sales, recargas, wallet corrections |

How a sale touches each domain:

| Record | Sales | PIKAS Cash | Register cash |
| --- | --- | --- | --- |
| Cash sale | +total | — | +total (received − change) |
| PIKAS Cash sale | +total | −total (`purchase` entry) | — |
| Staff-credit sale | +total | — | — |

- A **RD$500 PIKAS Cash sale** is RD$500 of sales and a −RD$500 wallet movement. It is
  not register cash.
- A **RD$1,000 recarga** is a +RD$1,000 wallet movement. It is not sales and not
  register cash (Phase 5B: replenishments carry no session attribution).

Register cash uses the frozen Phase 5A formula, reused and never re-derived:

`expected = opening cash + cash sales + cash staff-receivable settlements − cash refund outflows`

- A **staff-receivable cash settlement** adds register cash but is **not** sales.
- A **cash refund** leaves the operator's **current** session (5C.1), which may differ
  from the session of the original sale.

## 5. Gross / refunds / net semantics

The bare label "Ventas" is never used for a total. Every money total names its basis.

| Metric (UI label) | Definition | Basis date |
| --- | --- | --- |
| **Ventas brutas** | Σ `purchases.total_minor` of committed purchases, all payment methods (Efectivo, PIKAS Cash, Crédito de personal) | `purchases.business_date` |
| **Reembolsos** | Σ `refunds.amount_minor` of refund events, split by tender (Efectivo / PIKAS Cash) | `refunds.business_date` (event date) |
| **Ventas netas** | Ventas brutas − Reembolsos, same period | event-date basis (see below) |
| **Transacciones** | Count of committed purchases in the period, including later fully refunded ones | `purchases.business_date` |
| **Ticket promedio (bruto)** | Ventas brutas ÷ Transacciones; shown only when the count is > 0 | as above |
| **Transacción reembolsada (total)** | A purchase whose cumulative refunds equal its total (latest `refunds.remaining_after_minor` = 0) | state as of report time |
| **Transacción reembolsada parcialmente** | Cumulative refunds > 0 and < total | state as of report time |
| **Unidades vendidas** | Σ `purchase_items.quantity` | `purchases.business_date` |
| **Unidades reembolsadas** | Σ `refund_items.quantity` | see §14 (top products) |
| **Unidades netas** | Unidades vendidas − unidades reembolsadas of those same lines | see §14 |

**Event-date basis (recommended).** A refund counts on the business date it happened,
not on the date of the original sale. This matches the frozen register model: a cash
refund leaves the current session, and closed sessions are never rewritten. A refund
today of a sale from last week therefore reduces today's Ventas netas. It can make a
day's net negative; that is shown signed with its label, never hidden.
**Resolved (D3):** event-date basis, implemented in 5D.1.

Correction treatment:

| Correction | Reduces Ventas brutas? | Shown separately? | Ventas netas | Register cash | Wallet totals | Transaction count | Product units / ranking |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Full cash refund | No | Yes, Reembolsos (Efectivo) | Reduces | −amount in the refunding session | No | Unchanged (marked "reembolsada") | Units refunded (§14) |
| Partial / item cash refund | No | Yes | Reduces by amount | −amount in the refunding session | No | Unchanged (marked "parcial") | Refunded lines only |
| PIKAS Cash refund (full or partial) | No | Yes, Reembolsos (PIKAS Cash) | Reduces | None | +amount (`refund` entry) | Unchanged | As above |
| Legacy amount-only refund (pre-5C.1) | No | Yes | Reduces | As recorded | As recorded | Unchanged | No unit allocation (gap G2) |
| Replenishment reversal | — | Only in PIKAS Cash reports | Not sales | None | −amount (Reversiones) | Not a transaction | None |
| Administrative adjustment | — | Only in PIKAS Cash reports | Not sales | None | ±amount (Ajustes, split credit/debit) | Not a transaction | None |
| Negative wallet balance | — | Only in PIKAS Cash reports (count and total of negative balances) | Not sales | None | Point-in-time state, not a movement | — | — |

Staff-credit purchases cannot be refunded (5C.1 deferral), so their sales are never
reduced.

## 6. Role authority matrix

The matrix maps onto existing capabilities. No new capability is proposed for Beta.
Cafeteria reports reuse:
- `cafeteria:pos:purchases:read` for sales and products;
- `cafeteria:pos:sessions:read` for reconciliation.

Both go through `pikas_private.require_financial_admin`, which already requires
`require_cafeteria_admin`. School reports reuse `school:wallets:read` through
`require_school_admin`.

| Surface / metric | Account Admin | School Admin | Cafeteria Admin | POS Supervisor | Cashier | Platform Admin | Sandbox POV |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cafeteria sales summary (gross / refunds / net / mix) | NO (**D1**) | NO (**D1**) | SCOPED: own administered cafeteria | NO | NO | NO | NO |
| Top products | NO | NO | SCOPED: own cafeteria | NO | NO | NO | NO |
| Period register reconciliation | NO | NO | SCOPED: own cafeteria | NO (**D7**) | NO | NO | NO |
| Live open-session summary incl. expected cash | NO | NO | SCOPED: own cafeteria (admin-only Caja) | NO (**D7**) | NO, blind count (owner decision 1) | NO | NO |
| Transacciones lookup and filters | NO | NO | SCOPED: own cafeteria | Existing POS history only | Own sales (`read_own`), existing | NO | NO |
| PIKAS Cash school report | SCOPED: schools in own account | SCOPED: own school | NO (balance lookup of connected customers only, existing) | NO | NO | NO | NO |
| PIKAS Cash spending by cafeteria (wallet-paid only) | SCOPED (**D10**) | SCOPED (**D10**) | NO | NO | NO | NO | NO |
| Aggregate balance of connected customers | — | — | NO (**D13**) | NO | NO | NO | NO |
| CSV export of financial data | Deferred (**D9**) | Deferred | Deferred | NO | NO | NO | NO |

Scope notes:
- **Cafeteria Admin:** only cafeterias where it holds an active `cafeteria_admin`
  membership, one cafeteria per report through the existing context switcher. No
  multi-cafeteria roll-up in 5D.
- **School Admin:** being connected to a cafeteria does **not** grant visibility of the
  cafeteria's commercial data. No school or account capability reads `purchases` today.
  PIKAS Cash data comes from the school's own wallet ledger.
- **Account Admin:** the wallet scope follows the Beta wallet authority (read and
  replenish in its account's schools). An account-wide roll-up across its own schools is
  tenant reporting (5D), not 5E. It is a later slice option, not required.
- **Platform Admin:** no standing tenant financial authority. Customer-authorized
  support access remains deferred.
- **Sandbox POV:** the frozen admin POV allowlist excludes financial history. Every
  report RPC denies it, as `cafeteria_operations_read` does.

## 7. Surface / information architecture

This follows [UX_FOUNDATIONS §3](UX_FOUNDATIONS.md).

| Surface | Question | 5D content | Not here |
| --- | --- | --- | --- |
| **Transacciones** (Cafeteria Admin, existing) | "Which sale?" | Chronological sales with date and payment-method filters, refund status badge, refund events in the detail | Totals, charts |
| **Caja** (Cafeteria Admin, existing) | "What is in this register?" | Session history (5A) plus a live summary for open sessions (admin only) and per-session reconciliation | Period analytics |
| **Reportes** (Cafeteria Admin, new nav entry) | "What does the data tell me?" | Sales summary, top products, period reconciliation | Acting on a single sale; links go to Transacciones and Caja |
| **Movimientos** (School/Account, existing per-student wallet page) | "What happened to this wallet?" | Unchanged | Aggregates |
| **PIKAS Cash report** (School/Account) | "What does wallet activity tell me?" | School-level wallet summary (§12) | Sales totals |
| **Actividad** (School, existing) | "What happened?" (audit) | Unchanged in 5D | Analytics |

- Reportes gets one Cafeteria Admin navigation entry, "Reportes", added only in the
  slice that ships real content. There are no placeholders.
- No new Actividad page for cafeterias in 5D: Transacciones and the Caja history are its
  operational history.
- Report rows link into Transacciones/Caja detail, never into financial actions
  directly.

## 8. Cafeteria Admin reporting contract

| Item | Surface | 5D? |
| --- | --- | --- |
| Ventas brutas, Reembolsos (by tender), Ventas netas | Reportes | Yes |
| Transacciones, Ticket promedio (bruto) | Reportes | Yes |
| Payment-method mix (Efectivo / PIKAS Cash / Crédito de personal): amount and count, gross | Reportes | Yes |
| Transactions fully / partially refunded (count) | Reportes | Yes |
| Top products, units sold / refunded / net | Reportes | Yes |
| Period reconciliation (sessions, expected, counted, difference) | Reportes, detail in Caja | Yes |
| Live open-session summary | Caja | Yes |
| Transaction lookup with date, payment-method filter and refund status | Transacciones | Yes |
| Location filter | — | Not needed (a cafeteria has exactly one `school_location_id`) |
| Register filter | Reportes / Caja | Defer |
| Cashier/staff filter or staff performance | — | Defer (**D12**) |
| Dashboard "Hoy" card (F07/F10) | Resumen | Defer (dashboard work) |

## 9. School Admin reporting contract

- **Yes (scoped to its school, `school:wallets:read`):** the PIKAS Cash report (§12).
- **No:** cafeteria sales totals, payment-method mix, products and register cash. These
  are the cafeteria's commercial data; no school capability covers them.
  **Resolved (D1): NO.**
- **Optional, D10:** PIKAS Cash spending by cafeteria, from the school's own ledger
  `purchase` entries (wallet-paid portion only). Per-student this is already visible in
  Movimientos.
- No per-student "top spender" rankings in 5D (privacy, not needed for operations).

## 10. Account Admin reporting contract

- **Yes:** the same PIKAS Cash report as School Admin, for any school in its account,
  through the existing school selector. Recargas are already within its authority.
- **No:** cafeteria sales totals. No account capability reads purchases, and Phase 4D.2
  deliberately withheld financial authority beyond the owner's Beta wallet policy.
  **Resolved (D2): NO.** Any future change needs an explicit new capability and its own
  slice.
- An account-wide wallet roll-up across its schools is optional (slice 5D.5b) and not
  required for Beta.

## 11. POS Supervisor / Cashier visibility

This is operational visibility, not formal reporting. 5D adds **no** POS surface and
changes nothing in the POS.

- **Cashier, open register** (existing, unchanged):
  - status, register and opening float (which they counted themselves);
  - own sales and receipts (`read_own`);
  - refund lookup.

  The owner's blind-count decision stands: no expected-cash value before the count, and
  no running cash-sales or cash-refund totals. Those would let the cashier derive the
  expected amount. Showing a non-cash transaction count is acceptable.
  **D6** confirms whether any running money total may be shown; recommendation: no.
- **Cashier, own close** (existing): enters counted cash only; the close is blind.
  Whether the cashier sees the difference afterwards is **D8**; recommendation: not in
  5D.
- **POS Supervisor:** holds `cafeteria:pos:sessions:read` and exceptional close, but
  `cafeteria_operations_read` admits only cafeteria admins. 5D gives supervisors no
  reporting. Their own register close stays blind like a cashier's.
  **D7** decides any future supervisor oversight view (other sessions' expected cash).

## 12. PIKAS Cash reporting contract (School / Account Admin)

All metrics are per school wallet scope, from `wallet_ledger_entries` joined to its
typed records. Period movements use `occurred_at` converted to the school's business
date (gap G1).

| Metric (UI label) | Definition | Intent (UX foundations) |
| --- | --- | --- |
| **Recargas** | Σ `replenishment` entries in period; count | `movement` (+) |
| **Reversiones de recarga** | Σ \|`replenishment_reversal`\| in period; count | `movement` (−) |
| **Recargas netas** | Recargas − Reversiones (event-date) | `movement` |
| **Compras con PIKAS Cash** | Σ \|`purchase`\| entries in period; count | `movement` (−) |
| **Reembolsos a PIKAS Cash** | Σ `refund` entries in period | `movement` (+) |
| **Ajustes administrativos** | Credits and debits shown separately, plus net; legacy rows as "Ajuste histórico" | `movement` |
| **Movimiento neto del período** | Σ all entry amounts in period | `movement` |
| **Saldo PIKAS Cash total (ahora)** | Σ `current_balance_minor` over the school's wallets; point-in-time | `balance` |
| **Saldos negativos** | Count of wallets < 0 and their total | `balance` (red) |
| **Monederos activos** | Wallets with status active / total; wallets with ≥1 movement in period | count |

Rules:
- Aggregate balance is a liability-like stored value. It is **never** labeled as
  revenue or sales.
- Recargas are **never** labeled as sales. Funding source remains `manual_verified`
  only; no payment-method breakdown exists.
- Identity check, used as an acceptance criterion: Σ period movements equals the change
  in total balance between period start and end, derived from `balance_after_minor`
  snapshots.
- Historical balance at a past date and trends: defer.
- Cafeteria Admin receives no aggregated wallet data (**D13**). Its existing per-customer
  balance lookup is unchanged.

## 13. Register reconciliation contract

Phase 5A accounting is reused verbatim; nothing is reinterpreted.

- **Per session:**
  - Closed session: the immutable `register_close_reconciliations.summary` captured at
    close, with `difference_minor = counted − expected`.
  - Pre-5A closed session: derived summary, labeled as lacking a close-time capture (as
    5A does).
  - Open session: live `register_cash_summary`, labeled "En curso". It has no counted
    cash and no difference.
- **Fields:** Fondo inicial, Ventas en efectivo, Cobros de crédito de personal en
  efectivo, Reembolsos en efectivo, Efectivo esperado, Efectivo contado, Diferencia.
- **Difference** always carries a text label: "Cuadrada" (0), "Sobrante" (> 0),
  "Faltante" (< 0). It is rendered with the existing `balance` intent (negative red,
  otherwise neutral) plus the label. No new color convention.
- **Period reconciliation (Reportes):**
  - sessions whose `opened_business_date` is in range;
  - totals over closed sessions only;
  - count and list of sessions with a non-zero difference (Σ faltantes and Σ sobrantes
    shown separately, plus net);
  - open sessions listed separately and excluded from difference totals.
- **Attribution caveat (shown as help text):** cash refunds reduce the session in which
  they were paid out, which may differ from the session of the original sale. The
  "Reembolsos en efectivo" in reconciliation (by session) can therefore differ from the
  cash "Reembolsos" in the sales summary (by refund business date). Both are correct
  for their question and are never forced to match.
- **Caja vs Reportes:**
  - Caja is the operational per-session place: history, detail, admin exceptional close,
    live open summary.
  - Reportes is the period roll-up, linking to Caja detail.
- Expected cash is an accounting value and may be negative (5C.1 `cash_shortfall`);
  display it signed.

## 14. Top products (Beta definition)

*Superseded by the owner's 5D.2 instruction, as implemented (see "5D.2 implementation
status"). The earlier sale-cohort and revenue tie-breaker proposal is withdrawn.*

- **Units:** event period, like the money totals. Gross units follow the purchase
  business date; refunded units follow the refund business date (item rows only). Net
  units may be negative and are never clamped.
- **Ranking:** net units descending, then `product_id` ascending.
- **Columns:** product, net units, units sold, units refunded. No revenue in 5D.2.
- **Size:** top 10 (a small prioritized list, consistent with the earlier Top-5
  direction). No full-catalog table in 5D.
- **Range (D4, resolved):** follows the selected report period. "Últimos 30 días" is the
  default report period, not a hardcoded top-products window.
- **Product identity:** group by `product_id`; display the most recent contributing
  `product_name_snapshot` (gap G5).
- **Legacy amount-only refunds** have no unit allocation. They are counted
  (`refunds_without_item_detail`) and explained, never allocated (gap G2).

## 15. Date / time semantics

- **Authority:** `schools.business_timezone` (validated IANA name, default
  `America/Santo_Domingo`). Purchases, refunds and register sessions already snapshot
  `business_timezone_snapshot` and `business_date` / `opened_business_date`, enforced
  by check constraints. Reports filter on these stored business dates, never on UTC
  days.
- **"Hoy":** the current business date computed **server-side** in the cafeteria's
  school timezone. "Últimos 7 días" / "Últimos 30 días" are today and the previous 6 / 29
  days (inclusive). "Ayer" is not offered in 5D.1.
- **Custom range:** inclusive start and end business dates; end not in the future;
  maximum span 92 days (**D11**).
- **Midnight crossings:** a session open across midnight keeps its sales on each sale's
  own business date in the sales summary. In reconciliation it belongs to its
  `opened_business_date` and shows its close time.
- **Open vs closed sessions:** see §13. Sales from an open session are included in sales
  totals (they are committed).
- **Display:** timestamps in the business timezone returned by the RPC, with the date
  and the zone named in the period header. Never UTC.
- **Gaps:**
  - G1: wallet ledger entries have no timezone/business-date snapshot.
  - G4: some existing UI hardcodes `America/Santo_Domingo`.

## 16. Filter contract

| Filter | Classification | Notes |
| --- | --- | --- |
| Hoy | REQUIRED FOR 5D | Implemented in 5D.1 |
| Ayer | USEFUL BUT DEFER | Not in the approved 5D.1 preset set |
| Últimos 7 días | REQUIRED FOR 5D | Implemented in 5D.1 |
| Custom date range | REQUIRED FOR 5D | Bounded (D11); server-validated |
| Cafeteria | REQUIRED FOR 5D | Via the existing context switcher; one cafeteria per report |
| Payment method | REQUIRED FOR 5D (Transacciones only) | Reportes already splits by method |
| Register | USEFUL BUT DEFER | Caja already lists by register |
| Cashier / staff | USEFUL BUT DEFER | Staff-performance sensitivity (D12) |
| Location | NOT NEEDED | Cafeteria implies one location |
| Últimos 30 días | REQUIRED FOR 5D | **Default report period** (all reports, including top products) |

## 17. Empty / error / state behavior

| State | Behavior |
| --- | --- |
| No sales in period | "Sin ventas en este período" plus the period; no table of zeros, no average ticket |
| No refunds | "Sin reembolsos en este período"; Ventas netas = Ventas brutas, stated |
| No register sessions | "No hay sesiones de caja en este período"; link to Caja |
| Open session | Labeled "En curso"; expected shown to admin only; no difference; excluded from difference totals |
| Closed session | Captured summary; pre-5A sessions labeled "Sin captura al cierre" |
| Zero difference | "Cuadrada" label, neutral |
| Non-zero difference | "Faltante"/"Sobrante" label, signed amount; sessions listed |
| No PIKAS Cash usage | Tender row "PIKAS Cash: sin ventas"; wallet report "Sin movimientos" |
| Partially refunded sale | "Reembolsada parcialmente" badge, refunded and remaining amounts in the detail |
| Fully refunded sale | "Reembolsada" badge; still counted as a transaction and in Ventas brutas |
| Negative Ventas netas (event-date) | Shown signed with an explanatory note |
| Authority loss / sandbox POV | Same denial copy as existing operations reads; no partial data |
| RPC failure / malformed response | Strict Zod validation; "No se pudo cargar el reporte" plus retry; no stale cached totals |
| Range too large / invalid | Field-level validation; the server rejects with a definite error |

## 18. Data-source matrix

| Metric | Definition | Authoritative source | Fields | Filters | Refund / correction treatment | Role scope | Ambiguity | Implementation note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ventas brutas | Σ purchase totals | `purchases` | `total_minor`, `business_date`, `cafeteria_id`, `currency_code` | date, cafeteria | none (gross) | Cafeteria Admin | staff credit included (D5) | numeric sum, return as string |
| Mix by method | gross by tender | `purchases` ⋈ `purchase_tenders` | `tender_type` | date | none | Cafeteria Admin | — | three fixed rows, always shown |
| Reembolsos | Σ refund events | `refunds` | `amount_minor`, `tender_type`, `business_date` | date | event-date | Cafeteria Admin | basis (D3) | `refunds_business_date` index exists |
| Ventas netas | brutas − reembolsos | derived server-side | — | date | event-date | Cafeteria Admin | D3 | same RPC call, one transaction snapshot |
| Transacciones | count purchases | `purchases` | `id` | date | refunded still counted | Cafeteria Admin | — | — |
| Refund status | total vs cumulative refunds | `refunds` (latest `remaining_after_minor`) | `purchase_id`, `refund_ordinal` | — | as of now | Cafeteria Admin | legacy refunds | add to `operation_purchase`-style read, not a new write |
| Units sold / refunded / net | Σ quantities | `purchase_items`, `refund_items` | `quantity`, `product_id`, `line_total_minor` | purchase date (sold) / refund date (refunded) | event period (§14) | Cafeteria Admin | G2, G5 | `purchase_items_product_idx` exists |
| Session reconciliation | 5A formula | `register_close_reconciliations` (closed), `register_cash_summary` (open / pre-5A) | summary JSON, `difference_minor` | `opened_business_date` | refunds by paying session | Cafeteria Admin | attribution caveat (§13) | never recompute closed captures |
| Wallet movements | Σ ledger by `entry_type` | `wallet_ledger_entries` | `amount_minor`, `entry_type`, `occurred_at`, `school_id` | date (derived) | reversals/adjustments separate | School / Account Admin | G1 | typed joins only for labels |
| Total / negative balances | point-in-time | `student_wallets` | `current_balance_minor`, `status` | none | — | School / Account Admin | — | label "ahora" |
| PIKAS Cash by cafeteria | Σ purchase entries by cafeteria | ledger ⋈ `wallet_purchase_debits` | `cafeteria_id` | date | refunds via `wallet_refund_credits.cafeteria_id` | School / Account Admin (D10) | — | wallet-paid only, labeled |

## 19. Recommended technical architecture

**Dedicated read-only SECURITY DEFINER RPCs with server-side aggregation**, following
the accepted `cafeteria_operations_read` pattern:

- **`cafeteria_report_read(p_cafeteria_id, p_kind, p_from date, p_to date)`**:
  - `p_kind` ∈ `sales_summary`, `products`, `reconciliation`;
  - calls `begin_sandbox_admin_command('cafeteria_admin')`, then
    `require_financial_admin` with `cafeteria:pos:purchases:read` (sales, products) or
    `cafeteria:pos:sessions:read` (reconciliation);
  - re-checks authority after reading, as the 5A read does;
  - returns `{cafeteria_id, tenant_kind, business_timezone, from, to, data}`.
- **`school_wallet_report(p_school_id, p_from, p_to)`**: under `require_school_admin` +
  `school:wallets:read`. It covers the Account Admin through the existing Beta policy.
- **Additive extension of the Transacciones read:** date, tender and refund status. No
  change to existing RPC signatures; add a new kind or a new function rather than
  altering frozen ones.
- **Rules for all of them:**
  - Aggregation in PostgreSQL `numeric`; amounts returned as decimal strings and parsed
    with existing `minorSchema`/BigInt.
  - No client-side financial aggregation; the browser only formats with `MoneyValue`.
  - Each response is computed in one statement or snapshot, so gross, refunds and net
    are mutually consistent.
  - Server derives "Hoy" and validates ranges.
  - `authenticated`-only execute; private helpers revoked from all client roles.
  - Same-origin `POST /api/cafeteria/reports` and `/api/school/wallet-report` with strict
    Zod, `no-store`, and error mapping as in existing routes.
- **Not recommended:**
  - Database views: RLS-bound views would need new table read grants and duplicate the
    authority logic.
  - Materialized views: staleness and refresh complexity.
  - Client queries: authority and consistency risk.
- **Performance:**
  - Existing indexes: `purchases_cafeteria_time_idx` (purchased_at),
    `refunds_business_date`, `purchase_items_product_idx`.
  - An additive index on `purchases(cafeteria_id, business_date)` is likely needed
    (gap G3). Decide with EXPLAIN on local fixtures in slice 5D.1.
  - Bounded ranges keep Beta volumes small.
- The application-session pre-request guard must be reviewed for the new RPC paths, as
  for previous RPCs (dependency).

## 20. Export decision

| Export | Classification |
| --- | --- |
| Student roster CSV (connected) | ALREADY SUFFICIENT (exists; out of scope) |
| Demo transactions CSV (`admin-pages.tsx`) | Not applicable (demo-only, local storage) |
| Connected transactions / report CSV | **DEFER** (**D9**) |

If the owner requires an export for the pilot, add it as a final optional slice
(5D.6). It would reuse the existing `csvCell` formula-injection protection, the BOM and
the server-bounded RPC pattern from `school_student_export`, with the same authority as
the report it exports.

## 21. 5D vs 5E boundary

| Phase 5D (tenant) | Deferred to Phase 5E (platform) |
| --- | --- |
| One cafeteria's sales, products, reconciliation | Cross-customer sales totals and rankings |
| One school's or account's PIKAS Cash activity | Platform-wide wallet aggregates and stored-value totals |
| Tenant-authorized roles only | Platform adoption, growth, active customers / users |
| Customer tenants (sandbox labeled and isolated) | Platform-wide refund / adjustment / reversal pattern analytics |
| | Customer health and benchmarking; multi-cafeteria or multi-account comparisons for PIKAS staff |
| | Any Platform Admin financial visibility (requires customer-authorized support context first) |

5E must exclude `tenant_kind = 'sandbox'` data from customer analytics.

## 22. Dependencies

- Owner decisions D1–D13 (§24) before the affected slices.
- Local Auth-enabled environment `scripts/setup-step4d6-local.py` (Docker) for every
  slice with SQL.
- The application-session pre-request guard review for new RPC paths.
- `UX_FOUNDATIONS.md` money semantics (`MoneyValue`), terminology and IA.
- Fictional fixtures covering cash, PIKAS Cash, staff credit, partial/full/legacy
  refunds, refunds in a later session, midnight-crossing and pre-5A sessions, reversals,
  adjustments and negative balances.

## 23. Risks

- **Definition drift:** the same number derived in two places. Mitigated by single RPCs
  (§18) and identity tests.
- **Authority creep:** "read-only" used to widen access. Mitigated by reusing existing
  capabilities, plus denial tests for every non-authorized role and POV.
- **Domain conflation:** recargas shown as sales, or PIKAS Cash sales counted as cash.
  Mitigated by §4, labels and tests.
- **Negative period values misread as balances or inventory.** Mitigated by help text
  ("actividad del período, no inventario") and explicit signs.
- **Blind-count leakage:** totals exposing expected cash. Mitigated by §11; no POS
  change.
- **Timezone errors at midnight boundaries.** Mitigated by stored business dates and
  boundary tests.
- **Performance on unindexed `business_date`** (G3).
- **Legacy data** (amount-only refunds, pre-5A sessions, legacy adjustments). Labeled,
  never reinterpreted.
- **Scope creep** into dashboards, audit waves or 5E. Mitigated by §3 and the slicing.

## 24. Owner decisions (RESOLVED)

The owner resolved all decisions before 5D.1. Do not reopen them during implementation.

| ID | Decision | Resolution |
| --- | --- | --- |
| D1 | Should School Admin see cafeteria sales totals? | **NO.** A school/cafeteria connection does not grant commercial reporting visibility. |
| D2 | Should Account Admin see cafeteria sales totals? | **NO.** Same boundary as D1. |
| D3 | Refund reporting date | **YES, event date.** A refund belongs to the period in which it occurred and never rewrites the original sale's business date; gross sales and refunds stay separately visible. |
| D4 | Top products (5D.2) | **YES.** Rank by net units, up to 10. They follow the **selected report period**; 30 days is the default period, not a hardcoded window. |
| D5 | Staff-credit purchases in Ventas brutas | **YES.** Committed purchases count regardless of legitimate tender; tender is a separate dimension. |
| D6 | Cashier running money totals | **NO.** Nothing that undermines the blind-count close. |
| D7 | POS Supervisor oversight view | **DEFER** beyond current 5D scope. |
| D8 | Cashier sees discrepancy after close | **DEFER.** The close experience does not change in 5D. |
| D9 | Financial CSV export | **DEFER.** 5D.6 is not implemented in Beta now. |
| D10 | School / Account PIKAS Cash spending by cafeteria | **YES, SCOPED** (5D.5). Only a summary of authorized student PIKAS Cash purchase activity per cafeteria. No cafeteria overall sales, cash sales, transaction totals, average ticket, other schools' activity, register performance, reconciliation or broader commercial reporting. |
| D11 | Maximum custom range | **92 days.** |
| D12 | Cashier / staff filter | **DEFER.** |
| D13 | Cafeteria Admin aggregate balance of connected students | **NO.** Scoped per-student balance access does not imply an aggregate wallet-value view. |

## 25. Proposed implementation slices

Each slice is independently implementable, testable, reviewable and committable.
None reopens frozen 5A–5C behavior.

**5D.1 — Reporting foundation and sales summary (Cafeteria Admin)**
- Goal: Reportes with Ventas brutas / Reembolsos / Ventas netas, Transacciones, Ticket
  promedio, method mix; Hoy / Ayer / 7 días / custom.
- Surfaces: new "Reportes" nav entry and page.
- Data:
  - `cafeteria_report_read` kind `sales_summary`;
  - server business-date helper;
  - possibly the additive `business_date` index;
  - API route and Zod contracts.
- Authority: reuse `cafeteria:pos:purchases:read`.
- Focused tests:
  - pgTAP: identities, event-date refunds, timezone boundary, staff credit, legacy
    refunds;
  - denial of school, account, supervisor, cashier, platform, sandbox POV and foreign
    cafeteria;
  - route/contract tests;
  - browser at 390/768/1440.
- Dependencies: D1–D3, D5, D11. Owner acceptance: yes. Docker: yes.

**5D.2 — Top products**
- Goal: top 10 by net units (§14).
- Surfaces: a Reportes section.
- Data: kind `products`.
- Authority: as 5D.1.
- Focused tests: event-period refunds, ties, product rename, legacy refunds, empty state.
- Dependencies: 5D.1, D4. Owner acceptance: yes. Docker: yes.

**5D.3 — Reconciliation**
- Goal: period reconciliation in Reportes; live open-session summary in admin Caja.
- Data: kind `reconciliation`, reusing `register_close_reconciliations` and
  `register_cash_summary`.
- Authority: `cafeteria:pos:sessions:read`, admin only. No POS or cashier change.
- Focused tests:
  - matches 5A captures exactly;
  - pre-5A labeling;
  - refund in a later session;
  - negative expected cash;
  - midnight crossing;
  - open session excluded from differences;
  - the cashier POS shows no new data.
- Dependencies: 5D.1. Owner acceptance: yes. Docker: yes.

**5D.4 — Transacciones lookup**
- Goal: date and payment-method filters, refund status badge, refund events in the
  detail (F13 subset).
- Data: a new read kind or function, additive.
- Authority: `cafeteria:pos:purchases:read`.
- Focused tests: filter correctness, full/partial/legacy refund status, pagination, the
  existing 5A route tests.
- Dependencies: none beyond 5D.1 helpers. Owner acceptance: yes. Docker: yes.

**5D.5 — PIKAS Cash report (School / Account Admin)**
- Goal: §12 metrics for one school.
- Surfaces: a school-scoped "PIKAS Cash" report section, linked from the existing
  student list / PIKAS Cash entry. No new global category.
- Data: `school_wallet_report`.
- Authority: `school:wallets:read` (Account Admin through the Beta policy).
- Focused tests:
  - ledger identity;
  - reversal and adjustment separation;
  - negative balances;
  - cafeteria admin, cashier, platform and sandbox denial;
  - G1 date derivation.
- Dependencies: D10. Owner acceptance: yes. Docker: yes.
- 5D.5b (optional): an Account-wide roll-up across its schools.

**5D.6 — Export (optional, only if D9 = required)**
- Goal: CSV of Transacciones or the report for the selected range.
- Data and authority: as the report it exports; bounded rows; `csvCell`.
- Focused tests: injection protection, limits, authority.
- Docker: yes.

## 26. Acceptance criteria

- Every displayed number maps to exactly one row of §18 and one RPC kind.
- Identities hold on fixtures:
  - Ventas netas = Ventas brutas − Reembolsos;
  - Σ method mix = Ventas brutas;
  - Σ Reembolsos by tender = Reembolsos;
  - reconciliation equals the 5A captures;
  - wallet period movements = balance change.
- Recargas, reversals and adjustments never appear in sales; PIKAS Cash sales never
  appear in register cash.
- Midnight and timezone boundary tests pass, using stored business dates; the UI never
  shows UTC.
- Every non-authorized role, foreign tenant and sandbox POV is denied server-side.
  Being connected to a school grants no cafeteria sales visibility.
- No POS behavior changes. Blind count is preserved, and no cashier-visible money total
  is added.
- Money display uses `MoneyValue` intents and canonical terms; meaning is never
  color-only.
- Empty and edge states in §17 render as specified at 390/768/1440 px with no overflow.
- Focused regression of touched reads (5A operations route/read). Frozen financial
  suites are rerun only if a slice touches their functions, which none should.

## 27. Explicitly deferred work

- Phase 5E platform analytics (§21) and Platform Admin support access.
- Charts, trends, comparisons, historical balance at a date, multi-cafeteria and
  account-wide sales roll-ups.
- Register and staff filters, staff performance, supervisor oversight view.
- Cashier difference after close; any POS change.
- Financial CSV export (unless D9).
- Dashboard "Hoy" launchpads (F07/F10), Actividad redesign, and the remaining UX audit
  waves.
- Staff-credit refunds, receivable reporting beyond register cash settlements.
- Schema gaps:
  - G1: ledger business-date snapshot;
  - G2: unit allocation for legacy refunds;
  - G4: hardcoded display timezone.

  These are documented and handled by labeling, not by migrations that rewrite history.
- Gaps G3 (index) and G5 (product naming) are resolved inside their slices.
