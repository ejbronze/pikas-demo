# PIKAS local database foundation

Phase 1 implements the approved tenant, identity, membership and administrative audit foundation only. It does not connect the application or modify a remote Supabase project.

## Baseline and legacy isolation

`migrations/202609300001_foundation.sql` is baseline 001. It is the **only active migration** in this phase.

All eight former migrations, from `202608110001_unified_pikas.sql` through `202609210001_pos_financial_foundation.sql`, and the former `seed.sql` are preserved byte-for-byte under `legacy/`. They model the previous architecture and must not be applied before, after, or together with baseline 001. They were moved because the CLI automatically scans `supabase/migrations/`; leaving them there would silently build an incompatible schema. Git history also retains their original locations.

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

`reset` destroys and rebuilds **this local database**, applying only the new baseline and synthetic fixtures. `test` runs the focused pgTAP suite transactionally and rolls its adversarial mutations back. `lint` checks both foundation schemas and fails on warnings. `stop` stops this local project; no delete-all option is used.

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

## Authorization boundary

Verified `auth.uid()` maps to an active person. Helpers query **current** active membership and active account/school/campus/cafeteria ancestry. User metadata, email, caller-selected role labels and invitations grant no authority.

Account Admin can read its account and descendant **structural metadata**, account memberships, account invitations and account-level audit. It does not inherit school/cafeteria membership administration, their audit feeds, or future student/POS access.

School Admin can read structural metadata across all campuses and cafeterias of its own school, plus school memberships, invitations and school-level audit. Cafeteria Admin can read its explicitly assigned cafeteria and that cafeteria's parent campus metadata, memberships and cafeteria-level invitations/audit. Parent-campus visibility never grants school authority or sibling-cafeteria access, even on the same campus. Independent assignments to multiple cafeterias are supported; no campus-admin role exists. Neither peer role becomes the other. The reserved `pos_operator` membership grants no capabilities yet.

People can read only their own active person record. Membership holders can see their own membership state within active tenant ancestry, including a suspended membership; this is not operational authority. Suspended/inactive persons cannot use any membership. Tenant deactivation makes its operational reads fail closed without editing descendants. Controlled historical access and exceptional operational reconciliation are later domain work.

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
- Account administrator, separate school/cafeteria administrators, a multi-school person, a separate person explicitly assigned to both A1 cafeterias, a reserved POS membership, an existing identity with only a pending invitation, a suspended person, and an identity used for Auth-deletion tests.

Auth fixture rows have no usable password and exist to simulate verified database subjects in tests. The pending invitation does not create an Auth identity or membership as a side effect. No real records, secrets, students, balances or financial history are seeded.

Tests switch into actual `authenticated` and `anon` database roles and assert both allowed reads and denied operations. They cover isolation, lifecycle revocation, role escalation, immutable scope, FK forgery, invitation secrecy, Auth removal/unlinking, audit separation/immutability, and RLS denial even when mutation grants are temporarily broadened inside the rolled-back test transaction.

Campus review also tests mismatched campus ancestry, immutable cafeteria campus assignment, normalized campus/cafeteria codes, cross-campus isolation, explicit multi-cafeteria assignments, and campus deactivation. Campus changes produce school-scoped audit evidence; cafeteria audit remains cafeteria-scoped.

No later domain or application cutover is included. Local reset/testing success is not remote deployment or production-readiness certification.
