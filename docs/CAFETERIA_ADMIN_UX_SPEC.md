# Cafeteria Admin UX — approved product direction

This document records approved product and interaction direction for the
Cafeteria Admin experience before implementation. It is not a description of
all currently implemented behavior and does not specify pixel-level visual
design.

## Product context

Cafeteria Admin is an operational workspace for running a school cafeteria. It
is not a school SIS, a PIKAS platform administration console, an accounting
ERP, or a full inventory-management suite.

The primary experience should help an administrator quickly answer:

1. How is the cafeteria doing today?
2. Does anything require attention?
3. What do I need to do now?

The pilot is Spanish-first. The tone should be light, friendly, calm,
trustworthy, operational, easy to scan, and touch-friendly. Normal UI should
use human language rather than role, scope, or database terminology. For
example, prefer “Cafetería Escolar · Colegio Horizonte” over
“Rol: cafeteria_admin / Alcance: cafeteria”.

## Information architecture

The current Cafeteria Admin navigation direction is:

- Inicio
- POS
- Estudiantes
- Productos
- Transacciones
- Reportes
- Personal
- Configuración

POS is a dedicated transaction workspace/mode, not simply another
administrative page inside the normal dashboard shell. Provide a prominent
“Abrir POS” action.

## Cross-cutting UX principles

1. Use space for decisions, not decoration.
2. iPad layouts should be dense enough for operational speed while preserving
   appropriate touch targets.
3. Prefer compact lists and tables over oversized cards when they improve
   scanning.
4. Desktop may use tables where appropriate.
5. On iPad portrait, prefer compact touch-friendly lists over horizontally
   scrolling desktop tables.
6. POS receives stricter iPad-first optimization than the administrative
   dashboard.
7. Dashboard metrics and actions should lead to meaningful filtered
   operational views where appropriate.
8. Completed financial history is immutable in the product UX. Correct it
   through auditable corrective operations such as refunds, not by editing
   historical transactions.
9. Do not conflate a preference, a purchase restriction, and an
   allergy/medical restriction.
10. Cafeteria Admin manages cafeteria operations but does not implicitly
    become the authoritative school registrar.
11. Avoid premature feature expansion, especially full inventory management.

## Inicio — approved V1 direction

### Header and context

- Friendly greeting.
- Cafeteria name and School name.
- Date.
- Prominent “Abrir POS” action.
- Reserved space for future cafeteria/context switching.

### Primary metrics

Keep these four concepts distinct:

- **Ventas:** cafeteria sales, not wallet replenishments.
- **Compras:** completed purchase count.
- **Recargas:** value added to student wallets; count may be secondary where
  useful.
- **Reembolsos:** refund count and value.

Do not promote average ticket to a primary V1 metric. Do not invent metrics
that cannot be reliably calculated from authoritative data.

### Operational content

- Simple sales/activity-by-time visualization.
- Top-selling products.
- Recent activity.
- “Requiere tu atención” for genuine operational exceptions and actions, not
  generic notifications.

Dashboard metrics and actionable summaries should deep-link to the relevant
operational screen with appropriate filters already applied where practical.
For example, selecting today’s Reembolsos should open Transacciones filtered
to today’s refunds rather than an unfiltered transaction list.

When nothing requires action, avoid a large empty alert section; a calm state
such as “Todo marcha bien” is appropriate. On narrower/iPad layouts, show
actionable attention items before lower-priority charts.

## Estudiantes — approved direction

### Roster

The default is a searchable operational student roster. Search concepts:

- Student name.
- Student ID.
- Grade/section where supported.

Search should eventually be forgiving of accents where practical. Prioritize
student, grade/section, wallet balance, and operational status.
Avoid unnecessary personal information.

On iPad portrait, use a compact list with full-row touch targets rather than
large student cards.

### Student profile V1

Sections:

- Resumen
- Compras
- Recargas
- Restricciones

Explain that wallet balance is not the same as spendable amount today. For
example:

```text
Saldo: RD$850
Límite diario: RD$300
Consumido hoy: RD$125
Disponible hoy: RD$175
```

When a purchase is blocked, explain the actual reason. Do not say “Saldo
insuficiente” when the actual issue is a daily spending limit.

Cafeteria Admin may work with cafeteria-related controls but should not
casually edit authoritative school identity/roster information, including
student name, school student ID, grade, section, or guardian relationship.
Manual cafeteria-admin student creation is not the default roster-provisioning
model at this stage. “Abrir en POS” from a student profile is a potential
later workflow and is not approved for implementation now.

## Productos — approved direction

Product management should feel like managing a cafeteria menu, not an ERP.
V1 concepts:

- Name.
- Category.
- Price.
- Availability.
- POS visibility.

Keep these concepts separate:

- **Disponible:** whether the product can currently be sold.
- **Visible en POS:** whether it should appear in the active POS catalog.

Quick availability changes should require little friction. Price changes
should be deliberate and save-based. Demo category examples may include
Comida, Meriendas, Bebidas, and Frutas; do not assume categories are globally
hard-coded. Product images are not required. Do not add full inventory
management.

Product management on iPad should use compact lists. POS product selection is
intentionally different and needs generous touch targets for repeated cashier
actions. Existing POS direction includes Popular, Frecuentes, Todos, category
filtering, and no duplicate products across prioritized Popular/Frecuentes
presentation according to existing product rules. Do not redesign POS in this
specification.

## Transacciones — approved direction

Transacciones is the cafeteria’s human-readable operational ledger. Use
“transacciones”, not banking-style “movimientos”, as the primary screen
language.

Primary transaction concepts:

- Compra
- Recarga
- Reembolso

The default screen should support search and filtering by date, type, status,
payment method, and, additionally, cashier/register. Search should support
human concepts such as student, student ID where appropriate, and receipt
number.

Do not show cafeteria sales as negative merely because a student wallet was
debited. Amount signs and semantics should follow the user’s context.

Completed financial transactions are not directly editable. Do not provide
normal edit actions to change a completed transaction’s amount,
student/customer, products/items, payment method, or other historical
financial facts. Corrections must use supported auditable corrective
operations, such as refunds, rather than rewriting the completed transaction.
Do not invent correction mechanisms that the backend does not support.

### Purchase detail

Present detail like a human receipt:

- Student/customer.
- Date/time.
- Receipt number.
- Items.
- Total.
- Payment method.
- Relevant before/after balance when wallet-based.
- Cashier and register.
- Status.
- Receipt/reprint action where supported.
- Refund action where permitted.

Technical identifiers should not dominate the normal experience.

### Refunds

Use a guided workflow and distinguish full from partial refunds. Partial
refund UX must account for item quantity and must never permit refunding more
quantity/value than remains refundable.

Before confirmation, state exactly where the refund goes when known. For
example: “RD$75 se devolverán al saldo PIKAS de Camila.” Avoid vague wording
such as “según el método correspondiente” when the destination is known.

Initial structured refund-reason direction:

- Producto no entregado
- Producto incorrecto
- Cobro duplicado
- Error en la venta
- Otro

If “Otro” is selected, require a note. Do not implement these reasons unless
the existing backend supports them; review the model and contract first.

Preserve refund lineage in an understandable history showing, for example,
Total original, Reembolsado, and Neto, together with the original purchase and
subsequent refund. A completed original purchase must not disappear or be
rewritten because it was refunded.

Do not overload transaction status with the refund relationship. Conceptually:

- Purchase: Estado = Completada; Reembolso = Parcial.
- Refund transaction: Estado = Completado.

Keep “void/anulación” separate from “refund/reembolso”. Do not implement void
behavior unless supported by the authoritative financial model.

### Non-user cash sales and iPad interaction

Support human-readable cash sales for non-registered customers without
creating a fake student. Example:

```text
Venta en efectivo
Cliente no registrado
RD$160
Caja 2 · María Santos
```

Preserve the existing PIKAS User vs Non-user POS direction.

On iPad, use compact transaction rows rather than large individual cards.
Keep search/filter controls easily accessible, ideally sticky where supported,
and make each row an appropriate touch target.

## Reportes — approved direction

Reportes is the cafeteria administrator’s analysis workspace. It should answer:

- What happened?
- When did it happen?
- What contributed to it?
- Where can I inspect the underlying activity?

Show the answer first, let interaction reveal the explanation, and keep the
underlying data one tap away. Make Reportes understandable to a non-technical
cafeteria manager while keeping detailed operational data accessible. Do not
equate making all data accessible with showing all data at once.

### Relationship to other screens

- **Inicio:** What is happening now, and does anything require action?
- **Reportes:** What happened over time, and what does it tell me?
- **Transacciones:** The actual financial events behind the numbers.

Where useful, Reportes should drill into appropriately filtered Transacciones
rather than duplicate the full transaction ledger.

### Global reporting context

Use one clear reporting context across Reportes sections. Initial period
options:

- Hoy
- 7 días
- 30 días
- Personalizado

Display a custom period’s selected date range clearly. Relevant optional
filters may include payment method, transaction type, cashier,
register/terminal, and product/category where useful and supported. Avoid a
large BI-style filter panel; use a compact “Más filtros” interaction where
appropriate and show active filters as removable chips.

Preserve the selected period and filters when moving among Reportes sections.
When drilling into Transacciones, carry relevant filters with the user.
Returning to Reportes should preserve the reporting context where practical.

An optional “Comparar con período anterior” may be offered without
overwhelming the default experience. Comparisons must use a clearly defined
equivalent previous period and must not be misleading.

### Primary summary and trend

The default Reportes experience should provide compact analytical summaries
such as Ventas, Compras, Ticket promedio, Recargas, and Reembolsos. Unlike
Inicio, Ticket promedio is appropriate here. These should not be oversized
dashboard cards. Make metrics interactive when meaningful and useful, such as
linking Compras to purchase transactions or Reembolsos to refunds for the
selected period. Do not calculate or display metrics unless authoritative
data supports them.

Provide a primary sales/activity-over-time visualization. Adapt granularity
sensibly to the period: hours for a single day where appropriate, days for
short or mid-range reporting, and sensible aggregation for longer ranges.
Charts must support tap on iPad, not depend on hover, and reveal persistent
contextual detail when a time point or period is selected rather than relying
only on a disappearing tooltip. Detail may include sales amount, purchase
count, average ticket, payment-method breakdown, and a link to underlying
filtered transactions when supported.

### Analytical areas

Provide a simple breakdown/navigation model within Reportes for Ventas,
Productos, Pagos y recargas, and Operación. These should feel like related
areas of one workspace and preserve the reporting context while switching
between them.

#### Ventas

Help answer how much was sold, how many purchases occurred, and when activity
was highest. Useful views may include sales over time, purchase count,
average ticket, and busiest periods. Busiest-period rows may show time period,
purchases, and sales. Selecting a period should provide access to the
underlying filtered transactions.

#### Productos

Help answer which products sell most by units, which generate the most sales
value, and which have little or no activity. Support the conceptual switch
“Por unidades” / “Por ventas” and make product rows interactive where useful.
Selecting a product may show a compact insight for the selected period,
including units sold, sales value, activity timing, percentage of purchases
containing the product only if reliably calculable from authoritative data,
and access to relevant underlying transactions.

“Productos con menor actividad” is acceptable; do not imply low activity
means a product is bad. Do not introduce inventory, stock, cost, margin,
reorder, or profitability analytics unless those capabilities and
authoritative data are explicitly supported in the future.

#### Pagos y recargas

Keep purchase payment analysis and wallet replenishment analysis clearly
separate. Purchase payment analysis may show values or shares for Saldo PIKAS,
Efectivo, and future supported payment methods; these describe how purchases
were paid. Present Recargas separately, with potential summaries such as
total value, count, average, and trend where supported.

Never add wallet replenishments to cafeteria sales. Explain the distinction:
a recarga adds value to a PIKAS wallet; a sale occurs when value is used to
purchase cafeteria products. A small explanatory affordance may help users
understand why these figures are separate.

#### Operación

Help administrators understand operational activity, potentially including
activity by cashier/staff, purchase count and sales processed, refunds, and
register/terminal activity where reliable data exists.

Do not turn staff reporting into an employee leaderboard or label a cashier
“best” or “top” based merely on transaction volume. Higher volume may reflect
shift assignment or lunch-rush coverage. Cashier/staff rows may drill into
corresponding filtered transactions.

### Refund analysis

Reportes may summarize refund count and value, and partial versus full refunds
where supported. If the authoritative backend eventually supports structured
refund reasons, Reportes may break refunds down by reason. Selecting a refund
metric or reason should lead to corresponding filtered transactions.

Do not imply structured reason analytics exist until the backend/model
supports them. Do not invent reconciliation/discrepancy analytics before
reviewing the authoritative financial/reconciliation model.

### Progressive disclosure and states

Preserve the interaction pattern:

**Overview → breakdown → detail → source transaction(s)**

Basic reporting information should not require navigating through many
screens, but the initial screen should not contain every possible field,
chart, and table. Make meaningful numbers, rows, chart selections, products,
payment methods, cashiers, and refund summaries interactive where that helps
users understand the source data.

Distinguish zero from unavailable data. Examples:

- No refunds: “Sin reembolsos” / “No se registraron reembolsos durante este
  período.”
- No product sales: “Sin ventas en este período.”
- No activity: “Todavía no hay actividad para mostrar.” / “Intenta seleccionar
  otro período.”

If a value cannot be calculated reliably because required data is
unavailable, do not silently display zero.

### Export

Reserve a simple “Exportar” interaction for potential concepts such as
Resumen del reporte, Transacciones, and Productos. Exports should respect the
selected period and relevant filters. Before implementation, inspect existing
PIKAS CSV/reporting functionality and reuse existing authoritative
functionality rather than creating a second export/reporting architecture.
Do not lock CSV versus Excel details beyond what current supported
functionality justifies.

### iPad and responsive behavior

Keep Reportes useful on iPad: charts must support tap rather than hover-only
interaction; use compact responsive data presentation and practical row touch
targets; avoid giant cards and enormous desktop tables that require horizontal
scrolling; and keep filters accessible while navigating or scrolling where
practical. Preserve useful information density without clutter.

### Student analytics boundary

Do not add student-spending rankings or “highest spending students” analytics
to V1 Reportes. Individual student purchase history belongs in the student’s
operational profile; aggregate cafeteria performance belongs in Reportes.

## Screens deferred

This specification records no screen-level design for Personal or
Configuración beyond their presence in the navigation direction.

## Decisions requiring backend/model review

Before implementing affected behavior, check the authoritative contracts for:

- Reliable definitions and sources for Inicio metrics and attention items.
- Student available-today calculations and reason-specific purchase blocks.
- Distinct product availability and POS visibility state.
- Refund-by-item quantity and remaining refundable quantities; the existing
  financial documentation describes partial refunds by amount and leaves
  returned-item allocation pending.
- Structured refund reasons and the required note for “Otro”.
- Exact refund destination and lineage information exposed to the UI.
- Non-user cash-sale representation without a fake student.
- Reportes sales/reporting metric definitions and average-ticket calculation.
- Period-comparison semantics and time-based aggregation.
- Payment-method, recharge, and product-level reporting.
- Cashier/register attribution and partial/full refund reporting.
- Structured refund-reason analytics.
- Existing CSV/export capabilities before designing export behavior.
- Reconciliation/discrepancy reporting before exposing it.

Do not imply support in the UI for a concept the authoritative backend does
not represent.

## Design fidelity and exclusions

Wireframes and examples discussed with this direction express information
architecture and interaction guidance, not pixel-perfect visual
specifications. Do not lock arbitrary colors, dimensions, component
libraries, or styling that has not been approved. Preserve room for visual
design refinement.

This document records product direction only and does not authorize
implementation. It does not authorize UI or API changes, schema changes,
demo students/products/transactions, POS changes, Google OAuth, or Oscar
onboarding.
