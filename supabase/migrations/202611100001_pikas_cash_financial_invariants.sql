-- PIKAS FIN 2 owner refinement: tighter PIKAS Cash financial invariants (local foundation only).
--
-- CENTRAL CLEARING REQUIRES LEGAL/ACCOUNTING APPROVAL BEFORE REAL-MONEY ACTIVATION.
-- Additive on top of 202611090001; no customer is activated and no capability is granted.
--
-- 1. Fee-era replenishment reversals become a Platform finance operation
--    (platform:finance:replenishments:reverse, catalogued, ungranted). Legacy reversals are unchanged.
-- 2. Administrative adjustments of an activated customer carry explicit financial meaning:
--    clearing_funded_adjustment (+) and adjustment_stored_value_reduction (−), with the funding party.
-- 3. Activation records the assumed pre-existing positive wallet value as one
--    opening_legacy_stored_value_liability entry (none when zero).
-- 4. A refund of a pre-activation purchase is the Cafetería returning value: legacy_purchase_refund
--    obligation (Cafetería → clearing), so no activated wallet value appears without a source.
-- Invariant for an activated customer: Σ wallet balances = opening liability − opening negative balances
--   + issued + clearing-funded adjustments + restored − redeemed − cancelled − reductions − legacy reversed.
begin;

-- ── Taxonomy ───────────────────────────────────────────────────────────────────────────────────
-- FIN 2 adjustment types (stored_value_adjusted_increase/_decrease) are replaced by explicitly funded
-- types; no environment holds rows of the old types (FIN 2 is unreleased).
alter table public.financial_entries
  add column customer_financial_activation_id uuid unique references public.customer_financial_activations(id),
  add column funding_party_id uuid references public.financial_parties(id),
  alter column school_id drop not null;
alter table public.financial_entries drop constraint financial_entries_entry_type_check;
alter table public.financial_entries drop constraint financial_entries_check;
alter table public.financial_entries add constraint financial_entries_entry_type_check check (entry_type in (
  'opening_legacy_stored_value_liability',
  'replenishment_gross_collected','replenishment_fee_earned','stored_value_issued',
  'stored_value_redeemed','stored_value_restored',
  'clearing_funded_adjustment','adjustment_stored_value_reduction',
  'replenishment_gross_reversed','replenishment_fee_reversed','stored_value_cancelled','legacy_stored_value_reversed'));
alter table public.financial_entries add constraint financial_entries_source_check check (
  (entry_type = 'opening_legacy_stored_value_liability' and customer_financial_activation_id is not null and school_id is null and cafeteria_id is null
    and replenishment_request_id is null and wallet_replenishment_id is null and wallet_purchase_debit_id is null and wallet_refund_credit_id is null
    and wallet_adjustment_id is null and wallet_replenishment_reversal_id is null and reverses_entry_id is null and funding_party_id is null)
  or (customer_financial_activation_id is null and school_id is not null and (
    (entry_type in ('replenishment_gross_collected','replenishment_fee_earned','stored_value_issued') and replenishment_request_id is not null
      and wallet_purchase_debit_id is null and wallet_refund_credit_id is null and wallet_adjustment_id is null and wallet_replenishment_reversal_id is null
      and reverses_entry_id is null and funding_party_id is null)
    or (entry_type = 'stored_value_redeemed' and wallet_purchase_debit_id is not null and cafeteria_id is not null and replenishment_request_id is null
      and reverses_entry_id is null and funding_party_id is null)
    or (entry_type = 'stored_value_restored' and wallet_refund_credit_id is not null and cafeteria_id is not null and replenishment_request_id is null
      and reverses_entry_id is null and funding_party_id is null)
    or (entry_type in ('clearing_funded_adjustment','adjustment_stored_value_reduction') and wallet_adjustment_id is not null and funding_party_id is not null
      and replenishment_request_id is null and reverses_entry_id is null)
    or (entry_type in ('replenishment_gross_reversed','replenishment_fee_reversed','stored_value_cancelled') and replenishment_request_id is not null
      and wallet_replenishment_reversal_id is not null and reverses_entry_id is not null and funding_party_id is null)
    or (entry_type = 'legacy_stored_value_reversed' and wallet_replenishment_reversal_id is not null and replenishment_request_id is null
      and reverses_entry_id is null and funding_party_id is null))));

-- Activation keeps the net opening snapshot and now splits it into assumed liability and negative balances.
alter table public.customer_financial_activations
  add column opening_legacy_liability_minor bigint not null default 0 check (opening_legacy_liability_minor >= 0),
  add column opening_negative_balance_minor bigint not null default 0 check (opening_negative_balance_minor >= 0);
alter table public.customer_financial_activations add constraint customer_financial_activations_opening_split_check
  check (opening_stored_value_minor::numeric = opening_legacy_liability_minor::numeric - opening_negative_balance_minor::numeric);

alter table public.financial_obligations drop constraint financial_obligations_reason_check;
alter table public.financial_obligations add constraint financial_obligations_reason_check check (reason in (
  'cash_collection','wallet_purchase_fulfillment','cash_collection_reversal','wallet_refund_correction','legacy_purchase_refund'));

-- Fee-era reversals are recorded with the Platform finance role.
alter table public.wallet_replenishment_reversals drop constraint wallet_replenishment_reversals_actor_role_check;
alter table public.wallet_replenishment_reversals add constraint wallet_replenishment_reversals_actor_role_check
  check (actor_role in ('account_admin','school_admin','platform_finance_operator'));

-- ── Obligation guard: same rules plus the legacy purchase refund direction ─────────────────────
create or replace function pikas_private.guard_financial_obligation() returns trigger language plpgsql security definer set search_path = '' as $$
declare debtor text; creditor text; original public.financial_obligations; corrected numeric; cafeteria_party uuid;
begin
  select kind into debtor from public.financial_parties where id = new.debtor_party_id;
  select kind into creditor from public.financial_parties where id = new.creditor_party_id;
  select id into cafeteria_party from public.financial_parties where cafeteria_id = new.cafeteria_id;
  if (new.reason in ('cash_collection','wallet_refund_correction','legacy_purchase_refund') and not (debtor = 'cafeteria' and creditor = 'clearing' and new.debtor_party_id = cafeteria_party))
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

-- ── Activation: opening legacy stored-value liability ──────────────────────────────────────────
-- Only wallets in the policy currency are covered. Positive balances are the liability the clearing
-- model assumes; negative balances are recorded on the activation, never as a money event.
create or replace function pikas_private.finance_activate_customer(p_account_id uuid, p_policy_version integer, p_reason text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare acct public.accounts; pol public.financial_fee_policies; act public.customer_financial_activations; fp text;
  liability numeric; negative numeric; wallets integer;
begin
  if p_request_key is null or length(p_request_key) not between 16 and 128 then raise exception using errcode = '22023', message = 'invalid_request_key'; end if;
  fp := encode(extensions.digest(convert_to(jsonb_build_object('account_id',p_account_id,'policy_version',p_policy_version,'reason',btrim(p_reason))::text,'UTF8'),'sha256'),'hex');
  -- Serialize replays of the same key, so a concurrent replay never races the opening entry.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finance-activation:'||p_request_key, 0));
  select * into act from public.customer_financial_activations where request_key = p_request_key;
  if not found then
    select * into acct from public.accounts where id = p_account_id for update;
    if not found or acct.tenant_kind <> 'customer' or acct.status <> 'active' then raise exception using errcode = '23514', message = 'ACTIVATION_REQUIRES_ACTIVE_CUSTOMER'; end if;
    select * into pol from public.financial_fee_policies where version = p_policy_version;
    if not found or pol.status <> 'active' then raise exception using errcode = '23514', message = 'FEE_POLICY_NOT_ACTIVE'; end if;
    if pikas_private.financial_activation(p_account_id) is not null then raise exception using errcode = '23514', message = 'FINANCIAL_POLICY_ALREADY_ACTIVE'; end if;
    -- Serialize with every wallet operation of this customer (they all take the per-student lock), then snapshot.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.id::text, 0)) from public.students s where s.account_id = p_account_id order by s.id;
    select coalesce(sum(greatest(w.current_balance_minor, 0)::numeric), 0), coalesce(sum(greatest(-w.current_balance_minor::numeric, 0)), 0), count(*)
      into liability, negative, wallets
      from (select current_balance_minor from public.student_wallets where account_id = p_account_id and currency_code = pol.currency_code order by id for share) w;
    insert into public.customer_financial_activations(account_id,policy_id,activation_reason,opening_stored_value_minor,opening_wallet_count,
      opening_legacy_liability_minor,opening_negative_balance_minor,request_key,payload_fingerprint)
    values (p_account_id,pol.id,btrim(p_reason),(liability - negative)::bigint,wallets,liability::bigint,negative::bigint,p_request_key,fp) returning * into act;
    if liability > 0 then
      insert into public.financial_entries(account_id,currency_code,entry_type,amount_minor,customer_financial_activation_id,occurred_at)
      values (p_account_id,pol.currency_code,'opening_legacy_stored_value_liability',liability::bigint,act.id,act.activated_at);
    end if;
    perform pikas_private.record_wallet_audit(null,null,'system','system',p_account_id,null,null,'financial_policy_activated','customer_financial_activations',act.id,
      jsonb_build_object('policy_version',pol.version,'fee_bps',pol.replenishment_fee_bps,'opening_wallet_count',wallets,
        'opening_legacy_liability_minor',liability::bigint::text,'opening_negative_balance_minor',negative::bigint::text));
  elsif act.payload_fingerprint <> fp then
    raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
  end if;
  return jsonb_build_object('activation_id',act.id,'account_id',act.account_id,'opening_stored_value_minor',act.opening_stored_value_minor::text,
    'opening_legacy_liability_minor',act.opening_legacy_liability_minor::text,'opening_negative_balance_minor',act.opening_negative_balance_minor::text,
    'opening_wallet_count',act.opening_wallet_count);
end $$;

-- ── Adjustments: explicit funding, never a replenishment, never a fee ──────────────────────────
-- + : clearing funds the added stored value (no collection happened).
-- − : stored-value liability reduced in favour of clearing (no money is paid out).
create or replace function pikas_private.finance_after_wallet_adjustment() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pikas_private.financial_activation(new.account_id) is null then return null; end if;
  insert into public.financial_entries(account_id,school_id,cafeteria_id,currency_code,entry_type,amount_minor,wallet_adjustment_id,funding_party_id,actor_person_id,occurred_at)
  values (new.account_id,new.school_id,new.cafeteria_id,new.currency_code,
    case when new.amount_minor > 0 then 'clearing_funded_adjustment' else 'adjustment_stored_value_reduction' end,
    abs(new.amount_minor),new.id,pikas_private.clearing_party(),new.actor_person_id,new.posted_at);
  return null;
end $$;

-- ── Refunds: a pre-activation purchase refunded after activation is the Cafetería returning value ─
create or replace function pikas_private.finance_after_wallet_refund() returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.financial_entries; original uuid;
begin
  if pikas_private.financial_activation(new.account_id) is null then return null; end if;
  insert into public.financial_entries(account_id,school_id,cafeteria_id,currency_code,entry_type,amount_minor,wallet_refund_credit_id,actor_person_id,occurred_at)
  values (new.account_id,new.school_id,new.cafeteria_id,new.currency_code,'stored_value_restored',new.amount_minor,new.id,new.actor_person_id,new.posted_at) returning * into e;
  select o.id into original from public.financial_obligations o join public.financial_entries pe on pe.id = o.source_entry_id
    where pe.wallet_purchase_debit_id = new.original_purchase_debit_id and o.reason = 'wallet_purchase_fulfillment';
  if original is not null then
    perform pikas_private.record_obligation(e,'wallet_refund_correction',pikas_private.cafeteria_party(new.cafeteria_id),pikas_private.clearing_party(),original);
  else
    perform pikas_private.record_obligation(e,'legacy_purchase_refund',pikas_private.cafeteria_party(new.cafeteria_id),pikas_private.clearing_party(),null);
  end if;
  return null;
end $$;

-- ── Reversal guard: fee-era needs the finance operation; balance rule unchanged ────────────────
create or replace function pikas_private.finance_before_replenishment_reversal() returns trigger language plpgsql security definer set search_path = '' as $$
declare req uuid; balance bigint;
begin
  select financial_request_id into req from public.wallet_replenishments where id = new.replenishment_id;
  if req is null then
    if new.actor_role = 'platform_finance_operator' then raise exception using errcode = '42501', message = 'legacy_reversal_is_tenant_operation'; end if;
    return new;
  end if;
  if new.actor_role <> 'platform_finance_operator' then raise exception using errcode = '42501', message = 'finance_reversal_authority_required'; end if;
  select current_balance_minor into balance from public.student_wallets where id = new.wallet_id for update;
  if balance < new.amount_minor then raise exception using errcode = '23514', message = 'FINANCIAL_RESOLUTION_REQUIRED'; end if;
  return new;
end $$;

-- ── Fee-era reversal (finance operation) ───────────────────────────────────────────────────────
create function pikas_private.finance_reverse_replenishment(p_request_id uuid, p_actor uuid, p_reason text, p_note text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.replenishment_requests; rep public.wallet_replenishments; w public.student_wallets; rv public.wallet_replenishment_reversals;
  clean_note text; fp text; new_balance bigint; new_version bigint; now_value timestamptz;
begin
  if p_request_key is null or length(p_request_key) not between 16 and 128 then raise exception using errcode = '22023', message = 'invalid_request_key'; end if;
  if not exists (select 1 from public.persons where id = p_actor and status = 'active') then raise exception using errcode = '42501', message = 'not_authorized'; end if;
  clean_note := nullif(btrim(p_note),'');
  if p_reason is null or p_reason not in ('wrong_amount','wrong_student','duplicate_replenishment','wrong_verification','other') then
    raise exception using errcode = '22023', message = 'INVALID_REVERSAL_REASON'; end if;
  if length(clean_note) > 500 or (p_reason = 'other' and (clean_note is null or length(clean_note) < 3)) then
    raise exception using errcode = '22023', message = 'INVALID_REVERSAL_NOTE'; end if;
  select * into r from public.replenishment_requests where id = p_request_id;
  if not found then raise exception using errcode = '23503', message = 'REPLENISHMENT_REQUEST_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.student_id::text, 0));
  select * into r from public.replenishment_requests where id = p_request_id;
  if r.state <> 'posted' then raise exception using errcode = '23514', message = 'REPLENISHMENT_NOT_POSTED'; end if;
  select * into rep from public.wallet_replenishments where id = r.wallet_replenishment_id;
  select * into w from public.student_wallets where id = rep.wallet_id for update;
  fp := encode(extensions.digest(convert_to(jsonb_build_object('request_id',r.id,'reason',p_reason,'note',clean_note,'actor',p_actor)::text,'UTF8'),'sha256'),'hex');
  select * into rv from public.wallet_replenishment_reversals where account_id = rep.account_id and request_key = p_request_key;
  if found then
    if rv.payload_fingerprint <> fp or rv.replenishment_id <> rep.id then raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT'; end if;
  else
    if exists (select 1 from public.wallet_replenishment_reversals x where x.replenishment_id = rep.id) then
      raise exception using errcode = '23514', message = 'REPLENISHMENT_ALREADY_REVERSED'; end if;
    new_balance := w.current_balance_minor - rep.amount_minor; new_version := w.balance_version + 1; now_value := clock_timestamp();
    insert into public.wallet_replenishment_reversals(account_id,school_id,wallet_id,student_id,replenishment_id,currency_code,amount_minor,
      reason,note,actor_person_id,actor_role,request_key,payload_fingerprint,reversed_at)
    values (rep.account_id,rep.school_id,w.id,w.student_id,rep.id,rep.currency_code,rep.amount_minor,p_reason,clean_note,p_actor,'platform_finance_operator',
      p_request_key,fp,now_value) returning * into rv;
    update public.student_wallets set current_balance_minor = new_balance, balance_version = new_version where id = w.id;
    insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,balance_after_minor,
      balance_version_after,replenishment_reversal_id,occurred_at)
    values (rep.account_id,rep.school_id,w.id,rep.currency_code,'replenishment_reversal',-rep.amount_minor,new_balance,new_version,rv.id,now_value);
    perform pikas_private.record_wallet_audit(p_actor,auth.uid(),'platform_finance_operator','platform',rep.account_id,rep.school_id,null,
      'wallet_replenishment_reversed','wallet_replenishment_reversals',rv.id,
      jsonb_build_object('replenishment_reference',r.reference,'reason',p_reason,'gross_minor',r.gross_minor::text,'fee_minor',r.fee_minor::text,'net_minor',r.net_minor::text));
  end if;
  return jsonb_build_object('reference',r.reference,'state','reversed','gross_minor',r.gross_minor::text,'fee_minor',r.fee_minor::text,
    'net_minor',rv.amount_minor::text,'reason',rv.reason,'reversed_at',rv.reversed_at);
end $$;

insert into pikas_private.platform_capabilities(capability) values ('platform:finance:replenishments:reverse') on conflict do nothing;

-- Platform finance entry point. Unusable until the owner grants the capability; no tenant authority.
create function public.platform_finance_reverse_replenishment(p_reference text, p_reason text, p_note text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; r public.replenishment_requests;
begin
  actor := pikas_private.require_platform_capability('platform:finance:replenishments:reverse');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  select * into r from public.replenishment_requests where reference = p_reference;
  if not found then raise exception using errcode = '23503', message = 'REPLENISHMENT_REQUEST_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.student_id::text, 0));
  actor := pikas_private.require_platform_capability('platform:finance:replenishments:reverse');
  return pikas_private.finance_reverse_replenishment(r.id, actor, p_reason, p_note, p_request_key);
end $$;

revoke all on function pikas_private.finance_reverse_replenishment(uuid,uuid,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.platform_finance_reverse_replenishment(text,text,text,text) from public, anon, service_role;
grant execute on function public.platform_finance_reverse_replenishment(text,text,text,text) to authenticated;

-- ── School reversal: legacy behaviour unchanged; fee-era replenishments refused ────────────────
-- Same definition as 202610190001 plus one guard after the replenishment lookup.
create or replace function public.school_wallet_reverse_replenishment(p_school_id uuid,p_student_id uuid,p_replenishment_id uuid,
 p_reason text,p_note text,p_request_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; actor uuid; rep public.wallet_replenishments; w public.student_wallets; rv public.wallet_replenishment_reversals;
 clean_note text; fp text; new_balance bigint; new_version bigint; now_value timestamptz;
begin
 perform pikas_private.begin_sandbox_admin_command('school_admin');
 ctx:=pikas_private.require_school_admin(p_school_id,'school:wallets:reverse_replenishment');
 if p_request_key is null then raise exception using errcode='22023',message='request_key_required'; end if;
 clean_note:=nullif(btrim(p_note),'');
 if p_reason is null or p_reason not in ('wrong_amount','wrong_student','duplicate_replenishment','wrong_verification','other') then
  raise exception using errcode='22023',message='INVALID_REVERSAL_REASON'; end if;
 if length(clean_note)>500 or (p_reason='other' and (clean_note is null or length(clean_note)<3)) then
  raise exception using errcode='22023',message='INVALID_REVERSAL_NOTE'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_student_id::text,0));
 ctx:=pikas_private.require_school_admin(p_school_id,'school:wallets:reverse_replenishment',true);
 actor:=(ctx->>'actor_id')::uuid;
 if not exists(select 1 from public.students s where s.id=p_student_id and s.school_id=p_school_id and s.account_id=(ctx->>'account_id')::uuid) then
  raise exception using errcode='42501',message='wallet_authority_required'; end if;
 select * into rep from public.wallet_replenishments r where r.id=p_replenishment_id and r.account_id=(ctx->>'account_id')::uuid and r.school_id=p_school_id;
 if not found then raise exception using errcode='42501',message='wallet_authority_required'; end if;
 -- FIN 2 refinement: a fee-era replenishment is reversed only by Platform finance.
 if rep.financial_request_id is not null then raise exception using errcode='42501',message='finance_reversal_authority_required'; end if;
 select * into w from public.student_wallets where id=rep.wallet_id for update;
 if w.student_id<>p_student_id then raise exception using errcode='42501',message='wallet_authority_required'; end if;
 fp:=pikas_private.refund_hash(jsonb_build_object('replenishment_id',rep.id,'student_id',p_student_id,'reason',p_reason,'note',clean_note,'actor',actor));
 select * into rv from public.wallet_replenishment_reversals where account_id=rep.account_id and request_key=p_request_key::text;
 if found then
  if rv.payload_fingerprint<>fp then raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT'; end if;
 else
  if exists(select 1 from public.wallet_replenishment_reversals x where x.replenishment_id=rep.id) then
   raise exception using errcode='23514',message='REPLENISHMENT_ALREADY_REVERSED'; end if;
  if w.current_balance_minor::numeric-rep.amount_minor < -9223372036854775808 then raise exception using errcode='22003',message='wallet_balance_overflow'; end if;
  new_balance:=w.current_balance_minor-rep.amount_minor; new_version:=w.balance_version+1; now_value:=clock_timestamp();
  insert into public.wallet_replenishment_reversals(account_id,school_id,wallet_id,student_id,replenishment_id,currency_code,amount_minor,
   reason,note,actor_person_id,actor_role,request_key,payload_fingerprint,reversed_at)
  values(rep.account_id,rep.school_id,w.id,p_student_id,rep.id,rep.currency_code,rep.amount_minor,p_reason,clean_note,actor,ctx->>'role',
   p_request_key::text,fp,now_value) returning * into rv;
  update public.student_wallets set current_balance_minor=new_balance,balance_version=new_version where id=w.id;
  insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,balance_after_minor,
   balance_version_after,replenishment_reversal_id,occurred_at)
  values(rep.account_id,rep.school_id,w.id,rep.currency_code,'replenishment_reversal',-rep.amount_minor,new_balance,new_version,rv.id,now_value);
  perform pikas_private.record_wallet_audit(actor,auth.uid(),ctx->>'role','school',rep.account_id,rep.school_id,null,
   'wallet_replenishment_reversed','wallet_replenishment_reversals',rv.id,
   jsonb_build_object('replenishment_id',rep.id,'reason',p_reason,'amount_minor',rep.amount_minor::text,'negative_balance',new_balance<0));
 end if;
 return jsonb_build_object('request_key',p_request_key,'school_id',p_school_id,'student_id',p_student_id,'reversal_id',rv.id,
  'replenishment_id',rv.replenishment_id,'amount_minor',rv.amount_minor::text,
  'balance_after_minor',(select l.balance_after_minor::text from public.wallet_ledger_entries l where l.replenishment_reversal_id=rv.id),
  'reason',rv.reason,'reversed_at',rv.reversed_at);
end $$;

commit;
