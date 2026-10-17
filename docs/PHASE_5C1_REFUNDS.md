# Phase 5C.1 — Controlled Purchase Refunds

Implemented and verified locally on 2026-10-18. Not yet applied to production.
This is 5C.1 only. Phase 5C is not complete: 5C.2 (replenishment reversals) and
5C.3 (administrative wallet adjustments, approvals and notifications) are deferred.

## Model

- The original purchase and receipt never change. Each refund is a new immutable
  event linked to the purchase, its original tender and the specific lines refunded.
- **Item-level refunds.** A refund names purchase lines and quantities. Its amount is
  the unit price snapshot × quantity, in integer minor units. One purchase may have
  several refund events. Cumulative quantity per line can never exceed the quantity
  purchased, and the cumulative amount can never exceed the purchase total.
- Builds on the Phase 3C refund foundation (`refunds`, `refund_cash_outflows`,
  `wallet_refund_credits`, `financial_approvals`, deferred integrity triggers). Item
  allocation is the new `refund_items` table. A purchase that already has a legacy
  amount-only refund is not item-refundable (`REFUND_ITEMS_UNAVAILABLE`).
- **Tender is preserved.** Cash purchases are refunded in cash; PIKAS Cash purchases are
  refunded to PIKAS Cash. One tender is never converted into the other.
- **Cash.** The cash leaves the operator's *current* open register: a
  `refund_cash_outflows` row reduces that session's expected cash (Phase 5A
  `register_cash_summary`). If the original sale was in a historical closed session,
  that session is never reopened or rewritten. The refund still links to the original
  purchase. A cash refund larger than the current register's expected cash is rejected
  (`CASH_INSUFFICIENT`).
- **PIKAS Cash.** The student's wallet is credited, with a linked immutable `refund`
  ledger entry. Register cash is not affected. Daily spending compensation follows the
  existing same-business-day rule.
- **Reasons.** Artículo incorrecto, Cobro duplicado, Artículo no disponible, Problema de
  calidad, Cantidad incorrecta, Estudiante cambió de opinión, Otro. "Otro" requires an
  explanation.

## Authority and override

- **POS Supervisor:** refunds directly from their own open register (`supervisor_direct`).
- **Cashier:** refunds without an override (`independent`) only if all of these hold:
  - the sale is at most 5 minutes old;
  - the cashier's independent refunds today are fewer than the configured count limit;
  - the cashier's independent refunds today plus this refund stay within the configured
    amount limit.

  Otherwise an override is required. Each refund event counts once, and the actual
  refunded amount counts toward the amount limit. A refund that would cross the amount
  limit requires an override. Overridden refunds do not consume the cashier's allowance.
- **Limits** (`cashier_daily_refund_count_limit`, `daily_independent_refund_allowance_minor`)
  are configured by a Cafeteria Admin (Configuración POS) or a POS Supervisor
  (`configure_cashier_refund_limits`). Both default to 0, so every cashier refund requires
  an override until limits are set.
- **Override on the same POS device.**
  - The cashier stays signed in and stays the initiator.
  - A POS Supervisor or Cafeteria Admin of that cafeteria enters their own email and
    password in the refund modal.
  - `/api/pos/refund-approval` authenticates them with the existing login primitives
    (`signInWithPassword` + `pikas_session_start`) on an isolated, non-persisted server
    client.
  - It issues one `financial_approvals` row bound to the purchase, items, amount, reason,
    notes and the cashier's session. The approval is single-use, revocable and expires
    after 10 minutes.
  - It then ends and signs out that approver session.

  This adds no new impersonation or session system, and no role switching.
- **Cafeteria Admin.** Cafeteria Admins don't operate registers, so their refund
  authority is exercised by authorizing at the POS. The cash comes from the
  cashier's current register.
- **Audit.** The refund records the initiating actor, the approver, the approver's role
  and why an override was required (`sale_age`, `count_limit`, `amount_limit`). Audit
  events cover approval issuance and consumption, and refund commit.
- **Sandbox POV** remains excluded: the API denies it, and the database gives the
  operator no refund authority.

## Analytics data

Each refund stores:
- the refund ID and its ordinal;
- the original purchase/receipt and original tender;
- the refunded lines (`refund_items`: line, quantity, amount);
- the student (through the purchase or wallet credit) and the cafeteria;
- the amount, tender, reason and other-reason note;
- the actor and role, plus approver and approver role;
- the timestamp and business date;
- the sale age at refund, whether an override was required and why;
- the current register session (cash) or the wallet ledger link (PIKAS Cash).

## Contracts

- `get_purchase_item_refundability(session, receipt number)`: lines, cumulative
  refunded quantities, prior refunds, and the operator's daily usage and limits.
- `create_purchase_item_refund(session, purchase, items, reason, notes, request_key, approval_id)`:
  atomic and idempotent (actor + request key + payload fingerprint). It locks the
  purchase, the actor, the student/wallet and the current session. Authority is
  revalidated after each wait.
- `issue_purchase_item_refund_approval(cashier session, purchase, items, reason, notes, issuance_key)`:
  called as the approver.
- `configure_cashier_refund_limits` and `get_cashier_refund_limits`.
- `/api/pos` operations `refund_lookup` and `refund`; `/api/pos/refund-approval`;
  `/api/cafeteria/refund-limits`. All are same-origin with strict Zod contracts, and
  rejections are classified as definite or uncertain. The POS keeps the exact refund
  request in session storage until a result is confirmed.
- Migration `202610180001_controlled_purchase_refunds.sql` (additive). The new RPCs use
  the POS application-session timeout.

## Local validation

```
python3 scripts/setup-step4d6-local.py
# Run phase5c1_refunds.test.sql with psql against supabase_db_pikas-4d6.
python3 scripts/test-phase5c1-refund-races.py
node scripts/test-phase5c1-refund-browser.mjs
```

- **pgTAP `phase5c1_refunds.test.sql`: 47/47.** Covers:
  - full, partial and multiple partial refunds, in cash and in PIKAS Cash;
  - over-refund, exact retry and changed-payload rejection;
  - cash reducing the current register; a closed historical register left unchanged;
  - wallet refunds that don't touch register cash, with balance equal to the ledger sum;
  - Admin and Supervisor authority;
  - the cashier window, count, amount and crossing limits;
  - override initiator/approver records, approval binding and single use;
  - invalid and unscoped approvers; cross-account, foreign purchase and platform/sandbox
    denial;
  - required reason and "Otro" text; immutability.
- **Races: 7/7 with observed `pg_blocking_pids` blocking.** Covers duplicate retry,
  concurrent over-refund, concurrent partials of the same line, the cashier limit,
  authority revoked while waiting, wallet refund vs. wallet purchase, and register
  closed while waiting.
- **Production-mode browser** (`next build --webpack`, real local Auth), fictional cashier at
  390/768/1440px with no overflow and no page errors:
  1. Partial cash refund inside the window; expected cash RD$200 → RD$150.
  2. PIKAS Cash refund to the wallet; balance RD$100 → RD$150, register unchanged.
  3. Count limit reached: a cashier is rejected as approver, then the Cafeteria Admin
     authorizes on the same device and the cashier stays signed in. Expected cash → RD$100.
  4. Cumulative state persists after reload. The modal enforces the reason and the
     "Otro" text.
- **Web:** focused route and component tests pass. The full suite is 853/854; the single
  failure is the pre-existing `app/platform/equipo` mock failure.
- **Regression:**
  - Phase 5A 47/47, Phase 5B wallet operations 50/50, Beta wallet authority 58/58.
  - Phase 3C: only the three assertions that encoded the superseded refund policy were
    updated.
  - Its five remaining failures are the existing environment-only global counts/sums
    from the fictional Horizonte baseline.

## Deferred

- 5C.2 replenishment reversals.
- 5C.3 administrative adjustments, approval flows and parent notifications.
- Refunds of staff-credit purchases.
- Cafeteria-Admin-initiated refunds outside the POS.
- Platform support access.
