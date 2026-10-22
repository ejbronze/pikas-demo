# PIKAS FIN 2 — PIKAS Cash financial foundation

Implemented locally on 2026-10-22 in three migrations:

- `202611090001_pikas_cash_financial_foundation.sql`: the foundation;
- `202611100001_pikas_cash_financial_invariants.sql`: the owner refinement;
- `202611110001_pikas_cash_funded_adjustment_authority.sql`: funded-adjustment authority.

pgTAP coverage is in `supabase/tests/fin2_financial_foundation.test.sql`,
`fin2_financial_invariants.test.sql` and `fin2_funded_adjustments.test.sql`. Not deployed.

FIN 2 is a database foundation only. It adds no UI, navigation, reports, proof upload or
settlement batches. It grants no capability and activates no customer: no production
customer and no CEPOINT.

> **CENTRAL CLEARING REQUIRES LEGAL/ACCOUNTING APPROVAL BEFORE REAL-MONEY ACTIVATION.**
> The schema models a generic clearing party whose legal custodian is deliberately not
> assigned. No customer may be activated with real money until the owner records legal
> and accounting approval of the custody, fee and obligation model. This gate is unresolved.

## Locked economics

| Rule | Implementation |
|---|---|
| Fee 3% on replenishment only | Policy v1: DOP, 300 bps, `half_up`. Purchases, refunds, adjustments and the opening liability carry no fee. |
| Gross / fee / net snapshot | Stored on each request with its `policy_id` and `fee_bps`; CHECK `gross = fee + net` and `fee = replenishment_fee_minor(gross, fee_bps)`. |
| Rounding | `div(gross × bps + 5000, 10000)` in `numeric`, integer centavos, round half-up. Never floating point. |
| Bank transfer | `submitted → posted` (verified) or `submitted → rejected`. The payer reference and an external proof reference are text only; there is no file upload. |
| Cash at Cafetería | Collected and posted in one transaction. The Cafetería owes clearing the **gross**. |
| Wallet purchase | Clearing owes the Cafetería the wallet amount. |
| Wallet refund | Counter-obligation: the Cafetería owes clearing the refunded amount, linked to the purchase obligation. |
| Fee-era reversal | A Platform finance operation. Allowed only while the wallet still holds the full net. Otherwise `FINANCIAL_RESOLUTION_REQUIRED` and nothing changes. A full reversal also reverses the fee. |
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
- `financial_entries` records the economic consequence of each event in the clearing
  model. It is append-only, `amount_minor > 0`, and each row has exactly one typed source.

Audit (`audit_events`) still records the human action. Financial entries record what that
action means economically.

### Financial events

| Entry type | Source | Meaning |
|---|---|---|
| `opening_legacy_stored_value_liability` | activation | Pre-existing positive wallet value the clearing model assumed at activation |
| `replenishment_gross_collected` | request | Money received from the payer (cash: by the Cafetería) |
| `replenishment_fee_earned` | request | PIKAS fee (omitted when 0) |
| `stored_value_issued` | request + wallet replenishment | Net credited to the wallet |
| `clearing_funded_adjustment` | wallet adjustment + funding party | Positive administrative adjustment; clearing funds the added value |
| `adjustment_stored_value_reduction` | wallet adjustment + funding party | Negative administrative adjustment; liability reduced in favour of clearing |
| `stored_value_redeemed` | wallet purchase debit | Wallet spent at a Cafetería |
| `stored_value_restored` | wallet refund credit | Refund back to the wallet |
| `replenishment_gross_reversed`, `replenishment_fee_reversed`, `stored_value_cancelled` | reversal (`reverses_entry_id`, unique) | Counter-entries of a fee-era reversal |
| `legacy_stored_value_reversed` | reversal of a pre-activation replenishment | Value removed after activation |

The refinement replaced FIN 2's `stored_value_adjusted_increase` and
`stored_value_adjusted_decrease`, which never existed outside local tests, with the two
funded adjustment types. An adjustment is never a replenishment: it has no request, no
fee, no collection and no obligation. `funding_party_id` names who funds the value. Today
that is always the clearing party; a future workflow may supply another.

### Obligations

`financial_obligations` records who owes whom, from which entry (`source_entry_id` is
unique). Corrections are new rows that point to `corrects_obligation_id`. A guard locks
the original obligation, checks direction, and refuses corrections whose total would
exceed the original.

| Reason | Debtor → creditor | Corrects |
|---|---|---|
| `cash_collection` | Cafetería → clearing (gross) | — |
| `wallet_purchase_fulfillment` | clearing → Cafetería | — |
| `cash_collection_reversal` | clearing → Cafetería | `cash_collection` |
| `wallet_refund_correction` | Cafetería → clearing | `wallet_purchase_fulfillment` |
| `legacy_purchase_refund` | Cafetería → clearing | — (the purchase predates activation, so there is no payable to correct) |

`financial_parties` holds one clearing party (label "Compensación central PIKAS (custodia
legal por definir)") and one party per Cafetería, created lazily. A wallet is never a party.

Entries, obligations and parties reject UPDATE, DELETE and TRUNCATE with
`wallet_financial_history_is_immutable`, including the opening-liability and adjustment
events. The activation snapshot cannot be edited. All six FIN 2 tables have forced RLS and
no table grants, so access is only through the functions below.

## Value-source invariant (activated customer)

Every positive change to an activated customer's wallet value has an economic source:

| Wallet value enters through | Economic source |
|---|---|
| Opening balance | `opening_legacy_stored_value_liability`, assumed at activation |
| Fee-era replenishment | `stored_value_issued`, funded by `replenishment_gross_collected` = fee + net |
| Positive adjustment | `clearing_funded_adjustment`, funded by the clearing party and executed only by Platform finance |
| Refund of a post-activation purchase | `stored_value_restored` + `wallet_refund_correction` (corrects the Cafetería payable) |
| Refund of a pre-activation purchase | `stored_value_restored` + `legacy_purchase_refund` (the Cafetería returns the value; owner-approved) |

A wallet created after activation starts at zero and needs no opening entry. Value can
only reach it through these paths. No tenant path can create PIKAS-funded value:

- The School can no longer post direct replenishments for an activated customer
  (`collection_source_required`).
- No tenant role can post a positive adjustment for one (see *Funded adjustments*).

At any committed point, for the policy currency:

```
Σ wallet balances = opening_legacy_liability − opening_negative_balances
                  + issued + clearing_funded_adjustment + restored
                  − redeemed − cancelled − adjustment_stored_value_reduction − legacy_stored_value_reversed
```

Further invariants:

- **Posted requests:** for every posted request, `gross = fee + net`, `issued = net`, and
  `wallet_replenishment.amount = net` with the matching source.
- **Cash collections:** each cash request has exactly one `cash_collection` obligation.
- **Restored value:** every restored value has exactly one Cafetería → clearing obligation.
- **Fees:** fees exist only on replenishment requests.
- **Enforcement:** a deferred constraint trigger checks request completeness at commit.

pgTAP and the race runs check these on every scenario.

## Policy and activation

- `financial_fee_policies` is versioned. A policy changes only from `active` to `retired`;
  amounts are never edited.
- `customer_financial_activations` holds at most one active row per account, and the only
  transition is `active → ended`. Activation is **inactive by default**. No customer is
  activated.
- `pikas_private.finance_activate_customer(account, policy_version, reason, request_key)`
  is internal only. It is idempotent by key and fingerprint, and concurrent replays of a
  key are serialized. It requires an active customer account and locks the account and
  every student's wallet lock. It then snapshots the wallets **in the policy currency**:
  - `opening_legacy_liability_minor`: the sum of positive balances;
  - `opening_negative_balance_minor`: the sum of negative balances, recorded on the
    activation and never as a money event;
  - `opening_stored_value_minor`: the net of the two (CHECK);
  - `opening_wallet_count`.
- When the liability is above zero, activation writes one
  `opening_legacy_stored_value_liability` entry. That entry is account-level (no school),
  carries the activation, currency and amount, and is dated at activation. A zero liability
  writes no entry. One entry per activation (unique). Wallet balances and wallet ledgers are
  not touched. No replenishment, collection or fee is created and no history is rewritten.
- Wallets in other currencies are not aggregated.
- Requests snapshot `activation_id` and `policy_id`. A posting under a different or ended
  activation fails with `FINANCIAL_POLICY_NOT_ACTIVE`.

## Legacy boundary

- **Unactivated customers** behave exactly as before: no fee, no financial entries, no
  obligations, no backfill, and no historical balance changes. This covers their
  adjustments, refunds and reversals.
- **Legacy replenishment source:** existing `wallet_replenishments` keep
  `source = 'manual_verified'` and a null `financial_request_id`.
- **Direct School replenishment:** `post_manual_wallet_replenishment` refuses it once the
  customer is activated.
- **Legacy reversals:** the School still reverses legacy (pre-activation) replenishments
  with its existing authority, `school:wallets:reverse_replenishment`. After activation the
  removed value is recorded as `legacy_stored_value_reversed`.

## Funded adjustments: a Platform finance operation

For an activated customer, a positive administrative adjustment is value funded by clearing
(PIKAS). Tenant roles therefore cannot execute it.

- **Tenant core guard.** The shared tenant core (`post_administrative_adjustment`, used by
  `school_wallet_adjust` for School and Account Admins and by `cafeteria_wallet_adjust`) keeps
  its `202610200001` definition with one guard. It refuses with
  `42501 finance_adjustment_authority_required` before any write, wallet creation included.
  A request key that already exists still replays through the normal idempotency check.
- **Table guard.** A BEFORE INSERT guard on `wallet_adjustments` applies the same rule to
  every other writer, including the older `post_student_wallet_adjustment`.
- **What stays the same:**
  - Negative adjustments keep their tenant authority and their
    `adjustment_stored_value_reduction` event.
  - Customers that are not activated keep both directions exactly as before.
- **Execution.** `platform_finance_fund_wallet_adjustment(student_id, amount_minor, reason,
  explanation, request_key)` requires `platform:finance:adjustments:fund`. It refuses a
  sandbox POV and requires an activated customer and an existing wallet; it never opens one.
  It accepts positive amounts and credit reasons only.
- **Locking.** It takes the per-student lock and checks authority again after the wait. A
  membership suspended while the call waits is refused, as the race below showed. It locks
  and re-reads the wallet.
- **What it writes.** It writes the existing adjustment source record:
  `actor_role = 'platform_finance_operator'`, scope `platform`, `actor_source = 'platform_finance'`.
  It then writes the wallet update and ledger entry. The existing trigger adds exactly one
  `clearing_funded_adjustment` with the clearing funding party, all in one transaction. If
  the financial event fails, the adjustment does not exist.
- **What it does not create:** no fee, replenishment, collection or obligation.
- **Audit and result.** Audit records `wallet_funded_adjustment_posted` by the finance
  operator. The result carries no internal IDs and no balance.
- **Idempotency.** Requests are idempotent by key and fingerprint. A replay returns the same
  result. A different body under the same key fails with `IDEMPOTENCY_CONFLICT`, and so does
  reusing a tenant adjustment's key.
- **Scope of the capability.** It confers no wallet read, no School or Cafetería authority,
  and no other finance authority.
- **Not granted to anyone:** not Edwin, not Platform Admin. No membership changed.
- **Tenants' future role:** they may request or support such a correction in a future
  workflow.

## Fee-era reversal: a Platform finance operation

- `school_wallet_reverse_replenishment` keeps its `202610190001` definition with one guard.
  A fee-era replenishment (`financial_request_id` set) fails with
  `42501 finance_reversal_authority_required` before any write.
- Execution moves to `platform_finance_reverse_replenishment(reference, reason, note,
  request_key)`. It requires `platform:finance:replenishments:reverse`, refuses a sandbox
  POV, and revalidates the capability after the per-student lock. It then calls the
  internal primitive `pikas_private.finance_reverse_replenishment`.
- **Recording:** the reversal row records `actor_role = 'platform_finance_operator'`, and
  audit records the finance operator at `platform` scope. The result has no internal IDs.
- **Table-level enforcement:**
  - A tenant role cannot write a fee-era reversal row.
  - The finance role cannot reverse a legacy replenishment.
- **Behaviour carried over from FIN 2:**
  - If the wallet holds less than the net, the operation fails with
    `FINANCIAL_RESOLUTION_REQUIRED` and nothing is written: no reversal, ledger entry,
    event, obligation or audit row.
  - A valid reversal counters gross, fee and net, and corrects the cash obligation.
  - Requests are idempotent by key and fingerprint; a second reversal fails with
    `REPLENISHMENT_ALREADY_REVERSED`.
- **Scope of the capability:** it covers this one operation only. It confers no tenant or
  customer wallet authority (School read, replenish, adjust and reverse all stay refused)
  and no finance read or verification.
- **Not granted to anyone:** not Edwin, not Platform Admin. No membership changed.
- **School's future role:** the School may view the replenishment, support the payer, and
  escalate a correction to finance.

## Concurrency

Every money path takes the same per-student lock,
`pg_advisory_xact_lock(hashtextextended(student_id::text, 0))`. That includes replenish,
reverse (School and finance), adjust, checkout, refund, posting and activation. Purchase
and refund accounting runs in AFTER INSERT triggers inside the original transaction, so
purchase atomicity is unchanged.

Races ran locally on 2026-10-22 on committed fictional data, in independent sessions.
`pg_blocking_pids` showed session B blocked by session A in every case.

FIN 2:

| Race | Result |
|---|---|
| Duplicate submission, same key | Same reference returned; 1 request |
| Simultaneous approval, two decision keys | One `posted`, other `REQUEST_ALREADY_DECIDED`; one wallet posting |
| Purchase racing a posting | Both commit; delta 87000 |
| Reversal racing a purchase | Sale commits; reversal `FINANCIAL_RESOLUTION_REQUIRED` |
| Double reversal | One reversal; other `REPLENISHMENT_ALREADY_REVERSED` |
| Two refunds against one purchase | One refund; other `REFUND_EXCEEDS_REMAINING` |

Refinement:

| Race | Result |
|---|---|
| Activation replay, same key | Same activation id; 1 activation; 1 opening entry (5000000) |
| Positive adjustment racing a purchase | Both commit; delta 85000; `clearing_funded_adjustment` 100000; payable 15000 |
| Purchase, then finance reversal (balance 14700, net 9700) | Sale commits; reversal re-reads the balance after the wait: `FINANCIAL_RESOLUTION_REQUIRED`; no reversal |
| Finance reversal, then purchase | Both commit; delta −29400 |
| Two finance reversals, different keys | One reversal; other `REPLENISHMENT_ALREADY_REVERSED` |
| Two finance reversals, same key | Same result returned; one reversal and one set of counter-entries |

Funded adjustments:

| Race | Result |
|---|---|
| Two funded adjustments, same key | Both return `posted`; one adjustment, one event; balance +25000 once |
| Funded adjustment racing a purchase | Both commit; delta 25000 (40000 − 15000) |
| Operator membership suspended while waiting on the student lock | Re-check after the lock refuses with `not_authorized`; no adjustment; only the sale moved the balance |

After each run the wallet matched its ledger, the value-source invariant held, and no
obligation correction exceeded its original. All race records were removed afterwards.

## Authority

- **Catalogued, not granted:**
  - `platform:finance:replenishments:verify`
  - `platform:finance:replenishments:reverse`
  - `platform:finance:adjustments:fund`
  - `platform:finance:read`
  - `platform:finance:settlement:manage`

  The future tenant capability `cafeteria:finance:obligations:read` is checked but held by
  no role.
- **Cash collection:** `cafeteria:wallets:replenish` is not granted. The cash-collection
  capability is designed as `cafeteria:wallets:collect_cash` and is not created.
- **Public wrappers, unusable until the owner grants a capability:**
  - `platform_finance_decide_bank_replenishment`
  - `platform_finance_reverse_replenishment`
  - `platform_finance_fund_wallet_adjustment`
  - `platform_finance_replenishment_read`
  - `cafeteria_financial_obligations_read`

  All of them refuse a sandbox POV. Finance needs no Platform tenant access.
- **Revocation:** every internal, trigger and guard function is revoked from `public`,
  `anon`, `authenticated` and `service_role`.

## Future finance reads

Distinct entry types and obligation reasons let a future Platform finance read report each
of these separately. No read or report is built in FIN 2.

| Question | Source |
|---|---|
| Opening legacy liability | `opening_legacy_stored_value_liability` |
| Replenishment-funded value | `stored_value_issued` − `stored_value_cancelled` |
| PIKAS-funded adjustments | `clearing_funded_adjustment` (− `adjustment_stored_value_reduction`) |
| Fee revenue | `replenishment_fee_earned` − `replenishment_fee_reversed` |
| Cafetería collection obligations | `cash_collection` (− `cash_collection_reversal`) |
| Cafetería wallet-sale payables | `wallet_purchase_fulfillment` (− `wallet_refund_correction`) |
| Reversals and corrections | counter-entries, `legacy_stored_value_reversed`, correction obligations, `legacy_purchase_refund` |

Opening liability and adjustments are never replenishment revenue.

## Known risks carried forward

- **Legal custody:** the legal custody of the clearing party and the activation gate are
  unresolved.
- **Legacy purchase refunds:** the owner approved and locked this treatment. A refund of a
  pre-activation purchase made after activation creates a `legacy_purchase_refund`
  obligation (Cafetería → clearing) for exactly the wallet refund. It has no fee, no
  replenishment and no historical entries, and the original purchase is untouched.
- **Opening negative balances:** recorded on the activation (`opening_negative_balance_minor`),
  never as a money event. There is no collection or write-off logic in FIN 2; this is a
  future recovery and accounting consideration.
- **Activation path:** activation and ending are database/backend-only by design while the
  legal/accounting gate is open. There is no operator UI.
- **Labels for finance actions:** the School wallet history shows finance-executed
  adjustments and reversals with the raw role `platform_finance_operator` and the finance
  operator's name. FIN 3 should label them and decide what the School sees.

## Handoff

- **FIN 3, verification, collection and reversal:**
  - Platform finance UI on the decide, reverse, fund and read wrappers.
  - The School's view/escalation path for fee-era corrections and funded-adjustment requests.
  - The family/School submission wrapper.
  - `cafeteria:wallets:collect_cash` and the POS cash-collection wrapper.
  - Owner-approved capability grants and an activation procedure.
- **FIN 4, Cafetería obligations:**
  - The Cafetería statement on `cafeteria_financial_obligations_read`.
  - Weekly views by `settlement_week_start`.
  - Reconciliation against register cash.
- **FIN 5, settlement:**
  - Settlement batches and payments under `platform:finance:settlement:manage`, which close
    obligations by week (due Tuesday).
  - Requires the legal/accounting approval above before any real money moves.
