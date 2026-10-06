-- Phase 5B: durable purchase receipt snapshots and recoverable print jobs.
begin;

insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values
 ('cafeteria','pos_cashier','cafeteria:pos:receipts:claim'),
 ('cafeteria','pos_cashier','cafeteria:pos:receipts:reprint'),
 ('cafeteria','pos_supervisor','cafeteria:pos:receipts:claim'),
 ('cafeteria','pos_supervisor','cafeteria:pos:receipts:reprint');

create table public.receipt_print_jobs (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null,
 school_id uuid not null,
 school_location_id uuid not null,
 cafeteria_id uuid not null,
 purchase_id uuid not null,
 job_kind text not null check(job_kind in ('original','reprint')),
 source_job_id uuid,
 requested_by_person_id uuid not null references public.persons(id) on delete restrict,
 requested_at timestamptz not null,
 template_version integer not null check(template_version>0),
 receipt_snapshot jsonb,
 reprint_reason_code text check(reprint_reason_code in ('customer_requested','damaged','other')),
 request_key text check(request_key is null or length(request_key) between 16 and 128),
 payload_fingerprint text check(payload_fingerprint is null or payload_fingerprint ~ '^[0-9a-f]{64}$'),
 state text not null default 'pending' check(state in ('pending','dispatching','submitted','failed','uncertain')),
 attempt_count integer not null default 0 check(attempt_count>=0),
 claim_token uuid,
 claimed_by_person_id uuid references public.persons(id) on delete restrict,
 claimed_by_membership_id uuid references public.cafeteria_memberships(id) on delete restrict,
 claimed_at timestamptz,
 claim_expires_at timestamptz,
 submitted_at timestamptz,
 last_error_code text check(last_error_code is null or last_error_code in
   ('BRIDGE_UNAVAILABLE','PRINTER_UNAVAILABLE','SUBMISSION_REJECTED','SUBMISSION_TIMEOUT','CLAIM_EXPIRED')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(account_id,school_id,school_location_id,cafeteria_id,purchase_id)
  references public.purchases(account_id,school_id,school_location_id,cafeteria_id,id) on delete restrict,
 unique(account_id,school_id,school_location_id,cafeteria_id,purchase_id,id),
 foreign key(account_id,school_id,school_location_id,cafeteria_id,purchase_id,source_job_id)
  references public.receipt_print_jobs(account_id,school_id,school_location_id,cafeteria_id,purchase_id,id) on delete restrict,
 unique(account_id,requested_by_person_id,request_key),
 check((job_kind='original' and source_job_id is null and receipt_snapshot is not null
   and reprint_reason_code is null and request_key is null and payload_fingerprint is null
   and requested_by_person_id is not null)
  or (job_kind='reprint' and source_job_id is not null and receipt_snapshot is null
   and reprint_reason_code is not null and request_key is not null and payload_fingerprint is not null)),
 check((state='dispatching' and claim_token is not null and claimed_by_person_id is not null
   and claimed_by_membership_id is not null and claimed_at is not null and claim_expires_at>claimed_at
   and submitted_at is null and last_error_code is null)
  or (state<>'dispatching' and claim_token is null and claimed_by_person_id is null
   and claimed_by_membership_id is null and claimed_at is null and claim_expires_at is null)),
 check((state='submitted' and submitted_at is not null and last_error_code is null)
  or (state<>'submitted' and submitted_at is null)),
 check((state in ('failed','uncertain') and last_error_code is not null)
  or (state not in ('failed','uncertain') and last_error_code is null))
);

create unique index receipt_print_jobs_one_original_per_purchase
 on public.receipt_print_jobs(purchase_id) where job_kind='original';
create index receipt_print_jobs_register_queue_idx
 on public.receipt_print_jobs(account_id,school_id,cafeteria_id,state,requested_at,id);
create index receipt_print_jobs_purchase_history_idx
 on public.receipt_print_jobs(account_id,school_id,cafeteria_id,purchase_id,requested_at,id);

create function pikas_private.guard_receipt_print_job() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_kind text;
begin
 if tg_op='DELETE' then
  raise exception using errcode='23514',message='RECEIPT_PRINT_HISTORY_IMMUTABLE';
 end if;
 if tg_op='INSERT' then
  if new.job_kind='reprint' then
   select j.job_kind into source_kind from public.receipt_print_jobs j where j.id=new.source_job_id
    and j.purchase_id=new.purchase_id;
   if source_kind is distinct from 'original' then
    raise exception using errcode='23514',message='REPRINT_SOURCE_MUST_BE_ORIGINAL';
   end if;
  end if;
  return new;
 end if;
 if row(new.account_id,new.school_id,new.school_location_id,new.cafeteria_id,new.purchase_id,
   new.job_kind,new.source_job_id,new.requested_by_person_id,new.requested_at,new.template_version,
   new.receipt_snapshot,new.reprint_reason_code,new.request_key,new.payload_fingerprint,new.created_at)
   is distinct from
   row(old.account_id,old.school_id,old.school_location_id,old.cafeteria_id,old.purchase_id,
   old.job_kind,old.source_job_id,old.requested_by_person_id,old.requested_at,old.template_version,
   old.receipt_snapshot,old.reprint_reason_code,old.request_key,old.payload_fingerprint,old.created_at) then
  raise exception using errcode='23514',message='RECEIPT_PRINT_EVIDENCE_IMMUTABLE';
 end if;
 if old.state='pending' and new.state='dispatching' then
  if new.attempt_count<>old.attempt_count+1 or new.claim_token is null or new.claimed_by_person_id is null
    or new.claimed_by_membership_id is null
    or new.claimed_at is null or new.claim_expires_at<=new.claimed_at then
   raise exception using errcode='23514',message='INVALID_STATE';
  end if;
 elsif old.state='dispatching' and new.state in ('submitted','failed','uncertain') then
  if new.attempt_count<>old.attempt_count or old.claim_token is null then
   raise exception using errcode='23514',message='INVALID_STATE';
  end if;
  if new.state='submitted' and new.submitted_at is null then
   raise exception using errcode='23514',message='INVALID_STATE';
  elsif new.state='failed' and new.last_error_code not in
    ('BRIDGE_UNAVAILABLE','PRINTER_UNAVAILABLE','SUBMISSION_REJECTED') then
   raise exception using errcode='23514',message='INVALID_STATE';
  elsif new.state='uncertain' and new.last_error_code not in ('SUBMISSION_TIMEOUT','CLAIM_EXPIRED') then
   raise exception using errcode='23514',message='INVALID_STATE';
  end if;
 elsif old.state in ('failed','uncertain') and new.state='pending' then
  if new.attempt_count<>old.attempt_count then
   raise exception using errcode='23514',message='INVALID_STATE';
  end if;
 else
  raise exception using errcode='23514',message='INVALID_STATE';
 end if;
 return new;
end $$;

create trigger receipt_print_jobs_guard before insert or update or delete
 on public.receipt_print_jobs for each row execute function pikas_private.guard_receipt_print_job();
create trigger receipt_print_jobs_no_truncate before truncate on public.receipt_print_jobs
 for each statement execute function pikas_private.reject_purchase_history_mutation();

create function pikas_private.create_original_receipt_print_job(p_tender_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.purchases%rowtype; t public.purchase_tenders%rowtype; rs public.register_sessions%rowtype;
 cash public.purchase_cash_tenders%rowtype;
 item_count bigint; item_total numeric;
 snap jsonb; new_job uuid;
begin
 select t0.* into t from public.purchase_tenders t0 where t0.id=p_tender_id;
 if not found then return null; end if;
 select p0.* into p from public.purchases p0 where p0.id=t.purchase_id;
 if not found then return null; end if;
 select count(*),coalesce(sum(i.line_total_minor::numeric),0) into item_count,item_total
  from public.purchase_items i where i.purchase_id=p.id;
 if item_count=0 or item_total<>p.total_minor::numeric then return null; end if;
 if t.tender_type='cash' then
  select ct.* into cash from public.purchase_cash_tenders ct where ct.tender_id=t.id;
  if not found or exists(select 1 from public.purchase_wallet_tenders wt where wt.tender_id=t.id) then
   return null;
  end if;
 elsif t.tender_type='student_wallet' then
  if not exists(select 1 from public.purchase_wallet_tenders wt where wt.tender_id=t.id)
    or exists(select 1 from public.purchase_cash_tenders ct where ct.tender_id=t.id) then
   return null;
  end if;
 else
  return null;
 end if;
 select rs0.* into rs from public.register_sessions rs0 where rs0.id=p.register_session_id;
 if not found then return null; end if;
 select jsonb_build_object(
  'purchase_number',p.purchase_number::text,
  'purchased_at',p.purchased_at,
  'business_date',p.business_date,
  'business_timezone',p.business_timezone_snapshot,
  'currency_code',p.currency_code,
  'total_minor',p.total_minor::text,
  'school_name',s.name,
  'campus_name',sl.name,
  'cafeteria_name',c.name,
  'register_code',rs.register_code_snapshot,
  'register_name',rs.register_name_snapshot,
  'items',(select jsonb_agg(jsonb_build_object(
    'name',i.product_name_snapshot,'quantity',i.quantity,
    'unit_price_minor',i.unit_price_minor::text,'line_total_minor',i.line_total_minor::text)
    order by i.line_number) from public.purchase_items i where i.purchase_id=p.id),
  'tender',case when t.tender_type='cash' then jsonb_build_object(
    'type','cash','cash_received_minor',cash.cash_received_minor::text,'change_due_minor',cash.change_due_minor::text)
   else jsonb_build_object('type','student_wallet') end
 ) into snap
 from public.schools s
 join public.school_locations sl on sl.account_id=s.account_id and sl.school_id=s.id and sl.id=p.school_location_id
 join public.cafeterias c on c.account_id=p.account_id and c.school_id=p.school_id
   and c.school_location_id=p.school_location_id and c.id=p.cafeteria_id
 where s.account_id=p.account_id and s.id=p.school_id;
 if snap is null or jsonb_typeof(snap->'items')<>'array' or jsonb_array_length(snap->'items')<1 then
  return null;
 end if;
 insert into public.receipt_print_jobs(account_id,school_id,school_location_id,cafeteria_id,purchase_id,
  job_kind,requested_by_person_id,requested_at,template_version,receipt_snapshot)
 values(p.account_id,p.school_id,p.school_location_id,p.cafeteria_id,p.id,'original',
  p.operator_person_id,p.purchased_at,1,snap) returning id into new_job;
 return new_job;
end $$;

create function pikas_private.capture_original_receipt_print_job() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pikas_private.create_original_receipt_print_job(new.tender_id);
 return new;
end $$;
create trigger purchase_cash_tender_receipt_job after insert on public.purchase_cash_tenders
 for each row execute function pikas_private.capture_original_receipt_print_job();
create trigger purchase_wallet_tender_receipt_job after insert on public.purchase_wallet_tenders
 for each row execute function pikas_private.capture_original_receipt_print_job();

create function pikas_private.assert_receipt_operator(
 p_membership_id uuid,p_person_id uuid,p_register_id uuid,p_account_id uuid,p_school_id uuid,
 p_school_location_id uuid,p_cafeteria_id uuid,p_purchase_operator uuid,p_own_purchase_only boolean)
returns text language plpgsql security definer set search_path='' as $$
declare role_value text;
begin
 if p_person_id is null or p_person_id is distinct from pikas_private.current_person_id() then
  raise exception using errcode='42501',message='UNAUTHORIZED';
 end if;
 perform 1 from public.persons p where p.id=p_person_id and p.status='active'
  and p.auth_user_id=auth.uid() for share;
 if not found then raise exception using errcode='42501',message='UNAUTHORIZED'; end if;
 perform 1 from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id);
 if not found then raise exception using errcode='42501',message='UNAUTHORIZED'; end if;
 select m.role_code into role_value from public.cafeteria_memberships m
 join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
 where m.id=p_membership_id and m.person_id=p_person_id and m.account_id=p_account_id
  and m.school_id=p_school_id and m.cafeteria_id=p_cafeteria_id and m.status='active'
  and m.role_code in ('pos_cashier','pos_supervisor')
  and rc.capability='cafeteria:pos:receipts:claim' for share of m;
 if not found then raise exception using errcode='42501',message='UNAUTHORIZED'; end if;
 if p_own_purchase_only and role_value='pos_cashier' and p_purchase_operator is distinct from p_person_id then
  raise exception using errcode='42501',message='UNAUTHORIZED';
 end if;
 perform 1 from public.cafeteria_registers r join public.cafeteria_register_assignments a
  on a.account_id=r.account_id and a.school_id=r.school_id and a.school_location_id=r.school_location_id
   and a.cafeteria_id=r.cafeteria_id and a.register_id=r.id
 where r.id=p_register_id and r.account_id=p_account_id and r.school_id=p_school_id
  and r.school_location_id=p_school_location_id and r.cafeteria_id=p_cafeteria_id and r.status='active'
  and a.operator_person_id=p_person_id and a.cafeteria_membership_id=p_membership_id and a.status='active'
 for share of r,a;
 if not found then raise exception using errcode='42501',message='UNAUTHORIZED'; end if;
 return role_value;
end $$;

create function public.claim_purchase_receipt_print_job(
 p_register_id uuid,p_membership_id uuid,p_purchase_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; a uuid; s uuid; loc uuid; c uuid; target public.receipt_print_jobs%rowtype;
 p public.purchases%rowtype; r public.cafeteria_registers%rowtype;
 token uuid; expiry timestamptz; snapshot_value jsonb;
begin
 actor:=pikas_private.current_person_id();
 select r0.* into r from public.cafeteria_registers r0 where r0.id=p_register_id;
 if not found then raise exception using errcode='42501',message='UNAUTHORIZED'; end if;
 a:=r.account_id; s:=r.school_id; loc:=r.school_location_id; c:=r.cafeteria_id;
 if p_purchase_id is not null then
  select p0.* into p from public.purchases p0 where p0.id=p_purchase_id
   and p0.account_id=a and p0.school_id=s and p0.school_location_id=loc and p0.cafeteria_id=c
   and p0.register_id=p_register_id;
  if not found then raise exception using errcode='42501',message='UNAUTHORIZED'; end if;
  perform pikas_private.assert_receipt_operator(p_membership_id,actor,p_register_id,a,s,loc,c,
    p.operator_person_id,false);
 end if;
 select j.* into target from public.receipt_print_jobs j join public.purchases p0 on p0.id=j.purchase_id
 where j.account_id=a and j.school_id=s and j.school_location_id=loc and j.cafeteria_id=c
  and p0.register_id=p_register_id and (p_purchase_id is null or j.purchase_id=p_purchase_id)
  and j.state='dispatching' and j.claim_expires_at<=clock_timestamp()
 order by j.claim_expires_at,j.id for update of j skip locked limit 1;
 if found then
  p:=null;
  select p0.* into p from public.purchases p0 where p0.id=target.purchase_id;
  perform pikas_private.assert_receipt_operator(p_membership_id,actor,p_register_id,a,s,loc,c,
    p.operator_person_id,false);
  update public.receipt_print_jobs set state='uncertain',claim_token=null,claimed_by_person_id=null,
   claimed_by_membership_id=null,
   claimed_at=null,claim_expires_at=null,last_error_code='CLAIM_EXPIRED',
   updated_at=clock_timestamp()
   where id=target.id;
  return jsonb_build_object('job_id',target.id,'state','uncertain','error_code','CLAIM_EXPIRED');
 end if;
 select j.* into target from public.receipt_print_jobs j join public.purchases p0 on p0.id=j.purchase_id
 where j.account_id=a and j.school_id=s and j.school_location_id=loc and j.cafeteria_id=c
  and p0.register_id=p_register_id and (p_purchase_id is null or j.purchase_id=p_purchase_id)
  and j.state='pending'
 order by j.requested_at,j.id for update of j skip locked limit 1;
 if not found then return null; end if;
 select p0.* into p from public.purchases p0 where p0.id=target.purchase_id;
 perform pikas_private.assert_receipt_operator(p_membership_id,actor,p_register_id,a,s,loc,c,
  p.operator_person_id,false);
 if target.attempt_count=2147483647 then raise exception using errcode='22003',message='ATTEMPT_COUNT_EXHAUSTED'; end if;
 token:=gen_random_uuid(); expiry:=clock_timestamp()+interval '2 minutes';
 update public.receipt_print_jobs set state='dispatching',attempt_count=attempt_count+1,
  claim_token=token,claimed_by_person_id=actor,claimed_by_membership_id=p_membership_id,
  claimed_at=clock_timestamp(),claim_expires_at=expiry,
  updated_at=clock_timestamp() where id=target.id returning * into target;
 select coalesce(target.receipt_snapshot,original.receipt_snapshot) into snapshot_value
  from public.receipt_print_jobs original
  where original.id=case when target.job_kind='original' then target.id else target.source_job_id end;
 return jsonb_build_object('job_id',target.id,'job_kind',target.job_kind,'template_version',target.template_version,
  'register_id',p_register_id,'register_code',r.register_code,'register_name',r.display_name,
  'claim_token',token,'claim_expires_at',expiry,'receipt_snapshot',snapshot_value);
end $$;

create function public.report_receipt_print_job(p_job_id uuid,p_claim_token uuid,p_result text,
 p_error_code text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; j public.receipt_print_jobs%rowtype; p public.purchases%rowtype;
begin
 actor:=pikas_private.current_person_id();
 select * into j from public.receipt_print_jobs where id=p_job_id for update;
 if not found then raise exception using errcode='42501',message='UNAUTHORIZED'; end if;
 select * into p from public.purchases where id=j.purchase_id;
 if not found then raise exception using errcode='23514',message='RECEIPT_SOURCE_INVALID'; end if;
 if j.state<>'dispatching' or j.claim_token is distinct from p_claim_token
   or j.claimed_by_person_id is distinct from actor then
  raise exception using errcode='40001',message='CLAIM_NOT_CURRENT';
 end if;
 perform pikas_private.assert_receipt_operator(j.claimed_by_membership_id,actor,p.register_id,
  j.account_id,j.school_id,j.school_location_id,j.cafeteria_id,p.operator_person_id,false);
 if j.claim_expires_at<=clock_timestamp() then
  update public.receipt_print_jobs set state='uncertain',claim_token=null,claimed_by_person_id=null,
   claimed_by_membership_id=null,
   claimed_at=null,claim_expires_at=null,last_error_code='CLAIM_EXPIRED',
   updated_at=clock_timestamp()
   where id=j.id;
  return jsonb_build_object('job_id',j.id,'state','uncertain','error_code','CLAIM_EXPIRED');
 end if;
 if p_result='submitted' then
  if p_error_code is not null then
   raise exception using errcode='22023',message='INVALID_RESULT';
  end if;
  update public.receipt_print_jobs set state='submitted',claim_token=null,claimed_by_person_id=null,
   claimed_by_membership_id=null,claimed_at=null,claim_expires_at=null,
   submitted_at=clock_timestamp(),last_error_code=null,updated_at=clock_timestamp()
   where id=j.id returning * into j;
 elsif p_result in ('failed','uncertain') then
  if p_result='failed' and (p_error_code is null or p_error_code not in
    ('BRIDGE_UNAVAILABLE','PRINTER_UNAVAILABLE','SUBMISSION_REJECTED')) then
   raise exception using errcode='22023',message='INVALID_RESULT';
  elsif p_result='uncertain' and (p_error_code is null or p_error_code not in ('SUBMISSION_TIMEOUT')) then
   raise exception using errcode='22023',message='INVALID_RESULT';
  end if;
  update public.receipt_print_jobs set state=p_result,claim_token=null,claimed_by_person_id=null,
   claimed_by_membership_id=null,claimed_at=null,claim_expires_at=null,submitted_at=null,
   last_error_code=p_error_code,updated_at=clock_timestamp() where id=j.id returning * into j;
 else
  raise exception using errcode='22023',message='INVALID_RESULT';
 end if;
 return jsonb_build_object('job_id',j.id,'state',j.state);
end $$;

create function public.retry_receipt_print_job(p_job_id uuid,p_membership_id uuid,
 p_acknowledge_possible_duplicate boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; j public.receipt_print_jobs%rowtype; p public.purchases%rowtype; role_value text;
begin
 actor:=pikas_private.current_person_id();
 select * into j from public.receipt_print_jobs where id=p_job_id for update;
 if not found then raise exception using errcode='42501',message='UNAUTHORIZED'; end if;
 select * into p from public.purchases where id=j.purchase_id;
 role_value:=pikas_private.assert_receipt_operator(p_membership_id,actor,p.register_id,j.account_id,
  j.school_id,j.school_location_id,j.cafeteria_id,p.operator_person_id,false);
 if j.state not in ('failed','uncertain') then
  raise exception using errcode='23514',message='INVALID_STATE';
 end if;
 if j.state='uncertain' and p_acknowledge_possible_duplicate is not true then
  raise exception using errcode='22023',message='DUPLICATE_OUTPUT_ACKNOWLEDGEMENT_REQUIRED';
 end if;
 if j.state='failed' and p_acknowledge_possible_duplicate is true then
  raise exception using errcode='22023',message='UNEXPECTED_DUPLICATE_OUTPUT_ACKNOWLEDGEMENT';
 end if;
 update public.receipt_print_jobs set state='pending',last_error_code=null,
  updated_at=clock_timestamp() where id=j.id returning * into j;
 if j.state='pending' then
  perform pikas_private.record_pos_operational_audit(actor,auth.uid(),role_value,j.account_id,j.school_id,
   j.cafeteria_id,'receipt_print.retry','receipt_print_job',j.id,
   jsonb_build_object('state',case when p_acknowledge_possible_duplicate then 'uncertain' else 'failed' end),
   jsonb_build_object('state','pending','possible_duplicate_acknowledged',p_acknowledge_possible_duplicate));
 end if;
 return jsonb_build_object('job_id',j.id,'state',j.state);
end $$;

create function public.request_purchase_receipt_reprint(p_purchase_id uuid,p_register_id uuid,
 p_membership_id uuid,p_request_key text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; p public.purchases%rowtype; original public.receipt_print_jobs%rowtype;
 role_value text; fp text; j public.receipt_print_jobs%rowtype;
begin
 actor:=pikas_private.current_person_id();
 if p_request_key is null or length(p_request_key) not between 16 and 128
   or p_reason is null or p_reason not in ('customer_requested','damaged','other') then
  raise exception using errcode='22023',message='INVALID_REPRINT_REQUEST';
 end if;
 select * into p from public.purchases where id=p_purchase_id and register_id=p_register_id;
 if not found then raise exception using errcode='42501',message='UNAUTHORIZED'; end if;
 role_value:=pikas_private.assert_receipt_operator(p_membership_id,actor,p_register_id,p.account_id,
  p.school_id,p.school_location_id,p.cafeteria_id,p.operator_person_id,true);
 if not exists(select 1 from pikas_private.role_capabilities rc
   join public.cafeteria_memberships m on m.scope_kind=rc.scope_kind and m.role_code=rc.role_code
   where m.id=p_membership_id and rc.capability='cafeteria:pos:receipts:reprint') then
  raise exception using errcode='42501',message='UNAUTHORIZED';
 end if;
 select * into original from public.receipt_print_jobs where purchase_id=p.id and job_kind='original';
 if not found then raise exception using errcode='23514',message='ORIGINAL_RECEIPT_MISSING'; end if;
 fp:=encode(extensions.digest(convert_to(jsonb_build_object('purchase_id',p.id,
   'register_id',p_register_id,'reason',p_reason)::text,'UTF8'),'sha256'),'hex');
 insert into public.receipt_print_jobs(account_id,school_id,school_location_id,cafeteria_id,purchase_id,
  job_kind,source_job_id,requested_by_person_id,requested_at,template_version,reprint_reason_code,
  request_key,payload_fingerprint)
 values(p.account_id,p.school_id,p.school_location_id,p.cafeteria_id,p.id,'reprint',original.id,
  actor,clock_timestamp(),original.template_version,p_reason,p_request_key,fp)
 on conflict(account_id,requested_by_person_id,request_key) do nothing
 returning * into j;
 if not found then
  select * into j from public.receipt_print_jobs where account_id=p.account_id
   and requested_by_person_id=actor and request_key=p_request_key;
  if j.payload_fingerprint<>fp then
   raise exception using errcode='23505',message='IDEMPOTENCY_KEY_REUSED';
  end if;
  return jsonb_build_object('job_id',j.id,'state',j.state,'replayed',true);
 end if;
 perform pikas_private.record_pos_operational_audit(actor,auth.uid(),role_value,p.account_id,p.school_id,
  p.cafeteria_id,'receipt_print.reprint','receipt_print_job',j.id,
  jsonb_build_object('purchase_id',p.id,'reason',p_reason),
  jsonb_build_object('job_id',j.id,'source_job_id',original.id));
 return jsonb_build_object('job_id',j.id,'state',j.state,'replayed',false);
end $$;

alter table public.receipt_print_jobs enable row level security;
alter table public.receipt_print_jobs force row level security;
create policy receipt_print_jobs_read on public.receipt_print_jobs for select to authenticated
 using (exists(select 1 from public.purchases p where p.id=receipt_print_jobs.purchase_id
   and p.operator_person_id=pikas_private.current_person_id()
   and pikas_private.has_capability('cafeteria:pos:receipts:claim',
    receipt_print_jobs.account_id,receipt_print_jobs.school_id,receipt_print_jobs.cafeteria_id)));
revoke all on public.receipt_print_jobs from public,anon,authenticated;
grant select on public.receipt_print_jobs to authenticated;
revoke all on function pikas_private.guard_receipt_print_job() from public,anon,authenticated;
revoke all on function pikas_private.create_original_receipt_print_job(uuid) from public,anon,authenticated;
revoke all on function pikas_private.capture_original_receipt_print_job() from public,anon,authenticated;
revoke all on function pikas_private.assert_receipt_operator(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)
 from public,anon,authenticated;
revoke all on function public.claim_purchase_receipt_print_job(uuid,uuid,uuid) from public,anon;
revoke all on function public.report_receipt_print_job(uuid,uuid,text,text) from public,anon;
revoke all on function public.retry_receipt_print_job(uuid,uuid,boolean) from public,anon;
revoke all on function public.request_purchase_receipt_reprint(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.claim_purchase_receipt_print_job(uuid,uuid,uuid) to authenticated;
grant execute on function public.report_receipt_print_job(uuid,uuid,text,text) to authenticated;
grant execute on function public.retry_receipt_print_job(uuid,uuid,boolean) to authenticated;
grant execute on function public.request_purchase_receipt_reprint(uuid,uuid,uuid,text,text) to authenticated;
commit;
