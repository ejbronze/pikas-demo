# PIKAS local database foundation

Phase 1 establishes the tenant, person, membership and audit foundation. Phase 2 adds school-owned student/family/staff identities and a privacy-filtered cafeteria customer projection. Phase 3A adds DOP student wallets, immutable wallet ledger entries, manually verified replenishments and explicit adjustments. Phase 4A adds cafeteria catalog settings, categories and products. Phase 4B adds cafeteria menus, service scheduling and authoritative catalog saleability. Phase 3B adds authoritative purchase checkout, Phase 3C adds refunds, Phase 4C adds durable register sessions, Phase 5B adds authoritative receipt-print jobs, and Phase 3D adds staff receivables, staff-credit checkout, settlements and eligible refunds. These phases do not connect the application or modify a remote Supabase project.

## Baseline and legacy isolation

`migrations/202609300001_foundation.sql` is baseline 001. `migrations/202610010001_people_families_customers.sql` adds Phase 2. `migrations/202610010002_student_wallet_ledger.sql` adds Phase 3A. `migrations/202610010003_cafeteria_catalog_foundation.sql` adds Phase 4A. `migrations/202610010004_cafeteria_menus_scheduling_saleability.sql` adds Phase 4B. `migrations/202610030001_pos_register_sessions.sql` adds Phase 4C. `migrations/202610040001_purchase_checkout_foundation.sql` adds Phase 3B. `migrations/202610050001_purchase_refunds.sql` adds Phase 3C. `migrations/202610060001_receipt_printing.sql` adds Phase 5B. `migrations/202610070001_staff_receivables.sql` adds Phase 3D. These ten are the only active migrations.

All eight former migrations, from `202608110001_unified_pikas.sql` through `202609210001_pos_financial_foundation.sql`, and the former `seed.sql` are preserved byte-for-byte under `legacy/`. They model the previous architecture and must not be applied before, after, or together with either active migration. They were moved because the CLI automatically scans `supabase/migrations/`; leaving them there would silently build an incompatible schema. Git history also retains their original locations.

The CLI scans only the active migrations directory. `config.toml` selects only `fixtures/foundation.sql` for local seeding; it cannot pick up the archived seed. Historical docs and the removed Auth seeder describe the legacy architecture, not this foundation. Pilot Auth access is invitation-only and requires a separately reviewed bootstrap of a Person and scoped membership; see [the Phase 6A bootstrap guide](../docs/PHASE_6A_BOOTSTRAP.md).

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

`reset` destroys and rebuilds **this local database**, applying active migrations and synthetic fixtures in order. `test` runs all ten pgTAP suites transactionally and rolls their adversarial mutations back. `lint` checks both application schemas and fails on warnings. `stop` stops this local project; no delete-all option is used.

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

## Phase 3B authoritative purchases

- `purchases` are committed immutable sale records; they are not carts, wallet-ledger rows, register sessions, refunds or fulfillment orders. Each requires one open owner session and stores exact tenant/register/session/operator attribution, optional active exact-cafeteria customer identity, minimal customer snapshot, school-timezone/business-date snapshot, DOP currency, total, optional current service/menu attribution, idempotency key/fingerprint, and a cafeteria-scoped `purchase_number`.
- `purchase_items` preserve product UUID, name/version, unit price, positive integer quantity and checked line total. The server revalidates current product version, displayed price, active/available status and saleability. It never silently charges a changed price. Identical duplicate product lines are canonicalized and merged.
- `purchase_tenders` allows exactly one typed cash, student-wallet or staff-credit tender. Cash records received/change, including zero/zero for a free sale. Wallet requires an eligible student cafeteria customer and derives the wallet; zero-total wallet tender is rejected. Staff credit requires an explicitly eligible staff customer and enabled receivable account. Cash never debits a wallet.
- Wallet purchases add a positive `wallet_purchase_debits` source operation and a negative Phase 3A `wallet_ledger_entries` movement. Purchase, items, tender, wallet mutation/ledger if any, daily spend if any and audit commit atomically. Reconciliation continues to sum the same immutable ledger chain.
- `student_spending_controls` is school/student/currency-scoped and School Admin-managed. No row means unlimited. Enabled per-transaction and daily limits apply to both identified student cash and wallet purchases. `student_daily_spend_events` is append-only and school-wide per student/business date/currency; anonymous cash and identified staff cash do not consume student capacity. Phase 3B does not grant family/guardian authority.
- `checkout_purchase(jsonb)` is the only purchase financial writer. It accepts a request key, session UUID, nullable exact cafeteria-customer UUID, canonical product IDs/quantities/version/displayed-price evidence, optional expected total, and cash, student-wallet or staff-credit tender. The database derives the actor, scope, currency, business time/date, active service, prices, customer/student/wallet/receivable, limits, totals, change and purchase number. JSON money inputs are decimal integer strings.
- Phase 4B saleability is revalidated under a shared cafeteria schedule advisory lock. Schedule writers take the matching exclusive lock through additive triggers; independent checkouts can share the read lock. Product rows are share-locked, student/wallet operations follow Phase 2/3A locking, and register/session operations follow Phase 4C lock order.
- Purchase history, tenders, debits and usage have RLS and no direct application writes. Cashiers read their own purchases; Supervisor and Cafeteria Admin purchase reporting is explicit and exact-cafeteria. School Admin manages spending controls but does not gain purchase/student history. At the original Phase 3B checkpoint, refunds, staff credit, fulfillment, printing, inventory, external payment, offline sales, tax/discounts and application integration were out of scope; later additive phases implement refunds, receipt intent and staff credit without rewriting that checkpoint.
- `scripts/test-pos-purchase-races.py` is a local-only independent-connection harness. It requires the `pikas-foundation` project label, Phase 3B migration and empty purchase history. It runs 10 iterations of each of fifteen financial races (150 total), alternating which real RPC remains uncommitted first and requiring an observed `pg_blocking_pids` edge from the contender to that independent backend; it leaves synthetic history, so reset local DB afterward.

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
- Phase 3C refunds, Phase 3D staff credit, fulfillment, reconciliation and application integration remain out of scope.

## Phase 4C POS operations and register sessions

- `pos_cashier` and `pos_supervisor` are independent cafeteria memberships. Cashiers can read the saleable catalog, use the existing explicitly shared customer lookup, and open/read/close their own register session. Supervisors have those same capabilities plus cafeteria-wide open-session reads and exceptional close. The reserved `pos_operator` remains inert for POS operations and retains only customer lookup.
- Cafeteria Admin can grant, suspend, reactivate or revoke either POS membership through `set_cafeteria_pos_membership`; multiple roles for one person and memberships in different cafeterias are independent. Register and assignment management are separate capabilities. Assignments bind an exact active POS membership to one exact cafeteria register; deactivation preserves assignment history.
- `cafeteria_registers` are cafeteria-owned, campus-anchored logical registers with normalized per-cafeteria codes and optimistic versions. Display names/status can change through a versioned RPC. Register codes become immutable after any session history. Direct authenticated table writes and session-table reads are revoked; scoped register/assignment reads and mutations use RLS and narrow RPCs.
- `register_sessions` preserve operator person/membership/role, assignment, register, opening cash, catalog currency, and register-code/name and school-timezone/business-date snapshots. Currency amounts use integer minor units. Opening and closing require bounded idempotency keys bound to payload fingerprints; stale versions and changed-payload retries fail. Open/close and operational changes write safe audit evidence atomically.
- Partial unique indexes enforce at most one open session per register and, globally, per person. Transaction-scoped person locks serialize competing opens and close/recovery transitions. Owners can normally close their own sessions after membership, assignment, register or cafeteria access is revoked, as long as their Auth-linked person remains usable. A Cafeteria Admin or POS Supervisor can exceptionally close another operator's session with a reason and separate recovery-actor evidence, including when the tenant is inactive. Exceptional close never edits the original operator or opening evidence; closed evidence is immutable.
- `scripts/test-pos-session-races.py` is a separate local-only stress test. It checks the Docker project label, Phase 4C migration and empty session history before opening independent database connections. It runs 10 iterations each of same-register open, same-person/two-register open, and competing normal/exceptional close (30 races total). It leaves closed synthetic race rows, so run `scripts/db-foundation.sh reset` afterward. This complements rather than replaces the sequential pgTAP suite.
- Phase 4C establishes operational role/register/session foundations only; checkout is a separate Phase 3B layer and is not connected to the application here.

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

Auth fixture rows have no usable password and exist to simulate verified database subjects in tests. The pending invitation does not create an Auth identity or membership as a side effect. Phase 3A adds only zero-balance synthetic student wallets; Phases 4A and 4B add only synthetic catalog, menu and schedule rows. Phase 4C seeds no session history; Phase 3B seeds no purchase, spending-control or financial history. No real records, secrets, funded balances or financial history are seeded.

Tests switch into actual `authenticated` and `anon` database roles and assert both allowed reads and denied operations. They cover isolation, lifecycle revocation, role escalation, immutable scope, FK forgery, invitation secrecy, Auth removal/unlinking, audit separation/immutability, and RLS denial even when mutation grants are temporarily broadened inside the rolled-back test transaction.

Campus, Phase 2, Phase 3A, Phase 4A, Phase 4B, Phase 4C and Phase 3B tests cover ancestry, lifecycle, enrollment/placement history, family/guardian/staff relationships, exact cafeteria privacy, DOP wallet constraints, manual funding, adjustment authorization, immutable ledger entries, catalog/menu/schedule lifecycle, timezone boundaries, overlap rules, saleability, POS role separation, assignment lifecycle, session recovery, purchase/tender snapshots, spending controls, wallet debits, purchase idempotency, cash change, financial atomicity, direct-write denial and audit. pgTAP exercises transactions sequentially; independent-session schedule, register-session and Phase 3B financial race stress are separate checks. Explicit cafeteria memberships remain independent; sharing one cafeteria never implies access to its sibling.

Student prepaid wallets and their Phase 3A ledger, the Phase 4A catalog, Phase 4B menus/scheduling/saleability, Phase 4C POS role/register/session foundations, Phase 3B purchases, Phase 3C refunds, Phase 5B receipt intent, and Phase 3D staff receivables are implemented locally. Payment providers, reconciliation, fulfillment, inventory and application cutover remain out of scope. Local reset/testing success is not remote deployment or production-readiness certification.

### Phase 3B independent review notes

The counter stores the **last committed allocated number**. Allocation is transactional: rollback (including required audit failure) restores it, so an unexposed rolled-back number may be reused. BIGINT exhaustion raises `22003 / PURCHASE_NUMBER_EXHAUSTED` without wrapping.

Checkout locks active tenant scope, then account/request idempotency advisory (seed 20261006), owner advisory (20261005), exact session membership, active register, active assignment, session, operation settings, conditional shared schedule advisory (20261004), enabled currency, exact customer/share rows, student/person or staff/person, student advisory (seed 0), active enrollment, spending control, wallet only for wallet tender, products in UUID order, and the cafeteria counter. Checks and locks on register/assignment are atomic. Owner fencing precedes membership row locks, consistent with Phase 4C. Settings are share-locked before deciding whether scheduling requires its advisory fence. Manual checkouts take no schedule fence. The per-cafeteria counter serializes the short allocation/commit section, including independent anonymous cash sales; it is not a global cash lock.

Phase 3B implements only positive `purchase` daily events. It has no refund event type, negative compensation, refund writer, or refund authority. A future Phase 3C additive migration can replace the named event checks/guard, add a typed immutable refund source and unique source linkage, and validate negative compensation against the original purchase/date with reviewed same-day capacity rules. No Phase 3B migration rewrite or history update is needed; these future rules are intentionally unimplemented.

The prior scheduled test used UTC weekday for a Santo Domingo school. Production already derives timezone/local weekday from the school in the frozen Phase 4B resolver. The review test configures all seven weekdays with the maximum same-day end time, and adds deterministic UTC/local rollover coverage; it no longer depends on the host's weekday. The last representable microsecond of a day remains outside the end-exclusive test window.

All race workers use actual authenticated RPCs in distinct local PostgreSQL connections. The first successful RPC retains its transaction locks while the contender starts; the harness requires PostgreSQL to report that contender blocked by that backend before committing the first. Both transaction orders are exercised per category. This proves contention and both serialized outcomes; it is not a random high-load or three-way deadlock stress test. The local-only container label, latest migration and clean synthetic fixture checks precede mutation. Reset after the harness before running all seven pgTAP suites and lint.

## Phase 3C — local authoritative refunds

Phase 3C adds `refunds`, `refund_cash_outflows`, `wallet_refund_credits`,
`financial_approvals`, and `cafeteria_refund_policies` in one additive migration.
Frozen migrations and archived SQL remain unchanged. Application integration,
printing, inventory, staff credit, provider refunds, and drawer reconciliation
remain outside this phase.

Refund identity is a UUID. Its human reference is the original purchase number
plus a purchase-scoped `refund_ordinal`. The original purchase row is locked
`FOR NO KEY UPDATE`; a fresh subsequent statement derives both cumulative
refundable value and `MAX(refund_ordinal)+1`. There is no cafeteria refund counter.
`remaining_after_minor` is immutable response evidence only: later authorization
always derives remaining value from original total minus committed refunds.

The four mutation RPCs are `configure_cafeteria_refund_policy`,
`create_purchase_refund_approval`, `revoke_financial_approval`, and
`create_purchase_refund`. `get_purchase_refundability` returns a minimal authorized
projection; table SELECT policies provide scoped refund/child history.
Mutation RPCs require READ COMMITTED and reject other isolation levels with
`UNSUPPORTED_TRANSACTION_ISOLATION` before financial mutation. Decimal minor-unit
strings avoid client floating-point authority. The client never selects a wallet,
currency, customer, tenant, business date, or refund tender destination.

Cash goes back as cash, under the actor's current owned open session in the
original cafeteria. An outflow records an authorized operational attestation;
it cannot prove physical cash handover. RPC replay must never cause another
handover. Wallet refunds need no session and append a positive typed credit and
ledger movement to the original wallet's current balance/version. Frozen wallets
accept historical refund credits and stay frozen. Withdrawal, campus movement,
inactive customer status, revoked sharing, and customer Auth unlinking do not
change the original destination or confer new purchase/funding authority.

Only refunds on the original stored business date append negative
`refund_compensation` spending events. Later-date refunds append no spending event
and never increase today's capacity. Original positive purchase events and all
original sale/tender/debit evidence remain immutable. School-wide student advisory
coordination uses the frozen seed `0` before wallet row locking.

Policies initialize automatically from existing and future catalog settings.
Defaults are override ON and independent Cashier allowance zero. Policy updates
require exact Cafeteria Admin authority, expected version, locking, and audit.
Independent usage is derived by cafeteria, person, business date, and currency;
it includes independent Cashier refunds made while override is OFF. Approved and
Supervisor-direct refunds do not consume that allowance. Policy rows survive
removal of unused catalog settings, preserving frozen orphan-catalog safeguards;
refund execution requires matching current settings and policy currency.

Operational capabilities use the existing `cafeteria:pos:` prefix:
`refund:create`, `refunds:read_own`, `refunds:read`, `refund:approve`, and
`refund:direct`. Configuration uses `cafeteria:refund_policy:configure`.
Cashier receives create/own-read; Supervisor receives all operational refund
capabilities; Cafeteria Admin receives cafeteria-read/configure only. Exact
selected membership governs execution, including a person holding both roles.
School/Account Admin, guardians, students, staff, and Backoffice gain no default
refund authority. Existing School Admin wallet-ledger visibility is preserved.

Approval binds the purchase, cafeteria, requester person and exact membership,
amount, derived currency/tender, reason, normalized notes hash, and cash session.
It **does not bind the refund request key**. Issuance has its own actor-scoped key;
refund execution has a separate actor-scoped key and fingerprints a supplied
approval ID. Approval lasts ten minutes, requires a different currently linked
active Supervisor, reserves no refund capacity, and is consumed only within the
successful refund transaction. Failed transactions preserve unused approval.
Issuer-only revocation is retry-safe. Pending approval loses usability if its
exact approver authority disappears. Authorized committed replay ignores expired
approval, closed sessions, changed policy, and customer/wallet lifecycle changes.

Notes are immutable, at most 500 characters, with outer ASCII whitespace trimmed
and internal text preserved. `other` requires at least three trimmed characters.
Only own or exact-cafeteria authorized refund readers may read notes. Approval
stores a hash; general audit stores identifiers, policy settings, and safe
lifecycle evidence without notes, customer profiles, carts, or wallet balances.

Lock order for new execution: active tenant hierarchy; refund idempotency advisory
(`account:person:key`, seed `20261007`); frozen actor-owner advisory (`20261005`);
exact actor membership; cash register/assignment/session when needed; catalog
settings/policy/currency SHARE; original purchase NO KEY UPDATE; approver authority
and approval UPDATE when supplied; student advisory `0`; original wallet UPDATE;
authoritative clock capture and fresh aggregate decisions; atomic evidence writes.
No approver-owner advisory is taken. No current student/enrollment eligibility
rows are locked after the student advisory. Approval issuance uses seed
`20261008`, does not reserve capacity, and requires no register session.

Run `python3 scripts/test-pos-refund-races.py` after a clean local reset. The
checkpoint matrix targets 31 categories × 10 independent iterations. Backend
blocking is checked through `pg_blocking_pids`; deliberately independent cases
must finish while the leader transaction remains open. The harness validates the
allowlisted local Docker Unix socket, project label, migration, and empty history.
It leaves synthetic artifacts and requires a reset afterward. Expiry/midnight
boundary scenarios temporarily replace the private fixed DB clock with a
DB-owned synthetic fixture clock, restore it in `finally`, and exercise actual
RPCs and locks. No production caller clock override exists.

`--category N --iterations 1` is diagnostic only; it cannot satisfy the checkpoint
matrix. `--frozen3b` runs the unchanged frozen Phase 3B harness with its expected
migration marker adjusted in memory to Phase 3C; clean-reset before that mode.
After final races: reset, verify empty financial artifacts, run the entire pgTAP
suite, lint, syntax/static checks, frozen-file integrity, and Git checks. Keep all
Phase 3C work unstaged and uncommitted until independent adversarial review.

Duplicate approvals from different Supervisors bind an immutable
`prior_matching_refund_id`, derived from committed refunds with the same semantic
fingerprint. Execution re-derives that reference under the purchase lock. Only
one pending approval can authorize that proposal; its unused sibling becomes
stale after the matching refund commits. A fresh approval issued afterward can
authorize a later identical partial refund. This reference is financial history,
not a transport request key, reservation, or mutable counter. The extra race
category checks this cross-Supervisor case.

## Phase 5B receipt printing

`receipt_print_jobs` stores exactly one immutable versioned snapshot for each
committed purchase, created in the checkout transaction by triggers on both
terminal tender-child tables. The snapshot contains authoritative purchase
number/time, business date/timezone, currency and decimal-string amounts, item
names/quantities/prices, cash received/change when applicable, and minimal
school/campus/cafeteria/register labels. It excludes customer, student, staff,
operator and wallet-balance data. A replayed checkout does not create a second
original job.

An original or intentional reprint follows `pending -> dispatching ->
submitted|failed|uncertain`. Claims carry random tokens and a two-minute lease;
only the current claiming actor with an active membership and exact register
assignment can report a result. A stale lease becomes `uncertain`, never
automatically printable again. Definitive failures can return to `pending`;
an uncertain result requires explicit acknowledgement that duplicate output is
possible. `submitted` means only that the local bridge accepted the job, not
that paper was physically printed.

Reprints are separate jobs referencing the original snapshot. They require an
active assigned POS operator, an allowlisted reason, and an account/actor-scoped
idempotency key. A changed payload under the same key conflicts. Claims and
result RPCs do not require an open financial session, so closed sessions do not
strand recovery. Printer hardware identifiers, bridge state, spooler evidence,
and physical print verification remain outside PostgreSQL; fulfillment and
inventory are not part of this phase.

Run `python3 scripts/test-pos-receipt-races.py` after a clean local reset. The
ten-iteration matrix uses independent PostgreSQL sessions to prove claim
exclusion, single-result token consumption, identical-key reprint idempotency,
independence of distinct reprints, and register-authority lock contention.
It leaves local synthetic receipt/purchase artifacts and requires a reset
afterward; no remote database connection is supported.

## Phase 3D staff receivables

`staff_receivable_accounts` holds one DOP account per school staff affiliation.
Only a School Admin can create the account and explicitly enable credit or
change its nullable limit. A zero limit blocks purchases; `NULL` is unlimited.
An active staff affiliation, current campus affiliation, active staff customer
relationship in the exact cafeteria, enabled credit, and a POS Supervisor
session are all required for the `staff_credit` tender. Staff identity or a
cafeteria-customer relationship alone grants no credit.

Staff-credit purchases atomically write the tender, positive immutable charge,
versioned account balance, and the Phase 5B original receipt job. The account
row is the serialization anchor for purchases, settlements, configuration
and refunds. Partial cash settlements require the assigned Supervisor's exact
open session; `bank_transfer` and `other` settlements require an authorized
Supervisor or Cafeteria Admin and retain cafeteria attribution. Every
settlement is a negative immutable ledger entry; no direct balance-edit or
general adjustment path exists.

Staff-credit refunds reduce the same receivable account and obey the
purchase-wide refund ceiling. They never issue cash or wallet value, and they
are rejected if the refund would exceed the currently outstanding amount due.
Thus settled debt is not automatically paid out; an out-of-scope manual payout
process would be needed. Account and ledger history survive staff departure,
campus moves, customer deactivation and login changes, while those changes
prevent new credit purchases. Fulfillment, payroll, collection automation,
payment providers, accounting exports and application integration remain
deferred; application integration is the next step.

`python3 scripts/test-pos-staff-credit-races.py` exercises independent-connection
serialization on the local `pikas-foundation` database after a clean reset.
It leaves synthetic financial rows and requires another local reset; it has no
remote database mode.

## Phase 6B sandbox cashier POV (local backend foundation)

Migration `202610090001_sandbox_pov_pos_actor.sql` adds:

- `accounts.tenant_kind` (`customer` | `sandbox`, default `customer`), immutable after creation; never tenant-writable.
- Platform role `platform_sandbox_operator` (capability `platform:sandbox:pov:enter`, not part of `platform_admin`).
- Private `sandbox_pov_personas`, `sandbox_pov_sessions`, `sandbox_pov_operation_links` (RLS forced, no API grants). Only the `cashier` POV exists.
- `platform_enter_sandbox_pov` / `platform_exit_sandbox_pov` (idempotent, 4-hour TTL, fail closed).
- `pikas_private.pos_actor_person_id()` / `pos_has_capability()`: POS-only actor resolution that returns the sandbox persona while a valid POV is active, otherwise the normal authenticated actor. `current_person_id()` is unchanged. Wired only into register, checkout, catalog, customer lookup and receipt contracts.
- `audit_events.sandbox_pov_session_id` plus operation links preserve persona, real operator (`authenticated_user_id`) and POV session.
- `get_pos_customer_purchase_context(cafeteria, customer)`: cashier-safe pre-sale wallet/limit/spent-today/available-today read; `checkout_purchase` remains the financial authority.

Tests: `supabase/tests/phase6b_sandbox_pov.test.sql`.

Platform roles are independent: a Person may hold several live platform memberships (one per role; partial unique index on `(person_id, role_code)` where status is not `inactive`). `platform_has_capability` / `require_platform_capability` succeed when ANY active membership grants the capability; `platform_get_context` returns the union of capabilities, a `roles` list, and `role` (`platform_admin` when held, otherwise the first role alphabetically). Revoking one membership does not affect the others.

### Sandbox POV read contracts (Phase 6B step 2)

`platform_get_active_sandbox_pov()` returns the caller's own active sandbox demonstration (or null) and `platform_list_sandbox_pov_targets()` lists the active sandbox cashier targets the caller may start. Both require `platform:sandbox:pov:enter`, take no identifiers, are read-only and grant no authority.
