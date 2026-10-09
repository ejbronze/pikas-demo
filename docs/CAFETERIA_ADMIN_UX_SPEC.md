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

## Personal — approved direction

Personal is the cafeteria administrator’s operational access-management
workspace. It should answer:

- Who currently has access to this cafeteria?
- What operational role does each person have?
- Can this person currently use their authorized PIKAS functions?

Personal manages PIKAS access and cafeteria operational responsibility, not
employment records. It is not an HR system, employee directory, scheduling or
payroll system, or employee-performance leaderboard.

### Human-facing access concepts

Do not expose internal authorization architecture in the normal UI. Users
should not need to understand or see Auth Identity, Person or Membership
records, membership scopes, capability codes, UUIDs, provisioning intents, or
internal role codes such as `pos_cashier` or `pos_supervisor`.

Use human-facing language such as Cajero/Cajera, Supervisor/Supervisora, and
Administrador/Administradora de cafetería. The authoritative Auth Identity →
Person → Membership architecture remains important internally but should not
create unnecessary UI complexity.

### Main roster and status

Keep the main screen simple and operational. Suggested direction:

- Personal
- “Administra quién puede trabajar en esta cafetería.”
- Buscar personal
- Agregar personal

Compact filters may include Todos, Cajeros, Supervisores, and Inactivos. These
are examples, not locked labels or layout.

Roster entries should prioritize the person’s name, human-facing role,
operational access status, and recent activity context where reliable and
useful. Do not make email a primary field unless needed to disambiguate. Do
not foreground transaction counts in a way that turns Personal into employee
performance monitoring.

Prefer precise access language such as Acceso activo and Acceso desactivado.
Use Invitación pendiente only if an authoritative invitation workflow exists.
A status must reflect actual authoritative access state, not inferred
employee presence. Do not imply En turno, currently working, or currently at
a register without authoritative shift/session semantics.

### Person detail

Keep the detail view focused and conceptually organize it into:

1. **Acceso:** human-facing role, cafeteria, access status, and email/account
   identifier where useful.
2. **Actividad en PIKAS:** recent/last activity where reliably supported,
   relevant transactions processed by the person, and other operational
   activity only where authoritative data supports it.
3. **Historial de acceso:** access granted, activated/deactivated, role
   changed, and who performed access-management actions where supported.

Keep operational transaction activity separate from access/security history.
Do not expose internal audit implementation details unnecessarily.

### Role hierarchy and responsibilities

Use this conceptual hierarchy:

- **Cajero/Cajera:** transaction execution.
- **Supervisor/Supervisora:** transaction execution plus explicitly
  authorized shift-level interventions.
- **Administrador/Administradora de cafetería:** management of the cafeteria
  operation and personnel access.

Do not turn Supervisor into a second Cafeteria Admin.

A Cajero is primarily responsible for selling quickly and safely. Potential
functions, subject to authoritative capability/model review, include using
POS; searching/selecting students; seeing information required for permitted
sales, including relevant balance, available-today, and restriction
information; managing the active cart; processing supported wallet purchases
and cash sales; handling cash tender/change; completing supported non-user
cash sales; viewing a just-processed receipt; reprinting where permitted; and
accessing limited recent transaction context needed for immediate POS
recovery.

A Cajero should not automatically receive authority to change prices or
administer the catalog, change student limits/restrictions, manage personnel,
access broad cafeteria reporting, change cafeteria configuration, edit
completed historical financial transactions, or perform broad refund or
financial corrective actions. Do not imply any cashier action exists until
authoritative backend and permission support is verified.

A Supervisor is a POS operator with elevated shift-level authority. Potential
interventions, subject to backend/financial/permission review, may include
authorized refund workflows, transaction review for active operational
issues, additional receipt-history/reprint authority, explicitly supported
POS exceptions, and temporary product availability changes where authorized.
Do not treat these as implemented capabilities until the authoritative model
is reviewed. Temporary product sellability/availability is distinct from
editing catalog data such as product name or price.

A Supervisor should not automatically receive product/catalog administration,
price management, personnel management, cafeteria configuration, broad
administrative reporting, or unrestricted historical financial authority.

### Student safeguards and override boundary

Supervisor status does not inherently override student daily spending
limits, purchase restrictions, allergy/safety restrictions, or other enforced
student safeguards and financial controls. Do not create a generic
“Supervisor override” that bypasses a transaction control.

If PIKAS later supports a specific override, its type and authorization must
be explicit; capture a reason where appropriate; make the action auditable;
and require backend/policy support. Do not infer override authority from the
Supervisor role.

### Cafeteria Admin

The Cafeteria Admin owns management of the cafeteria operation. Conceptually,
where supported, this includes personnel access; assigning Cajero/Supervisor
roles; activating/deactivating operational access; product/catalog and price
management; cafeteria-specific student operational controls where policy
permits; authorized transaction/refund workflows; reporting; and cafeteria
configuration. The exact capability set remains subject to authoritative
backend/model review.

### Adding personnel and assigning roles

Make the desired UX simpler than the underlying identity architecture:

1. Ask for email first.
2. Resolve whether the person already exists in PIKAS.
3. If an existing identity/person is found, show that person and allow
   assignment of the appropriate cafeteria role.
4. Collect additional identity/onboarding information only when the person
   is genuinely new and the authoritative workflow requires it.

Do not ask an administrator to re-enter a name unnecessarily when an existing
authoritative Person can be resolved. This helps prevent duplicate
identities/Person records.

The eventual UX may explain that an existing person already has a PIKAS
account and allow cafeteria access assignment. For a new person, explain the
onboarding state in human language and collect only required information,
using an authoritative invitation/onboarding flow if one exists. Do not imply
email invitation or account provisioning is currently supported. Inspect
existing identity-provisioning, identity-linking, and membership-management
architecture before implementation; do not create a parallel identity
system.

When assigning or changing a role, show a concise human-facing permission
preview. For elevated roles such as Supervisor, explain the additional
authority and show only verified supported capabilities. Do not expose raw
capability codes or promise refund authority, availability controls, or other
elevated actions before backend/model review.

Changing Cajero ↔ Supervisor should be a deliberate access-management action.
Preserve an audit trail where supported and do not assume exact session
refresh behavior until authentication/session behavior is reviewed.

### Deactivation, self-access, and historical integrity

Prefer deactivation over deletion. Explain in confirmation that the person
will lose the relevant operational access while historical transactions and
audit history remain intact. Do not delete a Person because cafeteria access
is removed.

Changing current access must never rewrite historical financial attribution.
A transaction processed by María Santos must remain attributed to María
Santos after deactivation, role change, or removal of current cafeteria
access. Preserve relevant audit history as well.

Cafeteria administrators may appear in Personal so the roster accurately
shows who has access, for example:

```text
Edwin Jaquez
Administrador de cafetería · Acceso activo
Tú
```

Do not apply Cajero/Supervisor editing controls to the current cafeteria
administrator or allow accidental self-demotion through normal staff-role
controls. Do not assume all administrator memberships can be freely disabled.
If policy requires retained administrative access, prevent changes that
would leave the cafeteria in an invalid administrative state. Full
administrator succession is outside this direction.

### iPad and responsive behavior

Keep Personal easy to operate on iPad. Prefer compact touch-friendly roster
rows over giant cards. A portrait row may show name, role, access status,
useful recent activity context, and a row-navigation affordance. Use
whole-row tap targets where appropriate, avoid desktop tables that require
awkward horizontal scrolling, and preserve useful information density without
making controls too small for touch.

## Screens deferred

This specification records no screen-level design for Configuración beyond
its presence in the navigation direction.

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
- Current authoritative behavior and authorized callers of
  `set_cafeteria_pos_membership`; supported role codes and scope behavior; and
  whether Cafeteria Admin can manage POS roles through existing authorized
  wiring.
- Existing-person lookup/resolution, Auth Identity → Person linking rules,
  and duplicate identity/Person protections.
- New-user invitation/onboarding support, if any; activation/deactivation
  and role-change semantics; and session/cache behavior after access changes.
- Cashier and Supervisor capabilities actually enforced, including refund
  authorization by role, receipt/reprint authorization, temporary product
  availability authorization, and transaction-history visibility.
- Student-limit/restriction enforcement and any explicit override mechanism.
- Audit support for access creation, deactivation, reactivation, and role
  changes; and preservation of historical cashier/operator attribution.
- Self-demotion and final Cafeteria Admin constraints, and the reliable
  definition of “last activity” before exposing it.

Do not imply support in the UI for a concept the authoritative backend does
not represent.

Classify future implementation needs as already supported, requiring UI/API
wiring, or requiring backend/model work. Do not silently broaden existing
permissions to make the desired UX work.

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
