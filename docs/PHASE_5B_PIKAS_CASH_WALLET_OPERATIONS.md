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
- **Authority.** As first implemented (`202610160002`): the School Administration
  capabilities `school:wallets:read`/`replenish`, held only by `school_admin`,
  through `require_school_admin`. Superseded by the Beta wallet authority below.
- **Source.** Existing `manual_verified` semantics only: a reference and/or a
  verification note is required. No payment method, gateway or funding source.
- **Physical cash is separate.** A replenishment is not register cash: it is not
  attached to a register session and does not change Phase 5A expected cash. The
  UI states this explicitly. Funding also does not expand daily/per-purchase
  spending limits.
- **Sandbox.** Administrative sandbox POVs remain excluded from financial
  operations (route, page and database all deny); Edwin/Oscar gain no tenant
  financial authority.

## Beta wallet authority (202610170001)

Production acceptance found that a normally provisioned customer's initial
administrator holds only `account_admin`, which Phase 4D.2 had intentionally kept
without financial capabilities, so PIKAS Cash was denied. The owner then defined
the Beta policy (canonical table in `ADMINISTRATION_AND_PERMISSIONS.md`):

- Account Admin: `school:wallets:read` + `replenish`; no `manage`/`adjust`.
- School Admin: unchanged (read, replenish, manage, adjust).
- Cafeteria Admin: new `cafeteria:wallets:read` through `cafeteria_wallet_read`,
  balance/status only for active customers whose school shares basic
  identification with that cafeteria; the legacy `cafeteria:wallets:replenish`
  grant (reachable only through the direct RPC) is withdrawn.
- Platform: no standing access. Customer-authorized, temporary read-only support
  access is deferred. POS: operational wallet purchases only.

Implementation, all additive: the role-capability changes; `school_wallet_replenish`
opens a missing wallet under the already-verified replenish authority (standalone
`create_student_wallet` still requires `manage`); `post_manual_wallet_replenishment`
attributes school-scope credits to the actor's real role (`account_admin` or
`school_admin`); `school_wallet_access(school)` returns server-derived
`{read, replenish}` so the roster link, wallet page and replenish form render only
when authorized; `/api/cafeteria/wallet` exposes the read-only cafeteria lookup in
"Escuelas conectadas".

Validation: 58 pgTAP authority assertions (`phase5b_wallet_authority.test.sql`);
Phase 5B operations 50/50, Phase 5A 47/47 and Phase 5B foundation 28/28 still
pass; frozen `phase3a` updated only where it asserted the superseded policy
(106/106). `phase3b`/`phase3c` failures in the Auth-enabled environment are the
pre-existing global counts/sums from the fictional Horizonte baseline. Revocation
races `revoked_authority`, `legacy_revoked` and the new `account_admin_revoked`
pass with observed blocking. `scripts/test-phase5b-authority-browser.mjs` proves the
account-admin-only journey and the cafeteria read-only lookup.

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
