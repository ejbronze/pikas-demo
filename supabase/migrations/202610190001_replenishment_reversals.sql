-- Phase 5C.2: replenishment reversals. A reversal is a new immutable negative ledger event linked
-- to exactly one original manual_verified replenishment, for its exact amount, at most once.
-- The wallet may become negative; existing sufficient-balance checks keep blocking PIKAS Cash
-- purchases until legitimate replenishments restore enough balance. No register cash impact.
begin;
insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values
 ('account','account_admin','school:wallets:reverse_replenishment'),
 ('school','school_admin','school:wallets:reverse_replenishment')
on conflict do nothing;

-- Negative balances are now meaningful state; the ledger trigger still forbids every other
-- negative-producing movement (purchases, adjustments) from crossing below the prior balance.
alter table public.student_wallets drop constraint student_wallets_current_balance_minor_check;
alter table public.wallet_ledger_entries drop constraint wallet_ledger_entries_balance_after_minor_check;

create table public.wallet_replenishment_reversals (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null,
 school_id uuid not null,
 wallet_id uuid not null,
 student_id uuid not null,
 replenishment_id uuid not null unique references public.wallet_replenishments(id) on delete restrict,
 currency_code text not null references public.supported_currencies(currency_code) on delete restrict,
 amount_minor bigint not null check(amount_minor>0),
 reason text not null check(reason in ('wrong_amount','wrong_student','duplicate_replenishment','wrong_verification','other')),
 note text check(note is null or (length(btrim(note)) between 1 and 500 and note=btrim(note))),
 actor_person_id uuid not null references public.persons(id) on delete restrict,
 actor_role text not null check(actor_role in ('account_admin','school_admin')),
 request_key text not null check(length(request_key) between 16 and 128),
 payload_fingerprint text not null check(payload_fingerprint ~ '^[0-9a-f]{64}$'),
 reversed_at timestamptz not null,
 foreign key(account_id,school_id,student_id,wallet_id,currency_code)
  references public.student_wallets(account_id,school_id,student_id,id,currency_code) on delete restrict,
 unique(account_id,request_key),
 check(reason<>'other' or (note is not null and length(note)>=3))
);
alter table public.wallet_replenishment_reversals enable row level security;
revoke all on public.wallet_replenishment_reversals from public,anon,authenticated,service_role;
create trigger wallet_replenishment_reversals_immutable before update or delete on public.wallet_replenishment_reversals
 for each row execute function pikas_private.reject_wallet_history_mutation();
create trigger wallet_replenishment_reversals_no_truncate before truncate on public.wallet_replenishment_reversals
 execute function pikas_private.reject_wallet_history_mutation();

-- A reversal mirrors exactly its original: same wallet/scope/currency and the original amount.
create function pikas_private.guard_replenishment_reversal() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.wallet_replenishments; w public.student_wallets;
begin
 select * into r from public.wallet_replenishments where id=new.replenishment_id;
 select * into w from public.student_wallets where id=new.wallet_id;
 if r.id is null or w.id is null or r.wallet_id<>new.wallet_id or r.account_id<>new.account_id or r.school_id<>new.school_id
  or r.currency_code<>new.currency_code or r.amount_minor<>new.amount_minor or w.student_id<>new.student_id then
  raise exception using errcode='23514',message='REVERSAL_INTEGRITY_ERROR'; end if;
 return new;
end $$;
create trigger wallet_replenishment_reversal_guard before insert on public.wallet_replenishment_reversals
 for each row execute function pikas_private.guard_replenishment_reversal();

alter table public.wallet_ledger_entries add column replenishment_reversal_id uuid
 references public.wallet_replenishment_reversals(id) on delete restrict;
create unique index wallet_ledger_replenishment_reversal_unique on public.wallet_ledger_entries(replenishment_reversal_id);
alter table public.wallet_ledger_entries drop constraint wallet_ledger_entries_typed_source_check;
alter table public.wallet_ledger_entries add constraint wallet_ledger_entries_typed_source_check check(
 (entry_type='replenishment' and amount_minor>0 and replenishment_id is not null and adjustment_id is null and purchase_debit_id is null and refund_credit_id is null and replenishment_reversal_id is null)
 or (entry_type='adjustment' and amount_minor<>0 and adjustment_id is not null and replenishment_id is null and purchase_debit_id is null and refund_credit_id is null and replenishment_reversal_id is null)
 or (entry_type='purchase' and amount_minor<0 and purchase_debit_id is not null and replenishment_id is null and adjustment_id is null and refund_credit_id is null and replenishment_reversal_id is null)
 or (entry_type='refund' and amount_minor>0 and refund_credit_id is not null and replenishment_id is null and adjustment_id is null and purchase_debit_id is null and replenishment_reversal_id is null)
 or (entry_type='replenishment_reversal' and amount_minor<0 and replenishment_reversal_id is not null and replenishment_id is null and adjustment_id is null and purchase_debit_id is null and refund_credit_id is null));

-- Unchanged from 202610050001 except the reversal source and its permitted negative result.
create or replace function pikas_private.assert_wallet_operation_ledger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare matching_entries bigint; expected_amount bigint; expected_ledger_amount bigint; expected_type text;
  actual_amount bigint; actual_type text; entry_wallet uuid; entry_version bigint;
  entry_balance bigint; previous_balance bigint; wallet_balance bigint; wallet_version bigint;
begin
  if tg_table_name='wallet_replenishments' then
    select count(*) into matching_entries from public.wallet_ledger_entries l where l.replenishment_id=new.id;
    expected_amount:=new.amount_minor; expected_ledger_amount:=new.amount_minor; expected_type:='replenishment';
    select l.amount_minor,l.entry_type,l.wallet_id,l.balance_version_after,l.balance_after_minor
      into actual_amount,actual_type,entry_wallet,entry_version,entry_balance
      from public.wallet_ledger_entries l where l.replenishment_id=new.id;
  elsif tg_table_name='wallet_adjustments' then
    select count(*) into matching_entries from public.wallet_ledger_entries l where l.adjustment_id=new.id;
    expected_amount:=new.amount_minor; expected_ledger_amount:=new.amount_minor; expected_type:='adjustment';
    select l.amount_minor,l.entry_type,l.wallet_id,l.balance_version_after,l.balance_after_minor
      into actual_amount,actual_type,entry_wallet,entry_version,entry_balance
      from public.wallet_ledger_entries l where l.adjustment_id=new.id;
  elsif tg_table_name='wallet_purchase_debits' then
    select count(*) into matching_entries from public.wallet_ledger_entries l where l.purchase_debit_id=new.id;
    expected_amount:=new.amount_minor; expected_ledger_amount:=-new.amount_minor; expected_type:='purchase';
    select l.amount_minor,l.entry_type,l.wallet_id,l.balance_version_after,l.balance_after_minor
      into actual_amount,actual_type,entry_wallet,entry_version,entry_balance
      from public.wallet_ledger_entries l where l.purchase_debit_id=new.id;
  elsif tg_table_name='wallet_refund_credits' then
    select count(*) into matching_entries from public.wallet_ledger_entries l where l.refund_credit_id=new.id;
    expected_amount:=new.amount_minor; expected_ledger_amount:=new.amount_minor; expected_type:='refund';
    select l.amount_minor,l.entry_type,l.wallet_id,l.balance_version_after,l.balance_after_minor
      into actual_amount,actual_type,entry_wallet,entry_version,entry_balance
      from public.wallet_ledger_entries l where l.refund_credit_id=new.id;
  elsif tg_table_name='wallet_replenishment_reversals' then
    select count(*) into matching_entries from public.wallet_ledger_entries l where l.replenishment_reversal_id=new.id;
    expected_amount:=new.amount_minor; expected_ledger_amount:=-new.amount_minor; expected_type:='replenishment_reversal';
    select l.amount_minor,l.entry_type,l.wallet_id,l.balance_version_after,l.balance_after_minor
      into actual_amount,actual_type,entry_wallet,entry_version,entry_balance
      from public.wallet_ledger_entries l where l.replenishment_reversal_id=new.id;
  else raise exception using errcode='23514',message='unknown_wallet_source';
  end if;
  if matching_entries<>1 then
    raise exception using errcode='23514',message='posted_wallet_operation_requires_exactly_one_ledger_entry';
  end if;
  if actual_type<>expected_type or actual_amount<>expected_ledger_amount then
    raise exception using errcode='23514',message='wallet_ledger_entry_does_not_match_source_operation';
  end if;
  if entry_version=1 then previous_balance:=0;
  else
    select l.balance_after_minor into previous_balance from public.wallet_ledger_entries l
      where l.wallet_id=entry_wallet and l.balance_version_after=entry_version-1;
    if not found then raise exception using errcode='23514',message='wallet_ledger_balance_version_gap'; end if;
  end if;
  if (actual_amount>0 and previous_balance>9223372036854775807-actual_amount)
      or (actual_amount<0 and actual_amount < -previous_balance and actual_type<>'replenishment_reversal')
      or (actual_amount<0 and previous_balance < -9223372036854775807-actual_amount) then
    raise exception using errcode='23514',message='wallet_ledger_resulting_balance_out_of_range';
  end if;
  if entry_balance<>previous_balance+actual_amount then
    raise exception using errcode='23514',message='wallet_ledger_resulting_balance_mismatch';
  end if;
  select w.current_balance_minor,w.balance_version into wallet_balance,wallet_version
    from public.student_wallets w where w.id=entry_wallet;
  if wallet_version<>entry_version or wallet_balance<>entry_balance then
    select l.balance_after_minor,l.balance_version_after into entry_balance,entry_version
      from public.wallet_ledger_entries l where l.wallet_id=entry_wallet order by l.balance_version_after desc limit 1;
    select w.current_balance_minor,w.balance_version into wallet_balance,wallet_version
      from public.student_wallets w where w.id=entry_wallet;
    if wallet_version is distinct from entry_version or wallet_balance is distinct from entry_balance then
      raise exception using errcode='23514',message='wallet_balance_does_not_match_latest_ledger_entry';
    end if;
  end if;
  return null;
end $$;
create constraint trigger wallet_replenishment_reversal_requires_ledger after insert on public.wallet_replenishment_reversals
 deferrable initially deferred for each row execute function pikas_private.assert_wallet_operation_ledger();

-- School Administration reversal: Account Admin or School Admin in scope, revalidated after the
-- per-student fence shared with checkout and replenishment.
create function public.school_wallet_reverse_replenishment(p_school_id uuid,p_student_id uuid,p_replenishment_id uuid,
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

-- Unchanged from 202610160002 except reversal rows and per-replenishment reversal state.
create or replace function public.school_wallet_read(p_school_id uuid,p_student_id uuid,p_before bigint default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; w public.student_wallets%rowtype; movements jsonb;
begin
 ctx:=pikas_private.require_school_admin(p_school_id,'school:wallets:read');
 if p_before is not null and p_before<1 then raise exception using errcode='22023',message='invalid_cursor'; end if;
 if not exists(select 1 from public.students s where s.id=p_student_id and s.school_id=p_school_id and s.account_id=(ctx->>'account_id')::uuid) then
  raise exception using errcode='42501',message='wallet_authority_required'; end if;
 select * into w from public.student_wallets where school_id=p_school_id and student_id=p_student_id and currency_code='DOP' for share;
 ctx:=pikas_private.require_school_admin(p_school_id,'school:wallets:read');
 if w.id is null then return jsonb_build_object('school_id',p_school_id,'student_id',p_student_id,'student_name',(select display_name from public.students where id=p_student_id),'wallet',null,'movements','[]'::jsonb,'next_before',null); end if;
 select coalesce(jsonb_agg(row order by version desc),'[]'::jsonb) into movements from (
 select l.balance_version_after version,jsonb_build_object('id',l.id,'type',l.entry_type,'amount_minor',l.amount_minor::text,
 'balance_after_minor',l.balance_after_minor::text,'version',l.balance_version_after::text,'occurred_at',l.occurred_at,
 'source',r.source,'reference',coalesce(r.reference,a.reference),'note',coalesce(r.verification_note,a.explanatory_note),
 'actor',person.display_name,'replenishment_id',r.id,'purchase_id',p.id,'receipt_number',p.purchase_number::text,
 'cafeteria',c.name,'reversal_id',coalesce(rv.id,rr.id),'reversed_replenishment_id',rv.replenishment_id,
 'reversal_reason',coalesce(rv.reason,rr.reason),'reversal_note',rv.note,'reversed_at',rr.reversed_at,
 'original_reference',orig.reference,'original_note',orig.verification_note,'original_amount_minor',orig.amount_minor::text,'items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'quantity',i.quantity,
 'line_total_minor',i.line_total_minor::text) order by i.line_number),'[]'::jsonb) from public.purchase_items i where i.purchase_id=p.id)) row
 from public.wallet_ledger_entries l
 left join public.wallet_replenishments r on r.id=l.replenishment_id
 left join public.wallet_replenishment_reversals rr on rr.replenishment_id=r.id
 left join public.wallet_replenishment_reversals rv on rv.id=l.replenishment_reversal_id
 left join public.wallet_replenishments orig on orig.id=rv.replenishment_id
 left join public.wallet_adjustments a on a.id=l.adjustment_id
 left join public.wallet_purchase_debits d on d.id=l.purchase_debit_id
 left join public.wallet_refund_credits f on f.id=l.refund_credit_id
 left join public.purchases p on p.id=coalesce(d.purchase_id,f.purchase_id)
 left join public.cafeterias c on c.id=p.cafeteria_id
 left join public.persons person on person.id=coalesce(r.verified_by,a.actor_person_id,d.actor_person_id,f.actor_person_id,rv.actor_person_id)
 where l.wallet_id=w.id and (p_before is null or l.balance_version_after<p_before)
 order by l.balance_version_after desc limit 26) entries;
 return jsonb_build_object('school_id',p_school_id,'student_id',p_student_id,'student_name',(select display_name from public.students where id=p_student_id),
 'wallet',jsonb_build_object('id',w.id,'status',w.status,'currency','DOP','balance_minor',w.current_balance_minor::text,'version',w.balance_version::text),
 'movements',case when jsonb_array_length(movements)>25 then movements-25 else movements end,
 'next_before',case when jsonb_array_length(movements)>25 then movements->24->>'version' else null end);
end $$;

-- Unchanged from 202610170001 except the reverse capability flag.
create or replace function public.school_wallet_access(p_school_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a uuid; pov boolean;
begin
 select s.account_id into a from public.schools s where s.id=p_school_id;
 pov:=exists(select 1 from pikas_private.sandbox_validated_pov());
 return jsonb_build_object('school_id',p_school_id,
  'read',a is not null and not pov and pikas_private.has_capability('school:wallets:read',a,p_school_id),
  'replenish',a is not null and not pov and pikas_private.has_capability('school:wallets:replenish',a,p_school_id),
  'reverse',a is not null and not pov and pikas_private.has_capability('school:wallets:reverse_replenishment',a,p_school_id));
end $$;

-- Negative balances: overflow guards must not overflow themselves. Unchanged from 202610170001 /
-- 202610010002 except comparing in numeric (a legitimate credit to a negative wallet must succeed).
create or replace function public.post_manual_wallet_replenishment(p_wallet_id uuid,p_amount_minor bigint,
  p_idempotency_key text,p_reference text default null,p_verification_note text default null,
  p_cafeteria_customer_id uuid default null)
returns table(replenishment_id uuid,status text,amount_minor bigint,currency_code text)
language plpgsql security definer set search_path = '' as $$
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
end $$;

create or replace function public.post_student_wallet_adjustment(p_wallet_id uuid,p_amount_minor bigint,p_reason_code text,
  p_idempotency_key text,p_reference text default null,p_explanatory_note text default null)
returns table(adjustment_id uuid,status text,amount_minor bigint,currency_code text,balance_after_minor bigint)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; v_account_id uuid; v_school_id uuid; v_student_id uuid; v_currency_code text;
  v_wallet_status text; v_balance bigint; v_version bigint; v_balance_after bigint; v_now timestamptz;
  v_reference text; v_note text; v_fingerprint text; v_adjustment_id uuid; existing_fingerprint text;
begin
  actor_id:=pikas_private.current_person_id();
  if actor_id is null then raise exception using errcode='42501',message='not_authorized'; end if;
  select w.account_id,w.school_id,w.student_id,w.currency_code into v_account_id,v_school_id,v_student_id,v_currency_code
    from public.student_wallets w where w.id=p_wallet_id;
  if not found or not pikas_private.has_capability('school:wallets:adjust',v_account_id,v_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_amount_minor is null or p_amount_minor=0 then raise exception using errcode='22023',message='adjustment_must_be_nonzero'; end if;
  if p_reason_code not in ('administrative_correction','duplicate_manual_credit_correction','reconciliation_correction','other_authorized_correction') then
    raise exception using errcode='22023',message='invalid_adjustment_reason';
  end if;
  v_reference:=nullif(btrim(p_reference),''); v_note:=nullif(btrim(p_explanatory_note),'');
  if p_reason_code='other_authorized_correction' and v_reference is null and v_note is null then
    raise exception using errcode='23514',message='adjustment_explanation_required';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 128 then
    raise exception using errcode='22023',message='invalid_idempotency_key';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_student_id::text,0));
  select w.current_balance_minor,w.balance_version,w.status into v_balance,v_version,v_wallet_status
    from public.student_wallets w where w.id=p_wallet_id and w.account_id=v_account_id and w.school_id=v_school_id for update;
  if not found then raise exception using errcode='23503',message='wallet_not_found'; end if;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('wallet_id',p_wallet_id,
    'amount_minor',p_amount_minor,'currency_code',v_currency_code,'reason_code',p_reason_code,
    'reference',v_reference,'explanatory_note',v_note,'actor_person_id',actor_id)::text,'UTF8'),'sha256'),'hex');
  select a.id,a.payload_fingerprint into v_adjustment_id,existing_fingerprint from public.wallet_adjustments a
    where a.account_id=v_account_id and a.idempotency_key=p_idempotency_key;
  if found then
    if existing_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='idempotency_key_reused_with_different_payload'; end if;
    select l.balance_after_minor into v_balance_after from public.wallet_ledger_entries l where l.adjustment_id=v_adjustment_id;
    return query select v_adjustment_id,'posted'::text,p_amount_minor,v_currency_code,v_balance_after; return;
  end if;
  if not exists(select 1 from public.supported_currencies c where c.currency_code=v_currency_code and c.status='enabled') then
    raise exception using errcode='22023',message='wallet_currency_not_enabled';
  end if;
  if v_wallet_status<>'active' then raise exception using errcode='23514',message='wallet_not_active'; end if;
  if not exists(select 1 from public.students s join public.persons p on p.id=s.person_id and p.status='active'
      where s.id=v_student_id and s.account_id=v_account_id and s.school_id=v_school_id and s.status='active') then
    raise exception using errcode='23514',message='active_student_required_for_adjustment';
  end if;
  if p_amount_minor<0 and p_amount_minor < -v_balance then raise exception using errcode='23514',message='adjustment_would_make_wallet_negative'; end if;
  if p_amount_minor>0 and p_amount_minor::numeric>9223372036854775807-v_balance::numeric then raise exception using errcode='22003',message='wallet_balance_overflow'; end if;
  v_balance_after:=v_balance+p_amount_minor; v_now:=clock_timestamp();
  insert into public.wallet_adjustments(account_id,school_id,wallet_id,currency_code,amount_minor,reason_code,
    reference,explanatory_note,status,actor_person_id,posted_at,idempotency_key,payload_fingerprint)
  values(v_account_id,v_school_id,p_wallet_id,v_currency_code,p_amount_minor,p_reason_code,v_reference,v_note,
    'posted',actor_id,v_now,p_idempotency_key,v_fingerprint)
  on conflict(account_id,idempotency_key) do nothing returning id into v_adjustment_id;
  if v_adjustment_id is null then
    select a.id,a.payload_fingerprint into v_adjustment_id,existing_fingerprint from public.wallet_adjustments a
      where a.account_id=v_account_id and a.idempotency_key=p_idempotency_key;
    if existing_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='idempotency_key_reused_with_different_payload'; end if;
    select l.balance_after_minor into v_balance_after from public.wallet_ledger_entries l where l.adjustment_id=v_adjustment_id;
    return query select v_adjustment_id,'posted'::text,p_amount_minor,v_currency_code,v_balance_after; return;
  end if;
  update public.student_wallets set current_balance_minor=v_balance_after,balance_version=v_version+1
    where id=p_wallet_id and account_id=v_account_id and school_id=v_school_id;
  insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,
    balance_after_minor,balance_version_after,adjustment_id,occurred_at)
  values(v_account_id,v_school_id,p_wallet_id,v_currency_code,'adjustment',p_amount_minor,
    v_balance_after,v_version+1,v_adjustment_id,v_now);
  perform pikas_private.record_wallet_audit(actor_id,auth.uid(),'school_admin','school',v_account_id,v_school_id,null,
    'wallet_adjustment_posted','wallet_adjustments',v_adjustment_id,jsonb_build_object('status','posted','reason_code',p_reason_code));
  return query select v_adjustment_id,'posted'::text,p_amount_minor,v_currency_code,v_balance_after;
end $$;

revoke all on function pikas_private.guard_replenishment_reversal() from public,anon,authenticated,service_role;
revoke all on function public.school_wallet_reverse_replenishment(uuid,uuid,uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.school_wallet_reverse_replenishment(uuid,uuid,uuid,text,text,uuid) to authenticated;
commit;
