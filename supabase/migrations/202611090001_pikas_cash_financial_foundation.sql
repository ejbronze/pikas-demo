-- PIKAS FIN 2: PIKAS Cash financial foundation (owner-locked economics; local foundation only).
--
-- CENTRAL CLEARING REQUIRES LEGAL/ACCOUNTING APPROVAL BEFORE REAL-MONEY ACTIVATION.
-- Nothing here activates any customer: the model is inert until a customer is explicitly
-- activated (pikas_private.finance_activate_customer, internal only). No capability is granted.
--
-- Two ledgers stay separate:
--   wallet_ledger_entries  = a student's stored-value balance effects (unchanged architecture);
--   financial_entries      = economic events of the central clearing model (append-only);
--   financial_obligations  = who owes whom, from which event (append-only; corrections are new rows).
-- Parties are generic: one clearing party (legal custody not assigned here) and Cafeterías.
-- A wallet is never a party. Legacy (pre-activation) records keep their behaviour: no fee, no
-- policy version, no obligations, no backfill. Fee = round_half_up(gross × bps / 10000) in integer
-- centavos (numeric, never floating point); net = gross − fee.
begin;

-- ── Fee policy (versioned) ─────────────────────────────────────────────────────────────────────
create table public.financial_fee_policies(
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version > 0),
  currency_code text not null references public.supported_currencies(currency_code),
  replenishment_fee_bps integer not null check (replenishment_fee_bps between 0 and 10000),
  rounding_rule text not null check (rounding_rule = 'half_up'),
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  check ((status = 'retired') = (retired_at is not null))
);
insert into public.financial_fee_policies(version,currency_code,replenishment_fee_bps,rounding_rule)
values (1,'DOP',300,'half_up');

-- The one canonical fee computation (database is authoritative; any UI preview must match it).
create function pikas_private.replenishment_fee_minor(p_gross_minor bigint, p_fee_bps integer)
returns bigint language sql immutable strict set search_path = '' as $$
  select (div(p_gross_minor::numeric * p_fee_bps + 5000, 10000))::bigint
$$;

-- ── Per-customer activation ────────────────────────────────────────────────────────────────────
-- Entering the policy records the stored value that already existed (legacy balances the clearing
-- pool did not collect), taken while every wallet of the customer is locked, so the opening figure
-- plus later financial entries always equals the customer's wallet balances.
create table public.customer_financial_activations(
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  policy_id uuid not null references public.financial_fee_policies(id),
  status text not null default 'active' check (status in ('active','ended')),
  activated_at timestamptz not null default clock_timestamp(),
  activation_reason text not null check (length(btrim(activation_reason)) between 3 and 500),
  opening_stored_value_minor bigint not null,
  opening_wallet_count integer not null check (opening_wallet_count >= 0),
  ended_at timestamptz,
  end_reason text check (end_reason is null or length(btrim(end_reason)) between 3 and 500),
  request_key text not null check (length(request_key) between 16 and 128),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  unique (request_key),
  check ((status = 'ended') = (ended_at is not null and end_reason is not null)),
  check (ended_at is null or ended_at >= activated_at)
);
create unique index customer_financial_activations_one_active on public.customer_financial_activations(account_id) where status = 'active';

create function pikas_private.financial_activation(p_account_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select a.id from public.customer_financial_activations a where a.account_id = p_account_id and a.status = 'active'
$$;

-- ── Parties ────────────────────────────────────────────────────────────────────────────────────
create table public.financial_parties(
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('clearing','cafeteria')),
  account_id uuid references public.accounts(id),
  cafeteria_id uuid unique references public.cafeterias(id),
  label text not null check (length(btrim(label)) between 1 and 160),
  created_at timestamptz not null default clock_timestamp(),
  check ((kind = 'clearing' and account_id is null and cafeteria_id is null) or (kind = 'cafeteria' and account_id is not null and cafeteria_id is not null))
);
create unique index financial_parties_one_clearing on public.financial_parties(kind) where kind = 'clearing';
insert into public.financial_parties(kind,label) values ('clearing','Compensación central PIKAS (custodia legal por definir)');

create function pikas_private.clearing_party() returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.financial_parties where kind = 'clearing'
$$;
create function pikas_private.cafeteria_party(p_cafeteria_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.financial_parties where cafeteria_id = p_cafeteria_id;
  if v is null then
    insert into public.financial_parties(kind,account_id,cafeteria_id,label)
    select 'cafeteria', c.account_id, c.id, c.name from public.cafeterias c where c.id = p_cafeteria_id
    on conflict (cafeteria_id) do nothing returning id into v;
    if v is null then select id into v from public.financial_parties where cafeteria_id = p_cafeteria_id; end if;
  end if;
  if v is null then raise exception using errcode = '23503', message = 'cafeteria_not_found'; end if;
  return v;
end $$;

-- Weekly settlement calendar: Monday–Sunday in America/Santo_Domingo, due the following Tuesday.
create function pikas_private.settlement_week_start(p_at timestamptz) returns date language sql stable set search_path = '' as $$
  select (date_trunc('week', p_at at time zone 'America/Santo_Domingo'))::date
$$;

-- ── Replenishment requests ─────────────────────────────────────────────────────────────────────
create sequence public.replenishment_reference_seq;
create table public.replenishment_requests(
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^REC-[0-9]{8}$'),
  account_id uuid not null references public.accounts(id),
  school_id uuid not null references public.schools(id),
  student_id uuid not null references public.students(id),
  wallet_id uuid references public.student_wallets(id),
  currency_code text not null references public.supported_currencies(currency_code),
  method text not null check (method in ('bank_transfer','cafeteria_cash')),
  activation_id uuid not null references public.customer_financial_activations(id),
  policy_id uuid not null references public.financial_fee_policies(id),
  fee_bps integer not null check (fee_bps between 0 and 10000),
  -- Technical ceiling only (JavaScript-safe integer), not a business limit.
  gross_minor bigint not null check (gross_minor between 1 and 9007199254740991),
  fee_minor bigint not null check (fee_minor >= 0),
  net_minor bigint not null check (net_minor > 0),
  collecting_cafeteria_id uuid references public.cafeterias(id),
  cafeteria_customer_id uuid references public.cafeteria_customers(id),
  payer_reference text check (payer_reference is null or length(btrim(payer_reference)) between 1 and 160),
  payer_name text check (payer_name is null or length(btrim(payer_name)) between 1 and 160),
  payer_note text check (payer_note is null or length(btrim(payer_note)) between 1 and 500),
  external_proof_reference text check (external_proof_reference is null or length(btrim(external_proof_reference)) between 1 and 300),
  state text not null check (state in ('submitted','posted','rejected')),
  submitted_by uuid not null references public.persons(id),
  submitted_role text not null check (submitted_role in ('platform_operator','school_admin','account_admin','cafeteria_staff')),
  submitted_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.persons(id),
  decided_at timestamptz,
  rejection_reason text check (rejection_reason is null or length(btrim(rejection_reason)) between 3 and 500),
  posted_at timestamptz,
  wallet_replenishment_id uuid unique,
  request_key text not null check (length(request_key) between 16 and 128),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  decision_request_key text check (decision_request_key is null or length(decision_request_key) between 16 and 128),
  decision_fingerprint text check (decision_fingerprint is null or decision_fingerprint ~ '^[0-9a-f]{64}$'),
  unique (account_id, request_key),
  unique (account_id, decision_request_key),
  -- gross = fee + net, with the fee from the canonical function.
  check (gross_minor = fee_minor + net_minor),
  check (fee_minor = pikas_private.replenishment_fee_minor(gross_minor, fee_bps)),
  check ((method = 'cafeteria_cash') = (collecting_cafeteria_id is not null)),
  check (method <> 'cafeteria_cash' or cafeteria_customer_id is not null),
  check (method <> 'bank_transfer' or (payer_reference is not null and cafeteria_customer_id is null)),
  check (state <> 'submitted' or (decided_by is null and decided_at is null and rejection_reason is null and posted_at is null and wallet_replenishment_id is null and decision_request_key is null)),
  check (state <> 'posted' or (posted_at is not null and wallet_replenishment_id is not null and wallet_id is not null and rejection_reason is null)),
  check (state <> 'posted' or method <> 'bank_transfer' or (decided_by is not null and decided_at is not null and decision_request_key is not null)),
  check (state <> 'rejected' or (method = 'bank_transfer' and decided_by is not null and decided_at is not null and rejection_reason is not null
    and posted_at is null and wallet_replenishment_id is null and decision_request_key is not null)),
  check (decided_at is null or decided_at >= submitted_at),
  check (posted_at is null or posted_at >= submitted_at)
);

-- The existing immutable wallet replenishment records the posting; fee-era rows link back.
alter table public.wallet_replenishments add column financial_request_id uuid unique references public.replenishment_requests(id);
alter table public.wallet_replenishments drop constraint wallet_replenishments_source_check;
alter table public.wallet_replenishments add constraint wallet_replenishments_source_check
  check (source in ('manual_verified','bank_transfer_verified','cafeteria_cash_collected'));
alter table public.wallet_replenishments add constraint wallet_replenishments_financial_source_check
  check ((source = 'manual_verified') = (financial_request_id is null));
alter table public.replenishment_requests add constraint replenishment_requests_wallet_replenishment_fkey
  foreign key (wallet_replenishment_id) references public.wallet_replenishments(id);

-- ── Financial entries (append-only) ────────────────────────────────────────────────────────────
-- Amounts are positive; the type gives the direction:
--   replenishment_gross_collected   gross received by the collector (clearing for bank; the Cafetería for cash)
--   replenishment_fee_earned        PIKAS fee generated by the replenishment
--   stored_value_issued             wallet value created (net)
--   stored_value_redeemed           wallet value spent at a Cafetería (wallet-funded purchase)
--   stored_value_restored           wallet value returned by a wallet refund
--   stored_value_adjusted_increase / _decrease   administrative wallet adjustment of an activated customer
--   replenishment_gross_reversed / replenishment_fee_reversed / stored_value_cancelled   reversal counter-events
--   legacy_stored_value_reversed    a pre-activation replenishment reversed after activation (wallet value removed)
create table public.financial_entries(
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  school_id uuid not null references public.schools(id),
  cafeteria_id uuid references public.cafeterias(id),
  currency_code text not null references public.supported_currencies(currency_code),
  entry_type text not null check (entry_type in ('replenishment_gross_collected','replenishment_fee_earned','stored_value_issued',
    'stored_value_redeemed','stored_value_restored','stored_value_adjusted_increase','stored_value_adjusted_decrease',
    'replenishment_gross_reversed','replenishment_fee_reversed','stored_value_cancelled','legacy_stored_value_reversed')),
  amount_minor bigint not null check (amount_minor > 0),
  replenishment_request_id uuid references public.replenishment_requests(id),
  wallet_replenishment_id uuid references public.wallet_replenishments(id),
  wallet_purchase_debit_id uuid unique references public.wallet_purchase_debits(id),
  wallet_refund_credit_id uuid unique references public.wallet_refund_credits(id),
  wallet_adjustment_id uuid unique references public.wallet_adjustments(id),
  wallet_replenishment_reversal_id uuid references public.wallet_replenishment_reversals(id),
  reverses_entry_id uuid unique references public.financial_entries(id),
  actor_person_id uuid references public.persons(id),
  occurred_at timestamptz not null default clock_timestamp(),
  check (
    (entry_type in ('replenishment_gross_collected','replenishment_fee_earned','stored_value_issued') and replenishment_request_id is not null
      and wallet_purchase_debit_id is null and wallet_refund_credit_id is null and wallet_adjustment_id is null and wallet_replenishment_reversal_id is null and reverses_entry_id is null)
    or (entry_type = 'stored_value_redeemed' and wallet_purchase_debit_id is not null and cafeteria_id is not null and replenishment_request_id is null and reverses_entry_id is null)
    or (entry_type = 'stored_value_restored' and wallet_refund_credit_id is not null and cafeteria_id is not null and replenishment_request_id is null and reverses_entry_id is null)
    or (entry_type in ('stored_value_adjusted_increase','stored_value_adjusted_decrease') and wallet_adjustment_id is not null and replenishment_request_id is null and reverses_entry_id is null)
    or (entry_type in ('replenishment_gross_reversed','replenishment_fee_reversed','stored_value_cancelled') and replenishment_request_id is not null
      and wallet_replenishment_reversal_id is not null and reverses_entry_id is not null)
    or (entry_type = 'legacy_stored_value_reversed' and wallet_replenishment_reversal_id is not null and replenishment_request_id is null and reverses_entry_id is null)),
  check (entry_type <> 'stored_value_issued' or wallet_replenishment_id is not null)
);
create unique index financial_entries_one_per_request on public.financial_entries(replenishment_request_id, entry_type) where replenishment_request_id is not null;

-- ── Obligations (append-only) ──────────────────────────────────────────────────────────────────
--   cash_collection               Cafetería → clearing: the gross cash it collected
--   wallet_purchase_fulfillment   clearing → Cafetería: the wallet-funded amount it fulfilled
--   cash_collection_reversal      clearing → Cafetería: correction when a cash replenishment is reversed
--   wallet_refund_correction      Cafetería → clearing: correction when a wallet purchase is refunded
-- Outstanding until a future settlement (FIN 5) links it; never edited.
create table public.financial_obligations(
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  school_id uuid not null references public.schools(id),
  cafeteria_id uuid not null references public.cafeterias(id),
  currency_code text not null references public.supported_currencies(currency_code),
  reason text not null check (reason in ('cash_collection','wallet_purchase_fulfillment','cash_collection_reversal','wallet_refund_correction')),
  debtor_party_id uuid not null references public.financial_parties(id),
  creditor_party_id uuid not null references public.financial_parties(id),
  amount_minor bigint not null check (amount_minor > 0),
  source_entry_id uuid not null unique references public.financial_entries(id),
  corrects_obligation_id uuid references public.financial_obligations(id),
  settlement_week_start date not null,
  settlement_due_on date not null,
  created_at timestamptz not null default clock_timestamp(),
  check (debtor_party_id <> creditor_party_id),
  check ((reason in ('cash_collection_reversal','wallet_refund_correction')) = (corrects_obligation_id is not null)),
  check (extract(isodow from settlement_week_start) = 1 and settlement_due_on = settlement_week_start + 8)
);

create function pikas_private.guard_financial_obligation() returns trigger language plpgsql security definer set search_path = '' as $$
declare debtor text; creditor text; original public.financial_obligations; corrected numeric; cafeteria_party uuid;
begin
  select kind into debtor from public.financial_parties where id = new.debtor_party_id;
  select kind into creditor from public.financial_parties where id = new.creditor_party_id;
  select id into cafeteria_party from public.financial_parties where cafeteria_id = new.cafeteria_id;
  if (new.reason in ('cash_collection','wallet_refund_correction') and not (debtor = 'cafeteria' and creditor = 'clearing' and new.debtor_party_id = cafeteria_party))
    or (new.reason in ('wallet_purchase_fulfillment','cash_collection_reversal') and not (debtor = 'clearing' and creditor = 'cafeteria' and new.creditor_party_id = cafeteria_party)) then
    raise exception using errcode = '23514', message = 'OBLIGATION_DIRECTION_INVALID';
  end if;
  if new.corrects_obligation_id is not null then
    select * into original from public.financial_obligations where id = new.corrects_obligation_id for update;
    if original.id is null or original.cafeteria_id <> new.cafeteria_id or original.debtor_party_id <> new.creditor_party_id or original.creditor_party_id <> new.debtor_party_id
      or (new.reason = 'cash_collection_reversal' and original.reason <> 'cash_collection')
      or (new.reason = 'wallet_refund_correction' and original.reason <> 'wallet_purchase_fulfillment') then
      raise exception using errcode = '23514', message = 'OBLIGATION_CORRECTION_INVALID';
    end if;
    select coalesce(sum(amount_minor), 0) into corrected from public.financial_obligations where corrects_obligation_id = original.id;
    if corrected + new.amount_minor > original.amount_minor then raise exception using errcode = '23514', message = 'OBLIGATION_CORRECTION_EXCEEDS_ORIGINAL'; end if;
  end if;
  return new;
end $$;
create trigger financial_obligation_guard before insert on public.financial_obligations for each row execute function pikas_private.guard_financial_obligation();

create function pikas_private.record_obligation(p_entry public.financial_entries, p_reason text, p_debtor uuid, p_creditor uuid, p_corrects uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid; week date := pikas_private.settlement_week_start(p_entry.occurred_at);
begin
  insert into public.financial_obligations(account_id,school_id,cafeteria_id,currency_code,reason,debtor_party_id,creditor_party_id,amount_minor,
    source_entry_id,corrects_obligation_id,settlement_week_start,settlement_due_on)
  values (p_entry.account_id,p_entry.school_id,p_entry.cafeteria_id,p_entry.currency_code,p_reason,p_debtor,p_creditor,p_entry.amount_minor,
    p_entry.id,p_corrects,week,week + 8) returning id into v;
  return v;
end $$;

-- ── Immutability ───────────────────────────────────────────────────────────────────────────────
create trigger financial_entries_immutable before update or delete on public.financial_entries for each row execute function pikas_private.reject_wallet_history_mutation();
create trigger financial_entries_no_truncate before truncate on public.financial_entries for each statement execute function pikas_private.reject_wallet_history_mutation();
create trigger financial_obligations_immutable before update or delete on public.financial_obligations for each row execute function pikas_private.reject_wallet_history_mutation();
create trigger financial_obligations_no_truncate before truncate on public.financial_obligations for each statement execute function pikas_private.reject_wallet_history_mutation();
create trigger financial_parties_immutable before update or delete on public.financial_parties for each row execute function pikas_private.reject_wallet_history_mutation();
create trigger financial_parties_no_truncate before truncate on public.financial_parties for each statement execute function pikas_private.reject_wallet_history_mutation();

create function pikas_private.guard_fee_policy() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception using errcode = '55000', message = 'FEE_POLICY_IMMUTABLE'; end if;
  -- Only retirement: rate, rounding, currency and version never change once created.
  if new.id <> old.id or new.version <> old.version or new.currency_code <> old.currency_code or new.replenishment_fee_bps <> old.replenishment_fee_bps
    or new.rounding_rule <> old.rounding_rule or new.created_at <> old.created_at or not (old.status = 'active' and new.status = 'retired') then
    raise exception using errcode = '55000', message = 'FEE_POLICY_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger financial_fee_policy_guard before update or delete on public.financial_fee_policies for each row execute function pikas_private.guard_fee_policy();
create trigger financial_fee_policies_no_truncate before truncate on public.financial_fee_policies for each statement execute function pikas_private.reject_wallet_history_mutation();

create function pikas_private.guard_customer_activation() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception using errcode = '55000', message = 'ACTIVATION_IMMUTABLE'; end if;
  if (to_jsonb(new) - array['status','ended_at','end_reason']) <> (to_jsonb(old) - array['status','ended_at','end_reason'])
    or not (old.status = 'active' and new.status = 'ended') then
    raise exception using errcode = '55000', message = 'ACTIVATION_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger customer_financial_activation_guard before update or delete on public.customer_financial_activations for each row execute function pikas_private.guard_customer_activation();
create trigger customer_financial_activations_no_truncate before truncate on public.customer_financial_activations for each statement execute function pikas_private.reject_wallet_history_mutation();

-- A request changes once: submitted → posted | rejected, and only its decision fields.
create function pikas_private.guard_replenishment_request() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception using errcode = '55000', message = 'REPLENISHMENT_REQUEST_IMMUTABLE'; end if;
  if old.state <> 'submitted' or new.state not in ('posted','rejected')
    or (to_jsonb(new) - array['state','wallet_id','decided_by','decided_at','rejection_reason','posted_at','wallet_replenishment_id','decision_request_key','decision_fingerprint'])
       <> (to_jsonb(old) - array['state','wallet_id','decided_by','decided_at','rejection_reason','posted_at','wallet_replenishment_id','decision_request_key','decision_fingerprint']) then
    raise exception using errcode = '55000', message = 'REPLENISHMENT_REQUEST_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger replenishment_request_guard before update or delete on public.replenishment_requests for each row execute function pikas_private.guard_replenishment_request();
create trigger replenishment_requests_no_truncate before truncate on public.replenishment_requests for each statement execute function pikas_private.reject_wallet_history_mutation();

-- At commit, a posted request must reconcile completely: wallet posting = net, entries = gross/fee/net,
-- and for cash exactly one Cafetería → clearing obligation for the gross. Cash never stays unposted.
create function pikas_private.assert_replenishment_request_complete() returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.replenishment_requests; wr public.wallet_replenishments; ledger_amount bigint; g bigint; f bigint; i bigint; obligations bigint;
begin
  select * into r from public.replenishment_requests where id = new.id;
  if r.method = 'cafeteria_cash' and r.state <> 'posted' then raise exception using errcode = '23514', message = 'CASH_REPLENISHMENT_MUST_POST'; end if;
  if r.state <> 'posted' then return null; end if;
  select * into wr from public.wallet_replenishments where id = r.wallet_replenishment_id;
  select amount_minor into ledger_amount from public.wallet_ledger_entries where replenishment_id = wr.id;
  select coalesce(sum(amount_minor) filter (where entry_type = 'replenishment_gross_collected'), 0), coalesce(sum(amount_minor) filter (where entry_type = 'replenishment_fee_earned'), 0),
         coalesce(sum(amount_minor) filter (where entry_type = 'stored_value_issued'), 0)
    into g, f, i from public.financial_entries where replenishment_request_id = r.id and reverses_entry_id is null;
  select count(*) into obligations from public.financial_obligations o join public.financial_entries e on e.id = o.source_entry_id
    where e.replenishment_request_id = r.id and o.reason = 'cash_collection' and o.amount_minor = r.gross_minor;
  if wr.id is null or wr.financial_request_id <> r.id or wr.amount_minor <> r.net_minor or wr.wallet_id <> r.wallet_id or ledger_amount is distinct from r.net_minor
    or wr.source <> (case r.method when 'bank_transfer' then 'bank_transfer_verified' else 'cafeteria_cash_collected' end)
    or g <> r.gross_minor or f <> r.fee_minor or i <> r.net_minor or g <> f + i
    or obligations <> (case r.method when 'cafeteria_cash' then 1 else 0 end) then
    raise exception using errcode = '23514', message = 'REPLENISHMENT_REQUEST_INCOMPLETE';
  end if;
  return null;
end $$;
create constraint trigger replenishment_request_complete after insert or update on public.replenishment_requests
  deferrable initially deferred for each row execute function pikas_private.assert_replenishment_request_complete();

-- ── Row security: no direct table access; reads and writes go through checked functions ───────
alter table public.financial_fee_policies enable row level security; alter table public.financial_fee_policies force row level security;
alter table public.customer_financial_activations enable row level security; alter table public.customer_financial_activations force row level security;
alter table public.financial_parties enable row level security; alter table public.financial_parties force row level security;
alter table public.replenishment_requests enable row level security; alter table public.replenishment_requests force row level security;
alter table public.financial_entries enable row level security; alter table public.financial_entries force row level security;
alter table public.financial_obligations enable row level security; alter table public.financial_obligations force row level security;
revoke all on public.financial_fee_policies, public.customer_financial_activations, public.financial_parties, public.replenishment_requests,
  public.financial_entries, public.financial_obligations from public, anon, authenticated, service_role;
revoke all on sequence public.replenishment_reference_seq from public, anon, authenticated, service_role;

-- ── Activation (internal: no tenant or Platform role can call it in FIN 2) ─────────────────────
create function pikas_private.finance_activate_customer(p_account_id uuid, p_policy_version integer, p_reason text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare acct public.accounts; pol public.financial_fee_policies; act public.customer_financial_activations; fp text; opening numeric; wallets integer;
begin
  if p_request_key is null or length(p_request_key) not between 16 and 128 then raise exception using errcode = '22023', message = 'invalid_request_key'; end if;
  fp := encode(extensions.digest(convert_to(jsonb_build_object('account_id',p_account_id,'policy_version',p_policy_version,'reason',btrim(p_reason))::text,'UTF8'),'sha256'),'hex');
  select * into act from public.customer_financial_activations where request_key = p_request_key;
  if found then
    if act.payload_fingerprint <> fp then raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('activation_id',act.id,'account_id',act.account_id,'opening_stored_value_minor',act.opening_stored_value_minor::text,'opening_wallet_count',act.opening_wallet_count);
  end if;
  select * into acct from public.accounts where id = p_account_id for update;
  if not found or acct.tenant_kind <> 'customer' or acct.status <> 'active' then raise exception using errcode = '23514', message = 'ACTIVATION_REQUIRES_ACTIVE_CUSTOMER'; end if;
  select * into pol from public.financial_fee_policies where version = p_policy_version;
  if not found or pol.status <> 'active' then raise exception using errcode = '23514', message = 'FEE_POLICY_NOT_ACTIVE'; end if;
  if pikas_private.financial_activation(p_account_id) is not null then raise exception using errcode = '23514', message = 'FINANCIAL_POLICY_ALREADY_ACTIVE'; end if;
  -- Serialize with every wallet operation of this customer (they all take the per-student lock), then snapshot.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.id::text, 0)) from public.students s where s.account_id = p_account_id order by s.id;
  select coalesce(sum(w.current_balance_minor::numeric), 0), count(*) into opening, wallets
    from (select current_balance_minor from public.student_wallets where account_id = p_account_id and currency_code = pol.currency_code order by id for share) w;
  insert into public.customer_financial_activations(account_id,policy_id,activation_reason,opening_stored_value_minor,opening_wallet_count,request_key,payload_fingerprint)
  values (p_account_id,pol.id,btrim(p_reason),opening::bigint,wallets,p_request_key,fp) returning * into act;
  perform pikas_private.record_wallet_audit(null,null,'system','system',p_account_id,null,null,'financial_policy_activated','customer_financial_activations',act.id,
    jsonb_build_object('policy_version',pol.version,'fee_bps',pol.replenishment_fee_bps,'opening_wallet_count',wallets));
  return jsonb_build_object('activation_id',act.id,'account_id',act.account_id,'opening_stored_value_minor',act.opening_stored_value_minor::text,'opening_wallet_count',act.opening_wallet_count);
end $$;

create function pikas_private.finance_end_customer_activation(p_account_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare act_id uuid;
begin
  perform 1 from public.accounts where id = p_account_id for update;
  act_id := pikas_private.financial_activation(p_account_id);
  if act_id is null then raise exception using errcode = '23514', message = 'FINANCIAL_POLICY_NOT_ACTIVE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.id::text, 0)) from public.students s where s.account_id = p_account_id order by s.id;
  update public.customer_financial_activations set status = 'ended', ended_at = clock_timestamp(), end_reason = btrim(p_reason) where id = act_id;
  perform pikas_private.record_wallet_audit(null,null,'system','system',p_account_id,null,null,'financial_policy_ended','customer_financial_activations',act_id,'{}'::jsonb);
end $$;

-- ── Posting (shared by bank verification and cash collection) ──────────────────────────────────
create function pikas_private.finance_post_request(p_request_id uuid, p_poster uuid, p_decision_key text default null, p_decision_fp text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.replenishment_requests; w public.student_wallets; wid uuid; wr_id uuid; now_value timestamptz; after_value bigint;
  gross_entry public.financial_entries; clearing uuid; collector uuid;
begin
  select * into r from public.replenishment_requests where id = p_request_id for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.student_id::text, 0));
  if pikas_private.financial_activation(r.account_id) is distinct from r.activation_id then
    raise exception using errcode = '23514', message = 'FINANCIAL_POLICY_NOT_ACTIVE';
  end if;
  select id into wid from public.student_wallets where student_id = r.student_id and school_id = r.school_id and currency_code = r.currency_code;
  if wid is null then
    perform 1 from public.students s join public.persons p on p.id = s.person_id and p.status = 'active'
      join public.student_enrollments e on e.account_id = s.account_id and e.school_id = s.school_id and e.student_id = s.id and e.status = 'active'
      where s.id = r.student_id and s.account_id = r.account_id and s.school_id = r.school_id and s.status = 'active' for share of e;
    if not found then raise exception using errcode = '23514', message = 'wallet_requires_active_enrolled_student'; end if;
    insert into public.student_wallets(account_id,school_id,student_id,currency_code) values (r.account_id,r.school_id,r.student_id,r.currency_code)
      on conflict on constraint student_wallets_student_id_currency_code_key do nothing returning id into wid;
    if wid is null then raise exception using errcode = '40001', message = 'wallet_creation_conflict'; end if;
    perform pikas_private.record_wallet_audit(p_poster,auth.uid(),'system','system',r.account_id,r.school_id,null,'wallet_created','student_wallets',wid,
      jsonb_build_object('currency_code',r.currency_code,'status','active','replenishment_reference',r.reference));
  end if;
  select * into w from public.student_wallets where id = wid for update;
  if w.status <> 'active' then raise exception using errcode = '23514', message = 'wallet_not_active'; end if;
  if r.net_minor::numeric > 9223372036854775807 - w.current_balance_minor::numeric then raise exception using errcode = '22003', message = 'wallet_balance_overflow'; end if;
  now_value := clock_timestamp(); after_value := w.current_balance_minor + r.net_minor;
  insert into public.wallet_replenishments(account_id,school_id,wallet_id,currency_code,amount_minor,source,status,initiated_by,verified_by,initiated_at,verified_at,posted_at,
    cafeteria_id,cafeteria_customer_id,reference,verification_note,idempotency_key,payload_fingerprint,financial_request_id)
  values (r.account_id,r.school_id,wid,r.currency_code,r.net_minor,case r.method when 'bank_transfer' then 'bank_transfer_verified' else 'cafeteria_cash_collected' end,'posted',
    r.submitted_by,p_poster,r.submitted_at,now_value,now_value,r.collecting_cafeteria_id,r.cafeteria_customer_id,r.reference,null,'finance:'||r.id,r.payload_fingerprint,r.id)
  returning id into wr_id;
  update public.student_wallets set current_balance_minor = after_value, balance_version = w.balance_version + 1 where id = wid;
  insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,balance_after_minor,balance_version_after,replenishment_id,occurred_at)
  values (r.account_id,r.school_id,wid,r.currency_code,'replenishment',r.net_minor,after_value,w.balance_version + 1,wr_id,now_value);
  insert into public.financial_entries(account_id,school_id,cafeteria_id,currency_code,entry_type,amount_minor,replenishment_request_id,actor_person_id,occurred_at)
  values (r.account_id,r.school_id,r.collecting_cafeteria_id,r.currency_code,'replenishment_gross_collected',r.gross_minor,r.id,p_poster,now_value) returning * into gross_entry;
  if r.fee_minor > 0 then
    insert into public.financial_entries(account_id,school_id,cafeteria_id,currency_code,entry_type,amount_minor,replenishment_request_id,actor_person_id,occurred_at)
    values (r.account_id,r.school_id,r.collecting_cafeteria_id,r.currency_code,'replenishment_fee_earned',r.fee_minor,r.id,p_poster,now_value);
  end if;
  insert into public.financial_entries(account_id,school_id,cafeteria_id,currency_code,entry_type,amount_minor,replenishment_request_id,wallet_replenishment_id,actor_person_id,occurred_at)
  values (r.account_id,r.school_id,r.collecting_cafeteria_id,r.currency_code,'stored_value_issued',r.net_minor,r.id,wr_id,p_poster,now_value);
  if r.method = 'cafeteria_cash' then
    clearing := pikas_private.clearing_party(); collector := pikas_private.cafeteria_party(r.collecting_cafeteria_id);
    perform pikas_private.record_obligation(gross_entry,'cash_collection',collector,clearing,null);
  end if;
  update public.replenishment_requests set state = 'posted', wallet_id = wid, wallet_replenishment_id = wr_id, posted_at = now_value,
    decided_by = case when r.method = 'bank_transfer' then p_poster else decided_by end, decided_at = case when r.method = 'bank_transfer' then now_value else decided_at end,
    decision_request_key = coalesce(p_decision_key, decision_request_key), decision_fingerprint = coalesce(p_decision_fp, decision_fingerprint)
    where id = r.id;
  return jsonb_build_object('reference',r.reference,'state','posted','gross_minor',r.gross_minor::text,'fee_minor',r.fee_minor::text,'net_minor',r.net_minor::text,
    'wallet_replenishment_id',wr_id,'balance_after_minor',after_value::text);
end $$;

create function pikas_private.finance_request_result(r public.replenishment_requests) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('reference',r.reference,'state',r.state,'method',r.method,'gross_minor',r.gross_minor::text,'fee_minor',r.fee_minor::text,'net_minor',r.net_minor::text,
    'fee_bps',r.fee_bps,'wallet_replenishment_id',r.wallet_replenishment_id,'rejection_reason',r.rejection_reason,
    'balance_after_minor',(select l.balance_after_minor::text from public.wallet_ledger_entries l where l.replenishment_id = r.wallet_replenishment_id))
$$;

-- Shared request creation: activated customer, enrolled student, canonical gross/fee/net, idempotent.
create function pikas_private.finance_create_request(p_method text, p_actor uuid, p_role text, p_account_id uuid, p_school_id uuid, p_student_id uuid, p_gross_minor bigint,
  p_cafeteria_id uuid, p_cafeteria_customer_id uuid, p_payer_reference text, p_payer_name text, p_payer_note text, p_proof_reference text, p_request_key text)
returns public.replenishment_requests language plpgsql security definer set search_path = '' as $$
declare act public.customer_financial_activations; pol public.financial_fee_policies; fp text; r public.replenishment_requests; fee bigint;
begin
  if p_request_key is null or length(p_request_key) not between 16 and 128 then raise exception using errcode = '22023', message = 'invalid_request_key'; end if;
  if p_gross_minor is null or p_gross_minor < 1 or p_gross_minor > 9007199254740991 then raise exception using errcode = '22023', message = 'INVALID_GROSS_AMOUNT'; end if;
  if not exists (select 1 from public.persons where id = p_actor and status = 'active') then raise exception using errcode = '42501', message = 'not_authorized'; end if;
  fp := encode(extensions.digest(convert_to(jsonb_build_object('method',p_method,'actor',p_actor,'role',p_role,'account_id',p_account_id,'school_id',p_school_id,'student_id',p_student_id,
    'gross_minor',p_gross_minor::text,'cafeteria_id',p_cafeteria_id,'cafeteria_customer_id',p_cafeteria_customer_id,'payer_reference',nullif(btrim(p_payer_reference),''),
    'payer_name',nullif(btrim(p_payer_name),''),'payer_note',nullif(btrim(p_payer_note),''),'proof',nullif(btrim(p_proof_reference),''))::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id::text||':'||p_request_key, 20261109));
  select * into r from public.replenishment_requests where account_id = p_account_id and request_key = p_request_key;
  if found then
    if r.payload_fingerprint <> fp then raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT'; end if;
    return r;
  end if;
  select * into act from public.customer_financial_activations where id = pikas_private.financial_activation(p_account_id);
  if act.id is null then raise exception using errcode = '23514', message = 'FINANCIAL_POLICY_NOT_ACTIVE'; end if;
  select * into pol from public.financial_fee_policies where id = act.policy_id;
  if not exists (select 1 from public.students s join public.student_enrollments e on e.account_id = s.account_id and e.school_id = s.school_id and e.student_id = s.id and e.status = 'active'
    where s.id = p_student_id and s.account_id = p_account_id and s.school_id = p_school_id and s.status = 'active') then
    raise exception using errcode = '23514', message = 'active_enrollment_required_for_replenishment';
  end if;
  fee := pikas_private.replenishment_fee_minor(p_gross_minor, pol.replenishment_fee_bps);
  insert into public.replenishment_requests(reference,account_id,school_id,student_id,currency_code,method,activation_id,policy_id,fee_bps,gross_minor,fee_minor,net_minor,
    collecting_cafeteria_id,cafeteria_customer_id,payer_reference,payer_name,payer_note,external_proof_reference,state,submitted_by,submitted_role,request_key,payload_fingerprint)
  values ('REC-'||lpad(nextval('public.replenishment_reference_seq')::text,8,'0'),p_account_id,p_school_id,p_student_id,pol.currency_code,p_method,act.id,pol.id,pol.replenishment_fee_bps,
    p_gross_minor,fee,p_gross_minor - fee,p_cafeteria_id,p_cafeteria_customer_id,nullif(btrim(p_payer_reference),''),nullif(btrim(p_payer_name),''),nullif(btrim(p_payer_note),''),
    nullif(btrim(p_proof_reference),''),'submitted',p_actor,p_role,p_request_key,fp) returning * into r;
  perform pikas_private.record_wallet_audit(p_actor,auth.uid(),p_role,case p_role when 'school_admin' then 'school' when 'account_admin' then 'account' when 'platform_operator' then 'platform' else 'cafeteria' end,p_account_id,p_school_id,p_cafeteria_id,
    'wallet_replenishment_requested','replenishment_requests',r.id,jsonb_build_object('reference',r.reference,'method',p_method));
  return r;
end $$;

-- Bank transfer: submitted only. Nothing reaches the wallet until a verifier approves.
create function pikas_private.finance_submit_bank_replenishment(p_actor uuid, p_role text, p_account_id uuid, p_school_id uuid, p_student_id uuid, p_gross_minor bigint,
  p_payer_reference text, p_payer_name text, p_payer_note text, p_proof_reference text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return pikas_private.finance_request_result(pikas_private.finance_create_request('bank_transfer',p_actor,p_role,p_account_id,p_school_id,p_student_id,p_gross_minor,
    null,null,p_payer_reference,p_payer_name,p_payer_note,p_proof_reference,p_request_key));
end $$;

-- Verification decision: approve posts atomically; reject records the reason. One decision per request.
create function pikas_private.finance_decide_bank_replenishment(p_request_id uuid, p_verifier uuid, p_decision text, p_rejection_reason text, p_decision_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.replenishment_requests; fp text; result jsonb;
begin
  if p_decision not in ('approve','reject') then raise exception using errcode = '22023', message = 'INVALID_DECISION'; end if;
  if p_decision_key is null or length(p_decision_key) not between 16 and 128 then raise exception using errcode = '22023', message = 'invalid_request_key'; end if;
  if p_decision = 'reject' and (p_rejection_reason is null or length(btrim(p_rejection_reason)) < 3) then raise exception using errcode = '22023', message = 'REJECTION_REASON_REQUIRED'; end if;
  if not exists (select 1 from public.persons where id = p_verifier and status = 'active') then raise exception using errcode = '42501', message = 'not_authorized'; end if;
  select * into r from public.replenishment_requests where id = p_request_id for update;
  if not found or r.method <> 'bank_transfer' then raise exception using errcode = '23503', message = 'REPLENISHMENT_REQUEST_NOT_FOUND'; end if;
  fp := encode(extensions.digest(convert_to(jsonb_build_object('request_id',r.id,'decision',p_decision,'reason',nullif(btrim(p_rejection_reason),''),'verifier',p_verifier)::text,'UTF8'),'sha256'),'hex');
  if r.state <> 'submitted' then
    if r.decision_request_key = p_decision_key and r.decision_fingerprint = fp then return pikas_private.finance_request_result(r); end if;
    if r.decision_request_key = p_decision_key then raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT'; end if;
    raise exception using errcode = '23514', message = 'REQUEST_ALREADY_DECIDED';
  end if;
  if exists (select 1 from public.replenishment_requests x where x.account_id = r.account_id and x.decision_request_key = p_decision_key) then
    raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
  end if;
  if p_decision = 'reject' then
    update public.replenishment_requests set state = 'rejected', decided_by = p_verifier, decided_at = clock_timestamp(), rejection_reason = btrim(p_rejection_reason),
      decision_request_key = p_decision_key, decision_fingerprint = fp where id = r.id;
  else
    -- Approval posts in the same transition that records the decision.
    result := pikas_private.finance_post_request(r.id, p_verifier, p_decision_key, fp);
  end if;
  select * into r from public.replenishment_requests where id = r.id;
  perform pikas_private.record_wallet_audit(p_verifier,auth.uid(),'platform_finance_verifier','platform',r.account_id,r.school_id,null,
    case p_decision when 'approve' then 'wallet_replenishment_verified' else 'wallet_replenishment_rejected' end,'replenishment_requests',r.id,
    jsonb_build_object('reference',r.reference,'decision',p_decision));
  return pikas_private.finance_request_result(r);
end $$;

-- Cash at a Cafetería: collected and posted in one transaction (FIN 4 adds the operational permission).
create function pikas_private.finance_post_cash_replenishment(p_actor uuid, p_cafeteria_id uuid, p_cafeteria_customer_id uuid, p_gross_minor bigint, p_payer_name text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cafeterias; cc public.cafeteria_customers; r public.replenishment_requests;
begin
  select * into c from public.cafeterias where id = p_cafeteria_id;
  if not found or c.status <> 'active' or not pikas_private.scope_active(c.account_id,c.school_id,c.id) then raise exception using errcode = '42501', message = 'not_authorized'; end if;
  select cc0.* into cc from public.cafeteria_customers cc0
    join public.school_cafeteria_shares sh on sh.account_id = cc0.account_id and sh.school_id = cc0.school_id and sh.cafeteria_id = cc0.cafeteria_id and sh.status = 'active'
    join public.school_cafeteria_share_categories cat on cat.share_id = sh.id and cat.category = 'basic_identification' and cat.enabled
    where cc0.id = p_cafeteria_customer_id and cc0.cafeteria_id = c.id and cc0.status = 'active';
  if cc.id is null or cc.student_id is null then raise exception using errcode = '42501', message = 'not_authorized_for_student_replenishment'; end if;
  r := pikas_private.finance_create_request('cafeteria_cash',p_actor,'cafeteria_staff',c.account_id,c.school_id,cc.student_id,p_gross_minor,c.id,cc.id,null,p_payer_name,null,null,p_request_key);
  if r.state = 'submitted' then perform pikas_private.finance_post_request(r.id, p_actor); end if;
  select * into r from public.replenishment_requests where id = r.id;
  return pikas_private.finance_request_result(r);
end $$;

-- ── Purchases, refunds and adjustments: accounting side-effects inside their own transactions ─
create function pikas_private.finance_after_wallet_purchase() returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.financial_entries;
begin
  if pikas_private.financial_activation(new.account_id) is null then return null; end if;
  insert into public.financial_entries(account_id,school_id,cafeteria_id,currency_code,entry_type,amount_minor,wallet_purchase_debit_id,actor_person_id,occurred_at)
  values (new.account_id,new.school_id,new.cafeteria_id,new.currency_code,'stored_value_redeemed',new.amount_minor,new.id,new.actor_person_id,new.posted_at) returning * into e;
  perform pikas_private.record_obligation(e,'wallet_purchase_fulfillment',pikas_private.clearing_party(),pikas_private.cafeteria_party(new.cafeteria_id),null);
  return null;
end $$;
create trigger wallet_purchase_debit_financial after insert on public.wallet_purchase_debits for each row execute function pikas_private.finance_after_wallet_purchase();

create function pikas_private.finance_after_wallet_refund() returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.financial_entries; original uuid;
begin
  if pikas_private.financial_activation(new.account_id) is null then return null; end if;
  insert into public.financial_entries(account_id,school_id,cafeteria_id,currency_code,entry_type,amount_minor,wallet_refund_credit_id,actor_person_id,occurred_at)
  values (new.account_id,new.school_id,new.cafeteria_id,new.currency_code,'stored_value_restored',new.amount_minor,new.id,new.actor_person_id,new.posted_at) returning * into e;
  -- Only a purchase that created a fulfillment obligation is corrected (pre-activation purchases had none).
  select o.id into original from public.financial_obligations o join public.financial_entries pe on pe.id = o.source_entry_id
    where pe.wallet_purchase_debit_id = new.original_purchase_debit_id and o.reason = 'wallet_purchase_fulfillment';
  if original is not null then
    perform pikas_private.record_obligation(e,'wallet_refund_correction',pikas_private.cafeteria_party(new.cafeteria_id),pikas_private.clearing_party(),original);
  end if;
  return null;
end $$;
create trigger wallet_refund_credit_financial after insert on public.wallet_refund_credits for each row execute function pikas_private.finance_after_wallet_refund();

create function pikas_private.finance_after_wallet_adjustment() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pikas_private.financial_activation(new.account_id) is null then return null; end if;
  insert into public.financial_entries(account_id,school_id,cafeteria_id,currency_code,entry_type,amount_minor,wallet_adjustment_id,actor_person_id,occurred_at)
  values (new.account_id,new.school_id,new.cafeteria_id,new.currency_code,case when new.amount_minor > 0 then 'stored_value_adjusted_increase' else 'stored_value_adjusted_decrease' end,
    abs(new.amount_minor),new.id,new.actor_person_id,new.posted_at);
  return null;
end $$;
create trigger wallet_adjustment_financial after insert on public.wallet_adjustments for each row execute function pikas_private.finance_after_wallet_adjustment();

-- ── Reversal of fee-era replenishments ─────────────────────────────────────────────────────────
-- Legacy replenishments keep their behaviour. A fee-era replenishment reverses only while the wallet
-- still holds its full net credit; otherwise the request stops with FINANCIAL_RESOLUTION_REQUIRED and
-- nothing changes. A successful reversal counters gross, fee and net and corrects the cash obligation.
create function pikas_private.finance_before_replenishment_reversal() returns trigger language plpgsql security definer set search_path = '' as $$
declare req uuid; balance bigint;
begin
  select financial_request_id into req from public.wallet_replenishments where id = new.replenishment_id;
  if req is null then return new; end if;
  select current_balance_minor into balance from public.student_wallets where id = new.wallet_id for update;
  if balance < new.amount_minor then raise exception using errcode = '23514', message = 'FINANCIAL_RESOLUTION_REQUIRED'; end if;
  return new;
end $$;
create trigger wallet_replenishment_reversal_financial_guard before insert on public.wallet_replenishment_reversals for each row execute function pikas_private.finance_before_replenishment_reversal();

create function pikas_private.finance_after_replenishment_reversal() returns trigger language plpgsql security definer set search_path = '' as $$
declare req public.replenishment_requests; original public.financial_entries; counter public.financial_entries; obligation uuid;
begin
  select r.* into req from public.replenishment_requests r join public.wallet_replenishments w on w.financial_request_id = r.id where w.id = new.replenishment_id;
  if req.id is null then
    -- Legacy replenishment: legacy behaviour; for an activated customer the removed value is still recorded.
    if pikas_private.financial_activation(new.account_id) is not null then
      insert into public.financial_entries(account_id,school_id,currency_code,entry_type,amount_minor,wallet_replenishment_id,wallet_replenishment_reversal_id,actor_person_id,occurred_at)
      values (new.account_id,new.school_id,new.currency_code,'legacy_stored_value_reversed',new.amount_minor,new.replenishment_id,new.id,new.actor_person_id,new.reversed_at);
    end if;
    return null;
  end if;
  for original in select * from public.financial_entries where replenishment_request_id = req.id and reverses_entry_id is null order by occurred_at, entry_type loop
    insert into public.financial_entries(account_id,school_id,cafeteria_id,currency_code,entry_type,amount_minor,replenishment_request_id,wallet_replenishment_id,
      wallet_replenishment_reversal_id,reverses_entry_id,actor_person_id,occurred_at)
    values (original.account_id,original.school_id,original.cafeteria_id,original.currency_code,
      case original.entry_type when 'replenishment_gross_collected' then 'replenishment_gross_reversed' when 'replenishment_fee_earned' then 'replenishment_fee_reversed' else 'stored_value_cancelled' end,
      original.amount_minor,req.id,new.replenishment_id,new.id,original.id,new.actor_person_id,new.reversed_at) returning * into counter;
    if original.entry_type = 'replenishment_gross_collected' and req.method = 'cafeteria_cash' then
      select id into obligation from public.financial_obligations where source_entry_id = original.id;
      perform pikas_private.record_obligation(counter,'cash_collection_reversal',pikas_private.clearing_party(),pikas_private.cafeteria_party(req.collecting_cafeteria_id),obligation);
    end if;
  end loop;
  return null;
end $$;
create trigger wallet_replenishment_reversal_financial after insert on public.wallet_replenishment_reversals for each row execute function pikas_private.finance_after_replenishment_reversal();

-- ── Authority (catalogued, never granted in FIN 2) and narrow reads ────────────────────────────
insert into pikas_private.platform_capabilities(capability) values
  ('platform:finance:replenishments:verify'), ('platform:finance:read'), ('platform:finance:settlement:manage')
on conflict do nothing;

-- Platform verification entry point for FIN 3. Unusable until the owner grants the capability.
create function public.platform_finance_decide_bank_replenishment(p_reference text, p_decision text, p_rejection_reason text, p_decision_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare verifier uuid; rid uuid;
begin
  verifier := pikas_private.require_platform_capability('platform:finance:replenishments:verify');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  select id into rid from public.replenishment_requests where reference = p_reference;
  if rid is null then raise exception using errcode = '23503', message = 'REPLENISHMENT_REQUEST_NOT_FOUND'; end if;
  return pikas_private.finance_decide_bank_replenishment(rid, verifier, p_decision, p_rejection_reason, p_decision_key);
end $$;

-- One replenishment, explained: request, money events, obligations, wallet posting. No network dump.
create function public.platform_finance_replenishment_read(p_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.replenishment_requests;
begin
  perform pikas_private.require_platform_capability('platform:finance:read');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  select * into r from public.replenishment_requests where reference = p_reference;
  if not found then raise exception using errcode = '23503', message = 'REPLENISHMENT_REQUEST_NOT_FOUND'; end if;
  return pikas_private.finance_request_result(r) || jsonb_build_object('policy_version',(select version from public.financial_fee_policies where id = r.policy_id),
    'submitted_at',r.submitted_at,'decided_at',r.decided_at,'posted_at',r.posted_at,'payer_reference',r.payer_reference,'external_proof_reference',r.external_proof_reference,
    'collecting_cafeteria',(select name from public.cafeterias where id = r.collecting_cafeteria_id),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('type',e.entry_type,'amount_minor',e.amount_minor::text,'occurred_at',e.occurred_at,'reverses',e.reverses_entry_id is not null) order by e.occurred_at, e.entry_type)
      from public.financial_entries e where e.replenishment_request_id = r.id),'[]'::jsonb),
    'obligations',coalesce((select jsonb_agg(jsonb_build_object('reason',o.reason,'amount_minor',o.amount_minor::text,'debtor',d.kind,'creditor',c.kind,'week_start',o.settlement_week_start,
      'due_on',o.settlement_due_on,'correction',o.corrects_obligation_id is not null) order by o.created_at)
      from public.financial_obligations o join public.financial_entries e on e.id = o.source_entry_id join public.financial_parties d on d.id = o.debtor_party_id
      join public.financial_parties c on c.id = o.creditor_party_id where e.replenishment_request_id = r.id),'[]'::jsonb));
end $$;

-- A Cafetería's own obligations (FIN 4/5). Requires a tenant capability no role holds yet.
create function public.cafeteria_financial_obligations_read(p_cafeteria_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cafeterias;
begin
  select * into c from public.cafeterias where id = p_cafeteria_id;
  if not found or not pikas_private.has_capability('cafeteria:finance:obligations:read',c.account_id,c.school_id,c.id) or pikas_private.sandbox_pov_current_attempt() then
    raise exception using errcode = '42501', message = 'finance_authority_required';
  end if;
  return jsonb_build_object('cafeteria_id',c.id,'obligations',coalesce((select jsonb_agg(jsonb_build_object('reason',o.reason,'amount_minor',o.amount_minor::text,
    'direction',case when d.kind = 'cafeteria' then 'cafeteria_owes_clearing' else 'clearing_owes_cafeteria' end,'week_start',o.settlement_week_start,'due_on',o.settlement_due_on,
    'correction',o.corrects_obligation_id is not null,'created_at',o.created_at) order by o.created_at)
    from public.financial_obligations o join public.financial_parties d on d.id = o.debtor_party_id where o.cafeteria_id = c.id),'[]'::jsonb));
end $$;

revoke all on function pikas_private.replenishment_fee_minor(bigint,integer), pikas_private.financial_activation(uuid), pikas_private.clearing_party(), pikas_private.cafeteria_party(uuid),
  pikas_private.settlement_week_start(timestamptz), pikas_private.record_obligation(public.financial_entries,text,uuid,uuid,uuid),
  pikas_private.finance_activate_customer(uuid,integer,text,text), pikas_private.finance_end_customer_activation(uuid,text), pikas_private.finance_post_request(uuid,uuid,text,text),
  pikas_private.finance_request_result(public.replenishment_requests),
  pikas_private.finance_create_request(text,uuid,text,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,text,text),
  pikas_private.finance_submit_bank_replenishment(uuid,text,uuid,uuid,uuid,bigint,text,text,text,text,text),
  pikas_private.finance_decide_bank_replenishment(uuid,uuid,text,text,text), pikas_private.finance_post_cash_replenishment(uuid,uuid,uuid,bigint,text,text),
  pikas_private.guard_financial_obligation(), pikas_private.guard_fee_policy(), pikas_private.guard_customer_activation(), pikas_private.guard_replenishment_request(),
  pikas_private.assert_replenishment_request_complete(), pikas_private.finance_after_wallet_purchase(), pikas_private.finance_after_wallet_refund(),
  pikas_private.finance_after_wallet_adjustment(), pikas_private.finance_before_replenishment_reversal(), pikas_private.finance_after_replenishment_reversal()
  from public, anon, authenticated, service_role;
revoke all on function public.platform_finance_decide_bank_replenishment(text,text,text,text), public.platform_finance_replenishment_read(text),
  public.cafeteria_financial_obligations_read(uuid) from public, anon, service_role;
grant execute on function public.platform_finance_decide_bank_replenishment(text,text,text,text), public.platform_finance_replenishment_read(text),
  public.cafeteria_financial_obligations_read(uuid) to authenticated;

-- ── Legacy replenishment: unchanged for customers outside the policy ──────────────────────────
-- Same definition as 202610190001 plus one guard: once a customer is activated, direct School
-- replenishment (no collection source) is refused. Pre-activation customers behave exactly as before.
CREATE OR REPLACE FUNCTION public.post_manual_wallet_replenishment(p_wallet_id uuid, p_amount_minor bigint, p_idempotency_key text, p_reference text DEFAULT NULL::text, p_verification_note text DEFAULT NULL::text, p_cafeteria_customer_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(replenishment_id uuid, status text, amount_minor bigint, currency_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_id uuid; actor_role_value text; actor_scope text; actor_cafeteria_id uuid;
  v_account_id uuid; v_school_id uuid; v_student_id uuid; v_currency_code text;
  v_wallet_status text; v_balance bigint; v_version bigint; v_balance_after bigint; v_now timestamptz;
  v_reference text; v_note text; v_fingerprint text; v_replenishment_id uuid; existing_fingerprint text;
begin
  actor_id := pikas_private.current_person_id();
  if actor_id is null then raise exception using errcode='42501',message='not_authorized'; end if;
  select w.account_id,w.school_id,w.student_id,w.currency_code into v_account_id,v_school_id,v_student_id,v_currency_code
    from public.student_wallets w where w.id=p_wallet_id;
  if not found then raise exception using errcode='23503',message='wallet_not_found'; end if;

  if pikas_private.has_capability('school:wallets:replenish',v_account_id,v_school_id) then
    -- Attribute the credit to the membership require_school_admin resolves first.
    actor_role_value:=case when exists(select 1 from public.account_memberships m where m.account_id=v_account_id
      and m.person_id=actor_id and m.role_code='account_admin' and m.status='active') then 'account_admin' else 'school_admin' end;
    actor_scope:='school'; actor_cafeteria_id:=null;
    if p_cafeteria_customer_id is not null then raise exception using errcode='22023',message='school_scope_does_not_use_cafeteria_customer'; end if;
  else
    select ca.id into actor_cafeteria_id
      from public.cafeteria_customers cc
      join public.cafeterias ca on ca.account_id=cc.account_id and ca.school_id=cc.school_id and ca.id=cc.cafeteria_id
      join public.school_cafeteria_shares sh on sh.account_id=cc.account_id and sh.school_id=cc.school_id and sh.cafeteria_id=cc.cafeteria_id and sh.status='active'
      join public.school_cafeteria_share_categories cat on cat.share_id=sh.id and cat.category='basic_identification' and cat.enabled
      where cc.id=p_cafeteria_customer_id and cc.student_id=v_student_id and cc.status='active'
        and cc.account_id=v_account_id and cc.school_id=v_school_id and ca.status='active'
        and pikas_private.scope_active(v_account_id,v_school_id,ca.id)
        and pikas_private.has_capability('cafeteria:wallets:replenish',v_account_id,v_school_id,ca.id)
      for share;
    if actor_cafeteria_id is null then raise exception using errcode='42501',message='not_authorized_for_student_replenishment'; end if;
    actor_role_value:='cafeteria_admin'; actor_scope:='cafeteria';
  end if;
  if p_amount_minor is null or p_amount_minor<=0 then raise exception using errcode='22023',message='amount_must_be_positive'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 128 then
    raise exception using errcode='22023',message='invalid_idempotency_key';
  end if;
  v_reference:=nullif(btrim(p_reference),''); v_note:=nullif(btrim(p_verification_note),'');
  if v_reference is null and v_note is null then raise exception using errcode='23514',message='verification_evidence_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_student_id::text,0));
  -- Recheck the same authority after the shared student serialization fence.
  -- Stabilize identity, tenant, membership, and eligibility until commit.
  perform 1 from public.persons where id=actor_id for share;
  perform 1 from public.accounts where id=v_account_id for share;
  perform 1 from public.schools where id=v_school_id for share;
  if actor_scope='school' then
    perform 1 from public.school_memberships where account_id=v_account_id and school_id=v_school_id
      and person_id=actor_id order by id for share;
    perform 1 from public.account_memberships where account_id=v_account_id and person_id=actor_id order by id for share;
    if actor_id is distinct from pikas_private.current_person_id() or
      not pikas_private.has_capability('school:wallets:replenish',v_account_id,v_school_id) then
      raise exception using errcode='42501',message='not_authorized';
    end if;
  else
    perform 1 from pikas_private.lock_active_cafeteria_scope(actor_cafeteria_id);
    perform 1 from public.cafeteria_memberships where cafeteria_id=actor_cafeteria_id and person_id=actor_id order by id for share;
    perform 1 from public.cafeteria_customers cc
      join public.school_cafeteria_shares sh on sh.account_id=cc.account_id and sh.school_id=cc.school_id
        and sh.cafeteria_id=cc.cafeteria_id and sh.status='active'
      join public.school_cafeteria_share_categories cat on cat.share_id=sh.id and cat.category='basic_identification' and cat.enabled
      where cc.id=p_cafeteria_customer_id and cc.student_id=v_student_id and cc.cafeteria_id=actor_cafeteria_id and cc.status='active'
      for share of cc,sh,cat;
    if not found or actor_id is distinct from pikas_private.current_person_id() or
      not pikas_private.has_capability('cafeteria:wallets:replenish',v_account_id,v_school_id,actor_cafeteria_id) then
      raise exception using errcode='42501',message='not_authorized_for_student_replenishment';
    end if;
  end if;
  perform 1 from public.students where id=v_student_id for share;
  perform 1 from public.persons where id=(select person_id from public.students where id=v_student_id) for share;
  select w.current_balance_minor,w.balance_version,w.status into v_balance,v_version,v_wallet_status
    from public.student_wallets w where w.id=p_wallet_id and w.account_id=v_account_id and w.school_id=v_school_id for update;
  if not found then raise exception using errcode='23503',message='wallet_not_found'; end if;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('wallet_id',p_wallet_id,
    'amount_minor',p_amount_minor,'currency_code',v_currency_code,'source','manual_verified',
    'reference',v_reference,'verification_note',v_note,'cafeteria_customer_id',p_cafeteria_customer_id,
    'actor_person_id',actor_id)::text,'UTF8'),'sha256'),'hex');
  select r.id,r.payload_fingerprint into v_replenishment_id,existing_fingerprint
    from public.wallet_replenishments r where r.account_id=v_account_id and r.idempotency_key=p_idempotency_key;
  if found then
    if existing_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='idempotency_key_reused_with_different_payload'; end if;
    return query select v_replenishment_id,'posted'::text,p_amount_minor,v_currency_code; return;
  end if;
  -- FIN 2: an activated customer's new wallet value must come from a defined collection source
  -- (verified bank transfer or Cafetería cash). Replays of earlier requests still return above.
  if pikas_private.financial_activation(v_account_id) is not null then
    raise exception using errcode='23514',message='collection_source_required';
  end if;
  if v_wallet_status<>'active' then raise exception using errcode='23514',message='wallet_not_active'; end if;
  if not exists(select 1 from public.supported_currencies c where c.currency_code=v_currency_code and c.status='enabled') then
    raise exception using errcode='22023',message='wallet_currency_not_enabled';
  end if;
    perform 1 from public.students s join public.persons p on p.id=s.person_id and p.status='active'
      join public.student_enrollments e on e.account_id=s.account_id and e.school_id=s.school_id and e.student_id=s.id and e.status='active'
      where s.id=v_student_id and s.account_id=v_account_id and s.school_id=v_school_id and s.status='active'
      for share of e;
    if not found then
    raise exception using errcode='23514',message='active_enrollment_required_for_replenishment';
  end if;
  if p_amount_minor::numeric>9223372036854775807-v_balance::numeric then raise exception using errcode='22003',message='wallet_balance_overflow'; end if;
  v_balance_after:=v_balance+p_amount_minor; v_now:=clock_timestamp();
  insert into public.wallet_replenishments(account_id,school_id,wallet_id,currency_code,amount_minor,source,status,
    initiated_by,verified_by,initiated_at,verified_at,posted_at,cafeteria_id,cafeteria_customer_id,
    reference,verification_note,idempotency_key,payload_fingerprint)
  values(v_account_id,v_school_id,p_wallet_id,v_currency_code,p_amount_minor,'manual_verified','posted',
    actor_id,actor_id,v_now,v_now,v_now,actor_cafeteria_id,p_cafeteria_customer_id,
    v_reference,v_note,p_idempotency_key,v_fingerprint)
  on conflict(account_id,idempotency_key) do nothing returning id into v_replenishment_id;
  if v_replenishment_id is null then
    select r.id,r.payload_fingerprint into v_replenishment_id,existing_fingerprint from public.wallet_replenishments r
      where r.account_id=v_account_id and r.idempotency_key=p_idempotency_key;
    if existing_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='idempotency_key_reused_with_different_payload'; end if;
    return query select v_replenishment_id,'posted'::text,p_amount_minor,v_currency_code; return;
  end if;
  update public.student_wallets set current_balance_minor=v_balance_after,balance_version=v_version+1
    where id=p_wallet_id and account_id=v_account_id and school_id=v_school_id;
  insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,
    balance_after_minor,balance_version_after,replenishment_id,occurred_at)
  values(v_account_id,v_school_id,p_wallet_id,v_currency_code,'replenishment',p_amount_minor,
    v_balance_after,v_version+1,v_replenishment_id,v_now);
  perform pikas_private.record_wallet_audit(actor_id,auth.uid(),actor_role_value,actor_scope,v_account_id,v_school_id,actor_cafeteria_id,
    'wallet_replenishment_posted','wallet_replenishments',v_replenishment_id,
    jsonb_build_object('status','posted','source','manual_verified','currency_code',v_currency_code));
  return query select v_replenishment_id,'posted'::text,p_amount_minor,v_currency_code;
end $function$;
commit;
