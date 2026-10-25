# PIKAS Reporting Consolidation

Implemented locally on 2026-10-24. It reconciles the paused UX10 checkpoint (`9af7801`) with the released product.
The checkpoint was used as source material and was never merged.

- **Migration:** `202611230001_platform_network_reports.sql`. It adds two read-only functions: no table, no snapshot
  and no new capability.
- **Tests:**
  - Database: `supabase/tests/platform_network_reports.test.sql`.
  - App: `app/platform/reportes/reportes.test.tsx`; additions to `lib/reports/reports-foundation.test.ts`,
    `app/admin/cafeteria/reportes/reportes.test.tsx`, `components/platform/cockpit.test.tsx` and
    `app/platform/demo-mode.test.tsx`.
- **Status:** not deployed.

## Principle

**Platform sees the network. School sees its students. Cafetería sees its business.** Every report reads through its
role's own function, and sharing the report *convention* (UX8: URL filters, report frame, CSV, print) never shares
authority.

## Information architecture

| Role | Where | Reports |
|---|---|---|
| Platform, `platform:customer:operations:read` | **Reportes** (`/platform/reportes`) | Clientes, Red y adopción |
| Platform, `platform:finance:read` | **Reportes** | Finanzas (resumen) |
| School Admin | Colegio · Reportes (unchanged) | Estudiantes, Cafeterías, PIKAS Cash |
| Cafetería Admin | Cafetería · Reportes (unchanged) | Ventas, Métodos de pago, Productos, Cajas y cierres, plus a link to **Liquidaciones** |

- **Where operational work happens:** Clientes (`/platform/clientes`, «Activos» by default) and the customer workspace
  remain the place to manage customers. Finanzas remains the place for transfers and settlement actions. Reports never
  repeat their controls: they link to them.
- **Navigation:** «Reportes» appears with either Platform capability.
- **Cockpit:** each figure on Inicio links to Reportes / Clientes filtered to exactly the customers it counts, using the
  same read and the same derivation. «Requiere atención» links to the attention filter.
- **Liquidaciones:** remain their own Cafetería workspace. Reportes only links to them, and every Cafetería report page
  now keeps the Liquidaciones navigation entry.

## Metric definitions

| Metric | Definition |
|---|---|
| Clientes / lifecycle | `accounts.tenant_kind = 'customer'` by status: active, suspended, closed. Inactive structure is reported as inactive, never "deleted" |
| Puesta en marcha | Released UX2 rules over `platform_customer_readiness`: configuring, ready (steps 1–6 complete), operating (≥1 real sale). Only active customers have a stage |
| Presencia | Colegios (active / other), sedes (active / inactive), cafeterías (active / suspended / inactive), cajas (active / inactive) |
| Cafetería en operación | Active cafetería in an active sede of an active colegio, for an active customer |
| Lista para operar | En operación, with ≥1 active caja that has active POS staff assigned and ≥1 available product. If it uses turnos, ≥1 enabled turno. **A first sale never makes it "ready".** |
| Servicio a estudiantes listo | The released UX13B rule: the colegio shares the cafetería with «Identificación básica» and has enabled ≥1 active student |
| Con ventas en el período | ≥1 confirmed purchase whose `business_date` falls in the period |
| Estudiantes atendidos | Distinct students with a purchase in the period, per cafetería |
| Activación financiera | Finance reporting only. Never mixed with readiness or adoption |

There is no adoption score. Each figure is shown with its own definition next to it. The Platform network report shows
counts, never sale amounts: amounts are the Cafetería's business.

## Demo and sandbox

- **Excluded by default.** Every Platform aggregate and export excludes sandbox customers (Colegio Horizonte).
- **«Incluir Demo».** When chosen (`demo=1`, never on by default):
  - Demo rows are tagged «Demo»;
  - a banner, the report scope line, the applied-filter list and the CSV («Demo» column, `-con-demo` filename) all
    say Demo is included;
  - Demo never counts as configuring, ready or operating.
- **Demo sessions.** A Demo POV is refused by both functions. Platform navigation in Demo shows only Demo Lab.
- **Finance:** finance reporting never includes sandbox.

## Finance boundary

- **Finance reporting** needs `platform:finance:read`; customer-operations authority never reveals finance, and vice
  versa.
- **What it summarises** (`platform_finance_report`):
  - financial activations (policy and fee rate);
  - replenishments credited in the period by method (gross, fee, net as recorded; the fee is never recalculated);
  - reversals;
  - settlements due or in review, with totals per direction (not netted across cafeterías), overdue and in review;
  - ready weeks;
  - obligations not yet settled.
- **Actions** (calculate, confirm payment, review) stay in **Finanzas · Liquidaciones**. Reportes only links there.
- **School** sees no settlement, obligation, clearing or Platform fee analytics; this was checked in the browser. The
  **Cafetería** reads its own settlements in Liquidaciones only.

## Timezone contract

- **Business dates are America/Santo_Domingo calendar dates.**
  - The database computes «Hoy», the 7- and 30-day periods and range checks from `pikas_private.report_clock()` in
    that zone.
  - Purchases are classified by their recorded `business_date`.
  - A custom range may not end after today or exceed 92 days.
- **Tested across the boundary.** At 21:30 AST (01:30 UTC the next day), «Hoy» is still the Santo Domingo date. In the
  browser, the reports and CSV ran at 20:3x AST (UTC already the next day) and showed and named the Santo Domingo date.
- **Fixed in this milestone:**
  - CSV filenames for every role, and the School student export, used the UTC date
    (`toISOString().slice(0, 10)`). They now use `businessDate()`.
  - The Cafetería «Métodos de pago» export had a corrupted filename.

## CSV

Each export route calls the **same functions with the same parsed filters** as its page, under the same capability.

- **Refused:** cross-site requests, signed-out users, the wrong capability (for example a finance-only viewer on
  Clientes, an operations viewer on Finanzas, or a School or Cafetería user on any Platform export), invalid filters,
  database refusals and truncated networks.
- **Content:** human identifiers (customer and code, colegio, sede, cafetería, receipt and reference). No internal UUIDs.
  Amounts are plain decimals.
- **Format:** the UX8 format (BOM, CRLF, formula protection).

## Performance

- Both reads are single bounded queries (≤200 customers, as the readiness read).
- Purchases are aggregated in the database for the period, using `business_date` with a timestamp window on the existing
  `(account, school, cafeteria, purchased_at)` index.
- Nothing aggregates transaction history in the browser.
- No report snapshots and no background jobs.

## What survived from paused UX10

- **Customer report logic:** the Clientes filters (q, status, readiness, step, attention), readiness-derived rows,
  launch counts and the Clientes layout (summary, bars, table).
- **Wiring:** the CSV route pattern, the Reportes landing card style, the navigation entry and the cockpit trace links
  to filtered Clientes.

## What was replaced and why

| UX10 piece | Decision | Why |
|---|---|---|
| `lib/platform/reports.ts` | ADAPT | Demo option, lifecycle counts, footprint and network/finance schemas added |
| `lib/platform/report-access.ts` | ADAPT | One capability per report (operations or finance); CSV helper takes the same reads as the page |
| `components/platform/report-views.tsx` | ADAPT / REBUILD | Clientes kept and extended; Red y adopción rebuilt |
| Red y adopción | REBUILD | Counted structure from the readiness read and treated «first sale» as adoption; now uses released operational readiness, UX13B student service and period activity, each defined separately |
| Clientes / Red pages and CSV | ADAPT | Demo option, footprint and period filters |
| Platform layout navigation | ADAPT | Shown with operations or finance read |
| Cockpit trace links, `.rpt-trace` style | KEEP | Unchanged meaning |
| UX10 tests | REBUILD | Replaced with tests for the current reads, Demo, finance and CSV boundaries |
| Finanzas (resumen) | NEW | Finance-authorised summary required by the released settlement architecture |

## Not changed

- No change to FIN2, FIN3, FIN4, settlement economics, activation, fees, obligations or settlement status.
- No new mutation or capability. No Pilot Hardening work.
- School and Cafetería report contents are unchanged, apart from the export date, the filename fix and the Liquidaciones
  link and navigation.
