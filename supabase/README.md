# PIKAS local database foundation

Phase 1 establishes the tenant, person, membership and audit foundation. Phase 2 adds school-owned student/family/staff identities and a privacy-filtered cafeteria customer projection. Phase 3A adds DOP student wallets, immutable wallet ledger entries, manually verified replenishments and explicit adjustments. Phase 4A adds cafeteria catalog settings, categories and products. Phase 4B adds cafeteria menus, service scheduling and authoritative catalog saleability. These phases do not connect the application or modify a remote Supabase project.

## Baseline and legacy isolation

`migrations/202609300001_foundation.sql` is baseline 001. `migrations/202610010001_people_families_customers.sql` adds Phase 2. `migrations/202610010002_student_wallet_ledger.sql` adds Phase 3A. `migrations/202610010003_cafeteria_catalog_foundation.sql` adds Phase 4A. `migrations/202610010004_cafeteria_menus_scheduling_saleability.sql` adds Phase 4B. `migrations/202610030001_pos_register_sessions.sql` adds Phase 4C. These six are the only active migrations.

All eight former migrations, from `202608110001_unified_pikas.sql` through `202609210001_pos_financial_foundation.sql`, and the former `seed.sql` are preserved byte-for-byte under `legacy/`. They model the previous architecture and must not be applied before, after, or together with either active migration. They were moved because the CLI automatically scans `supabase/migrations/`; leaving them there would silently build an incompatible schema. Git history also retains their original locations.

The CLI scans only the active migrations directory. `config.toml` selects only `fixtures/foundation.sql` for local seeding; it cannot pick up the archived seed. Existing historical docs and `scripts/seed-supabase-auth.mjs` describe the legacy architecture, not this foundation. Do not run that auth seeder against the foundation.

This baseline is for a clean database. An environment that already applied the legacy chain requires its own reviewed forward migration; do not reset such an environment or rewrite its migration history.

## Local initialization and verification

Prerequisites: the repository's installed Supabase CLI (currently 2.113.0), a running Docker-compatible runtime, and permission to access its socket and the CLI's local configuration directory. The macOS helper locates Docker Desktop even when its CLI is absent from PATH.

From the repository root:

```sh
scripts/db-foundation.sh start
scripts/db-foundation.sh reset
scripts/db-foundation.sh test
scripts/db-foundation.sh lint
```

`start` initializes the isolated `pikas-foundation` database on port 55432. Only the database is started; Auth/API/Studio/Storage and other application services are intentionally excluded. Supabase's local database image supplies the managed `auth` schema and database roles needed by the tests. This phase tests database identity/authorization, not HTTP sign-in.

`reset` destroys and rebuilds **this local database**, applying Phase 1, Phase 2, Phase 3A, Phase 4A, Phase 4B, Phase 4C and synthetic fixtures in order. `test` runs all six pgTAP suites transactionally and rolls their adversarial mutations back. `lint` checks both application schemas and fails on warnings. `stop` stops this local project; no delete-all option is used.

The wrapper accepts one allowlisted action and rejects extra flags. It never accepts `--linked`, `--db-url`, `push`, or `link`. No application environment file is changed. The local configuration does not identify a remote project. Ordinary Supabase commands remain powerful: do not independently link/push/reset a remote project as part of this phase.

The main CLI is required for `start`; the packaged `supabase-go` compatibility executable does not implement Docker startup. If the main CLI reports a telemetry/configuration permission error, resolve local access rather than substituting the compatibility binary or weakening verification.

## Implemented contract

- `accounts -> schools -> school_locations -> cafeterias`, with immutable UUIDs and scope fields, normalized business codes, timestamps and composite ancestry FKs.
- Campus identifiers are unique within a school; cafeteria identifiers are unique within a campus. Cafeterias require a non-null `school_location_id` and a composite `(account_id, school_id, school_location_id)` FK. Campus membership in its school and cafeteria assignment to its campus are immutable.
- Schools default to `America/Santo_Domingo`; supplied timezones must exist in PostgreSQL's timezone catalog.
- Accounts, schools, cafeterias and persons use active/suspended/inactive. Locations use active/inactive.
- `persons` stores display identity, lifecycle and an optional unique Auth link. Auth deletion sets that link to null; it does not delete the person, memberships or historical audit references.
- Three separate membership tables have active/suspended/inactive states. Inactive represents revoked access. A person can independently hold multiple scopes and roles. Existing identity/scope columns cannot be reassigned.
- `invitations` has exactly one effective scope with matching ancestry and role, normalized intended email, inviter, expiry, lifecycle and accepted-person evidence. Store only the SHA-256 hash of a high-entropy random token, never the original token. Expired pending rows grant no rights; a future acceptance writer must check current time and verified identity, not status alone.
- Private, fixed role/capability tables are seeded by migration. There is no editable RBAC API or platform-staff role.

## Phase 2 people and cafeteria identity

- `students` are school-scoped identity records linked to `persons`; they have no wallet or financial fields. Student codes are normalized and unique within a school.
- `student_enrollments` preserve enrollment episodes. `student_campus_placements` preserve effective-dated campus/grade/class placement; campus transfer closes one placement and opens another without changing student identity. Enrollment and placement periods cannot overlap.
- `families` are school-scoped, campus-independent household groupings. `family_student_relationships` allow multiple active families per student and enforce at most one active primary family. Primary is not custody or authority.
- Family and student guardian links point to `persons` and store relationship labels and lifecycle only. They do not grant login or application authority. School contact methods are stored separately and scoped to a school/person.
- `school_staff_affiliations` and `staff_campus_affiliations` are not authorization memberships. Staff status grants no PIKAS access.
- Dietary restrictions are minimal, school-owned student records. They are never stored on persons, families, or cafeteria customers.
- `school_cafeteria_shares` and category rows are exact-cafeteria, school-controlled and deny by default. Categories are basic identification, student code, placement, and dietary restrictions.
- `cafeteria_customers` are explicit cafeteria-scoped links to one student or staff affiliation. They do not copy names, family data, or balances. General/unidentified sales need no customer row.
- School Admin capabilities permit scoped school reads and writes through narrow security-definer RPCs. Direct authenticated table writes remain revoked and there are no write RLS policies.
- `create_school_person` permits a school-authorized student/guardian/staff workflow to establish a business identity without Auth; the identity must still be linked through the corresponding domain relationship. Lifecycle RPCs close relationships and affiliations rather than deleting history.
- Cafeteria roles receive no broad student/family/guardian/contact table access. `cafeteria_customer_projection(cafeteria_id, query)` derives the caller's current cafeteria authority and returns only explicitly shared categories for that exact cafeteria. The reserved POS role gains only this lookup capability.
- Phase 2 mutation triggers add scoped administrative audit in the same transaction. Audit metadata excludes names, contact values, and restriction payloads. School-initiated changes remain school-scoped even when they configure a cafeteria.

## Phase 3A student wallets

- `supported_currencies` currently enables only ISO 4217 `DOP`, with exponent 2. Currency code/exponent are immutable; disabling a currency blocks new wallets and movements without invalidating historical reads or reconciliation. Amounts are signed integer minor units (`bigint`); display formatting is not stored as money.
- `student_wallets` belong to a student at school scope, unique per student/currency. Wallet provisioning is explicit and starts at zero; student/family/campus identity does not create or own money.
- `wallet_replenishments` records a manually verified posting. The authorized initiating person is also recorded as verifier for the pilot; both timestamps are retained. Cafeteria Admin replenishment requires an active exact-cafeteria student customer and active basic-identification share. It does not grant direct wallet or ledger reads.
- `wallet_adjustments` are signed, reason-coded School Admin corrections with required evidence for `other_authorized_correction`. An active student identity may be corrected after withdrawal; ordinary replenishment still requires active enrollment. Cafeteria Admin and POS do not receive adjustment authority.
- `wallet_ledger_entries` are append-only and linked to exactly one posted Phase 3A operation. Deferred constraints verify operation type/amount, contiguous resulting-balance/version chain, and final stored balance/version. The wallet update, operation, entry and scoped audit commit atomically.
- Idempotency keys are account-scoped within each operation type and bound to a SHA-256 payload fingerprint. Wallet row locks serialize funding and adjustments. Provisioning/replenishment share-lock the active enrollment row so they serialize with Phase 2 withdrawal; adjustments require an active student identity but do not require current enrollment. Unique constraints and deferred constraint triggers protect operation/ledger cardinality.
- Wallet statuses are `active` and `frozen`. Withdrawal does not delete or move wallet value. Reconciliation is a read-only School Admin operation comparing stored balance with ledger sum; it never repairs drift.
- Wallets, replenishments, adjustments, and ledger have RLS. School Admins receive school-scoped reads; Cafeteria Admins receive only the narrow replenishment RPC; account admins, POS, staff, guardians, and service_role receive no financial access by implication.
- Purchases, wallet debits, refunds, daily limits, providers/webhooks, cash tender, staff credit, registers/sessions, fulfillment, and application cutover are not part of Phase 3A.

## Phase 4A cafeteria catalog

- `cafeteria_operation_settings` creates exactly one row per cafeteria, defaults to enabled DOP and manual operation, and keeps currency immutable in this phase. Product prices are integer minor units interpreted through the cafeteria's catalog currency.
- Cafeteria-scoped categories have normalized unique labels, ordering, active/archive lifecycle and optimistic versions. Products have optional same-cafeteria categories, integer nonnegative prices, bounded ingredient/allergen metadata, optimistic versions, and distinct `active` and `available` states. Zero-price and uncategorized products are valid.
- Cafeteria Admin catalog capabilities are explicit; scoped read RLS is paired with narrow SECURITY DEFINER mutation RPCs, immutable tenant identity, stale-version checks and same-transaction audit. Direct authenticated mutations remain revoked with no write policies. Account Admin, School Admin, POS, anonymous and service roles receive no catalog authority by implication.
- Synthetic fixtures cover same-name categories in separate cafeterias, active/available and unavailable products, an inactive product, and zero-price/uncategorized cases. Tests include cross-cafeteria access, authorization denial, direct-write denial despite broadened grants, lifecycle/version behavior and audit.
- Scheduling is a configuration flag only. Menus, schedules, stock, employees, shifts, registers/sessions, purchases, fulfillment, POS integration and application cutover are not part of Phase 4A.

## Phase 4B menus and saleability

- `cafeteria_menus` has stable cafeteria-owned identity, normalized case/outer-whitespace name uniqueness within a cafeteria, active/archive lifecycle and optimistic versions. `cafeteria_menu_products` is a many-to-many presentation relationship with display order and an active flag; it does not copy product price, currency or availability. Product identity remains authoritative in Phase 4A.
- `cafeteria_service_shifts` references one menu in the exact cafeteria and stores a same-day local wall-clock interval with `start_time < end_time`; overnight ranges are rejected. `cafeteria_service_shift_days` stores normalized ISO weekdays: Monday=1 through Sunday=7. Intervals are start-inclusive and end-exclusive.
- Schedule mutations take a transaction-scoped advisory lock keyed by cafeteria before overlap validation and writing shifts/days. Enabled windows may be adjacent but cannot overlap on the same cafeteria/weekday; disabled overlaps may remain configured and are revalidated on enable. This serializes application mutation RPCs; independent-session race stress remains a pre-production gate.
- Service resolution converts the supplied/current instant using the parent school’s stored IANA `business_timezone`; no cafeteria timezone or hardcoded offset is introduced. The private resolver accepts an instant for deterministic database tests and is not executable by application roles. The public saleability RPC accepts only a cafeteria ID and always uses database `now()`.
- Local wall-clock resolution follows PostgreSQL IANA timezone conversion: a window wholly inside a spring-forward gap has no active instant; during a fall-back repeated hour, matching local times resolve in both occurrences. No separate ambiguity policy is imposed in this pilot.
- Scheduling OFF returns exact-cafeteria products that are active, available, and backed by enabled catalog currency, without requiring menu membership or an active shift. It does not mean closed. Scheduling ON returns products assigned to the unique active menu/service for the local weekday/time; no service, inactive menu, disabled currency or corrupted multiple matches fail closed to an empty product list.
- `get_cafeteria_saleable_catalog(cafeteria_id)` returns a narrow JSON projection with mode/status, local business date/timezone, optional service/menu context and eligible product IDs, names, descriptions, category, current `price_minor`, currency and version. It requires current exact-cafeteria catalog-read authority. Phase 4C additively grants `cafeteria:pos:catalog:read` to active Cashier and Supervisor memberships; register assignment is not required for catalog reads. Saleability semantics are unchanged.
- Menu, assignment, shift and weekday mutations use narrow versioned SECURITY DEFINER RPCs and same-transaction safe audit. Menu deactivation preserves assignments and shifts; product inactivity/unavailability filters saleability without deleting menu membership. No menu-specific price or availability override exists.
- Phase 3B checkout, purchases, purchase snapshots, tenders, wallet debits, refunds, fulfillment, reconciliation and application integration remain out of scope.

## Phase 4C POS operations and register sessions

- `pos_cashier` and `pos_supervisor` are independent cafeteria memberships. Cashiers can read the saleable catalog, use the existing explicitly shared customer lookup, and open/read/close their own register session. Supervisors have those same capabilities plus cafeteria-wide open-session reads and exceptional close. The reserved `pos_operator` remains inert for POS operations and retains only customer lookup.
- Cafeteria Admin can grant, suspend, reactivate or revoke either POS membership through `set_cafeteria_pos_membership`; multiple roles for one person and memberships in different cafeterias are independent. Register and assignment management are separate capabilities. Assignments bind an exact active POS membership to one exact cafeteria register; deactivation preserves assignment history.
- `cafeteria_registers` are cafeteria-owned, campus-anchored logical registers with normalized per-cafeteria codes and optimistic versions. Display names/status can change through a versioned RPC. Register codes become immutable after any session history. Direct authenticated table writes and session-table reads are revoked; scoped register/assignment reads and mutations use RLS and narrow RPCs.
- `register_sessions` preserve operator person/membership/role, assignment, register, opening cash, catalog currency, and register-code/name and school-timezone/business-date snapshots. Currency amounts use integer minor units. Opening and closing require bounded idempotency keys bound to payload fingerprints; stale versions and changed-payload retries fail. Open/close and operational changes write safe audit evidence atomically.
- Partial unique indexes enforce at most one open session per register and, globally, per person. Transaction-scoped person locks serialize competing opens and close/recovery transitions. Owners can normally close their own sessions after membership, assignment, register or cafeteria access is revoked, as long as their Auth-linked person remains usable. A Cafeteria Admin or POS Supervisor can exceptionally close another operator's session with a reason and separate recovery-actor evidence, including when the tenant is inactive. Exceptional close never edits the original operator or opening evidence; closed evidence is immutable.
- `scripts/test-pos-session-races.py` is a separate local-only stress test. It checks the Docker project label, Phase 4C migration and empty session history before opening independent database connections. It runs 10 iterations each of same-register open, same-person/two-register open, and competing normal/exceptional close (30 races total). It leaves closed synthetic race rows, so run `scripts/db-foundation.sh reset` afterward. This complements rather than replaces the sequential pgTAP suite.
- Phase 4C establishes operational role/register/session foundations only; it does not implement sales or connect the application.

## Authorization boundary


Account Admin can read its account and descendant **structural metadata**, account memberships, account invitations and account-level audit. It does not inherit school/cafeteria membership administration, their audit feeds, or student/POS access.

School Admin can read structural metadata across all campuses and cafeterias of its own school, plus school memberships, invitations and school-level audit. Cafeteria Admin can read its explicitly assigned cafeteria and that cafeteria's parent campus metadata, memberships and cafeteria-level invitations/audit. Parent-campus visibility never grants school authority or sibling-cafeteria access, even on the same campus. Independent assignments to multiple cafeterias are supported; no campus-admin role exists. Neither peer role becomes the other. The reserved `pos_operator` membership grants only `cafeteria:customer:lookup`, not base-table or write access; the separate `pos_cashier` and `pos_supervisor` roles receive only the operational capabilities listed above.

People can read their own person record. School Admins can also read person identity only when linked to a record in their authorized school; unrelated schools remain isolated. Membership holders can see their own membership state within active tenant ancestry, including a suspended membership; this is not operational authority. Suspended/inactive persons cannot use any membership. Tenant deactivation makes its operational reads fail closed without editing descendants. Guardian relationships and staff affiliations do not grant authority.

RLS is enabled on every foundation table, including the private role catalog. Client grants are explicit; private authorization helpers have an empty search path and only required execution grants. Invitation column grants exclude the token hash. The private schema is not exposed by the Data API.

**Phase 1 exposes read capabilities only.** There are no authenticated INSERT/UPDATE/DELETE/TRUNCATE grants or mutation policies. There is no invitation acceptance, person-linking, membership-management, or provisioning RPC. Initial synthetic setup uses the trusted local database owner. Service-role writes are not the normal authorization mechanism and receive no foundation table grants here. Later authorized management APIs must enforce capabilities, protected fields, tenant consistency, actor evidence and audit atomically before writes are exposed.

## Audit foundation

Foundation changes automatically append an audit event in the same transaction. Events contain target identity, valid tenant ancestry, action/outcome, timestamp, optional authenticated actor and selective status/role changes. Person-only maintenance events have no customer scope and are not customer-readable.

The current writer is explicitly marked `database_maintenance` / `system`; it does not invent an application administrator identity. The event contract includes effective role/scope and optional request UUID for later narrowly authorized application writers. Those writers must provide verified role/scope and correlation evidence rather than trusting client-supplied audit fields.

Automatic metadata deliberately excludes names, email addresses, Auth linkage values, invitation hashes and secrets. The historical authenticated UUID is stored separately without a cascading Auth FK. Event UPDATE, DELETE and TRUNCATE are rejected; customer reads are domain-scoped. Trusted database owners can change schema/triggers, so this is application immutability, not tamper-proof protection from a database administrator. Rejected operations require future separate security logging; audit rows in a rolled-back transaction cannot survive that rollback.

## Synthetic fixtures and tests

`fixtures/foundation.sql` creates only `example.invalid` identities and synthetic records:

- Account A: school A1 has campuses A1-L1/A1-L2 with cafeterias A1-C1/A1-C2; school A2 has its own campus/cafeteria.
- Account B: school B1 with its own campus/cafeteria.
- Account administrator, separate school/cafeteria administrators, a multi-school person, a separate person explicitly assigned to both A1 cafeterias, a reserved POS membership, Phase 4C Cashier/Supervisor memberships across cafeterias and roles, four registers and five register assignments, an existing identity with only a pending invitation, a suspended person, and an identity used for Auth-deletion tests.
- Phase 2 students with campus placement/transfer history, siblings at different campuses, multiple family links, guardians, a staff affiliation, a restriction, student and staff cafeteria customers, and sharing enabled only for one cafeteria.

Auth fixture rows have no usable password and exist to simulate verified database subjects in tests. The pending invitation does not create an Auth identity or membership as a side effect. Phase 3A adds only zero-balance synthetic student wallets; Phases 4A and 4B add only synthetic catalog, menu and schedule rows. Phase 4C seeds no session history. No real records, secrets, funded balances or financial history are seeded.

Tests switch into actual `authenticated` and `anon` database roles and assert both allowed reads and denied operations. They cover isolation, lifecycle revocation, role escalation, immutable scope, FK forgery, invitation secrecy, Auth removal/unlinking, audit separation/immutability, and RLS denial even when mutation grants are temporarily broadened inside the rolled-back test transaction.

Campus, Phase 2, Phase 3A, Phase 4A, Phase 4B and Phase 4C tests cover ancestry, lifecycle, enrollment/placement history, family/guardian/staff relationships, exact cafeteria privacy, DOP wallet constraints, manual funding, adjustment authorization, idempotency, immutable ledger entries, reconciliation, catalog/menu/schedule lifecycle, timezone boundaries, overlap rules, saleability, POS role separation, assignment lifecycle, register/session snapshots, session idempotency, close/recovery authority, direct-write denial, Auth unlinking and audit. pgTAP exercises transactions sequentially; local independent-session schedule and register-session race stress are separate checks. Explicit cafeteria memberships remain independent; sharing one cafeteria never implies access to its sibling.

Student prepaid wallets and their Phase 3A ledger, the Phase 4A catalog, Phase 4B menus/scheduling/saleability, and Phase 4C POS role/register/session foundations are implemented locally. Purchases/debits, refunds, daily spending limits, payment providers, staff receivables, reconciliation and application cutover remain out of scope. Local reset/testing success is not remote deployment or production-readiness certification.
