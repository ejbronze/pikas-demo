# PIKAS reporting foundation (UX 8)

Status: implemented locally for School Reportes. Platform and Cafetería reports are future work and
should follow these conventions. The conventions are shared; reads, RPCs, capabilities and data are not.

## Model

Dashboard → Report → Record.

- **Dashboard** answers "what is happening / what needs attention?"
- **Report** answers "why, and what makes up this number?"
- **Record** shows the underlying authorized records, and lets the user act where authorized.

A report reads as summary → visualization (only when it answers a question) → detail → output.

## Audit (October 2026)

| Area | What exists | Notes |
| --- | --- | --- |
| Platform | Customers list with URL filters (`q`, `status`, `kind`, `after`) parsed by zod on the server; cockpit KPIs link to sections. | No report pages, CSV or print yet. |
| School | Estudiantes roster with URL filters (`q`, `status`, `location`, `grade`, `after`); filtered student CSV (`school_student_export`, full result, at most 1,000 rows, never truncated). | Before UX 8, the 5D.5 PIKAS Cash period report was a client component fetching `POST /api/school/wallet-report`, with its filter state in React only. Activity is the last ≤100 audit events, with no date range or paging. |
| Cafetería | Reportes (sales summary, top products, reconciliation) and Transacciones (paged list, filters), both with periods Hoy / 7 / 30 / Personalizado (≤ 92 days). Cafetería Hoy has CSS bar and line charts and links to `/reportes` and `/cajas`. | Filter state is client-only, so no URL deep links. The only print is POS receipt printing. There is no PDF stack. |

Reusable as found:
- the period vocabulary and the 92-day guard (`lib/cafeteria/reports.ts`);
- spreadsheet-safe CSV cells;
- server-side reduction before props;
- `DataList`;
- `MoneyValue`;
- the roster and Platform URL-filter pattern.

## Conventions

**Filter state lives in the URL.** It is parsed on the server, and invalid values give an error, never a wider report.
- Use the report's own filter names, and reuse the operational page's names where they exist. School Estudiantes uses `status`, `location` and `grade`.
- Time-based reports use `period=today|last_7_days|last_30_days|custom`, plus `from`/`to` (ISO dates) for `custom`.
- Non-time reports take no date filter.
- Helpers: `parsePeriod` and `reportHref` (`apps/web/lib/reports/filters.ts`).

**Header** (`ReportHeader`): report name, scope (school / cafetería / network), purpose, active filters as labelled chips, the generated date (shown in print), and the output actions.

**Summary** (`ReportSummary`): a few figures, computed from the same filtered rows as the detail.

**Visualization** (`BarList`):
- Comparisons use horizontal bars, with every value written out.
- A bar links to the report filtered to that group only when that filter exists.
- No time series is drawn from period aggregates.

**Detail** (`ReportTable`): a real table on screen and in print, with labelled cards below 640 px. It never shows internal UUIDs.

**Print:** browser print. With `.rpt` on the page, the print stylesheet hides:
- the shell sidebar, top bar and mobile bar;
- filter forms and period controls (`data-print="hide"`);
- output actions.

It keeps the title, scope, filters and generated date, and tables keep their header row.

**Export:** CSV via `GET <report>/csv` with the same query string as the report.
- The route and the page call the same loader, so the export equals the report: the full filtered result, never a page of it.
- Cross-site requests are refused (`Sec-Fetch-Site`).
- Amounts are plain signed decimals.
- XLSX/PDF can be added later as further output actions without changing reports.

**Drill-down** (`TraceLink`): a dashboard figure links to the report filtered to exactly that figure. Wire one only when the report uses the same read and filter, so the numbers reconcile.

## Authority

Each role's report reads only through that role's existing reads and capabilities. There is no generic reporting permission.

**School:**

| Report | Read | Capability |
| --- | --- | --- |
| Estudiantes | `school_student_export` | `school:students:read` |
| PIKAS Cash | `school_wallet_report` | `school:wallets:read`; also hidden from the sandbox POV |
| Cafeterías conectadas | `school_admin_read('cafeterias')` | `school:sharing:read` |

The School never receives cafetería commercial data, per-cafetería spending, products or per-student purchases.

## Future compatibility

**Cafetería:** Ventas, Métodos de pago, Productos, Cajas, Reconciliación, Reembolsos, and later Recargas/Settlement.
- These map onto `cafeteria_report_read` and the transactions read, with the same period parameters, plus `tender`, `status`, `register` and `receipt`.
- Drill-down example: a Cafetería Hoy KPI → `/admin/cafeteria/reportes/ventas?cafeteria=…&period=today`.
- Moving today's client-state reports to URL state is the first step.

**Platform:** Clientes, Adopción, Readiness, Schools, Cafeterías, wallet adoption, operations, transaction volume, financials and audit.
- These would use Platform reads under `platform:*` capabilities and the existing `status`/`kind` parameters.
- Drill-down example: a cockpit KPI → `/platform/reportes/clientes?status=…`.

## Deferred School reports

- **Administración y accesos:** the current read gives present state only (memberships and invitations), which the Administradores page already shows in full. There is no access history to report on.
- **Actividad:** the read returns at most the 100 latest events, with no date range or paging. A truthful report needs a paginated, date-ranged audit read, which means a migration.
