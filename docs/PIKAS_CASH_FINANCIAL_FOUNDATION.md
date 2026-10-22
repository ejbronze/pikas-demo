# PIKAS FIN 2 — PIKAS Cash financial foundation

Implemented locally on 2026-10-22 in `202611090001_pikas_cash_financial_foundation.sql`,
with pgTAP coverage in `supabase/tests/fin2_financial_foundation.test.sql`. Not deployed.
FIN 2 is a database foundation only. It adds no UI, navigation, reports, proof upload or
settlement batches, grants no capability and activates no customer.

> **CENTRAL CLEARING REQUIRES LEGAL/ACCOUNTING APPROVAL BEFORE REAL-MONEY ACTIVATION.**
> The schema models a generic clearing party whose legal custodian is deliberately not
> assigned. No customer may be activated with real money until the owner records legal
> and accounting approval of the custody, fee and obligation model.

## Locked economics

| Rule | Implementation |
|---|---|
| Fee 3% on replenishment only | Policy v1: DOP, 300 bps, `half_up`. Purchases, refunds and adjustments carry no fee. |
| Gross / fee / net snapshot | Stored on each request with its `policy_id` and `fee_bps`; CHECK `gross = fee + net` and `fee = replenishment_fee_minor(gross, fee_bps)`. |
| Rounding | `div(gross × bps + 5000, 10000)` in `numeric`, integer centavos, round half-up. Never floating point. |
| Bank transfer | `submitted → posted` (verified) or `submitted → rejected`. The payer reference and an external proof reference are text only; there is no file upload. |
| Cash at Cafetería | Collected and posted in one transaction. The Cafetería owes clearing the **gross**. |
| Wallet purchase | Clearing owes the Cafetería the wallet amount. |
| Wallet refund | Counter-obligation: the Cafetería owes clearing the refunded amount, linked to the purchase obligation. |
| Fee-era reversal | Allowed only while the wallet still holds the full net. Otherwise `FINANCIAL_RESOLUTION_REQUIRED` and nothing changes. A full reversal also reverses the fee. |
| Settlement week | Monday–Sunday in `America/Santo_Domingo`; due the following Tuesday (`week_start + 8`). No batches yet. |

Examples, verified in pgTAP: RD$2,000.00 gross gives a RD$60.00 fee and RD$1,940.00 net
(200000 → 6000 / 194000). 33333 → 1000; 49 → 1; 50 → 2; 51 → 2; 1 → 0; the largest
accepted gross, 9007199254740991, gives 270215977642230.

## Ledger architecture

Two ledgers stay separate:

- `wallet_ledger_entries` is a student's stored-value balance history, unchanged. A
  fee-era posting credits the wallet with **net** through a normal `wallet_replenishments`
  row, so wallet invariants hold: one ledger entry per source, balance version, and
  `balance_after`.
- `financial_entries` records the economic events of the clearing model. It is
  append-only, `amount_minor > 0`, and each row has exactly one typed source:

| Entry type | Source | Meaning |
|---|---|---|
| `replenishment_gross_collected` | request | Money received from the payer |
| `replenishment_fee_earned` | request | Fee (omitted when 0) |
| `stored_value_issued` | request + wallet replenishment | Net credited to the wallet |
| `stored_value_redeemed` | wallet purchase debit | Wallet spent at a Cafetería |
| `stored_value_restored` | wallet refund credit | Refund back to the wallet |
| `stored_value_adjusted_increase` / `_decrease` | wallet adjustment | Administrative adjustment |
| `replenishment_gross_reversed`, `replenishment_fee_reversed`, `stored_value_cancelled` | reversal (`reverses_entry_id`, unique) | Counter-entries of a fee-era reversal |
| `legacy_stored_value_reversed` | reversal of a pre-activation replenishment | Value removed after activation |

`financial_obligations` records who owes whom, from which entry (`source_entry_id` is
unique). Corrections are new rows that point to `corrects_obligation_id`. A guard trigger
locks the original obligation, checks the correction's direction, and refuses corrections
whose total would exceed the original.

| Reason | Debtor → creditor | Corrects |
|---|---|---|
| `cash_collection` | Cafetería → clearing (gross) | — |
| `wallet_purchase_fulfillment` | clearing → Cafetería | — |
| `cash_collection_reversal` | clearing → Cafetería | `cash_collection` |
| `wallet_refund_correction` | Cafetería → clearing | `wallet_purchase_fulfillment` |

`financial_parties` holds one clearing party (label "Compensación central PIKAS (custodia
legal por definir)") and one party per Cafetería, created lazily. A wallet is never a party.

Entries, obligations and parties reject UPDATE, DELETE and TRUNCATE with
`wallet_financial_history_is_immutable`. All six new tables have forced RLS and no
table grants, so access is only through the functions below.

### Reconciliation invariant

For an activated customer, at any committed point:

```
Σ wallet balances = opening_stored_value
                  + issued + restored + adjusted_increase
                  − redeemed − cancelled − adjusted_decrease − legacy_stored_value_reversed
```

For every posted request: `gross = fee + net`, `issued = net`, `wallet_replenishment.amount = net`
with the matching source, and cash requests have exactly one `cash_collection` obligation. A
deferred constraint trigger checks this at commit, and a cash request must be posted in its
own transaction. pgTAP checks the invariant exactly after each scenario, and the race run
checked it again on committed data.

## Policy and activation model

- `financial_fee_policies` is versioned. A policy changes only from `active` to `retired`;
  amounts are never edited. A future fee is a new version.
- `customer_financial_activations` holds at most one active row per account, and the only
  transition is `active → ended`. Activation is **inactive by default**. CEPOINT and every
  other customer stay unactivated.
- `pikas_private.finance_activate_customer(account, policy_version, reason, request_key)` is
  internal only. It is idempotent by key and fingerprint. It requires an active customer
  account, locks the account and every student's wallet lock, and snapshots
  `opening_stored_value_minor` and `opening_wallet_count`. It also writes a system audit row.
- Requests snapshot `activation_id` and `policy_id`. A posting under a different or ended
  activation fails with `FINANCIAL_POLICY_NOT_ACTIVE`.

## Legacy and activation boundary

- Customers that are not activated behave exactly as before: no fee, no policy version, no
  financial entries, no obligations, no backfill. No historical balance changes.
- Existing `wallet_replenishments` keep `source = 'manual_verified'` and a null
  `financial_request_id`; a CHECK ties the two together. The new sources are
  `bank_transfer_verified` and `cafeteria_cash_collected`.
- `post_manual_wallet_replenishment` keeps its definition from `202610190001` with one guard:
  once a customer is activated, a direct School replenishment fails with
  `collection_source_required`. The School cannot post fee-era money.
- Pre-activation wallet value is the `opening_stored_value` snapshot. It is legacy liability
  that no collection funded under this model.
- Reversing a legacy replenishment after activation keeps the legacy behaviour and records a
  `legacy_stored_value_reversed` entry so reconciliation stays exact. A refund of a
  pre-activation purchase records `stored_value_restored` without a correction, because that
  purchase created no obligation.

## Posting and concurrency

Every money path takes the same per-student lock,
`pg_advisory_xact_lock(hashtextextended(student_id::text, 0))`. That includes replenish,
reverse, adjust, checkout, refund, posting and activation. Requests are idempotent by
`(account, request_key)` and decisions by `(account, decision_request_key)`, each with a
SHA-256 payload fingerprint. A different payload under the same key returns
`IDEMPOTENCY_CONFLICT`, and a second decision returns `REQUEST_ALREADY_DECIDED`. Purchase
and refund accounting runs in AFTER INSERT triggers inside the original transaction, so
purchase atomicity is unchanged.

Races ran locally on 2026-10-22 against committed fictional data, in independent sessions.
`pg_blocking_pids` showed session B blocked by session A in every case:

| Race | Result |
|---|---|
| Duplicate submission, same key | Same reference returned; 1 request |
| Simultaneous approval, two decision keys | One `posted`, other `REQUEST_ALREADY_DECIDED`; one wallet posting; delta = net 194000 |
| Purchase racing a posting | Both commit; delta 97000 − 10000 = 87000 |
| Reversal racing a purchase (balance 14700, net 9700, sale 10000) | Sale commits; reversal `FINANCIAL_RESOLUTION_REQUIRED`; balance 4700 |
| Double reversal | One reversal; the other `REPLENISHMENT_ALREADY_REVERSED`; one set of counter-entries (20000 / 600 / 19400) and one `cash_collection_reversal` |
| Two refunds of 6 units against a 10-unit purchase | One refund; the other `REFUND_EXCEEDS_REMAINING`; correction 30000 of a 50000 obligation |

After the races the wallet matched its ledger, every posted request reconciled, and the
stored-value invariant held. All race records were then removed.

## Authority

- Catalogued, **not granted**: `platform:finance:replenishments:verify`,
  `platform:finance:read`, `platform:finance:settlement:manage`. The future tenant capability
  `cafeteria:finance:obligations:read` is checked but held by no role.
- `cafeteria:wallets:replenish` is not granted. The future cash-collection capability is
  designed as `cafeteria:wallets:collect_cash`. It is not created or granted. FIN 3/4 wraps
  `finance_post_cash_replenishment` with it.
- Public wrappers, unusable until the owner grants a capability:
  - `platform_finance_decide_bank_replenishment(reference, decision, reason, key)`
  - `platform_finance_replenishment_read(reference)`, which returns no internal IDs
  - `cafeteria_financial_obligations_read(cafeteria_id)`

  All three refuse a sandbox POV. Finance needs no Platform tenant access.
- Every internal, trigger and guard function is revoked from `public`, `anon`,
  `authenticated` and `service_role`.

## Known risks carried forward

- The School still has authority to reverse fee-era replenishments, subject to the balance
  rule. FIN 3 should decide whether reversal of collected money moves to finance.
- Administrative adjustments create or remove value without collection. They are recorded
  as entries but produce no obligation.
- A student created while an activation is being taken is serialized by the per-student
  lock, but is not part of the opening snapshot unless it already held a wallet.
- The opening stored value is unfunded legacy liability; the owner decides its treatment
  before activation.
- Activation and ending are internal-only; no operator path exists.

## Handoff

- **FIN 3, verification and collection:** Platform finance UI on
  `platform_finance_decide_bank_replenishment` and `platform_finance_replenishment_read`.
  The family/School submission wrapper. The `cafeteria:wallets:collect_cash` capability and
  the POS cash-collection wrapper. Owner-approved capability grants and an activation
  procedure.
- **FIN 4, Cafetería obligations:** the Cafetería statement on
  `cafeteria_financial_obligations_read`, weekly views by `settlement_week_start`, and
  reconciliation against register cash.
- **FIN 5, settlement:** settlement batches and payments under
  `platform:finance:settlement:manage`, which close obligations by week (due Tuesday).
  Requires the legal/accounting approval above before any real money moves.
