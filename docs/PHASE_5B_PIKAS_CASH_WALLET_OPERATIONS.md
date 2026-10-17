# Phase 5B — PIKAS Cash / Wallet Operations

Implemented and verified locally on 2026-10-16. Not yet applied to production.
This milestone covers 5.2 (wallet / PIKAS Cash replenishments) only; it does not
complete Phase 5 or introduce refunds, reversals, reporting dashboards or analytics.

## Architecture and product decisions

- **Existing model reused.** `student_wallets` remains the authoritative balance
  (`current_balance_minor`, `balance_version`) and `wallet_ledger_entries` the
  immutable, append-only history. No parallel financial model, table or movement
  type is introduced.
- **Financial invariant.** For every wallet, `current_balance_minor` equals the
  signed sum of its ledger entries; every entry stores `balance_after_minor` and
  `balance_version_after`. Replenishments are positive `replenishment` entries,
  POS wallet purchases negative `purchase` entries. Pre-existing `adjustment` and
  `refund` entries are displayed read-only as historical movements.
- **Authority.** The existing School Administration capabilities
  `school:wallets:read` and `school:wallets:replenish` (granted to `school_admin`),
  enforced through the existing `require_school_admin` guard. First
  funding of a student without a wallet reuses `create_student_wallet`
  (`school:wallets:manage`). No new role or capability.
- **Source.** Existing `manual_verified` semantics only: a reference and/or a
  verification note is required. No payment method, gateway or funding source.
- **Physical cash is separate.** A replenishment is not register cash: it is not
  attached to a register session and does not change Phase 5A expected cash. The
  UI states this explicitly. Funding also does not expand daily/per-purchase
  spending limits.
- **Sandbox.** Administrative sandbox POVs remain excluded from financial
  operations (route, page and database all deny); Edwin/Oscar gain no tenant
  financial authority.

## Authority, locking and recovery

`school_wallet_replenish` enters the sandbox admin command boundary, resolves
authority server-side, takes the existing per-student advisory lock (the same
fence used by checkout), then re-resolves authority with row locks on identity,
tenant and membership before delegating to `post_manual_wallet_replenishment`.

Migration `202610160002` replaces `post_manual_wallet_replenishment` with an
identical signature and grants; the only change is an additive post-lock
revalidation of actor identity, tenant scope, membership and student/eligibility
so a revocation committed while a request waits is honoured (also for the
pre-existing cafeteria-scope path).

Each request carries a client-generated UUID request key bound in the database to
a payload fingerprint (wallet, amount, currency, source, reference, note, actor).
Exact replay returns the original replenishment and its original resulting
balance; a changed payload under the same key is rejected. The browser persists
the command in `sessionStorage` before sending, disables editing while one is
pending, and retries only the identical stored command; non-success recovery
attempts never clear it.

## API / RPC contracts

- `school_wallet_read(p_school_id, p_student_id, p_before)` → balance, status and
  up to 25 movements newest-first (version keyset cursor `next_before`), with
  actor, source, reference/note, replenishment id, purchase id, receipt number,
  cafeteria and immutable purchased item snapshots.
- `school_wallet_replenish(p_school_id, p_student_id, p_amount_minor,
  p_request_key, p_reference, p_note)` → request key, wallet id, replenishment id,
  amount and resulting balance/version.
- Both are `security definer`, executable by `authenticated` only (not `anon` or
  `service_role`).
- `POST /api/school/wallet` (`operation: read | replenish`): same-origin only,
  strict Zod payloads (integer minor-unit strings, no client balance/actor), the
  `Idempotency-Key` header must equal `request_key`, `Cache-Control: no-store`,
  and database errors map to 403/422/502 without leaking details.
- UI: `/admin/escuela/estudiantes/[studentId]/pikas-cash?school=…`, linked from
  each student in the school roster ("PIKAS Cash de …").

## Local validation

```
python3 scripts/setup-step4d6-local.py
# Run phase5b_wallet_operations.test.sql with psql against supabase_db_pikas-4d6.
python3 scripts/test-phase5b-races.py
node scripts/test-phase5b-browser.mjs
```

- **pgTAP: 50 assertions pass**: privileges, amount/evidence validation, exact
  replay, changed amount/evidence rejection, overflow rollback, ledger
  immutability, cashier denial, wallet purchase debit/receipt/items in the same
  ledger, keyset pagination, stale client balance, foreign student/school denial,
  frozen wallet, daily/per-purchase limits unaffected, initial wallet creation
  only with active enrollment, suspended authority, balance = ledger sum, no
  register cash, and sandbox POV denial. The frozen Phase 5A suite (47) still passes.
- **Races: 8 pass with observed `pg_blocking_pids` blocking**: same credit
  twice, changed payload under the same key, two distinct credits, credit vs
  wallet purchase, two purchases competing for balance, authority revoked while
  waiting (new RPC and legacy RPC), cross-tenant attempt. Balance reconciles with
  the ledger after each case, and closing the race register shows no wallet-derived cash.
- **Web: full Vitest suite 804/805**. Phase 5B route/command tests pass; the one
  failure (`app/platform/equipo/page.test.tsx`, missing `usePathname` mock) is
  pre-existing at `1d92937` and unrelated.
- TypeScript, ESLint, `supabase db lint` (public, pikas_private) clean.
- **Production-mode browser** (isolated `next build --webpack` / `next start`,
  real local Auth): School Admin → roster → PIKAS Cash → balance RD$50.00 with
  RD$100.00 credit and −RD$50.00 Recibo #1 purchase and its items → RD$25.00
  credit with reference → single explicit confirmation → lost successful response
  → denied retry keeps the request → reload keeps it pending → exact recovery →
  RD$75.00 persisted after reload; three identical attempts, one replenishment,
  register expected cash unchanged. 390/768/1440 px with no horizontal overflow,
  mobile confirm button unobstructed, no page errors. Artifacts in
  `/private/tmp/pikas-phase5b-browser`.

## Intentional deferments (Phase 5C+)

Refunds, reversals, purchase voids, chargebacks, parent payment portal, online
card processing/gateways, split payments, financial dashboards and analytics. The
ledger already carries typed `refund_credit_id`/`adjustment_id` sources, so 5C can
add entries without reinterpreting history.

## Changed-file inventory

- `supabase/migrations/202610160002_wallet_operations.sql`
- `supabase/tests/phase5b_wallet_operations.test.sql`
- `apps/web/lib/wallet/{contracts,command,command.test}.ts`
- `apps/web/app/api/school/wallet/{route,route.test}.ts`
- `apps/web/app/admin/escuela/estudiantes/[studentId]/pikas-cash/page.tsx`
- `apps/web/components/student-wallet.tsx`, `connected-school-pages.tsx` (roster link)
- `scripts/test-phase5b-races.py`, `scripts/test-phase5b-browser.mjs`
- Canonical docs listed in `CHANGELOG_PRODUCT.md`.
