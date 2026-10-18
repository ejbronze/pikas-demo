# PIKAS — Cross-role UX/UI Audit (pre-Phase 5D)

**Status:** analysis only. Nothing in this document has been implemented. Every
recommendation needs owner review before any redesign work starts
(analysis → owner review → controlled redesign).

## 1. Executive summary

PIKAS's core financial flows work and are safe. Their safety mechanisms are good UX
assets and should stay: exact-retry recovery, explicit confirmations, correction
guidance, and signed wallet movements. The friction comes from **structure, not
correctness**:

- **Dashboards are passive.** No role has a launchpad for its frequent tasks. The
  School dashboard even says wallet administration is "not available", which is now
  untrue.
- **Important capabilities are hard or impossible to find.** The accepted cafeteria
  PIKAS Cash lookup and scoped adjustment page is **not linked from any navigation**.
  Refunds need a receipt number with no recent-sales list. Register state is split
  between POS and admin.
- **Checkout's final steps are weaker than the rest of the POS.** The tender is never
  preselected, the cash button is small and outlined, the change and commit button
  fall below the fold on a 1440×900 screen, and an always-visible header action can
  pull the cashier out of a payment.
- **The wallet page competes with itself.** Balance, a permanent replenishment form,
  correction actions and a dense audit-heavy history share one long column
  (2,127 px desktop, 2,533 px mobile).
- **Session expiry is silent.** An admin lands on a plain login with no explanation,
  the original task is lost, and the in-page "session ended" screen is unstyled and
  unbranded.
- **There are three different admin shells** (School, Cafeteria, Platform), plus
  inconsistent financial semantics and terminology ("Saldo PIKAS", "PIKAS Cash",
  "monedero"; "Recarga" / "Reposición") outside the surfaces changed in 5C.

**No P0 findings.** No observed state is ambiguous about whether money moved. Every
financial commitment is explicit and recoverable.

Totals: **0 P0 · 13 P1 · 12 P2 · 5 P3** (30 findings).

The most important pre-5D conclusion: **decide the information architecture for
"today's activity" and role dashboards, the financial money semantics and the
terminology before building 5D reporting**, so reports are not built on the current
passive dashboards and inconsistent money language.

## 2. Scope and method

- **Running product, local only.** An isolated `next build` / `next start` production
  build against the local Supabase `pikas-4d6` environment, with one dedicated
  fictional tenant ("Colegio Ficticio Auditoría UX"). It had six local users (Platform
  Admin, Account Admin, School Admin, Cafeteria Admin, POS Supervisor, cashier), three
  students, three products, two registers, one open session, and modest wallet, sales,
  reversal and adjustment history. No production access, no production data.
- **Navigation.** Real sign-ins and page navigation with Playwright. Screenshots,
  visible-action inventories and page heights were captured at **1440 px and 390 px**
  for all School and Cafeteria Admin surfaces, at 1440 px for Platform, and step by
  step for the cashier's cash checkout (1440 px), PIKAS Cash checkout (390 px),
  register tab and refund flow.
- **Session states.** The timeout warning and expiry were reproduced by aging the local
  application-session timestamp.
- **Local data created for the audit:** two UI checkouts (one completed cash sale; one
  PIKAS Cash checkout interrupted before commit, so not charged). No refunds were
  completed.
- **Source inspection** was used only where the UI couldn't establish behavior:
  navigation coverage, session-ended markup, login error mapping, and the existence of
  a spending-limit UI.
- **Not fully exercised (stated, not assumed):**
  - Platform client list and team pages failed to load in this local environment
    ("No pudimos cargar la información"). Their layout was reviewed, their behavior was
    not.
  - Sandbox POV needs the sandbox-operator role and was not entered. It is assessed
    from earlier phases: sandbox banner present, financial actions excluded.
  - POS Supervisor uses the same POS. Supervisor-specific direct refunds come from the
    5C.1 evidence.
  - Contrast and screen-reader behavior need dedicated testing (§10).
- **Interaction counts** are meaningful task interactions (a choice, field
  completion, a commit), not keystrokes.

## 3. Cross-product findings (themes)

1. **Dashboards don't launch tasks.** Counts plus one or two gateway links, and no
   operational state such as today's sales, open registers, expected cash or recent
   activity.
2. **Navigation mirrors system structure.** For example "Cafeterías conectadas"
   (sharing configuration) versus "Escuelas conectadas" (an unlinked page that hosts
   cafeteria wallets); Cajas (configuration) versus Caja (operation); Transacciones
   in two places with different capabilities.
3. **Permanent forms on view pages:** the wallet replenishment form and the register
   close form dominate screens that are mainly for looking at state.
4. **Action hierarchy is inconsistent:**
   - primary actions rendered as underlined text links ("Recibo #3",
     "Caja Principal · Abierta", "Volver a clientes");
   - logout styled as a primary button next to the main action;
   - disabled controls with no reason;
   - native `window.confirm` dialogs for some money commitments, branded modals for
     others.
5. **Financial semantics exist only on the 5C.3-changed surfaces** (wallet history and
   cafeteria balance list). Transactions, receipts, register history, refunds and POS
   balances use neutral, unsigned money.
6. **Technical or roadmap language leaks into the UI:** "Auth", "Persona", "RLS",
   `pos_cashier`, "Datos comprometidos", "Controles pendientes",
   "se conectarán en los siguientes pasos".
7. **Recovery is strong once inside a flow, weak around the session boundary**
   (silent expiry, lost destination, unbranded ended state).

## 4. Role-by-role findings

**Platform Admin.** Comes to PIKAS to onboard and support customers. The dashboard is
two cards and an empty activity list (passive but adequate for a low-frequency role).
It is a third, different shell: top nav, centred column, no sidebar. Client detail is
read-only, with roadmap copy. List and team pages couldn't be verified locally. No
wallet authority, which is correct.

**Account Admin.** Comes to manage the customer's schools, administrators and money
corrections. It sees exactly the School Admin experience, labelled "Administración
escolar". Its account-wide scope is shown only by the school switcher. It has one
extra capability, cafeteria administrator delegation, inside "Cafeterías
conectadas". It has no account-level landing.

**School Admin.** Comes to manage students, wallets and administrators. The landing
page has no money and no quick actions, and says wallets "no están disponibles en
esta sección". Students are the hub, but the list starts below four stacked
full-width filters and an export panel. The wallet is three levels deep
(Resumen → Estudiantes → "PIKAS Cash de {nombre}") and is a long single column.

**Cafeteria Admin.** Comes to run operations: catalog, staff, registers, sales,
settings. The dashboard has counts and three gateway buttons, with no sales or cash
today. **Customer PIKAS Cash balance and scoped adjustment are unreachable from
navigation.** Register expected cash appears only inside history cards. Transactions
have no filters, totals or refund state.

**POS Supervisor / cashier.** Comes to sell, refund and handle the register. The
cashier first lands on a technical "Conexión PIKAS Pilot" page and needs an extra
click. The sale flow is well staged: customer → products → payment → receipt. The
payment step has the problems in F02–F04. The "Transacciones" tab is permanently
disabled. The "Caja" tab shows only the opening float and the close form. Refunds
need the receipt number.

**Sandbox POV.** Not re-entered (see §2). Earlier evidence shows a persistent amber
sandbox banner and correctly hidden or disabled financial actions. No new findings.

## 5. Click-path analysis (summary; detail in Appendix)

| # | Task | Role | Current interactions / contexts | Main friction | Target |
|---|---|---|---|---|---|
| 1 | Make a sale | Cashier | 6 / 1 (+2 contexts at sign-in) | Pilot landing page; tender not preselected | 4–5 |
| 2 | Cash checkout | Cashier | 4 after cart | Cash not preselected; commit below fold | 2–3 |
| 3 | PIKAS Cash checkout | Cashier | 7 / 1 | Tender re-selected although student is chosen | 5–6 |
| 4 | Find recent transaction | Cashier | Not possible (tab disabled) | Dead tab | 1–2 |
| 4b | Find recent transaction | Cafeteria Admin | 1 / 1, no filter or search | No date/tender filters or totals | 1–2 |
| 5 | Refund recent sale | Cashier | 7 (+3 with override) / 1, receipt number must be known | No recent list; no refund from success screen | 4–5 from list |
| 6 | Find a student | School Admin | 2 / 2 | Filters dominate | 2 |
| 7 | View student wallet | School Admin | 3 / 3 (Resumen→Estudiantes→wallet) | No dashboard entry | 2 |
| 8 | Verified replenishment | School Admin | 3 + 4 (amount, ref/note, confirm, native confirm) / 3 | Permanent form; native dialog | contextual modal, 3–4 |
| 9 | Reverse replenishment | School Admin | 3 + scroll + 3 / 3 | Find the row in a long history | 3 from history |
| 10 | Administrative adjustment | School Admin | 3 + ~7 / 3 | Good guidance; dense dialog | similar |
| 10b | Administrative adjustment | Cafeteria Admin | URL only (not in nav) | **Unreachable** | 2–3 |
| 11 | Review wallet history | School Admin | 3 / 3 + long scroll | History below form; IDs inline | 2, scannable list |
| 12 | Open register | Cashier | Caja tab + 2–3 / 1 | Acceptable | same |
| 13 | Review current register state | Cashier | Caja tab: opening float only | No live summary (owner decision) | 1 |
| 13b | Review current register state | Cafeteria Admin | Cajas → scroll → history card (3) | Expected only in history | 1–2 |
| 14 | Close register | Cashier | Caja tab → count → close → native confirm (4) | Close dominates tab | 3–4 in focused modal |
| 15 | Today's sales/activity | Cafeteria Admin | Transacciones list, no totals | No "today" view anywhere | dashboard summary (5D) |
| 16 | Manage cashier/staff | Cafeteria Admin | Personal POS → Editar (2) | Fine | same |
| 17 | Student spending limits | School Admin | **No UI** (backend only) | Feature gap | owner decision |
| 18 | Cafeteria settings | Cafeteria Admin | Configuración (1) | Placeholder card | same |
| 19 | Switch context | Admins | select + "Cambiar" (2), page reload | Shown even with one option | 1 |
| 20 | Recover after expiry | All | Silent login → re-login → home → re-navigate (≈5–6) | No message; destination lost | 2 |

**Practical maximum depth:** frequent tasks (sell, refund, view or replenish a wallet,
register state) should be reachable in **≤ 2 navigation contexts from the role's
home**, with ≤ 1 for the cashier's top 3. Administrative configuration may stay at
depth 2–3.

## 6. Financial UX findings

- **Commitment clarity is good.** "Cobrar RD$ X", "Confirmar reembolso de RD$ X",
  "Registrar ajuste permanente de ±RD$ X" all name the amount, and all flows recover
  exactly. **Keep.**
- **The tender is not named in the final POS action** ("Cobrar RD$ 125.00") and the
  selected tender appears only as small "Seleccionado: Efectivo" text (F02).
- **Signed and colored money is limited to the 5C.3 surfaces** (F18):
  - Transactions list: neutral amounts.
  - Receipts: neutral.
  - Refunds: unsigned.
  - Register expected and difference: neutral; a negative difference was not observed
    in this audit and should be verified.
  - POS "Saldo PIKAS": neutral, including a negative balance.
- **Money vocabulary differs** ("Saldo PIKAS", "PIKAS Cash", "Saldo PIKAS Cash",
  "monedero"); see §11.
- **Uncertainty and recovery copy is correct but long** ("Resultado pendiente de
  confirmar… recupera el acceso y reintenta antes de editar"). It should stay
  explicit, but could be clearer about whether money moved.

## 7. Navigation / information architecture

- **Direction:** role home = **launchpad + today's state**; sections named by user task
  rather than data structure; one consistent admin shell (shared header, context
  switcher and logout placement) with role-specific navigation.
- **School/Account:** Resumen (launchpad) · Estudiantes (with wallet entry) ·
  Administradores · Cafeterías · Actividad. Wallet actions launched from the student
  row or a dashboard search, not three pages deep.
- **Cafeteria:** add a navigable home for customer balances ("PIKAS Cash" or
  "Clientes"); merge the register operational view (Cajas) with live session state;
  give Transacciones filters and refund state.
- **POS:** remove the dead "Transacciones" tab or make it the recent-sales list
  (refund entry); keep Venta / Reembolsos / Caja.
- **Platform:** acceptable for a low-frequency role; align shell styling only.
- **Context:** the school/cafeteria/register context is visible in headers (good). On
  mobile it costs ~180 px per page (F13).

## 8. Modal vs. page opportunities

| Workflow | Recommended pattern | Why |
|---|---|---|
| Cash/PIKAS payment | Focused payment step or modal over the cart (total → tender → received → change → commit) | Keeps commit and change visible; reduces scrolling |
| Verified replenishment | Contextual modal from wallet summary ("Recargar") | Removes the permanent form; consistent with reversal and adjustment |
| Refund | Keep modal; launch from a recent-sales list or a receipt | Discovery, not modal design, is the issue |
| Replenishment reversal | Keep modal (works well) | — |
| Administrative adjustment | Keep guided modal; tighten hierarchy (F22) | — |
| Register close | Focused modal from a live register summary | The close shouldn't dominate the operational tab |
| Wallet history | Page section with progressive disclosure ("Ver detalles") | Too dense for a modal |
| Student/product/staff editing | Existing pages and dialogs | Not high-frequency transactional work |

## 9. Responsive / mobile findings

- **Admin header at 390 px** (switcher, "Cambiar", "Cerrar sesión") takes ~180 px on
  every page. The **POS sticky header** plus the "Acceso POS autorizado" bar take
  ~150 px.
- **Students at 390 px:** filters ~270 px before results. Each card stacks status,
  "PIKAS Cash de {nombre}" and "Ver perfil" on three rows.
- **Wallet at 390 px:** about 950 px of balance and form before the first movement.
- **5C.3 adjustment dialog at 390 px:** it scrolls inside its 92vh sheet and the action
  is reachable, but a full-page capture showed clipping at the viewport edge
  (production-acceptance evidence). The confirm label also wraps ("Registrar ajuste
  permanente de −RD$ 100.00").
- **POS payment at 1440×900:** the fixed status bar overlays the denomination buttons;
  the change and commit sit below the fold.
- No horizontal overflow was observed on any captured surface.

## 10. Accessibility observations

**Observed:**
- Several money actions use native `window.confirm`: wallet replenishment and register
  close. These are inconsistent with the labelled modals elsewhere.
- Disabled controls give no reason: "Imprimir recibo", "Editar" (open register),
  "Transacciones" tab, "Buscar usuario PIKAS" after a sale, and both customer buttons
  while the POS loads.
- On the wallet page the student name is not a heading (only "PIKAS Cash" is), so the
  page has no strong subject in the heading outline.
- The "Revertida" status relies mostly on amber color plus text (acceptable);
  movement amounts have explicit signs (good).
- The session warning dialog's heading is not visually distinguished from its body,
  and its copy says "2 minutos" while the countdown shows other values.
- Positives: focus moves to "Continuar sesión" in the warning dialog. Refund,
  reversal and adjustment dialogs use `role="dialog"`, `aria-modal` and labelled
  fields.

**Needs deeper testing (not concluded here):** full keyboard traversal and
focus-return in every modal, screen-reader announcements of uncertainty/recovery
messages, color contrast of the teal cafeteria sidebar and greyed disabled buttons,
touch-target sizes for denomination and quantity controls.

## 11. Terminology / microcopy

**Proposed rules:**
1. **One name for the student's money:** *PIKAS Cash* (balance: "Saldo PIKAS Cash").
   Retire "Saldo PIKAS" and "monedero" in UI labels.
2. **One name for a verified credit:** *Recarga* (already in production). Avoid
   introducing "Reposición".
3. **Name events by what happened:** Recarga, Compra, Reembolso, Reversión de recarga,
   Ajuste administrativo.
4. **No system or roadmap terms in UI:** "Auth", "Persona", "RLS", role codes,
   "Datos comprometidos", "Controles pendientes", "siguientes pasos".
5. **Commit buttons name the action, amount and tender:** "Cobrar RD$ 125.00 en
   efectivo".

**High-value changes:**
- the POS landing page;
- the "Datos comprometidos" notes;
- the stale School dashboard wallet sentence;
- "1 sesiones de caja abiertas" (grammar);
- the static "2 minutos" timeout copy;
- the `school_authority` login error with no message.

## 12. Prioritized findings register

Each finding is listed as: ID — severity — role — surface. **Biz** means it would
change financial or business logic. **OD** marks a decision needed from the owner
(§15).

**F01 — P1 — Cafeteria Admin — Escuelas conectadas.** The cafeteria PIKAS Cash balance
lookup and the 5C.3 scoped adjustment live on `/admin/cafeteria/escuelas`, which no
navigation or link reaches.
- *Impact:* accepted functionality is effectively unavailable.
- *Recommendation:* add a navigable home for it (for example "PIKAS Cash" or
  "Clientes"), also linked from the dashboard.
- *Scope:* Small. *Biz:* No.

**F02 — P1 — Cashier — POS payment.** The tender is never preselected (even No
Usuario, where cash is the only option). "Efectivo" is a small outlined button,
"Cobrar" stays grey and a warning appears until a tender is chosen. Confirms the owner
concern.
- *Recommendation:* large tender cards; default cash when it is the only valid tender;
  commit label names the tender.
- *Scope:* Medium. *Biz:* No (defaulting a student's tender: OD3).

**F03 — P1 — Cashier — POS payment.** On a 1440×900 screen, after choosing cash, the
change and "Cobrar" fall below the fold and the fixed status bar overlays the
denomination buttons.
- *Recommendation:* focused payment step or modal with total, received and change
  pinned next to the commit.
- *Scope:* Medium. *Biz:* No.

**F04 — P1 — Cashier — POS header.** "Buscar usuario PIKAS" stays active during payment.
One click leaves the payment step for the customer search (observed). The cart is kept,
but the commit context is lost.
- *Recommendation:* hide or disable global customer actions while a payment is in
  progress, or confirm before leaving.
- *Scope:* Small. *Biz:* No.

**F05 — P1 — Cashier / Supervisor — Refunds.** A refund needs the receipt number. The
POS "Transacciones" tab is permanently disabled, the "Compra completada" screen has no
refund action, and admin Transacciones has none either.
- *Recommendation:* turn POS "Transacciones" into a recent-sales list (today, this
  register) with a "Reembolsar" action; keep receipt search.
- *Scope:* Medium. *Biz:* No. Admin-initiated refunds would be Biz (OD2).

**F06 — P1 — All admins — Session expiry.**
- Expired admin pages redirect to `/login?error=school_authority`, which shows no
  message.
- The in-page "Tu sesión se cerró" screen is an unstyled `<main>` with plain links, and
  it offers "Acceso de Plataforma" to tenant users.
- After re-login the user lands on their home page, not their task.

*Recommendation:* a branded ended-session screen; a login message explaining expiry;
return to the original task. *Scope:* Medium. *Biz:* No, but returning to the original
destination touches session/redirect security (OD6).

**F07 — P1 — School, Account, Cafeteria — Dashboards.** Passive dashboards (counts plus
one to three gateway links). The School dashboard states wallets are unavailable; the
Cafeteria dashboard has no sales or cash for today.
- *Recommendation:* role launchpads with today's state and quick actions (§13).
- *Scope:* Medium. *Biz:* No. *Dependency:* the 5D data model.

**F08 — P1 — School / Account — Wallet page.** One long column: balance, permanent
replenishment form, correction action, history (2,127 / 2,533 px). The history starts
below the fold.
- *Recommendation:* compact summary with [Recargar] [Corregir saldo]
  [Ver movimientos], replenishment as a modal, history first.
- *Scope:* Medium. *Biz:* No.

**F09 — P1 — Cashier / Cafeteria Admin — Register state.** The POS "Caja" tab shows
only the opening float and the close form. Admin expected cash is visible only inside
history cards.
- *Recommendation:* a live register summary (opening float, cash sales, cash refunds,
  expected cash, status) with close as a secondary action. Whether cashiers see
  expected cash is OD1.
- *Scope:* Medium. *Biz:* the visibility policy is OD1.

**F10 — P1 — Cafeteria / School — Today's activity.** No role has a "today" view.
Transacciones has no filters, totals or refund state; School "Actividad" excludes
financial events.
- *Recommendation:* define the reporting/activity information architecture before 5D
  (OD7).
- *Scope:* Large (5D). *Biz:* No.

**F11 — P1 — Cashier / Supervisor — Sign-in.** POS staff land on "Conexión PIKAS
Pilot", which explains Auth, Persona and RLS, shows raw role codes, and requires an
extra "Entrar al POS" click; "Cerrar sesión" is styled as primary.
- *Recommendation:* route POS-only staff straight to POS, or make the page a branded
  role chooser.
- *Scope:* Small. *Biz:* No.

**F12 — P1 — Admins (mobile) — Headers.** At 390 px the admin header takes ~180 px and
the POS sticky header ~150 px on every screen.
- *Recommendation:* compact mobile header (context in a menu, logout in the account
  menu).
- *Scope:* Small/Medium. *Biz:* No.

**F13 — P1 — Cafeteria Admin — Transacciones.** No search, date or tender filters, no
totals, no refunded/partially-refunded status, and IDs shown inline.
- *Recommendation:* filters, refund state, details on demand. Coordinate with 5D.
- *Scope:* Medium. *Biz:* No.

**F14 — P2 — Three shells — All admins.** School (navy sidebar, logout in header),
Cafeteria (teal sidebar, logout at the bottom of the sidebar), Platform (top nav,
centred).
- *Recommendation:* one admin shell with role-colour accents.
- *Scope:* Medium. *Biz:* No.

**F15 — P2 — School Admin — Students list.** Four full-width stacked filters plus an
export panel come before results (list starts ~700 px on desktop). Long per-row label
"PIKAS Cash de {nombre}".
- *Recommendation:* inline filter bar, export in an overflow menu, short "PIKAS Cash"
  row action.
- *Scope:* Small. *Biz:* No.

**F16 — P2 — School / Account — Wallet history.** The primary timeline shows UUIDs,
"Revierte la recarga {uuid}", long notes, before/after balances.
- *Recommendation:* progressive disclosure: type, signed amount, time, actor and
  status in the row; "Ver detalles" for IDs, references, notes and balances.
- *Scope:* Small/Medium. *Biz:* No (audit data unchanged, only presentation).

**F17 — P2 — School Admin / Cashier — Confirmations.** Native `window.confirm` for
replenishment and register close.
- *Recommendation:* branded confirmation inside the contextual modal.
- *Scope:* Small. *Biz:* No.

**F18 — P2 — All — Money semantics.** Signed, colored money appears only on the 5C.3
surfaces. Transactions, receipts, refunds, register and POS balances are neutral.
- *Recommendation:* a shared money component and tokens (additive green "+",
  deductive red "−", negative balance red, neutral otherwise, never color-only).
  Adopt before 5D.
- *Scope:* Medium. *Biz:* No.

**F19 — P2 — All — Terminology.** "Saldo PIKAS", "PIKAS Cash", "monedero";
"Transacciones" vs. "Movimientos"; system jargon (§11).
- *Recommendation:* terminology rules (§11), adopted before 5D.
- *Scope:* Small. *Biz:* No.

**F20 — P2 — Admins — Placeholder copy.** "Controles pendientes",
"se conectarán en los siguientes pasos", and the stale School dashboard sentence about
wallets.
- *Recommendation:* remove or replace with accurate copy.
- *Scope:* Small. *Biz:* No.

**F21 — P2 — All — Action hierarchy.**
- Underlined links carry primary navigation (Recibo, Caja · Abierta, Volver).
- Logout is styled as primary on the POS landing.
- Full-width secondary "Guardar límites" sits next to a primary "Guardar modo de
  servicio".
- Disabled controls give no reason.

*Recommendation:* a documented primary / secondary / tertiary / danger hierarchy;
disabled-reason hints. *Scope:* Medium. *Biz:* No.

**F22 — P2 — School / Cafeteria Admin — Correction dialog.** The purpose choices are
right, but the styling is uneven (two secondary, one primary), they don't say what
happens next, and the dialog is dense at 390 px (see §9).
- *Recommendation:* three equal choice cards that each state the outcome
  ("Reembolso desde el POS", "Revertir la recarga", "Ajuste administrativo").
- *Scope:* Small. *Biz:* No.

**F23 — P2 — Cashier — Refund modal.** Only numeric per-item fields; no "all" or
stepper; the disabled commit reads "RD$ 0.00".
- *Recommendation:* steppers plus "Reembolsar todo"; the commit appears once something
  is selected.
- *Scope:* Small. *Biz:* No.

**F24 — P2 — All admins — Session warning dialog.** Plain text, unstyled heading,
static "2 minutos" next to a live counter.
- *Recommendation:* branded dialog with the live time only.
- *Scope:* Small. *Biz:* No.

**F25 — P2 — Account Admin — Shell identity.** Labelled "Administración escolar",
identical to School Admin; account scope is implicit.
- *Recommendation:* show account context and an account-level landing.
- *Scope:* Medium. *Biz:* No.

**F26 — P3 — Admins — Context switcher.** Select plus a separate "Cambiar" button,
shown even when there is a single option.
- *Recommendation:* switch on selection; hide when there is one option.
- *Scope:* Small. *Biz:* No.

**F27 — P3 — Desktop — Layout.** Students and settings stretch inputs full-width;
POS payment and refunds sit in a narrow centred column with large unused sides; the
wallet is single-column.
- *Recommendation:* purposeful two-column layouts (for example wallet summary +
  history; POS cart + payment).
- *Scope:* Medium. *Biz:* No.

**F28 — P3 — School Admin — Spending limits.** No connected UI exists; the backend RPC
does.
- *Recommendation:* decide whether to include it (OD5).
- *Scope:* Medium. *Biz:* feature scope.

**F29 — P3 — Platform — Dashboard.** Passive, with an empty activity card.
- *Recommendation:* low priority; align with the shell (F14).
- *Scope:* Small. *Biz:* No.

**F30 — P3 — Cashier — Post-sale.** "Imprimir recibo" disabled without explanation;
"Nueva transacción" is clear.
- *Recommendation:* explain printing availability.
- *Scope:* Small. *Biz:* No.

## 13. Recommended UX direction

- **Role launchpads:**
  - Cashier: Nueva venta · Reembolsos (recent sales) · Caja.
  - Cafeteria Admin: Hoy (sales, cash, open registers) · Transacciones · Cajas ·
    PIKAS Cash de clientes · Productos · Personal.
  - School/Account Admin: buscar estudiante (with direct wallet actions) ·
    Estudiantes · Administradores · Actividad.
  - Platform: Clientes · Nuevo cliente.
- **Contextual workflows:** money actions as focused modals launched beside the state
  they change; view pages stay views.
- **Progressive disclosure:** scannable rows with "Ver detalles" for audit evidence.
- **A shared money language and terminology,** adopted before 5D.
- **One admin shell** and a compact mobile header.
- **Keep:** the POS step structure, denomination shortcuts, change calculation,
  recovery and retry semantics, correction-purpose guidance, cumulative refund state,
  and the sandbox banner.

## 14. Proposed implementation waves

- **Wave A — Pre-5D foundations (no business logic).**
  - F18 money component and tokens; F19/F20 terminology and placeholder copy.
  - F01 cafeteria PIKAS Cash navigation; F21 action hierarchy rules.
  - Decide the F07/F10 launchpad and "today" information architecture (OD7).
  - *Why first:* 5D reporting will reuse money display, labels, navigation and
    dashboards.
- **Wave B — High-frequency task access.**
  - F05 recent sales and refund entry; F09 live register summary (after OD1).
  - F11 POS sign-in routing; F08 wallet summary with action buttons; F15 student list.
- **Wave C — Core transactional flows.**
  - F02/F03/F04 focused POS payment; F17 replace native confirms; F22/F23 dialog
    refinements.
- **Wave D — Session and recovery.**
  - F06 branded expiry with explanation and return to the task (after OD6); F24
    warning dialog.
- **Wave E — Shell, responsive, accessibility, polish.**
  - F12 compact mobile headers; F14 single shell; F16 history disclosure; F25–F27,
    F29, F30.
  - The deeper accessibility testing in §10.

**Before 5D:** Wave A, plus the F07/F10/F13 information-architecture decisions, so
reporting lands in the agreed launchpad and transaction views.

**Safe to defer until after 5D:** Waves C–E, and Wave B items independent of
reporting (F08, F11, F15). Discovery of the cafeteria balances (F01) is small and
should not wait.

## 15. Owner / product decisions required

- **OD1 — Register expected cash for cashiers.** Should cashiers see expected cash
  before counting (blind-count policy)? This affects F09.
  **OWNER / PRODUCT DECISION REQUIRED.**
- **OD2 — Refunds started outside the POS.** 5C.1 makes Cafeteria Admins approvers, not
  initiators. Any back-office refund entry needs a decision.
  **OWNER / PRODUCT DECISION REQUIRED.**
- **OD3 — Default tender for students.** Should PIKAS Cash be preselected when the
  student is eligible and has balance? (Defaulting to cash for No Usuario is UX only.)
- **OD4 — POS staff landing.** Route POS-only staff directly to POS? UX only; confirm.
- **OD5 — Spending-limit UI.** Should student spending limits get a connected UI, and
  in which milestone?
- **OD6 — Returning to the original page after re-authentication.** This touches
  session and redirect security. **OWNER / PRODUCT DECISION REQUIRED**, with a security
  review.
- **OD7 — Where reporting lives.** Dashboard "Hoy" vs. Transacciones vs. a new
  "Reportes" section, per role. Decide before 5D.
- **OD8 — Canonical terms.** Confirm *PIKAS Cash* and *Recarga* as the product terms
  (§11).

## 16. What should explicitly NOT change

- All Phase 5A/5B/5C financial rules, authority, accounting, audit requirements and
  session security (frozen).
- Explicit amount-bearing commitment actions, exact-retry recovery and "same request"
  language.
- The correction-purpose guidance concept, cumulative refund state, signed wallet
  movements, and the sandbox banner and financial exclusion.
- PIKAS brand identity (logo, navy palette); no brand replacement.
- The POS step structure (customer → products → payment → receipt) and denomination
  shortcuts.

## 17. Appendix — measured current journeys

- **J1 — Cash sale (cashier, signed in).** POS → "No Usuario" → product →
  "Continuar al pago" → "Efectivo" → amount (field or shortcut) → "Cobrar RD$ 125.00" →
  "Compra completada" (change RD$ 75.00). That is 6 interactions in 1 context. At
  1440×900 the commit needs a scroll after choosing cash.
- **J1a — Sign-in to POS.** Login → "Conexión PIKAS Pilot" → "Entrar al POS". That is
  3 contexts before selling.
- **J2 — PIKAS Cash sale.** "Usuario PIKAS" → name + "Buscar" → select student →
  product → "Continuar al pago" → "Saldo PIKAS" → "Cobrar". That is 7 interactions;
  the tender is not preselected for a student.
- **J3 — Refund.** "Reembolsos" → receipt number + "Buscar recibo" → "Reembolsar" →
  quantity → reason → "Confirmar reembolso de RD$ X". That is 6–7 interactions, plus
  approver email, password and "Autorizar" when an override is needed. The receipt
  number must be known.
- **J4 — Wallet (School Admin).** Resumen → Estudiantes → [search] →
  "PIKAS Cash de {nombre}" (3 contexts). Replenish: amount → reference/note →
  "Confirmar recarga verificada" → native confirm. Reverse: scroll history →
  "Revertir recarga" → reason → confirm. Adjust: "Corregir saldo" → purpose → direction
  → amount → reason → explanation → "Registrar ajuste permanente".
- **J5 — Register state (Cafeteria Admin).** Cajas → scroll to "Historial de caja" →
  open card ("Esperado RD$ 3,300.00 · Contado Pendiente · Diferencia Pendiente").
- **J6 — Register state (cashier).** "Caja" tab: "Caja abierta · Fondo inicial
  RD$ 3,000.00" plus the close form. No sales, refunds or expected cash.
- **J7 — Session expiry (School Admin on the wallet page).** Reload →
  `/login?error=school_authority` (no message) → sign-in → `/admin/escuela` →
  re-navigate (≈5–6 interactions).
- **J8 — Cafeteria balances.** Reachable only by typing
  `/admin/cafeteria/escuelas?cafeteria=…`.
