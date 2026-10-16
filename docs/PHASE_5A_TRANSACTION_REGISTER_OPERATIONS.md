# Phase 5A — Transaction & Register Operations

Local milestone, 2026-10-16. Production remains the accepted Phase 4D baseline.
This milestone covers 5.1 plus the register-close foundation for 5.4; it does not
complete Phase 5 or introduce replenishment, refund, reporting-dashboard or
platform-analytics product flows.

## Architecture and product decisions

The connected Cafeteria Administration routes `/admin/cafeteria/transacciones`
and `/admin/cafeteria/cajas` use committed purchases, items, tenders, original
receipt snapshots and durable register sessions. History is newest first,
25 records per page with an extra look-ahead row. Session sales paginate
independently. No financial history comes from demo/client storage. Cash, wallet
and the independently existing staff-credit tender are represented truthfully.
Product names/prices/customer names are committed purchase snapshots; operator
and closing-person names resolve the durable Person IDs. The immutable original
receipt retains the original establishment names where available.

Cajas retains its existing configuration/assignment UI and adds session history,
opening/operator, status, starting cash, cash movement totals, counted/expected
cash, difference, closer and close time. Session detail links sales to receipt
level detail and identifies existing cash refunds and staff-account collections.
No charts or broad reports were added.

Existing authority is stronger than a generic admin-close model: a cashier closes
its own session; an administrator recovers another operator's session through
**exceptional close**, with explicit reason/note rules. This milestone preserves
that distinction and adds explicit confirmation to both connected close surfaces.
No role, capability grant or frozen authority helper was changed.

## Cash and permanence

All amounts are integer minor units, transported as decimal strings. Aggregate
cash arithmetic uses PostgreSQL numeric and JavaScript BigInt, avoiding rounded
JavaScript numbers. The expected amount is:

`opening cash + cash purchase totals + cash staff receivable settlements − cash refund outflows`

A cash purchase contributes its total (received minus change), not the amount
handed to the cashier. Wallet and staff-credit sales contribute zero physical
cash. Existing manual wallet replenishments have no register-session cash
attribution and are not invented as register movements. Future Phase 5 movements
must supply authoritative session attribution and participate in the established
session locking before they can enter this formula.

An administrator reviews authoritative expected cash, enters counted cash, and
explicitly confirms. The RPC obtains owner/actor advisory locks in the existing
sorted order, then register and session locks; it revalidates authority and checks
the reviewed expected amount under the lock. Changed expected cash rejects the
close and requires a new review. It delegates the permanent transition/audit to
the existing exceptional-close RPC. Cash writers already lock these records,
so committed sales/outflows precede close or fail against the closed session.

Migration `202610160001_transaction_register_operations.sql` creates a private
immutable close-reconciliation table and an AFTER UPDATE trigger. Every new
successful close, including existing own/exceptional RPC callers, atomically
captures its system-derived cash summary and `counted − expected` difference.
Exact retries do not capture again. No financial fact, committed migration or
old close is rewritten. Pre-5A closes show a derived summary explicitly labeled
as lacking a close-time capture. No ordinary reopening or editing exists.

The original closed session no longer satisfies POS readiness. Further selling
requires an explicit supported opening; nothing silently opens a new session.

## Authority, sandbox and recovery

Server-side Auth context scopes the cafeteria target. Database guards derive the
actor, account, school/campus/cafeteria and active membership again. Reads require
existing purchase/session read capability; close requires existing exceptional
close capability. Cashiers, school-only admins, platform-only actors and other
cafeterias/accounts gain no administrative financial access. Private tables and
helpers have no client/service-role grants; public RPC execution is authenticated
only and the existing application-session pre-request guard remains active.

The frozen admin sandbox POV capability allowlist deliberately excludes financial
history and exceptional close. The new UI explains this limitation and the RPC
enforces it; this milestone does not broaden Phase 4 sandbox authority. Existing
cashier sandbox operations retain their effective persona and authenticated real
operator audit semantics. Cash summaries are always session-scoped; customer
history never aggregates another account or sandbox.

Admin close requests use a UUID plus the existing private cafeteria request journal,
bound to real Auth identity, actor, cafeteria and the complete reviewed payload.
Changed retries fail. The browser persists the request before sending and blocks
new close edits while the result is uncertain. Recovery resends the same key and
payload, even after a successful response was lost. Recovery-time non-success
retains the request; only authoritative success clears it. A fresh, authoritative
stale/invalid close rejection permits a new review. A corrupted/unavailable
sessionStorage journal blocks close rather than inventing a replacement request.

## API / RPC contracts

`POST /api/cafeteria/operations`, same-origin, no-store:

- `read`: `cafeteria_id`, `kind` (`transactions`, `transaction`, `sessions`,
  `session`), bounded `offset`, nullable `target_id`. Calls
  `cafeteria_operations_read(cafeteria, kind, offset, target)` and validates the
  returned `{cafeteria_id, tenant_kind, data}` shape.
- `close`: cafeteria/session IDs, original session version, counted and reviewed
  expected minor units, reason/note, UUID request key matching `Idempotency-Key`.
  Calls `cafeteria_operations_close(cafeteria, session, version, counted, reason,
  note, request_key, expected)`. Returns `{request_key, session}` after validating
  exact identity and closed status. No client actor/account/role/total is accepted.

New private helpers centralize projections and cash derivation. Existing financial
RPC signatures remain unchanged. A confirmed malformed-money validation defect
exposed by these tests is fixed with a Zod pipeline so non-integer text fails
validation before BigInt conversion; valid existing POS money semantics are unchanged.

## Local validation

Use only fictional fixtures. The complete chain needs the existing Auth-enabled
local project; the minimal database-only wrapper cannot apply the frozen activation
migration because its auth.users schema lacks email_confirmed_at.

```
python3 scripts/setup-step4d6-local.py
# Run phase5a_operations.test.sql with psql against supabase_db_pikas-4d6.
python3 scripts/test-phase5a-races.py
node scripts/test-phase5a-browser.mjs
```

The browser harness uses an isolated source copy in
`/private/tmp/pikas-phase5a-browser`, an exact loopback adapter, real local Auth,
`next build --webpack` and `next start`. Repository production endpoint guards,
configuration and secrets remain untouched. It exercises history, receipt detail,
review/confirmation, a lost successful close response and exact recovery, durable
conciliation and POS blocked after close, at 390/768/1440 px. Screenshots,
build/server logs and verification.json remain in that local artifact directory.

Final local verification: **47 pgTAP assertions**, **109 focused web tests**
(19 new and 90 existing regression tests), **6 observed-blocking races**, clean
TypeScript/ESLint, warning-free SQL lint for public/pikas_private, and a successful
production-mode build/browser journey. The browser proved expected RD$150.00,
counted RD$145.00, difference −RD$5.00, lost-success recovery and POS blocked after
close. All 390/768/1440 px widths had no horizontal overflow; the actual close was
confirmed on mobile with its button between the sticky header and bottom navigation.
No browser page errors were observed. The SQL suite additionally exercises existing
cash refund outflows, staff credit and cash staff-receivable collections.

Frozen Phase 4 suites are not automatically replayed; regression focuses on connected POS,
receipt validation, administration pages, API guards and the touched session paths.

## Intentional deferments / follow-ups

- Connected wallet/PIKAS Cash replenishment and refund product flows, full reporting,
  reconciliation beyond an individual close and platform analytics remain later work.
- Sandbox admin financial POV requires separate explicit authority approval.
- No historical close snapshots are fabricated; future cash movements require a
  reviewed additive integration with the summary and session locks.
- Sol Ficticia Beta missing from POS search during 4D.8 remains untouched.
- No production access, migration, push, deployment or Phase 5B work is authorized
  by this local milestone.

## Changed-file inventory

- Engineering guidance: `CLAUDE.md`.
- Canonical docs: `README.md`, `docs/PRODUCT_BASELINE.md`,
  `docs/FEATURE_CATALOG.md`, `docs/MVP.md`, `docs/CHANGELOG_PRODUCT.md`,
  `docs/PHASE_5A_TRANSACTION_REGISTER_OPERATIONS.md`.
- Connected UI: `apps/web/components/cafeteria-operations.tsx`,
  `apps/web/components/connected-cafeteria-pages.tsx`,
  `apps/web/components/connected-pos-dashboard.tsx`.
- Contracts/API: `apps/web/lib/cafeteria/operations.ts`,
  `apps/web/lib/pos/contracts.ts`,
  `apps/web/app/api/cafeteria/operations/route.ts`.
- Unit/API/presentation tests: `apps/web/lib/cafeteria/operations.test.ts`,
  `apps/web/components/cafeteria-operations.test.tsx`,
  `apps/web/app/api/cafeteria/operations/route.test.ts`.
- Database: `supabase/migrations/202610160001_transaction_register_operations.sql`,
  `supabase/tests/phase5a_operations.test.sql`.
- Local verification: `scripts/test-phase5a-races.py`,
  `scripts/test-phase5a-browser.mjs`.

The pre-existing worktree edit to `supabase/README.md` is unrelated, preserved
and excluded from the Phase 5A commit. No committed migration was modified.
