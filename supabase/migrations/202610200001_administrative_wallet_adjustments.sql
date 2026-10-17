-- Phase 5C.3: administrative wallet adjustments over the existing wallet_adjustments/ledger model.
-- Exceptional corrections only (refunds and replenishment reversals have their own workflows).
-- Signed amount, required explanation, actor + actual role + scope, negative results allowed,
-- no register cash, no mandatory approval, and no Platform/support authority (deferred).
begin;
insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values
 ('account','account_admin','school:wallets:administrative_adjust'),
 ('school','school_admin','school:wallets:administrative_adjust'),
 ('cafeteria','cafeteria_admin','cafeteria:wallets:administrative_adjust')
on conflict do nothing;

-- Additive attribution/evidence (null on legacy Phase 3A rows). actor_source records who acted in
-- what capacity; only tenant administrators exist today. A future customer-authorized PIKAS
-- support context must add its own value and evidence rather than reuse a tenant role.
alter table public.wallet_adjustments
 add column student_id uuid references public.students(id) on delete restrict,
 add column balance_before_minor bigint,
 add column balance_after_minor bigint,
 add column actor_role text check(actor_role in ('account_admin','school_admin','cafeteria_admin')),
 add column actor_scope_kind text check(actor_scope_kind in ('account','school','cafeteria')),
 add column cafeteria_id uuid references public.cafeterias(id) on delete restrict,
 add column cafeteria_customer_id uuid references public.cafeteria_customers(id) on delete restrict,
 add column actor_source text check(actor_source in ('tenant_admin'));
alter table public.wallet_adjustments drop constraint wallet_adjustments_reason_code_check;
alter table public.wallet_adjustments add constraint wallet_adjustments_reason_code_check check(reason_code in
 ('administrative_correction','duplicate_manual_credit_correction','reconciliation_correction','other_authorized_correction',
  'initial_balance_correction','data_migration_correction','authorized_credit','authorized_debit','other'));
alter table public.wallet_adjustments add constraint wallet_adjustments_administrative_evidence check(actor_source is null or (
 student_id is not null and balance_before_minor is not null and balance_after_minor is not null
 and balance_after_minor::numeric=balance_before_minor::numeric+amount_minor::numeric
 and actor_role is not null and actor_scope_kind is not null
 and explanatory_note is not null and length(btrim(explanatory_note))>=5
 and reason_code in ('administrative_correction','initial_balance_correction','data_migration_correction','authorized_credit','authorized_debit','other')
 and (reason_code<>'authorized_credit' or amount_minor>0) and (reason_code<>'authorized_debit' or amount_minor<0)
 and ((actor_role='cafeteria_admin')=(actor_scope_kind='cafeteria'))
 and ((actor_scope_kind='cafeteria')=(cafeteria_id is not null and cafeteria_customer_id is not null))
 and (actor_role<>'account_admin' or actor_scope_kind='account') and (actor_role<>'school_admin' or actor_scope_kind='school')));

-- Unchanged from 202610190001 except adjustments may also produce a negative result.
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
      or (actual_amount<0 and actual_amount < -previous_balance and actual_type not in ('replenishment_reversal','adjustment'))
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

-- Shared core: caller has authorized and re-validated after the per-student lock.
create function pikas_private.post_administrative_adjustment(p_account_id uuid,p_school_id uuid,p_student_id uuid,
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

-- Account Admin (account scope) or School Admin (assigned school).
create function public.school_wallet_adjust(p_school_id uuid,p_student_id uuid,p_amount_minor bigint,p_reason text,
 p_explanation text,p_request_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; result jsonb;
begin
 perform pikas_private.begin_sandbox_admin_command('school_admin');
 ctx:=pikas_private.require_school_admin(p_school_id,'school:wallets:administrative_adjust');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_student_id::text,0));
 ctx:=pikas_private.require_school_admin(p_school_id,'school:wallets:administrative_adjust',true);
 if not exists(select 1 from public.students s where s.id=p_student_id and s.school_id=p_school_id and s.account_id=(ctx->>'account_id')::uuid) then
  raise exception using errcode='42501',message='wallet_authority_required'; end if;
 result:=pikas_private.post_administrative_adjustment((ctx->>'account_id')::uuid,p_school_id,p_student_id,p_amount_minor,p_reason,p_explanation,
  p_request_key,(ctx->>'actor_id')::uuid,ctx->>'role',case when ctx->>'role'='account_admin' then 'account' else 'school' end,null,null);
 return result||jsonb_build_object('school_id',p_school_id);
end $$;

-- Cafeteria Admin: only students who are active customers of this cafeteria through an active
-- school share with basic identification (the existing cafeteria/student relationship).
create function public.cafeteria_wallet_adjust(p_cafeteria_id uuid,p_student_id uuid,p_amount_minor bigint,p_reason text,
 p_explanation text,p_request_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; c public.cafeterias; customer uuid; result jsonb;
begin
 if exists(select 1 from pikas_private.sandbox_validated_pov()) then raise exception using errcode='42501',message='cafeteria_authority_required'; end if;
 ctx:=pikas_private.require_cafeteria_admin(p_cafeteria_id);
 select * into strict c from public.cafeterias where id=p_cafeteria_id;
 if not pikas_private.has_capability('cafeteria:wallets:administrative_adjust',c.account_id,c.school_id,c.id) then
  raise exception using errcode='42501',message='cafeteria_authority_required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_student_id::text,0));
 ctx:=pikas_private.require_cafeteria_admin(p_cafeteria_id,true);
 if not pikas_private.has_capability('cafeteria:wallets:administrative_adjust',c.account_id,c.school_id,c.id) then
  raise exception using errcode='42501',message='cafeteria_authority_required'; end if;
 select cc.id into customer from public.cafeteria_customers cc
  join public.school_cafeteria_shares sh on sh.account_id=cc.account_id and sh.school_id=cc.school_id and sh.cafeteria_id=cc.cafeteria_id and sh.status='active'
  join public.school_cafeteria_share_categories cat on cat.share_id=sh.id and cat.category='basic_identification' and cat.enabled
  join public.students s on s.id=cc.student_id and s.account_id=cc.account_id and s.school_id=cc.school_id and s.status='active'
  where cc.cafeteria_id=c.id and cc.account_id=c.account_id and cc.school_id=c.school_id and cc.student_id=p_student_id and cc.status='active'
  for share of cc,sh,cat;
 if customer is null then raise exception using errcode='42501',message='cafeteria_authority_required'; end if;
 result:=pikas_private.post_administrative_adjustment(c.account_id,c.school_id,p_student_id,p_amount_minor,p_reason,p_explanation,
  p_request_key,(ctx->>'actor_id')::uuid,'cafeteria_admin','cafeteria',c.id,customer);
 return result||jsonb_build_object('cafeteria_id',c.id);
end $$;

-- Unchanged from 202610190001 except administrative adjustment fields.
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
 'cafeteria',coalesce(c.name,adjc.name),'adjustment_reason',a.reason_code,'actor_role',a.actor_role,'balance_before_minor',a.balance_before_minor::text,'reversal_id',coalesce(rv.id,rr.id),'reversed_replenishment_id',rv.replenishment_id,
 'reversal_reason',coalesce(rv.reason,rr.reason),'reversal_note',rv.note,'reversed_at',rr.reversed_at,
 'original_reference',orig.reference,'original_note',orig.verification_note,'original_amount_minor',orig.amount_minor::text,'items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'quantity',i.quantity,
 'line_total_minor',i.line_total_minor::text) order by i.line_number),'[]'::jsonb) from public.purchase_items i where i.purchase_id=p.id)) row
 from public.wallet_ledger_entries l
 left join public.wallet_replenishments r on r.id=l.replenishment_id
 left join public.wallet_replenishment_reversals rr on rr.replenishment_id=r.id
 left join public.wallet_replenishment_reversals rv on rv.id=l.replenishment_reversal_id
 left join public.wallet_replenishments orig on orig.id=rv.replenishment_id
 left join public.wallet_adjustments a on a.id=l.adjustment_id
 left join public.cafeterias adjc on adjc.id=a.cafeteria_id
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

-- Unchanged from 202610190001 except the adjust capability flag.
create or replace function public.school_wallet_access(p_school_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a uuid; pov boolean;
begin
 select s.account_id into a from public.schools s where s.id=p_school_id;
 pov:=exists(select 1 from pikas_private.sandbox_validated_pov());
 return jsonb_build_object('school_id',p_school_id,
  'read',a is not null and not pov and pikas_private.has_capability('school:wallets:read',a,p_school_id),
  'replenish',a is not null and not pov and pikas_private.has_capability('school:wallets:replenish',a,p_school_id),
  'reverse',a is not null and not pov and pikas_private.has_capability('school:wallets:reverse_replenishment',a,p_school_id),
  'adjust',a is not null and not pov and pikas_private.has_capability('school:wallets:administrative_adjust',a,p_school_id));
end $$;

revoke all on function pikas_private.post_administrative_adjustment(uuid,uuid,uuid,bigint,text,text,uuid,uuid,text,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.school_wallet_adjust(uuid,uuid,bigint,text,text,uuid),public.cafeteria_wallet_adjust(uuid,uuid,bigint,text,text,uuid) from public,anon,service_role;
grant execute on function public.school_wallet_adjust(uuid,uuid,bigint,text,text,uuid),public.cafeteria_wallet_adjust(uuid,uuid,bigint,text,text,uuid) to authenticated;
commit;
