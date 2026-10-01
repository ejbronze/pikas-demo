-- Phase 3A: student prepaid wallets, verified manual funding, and adjustments.
-- No purchase, refund, POS, provider, staff-credit, or application writer schema.
begin;

create extension if not exists pgcrypto with schema extensions;

insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values
  ('school','school_admin','school:wallets:read'),
  ('school','school_admin','school:wallets:manage'),
  ('school','school_admin','school:wallets:replenish'),
  ('school','school_admin','school:wallets:adjust'),
  ('cafeteria','cafeteria_admin','cafeteria:wallets:replenish');

create table public.supported_currencies (
  currency_code text primary key check (currency_code ~ '^[A-Z]{3}$'),
  minor_unit_exponent smallint not null check (minor_unit_exponent between 0 and 4),
  status text not null default 'enabled' check (status in ('enabled','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.supported_currencies(currency_code,minor_unit_exponent,status)
values ('DOP',2,'enabled');

create table public.student_wallets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  student_id uuid not null,
  currency_code text not null references public.supported_currencies(currency_code) on delete restrict,
  current_balance_minor bigint not null default 0 check (current_balance_minor >= 0),
  balance_version bigint not null default 0 check (balance_version >= 0),
  status text not null default 'active' check (status in ('active','frozen')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,student_id) references public.students(account_id,school_id,id) on delete restrict,
  unique (student_id,currency_code),
  unique (account_id,school_id,id),
  unique (account_id,school_id,id,currency_code)
);
create index student_wallets_school_status_idx on public.student_wallets(account_id,school_id,status);

create table public.wallet_replenishments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  wallet_id uuid not null,
  currency_code text not null,
  amount_minor bigint not null check (amount_minor > 0),
  source text not null check (source='manual_verified'),
  status text not null default 'posted' check (status='posted'),
  initiated_by uuid not null references public.persons(id) on delete restrict,
  verified_by uuid not null references public.persons(id) on delete restrict,
  initiated_at timestamptz not null,
  verified_at timestamptz not null,
  posted_at timestamptz not null,
  cafeteria_id uuid,
  cafeteria_customer_id uuid,
  reference text check (reference is null or length(btrim(reference)) between 1 and 160),
  verification_note text check (verification_note is null or length(btrim(verification_note)) between 1 and 500),
  idempotency_key text not null check (length(idempotency_key) between 16 and 128),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (account_id,school_id,wallet_id,currency_code)
    references public.student_wallets(account_id,school_id,id,currency_code) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id) references public.cafeterias(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,cafeteria_customer_id)
    references public.cafeteria_customers(account_id,school_id,cafeteria_id,id) on delete restrict,
  unique (account_id,idempotency_key),
  unique (account_id,school_id,wallet_id,currency_code,id),
  check ((cafeteria_id is null and cafeteria_customer_id is null) or
         (cafeteria_id is not null and cafeteria_customer_id is not null)),
  check (verified_at >= initiated_at and posted_at >= verified_at)
);
create index wallet_replenishments_wallet_time_idx on public.wallet_replenishments(account_id,school_id,wallet_id,posted_at desc);

create table public.wallet_adjustments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  wallet_id uuid not null,
  currency_code text not null,
  amount_minor bigint not null check (amount_minor <> 0),
  reason_code text not null check (reason_code in (
    'administrative_correction','duplicate_manual_credit_correction','reconciliation_correction','other_authorized_correction')),
  reference text check (reference is null or length(btrim(reference)) between 1 and 160),
  explanatory_note text check (explanatory_note is null or length(btrim(explanatory_note)) between 1 and 500),
  status text not null default 'posted' check (status='posted'),
  actor_person_id uuid not null references public.persons(id) on delete restrict,
  posted_at timestamptz not null,
  idempotency_key text not null check (length(idempotency_key) between 16 and 128),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (account_id,school_id,wallet_id,currency_code)
    references public.student_wallets(account_id,school_id,id,currency_code) on delete restrict,
  unique (account_id,idempotency_key),
  unique (account_id,school_id,wallet_id,currency_code,id),
  check (reason_code<>'other_authorized_correction' or reference is not null or explanatory_note is not null)
);
create index wallet_adjustments_wallet_time_idx on public.wallet_adjustments(account_id,school_id,wallet_id,posted_at desc);

create table public.wallet_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  wallet_id uuid not null,
  currency_code text not null,
  entry_type text not null check (entry_type in ('replenishment','adjustment')),
  amount_minor bigint not null check (amount_minor <> 0),
  balance_after_minor bigint not null check (balance_after_minor >= 0),
  balance_version_after bigint not null check (balance_version_after > 0),
  replenishment_id uuid,
  adjustment_id uuid,
  occurred_at timestamptz not null default now(),
  foreign key (account_id,school_id,wallet_id,currency_code)
    references public.student_wallets(account_id,school_id,id,currency_code) on delete restrict,
  foreign key (account_id,school_id,wallet_id,currency_code,replenishment_id)
    references public.wallet_replenishments(account_id,school_id,wallet_id,currency_code,id) on delete restrict,
  foreign key (account_id,school_id,wallet_id,currency_code,adjustment_id)
    references public.wallet_adjustments(account_id,school_id,wallet_id,currency_code,id) on delete restrict,
  unique (wallet_id,balance_version_after),
  unique (replenishment_id),
  unique (adjustment_id),
  check ((entry_type='replenishment' and amount_minor>0 and replenishment_id is not null and adjustment_id is null)
      or (entry_type='adjustment' and adjustment_id is not null and replenishment_id is null))
);
create index wallet_ledger_wallet_time_idx on public.wallet_ledger_entries(account_id,school_id,wallet_id,occurred_at,id);

create function pikas_private.reject_wallet_history_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode='23514',message='wallet_financial_history_is_immutable';
end $$;

create function pikas_private.assert_wallet_operation_ledger() returns trigger
language plpgsql set search_path = '' as $$
declare matching_entries bigint; expected_amount bigint; expected_type text;
  actual_amount bigint; actual_type text; entry_wallet uuid; entry_version bigint;
  entry_balance bigint; previous_balance bigint; wallet_balance bigint; wallet_version bigint;
begin
  if tg_table_name='wallet_replenishments' then
    select count(*) into matching_entries from public.wallet_ledger_entries l where l.replenishment_id=new.id;
    expected_amount:=new.amount_minor; expected_type:='replenishment';
  else
    select count(*) into matching_entries from public.wallet_ledger_entries l where l.adjustment_id=new.id;
    expected_amount:=new.amount_minor; expected_type:='adjustment';
  end if;
  if matching_entries<>1 then
    raise exception using errcode='23514',message='posted_wallet_operation_requires_exactly_one_ledger_entry';
  end if;
  if tg_table_name='wallet_replenishments' then
    select l.amount_minor,l.entry_type,l.wallet_id,l.balance_version_after,l.balance_after_minor
      into actual_amount,actual_type,entry_wallet,entry_version,entry_balance
      from public.wallet_ledger_entries l where l.replenishment_id=new.id;
  else
    select l.amount_minor,l.entry_type,l.wallet_id,l.balance_version_after,l.balance_after_minor
      into actual_amount,actual_type,entry_wallet,entry_version,entry_balance
      from public.wallet_ledger_entries l where l.adjustment_id=new.id;
  end if;
  if actual_type<>expected_type or actual_amount<>expected_amount then
    raise exception using errcode='23514',message='wallet_ledger_entry_does_not_match_source_operation';
  end if;
  if entry_version=1 then
    previous_balance:=0;
  else
    select l.balance_after_minor into previous_balance from public.wallet_ledger_entries l
      where l.wallet_id=entry_wallet and l.balance_version_after=entry_version-1;
    if not found then raise exception using errcode='23514',message='wallet_ledger_balance_version_gap'; end if;
  end if;
  if (actual_amount>0 and previous_balance>9223372036854775807-actual_amount)
    or (actual_amount<0 and actual_amount < -previous_balance) then
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

create function pikas_private.guard_student_wallet_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.id is distinct from new.id or old.account_id is distinct from new.account_id
    or old.school_id is distinct from new.school_id or old.student_id is distinct from new.student_id
    or old.currency_code is distinct from new.currency_code or old.created_at is distinct from new.created_at then
    raise exception using errcode='23514',message='student_wallet_identity_is_immutable';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;

create function pikas_private.guard_currency_metadata() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.currency_code is distinct from new.currency_code
    or old.minor_unit_exponent is distinct from new.minor_unit_exponent
    or old.created_at is distinct from new.created_at then
    raise exception using errcode='23514',message='currency_identity_and_exponent_are_immutable';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;

create function pikas_private.record_wallet_audit(p_actor_person_id uuid,p_authenticated_user_id uuid,
  p_actor_role text,p_actor_scope text,p_account_id uuid,p_school_id uuid,p_cafeteria_id uuid,
  p_action text,p_target_type text,p_target_id uuid,p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,
    account_id,school_id,cafeteria_id,action,target_type,target_id,outcome,after_metadata)
  values(p_actor_person_id,p_authenticated_user_id,p_actor_role,p_actor_scope,p_account_id,p_school_id,p_cafeteria_id,
    p_action,p_target_type,p_target_id,'succeeded',coalesce(p_metadata,'{}'::jsonb));
end $$;

do $$
declare t text;
begin
  foreach t in array array['supported_currencies','student_wallets','wallet_replenishments','wallet_adjustments','wallet_ledger_entries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create trigger student_wallet_identity before update on public.student_wallets
for each row execute function pikas_private.guard_student_wallet_identity();
create trigger supported_currency_metadata before update on public.supported_currencies
for each row execute function pikas_private.guard_currency_metadata();
create trigger student_wallets_no_truncate before truncate on public.student_wallets
for each statement execute function pikas_private.reject_wallet_history_mutation();
create trigger wallet_replenishments_immutable before update or delete on public.wallet_replenishments
for each row execute function pikas_private.reject_wallet_history_mutation();
create trigger wallet_replenishments_no_truncate before truncate on public.wallet_replenishments
for each statement execute function pikas_private.reject_wallet_history_mutation();
create trigger wallet_adjustments_immutable before update or delete on public.wallet_adjustments
for each row execute function pikas_private.reject_wallet_history_mutation();
create trigger wallet_adjustments_no_truncate before truncate on public.wallet_adjustments
for each statement execute function pikas_private.reject_wallet_history_mutation();
create trigger wallet_ledger_immutable before update or delete on public.wallet_ledger_entries
for each row execute function pikas_private.reject_wallet_history_mutation();
create trigger wallet_ledger_no_truncate before truncate on public.wallet_ledger_entries
for each statement execute function pikas_private.reject_wallet_history_mutation();
create constraint trigger wallet_replenishment_requires_ledger
after insert on public.wallet_replenishments deferrable initially deferred for each row
execute function pikas_private.assert_wallet_operation_ledger();
create constraint trigger wallet_adjustment_requires_ledger
after insert on public.wallet_adjustments deferrable initially deferred for each row
execute function pikas_private.assert_wallet_operation_ledger();

grant select on public.supported_currencies,public.student_wallets,public.wallet_replenishments,
  public.wallet_adjustments,public.wallet_ledger_entries to authenticated;

create policy supported_currency_read on public.supported_currencies for select to authenticated using (status='enabled');
create policy student_wallet_school_read on public.student_wallets for select to authenticated
using (pikas_private.has_capability('school:wallets:read',account_id,school_id));
create policy wallet_replenishments_school_read on public.wallet_replenishments for select to authenticated
using (pikas_private.has_capability('school:wallets:read',account_id,school_id));
create policy wallet_adjustments_school_read on public.wallet_adjustments for select to authenticated
using (pikas_private.has_capability('school:wallets:read',account_id,school_id));
create policy wallet_ledger_school_read on public.wallet_ledger_entries for select to authenticated
using (pikas_private.has_capability('school:wallets:read',account_id,school_id));

create function public.create_student_wallet(p_account_id uuid,p_school_id uuid,p_student_id uuid,p_currency_code text)
returns table(wallet_id uuid,status text,current_balance_minor bigint,currency_code text)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; wallet_row public.student_wallets%rowtype; inserted_wallet boolean:=false;
begin
  actor_id := pikas_private.current_person_id();
  if actor_id is null or not pikas_private.has_capability('school:wallets:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if not exists(select 1 from public.supported_currencies c where c.currency_code=p_currency_code and c.status='enabled') then
    raise exception using errcode='22023',message='unsupported_currency';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_student_id::text,0));
    perform 1 from public.students s join public.persons p on p.id=s.person_id and p.status='active'
      join public.student_enrollments e on e.account_id=s.account_id and e.school_id=s.school_id and e.student_id=s.id and e.status='active'
      where s.id=p_student_id and s.account_id=p_account_id and s.school_id=p_school_id and s.status='active'
      for share of e;
    if not found then
    raise exception using errcode='23514',message='wallet_requires_active_enrolled_student';
  end if;
  insert into public.student_wallets(account_id,school_id,student_id,currency_code)
  values(p_account_id,p_school_id,p_student_id,p_currency_code)
  on conflict on constraint student_wallets_student_id_currency_code_key do nothing returning * into wallet_row;
  inserted_wallet := found;
  if not inserted_wallet then
    select w.* into wallet_row from public.student_wallets w
      where w.student_id=p_student_id and w.currency_code=p_currency_code for update;
    if wallet_row.account_id<>p_account_id or wallet_row.school_id<>p_school_id then
      raise exception using errcode='23503',message='wallet_not_found_in_school';
    end if;
  else
    perform pikas_private.record_wallet_audit(actor_id,auth.uid(),'school_admin','school',p_account_id,p_school_id,null,
      'wallet_created','student_wallets',wallet_row.id,jsonb_build_object('currency_code',p_currency_code,'status','active'));
  end if;
  return query select wallet_row.id,wallet_row.status,wallet_row.current_balance_minor,wallet_row.currency_code;
end $$;

create function public.set_student_wallet_status(p_account_id uuid,p_school_id uuid,p_wallet_id uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; before_status text;
begin
  actor_id := pikas_private.current_person_id();
  if actor_id is null or not pikas_private.has_capability('school:wallets:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_status not in ('active','frozen') then raise exception using errcode='22023',message='invalid_wallet_status'; end if;
  select w.status into before_status from public.student_wallets w
    where w.id=p_wallet_id and w.account_id=p_account_id and w.school_id=p_school_id for update;
  if not found then raise exception using errcode='23503',message='wallet_not_found_in_school'; end if;
  if before_status=p_status then return; end if;
  update public.student_wallets set status=p_status where id=p_wallet_id;
  perform pikas_private.record_wallet_audit(actor_id,auth.uid(),'school_admin','school',p_account_id,p_school_id,null,
    'wallet_status_changed','student_wallets',p_wallet_id,jsonb_build_object('before_status',before_status,'status',p_status));
end $$;

create function public.post_manual_wallet_replenishment(p_wallet_id uuid,p_amount_minor bigint,
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

create function public.post_student_wallet_adjustment(p_wallet_id uuid,p_amount_minor bigint,p_reason_code text,
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
  if p_amount_minor>0 and p_amount_minor>9223372036854775807-v_balance then raise exception using errcode='22003',message='wallet_balance_overflow'; end if;
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

create function public.reconcile_student_wallet(p_wallet_id uuid)
returns table(wallet_id uuid,currency_code text,current_balance_minor bigint,ledger_balance_minor bigint,
  balance_version bigint,is_reconciled boolean)
language plpgsql stable security definer set search_path = '' as $$
declare a uuid; s uuid; current_balance bigint; current_version bigint; ledger_total bigint;
begin
  select w.account_id,w.school_id,w.current_balance_minor,w.balance_version into a,s,current_balance,current_version
    from public.student_wallets w where w.id=p_wallet_id;
  if not found or not pikas_private.has_capability('school:wallets:read',a,s) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  select coalesce(sum(l.amount_minor),0)::bigint into ledger_total from public.wallet_ledger_entries l where l.wallet_id=p_wallet_id;
  return query select p_wallet_id,(select w.currency_code from public.student_wallets w where w.id=p_wallet_id),
    current_balance,ledger_total,current_version,current_balance=ledger_total;
end $$;

revoke all on function pikas_private.record_wallet_audit(uuid,uuid,text,text,uuid,uuid,uuid,text,text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function pikas_private.reject_wallet_history_mutation() from public,anon,authenticated,service_role;
revoke all on function pikas_private.assert_wallet_operation_ledger() from public,anon,authenticated,service_role;
revoke all on function pikas_private.guard_student_wallet_identity() from public,anon,authenticated,service_role;
revoke all on function pikas_private.guard_currency_metadata() from public,anon,authenticated,service_role;
revoke all on function public.create_student_wallet(uuid,uuid,uuid,text) from public,anon,service_role;
revoke all on function public.set_student_wallet_status(uuid,uuid,uuid,text) from public,anon,service_role;
revoke all on function public.post_manual_wallet_replenishment(uuid,bigint,text,text,text,uuid) from public,anon,service_role;
revoke all on function public.post_student_wallet_adjustment(uuid,bigint,text,text,text,text) from public,anon,service_role;
revoke all on function public.reconcile_student_wallet(uuid) from public,anon,service_role;
grant execute on function public.create_student_wallet(uuid,uuid,uuid,text),
  public.set_student_wallet_status(uuid,uuid,uuid,text),
  public.post_manual_wallet_replenishment(uuid,bigint,text,text,text,uuid),
  public.post_student_wallet_adjustment(uuid,bigint,text,text,text,text),
  public.reconcile_student_wallet(uuid) to authenticated;

comment on table public.student_wallets is 'School-scoped student prepaid wallet. Balance changes only through Phase 3A financial RPCs.';
comment on table public.wallet_ledger_entries is 'Immutable wallet value movements. Purchases and refunds are intentionally not implemented in Phase 3A.';
comment on table public.wallet_replenishments is 'Atomically verified and posted manual funding; no provider or pending-payment flow in Phase 3A.';
comment on table public.wallet_adjustments is 'Explicit authorized wallet corrections; not a raw balance edit API.';
comment on function public.reconcile_student_wallet(uuid) is 'Read-only school-authorized comparison of stored balance with immutable ledger total.';

commit;