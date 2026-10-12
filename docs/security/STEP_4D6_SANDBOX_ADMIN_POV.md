# Step 4D.6 sandbox administration POV

One additive migration extends the existing explicit temporary sandbox sessions
with school_admin and cafeteria_admin. Global current_person_id(),
has_capability(), tenant RLS, and all 23 frozen migrations remain unchanged.

## Local baseline and validation

The committed Step 4C test fixture (`supabase/tests/step4c_pilot_ready.test.sql`)
defines fictional local hierarchy/operator/José identities. The unchanged
executable bootstrap in `202610090006_horizonte_pilot_ready.sql` defines the
four students, placements, sharing, balances/controls/restrictions, six products
and HZ-01. The local helper reads these from Git HEAD. Canonical hierarchy codes
are the codes explicitly supplied for 4D.6, replacing only synthetic test aliases.
No production data or identity is accessed/copied.

`python3 scripts/setup-step4d6-local.py` initializes an isolated local project
under `/private/tmp/pikas-4d6-local`, ports 55641/55642. It initializes GoTrue
before the normal local reset because frozen 4D.5 requires the managed Auth
column email_confirmed_at absent from the database-only foundation image.
The reset recreates SYNTHETIC-A/B through their existing foundation seed and
`setup-local-horizonte.py --web` restores Horizonte. Replays validate the
committed pilot manifest and never refill wallets, reset sales, or overwrite
admin edits. Local fixture helpers accept no remote target/URL.

Run focused SQL against `supabase_db_pikas-4d6`, after local setup:

```
docker exec -i supabase_db_pikas-4d6 psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/step4d6_sandbox_admin_pov.test.sql
python3 scripts/test-step4d6-pov-locks.py
```

The SQL test rolls back. Races use distinct sessions and pg_blocking_pids; the
final persona-deactivation cases deliberately leave both admin registrations
inactive. Re-run local setup afterward to restore clean fictional data.

`node scripts/test-step4d6-browser.mjs` creates a real local Auth-only synthetic
platform operator and verifies the connected flows. It stages the application
under `/private/tmp/pikas-4d6-browser`; only that isolated copy replaces the
HTTPS-only URL config with an exact loopback test adapter. Repository production
config is unchanged. Screenshots and the local server log remain in that folder.

## Authority and identity

Each admin persona is an Auth-less Person with exactly one scoped membership;
the real operator receives no tenant membership. School persona IDs end in
0001/0011/0021 (Person/membership/registration); cafeteria equivalents end in
0002/0012/0022, under the `4d600000-0000-4000-8000-` namespace. Both operators
share the same personas and sandbox dataset, but retain independent POV sessions.

The common resolver validates the exact session/initiator Auth and Person,
platform capability, persona/membership, sandbox hierarchy, and expiry. The
cashier-only resolver rejects wrong-type or invalid active attempts. Admin
helpers allow only the existing connected operation capabilities in exact scope;
normal customer authority is preserved without a POV. School POV is intentionally
anchored to Horizonte's existing cafeteria/campus launcher context.

Only an explicit allowlist of nested school and cafeteria RPCs uses the scoped
helpers. No global identity/capability function, broad RLS, financial RPC, or
production impersonation mechanism changes. The caller cannot supply effective
Person/membership IDs. José's confirmed-Auth staff-management restriction stays.

## Lock waits, audit and recovery

Commands capture the original POV before waiting. Existing real/persona/scope
locks remain; initiating platform/persona authority is also locked. Revalidation
runs after authority locks and before recording success. AFTER STATEMENT guards
on only connected administration write tables catch waits inside row, FK and
business triggers, rolling the entire command back if its captured session has
exited, switched, expired or become invalid. Transaction-local context identifies
the captured session; it never grants authority and is checked against the
private registry and real Auth identity. New helper EXECUTE privileges are revoked.

Request rows preserve their originating session; actor_auth_id and effective
actor still bind replay, denying cross-operator reuse. Same-operator recovery
with the identical request and payload remains possible after authorized reentry
into the same persona/scope. Client recovery journals retain pending keys/payloads
and use real operator + effective persona to avoid sharing a journal across
operators who use the same persona. Normal customer journal keys are unchanged.
Audit events retain authenticated operator, effective persona, POV code/session,
and scope. Cashier audit metadata and operation links remain as before.

The existing launcher exposes three experiences and confirms the corresponding
connected context before navigation. Admin shells add only real-operator/demo
context, expiry, return and exit controls. Existing admin interfaces are reused.

No production activation is part of this change. No commit/push/deployment.

## Interrupted-session recovery verification

Recovered files were intact; no implementation restart or reset was required.
Final checks: 58 focused rollback-only SQL assertions, 94 affected web tests,
TypeScript and affected-file ESLint passed. Focused public/pikas_private DB lint
returned zero warnings. Three POS read callers now explicitly use VOLATILE in
the additive migration to match the fresh sandbox authority resolver.

The real local API browser run passed School Admin (all four students),
Cafeteria Admin (all six products, José and HZ-01), and cashier POS, including
exit/reentry between experiences and zero page errors. The harness waits for
hydration before exit and for destination navigation before examining content.
Artifacts: /private/tmp/pikas-4d6-browser/{school-roster,cafeteria-products,
cafeteria-register,cashier-pos}.png and verification.txt/server.log.

The interrupted session established all 12 independent-session concurrency
cases with pg_blocking_pids evidence and unchanged denied-command targets and
request journals. Recovery did not repeat that matrix: subsequent corrections
are read-function volatility declarations and browser harness waits, not changes
to the command lock/revalidation implementation. A later added audit-absence
assertion in the race harness has not been separately rerun during recovery.

Original local baseline inventory still contains SYNTHETIC-A/B and active
sandbox Horizonte, Auth-less José and both admin personas, and zero Edwin
account/school/cafeteria memberships. All 23 frozen migrations remain byte-identical
to Git HEAD; git diff --check passes. Changes remain uncommitted.
