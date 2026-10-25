# PIKAS financial activation runbook

**Status:** procedure only. Nothing in this document has been executed. Production finance is dormant: zero finance
roles, members and activations; zero financial entries, obligations and settlements; no settlement-manage grant.

**Who runs it:** the owner, or someone the owner names in writing for that activation. Every production step needs the
owner's explicit approval at the time it runs. A local or staging rehearsal never authorizes production.

> **Hard gate.** Central clearing requires legal/accounting approval before any real-money activation. Do not start
> Part B until every item in [Part A](#part-a--gate-0-legal-and-accounting) is answered and recorded by the owner.

## Contents

- [Part A — Gate 0: legal and accounting](#part-a--gate-0-legal-and-accounting)
- [Part B — Finance role provisioning](#part-b--finance-role-provisioning)
- [Part C — Customer activation](#part-c--customer-activation)
- [Part D — Rollback and deactivation](#part-d--rollback-and-deactivation)
- [Reference: what activation changes](#reference-what-activation-changes)

## Part A — Gate 0: legal and accounting

These questions have **no answers in this repository**. PIKAS must not invent them. The owner records each answer,
who gave it and the date, in the activation record (see Part C, step C1).

| # | Question | Who answers | Answer / date |
|---|---|---|---|
| A1 | Which legal entity holds customer stored value (PIKAS Cash) and in which account? Is it segregated from operating funds? | Legal / accountant | |
| A2 | Does holding prepaid student balances need a licence, registration or exemption in the Dominican Republic (for example under monetary or payments rules)? | Legal | |
| A3 | How is the PIKAS replenishment fee (policy v1: 300 bps, half-up) invoiced and taxed (ITBIS or other)? Who issues the fiscal receipt (NCF)? | Accountant | |
| A4 | When a Cafetería collects cash for PIKAS Cash, is it acting as PIKAS's collection agent? Which contract says so? | Legal | |
| A5 | Weekly settlement terms: Monday–Sunday (America/Santo_Domingo), due the following Tuesday. Are these the contractual terms? What happens on late payment? | Legal / owner | |
| A6 | Refund and unused-balance policy: what happens to a positive balance when a student leaves or a customer ends service? | Legal / owner | |
| A7 | Record retention: how long must financial entries, receipts and audit be kept? (The system never deletes them.) | Accountant | |
| A8 | Which bank accounts receive settlement payments and payouts, and who may confirm them in PIKAS? | Owner | |
| A9 | Reconciliation: who reconciles PIKAS settlement records with the bank statement, and how often? | Accountant | |
| A10 | Customer contract: does the signed agreement cover the fee, the custody model, settlement and data processing? | Legal | |

## Part B — Finance role provisioning

### B0. The intended bundle

| Capability | In the role | Why |
|---|---|---|
| `platform:finance:read` | Yes | Finanzas, Liquidaciones, finance report |
| `platform:finance:replenishments:verify` | Yes | Approve or reject bank replenishments |
| `platform:finance:replenishments:reverse` | Yes | Reverse a posted replenishment |
| `platform:finance:settlement:manage` | Yes | Calculate settlements, confirm payments, reviews |
| `platform:finance:adjustments:fund` | **Never** | Funded adjustments stay separately controlled |

The role and its bundle do not exist yet: neither locally nor in production. Creating them is an additive migration
that needs owner approval. **No production person is assigned without a separate, named owner decision.**

### B1. Create the role (additive migration; owner-approved)

A reviewed migration, for example `20261xxxxxxx_platform_finance_operator.sql`, with this shape:

```sql
-- Owner decision <date>: finance operator bundle = read + verify + reverse + settlement:manage. Never adjustments:fund.
begin;
insert into pikas_private.platform_roles(role_code, status) values ('platform_finance_operator', 'active');
insert into pikas_private.platform_role_capabilities(role_code, capability) values
  ('platform_finance_operator', 'platform:finance:read'),
  ('platform_finance_operator', 'platform:finance:replenishments:verify'),
  ('platform_finance_operator', 'platform:finance:replenishments:reverse'),
  ('platform_finance_operator', 'platform:finance:settlement:manage');
do $$ begin
  if exists (select 1 from pikas_private.platform_role_capabilities
             where role_code = 'platform_finance_operator' and capability = 'platform:finance:adjustments:fund')
  then raise exception 'finance_bundle_must_not_fund_adjustments'; end if;
end $$;
commit;
```

Before shipping it:

- Confirm the `platform_roles` columns against the current schema.
- Add a pgTAP test that pins the exact bundle.
- Run the full suite.
- Release it through the normal dry run, so the migration count rises by exactly one.

### B2. Assign a person (only when the owner names them)

Platform «Equipo» manages only `platform_admin` and the Demo operator role, so finance membership is granted by a
reviewed SQL statement run by the owner:

```sql
insert into pikas_private.platform_memberships(person_id, role_code, granted_by_person_id)
values ('<person id of the named operator>', 'platform_finance_operator', '<owner person id>');
```

Postcheck B2:

1. `select role_code, capability from pikas_private.platform_role_capabilities where role_code = 'platform_finance_operator'`
   returns exactly the four capabilities.
2. Exactly one active membership exists for the named person, and `granted_by_person_id` is recorded.
3. The person signs in, sees «Finanzas», and sees no «Fondear ajuste» action.

To revoke B2, run `update pikas_private.platform_memberships set status = 'inactive', revoked_at = now() where …`. The
next request loses authority, because every finance function re-checks capability on the server.

## Part C — Customer activation

**Mechanism:** the backend-only `pikas_private.finance_activate_customer(account_id, policy_version, reason,
request_key)`. There is no activation UI. It:

- refuses a non-customer (sandbox), inactive or already-activated account, or an inactive fee policy;
- locks every student of the customer;
- snapshots the opening balances;
- writes the `opening_legacy_stored_value_liability` entry and the audit;
- replays idempotently by request key (16–128 characters).

### C1. Precheck (all must pass; record the results)

| # | Check | How | Pass when |
|---|---|---|---|
| C1.1 | Gate 0 complete | Part A table | Every row answered and dated |
| C1.2 | Customer identity | `select id, name, tenant_kind, status from accounts where id = '<id>'` | `customer`, `active`, the intended name |
| C1.3 | Not already activated | `select pikas_private.financial_activation('<id>')` | `null` |
| C1.4 | Fee policy | `select version, status, replenishment_fee_bps from financial_fee_policies` | The version the owner approved is `active` |
| C1.5 | Opening wallets | `select count(*), sum(greatest(current_balance_minor,0)), sum(least(current_balance_minor,0)) from student_wallets where account_id = '<id>'` | Recorded; negative balances explained |
| C1.6 | Finance operator exists | Part B postcheck | At least one named finance operator who is not the activator |
| C1.7 | Cafetería readiness | Platform Reportes · Red y adopción | Every Cafetería that will collect cash is «Lista para operar», and the Cafetería Admin is named |
| C1.8 | Shared students | School · Cafeterías | Students served are shared with «Identificación básica» |
| C1.9 | Settlement calendar | Owner | First settlement week and due date agreed with the customer |
| C1.10 | Backup | Supabase dashboard | A recent backup or PITR window covers the activation time |
| C1.11 | Communications | Owner | School and Cafetería told when School «Recargar» stops and Cafetería cash collection starts |

### C2. Activation (one statement, owner-run, in a quiet window)

```sql
select pikas_private.finance_activate_customer('<account id>', <policy version>, '<reason: contract ref + owner approval date>',
  '<request key, e.g. activation-<account short>-<yyyymmdd>-01>');
```

Keep the returned JSON (activation id and opening figures) in the activation record. If the response is lost, run the
**same statement with the same key**. It replays and creates nothing new. A different reason under the same key is
refused (`IDEMPOTENCY_CONFLICT`).

### C3. Postcheck

| # | Check | Pass when |
|---|---|---|
| C3.1 | `select status, opening_* from customer_financial_activations where account_id = '<id>'` | One `active` row matching C2's JSON |
| C3.2 | `select entry_type, amount_minor from financial_entries where account_id = '<id>'` | Only the opening liability, equal to the positive balances from C1.5 (or none if zero) |
| C3.3 | School · PIKAS Cash for that customer | «Recargar» is no longer offered; balances unchanged |
| C3.4 | Cafetería Admin · Recargas en efectivo | Available; a POS cashier does **not** see it |
| C3.5 | First real collection (supervised) | Gross, fee and net shown; wallet credited net; an `REC-` reference appears in Finanzas and in the School movement detail |
| C3.6 | Platform Finanzas · finance report | The customer appears with its policy and fee rate |
| C3.7 | Other customers | Fingerprint of other customers unchanged (no activation, no entries) |

## Part D — Rollback and deactivation

There is no "undo" of an activation. Financial history is immutable by design: entries, obligations, settlements and
audit are never deleted or rewritten.

| Situation | Action | Effect |
|---|---|---|
| Activated the wrong customer, before any activity | Owner runs `pikas_private.finance_end_customer_activation('<id>', '<reason>')` and records the incident | New fee-era activity stops at once (`FINANCIAL_POLICY_NOT_ACTIVE`). The opening entry stays as history; the accountant reverses it in the books, not in the database |
| Must stop new money flows (dispute, legal hold) | End activation as above | Cash collection and fee-era replenishment are refused; POS sales return to the pre-activation model. Existing obligations still settle (202611210001) |
| A single collection was wrong | Platform Finanzas · reverse it (finance operator) | A reversal and a correcting obligation; the original stays visible |
| A settlement is disputed | Liquidaciones · «Poner en revisión» | Totals unchanged; corrections settle later as new movements |
| Customer leaves | End activation, settle remaining weeks, then customer lifecycle suspend/close | Historical settlements remain readable by Platform finance |

**Re-activation** creates a new activation row and duplicates nothing. Run Part C again in full; the prechecks are not
optional the second time.

## Reference: what activation changes

- **School:** loses positive replenishment («Recargar»). «Corregir saldo» offers only decreases.
- **Cafetería Admin:** gains «Recargas en efectivo», which collects gross cash. The wallet receives the net; the fee is
  recorded.
- **Obligations:** each collection creates a Cafetería → clearing `cash_collection` obligation. Each PIKAS Cash sale
  creates a clearing → Cafetería obligation.
- **Settlement:** weekly settlement nets these per Cafetería.
- **Not touched:** POS cash and card sales.
- **Sandbox:** sandbox customers can never be activated; the database refuses it.
