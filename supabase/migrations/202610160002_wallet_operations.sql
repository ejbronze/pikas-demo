-- Phase 5B: connected operations over the existing immutable wallet ledger.
begin;
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
    actor_role_value:='school_admin'; actor_scope:='school'; actor_cafeteria_id:=null;
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
  if p_amount_minor>9223372036854775807-v_balance then raise exception using errcode='22003',message='wallet_balance_overflow'; end if;
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


create function public.school_wallet_read(p_school_id uuid,p_student_id uuid,p_before bigint default null)
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
 'cafeteria',c.name,'items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'quantity',i.quantity,
 'line_total_minor',i.line_total_minor::text) order by i.line_number),'[]'::jsonb) from public.purchase_items i where i.purchase_id=p.id)) row
 from public.wallet_ledger_entries l
 left join public.wallet_replenishments r on r.id=l.replenishment_id
 left join public.wallet_adjustments a on a.id=l.adjustment_id
 left join public.wallet_purchase_debits d on d.id=l.purchase_debit_id
 left join public.wallet_refund_credits f on f.id=l.refund_credit_id
 left join public.purchases p on p.id=coalesce(d.purchase_id,f.purchase_id)
 left join public.cafeterias c on c.id=p.cafeteria_id
 left join public.persons person on person.id=coalesce(r.verified_by,a.actor_person_id,d.actor_person_id,f.actor_person_id)
 where l.wallet_id=w.id and (p_before is null or l.balance_version_after<p_before)
 order by l.balance_version_after desc limit 26) entries;
 return jsonb_build_object('school_id',p_school_id,'student_id',p_student_id,'student_name',(select display_name from public.students where id=p_student_id),
 'wallet',jsonb_build_object('id',w.id,'status',w.status,'currency','DOP','balance_minor',w.current_balance_minor::text,'version',w.balance_version::text),
 'movements',case when jsonb_array_length(movements)>25 then movements-25 else movements end,
 'next_before',case when jsonb_array_length(movements)>25 then movements->24->>'version' else null end);
end $$;

create function public.school_wallet_replenish(p_school_id uuid,p_student_id uuid,p_amount_minor bigint,
 p_request_key uuid,p_reference text,p_note text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; wallet_id uuid; result record; ledger public.wallet_ledger_entries%rowtype;
begin
 perform pikas_private.begin_sandbox_admin_command('school_admin');
 ctx:=pikas_private.require_school_admin(p_school_id,'school:wallets:replenish');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_student_id::text,0));
 ctx:=pikas_private.require_school_admin(p_school_id,'school:wallets:replenish',true);
 if not exists(select 1 from public.students s where s.id=p_student_id and s.school_id=p_school_id
 and s.account_id=(ctx->>'account_id')::uuid) then raise exception using errcode='42501',message='wallet_authority_required'; end if;
 select w.id into wallet_id from public.student_wallets w where w.student_id=p_student_id and w.school_id=p_school_id and w.currency_code='DOP';
 if wallet_id is null then
  select c.wallet_id into wallet_id from public.create_student_wallet((ctx->>'account_id')::uuid,p_school_id,p_student_id,'DOP') c;
 end if;
 if p_request_key is null then raise exception using errcode='22023',message='request_key_required'; end if;
 select * into result from public.post_manual_wallet_replenishment(wallet_id,p_amount_minor,p_request_key::text,p_reference,p_note,null);
 perform pikas_private.require_school_admin(p_school_id,'school:wallets:replenish',true);
 select * into strict ledger from public.wallet_ledger_entries where replenishment_id=result.replenishment_id;
 return jsonb_build_object('request_key',p_request_key,'school_id',p_school_id,'student_id',p_student_id,'wallet_id',wallet_id,
 'replenishment_id',result.replenishment_id,'amount_minor',result.amount_minor::text,
 'balance_after_minor',ledger.balance_after_minor::text,'version',ledger.balance_version_after::text);
end $$;
revoke all on function public.school_wallet_read(uuid,uuid,bigint),public.school_wallet_replenish(uuid,uuid,bigint,uuid,text,text)
 from public,anon,service_role;
grant execute on function public.school_wallet_read(uuid,uuid,bigint),public.school_wallet_replenish(uuid,uuid,bigint,uuid,text,text) to authenticated;
commit;
