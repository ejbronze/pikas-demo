# Lifecycle & Access Management — matrix

Audited 2026-10-23 against the local migration chain (66 + this milestone's 202611160001). The matrix records the
database truth first and the product decision second. Vocabulary is locked: **Suspender** (temporary, reversible),
**Desactivar / Inactivar** (kept, unavailable for normal operation), **Cerrar / Archivar** (lifecycle ended, history
read-only), **Eliminar** (never a normal action for records with history).

## Database truth that drives everything

- `pikas_private.scope_active(account, school, cafetería)` is the single gate behind every tenant capability: it
  requires `accounts.status='active'`, `schools.status='active'`, `cafeterias.status='active'` **and**
  `school_locations.status='active'`. Deactivating a sede therefore makes its cafeterías unavailable without
  touching their rows; deactivating a cafetería stops its admin, its POS and its commands at once.
- Platform support reads (`platform_support_cafeteria_*`) do **not** require an active scope: a closed cafetería
  stays readable for history. Platform support commands still refuse inactive scopes through the tenant guards.
- Status columns already exist for every entity below; no table or column is added. The milestone adds three
  Platform commands over those columns and one self-scoped read.

| Entity | States (column) | Action (UI words) | Authority | Reversible | Dependent data | Login | POS | Reporting / history | PIKAS Cash | UI before | UI after | Migration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cliente | `accounts.status`: active, suspended, closed (`inactive` allowed, unused) | Suspender · Reactivar · Cerrar cliente · Reabrir cliente (`platform_set_customer_lifecycle`) | `platform:tenant:lifecycle:manage` | Suspend yes; close reopenable | All kept (scope_active blocks use) | Tenant sign-in denied with `organization_suspended/closed` | Blocked | Kept | Kept; no activation change | Estado section | Estado section, clearer consequences | No |
| Colegio | `schools.status`: active, suspended, inactive | None offered: a colegio follows its customer | — | — | — | — | — | — | — | Read-only status | Read-only status, documented | No |
| Sede | `school_locations.status`: active, inactive | **Desactivar sede · Reactivar sede** (`platform_set_customer_structure_status`, kind `location`) | `platform:tenant:lifecycle:manage` | Yes | Cafeterías, cajas, staff, transactions kept; cafeterías become unavailable while the sede is inactive (their own status unchanged) | Unchanged | Blocked for its cafeterías | Kept | Kept | None | Estructura · «Cambiar estado» | **Yes (function only)** |
| Cafetería | `cafeterias.status`: active, suspended, inactive | **Suspender cafetería · Desactivar cafetería · Reactivar cafetería** (same command, kind `cafeteria`) | `platform:tenant:lifecycle:manage` | Yes (reactivation requires an active sede) | Cajas, staff memberships, assignments, products, transactions, refunds, audit, sharing rows kept | Unchanged | Blocked (`scope_active`); an open caja must be closed in the POS first (`open_register_sessions_block_lifecycle`) | Kept; Platform support reads still work | Kept | None | Estructura · «Cambiar estado»; Operación still lists it as historical | **Yes (function only)** |
| Caja | `cafeteria_registers.status`: active, inactive | Activa / Inactiva (`register_save`; Cafetería Admin and Platform support) | `cafeteria:registers:manage` / `platform:customer:operations:manage` | Yes | Sessions, purchases, assignments kept; `has_history` blocks code changes | — | Inactive caja cannot open a session | Kept | — | Editar caja | Editar caja, consequences in copy | No (no `Archivada`: inactive already carries the meaning) |
| Persona | `persons.status`: active, suspended, inactive | None (no person archive): memberships model the lifecycle | — | — | — | — | — | — | — | — | Documented | No |
| Membresía cafetería (admin / POS) | `cafeteria_memberships.status`: active, suspended, inactive | Cafetería Admin: Suspender/Retirar acceso a {cafetería} (`staff_status`). Platform: **Suspender acceso a {cafetería} · Desactivar acceso · Reactivar** (`platform_set_customer_membership_status`) | `cafeteria:pos:memberships:manage` / `platform:customer:access:provision` | Yes (reactivation needs an active confirmed login) | Assignments and history kept | Unchanged (scope only) | POS denied for that cafetería | Kept | — | Personal POS (cafetería); none on Platform | Personal POS; Platform person sheet | **Yes (function only)** |
| Membresía colegio (school_admin) | `school_memberships.status`: active, suspended, inactive | Account admin: `admin_status` (active/suspended). Platform: same command, scope `school` | `platform:customer:access:provision` | Yes | Kept | Unchanged | — | Kept | — | Administradores (colegio) | + Platform person sheet | Same function |
| Asignación de caja | `cafeteria_register_assignments.status`: active, inactive | **Quitar asignación de {caja}** / Asignar (`assignment_save`) | `cafeteria:register_assignments:manage` / `platform:customer:operations:manage` | Yes | Sessions kept | — | Cannot open that caja | Kept | — | Cajas (cafetería) | + Platform person sheet | No |
| Inicio de sesión (identidad) | `login_identities.login_suspended_at` | **Suspender inicio de sesión en PIKAS · Reactivar** (`identity_set_login_suspended`, reason required, ends sessions, Auth ban mirrored) | `platform:identity:support` only | Yes | Memberships and history kept | Blocked everywhere | Blocked everywhere | Kept | — | Credenciales | Credenciales, deliberate confirmation naming the scope | No |
| Estudiante | `students.status`: active, suspended, inactive; `student_enrollments.status`: active, withdrawn, completed | Suspender · Inactivar (`set_student_status`; inactivar requires no active matrícula) · **Retirar matrícula** (`withdraw_student_enrollment`, end date, never future) · re-enroll (`enroll_student`) | `school:students:manage` | Suspend yes; withdrawal keeps the student and allows a new enrollment | Enrollment, placements, wallet, purchases kept | — | Student not eligible for POS while not active | Kept | Wallet kept (status separate) | Estudiantes | Estudiantes, consequences in copy | No |
| Producto / categoría / menú | `products.active`/`available`; `categories.status` active/archived; `menus.status` | Existing editor words (Activo/Inactivo, Disponible/Agotado, Archivada) | Cafetería | Yes | Transaction history kept | — | Not sold | Kept | — | Productos | Unchanged | No |

## Dependency behaviour (explicit)

- **Sede deactivated** → its cafeterías stay with their own status rows but every tenant authority on them is
  refused by `scope_active`; the Platform's Operación lists them as «Sede inactiva · historial», one-step POS
  access and caja options exclude them, and reactivating the sede restores them (a cafetería suspended or
  deactivated on its own stays so). A cafetería cannot be reactivated under an inactive sede (`location_inactive`).
  No cascade is written.
- **Cafetería suspended/deactivated** → admin, POS, commands and student lookup stop; sharing and eligibility rows
  are untouched (the School still sees its sharing state); reporting and Platform support reads keep working.
  Refused while a register session is open.
- **Caja inactive** → no new session; assignments remain; sessions and purchases remain.
- **Membership suspended/inactive** → that scope only; identity, other memberships and assignments remain.
- **Login suspended** → every scope at once; nothing else changes.
- **Customer suspended/closed** → everything beneath is blocked by `scope_active`; nothing beneath changes.

## Deferred (not built here)

- Cross-customer linking of a username-only person: `require_customer_person` keeps Platform linking inside one
  customer by design; a person who must serve two customers needs an identity-governance decision.
- Account-admin membership lifecycle on the Platform (the customer's own administrators manage it).
- Settlement rules for closing a cafetería/customer with unresolved financial obligations (FIN).
- Legal/privacy deletion: a separate privileged data-governance workflow.
