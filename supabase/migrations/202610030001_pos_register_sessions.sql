-- Phase 4C: POS roles, registers, assignments, and durable register sessions.
begin;

insert into pikas_private.roles(scope_kind,role_code) values
  ('cafeteria','pos_cashier'),('cafeteria','pos_supervisor');
insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values
  ('cafeteria','pos_cashier','cafeteria:pos:catalog:read'),
  ('cafeteria','pos_cashier','cafeteria:customer:lookup'),
  ('cafeteria','pos_cashier','cafeteria:pos:session:open'),
  ('cafeteria','pos_cashier','cafeteria:pos:session:read_own'),
  ('cafeteria','pos_cashier','cafeteria:pos:session:close_own'),
  ('cafeteria','pos_supervisor','cafeteria:pos:catalog:read'),
  ('cafeteria','pos_supervisor','cafeteria:customer:lookup'),
  ('cafeteria','pos_supervisor','cafeteria:pos:session:open'),
  ('cafeteria','pos_supervisor','cafeteria:pos:session:read_own'),
  ('cafeteria','pos_supervisor','cafeteria:pos:session:close_own'),
  ('cafeteria','pos_supervisor','cafeteria:pos:sessions:read'),
  ('cafeteria','pos_supervisor','cafeteria:pos:session:exceptional_close'),
  ('cafeteria','cafeteria_admin','cafeteria:pos:memberships:manage'),
  ('cafeteria','cafeteria_admin','cafeteria:registers:manage'),
  ('cafeteria','cafeteria_admin','cafeteria:register_assignments:manage'),
  ('cafeteria','cafeteria_admin','cafeteria:pos:sessions:read'),
  ('cafeteria','cafeteria_admin','cafeteria:pos:session:exceptional_close');

-- Add composite keys for exact campus and cafeteria-membership FKs.
alter table public.cafeterias add constraint cafeterias_full_location_key
  unique(account_id,school_id,id,school_location_id);
alter table public.cafeteria_memberships add constraint cafeteria_memberships_pos_identity_key
  unique(account_id,school_id,cafeteria_id,id,person_id,role_code);
alter table public.cafeteria_memberships add constraint cafeteria_memberships_pos_person_key
  unique(account_id,school_id,cafeteria_id,id,person_id);

create table public.cafeteria_registers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  school_location_id uuid not null,
  cafeteria_id uuid not null,
  register_code text not null check (length(btrim(register_code)) between 1 and 32),
  code_key text generated always as (lower(btrim(register_code))) stored,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  status text not null default 'active' check (status in ('active','inactive')),
  version integer not null default 1 check (version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,school_location_id)
    references public.school_locations(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,school_location_id)
    references public.cafeterias(account_id,school_id,id,school_location_id) on delete restrict,
  unique (account_id,school_id,school_location_id,cafeteria_id,id),
  unique (cafeteria_id,code_key)
);
create index cafeteria_registers_status_idx
  on public.cafeteria_registers(account_id,school_id,cafeteria_id,status,code_key,id);

create table public.cafeteria_register_assignments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  school_location_id uuid not null,
  cafeteria_id uuid not null,
  cafeteria_membership_id uuid not null,
  operator_person_id uuid not null,
  register_id uuid not null,
  status text not null default 'active' check (status in ('active','inactive')),
  version integer not null default 1 check (version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,cafeteria_id,school_location_id)
    references public.cafeterias(account_id,school_id,id,school_location_id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,cafeteria_membership_id,operator_person_id)
    references public.cafeteria_memberships(account_id,school_id,cafeteria_id,id,person_id) on delete restrict,
  foreign key (account_id,school_id,school_location_id,cafeteria_id,register_id)
    references public.cafeteria_registers(account_id,school_id,school_location_id,cafeteria_id,id) on delete restrict,
  unique (cafeteria_membership_id,register_id),
  unique (account_id,school_id,school_location_id,cafeteria_id,id,
    cafeteria_membership_id,operator_person_id,register_id)
);
create index cafeteria_register_assignments_operator_idx
  on public.cafeteria_register_assignments(account_id,school_id,cafeteria_id,operator_person_id,status,register_id);
create index cafeteria_register_assignments_register_idx
  on public.cafeteria_register_assignments(account_id,school_id,cafeteria_id,register_id,status,operator_person_id);

create table public.register_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  school_location_id uuid not null,
  cafeteria_id uuid not null,
  register_id uuid not null,
  assignment_id uuid not null,
  operator_membership_id uuid not null,
  operator_person_id uuid not null references public.persons(id) on delete restrict,
  operator_role_code text not null check (operator_role_code in ('pos_cashier','pos_supervisor')),
  register_code_snapshot text not null,
  register_name_snapshot text not null,
  opened_at timestamptz not null,
  opened_business_date date not null,
  business_timezone_snapshot text not null,
  currency_code text not null references public.supported_currencies(currency_code) on delete restrict,
  opening_cash_minor bigint not null check (opening_cash_minor>=0),
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  closed_by_person_id uuid references public.persons(id) on delete restrict,
  counted_cash_minor bigint check (counted_cash_minor is null or counted_cash_minor>=0),
  close_type text check (close_type is null or close_type in ('normal','exceptional')),
  close_reason_code text check (close_reason_code is null or close_reason_code in (
    'operator_unavailable','operator_suspended','auth_access_lost','administrative_recovery','other')),
  close_note text check (close_note is null or length(btrim(close_note)) between 1 and 1000),
  open_request_key text not null check (length(open_request_key) between 16 and 128),
  open_payload_fingerprint text not null check (open_payload_fingerprint ~ '^[0-9a-f]{64}$'),
  close_request_key text check (close_request_key is null or length(close_request_key) between 16 and 128),
  close_payload_fingerprint text check (close_payload_fingerprint is null or close_payload_fingerprint ~ '^[0-9a-f]{64}$'),
  version integer not null default 1 check (version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,cafeteria_id,school_location_id)
    references public.cafeterias(account_id,school_id,id,school_location_id) on delete restrict,
  foreign key (account_id,school_id,school_location_id,cafeteria_id,register_id)
    references public.cafeteria_registers(account_id,school_id,school_location_id,cafeteria_id,id) on delete restrict,
  foreign key (account_id,school_id,school_location_id,cafeteria_id,assignment_id,
    operator_membership_id,operator_person_id,register_id)
    references public.cafeteria_register_assignments(account_id,school_id,school_location_id,cafeteria_id,
      id,cafeteria_membership_id,operator_person_id,register_id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,operator_membership_id,operator_person_id,operator_role_code)
    references public.cafeteria_memberships(account_id,school_id,cafeteria_id,id,person_id,role_code) on delete restrict,
  check (opened_business_date=(opened_at at time zone business_timezone_snapshot)::date),
  check (closed_at is null or closed_at>=opened_at),
  check ((status='open' and closed_at is null and closed_by_person_id is null and counted_cash_minor is null
      and close_type is null and close_reason_code is null and close_note is null
      and close_request_key is null and close_payload_fingerprint is null)
    or (status='closed' and closed_at is not null and closed_by_person_id is not null and counted_cash_minor is not null
      and close_type is not null and close_request_key is not null and close_payload_fingerprint is not null)),
  check ((close_type is null and close_reason_code is null)
    or (close_type='normal' and close_reason_code is null)
    or (close_type='exceptional' and close_reason_code is not null)),
  check (close_type<>'normal' or closed_by_person_id=operator_person_id),
  check (close_type<>'exceptional' or closed_by_person_id<>operator_person_id),
  check (close_reason_code<>'other' or close_note is not null)
);
create unique index register_sessions_one_open_per_register
  on public.register_sessions(register_id) where status='open';
create unique index register_sessions_one_open_per_person
  on public.register_sessions(operator_person_id) where status='open';
create unique index register_sessions_open_request_idx
  on public.register_sessions(account_id,open_request_key);
create unique index register_sessions_close_request_idx
  on public.register_sessions(account_id,close_request_key) where close_request_key is not null;
create index register_sessions_cafeteria_opened_idx
  on public.register_sessions(account_id,school_id,cafeteria_id,opened_at desc,id);
create index register_sessions_operator_status_idx
  on public.register_sessions(operator_person_id,status,opened_at desc);
create index register_sessions_register_status_idx
  on public.register_sessions(register_id,status,opened_at desc);

do $$
declare t text;
begin
  foreach t in array array['cafeteria_registers','cafeteria_register_assignments','register_sessions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create function pikas_private.lock_active_cafeteria_scope(p_cafeteria_id uuid)
returns table(account_id uuid,school_id uuid,school_location_id uuid,business_timezone text)
language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; l uuid;
begin
  select ca.account_id,ca.school_id,ca.school_location_id into a,s,l
    from public.cafeterias ca where ca.id=p_cafeteria_id;
  if not found then return; end if;
  perform 1 from public.accounts ac where ac.id=a and ac.status='active' for share;
  if not found then return; end if;
  perform 1 from public.schools sc where sc.id=s and sc.account_id=a and sc.status='active' for share;
  if not found then return; end if;
  perform 1 from public.school_locations sl where sl.id=l and sl.account_id=a and sl.school_id=s and sl.status='active' for share;
  if not found then return; end if;
  return query select ca.account_id,ca.school_id,ca.school_location_id,sc.business_timezone
    from public.cafeterias ca join public.schools sc on sc.account_id=ca.account_id and sc.id=ca.school_id
    where ca.id=p_cafeteria_id and ca.account_id=a and ca.school_id=s and ca.school_location_id=l
      and ca.status='active' and sc.status='active' for share of ca;
end $$;

create function pikas_private.pos_register_operator_can_read(
  p_account_id uuid,p_school_id uuid,p_cafeteria_id uuid,p_register_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cafeteria_register_assignments ra
      join public.cafeteria_memberships m on m.account_id=ra.account_id and m.school_id=ra.school_id
        and m.cafeteria_id=ra.cafeteria_id and m.id=ra.cafeteria_membership_id
        and m.person_id=ra.operator_person_id and m.status='active'
      join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
      join public.cafeteria_registers r on r.account_id=ra.account_id and r.school_id=ra.school_id
        and r.school_location_id=ra.school_location_id and r.cafeteria_id=ra.cafeteria_id and r.id=ra.register_id
      where ra.account_id=p_account_id and ra.school_id=p_school_id and ra.cafeteria_id=p_cafeteria_id
        and ra.register_id=p_register_id and ra.status='active' and r.status='active'
        and ra.operator_person_id=pikas_private.current_person_id()
        and rc.capability='cafeteria:pos:session:open')
$$;

create function pikas_private.is_pos_operator_membership(p_membership_id uuid,p_person_id uuid,
  p_account_id uuid,p_school_id uuid,p_cafeteria_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cafeteria_memberships m
    join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
    where m.id=p_membership_id and m.person_id=p_person_id and m.account_id=p_account_id
      and m.school_id=p_school_id and m.cafeteria_id=p_cafeteria_id and m.status='active'
      and p_person_id=pikas_private.current_person_id() and rc.capability=p_capability)
$$;

grant select on public.cafeteria_registers,public.cafeteria_register_assignments to authenticated;
create policy cafeteria_registers_read on public.cafeteria_registers for select to authenticated
using (pikas_private.has_capability('cafeteria:registers:manage',account_id,school_id,cafeteria_id)
  or pikas_private.pos_register_operator_can_read(account_id,school_id,cafeteria_id,id));
create policy cafeteria_register_assignments_read on public.cafeteria_register_assignments for select to authenticated
using (pikas_private.has_capability('cafeteria:register_assignments:manage',account_id,school_id,cafeteria_id)
  or pikas_private.is_pos_operator_membership(cafeteria_membership_id,
    (select pikas_private.current_person_id()),account_id,school_id,cafeteria_id,'cafeteria:pos:session:open'));
create function pikas_private.record_pos_operational_audit(
  p_actor_person_id uuid,p_actor_auth_id uuid,p_actor_role text,p_account_id uuid,p_school_id uuid,p_cafeteria_id uuid,
  p_action text,p_target_type text,p_target_id uuid,p_before jsonb default '{}'::jsonb,p_after jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,
    account_id,school_id,cafeteria_id,action,target_type,target_id,outcome,before_metadata,after_metadata)
  values(p_actor_person_id,p_actor_auth_id,p_actor_role,'cafeteria',p_account_id,p_school_id,p_cafeteria_id,
    p_action,p_target_type,p_target_id,'succeeded',coalesce(p_before,'{}'::jsonb),coalesce(p_after,'{}'::jsonb));
end $$;

create function pikas_private.guard_cafeteria_register() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.id is distinct from new.id or old.account_id is distinct from new.account_id
      or old.school_id is distinct from new.school_id or old.school_location_id is distinct from new.school_location_id
      or old.cafeteria_id is distinct from new.cafeteria_id or old.created_at is distinct from new.created_at then
    raise exception using errcode='23514',message='register_identity_or_scope_is_immutable';
  end if;
  if old.register_code is distinct from new.register_code
      and exists(select 1 from public.register_sessions s where s.register_id=old.id) then
    raise exception using errcode='23514',message='register_code_immutable_after_session_history';
  end if;
  if new.version<>old.version+1 then raise exception using errcode='23514',message='register_version_must_increment_once'; end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;

create function pikas_private.guard_cafeteria_register_assignment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.id is distinct from new.id or old.account_id is distinct from new.account_id
      or old.school_id is distinct from new.school_id or old.school_location_id is distinct from new.school_location_id
      or old.cafeteria_id is distinct from new.cafeteria_id or old.cafeteria_membership_id is distinct from new.cafeteria_membership_id
      or old.operator_person_id is distinct from new.operator_person_id or old.register_id is distinct from new.register_id
      or old.created_at is distinct from new.created_at then
    raise exception using errcode='23514',message='register_assignment_identity_or_scope_is_immutable';
  end if;
  if new.version<>old.version+1 then raise exception using errcode='23514',message='register_assignment_version_must_increment_once'; end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;

create function pikas_private.guard_register_session_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status='closed' then raise exception using errcode='23514',message='closed_register_session_is_immutable'; end if;
  if old.id is distinct from new.id or old.account_id is distinct from new.account_id
      or old.school_id is distinct from new.school_id or old.school_location_id is distinct from new.school_location_id
      or old.cafeteria_id is distinct from new.cafeteria_id or old.register_id is distinct from new.register_id
      or old.assignment_id is distinct from new.assignment_id or old.operator_membership_id is distinct from new.operator_membership_id
      or old.operator_person_id is distinct from new.operator_person_id or old.operator_role_code is distinct from new.operator_role_code
      or old.register_code_snapshot is distinct from new.register_code_snapshot or old.register_name_snapshot is distinct from new.register_name_snapshot
      or old.opened_at is distinct from new.opened_at or old.opened_business_date is distinct from new.opened_business_date
      or old.business_timezone_snapshot is distinct from new.business_timezone_snapshot or old.currency_code is distinct from new.currency_code
      or old.opening_cash_minor is distinct from new.opening_cash_minor or old.open_request_key is distinct from new.open_request_key
      or old.open_payload_fingerprint is distinct from new.open_payload_fingerprint or old.created_at is distinct from new.created_at
      or new.status<>'closed' or new.version<>old.version+1 or new.closed_at is null
      or new.closed_by_person_id is null or new.counted_cash_minor is null or new.close_type is null
      or new.close_request_key is null or new.close_payload_fingerprint is null then
    raise exception using errcode='23514',message='register_session_only_allows_one_closed_transition';
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;

create function pikas_private.reject_pos_history_delete() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception using errcode='23514',message='pos_register_history_is_preserved'; end $$;

create trigger cafeteria_register_guard before update on public.cafeteria_registers
for each row execute function pikas_private.guard_cafeteria_register();
create trigger cafeteria_register_no_delete before delete on public.cafeteria_registers
for each row execute function pikas_private.reject_pos_history_delete();
create trigger cafeteria_register_assignment_guard before update on public.cafeteria_register_assignments
for each row execute function pikas_private.guard_cafeteria_register_assignment();
create trigger cafeteria_register_assignment_no_delete before delete on public.cafeteria_register_assignments
for each row execute function pikas_private.reject_pos_history_delete();
create trigger register_session_guard before update on public.register_sessions
for each row execute function pikas_private.guard_register_session_update();
create trigger register_session_no_delete before delete on public.register_sessions
for each row execute function pikas_private.reject_pos_history_delete();

create function public.set_cafeteria_pos_membership(
  p_cafeteria_id uuid,p_person_id uuid,p_role_code text,p_status text)
returns table(membership_id uuid,status text)
language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; actor uuid; target_auth uuid; target_status text; member_id uuid; old_status text;
begin
  actor:=pikas_private.current_person_id();
  select x.account_id,x.school_id into a,s from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id) x;
  if actor is null or a is null or not pikas_private.has_capability('cafeteria:pos:memberships:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_role_code is null or p_role_code not in ('pos_cashier','pos_supervisor')
      or p_status is null or p_status not in ('active','suspended','inactive') or p_person_id is null then
    raise exception using errcode='22023',message='invalid_pos_membership_role_or_status';
  end if;
  select p.auth_user_id,p.status into target_auth,target_status from public.persons p where p.id=p_person_id;
  if not found then raise exception using errcode='23503',message='person_not_found'; end if;
  if p_status<>'inactive' and (target_auth is null or target_status<>'active') then
    raise exception using errcode='23514',message='active_auth_linked_person_required_for_pos_role';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_cafeteria_id::text||':'||p_person_id::text||':'||p_role_code,20261005));
  select m.id,m.status into member_id,old_status from public.cafeteria_memberships m
    where m.account_id=a and m.school_id=s and m.cafeteria_id=p_cafeteria_id
      and m.person_id=p_person_id and m.role_code=p_role_code for update;
  if not found then
    if p_status='inactive' then raise exception using errcode='23503',message='pos_membership_not_found'; end if;
    insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
    values(a,s,p_cafeteria_id,p_person_id,p_role_code,p_status) returning id into member_id;
    perform pikas_private.record_pos_operational_audit(actor,auth.uid(),'cafeteria_admin',a,s,p_cafeteria_id,
      'pos_membership_granted','cafeteria_memberships',member_id,'{}'::jsonb,
      jsonb_build_object('role_code',p_role_code,'status',p_status));
  elsif old_status is distinct from p_status then
    update public.cafeteria_memberships m set status=p_status where m.id=member_id;
    perform pikas_private.record_pos_operational_audit(actor,auth.uid(),'cafeteria_admin',a,s,p_cafeteria_id,
      case when p_status='inactive' then 'pos_membership_revoked' else 'pos_membership_status_changed' end,
      'cafeteria_memberships',member_id,jsonb_build_object('role_code',p_role_code,'status',old_status),
      jsonb_build_object('role_code',p_role_code,'status',p_status));
  end if;
  return query select member_id,p_status;
end $$;

create function public.create_cafeteria_register(
  p_cafeteria_id uuid,p_register_id uuid,p_register_code text,p_display_name text)
returns table(register_id uuid,register_version integer)
language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; l uuid; actor uuid; code text; label text; existing public.cafeteria_registers%rowtype;
begin
  actor:=pikas_private.current_person_id();
  select x.account_id,x.school_id,x.school_location_id into a,s,l
    from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id) x;
  if actor is null or a is null or not pikas_private.has_capability('cafeteria:registers:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  code:=nullif(btrim(p_register_code),''); label:=nullif(btrim(p_display_name),'');
  if p_register_id is null or code is null or length(code)>32 or label is null or length(label)>120 then
    raise exception using errcode='22023',message='invalid_cafeteria_register';
  end if;
  insert into public.cafeteria_registers(id,account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
  values(p_register_id,a,s,l,p_cafeteria_id,code,label)
  on conflict(id) do nothing returning id,version into register_id,register_version;
  if found then
    perform pikas_private.record_pos_operational_audit(actor,auth.uid(),'cafeteria_admin',a,s,p_cafeteria_id,
      'register_created','cafeteria_registers',register_id,'{}'::jsonb,
      jsonb_build_object('register_code',code,'display_name',label,'status','active'));
    return next; return;
  end if;
  select r.* into existing from public.cafeteria_registers r
    where r.id=p_register_id and r.account_id=a and r.school_id=s and r.cafeteria_id=p_cafeteria_id;
  if not found or existing.register_code<>code or existing.display_name<>label or existing.status<>'active' then
    raise exception using errcode='23505',message='register_request_id_reused_with_different_payload';
  end if;
  return query select existing.id,existing.version;
end $$;

create function public.update_cafeteria_register(
  p_cafeteria_id uuid,p_register_id uuid,p_expected_version integer,
  p_register_code text,p_display_name text,p_status text)
returns integer language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; actor uuid; code text; label text; current_register public.cafeteria_registers%rowtype; updated_version integer;
begin
  actor:=pikas_private.current_person_id();
  select x.account_id,x.school_id into a,s from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id) x;
  if actor is null or a is null or not pikas_private.has_capability('cafeteria:registers:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  code:=nullif(btrim(p_register_code),''); label:=nullif(btrim(p_display_name),'');
  if code is null or length(code)>32 or label is null or length(label)>120
      or p_status is null or p_status not in ('active','inactive') then
    raise exception using errcode='22023',message='invalid_cafeteria_register';
  end if;
  select r.* into current_register from public.cafeteria_registers r
    where r.id=p_register_id and r.account_id=a and r.school_id=s and r.cafeteria_id=p_cafeteria_id for update;
  if not found then raise exception using errcode='23503',message='register_not_found_in_cafeteria'; end if;
  if p_expected_version is null or current_register.version<>p_expected_version then
    raise exception using errcode='40001',message='stale_cafeteria_register_version';
  end if;
  if current_register.register_code<>code and exists(select 1 from public.register_sessions rs where rs.register_id=p_register_id) then
    raise exception using errcode='23514',message='register_code_immutable_after_session_history';
  end if;
  update public.cafeteria_registers r set register_code=code,display_name=label,status=p_status,version=r.version+1
    where r.id=p_register_id returning r.version into updated_version;
  perform pikas_private.record_pos_operational_audit(actor,auth.uid(),'cafeteria_admin',a,s,p_cafeteria_id,
    case when current_register.status<>p_status then 'register_status_changed' else 'register_updated' end,
    'cafeteria_registers',p_register_id,
    jsonb_build_object('register_code',current_register.register_code,'display_name',current_register.display_name,'status',current_register.status),
    jsonb_build_object('register_code',code,'display_name',label,'status',p_status));
  return updated_version;
end $$;

create function public.create_cafeteria_register_assignment(
  p_cafeteria_id uuid,p_assignment_id uuid,p_cafeteria_membership_id uuid,p_register_id uuid)
returns table(assignment_id uuid,assignment_version integer)
language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; l uuid; actor uuid; target_person_id uuid; role_value text;
  existing public.cafeteria_register_assignments%rowtype; register_status text;
begin
  actor:=pikas_private.current_person_id();
  select x.account_id,x.school_id,x.school_location_id into a,s,l
    from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id) x;
  if actor is null or a is null or not pikas_private.has_capability('cafeteria:register_assignments:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_assignment_id is null or p_cafeteria_membership_id is null or p_register_id is null then
    raise exception using errcode='22023',message='register_assignment_required_fields';
  end if;
  select m.person_id,m.role_code into target_person_id,role_value from public.cafeteria_memberships m
    where m.id=p_cafeteria_membership_id and m.account_id=a and m.school_id=s
      and m.cafeteria_id=p_cafeteria_id and m.status='active';
  if not found or not exists(select 1 from pikas_private.role_capabilities rc
      where rc.scope_kind='cafeteria' and rc.role_code=role_value and rc.capability='cafeteria:pos:session:open') then
    raise exception using errcode='23503',message='active_pos_membership_required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_person_id::text,20261005));
  select r.status into register_status from public.cafeteria_registers r
    where r.id=p_register_id and r.account_id=a and r.school_id=s and r.school_location_id=l
      and r.cafeteria_id=p_cafeteria_id for update;
  if not found or register_status<>'active' then raise exception using errcode='23503',message='active_register_required'; end if;
  perform 1 from public.cafeteria_memberships m where m.id=p_cafeteria_membership_id
    and m.account_id=a and m.school_id=s and m.cafeteria_id=p_cafeteria_id
    and m.person_id=target_person_id and m.role_code=role_value and m.status='active' for share;
  if not found then raise exception using errcode='42501',message='active_pos_membership_required'; end if;
  insert into public.cafeteria_register_assignments(id,account_id,school_id,school_location_id,cafeteria_id,
    cafeteria_membership_id,operator_person_id,register_id)
  values(p_assignment_id,a,s,l,p_cafeteria_id,p_cafeteria_membership_id,target_person_id,p_register_id)
  on conflict(cafeteria_membership_id,register_id) do nothing returning id,version into assignment_id,assignment_version;
  if found then
    perform pikas_private.record_pos_operational_audit(actor,auth.uid(),'cafeteria_admin',a,s,p_cafeteria_id,
      'register_assignment_created','cafeteria_register_assignments',assignment_id,'{}'::jsonb,
      jsonb_build_object('operator_person_id',target_person_id,'register_id',p_register_id,'status','active'));
    return next; return;
  end if;
  select ra.* into existing from public.cafeteria_register_assignments ra
    where ra.cafeteria_membership_id=p_cafeteria_membership_id and ra.register_id=p_register_id;
  if not found or existing.id<>p_assignment_id or existing.status<>'active' then
    raise exception using errcode='23505',message='register_assignment_already_exists_or_request_id_changed';
  end if;
  return query select existing.id,existing.version;
end $$;

create function public.update_cafeteria_register_assignment(
  p_cafeteria_id uuid,p_assignment_id uuid,p_expected_version integer,p_status text)
returns integer language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; actor uuid; target_person uuid; register_id_value uuid;
  current_assignment public.cafeteria_register_assignments%rowtype; member_status text; role_value text; register_status text; updated_version integer;
begin
  actor:=pikas_private.current_person_id();
  select x.account_id,x.school_id into a,s from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id) x;
  if actor is null or a is null or not pikas_private.has_capability('cafeteria:register_assignments:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_status is null or p_status not in ('active','inactive') then raise exception using errcode='22023',message='invalid_assignment_status'; end if;
  select ra.operator_person_id,ra.register_id into target_person,register_id_value
    from public.cafeteria_register_assignments ra where ra.id=p_assignment_id
      and ra.account_id=a and ra.school_id=s and ra.cafeteria_id=p_cafeteria_id;
  if not found then raise exception using errcode='23503',message='register_assignment_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_person::text,20261005));
  perform 1 from public.cafeteria_registers r where r.id=register_id_value for update;
  select ra.* into current_assignment from public.cafeteria_register_assignments ra
    where ra.id=p_assignment_id and ra.account_id=a and ra.school_id=s and ra.cafeteria_id=p_cafeteria_id for update;
  if not found then raise exception using errcode='23503',message='register_assignment_not_found'; end if;
  if p_expected_version is null or current_assignment.version<>p_expected_version then
    raise exception using errcode='40001',message='stale_register_assignment_version';
  end if;
  if p_status='active' then
    select m.status,m.role_code into member_status,role_value from public.cafeteria_memberships m
      where m.id=current_assignment.cafeteria_membership_id and m.person_id=current_assignment.operator_person_id;
    select r.status into register_status from public.cafeteria_registers r where r.id=register_id_value;
    if member_status<>'active'
        or register_status<>'active' or not exists(select 1 from pikas_private.role_capabilities rc
          where rc.scope_kind='cafeteria' and rc.role_code=role_value and rc.capability='cafeteria:pos:session:open') then
      raise exception using errcode='23514',message='active_pos_membership_and_register_required';
    end if;
  end if;
  if current_assignment.status=p_status then return current_assignment.version; end if;
  update public.cafeteria_register_assignments ra set status=p_status,version=ra.version+1
    where ra.id=p_assignment_id returning ra.version into updated_version;
  perform pikas_private.record_pos_operational_audit(actor,auth.uid(),'cafeteria_admin',a,s,p_cafeteria_id,
    case when p_status='active' then 'register_assignment_activated' else 'register_assignment_deactivated' end,
    'cafeteria_register_assignments',p_assignment_id,
    jsonb_build_object('status',current_assignment.status),jsonb_build_object('status',p_status));
  return updated_version;
end $$;

create function public.list_my_operable_registers()
returns table(cafeteria_id uuid,register_id uuid,assignment_id uuid,register_code text,display_name text,
  register_version integer,assignment_version integer)
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid;
begin
  actor:=pikas_private.current_person_id();
  if actor is null then raise exception using errcode='42501',message='not_authorized'; end if;
  return query select r.cafeteria_id,r.id,ra.id,r.register_code,r.display_name,r.version,ra.version
    from public.cafeteria_register_assignments ra
    join public.cafeteria_registers r on r.account_id=ra.account_id and r.school_id=ra.school_id
      and r.school_location_id=ra.school_location_id and r.cafeteria_id=ra.cafeteria_id and r.id=ra.register_id
    join public.cafeterias c on c.account_id=r.account_id and c.school_id=r.school_id and c.id=r.cafeteria_id
    join public.schools s on s.account_id=c.account_id and s.id=c.school_id and s.status='active'
    join public.school_locations l on l.account_id=c.account_id and l.school_id=c.school_id
      and l.id=c.school_location_id and l.status='active'
    join public.accounts a on a.id=c.account_id and a.status='active'
    where ra.operator_person_id=actor and ra.status='active' and r.status='active' and c.status='active'
      and pikas_private.is_pos_operator_membership(ra.cafeteria_membership_id,actor,
        ra.account_id,ra.school_id,ra.cafeteria_id,'cafeteria:pos:session:open');
end $$;

create function public.open_register_session(p_register_id uuid,p_assignment_id uuid,
  p_opening_cash_minor bigint,p_open_request_key text)
returns table(session_id uuid,status text,opened_at timestamptz,currency_code text,version integer)
language plpgsql security definer set search_path = '' as $$
declare actor uuid; a uuid; s uuid; l uuid; c uuid; zone text; scope_row record;
  register_row public.cafeteria_registers%rowtype; assignment_row public.cafeteria_register_assignments%rowtype;
  membership_id uuid; role_value text; currency text; existing public.register_sessions%rowtype;
  fingerprint text; now_value timestamptz; new_id uuid;
begin
  actor:=pikas_private.current_person_id();
  if actor is null then raise exception using errcode='42501',message='not_authorized'; end if;
  if p_opening_cash_minor is null or p_opening_cash_minor<0 then raise exception using errcode='22023',message='invalid_opening_cash'; end if;
  if p_open_request_key is null or length(p_open_request_key) not between 16 and 128 then
    raise exception using errcode='22023',message='invalid_open_request_key';
  end if;
  select r.account_id,r.school_id,r.school_location_id,r.cafeteria_id into a,s,l,c
    from public.cafeteria_registers r where r.id=p_register_id;
  if not found then raise exception using errcode='23503',message='register_not_found'; end if;
  select * into scope_row from pikas_private.lock_active_cafeteria_scope(c);
  if not found or scope_row.account_id<>a or scope_row.school_id<>s or scope_row.school_location_id<>l then
    raise exception using errcode='42501',message='inactive_cafeteria_scope';
  end if;
  zone:=scope_row.business_timezone;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261005));
  select r.* into register_row from public.cafeteria_registers r
    where r.id=p_register_id and r.account_id=a and r.school_id=s and r.school_location_id=l
      and r.cafeteria_id=c for update;
  if not found or register_row.status<>'active' then raise exception using errcode='23514',message='active_register_required'; end if;
  select ra.* into assignment_row from public.cafeteria_register_assignments ra
    where ra.id=p_assignment_id and ra.account_id=a and ra.school_id=s and ra.school_location_id=l
      and ra.cafeteria_id=c and ra.register_id=p_register_id and ra.operator_person_id=actor
      and ra.status='active' for update;
  if not found then raise exception using errcode='42501',message='active_exact_register_assignment_required'; end if;
  select m.id,m.role_code into membership_id,role_value from public.cafeteria_memberships m
    where m.id=assignment_row.cafeteria_membership_id and m.account_id=a and m.school_id=s
      and m.cafeteria_id=c and m.person_id=actor and m.status='active'
      for share;
  if not found or not pikas_private.is_pos_operator_membership(membership_id,actor,a,s,c,'cafeteria:pos:session:open') then
    raise exception using errcode='42501',message='active_pos_session_open_capability_required';
  end if;
  select os.catalog_currency_code into currency from public.cafeteria_operation_settings os
    join public.supported_currencies cu on cu.currency_code=os.catalog_currency_code and cu.status='enabled'
    where os.account_id=a and os.school_id=s and os.cafeteria_id=c;
  if currency is null then raise exception using errcode='23514',message='enabled_cafeteria_currency_required'; end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('operator_person_id',actor,
    'operator_membership_id',membership_id,'assignment_id',assignment_row.id,'cafeteria_id',c,
    'register_id',p_register_id,'currency_code',currency,'opening_cash_minor',p_opening_cash_minor)::text,'UTF8'),'sha256'),'hex');
  select rs.* into existing from public.register_sessions rs
    where rs.account_id=a and rs.open_request_key=p_open_request_key for update;
  if found then
    if existing.operator_person_id<>actor or existing.open_payload_fingerprint<>fingerprint then
      raise exception using errcode='23505',message='open_request_key_reused_with_different_payload';
    end if;
    return query select existing.id,existing.status,existing.opened_at,existing.currency_code,existing.version; return;
  end if;
  if exists(select 1 from public.register_sessions rs where rs.register_id=p_register_id and rs.status='open') then
    raise exception using errcode='23505',message='register_already_has_open_session';
  end if;
  if exists(select 1 from public.register_sessions rs where rs.operator_person_id=actor and rs.status='open') then
    raise exception using errcode='23505',message='operator_already_has_open_session';
  end if;
  now_value:=clock_timestamp();
  insert into public.register_sessions(account_id,school_id,school_location_id,cafeteria_id,register_id,
    assignment_id,operator_membership_id,operator_person_id,operator_role_code,register_code_snapshot,
    register_name_snapshot,opened_at,opened_business_date,business_timezone_snapshot,currency_code,
    opening_cash_minor,status,open_request_key,open_payload_fingerprint)
  values(a,s,l,c,p_register_id,assignment_row.id,membership_id,actor,role_value,register_row.register_code,
    register_row.display_name,now_value,(now_value at time zone zone)::date,zone,currency,p_opening_cash_minor,
    'open',p_open_request_key,fingerprint) returning id into new_id;
  perform pikas_private.record_pos_operational_audit(actor,auth.uid(),role_value,a,s,c,
    'register_session_opened','register_sessions',new_id,'{}'::jsonb,
    jsonb_build_object('register_id',p_register_id,'assignment_id',assignment_row.id,'currency_code',currency,
      'opened_business_date',(now_value at time zone zone)::date));
  return query select new_id,'open'::text,now_value,currency,1;
exception when unique_violation then
  raise exception using errcode='23505',message='register_or_operator_already_has_open_session';
end $$;

create function public.get_my_open_register_session()
returns table(session_id uuid,cafeteria_id uuid,register_id uuid,assignment_id uuid,
  register_code_snapshot text,register_name_snapshot text,opened_at timestamptz,opened_business_date date,
  business_timezone_snapshot text,currency_code text,opening_cash_minor bigint,status text,version integer)
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid;
begin
  actor:=pikas_private.current_person_id();
  if actor is null then raise exception using errcode='42501',message='not_authorized'; end if;
  return query select rs.id,rs.cafeteria_id,rs.register_id,rs.assignment_id,rs.register_code_snapshot,
    rs.register_name_snapshot,rs.opened_at,rs.opened_business_date,rs.business_timezone_snapshot,
    rs.currency_code,rs.opening_cash_minor,rs.status,rs.version
  from public.register_sessions rs where rs.operator_person_id=actor and rs.status='open';
end $$;

create function public.get_cafeteria_open_register_sessions(p_cafeteria_id uuid)
returns table(session_id uuid,register_id uuid,register_code_snapshot text,register_name_snapshot text,
  operator_person_id uuid,operator_membership_id uuid,opened_at timestamptz,opened_business_date date,
  currency_code text,opening_cash_minor bigint,version integer)
language plpgsql stable security definer set search_path = '' as $$
declare a uuid; s uuid;
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id;
  if not found or not pikas_private.has_capability('cafeteria:pos:sessions:read',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  return query select rs.id,rs.register_id,rs.register_code_snapshot,rs.register_name_snapshot,
    rs.operator_person_id,rs.operator_membership_id,rs.opened_at,rs.opened_business_date,
    rs.currency_code,rs.opening_cash_minor,rs.version
  from public.register_sessions rs where rs.account_id=a and rs.school_id=s
    and rs.cafeteria_id=p_cafeteria_id and rs.status='open' order by rs.opened_at,rs.id;
end $$;

create function public.close_my_register_session(p_session_id uuid,p_expected_version integer,
  p_counted_cash_minor bigint,p_close_request_key text)
returns table(session_id uuid,status text,closed_at timestamptz,counted_cash_minor bigint,close_type text,version integer)
language plpgsql security definer set search_path = '' as $$
declare actor uuid; session_operator uuid; register_id_value uuid; a uuid; s uuid; c uuid;
  existing public.register_sessions%rowtype; fingerprint text; now_value timestamptz;
begin
  actor:=pikas_private.current_person_id();
  if actor is null then raise exception using errcode='42501',message='not_authorized'; end if;
  if p_counted_cash_minor is null or p_counted_cash_minor<0 then raise exception using errcode='22023',message='invalid_counted_cash'; end if;
  if p_close_request_key is null or length(p_close_request_key) not between 16 and 128 then
    raise exception using errcode='22023',message='invalid_close_request_key';
  end if;
  select rs.operator_person_id,rs.register_id,rs.account_id,rs.school_id,rs.cafeteria_id
    into session_operator,register_id_value,a,s,c from public.register_sessions rs where rs.id=p_session_id;
  if not found or session_operator<>actor then raise exception using errcode='42501',message='session_owner_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(session_operator::text,20261005));
  perform 1 from public.cafeteria_registers r where r.id=register_id_value for update;
  select rs.* into existing from public.register_sessions rs where rs.id=p_session_id for update;
  if not found or existing.operator_person_id<>actor then raise exception using errcode='42501',message='session_owner_required'; end if;
  if p_expected_version is null then raise exception using errcode='40001',message='stale_register_session_version'; end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('session_id',p_session_id,
    'operator_person_id',actor,'close_type','normal','counted_cash_minor',p_counted_cash_minor)::text,'UTF8'),'sha256'),'hex');
  if existing.status='closed' then
    if p_expected_version=existing.version-1 and existing.close_request_key=p_close_request_key
        and existing.close_payload_fingerprint=fingerprint then
      return query select existing.id,existing.status,existing.closed_at,existing.counted_cash_minor,existing.close_type,existing.version; return;
    end if;
    raise exception using errcode='23505',message='register_session_already_closed';
  end if;
  if p_expected_version is null or existing.version<>p_expected_version then
    raise exception using errcode='40001',message='stale_register_session_version';
  end if;
  if exists(select 1 from public.register_sessions rs where rs.account_id=a and rs.close_request_key=p_close_request_key) then
    raise exception using errcode='23505',message='close_request_key_already_used';
  end if;
  now_value:=clock_timestamp();
  update public.register_sessions rs set status='closed',closed_at=now_value,closed_by_person_id=actor,
    counted_cash_minor=p_counted_cash_minor,close_type='normal',close_reason_code=null,close_note=null,
    close_request_key=p_close_request_key,close_payload_fingerprint=fingerprint,version=rs.version+1
    where rs.id=p_session_id;
  perform pikas_private.record_pos_operational_audit(actor,auth.uid(),existing.operator_role_code,a,s,c,
    'register_session_closed','register_sessions',p_session_id,
    jsonb_build_object('status','open','register_id',register_id_value),
    jsonb_build_object('status','closed','close_type','normal'));
  return query select p_session_id,'closed'::text,now_value,p_counted_cash_minor,'normal'::text,existing.version+1;
end $$;

create function public.exceptionally_close_register_session(p_session_id uuid,p_expected_version integer,
  p_counted_cash_minor bigint,p_reason_code text,p_note text,p_close_request_key text)
returns table(session_id uuid,status text,closed_at timestamptz,counted_cash_minor bigint,
  close_type text,close_reason_code text,closed_by_person_id uuid,version integer)
language plpgsql security definer set search_path = '' as $$
declare actor uuid; actor_role text; owner_person uuid; register_id_value uuid; a uuid; s uuid; c uuid;
  existing public.register_sessions%rowtype; fingerprint text; clean_note text; now_value timestamptz;
begin
  actor:=pikas_private.current_person_id();
  if actor is null then raise exception using errcode='42501',message='not_authorized'; end if;
  if p_counted_cash_minor is null or p_counted_cash_minor<0 then raise exception using errcode='22023',message='invalid_counted_cash'; end if;
  if p_reason_code is null or p_reason_code not in ('operator_unavailable','operator_suspended','auth_access_lost','administrative_recovery','other') then
    raise exception using errcode='22023',message='invalid_exceptional_close_reason';
  end if;
  clean_note:=nullif(btrim(p_note),'');
  if length(coalesce(clean_note,''))>1000 or (p_reason_code='other' and clean_note is null) then
    raise exception using errcode='22023',message='exceptional_close_note_required_or_too_long';
  end if;
  if p_close_request_key is null or length(p_close_request_key) not between 16 and 128 then
    raise exception using errcode='22023',message='invalid_close_request_key';
  end if;
  select rs.operator_person_id,rs.register_id,rs.account_id,rs.school_id,rs.cafeteria_id
    into owner_person,register_id_value,a,s,c from public.register_sessions rs where rs.id=p_session_id;
  if not found then raise exception using errcode='23503',message='register_session_not_found'; end if;
  if actor=owner_person then raise exception using errcode='42501',message='exceptional_close_is_recovery_only'; end if;
  -- Recovery deliberately does not call scope_active: it can close history in inactive tenant structures.
  select m.role_code into actor_role from public.cafeteria_memberships m
    join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
    where m.person_id=actor and m.account_id=a and m.school_id=s and m.cafeteria_id=c
      and m.status='active'
      and rc.capability='cafeteria:pos:session:exceptional_close';
  if not found then raise exception using errcode='42501',message='exceptional_close_capability_required'; end if;
  if owner_person<actor then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_person::text,20261005));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261005));
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261005));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_person::text,20261005));
  end if;
  select m.role_code into actor_role from public.cafeteria_memberships m
    join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
    where m.person_id=actor and m.account_id=a and m.school_id=s and m.cafeteria_id=c
      and m.status='active'
      and rc.capability='cafeteria:pos:session:exceptional_close' for share of m;
  if not found then raise exception using errcode='42501',message='exceptional_close_capability_required'; end if;
  perform 1 from public.cafeteria_registers r where r.id=register_id_value for update;
  select rs.* into existing from public.register_sessions rs where rs.id=p_session_id for update;
  if not found or existing.operator_person_id<>owner_person then raise exception using errcode='23503',message='register_session_not_found'; end if;
  if p_expected_version is null then raise exception using errcode='40001',message='stale_register_session_version'; end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('session_id',p_session_id,
    'recovery_actor_person_id',actor,'close_type','exceptional','counted_cash_minor',p_counted_cash_minor,
    'close_reason_code',p_reason_code,'close_note',clean_note)::text,'UTF8'),'sha256'),'hex');
  if existing.status='closed' then
    if p_expected_version=existing.version-1 and existing.close_request_key=p_close_request_key
        and existing.close_payload_fingerprint=fingerprint then
      return query select existing.id,existing.status,existing.closed_at,existing.counted_cash_minor,
        existing.close_type,existing.close_reason_code,existing.closed_by_person_id,existing.version; return;
    end if;
    raise exception using errcode='23505',message='register_session_already_closed';
  end if;
  if p_expected_version is null or existing.version<>p_expected_version then
    raise exception using errcode='40001',message='stale_register_session_version';
  end if;
  if exists(select 1 from public.register_sessions rs where rs.account_id=a and rs.close_request_key=p_close_request_key) then
    raise exception using errcode='23505',message='close_request_key_already_used';
  end if;
  now_value:=clock_timestamp();
  update public.register_sessions rs set status='closed',closed_at=now_value,closed_by_person_id=actor,
    counted_cash_minor=p_counted_cash_minor,close_type='exceptional',close_reason_code=p_reason_code,
    close_note=clean_note,close_request_key=p_close_request_key,close_payload_fingerprint=fingerprint,
    version=rs.version+1 where rs.id=p_session_id;
  perform pikas_private.record_pos_operational_audit(actor,auth.uid(),actor_role,a,s,c,
    'register_session_exceptionally_closed','register_sessions',p_session_id,
    jsonb_build_object('status','open','register_id',register_id_value,'operator_person_id',owner_person),
    jsonb_build_object('status','closed','close_type','exceptional','close_reason_code',p_reason_code));
  return query select p_session_id,'closed'::text,now_value,p_counted_cash_minor,'exceptional'::text,
    p_reason_code,actor,existing.version+1;
end $$;

revoke all on function pikas_private.lock_active_cafeteria_scope(uuid) from public,anon,authenticated,service_role;
revoke all on function pikas_private.pos_register_operator_can_read(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function pikas_private.record_pos_operational_audit(uuid,uuid,text,uuid,uuid,uuid,text,text,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function pikas_private.guard_cafeteria_register() from public,anon,authenticated,service_role;
revoke all on function pikas_private.guard_cafeteria_register_assignment() from public,anon,authenticated,service_role;
revoke all on function pikas_private.guard_register_session_update() from public,anon,authenticated,service_role;
revoke all on function pikas_private.reject_pos_history_delete() from public,anon,authenticated,service_role;
revoke all on function pikas_private.is_pos_operator_membership(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function pikas_private.pos_register_operator_can_read(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.set_cafeteria_pos_membership(uuid,uuid,text,text) from public,anon,service_role;
revoke all on function public.create_cafeteria_register(uuid,uuid,text,text) from public,anon,service_role;
revoke all on function public.update_cafeteria_register(uuid,uuid,integer,text,text,text) from public,anon,service_role;
revoke all on function public.create_cafeteria_register_assignment(uuid,uuid,uuid,uuid) from public,anon,service_role;
revoke all on function public.update_cafeteria_register_assignment(uuid,uuid,integer,text) from public,anon,service_role;
revoke all on function public.list_my_operable_registers() from public,anon,service_role;
revoke all on function public.open_register_session(uuid,uuid,bigint,text) from public,anon,service_role;
revoke all on function public.get_my_open_register_session() from public,anon,service_role;
revoke all on function public.get_cafeteria_open_register_sessions(uuid) from public,anon,service_role;
revoke all on function public.close_my_register_session(uuid,integer,bigint,text) from public,anon,service_role;
revoke all on function public.exceptionally_close_register_session(uuid,integer,bigint,text,text,text) from public,anon,service_role;
grant execute on function public.set_cafeteria_pos_membership(uuid,uuid,text,text),
  public.create_cafeteria_register(uuid,uuid,text,text),
  public.update_cafeteria_register(uuid,uuid,integer,text,text,text),
  public.create_cafeteria_register_assignment(uuid,uuid,uuid,uuid),
  public.update_cafeteria_register_assignment(uuid,uuid,integer,text),
  public.list_my_operable_registers(),
  public.open_register_session(uuid,uuid,bigint,text),
  public.get_my_open_register_session(),
  public.get_cafeteria_open_register_sessions(uuid),
  public.close_my_register_session(uuid,integer,bigint,text),
  public.exceptionally_close_register_session(uuid,integer,bigint,text,text,text) to authenticated;
grant execute on function pikas_private.is_pos_operator_membership(uuid,uuid,uuid,uuid,uuid,text) to authenticated;

create or replace function public.get_cafeteria_saleable_catalog(p_cafeteria_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a uuid; s uuid;
begin
  select ca.account_id,ca.school_id into a,s from public.cafeterias ca where ca.id=p_cafeteria_id;
  if not found or not (pikas_private.has_capability('cafeteria:catalog:read',a,s,p_cafeteria_id)
      or pikas_private.has_capability('cafeteria:pos:catalog:read',a,s,p_cafeteria_id)) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  return pikas_private.saleable_catalog_at(p_cafeteria_id,pg_catalog.now());
end $$;
revoke all on function public.get_cafeteria_saleable_catalog(uuid) from public,anon,service_role;
grant execute on function public.get_cafeteria_saleable_catalog(uuid) to authenticated;

comment on table public.cafeteria_registers is 'Logical cafeteria checkout endpoints; no device or printer binding.';
comment on table public.cafeteria_register_assignments is 'Explicit POS membership/register authorization; assignment alone grants no operational capability.';
comment on table public.register_sessions is 'Durable register custody session with immutable operator, opening cash, currency and local business-date snapshots; close is terminal.';

commit;