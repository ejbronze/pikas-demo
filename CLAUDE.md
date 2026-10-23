# PIKAS engineering handoff

PIKAS connects school families, students, cafeteria POS and administration.
The current objective is a controlled Beta 1 pilot. Phase 4D production
administration/provisioning is closed; its accepted source is `df802b530b3cab4a92140f7d7b9a025e36f2b9c7`,
with documentation checkpoint `5b2968df2e8a7e725eee467adedc91668a280f2f`.
Phase 5A adds local transaction/register operations and close reconciliation; see
`docs/PHASE_5A_TRANSACTION_REGISTER_OPERATIONS.md`. Phase 5A production acceptance passed with one documented follow-up: re-verify
closed-register POS rejection during a future controlled pilot/operator session
with valid credentials; never reopen or mutate completed BETA-01 for this proof.
Read the current canonical baseline before treating historical demo notes as current.

Read `README.md`, `docs/PRODUCT_BASELINE.md`, `docs/FEATURE_CATALOG.md`,
`docs/MVP.md`, `docs/CHANGELOG_PRODUCT.md`, relevant `docs/security/` reports,
`docs/ADMINISTRATION_AND_PERMISSIONS.md`, `docs/POS_FINANCIAL_MODEL.md`,
`supabase/README.md`, relevant migrations/tests and applicable `AGENTS.md`.
Code and current contracts resolve ambiguity in older documentation.

## Durable rules

- Auth identity, Person, membership and effective sandbox persona are distinct.
  Derive authority on the server/database; revalidate after lock waits. Activation
  alone grants no tenant membership or business authority. Reuse capability guards.
- Money uses integer minor units; preserve immutable purchases, receipt identity,
  session attribution, atomic ledger writes and durable actor/payload-bound request
  keys. Retry an uncertain mutation with exactly its original key and payload.
  A failed recovery request does not establish that the original write failed.
- Register identity and session identity are distinct. Preserve one open session
  per register/operator. Own close and exceptional administrative recovery have
  different authority; closed sessions cannot reopen or accept sales.
- Migrations are additive. Never rewrite committed migrations or financial history.
  Reuse existing financial locks, RPCs, connected administration, shared navigation,
  schemas and recovery journals. Avoid speculative redesign or unrelated refactoring.
- Sandbox is an explicit tenant/POV boundary, never a global identity replacement.
  Preserve real operator plus effective persona audit attribution. Never mix sandbox
  financial data into customer reporting. A POV grants only its approved capabilities.
- Local authorization does not authorize production: no production data access,
  migrations, configuration, push or deployment without explicit owner approval.
  Use fictional local fixtures; never copy production data into local environments.

## Verification

Run focused unit/API/database and touched POS/authority regression tests, production
build and local production-mode browser journeys at mobile/tablet/desktop widths.
Observe actual `pg_blocking_pids` blocking in independent-session race tests.
The database-only wrapper is `scripts/db-foundation.sh`; the complete current
migration chain requires managed Auth columns. For it use the documented local-only
`scripts/setup-step4d6-local.py` environment and isolated loopback browser adapter.
Do not alter production endpoint guards to run local tests. Report failed or missing
gates; do not call a milestone complete or commit it before required checks pass.

## Phase 5 to Beta

Phase 5: transaction/register operations (5.1 and register-close foundation for 5.4),
then wallet/PIKAS Cash replenishments (5.2), refunds (5.3), reporting/reconciliation
(5.4), platform analytics (5.5). Existing backend foundations do not establish a
complete connected product for these phases. Phase 6 targets financial, authority,
concurrency and operational hardening. Phase 7 prepares pilot operations/readiness.
Implement only the explicitly approved milestone.

Targeted follow-up: newly enrolled **Sol Ficticia Beta** was absent from POS student
search during 4D.8. Do not investigate/fix unless directly relevant to approved work.

## PIKAS mascot
The mascot system lives in docs/pikas-mascot-system/.
Before any UI work involving the mascot, loaders, empty states, success
messages, session timeouts or the public website, read
docs/pikas-mascot-system/AGENT_BRIEF.md and follow it.
Asset metadata: docs/pikas-mascot-system/brand/mascot/manifest.json.
Never edit the approved PIKAS logo.