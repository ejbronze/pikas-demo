-- PIKAS FIN 2 final hardening: funded wallet adjustments need Platform finance authority (local only).
--
-- CENTRAL CLEARING REQUIRES LEGAL/ACCOUNTING APPROVAL BEFORE REAL-MONEY ACTIVATION.
-- Additive on top of 202611100001; no customer is activated and no capability is granted.
--
-- For an activated customer a positive administrative adjustment is clearing-funded value
-- (clearing_funded_adjustment), so no tenant path may create it:
--   * the shared tenant core (School, Account and Cafetería Admin) refuses it before any write;
--   * a table guard refuses it from every other path (including post_student_wallet_adjustment).
-- Platform finance creates it through platform_finance_fund_wallet_adjustment, which requires
-- platform:finance:adjustments:fund (catalogued, ungranted). Negative adjustments keep their tenant
-- authority and their adjustment_stored_value_reduction event. Non-activated customers are unchanged.
begin;

insert into pikas_private.platform_capabilities(capability) values ('platform:finance:adjustments:fund') on conflict do nothing;

-- Funded adjustments are recorded with the Platform finance role and source.
alter table public.wallet_adjustments drop constraint wallet_adjustments_actor_role_check;
alter table public.wallet_adjustments add constraint wallet_adjustments_actor_role_check
  check (actor_role in ('account_admin','school_admin','cafeteria_admin','platform_finance_operator'));
alter table public.wallet_adjustments drop constraint wallet_adjustments_actor_scope_kind_check;
alter table public.wallet_adjustments add constraint wallet_adjustments_actor_scope_kind_check
  check (actor_scope_kind in ('account','school','cafeteria','platform'));
alter table public.wallet_adjustments drop constraint wallet_adjustments_actor_source_check;
alter table public.wallet_adjustments add constraint wallet_adjustments_actor_source_check
  check (actor_source in ('tenant_admin','platform_finance'));
alter table public.wallet_adjustments add constraint wallet_adjustments_platform_finance_check
  check ((actor_source = 'platform_finance') = (actor_role = 'platform_finance_operator' and actor_scope_kind = 'platform')
    and (actor_source is distinct from 'platform_finance' or (amount_minor > 0 and cafeteria_id is null and cafeteria_customer_id is null)));

-- Every path that writes an adjustment passes here.
create function pikas_private.guard_funded_wallet_adjustment() returns trigger language plpgsql security definer set search_path = '' as $$
declare activated boolean := pikas_private.financial_activation(new.account_id) is not null;
begin
  if new.actor_source is not distinct from 'platform_finance' then
    if not activated then raise exception using errcode = '23514', message = 'FINANCIAL_POLICY_NOT_ACTIVE'; end if;
  elsif new.amount_minor > 0 and activated then
    raise exception using errcode = '42501', message = 'finance_adjustment_authority_required';
  end if;
  return new;
end $$;
create trigger wallet_adjustment_funding_guard before insert on public.wallet_adjustments for each row execute function pikas_private.guard_funded_wallet_adjustment();

-- ── Platform finance funded adjustment ─────────────────────────────────────────────────────────
-- Same posting as the tenant core (source record, wallet, ledger, audit); the existing AFTER INSERT
-- trigger records exactly one clearing_funded_adjustment with the clearing funding party in the same
-- transaction. No fee, replenishment, collection or obligation.
create function pikas_private.finance_fund_wallet_adjustment(p_student_id uuid, p_actor uuid, p_amount_minor bigint, p_reason text, p_explanation text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.students; w public.student_wallets; adj public.wallet_adjustments; clean text; fp text; after_value bigint; now_value timestamptz;
begin
  if p_request_key is null or length(p_request_key) not between 16 and 128 then raise exception using errcode = '22023', message = 'invalid_request_key'; end if;
  if not exists (select 1 from public.persons where id = p_actor and status = 'active') then raise exception using errcode = '42501', message = 'not_authorized'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception using errcode = '22023', message = 'INVALID_ADJUSTMENT_AMOUNT'; end if;
  if p_reason is null or p_reason not in ('initial_balance_correction','administrative_correction','data_migration_correction','authorized_credit','other') then
    raise exception using errcode = '22023', message = 'INVALID_ADJUSTMENT_REASON'; end if;
  clean := nullif(btrim(p_explanation),'');
  if clean is null or length(clean) < 5 or length(clean) > 500 then raise exception using errcode = '22023', message = 'ADJUSTMENT_EXPLANATION_REQUIRED'; end if;
  select * into s from public.students where id = p_student_id;
  if not found then raise exception using errcode = '23503', message = 'STUDENT_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.id::text, 0));
  fp := encode(extensions.digest(convert_to(jsonb_build_object('student_id',s.id,'amount_minor',p_amount_minor::text,'reason',p_reason,'explanation',clean,'actor',p_actor)::text,'UTF8'),'sha256'),'hex');
  select * into adj from public.wallet_adjustments where account_id = s.account_id and idempotency_key = p_request_key;
  if found then
    if adj.payload_fingerprint <> fp or adj.actor_source is distinct from 'platform_finance' then raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT'; end if;
  else
    if pikas_private.financial_activation(s.account_id) is null then raise exception using errcode = '23514', message = 'FINANCIAL_POLICY_NOT_ACTIVE'; end if;
    select * into w from public.student_wallets where student_id = s.id and account_id = s.account_id and school_id = s.school_id and currency_code = 'DOP' for update;
    if not found then raise exception using errcode = '23514', message = 'WALLET_NOT_FOUND'; end if;
    if p_amount_minor::numeric > 9223372036854775807 - w.current_balance_minor::numeric then raise exception using errcode = '22003', message = 'wallet_balance_overflow'; end if;
    after_value := w.current_balance_minor + p_amount_minor; now_value := clock_timestamp();
    insert into public.wallet_adjustments(account_id,school_id,wallet_id,currency_code,amount_minor,reason_code,explanatory_note,status,
      actor_person_id,posted_at,idempotency_key,payload_fingerprint,student_id,balance_before_minor,balance_after_minor,actor_role,actor_scope_kind,actor_source)
    values (s.account_id,s.school_id,w.id,'DOP',p_amount_minor,p_reason,clean,'posted',p_actor,now_value,p_request_key,fp,s.id,
      w.current_balance_minor,after_value,'platform_finance_operator','platform','platform_finance') returning * into adj;
    update public.student_wallets set current_balance_minor = after_value, balance_version = w.balance_version + 1 where id = w.id;
    insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,balance_after_minor,balance_version_after,adjustment_id,occurred_at)
    values (s.account_id,s.school_id,w.id,'DOP','adjustment',p_amount_minor,after_value,w.balance_version + 1,adj.id,now_value);
    perform pikas_private.record_wallet_audit(p_actor,auth.uid(),'platform_finance_operator','platform',s.account_id,s.school_id,null,
      'wallet_funded_adjustment_posted','wallet_adjustments',adj.id,
      jsonb_build_object('reason',p_reason,'amount_minor',p_amount_minor::text,'funding','clearing','actor_source','platform_finance'));
  end if;
  return jsonb_build_object('request_key',p_request_key,'state','posted','amount_minor',adj.amount_minor::text,'reason',adj.reason_code,
    'funding','clearing','posted_at',adj.posted_at);
end $$;

-- One narrow mutation: no wallet read, no tenant authority, no other finance authority.
create function public.platform_finance_fund_wallet_adjustment(p_student_id uuid, p_amount_minor bigint, p_reason text, p_explanation text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  actor := pikas_private.require_platform_capability('platform:finance:adjustments:fund');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  if not exists (select 1 from public.students where id = p_student_id) then raise exception using errcode = '23503', message = 'STUDENT_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_student_id::text, 0));
  actor := pikas_private.require_platform_capability('platform:finance:adjustments:fund');
  return pikas_private.finance_fund_wallet_adjustment(p_student_id, actor, p_amount_minor, p_reason, p_explanation, p_request_key);
end $$;

revoke all on function pikas_private.guard_funded_wallet_adjustment(), pikas_private.finance_fund_wallet_adjustment(uuid,uuid,bigint,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.platform_finance_fund_wallet_adjustment(uuid,bigint,text,text,text) from public, anon, service_role;
grant execute on function public.platform_finance_fund_wallet_adjustment(uuid,bigint,text,text,text) to authenticated;

-- ── Tenant core: same definition as 202610200001 plus one guard before any write ───────────────
create or replace function pikas_private.post_administrative_adjustment(p_account_id uuid,p_school_id uuid,p_student_id uuid,
 p_amount_minor bigint,p_reason text,p_explanation text,p_request_key uuid,p_actor uuid,p_role text,p_scope_kind text,
 p_cafeteria_id uuid,p_customer_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare w public.student_wallets; adj public.wallet_adjustments; clean text; fp text; after_value bigint; now_value timestamptz;
begin
 if p_request_key is null then raise exception using errcode='22023',message='request_key_required'; end if;
 if p_amount_minor is null or p_amount_minor=0 then raise exception using errcode='22023',message='INVALID_ADJUSTMENT_AMOUNT'; end if;
 if p_reason is null or p_reason not in ('initial_balance_correction','administrative_correction','data_migration_correction','authorized_credit','authorized_debit','other') then
  raise exception using errcode='22023',message='INVALID_ADJUSTMENT_REASON'; end if;
 if (p_reason='authorized_credit' and p_amount_minor<0) or (p_reason='authorized_debit' and p_amount_minor>0) then
  raise exception using errcode='22023',message='ADJUSTMENT_DIRECTION_MISMATCH'; end if;
 -- FIN 2: positive value for an activated customer is clearing-funded; only Platform finance may create it.
 -- Checked before any write; an earlier request replays through the idempotency check below.
 if p_amount_minor>0 and pikas_private.financial_activation(p_account_id) is not null
  and not exists(select 1 from public.wallet_adjustments a where a.account_id=p_account_id and a.idempotency_key=p_request_key::text) then
  raise exception using errcode='42501',message='finance_adjustment_authority_required'; end if;
 clean:=nullif(btrim(p_explanation),'');
 if clean is null or length(clean)<5 or length(clean)>500 then raise exception using errcode='22023',message='ADJUSTMENT_EXPLANATION_REQUIRED'; end if;
 select * into w from public.student_wallets where student_id=p_student_id and account_id=p_account_id and school_id=p_school_id and currency_code='DOP' for update;
 if not found then
  -- First correction opens the wallet for an actively enrolled student (as verified credit does).
  perform 1 from public.students s join public.persons p on p.id=s.person_id and p.status='active'
   join public.student_enrollments e on e.account_id=s.account_id and e.school_id=s.school_id and e.student_id=s.id and e.status='active'
   where s.id=p_student_id and s.account_id=p_account_id and s.school_id=p_school_id and s.status='active' for share of e;
  if not found then raise exception using errcode='23514',message='wallet_requires_active_enrolled_student'; end if;
  insert into public.student_wallets(account_id,school_id,student_id,currency_code) values(p_account_id,p_school_id,p_student_id,'DOP')
   on conflict on constraint student_wallets_student_id_currency_code_key do nothing returning * into w;
  if w.id is null then raise exception using errcode='40001',message='wallet_creation_conflict'; end if;
  perform pikas_private.record_wallet_audit(p_actor,auth.uid(),p_role,p_scope_kind,p_account_id,p_school_id,p_cafeteria_id,
   'wallet_created','student_wallets',w.id,jsonb_build_object('currency_code','DOP','status','active'));
 end if;
 fp:=pikas_private.refund_hash(jsonb_build_object('student_id',p_student_id,'amount_minor',p_amount_minor::text,'reason',p_reason,
  'explanation',clean,'actor',p_actor,'role',p_role,'cafeteria_id',p_cafeteria_id));
 select * into adj from public.wallet_adjustments where account_id=p_account_id and idempotency_key=p_request_key::text;
 if found then
  if adj.payload_fingerprint<>fp then raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT'; end if;
 else
  if p_amount_minor>0 and p_amount_minor::numeric>9223372036854775807-w.current_balance_minor::numeric then raise exception using errcode='22003',message='wallet_balance_overflow'; end if;
  if p_amount_minor<0 and w.current_balance_minor::numeric+p_amount_minor< -9223372036854775808 then raise exception using errcode='22003',message='wallet_balance_overflow'; end if;
  after_value:=w.current_balance_minor+p_amount_minor; now_value:=clock_timestamp();
  insert into public.wallet_adjustments(account_id,school_id,wallet_id,currency_code,amount_minor,reason_code,explanatory_note,status,
   actor_person_id,posted_at,idempotency_key,payload_fingerprint,student_id,balance_before_minor,balance_after_minor,actor_role,
   actor_scope_kind,cafeteria_id,cafeteria_customer_id,actor_source)
  values(p_account_id,p_school_id,w.id,'DOP',p_amount_minor,p_reason,clean,'posted',p_actor,now_value,p_request_key::text,fp,p_student_id,
   w.current_balance_minor,after_value,p_role,p_scope_kind,p_cafeteria_id,p_customer_id,'tenant_admin') returning * into adj;
  update public.student_wallets set current_balance_minor=after_value,balance_version=w.balance_version+1 where id=w.id;
  insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,balance_after_minor,
   balance_version_after,adjustment_id,occurred_at)
  values(p_account_id,p_school_id,w.id,'DOP','adjustment',p_amount_minor,after_value,w.balance_version+1,adj.id,now_value);
  perform pikas_private.record_wallet_audit(p_actor,auth.uid(),p_role,p_scope_kind,p_account_id,p_school_id,p_cafeteria_id,
   'wallet_administrative_adjustment_posted','wallet_adjustments',adj.id,jsonb_build_object('reason',p_reason,
   'direction',case when p_amount_minor>0 then 'credit' else 'debit' end,'amount_minor',abs(p_amount_minor)::text,
   'negative_balance',after_value<0,'actor_source','tenant_admin'));
 end if;
 return jsonb_build_object('request_key',p_request_key,'adjustment_id',adj.id,'student_id',adj.student_id,'amount_minor',adj.amount_minor::text,
  'balance_before_minor',adj.balance_before_minor::text,'balance_after_minor',adj.balance_after_minor::text,'reason',adj.reason_code,
  'actor_role',adj.actor_role,'posted_at',adj.posted_at);
end $$;

commit;
