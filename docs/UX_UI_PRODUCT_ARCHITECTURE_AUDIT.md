# PIKAS — Holistic UX/UI Product Architecture Audit (post-5D.3)

**Status:** the original audit is owner-approved historical evidence. UX Foundation B
is implemented locally (implementation record in §23 below). Findings and measurements
in §§1–22 describe the audited baseline; they are not a new audit. Waves C–F remain
pending. No SQL, migrations, RLS or deployment changed in Foundation B.

**Baseline:** Phase 5D.3 local checkpoint `7d51a13e`.

**Relationship to earlier work:**
- This builds on the [pre-5D UX/UI audit](UX_UI_AUDIT_PRE_PHASE_5D.md) (findings
  F01–F30, owner decisions OD1–OD8) and the binding rules in
  [UX_FOUNDATIONS.md](UX_FOUNDATIONS.md). It does not repeat them.
- Earlier findings are referenced by their **F-number**. A finding re-observed here
  carries both IDs (for example `H07 / F03`).
- The [Phase 5D plan](PHASE_5D_REPORTING_PLAN.md) and its owner decisions D1–D13 remain
  authoritative for reporting.

---

## 1. Executive summary

**Overall assessment.** Every individual workflow is safe and mostly correct. Money is
never ambiguous, authority is server-derived, and recovery semantics are strong.

PIKAS does **not yet feel like one product**. It feels like four applications that share
a logo:
- **Platform:** top-nav shell, called "PIKAS Platform" and "PIKAS Backoffice".
- **School:** navy sidebar, called "PIKAS ADMIN".
- **Cafeteria:** teal sidebar, called "PIKAS Admin".
- **POS:** task workspace, entered through a technical "Conexión PIKAS Pilot" page.

Each has its own header, logout placement, dialog behavior and sandbox indicator. The
same fact is presented differently in different places. For example, a register
over-count reads "Diferencia RD$ 25.00" in Cajas but "Sobrante +RD$ 25.00" in Reportes.

**The Demo problem is real and mostly a UI problem.**
- Demonstrating School → Cafeteria → POS → School took **16 interactions and 13 page
  loads** in the running build.
- Each switch goes through the launcher, then a forced "Salir de demostración", then
  "Entrar como…", then "Abrir…".
- The launcher **hides every other persona while one is active**.
- After a switch, any other open tab falls silently to `/login?error=school_authority`.
  It looks like a logout although the operator is still signed in.
- Inside a demo, the tenant shell still offers **"Cerrar sesión"**, which ends the
  operator's PIKAS Admin session. The POS offers a different exit ("Volver a
  Backoffice") that lands on the platform home and leaves the POV active.

**Key architectural finding: persistent switching needs no new database authority.**
- `platform_enter_sandbox_pov` already supersedes the operator's active POV atomically,
  under the operator's advisory lock, with an audit row (`end_reason = 'superseded'`).
- The current UI never exposes this, because it insists on an explicit exit first.
- The smallest safe change is one same-origin route that accepts **only an allowlisted
  experience code**. It resolves account and cafeteria server-side from the registered
  sandbox targets and calls the existing RPC. There is no SQL change and no client
  persona or tenant ID.

**Findings:** 0 P0 · 14 P1 · 16 P2 · 5 P3 (35 findings, §15).
- 17 carry forward earlier findings that are still open. That includes F03, F04, F05,
  F06 and F11, which the owner already addressed with decisions but which were never
  implemented.
- 18 are new, concentrated in the demo workspace, cross-surface consistency, dialog
  accessibility and platform entry.

**Recommendation:** five small waves (§19). UX Foundation B delivers the Demo
environment, the persona switcher, the demo exit and the two or three primitives they
need. The shell, task windows, POS and polish follow in separate, independently
reviewable milestones. No wave changes financial rules.

## 2. Product UX principles

These extend [UX_FOUNDATIONS.md](UX_FOUNDATIONS.md); they do not replace it.

1. **One product, role-specific content.**
   - One admin shell, one page-header pattern, one dialog behavior and one sandbox
     indicator.
   - Roles differ in navigation items and accent color only.
2. **Home launches work.**
   - Each role's home shows today's state and its 3–4 most frequent tasks.
   - A counts-only dashboard is not a home.
3. **View pages stay views.**
   - Changing money or configuration happens in a focused task window opened beside the
     state it changes, never in a permanent form on a reading page.
4. **One fact, one presentation.**
   - A balance, movement, difference or status renders through the same primitive
     everywhere (`MoneyValue`, `StatusBadge`), with the same words.
5. **The user always knows where they are, who they are acting as, and how to get
   back.**
   - This matters most in Demo: real operator, effective persona and sandbox state are
     always visible and never ambiguous.
6. **Interruption is normal; replay is not.**
   - Non-financial work may be resumed.
   - Financial submissions are never replayed automatically (§11).
7. **Mobile is a first-class admin device for review and light tasks.** POS remains
   tablet/desktop-first, but must stay usable at 390 px.
8. **Never color alone; never jargon.** No Auth, Persona, RLS, role codes, Backoffice,
   POV or "Datos comprometidos" in tenant-facing UI.

## 3. Demo workflow diagnosis

### 3.1 What exists today (inspected in code and in the running build)

| Piece | Current behavior |
| --- | --- |
| Platform nav | "Inicio · Clientes · Crear cliente · Equipo de PIKAS · Demostración". A sandbox operator sees only "Inicio · Demostración". |
| Launcher `/platform/demostracion` | With no active POV: one card per registered target, in database order (Cafetería, Cajero, Escolar). Each card repeats "Colegio Horizonte / Cafetería Escolar" and duplicates the role ("Administrador de cafetería · Demo Horizonte · Administrador de cafetería"). With an active POV: **only** the active card ("Abrir administración / Abrir POS", "Salir de demostración"). The other personas are hidden. |
| Enter | `POST /api/platform/sandbox-pov/enter {accountId, cafeteriaId, povCode}` → `platform_enter_sandbox_pov`. The server validates a sandbox tenant and a registered active persona. **It supersedes any active POV** for the operator under the actor advisory lock and writes audit. Expiry is 4 h. |
| Exit | `POST /api/platform/sandbox-pov/exit` → `platform_exit_sandbox_pov`. Errors if no POV is active. |
| In-tenant indicator (admin) | `SandboxAdminContext`, an amber panel inside the sticky header: "Modo demostración · {rol}", "Operador … · Vence: {fecha con segundos}", "Volver a demostración / cambiar experiencia", "Salir de demostración". **Plus** a second strip from the school/cafeteria shell: "DEMO / SANDBOX · {escuela} · Datos de prueba". The shell's own "Cerrar sesión" remains. |
| In-tenant indicator (POS) | A different banner, "Modo demostración · Sandbox · José Ramírez · Cajero", plus a header link "Volver a Backoffice" (to `/platform`, POV stays active) and "Salir" (logout). |
| Server POV model | The real operator stays the authenticated identity. The persona comes from `pikas_private.sandbox_pov_personas`. Commands capture the POV before any lock and revalidate it (`revalidate_sandbox_admin_command`). The admin POV capability allowlist excludes financial reads. `current_person_id` is never rewritten. |

### 3.2 Measured journey: School → Cafeteria → POS → School (1440 px)

| Leg | Interactions | Page loads | Path |
| --- | --- | --- | --- |
| Platform home → School | 3 | 3 | Demostración → Entrar como Administrador escolar → Abrir administración |
| School → Cafeteria | 4 | 3 | Volver a demostración / cambiar experiencia → Salir de demostración → Entrar como Administrador de cafetería → Abrir administración |
| Cafeteria → POS | 4 | 3 | (same pattern) → Abrir POS |
| POS → School | 5 | 4 | Volver a Backoffice (→ `/platform`, not Demo) → Demostración → Salir → Entrar → Abrir |
| **Total** | **16** | **13** | |

The audit trail confirms the cost: five POV sessions, every one `exited`, none
`superseded`. The supersede path exists but is unused.

### 3.3 Problems

1. **Switching is an exit/enter ritual** (H01). The persona model is a server fact; the
   UI forces a manual teardown the server does not require.
2. **No persistent environment.** Once inside a persona, the only way to see the other
   personas is to leave.
3. **Three different "leave" actions with different meanings** (H03):
   - "Volver a demostración / cambiar experiencia": POV stays active.
   - "Salir de demostración": ends the POV and returns to the launcher.
   - "Volver a Backoffice": goes to the platform home, POV still active.

   Next to them sit two logout buttons that end the **operator's** session.
4. **Stale tabs fail as fake logouts** (H02). A tab opened as School shows the plain
   login page after a switch to Cajero.
5. **Mobile cost** (H04). At 390 px the demo admin header is a 181–215 px sticky block,
   with ~430 px of chrome before the page title. The POS sandbox header is 247 px of an
   844 px screen.
6. **Copy** (H20, H21). The persona name repeats the role, tenant lines repeat on every
   card, the expiry is an absolute timestamp with seconds, and "sandbox" / "Backoffice"
   / "POV" vocabulary appears.

## 4. Proposed Demo environment architecture

### 4.1 Concept

**Demo is an environment owned by the PIKAS Admin session.**
- The operator stays signed in as themselves (Edwin/Oscar) throughout.
- Inside the environment exactly one **effective persona** is active at a time.
- Switching replaces the persona.
- "Salir del demo" ends the persona and returns to the Demo workspace.
- Only "Cerrar sesión" (in the PIKAS Admin account menu) signs the operator out.

### 4.2 Smallest safe architecture

**Server: no SQL, no RLS, no new capability.**

1. **Reuse** `platform_enter_sandbox_pov`. Its supersede behavior *is* the switch: one
   transaction, the actor advisory lock, the previous POV marked `superseded`, a new
   4-hour POV, and platform audit.
2. **Add one same-origin route**, `POST /api/platform/sandbox-pov/switch`:
   - Body: `{ "povCode": "school_admin" | "cafeteria_admin" | "cashier" }`. Strict Zod;
     no other field. An `Idempotency-Key` like the existing routes.
   - It requires `platform:sandbox:pov:enter` through the existing
     `createPlatformRpcPostHandler`.
   - Server-side, it calls `platform_list_sandbox_pov_targets` and selects the target for
     that code:
     - while a POV is active, within the active POV's sandbox account;
     - otherwise, the only registered environment.
   - It then calls `platform_enter_sandbox_pov` with those **server-resolved** IDs.
   - If zero or several targets match, it rejects (`sandbox_pov_not_available` /
     `sandbox_environment_ambiguous`). It never guesses.
   - **Result:** the client never sends a persona ID or a tenant ID. The database still
     validates persona, sandbox tenant and scope as today.
3. **Keep** `/enter` for the Demo workspace when several environments exist (§4.3), and
   keep `/exit` unchanged.
4. **Read for the shell:** `GET` the active POV plus available experience codes. This
   reuses `platform_get_active_sandbox_pov` and `platform_list_sandbox_pov_targets` and
   gives the persistent switcher its options. Read-only, no new RPC.

**Client: environment chrome only.**
- A `DemoEnvironmentBar` replaces both `SandboxAdminContext` and the shell's
  "DEMO / SANDBOX" strip, and the POS demo banner. One component, three shells.
- A `DemoPersonaSwitcher` (menu or bottom sheet) lists Escuela · Cafetería · Caja / POS
  (available), and Padre · Estudiante ("Próximamente", inert).
- On a switch request:
  1. Run local guards (§4.4).
  2. `POST /switch`.
  3. On authoritative success, hard-navigate (`location.assign`) to the persona's home
     from `sandboxDestination(...)`.
  4. On failure, stay put and show the error. A failed switch is never assumed to have
     happened.
- **Stale-tab handling.** When an admin/POS route fails authority while the operator
  still holds `platform:sandbox:pov:enter`, render a branded **"La demostración cambió"**
  page instead of redirecting to `/login`. It offers "Ir a {persona activa}" and "Volver
  a Demo".
  - This is a presentation branch on an existing denial: no authority is added.
  - It is gated on the server-derived platform identity, never on a client flag.

**Unchanged and enforced as today:**
- The real operator remains the authenticated identity; `current_person_id` is never
  globally rewritten.
- School POV → the registered fictional School Admin. Cafeteria POV → the registered
  fictional Cafeteria Admin. POS → José Ramírez, the registered cashier persona. Oscar
  never becomes a tenant cashier.
- Commands keep capturing and revalidating the POV. A switch during an in-flight command
  in another tab makes that command fail closed (`sandbox_admin_authority_changed`). It
  is never silently re-attributed.
- Sandbox data stays `tenant_kind = 'sandbox'`, excluded from customer reporting and
  5E. Normal tenant users never see Demo UI: the bar renders only from a server-derived
  active POV.
- No generic support impersonation: the switch route accepts three experience codes and
  nothing else.

### 4.3 Multiple environments (future)

The registry already keys personas by account and cafeteria. If more than one sandbox
environment is registered:
- the Demo workspace groups personas by environment;
- the switcher switches **within the current environment** only.

Changing environment happens in the Demo workspace.

### 4.4 Switch guards (client, before calling `/switch`)

| Situation | Behavior |
| --- | --- |
| Admin persona, nothing in progress | Switch immediately |
| Admin persona with an open task window holding unsaved non-financial input | "Tienes cambios sin guardar en {tarea}. ¿Cambiar de rol y descartarlos?" |
| Any persona with an **uncertain financial request** (POS checkout/refund/close recovery journal, admin close/recarga/adjustment pending recovery) | **Block** the switch: "Hay una operación pendiente de confirmar. Termina de recuperarla antes de cambiar de rol." Never switch past an unresolved financial request, and never replay it under another persona. |
| POS with a cart or payment in progress (nothing submitted) | "La venta en curso se descartará." Confirm, then discard the local cart. |
| POS with the sandbox register **open** and idle | Allow, with a note: "La caja de demostración seguirá abierta; podrás retomarla al volver a Caja / POS." The register is sandbox tenant data; leaving it open is legitimate and is recovered on return (observed: "La sesión existente se recuperó automáticamente"). |
| Persona unavailable (registry inactive, scope suspended) | Disabled item with reason "No disponible en este entorno". The server would reject regardless. |
| POV expired | Bar shows "Demo vencido"; switching re-enters (new POV). Same as today's expiry, but explained. |

### 4.5 Route behavior

- **Switch → persona home**, always:
  - School: `/admin/escuela?school=…`
  - Cafeteria: `/admin/cafeteria?cafeteria=…`
  - POS: `/pos`
- Mapping "the same page" across roles is not meaningful (Estudiantes has no cafeteria
  equivalent) and risks rendering a page outside the new persona's authority.
- **Optional, UI-only:** remember the last visited **path** per persona for the browser
  session. Offer it as a link ("Volver a Estudiantes"), never as an automatic redirect.
  Accept only allowlisted path prefixes for that persona. Store only the path and query
  scope IDs, which the server revalidates.
- **"Salir del demo"**: `POST /exit` → `/platform/demo`. If no POV is active
  (`sandbox_pov_not_active`), treat it as already exited.

## 5. Demo text wireframes

### 5.1 PIKAS Admin → Demo workspace (desktop, no active persona)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ PIKAS Admin        Inicio   Clientes   Equipo   [Demo]        Edwin ▾        │
├──────────────────────────────────────────────────────────────────────────────┤
│ Explorar PIKAS                                                               │
│ Entorno de demostración · Colegio Horizonte · datos ficticios, aislados de   │
│ los clientes. Tú sigues siendo Edwin; cada rol es una vista de prueba.       │
│                                                                              │
│ ADMINISTRACIÓN                                                               │
│ ┌──────────────────────────────┐  ┌──────────────────────────────┐           │
│ │ Escuela                      │  │ Cafetería                    │           │
│ │ Estudiantes, PIKAS Cash,     │  │ Productos, cajas, ventas y   │           │
│ │ administradores.             │  │ reportes de la cafetería.    │           │
│ │ [Entrar como Escuela]        │  │ [Entrar como Cafetería]      │           │
│ └──────────────────────────────┘  └──────────────────────────────┘           │
│ OPERACIONES                                                                  │
│ ┌──────────────────────────────┐                                             │
│ │ Caja / POS · José Ramírez    │                                             │
│ │ Vender, reembolsar y cerrar  │                                             │
│ │ caja.  [Entrar como Caja/POS]│                                             │
│ └──────────────────────────────┘                                             │
│ EXPERIENCIAS                                                                 │
│ ┌──────────────────────────────┐  ┌──────────────────────────────┐           │
│ │ Padre        Próximamente    │  │ Estudiante   Próximamente    │           │
│ │ Aún no disponible.           │  │ Aún no disponible.           │           │
│ └──────────────────────────────┘  └──────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────────────────┘
```

- The "Próximamente" cards are not buttons or links. They have no hover state, and are
  announced as plain text ("Padre, próximamente").
- The cards **must not** link to the legacy demo-mode `/familias` or `/estudiante`
  surfaces.

### 5.2 Inside the demo (desktop, admin persona)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▌DEMO  Colegio Horizonte · datos ficticios   Rol: [Escuela ▾]   Edwin   Salir del demo │  ← DemoEnvironmentBar (amber, 44px, sticky, above shell)
├──────────┬───────────────────────────────────────────────────────────────────┤
│ PIKAS    │ Colegio Horizonte · Administrador escolar (demo)                  │  ← normal shell header; no "Cerrar sesión" in demo
│ Admin    │                                                                   │
│ Resumen  │ Resumen de la escuela                                             │
│ Estud…   │ …                                                                 │
└──────────┴───────────────────────────────────────────────────────────────────┘

[Escuela ▾] opens:
┌───────────────────────────────┐
│ Cambiar de rol                │
│ ● Escuela          (actual)   │
│ ○ Cafetería                   │
│ ○ Caja / POS                  │
│ ─ Padre        Próximamente   │  (inert)
│ ─ Estudiante   Próximamente   │  (inert)
│ ───────────────────────────── │
│ Volver al espacio Demo        │
└───────────────────────────────┘
```

### 5.3 Inside the demo (mobile, 390 px)

```
┌──────────────────────────────────────┐
│ ▌DEMO · Escuela ▾          Salir     │  ← one 44px sticky line; replaces 3 stacked blocks
├──────────────────────────────────────┤
│ Colegio Horizonte            ☰       │  ← compact shell header (context + account in menu)
│ Resumen de la escuela                │
│ …                                    │
├──────────────────────────────────────┤
│ Resumen Estudiantes Admins Café Act. │  ← existing bottom nav
└──────────────────────────────────────┘

"Escuela ▾" opens a bottom sheet with the same list as §5.2 (44px rows).
```

### 5.4 POS in demo

```
┌──────────────────────────────────────────────────────────────┐
│ ▌DEMO · Caja / POS ▾ (José Ramírez)                Salir del demo │
├──────────────────────────────────────────────────────────────┤
│ PIKAS · Cafetería Escolar                José Ramírez         │  ← POS header keeps its task focus;
│ Venta  Transacciones  Reembolsos  Caja                        │     no "Volver a Backoffice", no logout
└──────────────────────────────────────────────────────────────┘
```

### 5.5 Switch flow

```
Inside Escuela → [Escuela ▾] → "Cafetería"
  → guards (§4.4) → POST /switch {povCode:"cafeteria_admin"} (busy: "Cambiando a Cafetería…")
  → success → location.assign(/admin/cafeteria?cafeteria=…) → bar shows "Cafetería"
  → failure → stay on Escuela, inline error in the switcher, nothing assumed
Total: 2 interactions, 1 page load (was 4 / 3).
```

## 6. Role-by-role audit (what changed or is newly observed)

Method and evidence are in §22.

**PIKAS Admin / Platform**
- **Sign-in:** platform staff who use the common `/login` get "No tienes acceso a una
  cuenta de PIKAS" (H05). Access requires knowing `/backoffice/login`, titled "PIKAS
  Backoffice". The landing calls itself "PIKAS Platform"; the tenant shells say "PIKAS
  Admin". There are three names for one staff surface.
- **Shell:** a top nav. "Crear cliente" is a nav item duplicating the Clientes action;
  "Equipo de PIKAS" is long; "Demostración" is last (H22).
- **Clientes and Equipo:**
  - Both render their error state locally ("No pudimos cargar la información", "No se
    pudo cargar el equipo"), as in the previous audit.
  - A direct call to `platform_team_read` returns valid JSON, so the failure is in the
    web contract or rendering against local data. Recorded as a defect candidate to
    verify, not as a production finding (H22).
- **Client detail:** read-only, with "Persona" / "siguientes pasos" copy (H24).
- **Provisioning:** a six-step wizard shown as a text trail ("Cliente → Escuela → …
  → Revisar") with an always-visible "Recuperar solicitud pendiente". Its server-side
  request recovery is good and should be the model for resumable non-financial tasks
  (H23).
- **Demo:** see §3.

**Account Admin**
- Lands on the school shell ("Resumen de la escuela") with no account-level identity or
  landing (F25 still open).
- Delegation lives inside "Cafeterías conectadas".

**School Admin**
- **Dashboard:** still says "Los indicadores financieros y la administración de
  monederos no están disponibles en esta sección". That is false, and uses the retired
  term "monederos" (H12 / F07, F20).
- **Students at 390 px:** four stacked filters, Buscar, Crear/Importar and an export
  panel before the first student. Results start around 940 px. Each row stacks three
  controls (H17 / F15).
- **Wallet:**
  - Permanent recarga form above the history.
  - Native `confirm()` for recarga: "¿Confirmar recarga manual verificada de RD$ 1.00?"
  - "Saldo PIKAS Cash" heading.
  - 2,289 px at 1440, 2,715 px at 390 (H13 / F08, F17).
- **Correction dialog:** no focus management (H11).
- **Crear estudiante:** a well-behaved three-step dialog. It is the best existing
  task-window pattern.

**Cafeteria Admin**
- **Dashboard:** counts plus three buttons; "1 sesiones de caja abiertas"; no Reportes or
  today's state (H12).
- **Cajas:**
  - Mixes register configuration with session history.
  - The history shows "Diferencia RD$ 25.00" (unsigned, no Sobrante/Faltante label)
    while Reportes shows "Sobrante +RD$ 25.00" for the same session (H14).
  - UUIDs inline; "Datos comprometidos" copy; "Editar" disabled on an open register with
    no reason.
- **Transacciones:** no filters (5D.4 pending), UUIDs inline, underlined "Recibo #n"
  links, "Datos comprometidos" (H25 / F13).
- **Reportes (5D):** coherent; 3,358 px at 390 (H35).
- **PIKAS Cash:** "Saldo PIKAS" text remains (H24).
- **Configuración:** "Controles pendientes" placeholder card (H24 / F20).

**POS / Cashier / Supervisor**
- Lands on "Conexión PIKAS Pilot" with "Auth", "Persona", "RLS", `pos_cashier`, and a
  primary-styled "Cerrar sesión" (H06 / F11; OD4 already decided).
- **Payment step (No Usuario, one item):**
  - "Método de pago · Sin seleccionar", consistent with locked decision 3: never
    preselect.
  - "Cobrar RD$ 50.00" disabled with a reason (good), but **below the fold at every
    width**: top 935/844 at 390, 1047/1024 at 768, 1013/900 at 1440 (H07 / F03).
- "Buscar usuario PIKAS" stays enabled during payment (H08 / F04).
- "Transacciones" tab permanently disabled; Reembolsos requires a receipt number
  (H09 / F05).
- **Caja tab:** opening float, close form, and a clear block reason during an active
  sale (good). Blind count preserved.
- Category chips and the gallery/list toggles are under 44 px (H27).

**Public / shared**
- Login at 1440 has **two `h1`s** (marketing panel and form) (H26).
- `/login?error=school_authority` shows no message (H10 / F06).
- The session-ended screen is unstyled, and links "Acceso de Plataforma" for every user
  (F06).
- The session warning still states a static "2 minutos" next to a live counter (F24).
- `/familias`, `/estudiante` and `/admin/login` redirect to login in connected mode.
  They are legacy demo-mode surfaces and must not be reused for "Próximamente" (H33).

## 7. End-to-end journey audit

**Column key:**
- **Steps:** meaningful interactions.
- **Loads:** page transitions.
- **Resume?** Whether progress can be safely resumed after interruption.
- **Clear outcome?** Whether the user knows what happened and what to do next.

Evidence types:
- **Measured:** this audit's browser runs.
- **Prior:** the pre-5D audit appendix, re-confirmed where marked.
- **Code:** the behavior is established in source and was not re-executed.

| # | Journey | Start | Steps / loads | Friction (context loss, labels, dead ends, page transitions) | Destructive-risk points | Resume? | Clear outcome / next step? | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Platform Admin creates/accesses a customer | `/login` (wrong entrance) → `/backoffice/login` → Inicio → Clientes / Crear cliente | 6-step wizard; ≈10 field groups | Wrong-entrance error; client list fails to load locally; text step trail; "Crear cliente" duplicated in nav | Final provisioning commit (explicit Revisar step) | **Yes**, server request recovery ("Recuperar solicitud pendiente") | Yes once inside; client detail is read-only with roadmap copy | Measured |
| 2 | Platform Admin enters Demo | Backoffice → Inicio | 3 / 3 | Launcher lists DB order, duplicated labels | None | n/a | Active card is clear | Measured |
| 3 | Demo School → Cafetería → POS → School | inside School | **13 / 10** (16 / 13 incl. entry) | Forced exit per switch; launcher hides personas; POS exit goes to `/platform`; stale tabs show login | Two logout buttons inside demo end the operator's session | Partial: POV persists, but no route memory | Weak: three different "leave" actions | Measured |
| 4 | School Admin finds a student | Resumen | 2 / 1 (Estudiantes → search) | 390 px: results at ≈940 px below filters/export | None | Filters are lost on navigation | Yes | Measured |
| 5 | School Admin reviews PIKAS Cash | Resumen | 3 / 3 (Resumen → Estudiantes → "PIKAS Cash de {nombre}") | No dashboard entry; history below a permanent form; UUIDs inline | None | n/a | Yes | Measured |
| 6 | School Admin performs a recarga | Wallet | 3 fields + button + **native confirm** | Native dialog breaks visual language; form always visible | Commit | Never auto-resume; exact retry is in place | Yes after success | Measured (dismissed, not committed) |
| 7 | Authorized admin corrects a balance | Wallet | ≈7 (purpose → direction → amount → reason → explanation → commit) | Good guidance; dialog without focus management (H11) | Commit | Never | Yes | Measured (opened, not committed) + 5C.3 |
| 8 | Cafeteria Admin finds a connected student | Nav → PIKAS Cash | 2 / 1 | "Saldo PIKAS" label | Adjustment (scoped) | n/a | Yes | Measured (page) + prior |
| 9 | Cafeteria Admin reviews transactions | Nav → Transacciones | 1 / 1 + paging | No filters, UUIDs, underlined links | None | Page offset lost on navigation | Partially (no totals here, by design: Reportes) | Measured |
| 10 | Cafeteria Admin reviews reports | Nav → Reportes | 1 / 1, period changes in place | Long on mobile (3,358 px) | None | Period lost on navigation | Yes | Measured (5D.3) |
| 11 | Cashier opens a register | Login → Pilot page → POS → Caja | 3 contexts before selling | Technical Pilot page | Opening float | Session recovered automatically | Yes | Measured + prior |
| 12 | Cashier finds a student | POS | 2–3 (Usuario PIKAS → name → select) | Fine | None | n/a | Yes | Prior |
| 13 | Cashier cash sale | POS | 6 / 1 | Commit below fold at all widths; tender not preselected (by decision) | Commit | Recovery journal; exact retry | Yes ("Compra completada", change) | Measured to payment; commit from prior |
| 14 | Cashier PIKAS Cash sale | POS | 7 / 1 | Tender re-selection; header search active during payment | Commit | Same | Yes | Prior + measured header |
| 15 | Cashier handles change | Payment | 1–2 (denomination or field) | Change below fold with commit | Commit | — | Yes | Prior |
| 16 | Authorized user discovers/refunds a sale | POS Reembolsos | 6–7 (+3 override) | **Receipt number must be known**; Transacciones tab dead | Commit | Exact retry | Yes | Measured (tab) + prior |
| 17 | Cashier closes register | POS Caja | 3–4 | Close form dominates the tab; blind count correct | Commit (permanent) | Exact retry; journal | Yes | Measured (view) + 5A |
| 18 | Admin reviews reconciliation | Reportes | 1 / 1 | Caja and Reportes disagree on difference presentation | None | n/a | Yes in Reportes; weaker in Cajas | Measured |
| 19 | Session expires during navigation | any admin page | ≈5–6 to recover | `school_authority` shows no message; unstyled ended screen; destination lost | None | **No** (OD6 pending security review) | No | Code (unchanged since prior audit) + prior |
| 20 | Interruption during a multi-step non-financial task | Crear estudiante / provisioning | — | Crear estudiante: closing loses input, no draft. Provisioning: server recovery | None | Provisioning yes; student no | Partially | Measured (dialog) + code |
| 21 | Mobile admin tasks | 390 px | — | 181–215 px sticky header (plus ≈250 px of demo chrome); bottom nav visible **above** modal scrim (H19); no overflow anywhere | Tapping nav mid-dialog discards input | No | Mostly | Measured |

## 8. Information architecture findings

| Role | Navigation today | Problems | Recommendation |
| --- | --- | --- | --- |
| PIKAS Admin | Inicio · Clientes · Crear cliente · Equipo de PIKAS · Demostración | Action in nav; long label; three product names; Demo last | **Inicio · Clientes · Equipo · Demo**. "Nuevo cliente" becomes the primary action on Clientes and Inicio. One name: **PIKAS Admin** (owner decision OD-B6). |
| Account Admin | School shell | No account identity | Account context in the shell header; landing "Tu cuenta" with schools and cafeterias (F25) |
| School Admin | Resumen · Estudiantes · Administradores · Cafeterías conectadas · Actividad | Wallet three levels deep; label "Cafeterías conectadas" is sharing configuration | Keep the labels. Add "Buscar estudiante" with direct PIKAS Cash actions on Resumen. "PIKAS Cash" row action without the student name. |
| Cafeteria Admin | Resumen · Productos · Menús · Personal POS · Cajas · Transacciones · Reportes · PIKAS Cash · Configuración (9) | 9 items; mobile shows 4 + "Más" with 5 hidden including Cajas, Transacciones and Reportes (the operational core) | Order by frequency: **Resumen · Transacciones · Cajas · Reportes · PIKAS Cash** \| Productos · Menús · Personal POS · Configuración (grouped "Catálogo y personal"). Mobile bottom nav: Resumen, Transacciones, Cajas, Reportes, Más. |
| POS | Venta · Transacciones (dead) · Reembolsos · Caja | Dead tab | Transacciones = today's sales on this register with "Reembolsar" (OD locked decision 2; depends on 5D.4 read) |

Cross-cutting IA rules:
- **Page titles match nav labels.** Exceptions today: the cafeteria home `h1` is the
  cafeteria name; Configuración renders "Configuración POS".
- **"Volver a …" is a header back link** with the parent's name, not a bordered button
  inside content. It is needed only on detail pages (wallet, client detail, session
  detail).
- **Breadcrumbs are not needed.** Hierarchy depth is at most 2; a back link plus the
  selected nav item is sufficient.
- **Context (school/cafeteria) is shown once,** in the header.
  - The switcher is hidden when there is one option (F26).
  - It switches on selection.
- **Actividad / Movimientos / Transacciones / Reportes** keep the UX Foundations
  distinction:
  - Cafeteria Transacciones gains filters in 5D.4.
  - Reportes stays analytical.
  - Cajas becomes "registers and their sessions"; it drops the history-as-only-place for
    expected cash, now that Reportes and the live summary exist.
- **Pages that should become task flows:**
  - recarga (wallet);
  - register close (admin exceptional close and POS close);
  - cashier refund from a recent sale;
  - Crear caja / Editar caja;
  - staff invitation.

  The wallet, Cajas and Transacciones stay views.

## 9. Task-flow inventory

**Presentations:**
- **TW-modal:** centered TaskWindow on desktop, full-height sheet on mobile.
- **TW-page:** focused task page with the shell chrome reduced.
- **Inline:** stays in place.

| Workflow | Current | Steps | Pain points | Recommended | Persist progress? | Scope | Close behavior | Resume | Final confirmation | Mobile | Financial / security |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Customer provisioning | Page wizard | 6 | Text trail; recovery button always shown | **TW-page** with `TaskStepper` | **Yes (A)** | Server request journal (exists) | Confirm if dirty | "Retomar solicitud pendiente" only when one exists | Revisar step, explicit "Crear cliente" | Full screen | Non-financial; keep request-key recovery |
| Crear estudiante | Dialog, 3 steps | 3 | Loses input on close | **TW-modal** (reference implementation) | Yes (A) | Browser session draft per school | Confirm if dirty | Offer "Continuar borrador" | Revisar y crear | Sheet | Non-financial; no money |
| Edit student / enrollment | Page/dialog | 1–2 | — | TW-modal | Yes (A) | Session draft | Confirm if dirty | Optional | Save | Sheet | — |
| Import students (CSV) | Page | 3 | Long | TW-page | UI state only (B) | In-memory | Confirm if file loaded | No (re-upload) | Explicit "Importar N" | Full screen | Bulk; server validation stays |
| Product create/edit | Dialog/page | 1–2 | — | TW-modal | Yes (A) | Session draft | Confirm if dirty | Optional | Save | Sheet | Price is catalog data, not money movement |
| Menús / turnos | Page | 1–3 | — | Inline + TW-modal for create | Yes (A) | Session draft | Confirm if dirty | Optional | Save | Sheet | — |
| Staff invite / edit / activation | Page + forms | 2–3 | — | TW-modal | Yes (A) | Session draft | Confirm if dirty | Optional | Send invitation | Sheet | Authority change: explicit confirm naming role and scope |
| Register create/edit (Cajas) | Page forms | 1–2 | Edit disabled without reason when open | TW-modal | Yes (A) | Session draft | Confirm if dirty | Optional | Save | Sheet | — |
| Cafeteria settings / refund limits | Page | 1 | Placeholder card; two primary-looking saves | Inline sections, one save per section | No | — | — | — | Save | — | Refund-limit policy is authority-relevant: confirm |
| School-cafeteria sharing | Page | 1–2 | Dense | Inline + TW-modal for scope changes | No | — | — | — | Confirm naming categories | Sheet | Data-sharing consent: explicit |
| **Recarga** | Permanent form + native confirm | 4 | Form dominates the view; native dialog | **TW-modal** "Recargar PIKAS Cash" (amount → reference/note → confirm) | **No (C)** | Pre-submit fields may live **in memory only** while open | Closing discards; no draft | Never auto-resume; exact retry keeps existing journal | Explicit "Confirmar recarga de RD$ X" inside the window | Sheet | Financial |
| Reversión de recarga | Dialog | 3 | Fine | TW-modal | No (C) | In memory | Discard | Never | Explicit | Sheet | Financial |
| Ajuste administrativo | Guided dialog | ≈7 | Focus management (H11); dense at 390 | TW-modal with `TaskStepper` (Propósito → Monto → Motivo → Confirmar) | No (C) | In memory | Discard | Never | Explicit, amount-bearing | Sheet | Financial |
| POS checkout | Steps in workspace | 4–7 | Commit below fold; header escape | **TW-page** payment step: total, tender, received, change and commit pinned | No (C) | Cart in memory (already); request journal for uncertainty | Leaving cart: confirm | Uncertain commit: existing journal, exact same key/payload, user-initiated | "Cobrar RD$ X en efectivo / con PIKAS Cash" | Pinned footer | Financial |
| POS refund | Receipt search + dialog | 6–7 | Discovery | Recent sales list → TW-modal | No (C) | In memory | Discard | Never | Explicit | Sheet | Financial; override credentials never stored |
| POS register close | Tab form | 3–4 | Dominates tab | TW-modal "Cerrar caja" | No (C) | In memory (count) | Discard | Journal only | Explicit, blind count preserved | Sheet | Financial; never show expected before count (OD1) |
| Admin exceptional close | Session detail form | 4 | Inside history detail | TW-modal from session row | No (C) | In memory | Discard | Journal only | Review → confirm (exists) | Sheet | Financial |
| Demo persona switch | Launcher ritual | 4 per switch | §3 | `DemoPersonaSwitcher` menu/sheet | UI state only (B): last path per persona | Browser session | — | Link, not auto | None (no data change) unless guards (§4.4) | Bottom sheet | Never cross an unresolved financial request |
| Report period / filters | Inline | 1–2 | Lost on navigation | Inline `FilterBar` | UI state (B) | URL query | — | Via URL | — | — | Read-only |
| Student list filters | Stacked fields | 4 | Space | Inline `FilterBar` | UI state (B) | URL query | — | Via URL | — | Collapsible | Read-only |

## 10. Save/resume classification

**A. Safe to save and resume (non-financial configuration and records)**
- Customer provisioning (server journal already), Crear/editar estudiante, product,
  menu/turno, register configuration, staff invitation drafts, longer administrative
  forms.
- **Storage:**
  - `sessionStorage`, scoped by real actor, effective persona (when in demo), tenant
    scope and task type;
  - or the existing server journal where one exists.
- **Rules:**
  - Cleared on successful submit, explicit discard, logout and **demo persona switch**.
  - Drafts never carry authority: the server revalidates everything on submit.

**B. Preserve UI state only**
- Report period, list filters and search terms, pagination, selected tab, expanded rows,
  the last route per demo persona.
- **Storage:** URL query where shareable; `sessionStorage` otherwise. No IDs that grant
  anything; all are revalidated by the server.

**C. Never auto-resume or replay financial submissions**
- Purchase commit, recarga, reversal, refund, wallet adjustment, register open/close,
  admin exceptional close, staff receivable settlement, and any future money movement.
- **Allowed:**
  - While the task window is open, typed but unsubmitted values may live **in component
    memory**. Closing the window, navigating away, switching persona or the session
    ending discards them.
  - The existing **recovery journals** (request key plus exact payload) remain the only
    persisted financial state. Their purpose is to resolve an **uncertain** submission
    by user-initiated retry of exactly the same key and payload.
- **Never:**
  - persist a financial form as a draft;
  - pre-fill a financial form from a previous session;
  - resubmit after login, refresh or persona switch;
  - change key or payload on retry.

## 11. Financial workflow safety rules (UX)

1. Every financial commit is a deliberate final action whose label names the action, the
   amount, and the tender or direction where relevant. For example: "Cobrar RD$ 125.00
   en efectivo", "Confirmar recarga de RD$ 500.00", "Registrar ajuste de −RD$ 100.00".
2. Confirmation lives inside the branded TaskWindow, never in native `confirm()` (F17).
3. A pending or uncertain request blocks:
   - editing of that task;
   - persona switching;
   - closing the task window without an explicit "Salir sin resolver" that **keeps** the
     recovery journal.
4. No automatic replay after any interruption: login, refresh, expiry, demo switch or
   tab change. Recovery is offered, explained ("No sabemos si se registró; reintenta la
   misma operación"), and user-initiated with the original key and payload.
5. Success shows the authoritative result (amount and resulting balance, receipt, closed
   session), not an optimistic local value.
6. Blind count is preserved:
   - no expected cash, running cash totals or derived amounts for cashiers before the
     count (OD1, D6);
   - after the count, nothing new (D8 deferred).
7. Tender is never preselected (locked decision 3). The commit stays disabled with a
   visible reason until a tender is chosen.
8. Sandbox financial actions remain excluded for admin POVs, per the frozen allowlist.
   Sandbox POS sales stay sandbox data.
9. Destructive and irreversible actions use the `danger` button tier and a sentence
   stating permanence ("Esto crea un registro permanente").

## 12. Visual-system findings

| Element | Observation | Direction |
| --- | --- | --- |
| Shells | Platform top nav (white); School navy sidebar ("PIKAS ADMIN"); Cafeteria teal sidebar ("PIKAS Admin" plus a subtitle); POS dark header. Logout is in the header for School, the sidebar bottom for Cafeteria, and the header for Platform/POS. Header heights at 1440: 71 / 85 px. | One `AdminShell` (§17) |
| Page headers | School uses an eyebrow ("ADMINISTRACIÓN ESCOLAR") plus `h1` plus a context line; Platform uses a small `h1` (`text-2xl`); Cafeteria home `h1` = cafeteria name; wallet has a bordered "Volver a estudiantes" button above the `h1` | `AppPageHeader` (eyebrow optional, `h1`, description, actions slot, back link) |
| Section headers | Mixed `h2` sizes; wallet student name rendered as `h2` under `h1` "PIKAS Cash" (subject inverted) | `SectionHeader`; the page subject is the `h1` ("Sol Auditoría · PIKAS Cash") |
| Cards / metrics | Dashboards and Reportes use similar but separately coded metric cards | `MetricCard` |
| Lists / tables | Almost everything is a card list; no tables even at 1440 (Transacciones, Cajas history, students). IDs shown inline. | `DataList` (cards on mobile, table rows ≥ 1024 px) with "Ver detalles" disclosure for IDs |
| Buttons | Primary actions as underlined links ("Recibo #4", "Caja Patio · Cerrada"); logout styled primary on the Pilot page; secondary buttons used for navigation ("Volver a estudiantes") | Tiers: primary / secondary / tertiary (link) / danger, documented with usage |
| Dialogs | At least three behaviors: Crear estudiante (focus inside, stepper); Corregir saldo (no focus move, no trap, no Escape); native `confirm()` (recarga, POS close); sandbox banner panel | `TaskWindow` |
| Badges | "Activo" chip; "Revertida · …" amber text; "Abierta · sin conciliar" pill (5D.3); "Sesión abierta" plain text | `StatusBadge` (tone plus text, never color alone) |
| Money | `MoneyValue` on wallet, cafeteria lookup and Reportes; plain strings in Cajas, Transacciones, receipts and POS; Caja difference unsigned and unlabeled | Adopt `MoneyValue` plus a `Discrepancy` label everywhere money appears (H14) |
| Empty / loading / error | Good copy in 5D; elsewhere "Todavía no hay …", raw "Cargando historial…", generic "No pudimos cargar la información" without retry button on platform lists | `EmptyState` / `ErrorState` (with "Reintentar") / `LoadingState` |
| Filters / search | Students: stacked full-width selects plus a "Buscar" button; Cajas: two wide fields; Platform clientes: form plus "Buscar/Limpiar" | `FilterBar` plus `SearchField` |
| Density / spacing | Inputs stretch to 1,000+ px on desktop (wallet recarga, provisioning) | Max form width ≈ 560 px inside TaskWindow / sections |
| Icons | Only in sidebars and bottom nav | Fine; no change needed |
| Typography | Headings `text-2xl` on Platform vs `text-3xl font-black` elsewhere | Single scale via `AppPageHeader` |

## 13. Responsive findings (390 / 768 / 1440)

No horizontal overflow on any of 138 measured pages or the demo surfaces.

| Area | 390 px | 768 px | 1440 px |
| --- | --- | --- | --- |
| Admin header | School 181 px; Cafeteria ≈215 px sticky (context select, "Cambiar", "Cerrar sesión" stacked) | 139 / 101 px | 71 / 85 px |
| Demo chrome | +≈250 px (panel with two buttons plus a second strip); `h1` at ≈480 px | Same pattern, 139 px header | Panel in header |
| POS header | 161 px (real), **247 px** (sandbox) of 844 | 105 px | 105 px |
| Bottom nav (admin) | 73–85 px fixed; **renders above dialog scrim** (Crear estudiante) | n/a (sidebar) | n/a |
| Students | First result ≈940 px | ≈540 px | ≈700 px (prior) |
| Wallet | 2,715 px; history after the form | 2,429 px | 2,289 px |
| Reportes | 3,358 px | 2,702 px | 2,210 px |
| POS payment | "Cobrar" top 935 px (viewport 844) | 1047 (1024) | 1013 (900) |
| Touch targets | POS category chips and the gallery/list toggles < 44 px; 5–6 small controls on "Cafeterías conectadas" | same | same |
| Dialogs | Crear estudiante fits as a top sheet; actions visible | centered | centered |

**Table to card guidance:**
- Transacciones, Cajas history, students and platform clients become **tables at
  ≥ 1024 px** (columns: date, receipt, register, customer, tender, amount, status) and
  stay **condensed cards < 1024 px** (two lines plus an amount).
- Wallet movements stay a list at every width, with "Ver detalles".

## 14. Accessibility findings

Practical review, not a formal WCAG assessment.

| Area | Observation | Status |
| --- | --- | --- |
| Focus visibility | Nav links 3 px outline; selects/buttons 2 px; visible | Good |
| Modal focus: Corregir saldo | Focus stays on the opener; Tab walks the **background** page (amount, reference, history) before reaching the dialog; focus leaves the dialog after "Cerrar"; Escape does not close | **H11 (P1)** |
| Modal focus: Crear estudiante | Focus moves into the dialog (to its heading) | Good; reference |
| Native `confirm()` | Recarga (observed), POS close (prior) | F17 |
| Headings | Login at 1440 has two `h1`s; wallet `h1` "PIKAS Cash" with the student as `h2`; platform Equipo error state has no `h1` | H26 |
| Labels | 0 unlabeled inputs across 138 pages | Good |
| Unnamed buttons | 0 found | Good |
| Disabled controls | POS "Cobrar" disabled **with** a visible reason (good); "Editar" (open register), POS "Transacciones" tab and sandbox POS customer buttons without an adjacent reason | H28 |
| Color-only meaning | Movements and discrepancies carry sign plus text; "Revertida" text plus amber | Good |
| Status communication | Session warning dialog uses the native `<dialog>`; its heading is unstyled and its static "2 minutos" contradicts the counter | F24 |
| Contrast | Teal sidebar labels, disabled grey buttons and amber-on-amber demo text need measurement | Not concluded |
| Touch targets | See §13 | H27 |
| Observation to confirm | During the dialog keyboard test, the session boundary's "Verificando tu sesión / Iniciar sesión" block became focusable. It should be `inert` while masked. Reproduce before treating as a defect. | Needs confirmation |

## 15. Prioritized findings

**Format:**
- Each finding is written as: ID · priority · role · surface · journey.
- Earlier findings are cross-referenced with their F-number.
- "Dep." names the dependency.
- **Biz** = changes business, financial or authority logic.

**H01 · P1 · Platform (sandbox operator) · Demo · J3.** Switching persona takes an
exit/enter ritual: 4–5 interactions and 3–4 page loads per switch, 16 for a 3-role
demo. The launcher hides other personas while one is active.
- *Evidence:* §3.2; POV audit rows all `exited`, none `superseded`.
- *Fix:* `DemoEnvironmentBar` plus `DemoPersonaSwitcher` plus the `/switch` route
  (§4.2).
- *Reuse:* environment chrome across three shells.
- *Dep.:* none. *Biz:* no (reuses the existing supersede RPC).

**H02 · P1 · Platform · Demo · J3.** After a switch, other tabs fall to
`/login?error=school_authority`, a blank-message login, although the operator is still
authenticated.
- *Fix:* the "La demostración cambió" state for sandbox operators (§4.2).
- *Dep.:* H01. *Biz:* no.

**H03 · P1 · Platform · Demo · J3.** Exits are inconsistent:
- three different leave actions;
- "Cerrar sesión" in admin shells and "Salir" in POS end the operator's session;
- "Volver a Backoffice" lands on `/platform` with the POV still active.

*Fix:* one "Salir del demo" (end POV → Demo workspace); hide tenant logout while a
POV is active; the account menu keeps "Cerrar sesión". *Biz:* no.

**H04 · P1 · Platform · Demo (mobile) · J3/J21.** At 390 px the demo chrome plus the
sticky header consume ≈430 px before the `h1` (admin) and 247 px of 844 (POS).
- *Fix:* a one-line 44 px bar with a bottom-sheet switcher.
- *Dep.:* H01.

**H05 · P1 · Platform · Sign-in · J1.** Platform staff using `/login` get "No tienes
acceso a una cuenta de PIKAS". Staff must know `/backoffice/login`. Three product names
(PIKAS Platform / Backoffice / Admin).
- *Fix:* at minimum, a `/login` message linking to the staff entrance when the account
  has platform membership.
- *Preferred:* one entrance that routes by server-derived identity, after a security
  review (OD-B6).
- *Biz:* authentication routing (review).

**H06 · P1 / F11 · Cashier, Supervisor · Pilot landing · J11.** POS staff land on
"Conexión PIKAS Pilot" with Auth/Persona/RLS/`pos_cashier`.
- *Fix:* route POS-only staff to `/pos`, per locked decision 4.
- *Biz:* no.

**H07 · P1 / F03 · Cashier · POS payment · J13–15.** "Cobrar" is below the fold at
390/768/1440.
- *Fix:* a pinned payment summary (total, tender, received, change, commit).
- *Reuse:* `TaskWindow` footer pattern. *Biz:* no.

**H08 · P1 / F04 · Cashier · POS header · J13–14.** "Buscar usuario PIKAS" stays active
during payment.
- *Fix:* disable it while payment is open, with a reason, or confirm.

**H09 · P1 / F05 · Cashier, Supervisor · POS Transacciones / Reembolsos · J16.** The
tab is dead; refunds need the receipt number.
- *Fix:* recent sales for this register with "Reembolsar" (locked decision 2).
- *Dep.:* 5D.4 read. *Biz:* no (same refund RPC).

**H10 · P1 / F06 · All admins · Session expiry · J19.** Silent login
(`school_authority` has no message), unstyled ended screen offering "Acceso de
Plataforma" to tenant users, destination lost.
- *Fix:* a branded ended state and a login message. Return to the destination after the
  OD6 security review.

**H11 · P1 · School/Cafeteria/Account Admin · Corregir saldo dialog · J7.** No initial
focus, no focus trap, Escape doesn't close, and the background stays in tab order.
- *Fix:* `TaskWindow` with focus management (initial focus, trap, Escape when no request
  is in flight, return focus to the opener).
- *Biz:* no.

**H12 · P1 / F07, F20 · School, Cafeteria · Dashboards.** The School home says wallets
are unavailable ("monederos"); the Cafeteria home says "1 sesiones" and has no today's
state or link to Reportes.
- *Fix (immediately):* correct the copy.
- *Fix (later):* role launchpads.
- *Dep.:* 5D.4/5D.5 for "today" data.

**H13 · P1 / F08, F17 · School/Account · Wallet · J5–6.** A permanent recarga form above
the history, and a native confirm.
- *Fix:* a summary with [Recargar] [Corregir saldo]; recarga as a TaskWindow; history
  first.

**H14 · P1 · Cafeteria Admin · Cajas vs Reportes · J18.** The same register difference
reads "Diferencia RD$ 25.00" in Cajas and "Sobrante +RD$ 25.00" in Reportes. Cajas
"Diferencia −RD$ 25.00" has no label either.
- *Fix:* Cajas adopts `MoneyValue` plus the `Discrepancy` label from 5D.3.
- *Reuse:* `Discrepancy` / `StatusBadge`. *Biz:* no (presentation only).

**H15 · P2 / F25 · Account Admin · Shell.** No account identity or landing.

**H16 · P2 / F14 · All admins · Shells.** Three shells; different logout placement and
header heights. *Fix:* one `AdminShell` (§17).

**H17 · P2 / F15 · School Admin · Students · J4.** Stacked filters; results start
≈940 px at 390. *Fix:* `FilterBar`; row action "PIKAS Cash".

**H18 · P2 / F16 · School/Account · Wallet history.** UUIDs, notes and before-balances
inline. *Fix:* "Ver detalles" disclosure.

**H19 · P2 · Admins (mobile) · Dialogs · J20/J21.** The bottom nav renders above the
dialog scrim (Crear estudiante at 390), so a tap navigates away and drops input.
- *Fix:* `TaskWindow` sheet layering above the nav, plus an `UnsavedChangesGuard`.

**H20 · P2 · Platform · Demo launcher · J2.** Database ordering, repeated tenant lines,
duplicated role in persona names, no description of each experience, "sandbox"
vocabulary. *Fix:* the §5.1 layout.

**H21 · P2 · Platform · Demo indicators.** Two sandbox indicators per admin page (panel
plus "DEMO / SANDBOX · … Datos de prueba"); a third design in POS; expiry shown as an
absolute timestamp with seconds.
- *Fix:* a single `DemoEnvironmentBar`; relative expiry ("Vence en 3 h 40 min") only
  when under 30 min.

**H22 · P2 · Platform · Nav, Clientes, Equipo · J1.**
- "Crear cliente" is a nav item; "Equipo de PIKAS" label.
- Clientes and Equipo fail to load in the local environment in two consecutive audits,
  while `platform_team_read` returns valid JSON locally.
- *Fix:* nav per §8, and investigate the load failure as a **defect candidate** (verify
  the web contract against current data shapes).

**H23 · P2 · Platform · Provisioning wizard · J1.** Text arrow trail; "Recuperar
solicitud pendiente" always visible; full-width inputs.
- *Fix:* `TaskStepper`, a conditional resume banner, narrow form.

**H24 · P2 / F19, F20 · Several · Copy.** "Datos comprometidos" (Cajas, Transacciones),
"Controles pendientes" (Configuración), "Saldo PIKAS" (wallet card, cafeteria PIKAS
Cash), "Volver a Backoffice" (POS demo), "Persona / siguientes pasos" (client detail).
*Fix:* a copy pass. *Biz:* no.

**H25 · P2 / F13 · Cafeteria Admin · Transacciones · J9.** No filters, UUIDs inline,
underlined receipt links. *Dep.:* 5D.4 (approved slice).

**H26 · P2 · Public · Login.** Two `h1`s at 1440 (marketing and form). *Fix:* the
marketing headline becomes a `p`/`h2`.

**H27 · P2 · Cashier · POS catalog.** Category chips and the gallery/list toggles are
under 44 px. *Fix:* 44 px minimum.

**H28 · P2 / F21 · Several · Disabled controls.** "Editar" on an open register, the
POS Transacciones tab and the sandbox POS customer buttons have no adjacent reason.
- *Fix:* a disabled-reason hint pattern (5D's "Cobrar" reason is the model).

**H29 · P2 / F24 · All · Session warning dialog.** Static "2 minutos" next to the
counter; unstyled heading.

**H30 · P2 / F26 · Admins · Context switcher.** Select plus "Cambiar", shown with one
option.

**H31 · P3 · Cafeteria Admin · Cajas.** Configuration and session history share one long
page; UUIDs inline. *Fix:* "Cajas" (registers with current session state) with
"Historial" as a second tab.

**H32 · P3 / F29 · Platform · Inicio.** Passive, with an empty activity card.

**H33 · P3 · Public · Legacy demo-mode routes.** `/familias`, `/estudiante`,
`/admin/login` and backoffice "modo demo" copy coexist with the sandbox Demo.
- *Fix:* never link "Próximamente" to them; decide retirement (OD-B9).

**H34 · P3 · All · Timestamps.** Absolute timestamps with seconds ("11:22:56 a. m.")
for demo expiry and history; hardcoded "Horas de Santo Domingo" (G4).
- *Fix:* one formatter with business timezone, without seconds.

**H35 · P3 · Cafeteria Admin · Reportes (mobile).** 3,358 px at 390. *Fix:* section
anchors or a collapsible "Productos principales" / "Cajas abiertas ahora".

**Totals:** P0 0 · P1 14 (H01–H14) · P2 16 (H15–H30) · P3 5 (H31–H35).

Earlier findings not re-observed here keep their pre-5D status:
- F02 is superseded by locked decision 3: never preselect the tender.
- F09: the live summary now exists for admins in Reportes; the cashier stays blind.
- F10: addressed by 5D.
- F22, F23, F27, F28 (OD5), F30 remain open.

## 16. Reusable component recommendations

Only primitives with at least two real consumers are listed.

| Primitive | Purpose | Real consumers | Wave |
| --- | --- | --- | --- |
| **DemoEnvironmentBar** | The single sandbox indicator: environment, current persona, switcher trigger, "Salir del demo" | School shell, Cafeteria shell, POS (replaces `SandboxAdminContext`, the shell strip and the POS banner) | B |
| **DemoPersonaSwitcher** | Menu (desktop) / bottom sheet (mobile) of experiences plus inert "Próximamente" | Bar (all shells), Demo workspace | B |
| **StatusBadge** | Tone plus text status chip | Demo persona "Actual"/"Próximamente"; Abierta/Cerrada; Cuadrada/Faltante/Sobrante; Activo/Suspendido; Revertida; refund status (5D.4) | B |
| **MoneyValue** (exists) + **Discrepancy** (exists in 5D.3) | Money semantics | Adopt in Cajas, Transacciones, receipts, POS balances (H14, F18) | B (Cajas) / E (POS) |
| **AppPageHeader** | Eyebrow, `h1`, description, actions, back link | Every admin page (≈25), Platform pages | C |
| **AdminShell** | Sidebar/top bar, context switcher, account menu, mobile bottom nav | Platform, Account, School, Cafeteria | C |
| **EmptyState / ErrorState** | Explained zero; failure with "Reintentar"; no fake zeros | Platform lists, Transacciones, Cajas, students, Reportes sections, Actividad | C |
| **TaskWindow** | Modal/sheet/page task container: title, optional stepper, focus management, pinned footer (Back / Continue / Cancel / final action), busy and uncertain states | Crear estudiante, product, staff, register, recarga, reversión, ajuste, admin close, POS close, refund, provisioning (page variant) | D |
| **TaskStepper** | Step indicator plus step state | Provisioning, Crear estudiante, ajuste, CSV import | D |
| **ConfirmStep** | Final review with amount-bearing action label and permanence text | Recarga, ajuste, reversión, close, refund, provisioning | D |
| **UnsavedChangesGuard** | Intercepts close, navigation, demo switch and logout when a category A draft is dirty | All category A task windows, demo switcher | D |
| **FilterBar + SearchField** | Inline filters with URL state | Students, Transacciones (5D.4), Cajas, Platform clients, Reportes period | C/D |
| **DataList** | Cards < 1024 px, table rows ≥ 1024 px, "Ver detalles" disclosure | Transacciones, Cajas history, students, platform clients, wallet movements (list only) | C |
| **MetricCard** | Label, value, help | Dashboards, Reportes (exists inline) | C |

**Not recommended now:**
- a generic form-builder;
- a global state store for drafts (use per-task `sessionStorage` keys);
- a breadcrumb component.

## 17. Recommended shell architecture

**One `AdminShell` for Platform, Account, School and Cafeteria.** POS keeps its task
workspace.

- **Desktop (≥ 768 px):**
  - Left sidebar (role accent: navy for Platform/School, teal for Cafeteria) holding the
    product mark "PIKAS Admin", the role label, navigation and nothing else.
  - A top bar (≤ 64 px) with:
    - the context switcher (shown only when there is more than one option; changes on
      select);
    - contextual page actions;
    - an **account menu** (name ▾ → Mi perfil, Cerrar sesión).
  - Platform moves from its top nav into the same sidebar.
- **Mobile (< 768 px):**
  - A 56 px top bar: context name and ☰/account menu. The context switcher and logout
    live inside that menu.
  - Bottom nav: four destinations plus "Más".
  - Never more than 56 px of sticky chrome, plus 44 px in demo.
- **Page header:** `AppPageHeader` inside content:
  - an optional eyebrow, then an `h1` equal to the nav label;
  - a one-line description;
  - primary action at the right (desktop) or full-width below (mobile);
  - a back link on detail pages only.
- **Back behavior:** a header back link to the logical parent ("← Estudiantes"); no
  breadcrumbs; browser back is never required.
- **Sandbox controls:** `DemoEnvironmentBar` sits above the shell (outside the role
  accent), so sandbox state never depends on role styling. While a POV is active:
  - the account menu shows the **real operator** and "Volver a PIKAS Admin";
  - "Cerrar sesión" moves behind it (it ends the operator's session).
- **POS:** a minimal header (cafeteria, register, operator, menu with "Cerrar sesión") and
  a status footer. It keeps its tabs; in demo, the bar replaces the separate POS banner.

## 18. Demo workspace specification

| Item | Specification |
| --- | --- |
| Nav placement | PIKAS Admin primary nav: **Inicio · Clientes · Equipo · Demo**. Visible only with `platform:sandbox:pov:enter` (server-derived, as today). Route `/platform/demo` (keep `/platform/demostracion` as a redirect). |
| Landing content | Title "Explorar PIKAS"; one sentence on isolation and the operator's real identity. Groups: **Administración** (Escuela, Cafetería), **Operaciones** (Caja / POS · José Ramírez), **Experiencias** (Padre, Estudiante: Próximamente). Each card has a 1-line description and one primary action. If a persona is active, its card shows "Actual" and **"Continuar"**, and the others still show "Entrar". Nothing is hidden. |
| Activation | "Entrar como Escuela" → `/switch` → persona home. No intermediate "active card" step. |
| Persistent switcher | In `DemoEnvironmentBar`: "Rol: Escuela ▾". Desktop: dropdown menu. Mobile: bottom sheet. Keyboard: menu button pattern (Enter/Space opens, arrows move, Escape closes, focus returns). |
| Current persona display | Bar text "DEMO · Colegio Horizonte · Escuela", with the real operator name at the right ("Edwin"). The shell header adds "(demo)" after the role. |
| Switching | §4.4 guards → `/switch` → hard navigation to the persona home. The busy label is "Cambiando a Cafetería…". On failure: stay put, show the error, no assumption. |
| Route after switch | Always the persona home. Optional "Volver a {última página}" link (category B state). |
| Salir del demo | In the bar on every surface. `/exit` → `/platform/demo`. Already-exited counts as success. The operator stays signed in. |
| Unavailable persona | Disabled item with "No disponible en este entorno". The server rejects regardless. |
| Próximamente | Inert, non-focusable text rows/cards with a `StatusBadge`. No links to legacy demo-mode routes. |
| Unmistakable sandbox | Amber bar on every sandbox page, above all chrome, with the text "DEMO" and "datos ficticios" (not color alone). It is never rendered for customer tenants. |
| POS transition | Leaving POS with an idle open sandbox register is allowed with a note. A cart in progress needs confirmation. An uncertain financial request blocks the switch (§4.4). Returning re-enters José's POV; the existing register session is recovered. |
| Context preserved across switches | Only category B UI state (last path per persona, report period). |
| Never persisted / replayed across switches | Carts, payment state, tender selection, cash received, refund selections, register counts, override credentials, any financial form value, request keys (other than existing recovery journals, which block the switch), category A drafts of the previous persona (cleared on switch). |
| Stale tabs | "La demostración cambió · Ahora estás como Cafetería" with [Ir a Cafetería] [Volver a Demo]. Shown only for sandbox operators. |
| Expiry | 4 h per POV; a switch starts a new POV (current behavior). The bar shows a relative countdown only in the last 30 min, and "Demo vencido · [Volver a entrar]" after expiry. |
| Server/authority impact | One route (`/switch`) resolving targets server-side and calling the existing `platform_enter_sandbox_pov`. One read for the shell. No SQL, RLS or capability change. Audit continues through the existing RPCs (`superseded` / `exited`). |

## 19. Implementation roadmap (waves)

Each wave is its own milestone with owner review and a separate commit series. No wave
changes financial rules, RPCs or authority, except the single `/switch` route in B.

### UX Foundation B: Demo environment and minimal shared chrome

- **Findings:** H01, H02, H03, H04, H20, H21, H14 (Cajas presentation only), plus the H12
  copy fixes.
- **Surfaces:**
  - Platform nav ("Demo") and the `/platform/demo` workspace;
  - School, Cafeteria and POS shells (bar replaces three indicators; tenant logout hidden
    during POV);
  - stale-tab state;
  - Cajas difference labels;
  - School and Cafeteria dashboard copy.
- **Primitives:** `DemoEnvironmentBar`, `DemoPersonaSwitcher`, `StatusBadge`; adoption of
  `MoneyValue`/`Discrepancy` in Cajas.
- **Backend/authority:** the `/switch` route plus a read route. No SQL.
- **Financial risk:** low. The switch guard must block on uncertain requests (POS and
  admin journals).
- **Tests:**
  - route unit tests: allowlist, server-resolved IDs, ambiguous/none rejection,
    capability, idempotency;
  - shell rendering for customer vs sandbox;
  - switch guards;
  - production-mode browser: School→Cafetería→POS→School in ≤ 2 interactions each;
  - stale tab;
  - exit preserves the operator session;
  - 390/768/1440;
  - non-operator tenant users never see the bar.
  - Re-run focused sandbox POV route tests (no DB suites unless the route touches SQL).
- **Dependencies:** none.
- **Owner decisions:** OD-B1, OD-B2, OD-B3, OD-B4, OD-B5.
- **Commits:**
  1. switch route plus tests;
  2. bar plus switcher plus workspace;
  3. stale-tab state;
  4. Cajas/dashboard presentation.

### UX Wave C: Shell, navigation and page hierarchy

- **Findings:** H05 (message-level; single entrance only after OD-B6), H06, H10 (ended
  state and message; return-to-destination after OD6 review), H15, H16, H22 nav, H24,
  H26, H29, H30, H32, H34; F25/F26.
- **Surfaces:** all admin shells, Platform nav, login/ended states, Pilot landing (route
  POS-only staff to `/pos`).
- **Primitives:** `AdminShell`, `AppPageHeader`, `EmptyState`/`ErrorState`, `MetricCard`,
  `DataList` (first adopters: Transacciones, platform clients).
- **Backend:** none, except login routing for platform staff (security review) and the
  OD6 return destination (security review).
- **Financial risk:** none.
- **Tests:** shell snapshot and unit tests per role, navigation authority (items still
  server-derived), session ended/expired browser journey, 390/768/1440.
- **Dependencies:** B (bar placement).
- **Commits:**
  1. shell plus header;
  2. platform nav;
  3. session states;
  4. POS-staff routing;
  5. copy pass.

### UX Wave D: Task windows and administrative workflows

- **Findings:** H11, H13, H17, H18, H19, H23, H28, F17, F22.
- **Surfaces:**
  - Crear/editar estudiante (reference);
  - recarga, reversión, ajuste;
  - admin exceptional close;
  - product, staff and register create/edit;
  - provisioning (page variant);
  - students `FilterBar`;
  - wallet summary and history disclosure.
- **Primitives:** `TaskWindow`, `TaskStepper`, `ConfirmStep`, `UnsavedChangesGuard`,
  `FilterBar`/`SearchField`.
- **Backend:** none; existing RPCs and recovery journals unchanged.
- **Financial risk:** medium (presentation of money commits).
- **Tests:**
  - focus management (initial, trap, Escape, return);
  - draft rules A/B/C (§10), including that no financial value survives close or switch;
  - existing recovery tests for recarga, ajuste and close rerun;
  - browser journeys 390/768/1440.
- **Dependencies:** C (header/actions slot).
- **Owner decisions:** OD-B10.
- **Commits:**
  1. `TaskWindow` plus guard;
  2. migrate non-financial dialogs;
  3. migrate wallet money dialogs plus recarga;
  4. admin close;
  5. students filter plus wallet layout;
  6. provisioning.

### UX Wave E: POS workflow

- **Findings:** H07, H08, H09, H27, F18 (POS money), F23, F30, POS H28.
- **Surfaces:**
  - payment step (pinned summary and commit);
  - header behavior during payment;
  - Transacciones = recent sales with "Reembolsar";
  - refund TaskWindow with steppers;
  - close TaskWindow;
  - touch targets.
- **Backend:** none, beyond the approved 5D.4 read for recent sales.
- **Financial risk:** medium–high (checkout surface).
- **Tests:**
  - POS focused unit tests;
  - checkout/refund/close recovery regression;
  - blind-count assertion;
  - closed-register rejection;
  - production-mode browser at tablet/desktop plus 390.
- **Dependencies:** 5D.4; D (`TaskWindow`).
- **Owner decisions:** none new (OD1, OD3 locked); confirm the recent-sales scope
  (register vs cafeteria, today only).

### UX Wave F: Responsive, accessibility and polish

- **Findings:** H31, H33, H35; contrast measurement; keyboard traversal of all task
  windows; screen-reader announcement of uncertain/recovery states; the to-confirm
  session-boundary focus observation; remaining copy.
- **Tests:** an automated accessibility scan (axe) per page; manual keyboard and
  VoiceOver passes on core journeys.

**Sequencing with Phase 5D:** B can run now (independent of 5D.4–5D.5). C is
independent. E depends on 5D.4. D's wallet work should precede 5D.5 UI, so the PIKAS
Cash report lands in the new structure.

## 20. Owner decisions required

| ID | Decision | Recommendation |
| --- | --- | --- |
| OD-B1 | Navigation label and route: "Demo" (`/platform/demo`) vs "Demostración" | **Demo**, with the old route redirecting |
| OD-B2 | Approve the `/switch` route: experience code only, IDs resolved server-side, existing RPC; no SQL | **Approve** |
| OD-B3 | POS: allow switching away with an idle **open** sandbox register (it stays open and is recovered on return) | **Allow**, with a note. Block on uncertain requests, confirm on a cart in progress. |
| OD-B4 | Remember the last page per persona as a link (UI state only) | **Yes, link only**, no auto-redirect |
| OD-B5 | Each switch starts a new 4-hour POV (current RPC behavior) and is audited as `superseded` | **Accept** (no SQL change) |
| OD-B6 | Platform staff entrance: keep `/backoffice/login` with a pointer from `/login`, or a single entrance that routes by identity; one product name ("PIKAS Admin") | **Pointer now**; single entrance only after a security review; name "PIKAS Admin" |
| OD-B7 | Several sandbox environments in future: switcher within the current environment; change environment in the Demo workspace | **Agree** |
| OD-B8 | Tone of overages: 5D.3 renders Sobrante green (`movement`). Adopt the same in Cajas, or switch both to neutral with a label | Decide once; apply in B |
| OD-B9 | Retire legacy demo-mode routes (`/familias`, `/estudiante`, `/admin/login`, backoffice "modo demo") or keep them for marketing demos | Keep untouched until Parent/Student are planned; **never link Próximamente to them** |
| OD-B10 | Drafts for category A tasks: browser `sessionStorage` (per actor, persona and scope) vs server drafts | **sessionStorage** now; provisioning keeps its server journal |
| OD-B11 | Recent-sales scope for POS Transacciones (this register today vs cafeteria today) | This register, today (Wave E) |

## 21. Explicit non-goals

- No change to financial rules, RPCs, accounting, recovery semantics, refund authority,
  blind count, tender preselection policy or sandbox capability allowlists.
- No SQL, RLS or new capability; the only new server surface proposed is the `/switch`
  route (Wave B).
- No generic impersonation or support access; no arbitrary persona or tenant selection
  by the client.
- No Parent or Student functionality ("Próximamente" only).
- No 5D.4–5D.6 or 5E work inside these waves; no charts or dashboards beyond role
  launchpads.
- No brand replacement; keep the logo and navy palette; role accents only.
- No breadcrumbs, no global draft store, no big-bang redesign.

## 22. Acceptance criteria for the future UX program

**Demo**
- From any persona, switching to another takes **≤ 2 interactions and 1 page load**, at
  390/768/1440.
- "Salir del demo" from any persona returns to the Demo workspace with the operator still
  signed in. No tenant-shell logout is visible during a POV.
- The client sends only an experience code. The audit shows `superseded` for switches and
  `exited` for exits. Every server-side denial path is unchanged.
- A stale tab shows "La demostración cambió", never a blank login.
- A switch is impossible while a financial request is uncertain. No financial value or
  key survives a switch.
- Customer-tenant users never render demo chrome. Sandbox data never appears in customer
  reporting.

**Product-wide**
- One shell for all admin roles. Sticky chrome ≤ 56 px on mobile (+44 px in demo). `h1`
  equals the nav label on every page.
- Every money value renders through `MoneyValue`. Every discrepancy and status renders
  through labelled primitives. Cajas and Reportes present the same session identically.
- Every dialog or task window:
  - moves focus in, traps it, closes on Escape when idle, and returns focus;
  - is layered above mobile navigation.
- No native `confirm()` remains.
- Financial commits are never replayed automatically; category A drafts are cleared on
  submit, discard, logout and switch.
- POS: the commit control and change are visible without scrolling at 390 (portrait),
  768 and 1440×900 on the payment step. Payment cannot be abandoned by a header action
  without confirmation.
- No Auth/Persona/RLS/role-code/"Datos comprometidos"/"Backoffice"/"POV" text in
  tenant-facing UI.
- Touch targets ≥ 44 px; no horizontal overflow; an automated accessibility scan with no
  critical issues on core pages; manual keyboard pass on core journeys.

---

### Evidence and method

- **Environment:** the existing isolated local production stage (`next build --webpack`
  of HEAD `7d51a13e`, `next start`, loopback Supabase adapter) against local
  `pikas-4d6` with existing fictional tenants (Colegio Ficticio Auditoría UX; sandbox
  Colegio Horizonte). No production access.
- **Coverage:**
  - Playwright sweep of **138 page states** for every role (public, Platform, Account,
    School, Cafeteria, cashier, supervisor, sandbox operator) at **390/768/1440**;
  - layout metrics (page height, `h1` position, sticky/fixed chrome, overflow, touch
    targets, unlabeled inputs, unnamed buttons, alerts, terminology scan);
  - a measured Demo cycle (School → Cafeteria → POS → School, plus stale tab);
  - POS to the payment step at three widths (not committed);
  - wallet keyboard and dialog focus tests;
  - recarga native confirm (dismissed);
  - Crear estudiante dialog at 1440/390;
  - cafeteria mobile "Más".
- **Local data added:** one fictional local sandbox-operator login ("Operador Ficticio
  Demo UX", `@example.invalid`, local `platform_sandbox_operator` membership, the same
  pattern as `scripts/test-step4d6-browser.mjs`); five local sandbox POV sessions from
  the demo journey (all exited). No sale, recarga, refund, adjustment or close was
  committed.
- **Not re-executed (prior evidence reused):** session expiry aging (code unchanged since
  the pre-5D audit), completed checkout and refund commits, register close (Phase 5A and
  5D.3 evidence), contrast and screen-reader testing (not concluded).
- **Artifacts (local only):** `/private/tmp/pikas-ux-audit/holistic/` (screenshots,
  `sweep.json`, `journeys.json`, `interact*.json`).

## 23. UX Foundation B — local implementation record

**Scope:** bounded Foundation B implementation, local only, on `Pikas_demo`.
The historical findings above remain the baseline; this record supersedes their
Foundation B proposals and pending owner decisions, without reopening the audit.

### Product and architecture

- PIKAS Admin navigation and home now say **Demo**. The existing destination
  `/platform/demostracion` is the workspace **Explorar PIKAS**. Administration groups
  Escuela/Cafetería; Operations contains Caja / POS; Padre/Estudiante are plain,
  noninteractive **Próximamente** cards. No legacy family/student demo links are added.
- `DemoEnvironmentBar` and `DemoPersonaSwitcher` serve School, Cafeteria and connected
  POS. One amber control surface identifies Demo, current experience, switching and
  **Salir del demo**. Normal tenant shells keep their existing authentication controls.
- `POST /api/platform/sandbox-pov/switch` accepts only strict Zod
  `{ experience: "school" | "cafeteria" | "pos" }`, same origin and an idempotency UUID.
  The existing Platform handler authenticates the real operator and requires
  `platform:sandbox:pov:enter`; Platform Admin alone does not confer that capability.
- The server reads `platform_get_active_sandbox_pov` and
  `platform_list_sandbox_pov_targets`. While active, account, school and cafeteria must
  match the active environment. Initial entry requires exactly one registered
  environment. Missing, malformed, ambiguous, expired or duplicate targets fail closed.
  No client identity, tenant ID or return URL is accepted.
- The existing `platform_enter_sandbox_pov` resolves the registered fictional persona,
  atomically supersedes the previous POV, preserves the real operator and audit, and
  establishes the existing four-hour POV. This SQL authority mechanism is unchanged;
  no database or concurrency suite was rerun to re-prove it.
- Destinations are always the canonical GET homes: School
  `/admin/escuela?school=<server-resolved school>`; Cafeteria
  `/admin/cafeteria?cafeteria=<server-resolved cafeteria>`; cashier `/pos`.
  Navigation memory is deliberately omitted: canonical homes avoid extra path
  authorization and never restore forms, tenders, carts or financial state.
- The canonical **Salir del demo** calls the existing exit RPC, then hard-navigates to
  the Demo workspace. Authoritative absence is treated as already exited. It never
  invokes Auth logout. **Cerrar sesión** remains in PIKAS Admin's authenticated session
  control and uses the existing application-session/logout boundary. It masks/ends the
  session as before; no sign-in systems were merged.
- Stale-tab notifications use localStorage only to invalidate the UI, never as
  authority. A native modal explains the change and traps focus. Proxy/server denial
  paths recognize a legitimate sandbox operator and show the explanatory Demo state.
  **Continuar** rechecks the underlying identity and effective context server-side,
  then navigates to the current home or Demo workspace. No old POV is revived and no
  mutation is submitted. Actual session termination follows existing authentication.
- POS blocks switch/exit during busy, unresolved checkout/register operations or blocked
  recovery. Unsent cart/payment/cash/count input requires explicit native confirmation;
  cancellation keeps the input, acceptance discards it. A confirmed receipt's journal
  can be cleared without a request. Financial controls freeze while switching is
  unresolved. The exact switch key/body is retained for an explicit retry.
- Existing per-tab POS journals also block Demo workspace/admin controls if the mounted
  POS controller cannot reconcile them. This is conservative: saved evidence is never
  deleted or automatically retried from another experience. Cross-tab supersession
  still uses the existing command revalidation; uncertain evidence stays in its
  original tab and requires explicit recovery under valid authority.
- An idle open sandbox register stays open. The UI says **La caja permanecerá abierta**;
  switching never calls open/close/checkout. Cashier expected closing cash remains hidden.
- `/login` has a generic **Entrada de PIKAS Admin** pointer to `/backoffice/login`,
  independent of any supplied email. Cajas list/detail use `MoneyValue` movement
  semantics with **Sobrante**, **Faltante**, **Cuadrada**; reporting/accounting are unchanged.
  The school summary directs users to each student's **PIKAS Cash**, according to
  permissions. Opportunistic copy changes are restricted to touched files.

### Owner decisions closed

| Decision | Implemented resolution |
| --- | --- |
| OD-B1 | Navigation label Demo. |
| OD-B2 | Strict experience-only endpoint; server resolves all identity/scope. |
| OD-B3 | Idle open register may remain open; no register mutation on switch. |
| OD-B4 | Canonical homes, no remembered navigation or financial state. |
| OD-B5 | Existing four-hour RPC semantics, no new session system. |
| OD-B6 | Static pointer to the separate Platform entrance; no enumeration. |
| OD-B7 | Same approved account/school/cafeteria environment only. |
| OD-B8 | Sobrante/Faltante/Cuadrada with existing signed MoneyValue semantics. |
| OD-B9 | Harmless legacy implementation retained, not linked from the new Demo. |
| OD-B10 | Draft framework remains deferred to Wave D. |
| OD-B11 | POS recent sales remains deferred to 5D.4 / Wave E. |

### Validation and local evidence

- **161 focused tests / 10 files passed:** existing POV route/launcher tests, new switch
  route validation, Demo presentation, journal guards, connected POS controller/access,
  proxy stale-tab recovery and Cajas presentation. The switch route tests cover all
  three codes, foreign origin, missing key, arbitrary scope/identity fields, ordinary
  tenant/Platform-only denial, environment escape, malformed/ambiguous targets and RPC
  rejection. Existing POS tests retain blind-close/explicit-tender/recovery behavior.
- The existing connected POS presentation browser-component suite also passed **16
  tests**, including catalog layout at 390/768/1440: **177 focused tests / 11 files total**.
- Typecheck, affected ESLint, production build and `git diff --check` passed. No frozen
  Phase 5 DB/concurrency or unrelated application suites were run.
- Browser scripts: `scripts/test-ux-foundation-b.mjs` and
  `scripts/test-ux-foundation-b-pos.cjs`. Actual authenticated fictional local services
  were used, not production. The production-mode fixture build lives in
  `/tmp/pikas-foundation-b/app`; its sole runtime source difference is a temporary
  Supabase config allowance for exactly `http://127.0.0.1:55641` / `pikas-4d6`.
  Runtime source parity was checked; repository config and `.env.local` are unchanged.
- The normal source production build also passed with local environment overrides;
  its strict Supabase hostname guard was preserved. No production service was accessed.
- Screenshots/results are in `/tmp/pikas-foundation-b/browser`. Measurements distinguish
  real document requests and changed-URL navigation from Next hydration's duplicate
  same-URL history replacement events.

| Browser width | School / Cafeteria / POS header | Demo bar | Content after top chrome | Switch | Comparable journey | Including Demo exit |
| --- | --- | --- | --- | --- | --- | --- |
| 390 px | 56 px | 45 px (44 + border) | y = 101 px | 2 clicks / 1 navigation | 8 clicks / 5 navigations | 9 clicks / 6 navigations |
| 768 px | 56 px | 45 px | y = 101 px | 2 / 1 | 8 / 5 | 9 / 6 |
| 1440 px | 56 px | 45 px | y = 101 px | 2 / 1 | 8 / 5 | 9 / 6 |

- Comparable journey: Platform → Demo → School → Cafeteria → POS → School. The three
  switches alone are **6 clicks / 3 navigations**. Versus **16 / 13**, the comparable
  journey uses 50% fewer clicks and 8 fewer navigations. Four actual document loads
  serve its persona entries; the Demo link is one client navigation. Hydration's
  same-URL `replaceState` events are retained in evidence but not counted as loads.
- All widths passed grouping/unavailable personas, one visible Demo bar, no document
  horizontal overflow, keyboard Enter/Escape/focus return, open-register switching,
  separate full logout, stale-tab dialog, server denial/recovery and generic login
  pointer checks, with zero browser page errors or financial writes during switches.
  The POS workspace tabs wrap on narrow screens, keeping Caja reachable.
- The dedicated 390 px POS browser check passed four discard confirmations (cancel and
  accept for sale/payment and counted cash), no restored financial input, no expected
  closing cash, unresolved checkout blocking both switch and exit, exact journal
  retention and no automatic replay. Its single fake product existed only in the
  intercepted browser bootstrap; checkout was intercepted with a simulated uncertain
  response. **Zero checkout/close requests reached the server.** The open register
  session remained identical across persona switches.
- **Minimal local data added:** one fictional José session on **Caja demo Horizonte**,
  `b8248f2b-4b1c-4672-9514-8ad530bd02b1`, opening cash **RD$ 0.00**, left open for the
  required demonstration. No sales, top-ups, refunds, adjustments, counted closes,
  people, memberships or products were added. Normal Auth/POV sessions and audit rows
  were produced by the tested navigation. Existing local data was not reset or cleaned.
  Original creation evidence: `browser/initial-local-data-added.json`; subsequent runs
  reused it. `results.json` and `pos-guards.json` contain final browser results.

### Change manifest and boundaries

The Foundation B commit contains these 39 files:

```text
apps/web/app/admin/cafeteria/layout.tsx
apps/web/app/admin/escuela/layout.tsx
apps/web/app/api/platform/sandbox-pov/exit/route.ts
apps/web/app/api/platform/sandbox-pov/routes.test.ts
apps/web/app/api/platform/sandbox-pov/switch/route.test.ts
apps/web/app/api/platform/sandbox-pov/switch/route.ts
apps/web/app/login/page.tsx
apps/web/app/platform/demostracion/cambio/page.tsx
apps/web/app/platform/demostracion/continuar/page.tsx
apps/web/app/platform/demostracion/page.tsx
apps/web/app/platform/layout.tsx
apps/web/app/platform/page.tsx
apps/web/components/cafeteria-operations.tsx
apps/web/components/cafeteria-screen.tsx
apps/web/components/connected-cafeteria-shell.tsx
apps/web/components/connected-pos-dashboard.test.tsx
apps/web/components/connected-pos-dashboard.tsx
apps/web/components/connected-school-pages.tsx
apps/web/components/connected-school-shell.tsx
apps/web/components/demo-environment-bar.tsx
apps/web/components/demo-foundation.test.tsx
apps/web/components/demo-persona-switcher.tsx
apps/web/components/demo-workspace.tsx
apps/web/components/reconciliation-difference.tsx
apps/web/components/school-screen.tsx
apps/web/lib/auth/pos-access.ts
apps/web/lib/platform/demo-departure.test.ts
apps/web/lib/platform/demo-departure.ts
apps/web/lib/platform/demo-experiences.ts
apps/web/lib/platform/demo-recovery.ts
apps/web/lib/platform/sandbox-launcher.ts
apps/web/lib/pos/connected-sale.test.tsx
apps/web/lib/pos/connected-sale.ts
apps/web/proxy.test.ts
apps/web/proxy.ts
docs/CHANGELOG_PRODUCT.md
docs/UX_UI_PRODUCT_ARCHITECTURE_AUDIT.md
scripts/test-ux-foundation-b-pos.cjs
scripts/test-ux-foundation-b.mjs
```

Waves C–F (unified shell, TaskWindow/drafts, POS discovery/redesign, broad polish)
and Phase 5D.4–5D.6 remain untouched. Reporting calculations, blind count, explicit
tender choice and sandbox financial exclusions are unchanged. There are no migration,
schema, RLS, tenant-role or production-configuration changes. Docker was not started;
existing fictional local services were used. No production access, push or deploy.
No outstanding owner decision or blocker remains for this bounded milestone.

The unrelated `supabase/README.md` is excluded from staging/commit and retains SHA-1
`12172eba11988bcb9073d042bb6881d33c801072`. The intended final worktree contains only
that preexisting modification after the local Foundation B commit.

## 24. UX Foundation B.1 — PIKAS Admin navigation correction (local)

**Owner report.** After Foundation B, the PIKAS Admin home showed only *Inicio · Demo*
while saying "Administra clientes y sus accesos desde aquí."

**Root cause.** Navigation was already capability-gated, and the screenshot operator
("Operador Ficticio Demo UX") is the audit's local **sandbox-only** fixture: it holds
`platform_sandbox_operator` (`platform:sandbox:pov:enter`) and nothing else. *Inicio ·
Demo* is the correct authority behavior for it. The real gaps were:

- **Inicio copy and cards:** the home claimed customer administration to every operator
  and had no Equipo entry point for those who hold it.
- **Clientes failed locally (H22, both audits):** `platform_list_customers` returns the
  local `supabase/fixtures/foundation.sql` accounts `00000000-0000-0000-0000-00000000000{1,2}`.
  These are valid PostgreSQL UUIDs but not RFC 4122, so the web projection's `z.uuid()`
  rejected the whole response and the page failed closed. Production accounts are
  created with `gen_random_uuid()` and were unaffected.
- **Equipo failed locally (H22, both audits):** the audit's fictional Platform Admin was
  inserted directly into `platform_memberships`. It therefore lacked the opaque
  `platform_team_handles` row that the `202610100004` backfill and the team "complete"
  flow give every real operator, so `actor_handle` was `null` and the strict team read
  correctly failed closed. **This was a fixture artifact, not a product defect.** The
  route works for a properly provisioned Platform Admin.

**Changes (no authority, Demo, DB, schema or RLS change):**
- Navigation: **Inicio · Clientes · Equipo · Demo**. "Crear cliente" leaves the bar; it
  remains on Inicio ("Nuevo cliente") and as the Clientes page action. Clientes stays
  current on detail and Nuevo cliente pages. The logo label reads "PIKAS Admin".
- Inicio (`h1` **PIKAS Admin**) shows one card per destination the operator may open. The
  greeting only claims customer administration when an administrative destination is
  available.
- Customer read projections (list rows, cursor, overview entities and onboarding person,
  detail route parameter) use `z.guid()`, the repository's existing convention for
  connected reads that include foundation fixtures. Write and result schemas keep
  `z.uuid()`. The RPCs and capabilities remain authoritative.

| Destination | Capability required (nav, card and page) |
| --- | --- |
| Inicio | Any active Platform identity (`requirePlatform`) |
| Clientes (+ detail) | `platform:tenant:lifecycle:read` |
| Nuevo cliente (Inicio card, Clientes action, page) | `platform:tenant:provision` **and** `platform:customer_admin:provision` |
| Equipo | `platform:team:manage` |
| Demo | `platform:sandbox:pov:enter` (separate `platform_sandbox_operator` role) |

`platform_admin` holds the first four capability groups. It does **not** hold the Demo
capability. A person sees all four destinations only when they also hold the separate
sandbox-operator membership. No role mapping was changed.

**Validation (local, fictional).**
- 102 focused tests / 10 files pass: platform shell, Inicio capability matrix, customer
  pages/contracts, Equipo page, the Demo switch/launcher routes, and the platform
  customer workflows.
- Two platform-shell tests were already failing at `653c64f` (a stale "Demostración"
  label and a `next/navigation` mock without `usePathname`), and `customer-pages.test.tsx`
  could not load (unresolved `@/components/demo-workspace` without a vitest alias).
  These were corrected test-side only; its stale launcher assertion now checks the
  accepted Foundation B workspace. No Demo code changed.
- Typecheck, affected ESLint, production build and `git diff --check` pass.
- Production-mode browser (Foundation B stage, loopback adapter) at 390/768/1440:
  - **full fictional Platform Admin who also holds the sandbox role:** nav and cards
    Inicio/Clientes/Equipo/Demo; Clientes lists 7 local accounts; Equipo loads; Demo opens
    *Explorar PIKAS*; Inicio returns.
  - **Platform Admin without the sandbox role:** Inicio/Clientes/Equipo; direct
    `/platform/demostracion` → "No tienes acceso al Demo."
  - **sandbox-only operator:** Inicio/Demo only, no customer-administration claim; direct
    `/platform/clientes`, `/platform/clientes/nuevo` and `/platform/equipo` show the
    permission message and no data.
  - No overflow and no page errors.
- Local fixtures:
  - new "Administradora Ficticia PIKAS Admin" (`@example.invalid`) with the existing
    `platform_admin` and `platform_sandbox_operator` roles plus its team handle;
  - the missing team handle added for the existing audit Platform Admin fixture.

  The sandbox-only fixture is unchanged. No production identity was touched.

## 25. UX Wave C — unified administrative shell (local)

**Scope.** Shell, navigation, page hierarchy, shared states and responsive consistency for
PIKAS Admin, Account, School and Cafeteria administration. Not changed: business logic,
authority, financial calculations, database/schema/RLS, POS, and the frozen Foundation B
Demo (workspace, `DemoEnvironmentBar`, switcher, `/switch`, stale-tab behavior).

### Architecture

- **`AdministrativeShell`** (`components/administrative-shell.tsx`, client, presentation only):
  - Props: tone (navy for Platform/School/Account, teal for Cafeteria), area label,
    context, optional context switcher, navigation items, account, `logout`, `demo`, `notice`.
  - Desktop: sidebar with PIKAS Admin identity, area label and navigation, plus an account
    block (name, role, **Cerrar sesión**) at the bottom. A 56 px top bar shows the context
    ("Escuela · {nombre}", "Cafetería · {nombre} · {escuela}", "PIKAS Admin · Plataforma
    PIKAS"); the context switcher appears only with more than one option.
  - Mobile: a 56 px top bar (logo, context, **Cuenta y sesión** menu holding name, role,
    switcher and Cerrar sesión) and a bottom navigation. Up to five destinations fit;
    beyond that, four plus **Más**, whose label becomes the current overflow destination.
  - Active state: `isCurrent(path, item)` (prefix match, `exact` for homes), so detail and
    sub-pages keep their parent current: Clientes → cliente / Nuevo cliente; Estudiantes →
    PIKAS Cash del estudiante; Menús → Turnos.
- **Callers decide authority.** The Platform layout builds its items on the server from
  Platform capabilities and passes only serializable data (icon keys). The School and
  Cafeteria shells keep their existing capability filters (`walletNav`, `reportsNav`).
  Every page still enforces its own guard, so direct URLs remain protected (a School Admin
  opening `/platform/clientes` is redirected to `/backoffice/login?error=platform`).
- **Account Admin** is identified only from the server-validated school read
  (`scope.role`): "Administración de cuenta" / "Administrador de cuenta", with the account
  name in the context. Without a validated read (for example the student PIKAS Cash page)
  the label stays neutral; nothing is inferred.
- **Demo:** with an active POV the shell renders the unchanged `DemoEnvironmentBar` under a
  non-sticky top bar; there is no logout and no switcher, and the account shows the real
  operator ("Operador de PIKAS · Demo"). Exactly one Demo indicator; the non-POV sandbox
  tenant strip is unchanged. Measured: top bar 56 px + bar 45 px.
- **POS** is not in the shell (verified: no `admin-shell`, one Demo bar).

### Pattern components

- **`AppPageHeader`**: the `h1` equals the nav label; optional description, action, meta
  and back link (detail pages only); no eyebrow repeating the shell; no breadcrumbs.
  - Platform: Inicio (B.1 title "PIKAS Admin" kept), Clientes, cliente detail (← Clientes),
    Nuevo cliente (← Clientes), Equipo.
  - School/Account: Resumen, Estudiantes, Administradores, Cafeterías conectadas,
    Actividad, student PIKAS Cash (← Estudiantes).
  - Cafeteria: Resumen, Productos, Menús/Turnos, Personal POS, Cajas, Transacciones,
    Reportes, PIKAS Cash, Configuración.
- **`EmptyState` / `ErrorState`**: status vs alert, retry only where safe. Adopted in the
  Platform reads (`ReadFailure`), Clientes empty/invalid filters, Equipo, and the School and
  Cafeteria section load failures (retry to the same section). Specialized financial and
  report errors keep their own copy.
- **`MetricCard`**: existing counts only (School and Cafeteria Resumen; Reportes metrics
  reuse it with identical markup). No new reads.
- **`DataList`**: a captioned table at ≥ 1024 px and compact rows below, adopted for
  **Clientes**. Students, products, staff and registers keep their specialized lists:
  they carry inline actions and editors whose migration belongs with Wave D task windows.
- **Dashboards:** consistent header plus metric cards; the "1 sesiones" grammar fixed.
  No new summaries.

### Session states (presentation only)

- The session boundary's masked state is now a branded `SessionStatePanel`:
  - **Verificando tu sesión**, with a secondary sign-in link;
  - **Tu sesión terminó**, which explains why and gives one action to the correct entrance
    (`/login`, or `/backoffice/login` on Platform routes), stating that no operation is
    repeated and recovery information is kept.
- The warning dialog shows a live `m:ss` countdown instead of a static "2 minutos".
- `/login?error=school_authority` now explains itself.
- Timeouts, reconciliation, logout and journals are unchanged.

### Dialog layering

- Admin dialogs (`AdminDialog`, for example Crear estudiante) are native `showModal()`
  dialogs: top layer, background inert. The audit's H19 "nav above scrim" was a full-page
  screenshot artifact for these.
- The div-based modals (wallet correction/reversal, `aria-modal="true"`, `z-50`) sat above
  the `z-40` nav but left it visible.
- Wave C sets the nav to `z-30` and adds `body:has([aria-modal="true"], dialog[open])
  .mobile-nav { visibility: hidden }`.
- Verified at 390 px for both kinds: the nav is hidden and the bottom of the screen hits
  the overlay, not the nav.

### Terminology and copy

- Eyebrows that repeated the shell were removed.
- Cafeteria home title "Resumen", School "Resumen", Platform "Equipo", Configuración.
- The Estudiantes description stays neutral, so PIKAS Cash is not mentioned to roles
  without wallet authority (a test caught the first draft).

### Validation (local, fictional)

- **241 focused tests / 23 files** pass: shells, primitives, session panel, login messages,
  platform pages, School/Cafeteria pages, Reportes, operations, wallet authority, and the
  Foundation B Demo/switch/launcher/proxy suites.
- TypeScript, affected ESLint, production build and `git diff --check` pass.
- Production-mode browser (Foundation B stage, loopback adapter) at 390/768/1440:
  - Platform: Inicio, Clientes (table ≥ 1024, rows below), cliente detail, Demo.
  - School: Inicio, Estudiantes, student PIKAS Cash.
  - Account: Inicio, Cafeterías conectadas.
  - Cafeteria: Inicio, Productos, Cajas, Transacciones, Reportes; mobile Más lists PIKAS
    Cash, Productos, Menús, Personal POS, Configuración.
  - Demo: School persona → Caja / POS → Salir del demo, at 1440 and 390.
  - Session ended across tabs; unauthorized direct URLs.
  - Every page: top bar 56 px, no horizontal overflow, the expected navigation item
    current, new controls ≥ 44 px, no page errors.
  - `h1` begins at 72 px (390) / 80 px (≥ 768); detail pages at 120/128 px (back link);
    Demo at 117–125 px. The audit measured 181–215 px of sticky chrome, plus ≈250 px in Demo.

### Deferred (unchanged ownership)

- **Wave D:**
  - TaskWindow and drafts;
  - the Corregir saldo focus behavior (H11);
  - the permanent recarga form and native confirm (H13/F17);
  - the students `FilterBar` (H17), wallet history disclosure (H18) and provisioning stepper
    (H23);
  - `DataList` adoption for students/products/staff/registers;
  - student name as the PIKAS Cash title (needs the wallet read).
- **Wave E / 5D.4:** POS (H07–H09, H27), Transacciones filters (H25).
- **Wave F:** contrast and keyboard sweep, the remaining copy (Cajas "Horas de Santo
  Domingo", POS "Volver a Backoffice"), and H31–H35.
- **Also deferred:** platform staff single entrance (OD-B6), and returning to the original
  destination after re-login (OD6, security review).
