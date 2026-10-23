# Demo Lab & Sandbox customer

Internal reference for the PIKAS Demo. Code and current contracts resolve ambiguity in older notes
(`DEMO_GUIDE.md` describes the legacy static demo of the public experiences, see § Legacy Demo).

## The model (approved)

- **A Demo is a real PIKAS customer with `accounts.tenant_kind = 'sandbox'`.** It uses the actual product
  structures and workflows: Colegio, Sede, Cafetería, Cajas, School Admin, Cafetería Admin, Personal POS,
  students, products, menus, transactions, reports and PIKAS Cash concepts where safe. Today there is one
  sandbox: **Colegio Horizonte** (`COLEGIO-HORIZONTE`), designated by migration `202610090003`.
- **POV = internal operator access into a persona.** The UX 11 machinery (`platform_enter_sandbox_pov`,
  `sandbox_validated_pov`, the Demo bar, the conflict screen, `require_no_current_demo`) is the only way an
  operator acts inside the sandbox: **Abrir como…** from the Demo Lab. Personas are Auth-less persons; nobody
  can sign in as a persona. The real operator stays in every audit row (`auth.uid()` + the POV audit stamp).
- **Real and Demo stay mutually exclusive.** A current POV refuses every real Platform mutation (25 guarded
  RPCs, UX 11 test), and the only sandbox-scoped exceptions are explicit branches that first prove the target
  belongs to the POV's own sandbox (see § Provisioning).

## Architecture audit (Phase 1)

| Area | Real customer | Sandbox before this milestone | Sandbox now | Change |
|---|---|---|---|---|
| Account | `tenant_kind='customer'`, lifecycle active/suspended/closed | `tenant_kind='sandbox'` (immutable), active; listed in Clientes with a Sandbox chip; excluded from network/readiness counts | same | none |
| Entering | own login | `platform_enter_sandbox_pov` (3 personas, 4 h, superseding), Demo workspace with experience cards | same RPC behind **Abrir como {persona}** in the Demo Lab; `platform_demo_lab_read` lists sandboxes/personas/counts/last reset | read + UI |
| School Admin inside POV | all `school:*` caps | students, enrollment, sharing, eligibility, administrators (allow-list in `sandbox_admin_has_capability_tenant`); PIKAS Cash reads refused | + `school:wallets:read` (PIKAS Cash views and report, read-only); replenish/reverse/adjust still refused | allow-list + `school_wallet_access`/`school_wallet_report` |
| Cafetería Admin inside POV | all `cafeteria:*` caps | catalog, menus, registers, assignments, staff status; reports/transactions/Hoy business data refused; one-step staff creation refused (`sandbox_unsupported`, `sandbox_username_unsupported`, identity support null) | + `cafeteria:pos:purchases:read`, `cafeteria:pos:sessions:read` (Hoy, Transacciones, Reportes on the sandbox's own data); + one-step Personal POS creation scoped to its sandbox cafetería; cafetería PIKAS Cash (wallet reads/adjust) still refused | allow-list; `provisioning_prepare_with_username`, `identity_support_scope`, `identity_begin/finish_temporary_access`, `set_cafeteria_pos_membership`, app route |
| Cashier inside POV | own membership | real POS, real `checkout_purchase` as the persona (Phase 6B.3); sales land in the normal tables tagged by the sandbox account | same | none |
| Finance | activation required for any obligation/fee | `finance_activate_customer` refuses non-customer accounts; no activation → `finance_after_*` triggers write nothing; Platform finance RPCs refuse a current POV | same (verified: a sandbox sale creates no obligation, no fee, no financial entry) | none |
| Reporting (real business) | `platform_customer_readiness`, `platform_customer_operations_overview`, cockpit counts, Clientes launch cells | customers only (`tenant_kind='customer'`); sandboxes listed in a separate Demo panel | same | none |
| Reporting (inside Demo) | tenant reads scoped to the cafetería/school | refused under POV | sandbox's own fictional data, read-only | see above |
| Reset | — | none (the only "reset" was the legacy localStorage demo) | `platform_reset_sandbox` (`platform:sandbox:manage`) → **Restaurar escenario inicial** | new |
| Audit | append-only | append-only; POV sessions/links append-only | unchanged; the reset is recorded (Platform audit `sandbox_reset`, `audit_events` `sandbox_reset`) and never deletes audit, request journals or POV history | none |
| Identity | `login_identities`, usernames global | personas have no identity; sandbox could not create identities | sandbox-created staff get real logins with usernames that **must end in `.demo`**; the reset retires them (membership removed, login identity and username released, Auth user purged by the Platform route, person kept inactive) | new |
| Legacy static demo (`NEXT_PUBLIC_PIKAS_DEMO_MODE`) | n/a | localStorage-based Familia/Estudiante/POS demo | unchanged this milestone | § Legacy Demo |

## Provisioning inside the sandbox (explicit branches, no bypass)

- `provisioning_prepare_with_username`: with a current POV it accepts only `cafeteria_staff`, only the POV's
  own sandbox cafetería, and only a username ending in `.demo`; anything else keeps `sandbox_username_unsupported`.
- `pikas_private.sandbox_identity_target(person)`: true only when the current POV is a cafetería admin, the
  account is a sandbox, and every membership of the person lives in that sandbox cafetería (no Platform,
  account or school membership). `identity_support_scope` returns `tenant` for such a target inside the POV
  (real operator = actor), `identity_begin/finish_temporary_access` use
  `require_no_current_demo_except_sandbox_identity` (same `demo_mode_active` for any other target).
- `set_cafeteria_pos_membership` resolves the acting persona and the POV capability (previously `has_capability`
  of the real operator, so `staff_complete` failed inside the POV).
- Login suspension, email change, username change by the Platform and every real-customer path keep refusing a
  current POV. The one-step route (`/api/cafeteria/staff-access`) now admits a sandbox cafetería-admin POV.

## Baseline scenario: Colegio Horizonte — Demo (`horizonte-v1`)

Fixed ids `4c000000-0000-4000-8000-…` (Step 4C dataset), re-created by `pikas_private.sandbox_seed_horizonte`:

- One colegio, one sede (Campus principal), one cafetería (Cafetería Escolar), sharing active with the four
  categories (basic identification, student code, placement, dietary restrictions).
- Personas: **María Carey** (Administradora escolar), **Bruno Mars** (Administrador de cafetería), **José
  Ramírez** (Cajero, assigned to **Caja demo Horizonte** `HZ-01`). Auth-less; opened only through Abrir como.
- Students (DEMO-HZ-001…004): Luna Castillo (RD$1,200.00, limits 350/200), Mateo Ventura (RD$40.00),
  Alma Robles (RD$600.00), Bruno Peña (RD$500.00, wallet frozen); Alma has a milk allergy. All eligible.
- Catalog: Bebidas (Agua natural, Jugo de naranja) and Alimentos (Fruta de temporada, Sándwich de pollo,
  Empanada de vegetales, Yogur natural). Scheduling off.

Enough to open the POS and sell immediately. Additional presets (En configuración, Con actividad) are not built.

## Restaurar escenario inicial (reset)

`platform_reset_sandbox(request_id, account_id)` — `platform:sandbox:manage` (platform_admin), refused while
the operator has a current POV, refused for any non-sandbox account (`sandbox_required`), exact-key journal.

1. Every active POV session on the sandbox ends with `end_reason='sandbox_reset'`.
2. Sets `pikas.sandbox_reset_account` (transaction-local). History-preservation triggers
   (`reject_purchase_history_mutation`, `reject_pos_history_delete`, `reject_wallet_history_mutation`,
   `reject_staff_receivable_mutation`, receipt jobs, approvals, replenishment requests, staff receivables) admit a
   DELETE only when `sandbox_reset_allows(row)` resolves the row to that sandbox account. Truncates and real
   customers stay refused; audit tables are untouched.
3. Deletes operational history children-first: receipts, approvals, refunds, purchases and tenders, register
   sessions and reconciliations, wallet history, wallets, spending controls, students and their placements,
   families/guardians/contacts/affiliations, assignments and cajas, menus/shifts, products/categories,
   invitations and username requests.
4. People created inside the sandbox: memberships removed, login identity deleted, username released, Auth
   user ids returned (the Platform route deletes them with the service role), person kept **inactive** (audit
   rows reference it). Baseline personas are never touched except to restore `active` + names.
5. Re-seeds `horizonte-v1`; writes the Platform audit (`sandbox_reset`) and an `audit_events` row with the
   per-table counts; returns `{deleted, seeded, auth_user_ids, reset_at}`.

Kept on purpose: `audit_events`, `platform_audit_events`, `identity_audit_events`, request journals
(`cafeteria_admin_requests`, `school_admin_requests`, `student_bulk_requests`, `platform_requests`), POV
sessions and operation links, the sandbox structure rows, purchase counters (receipt numbers keep counting).

## Legacy Demo reconciliation

| Decision | What |
|---|---|
| Keep | UX 11 Demo machinery (POV RPCs, Demo bar, conflict screen, departure/recovery helpers), `/platform/demostracion` route (now the Demo Lab), `DEMO_HOME` constants |
| Deprecate (documented, not removed) | `NEXT_PUBLIC_PIKAS_DEMO_MODE` static demo: `components/demo-provider.tsx`, `demo-pos-dashboard.tsx`, `admin-pages.tsx`, `cafeteria-employees.tsx`, `pos-settings.tsx`, `cafeteria-menus.tsx`, `cafeteria-products.tsx`, `register-sessions.tsx`, `admin-shell.tsx`, `lib/family/demo-read.ts`, `app/api/demo/session`, `app/api/menu`, `app/admin/login` (demo-only). Still the only Familia/Estudiante demo and still referenced by `DEMO_GUIDE.md`, `proxy.test.ts`, login/logout route tests, `route-demo-provider.test.tsx`, `demo-foundation.test.tsx`. |
| Remove now | `DemoWorkspace` experience cards as the Demo entry (replaced by the Demo Lab persona cards); the "Entrar como {rol}" launcher on the Platform home when a POV is absent |
| Remove later | the static demo once Familia/Estudiante have sandbox personas (deferred: Padre/Estudiante POVs) and the public-site milestone decides the marketing demo |

## Deferred

- Padre / Estudiante personas (the static demo covers them for now).
- More than one sandbox customer and sandbox creation from the Demo Lab (Platform provisioning stays
  customer-only; a second sandbox needs its own bootstrap migration).
- Additional seed presets. Financial simulation inside the Demo (FIN).
