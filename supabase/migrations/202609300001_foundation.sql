-- PIKAS approved baseline 001. The incompatible legacy chain is archived outside migrations/.
-- Foundation only: no financial, student, cafeteria-operation or application writer RPCs.
begin;

create schema pikas_private;
revoke all on schema pikas_private from public, anon, authenticated, service_role;
grant usage on schema pikas_private to authenticated;
revoke create on schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema pikas_private revoke execute on functions from public, anon, authenticated, service_role;

create table pikas_private.roles (
  scope_kind text not null check (scope_kind in ('account','school','cafeteria')),
  role_code text not null,
  primary key (scope_kind, role_code)
);
create table pikas_private.role_capabilities (
  scope_kind text not null,
  role_code text not null,
  capability text not null,
  primary key (scope_kind, role_code, capability),
  foreign key (scope_kind, role_code) references pikas_private.roles on delete restrict
);
alter table pikas_private.roles enable row level security;
alter table pikas_private.role_capabilities enable row level security;
insert into pikas_private.roles values
  ('account','account_admin'), ('school','school_admin'),
  ('cafeteria','cafeteria_admin'), ('cafeteria','pos_operator');
-- POS is reserved, with no capabilities in this phase. Platform authority is not implemented.
insert into pikas_private.role_capabilities values
  ('account','account_admin','account:read'),
  ('account','account_admin','school:read'),
  ('account','account_admin','cafeteria:read'),
  ('account','account_admin','location:read'),
  ('account','account_admin','account:memberships:read'),
  ('account','account_admin','account:invitations:read'),
  ('account','account_admin','account:audit:read'),
  ('school','school_admin','school:read'),
  ('school','school_admin','cafeteria:read'),
  ('school','school_admin','location:read'),
  ('school','school_admin','school:memberships:read'),
  ('school','school_admin','school:invitations:read'),
  ('school','school_admin','school:audit:read'),
  ('cafeteria','cafeteria_admin','cafeteria:read'),
  ('cafeteria','cafeteria_admin','location:read'),
  ('cafeteria','cafeteria_admin','cafeteria:memberships:read'),
  ('cafeteria','cafeteria_admin','cafeteria:invitations:read'),
  ('cafeteria','cafeteria_admin','cafeteria:audit:read');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null check (length(btrim(code)) between 1 and 64),
  code_key text generated always as (lower(btrim(code))) stored unique,
  name text not null check (length(btrim(name)) between 1 and 200),
  status text not null default 'active' check (status in ('active','suspended','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts on delete restrict,
  code text not null check (length(btrim(code)) between 1 and 64),
  code_key text generated always as (lower(btrim(code))) stored,
  name text not null check (length(btrim(name)) between 1 and 200),
  business_timezone text not null default 'America/Santo_Domingo',
  status text not null default 'active' check (status in ('active','suspended','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (account_id, code_key), unique (account_id, id)
);
-- Locations are school campuses, not children of cafeterias.
create table public.school_locations (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, school_id uuid not null,
  code text not null check (length(btrim(code)) between 1 and 64),
  code_key text generated always as (lower(btrim(code))) stored,
  name text not null check (length(btrim(name)) between 1 and 200),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (account_id, school_id) references public.schools(account_id, id) on delete restrict,
  unique (school_id, code_key), unique (account_id, school_id, id)
);
create table public.cafeterias (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, school_id uuid not null,
  school_location_id uuid not null,
  code text not null check (length(btrim(code)) between 1 and 64),
  code_key text generated always as (lower(btrim(code))) stored,
  name text not null check (length(btrim(name)) between 1 and 200),
  status text not null default 'active' check (status in ('active','suspended','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (account_id, school_id, school_location_id) references public.school_locations(account_id, school_id, id) on delete restrict,
  unique (school_location_id, code_key), unique (account_id, school_id, id)
);
create table public.persons (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  status text not null default 'active' check (status in ('active','suspended','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.account_memberships (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts on delete restrict,
  person_id uuid not null references public.persons on delete restrict,
  scope_kind text generated always as ('account'::text) stored,
  role_code text not null,
  status text not null default 'active' check (status in ('active','suspended','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (scope_kind, role_code) references pikas_private.roles on delete restrict,
  unique (person_id, account_id, role_code)
);
create table public.school_memberships (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, school_id uuid not null,
  person_id uuid not null references public.persons on delete restrict,
  scope_kind text generated always as ('school'::text) stored,
  role_code text not null,
  status text not null default 'active' check (status in ('active','suspended','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (account_id, school_id) references public.schools(account_id, id) on delete restrict,
  foreign key (scope_kind, role_code) references pikas_private.roles on delete restrict,
  unique (person_id, school_id, role_code)
);
create table public.cafeteria_memberships (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, school_id uuid not null, cafeteria_id uuid not null,
  person_id uuid not null references public.persons on delete restrict,
  scope_kind text generated always as ('cafeteria'::text) stored,
  role_code text not null,
  status text not null default 'active' check (status in ('active','suspended','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (account_id, school_id, cafeteria_id) references public.cafeterias(account_id, school_id, id) on delete restrict,
  foreign key (scope_kind, role_code) references pikas_private.roles on delete restrict,
  unique (person_id, cafeteria_id, role_code)
);
create index account_memberships_scope_idx on public.account_memberships(account_id, status);
create index school_memberships_scope_idx on public.school_memberships(account_id, school_id, status);
create index cafeteria_memberships_scope_idx on public.cafeteria_memberships(account_id, school_id, cafeteria_id, status);
create index cafeterias_location_idx on public.cafeterias(account_id, school_id, school_location_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts on delete restrict,
  school_id uuid, cafeteria_id uuid,
  scope_kind text not null, role_code text not null,
  intended_email text not null check (length(btrim(intended_email)) between 3 and 254 and position('@' in intended_email) > 1),
  email_key text generated always as (lower(btrim(intended_email))) stored,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references public.persons on delete restrict,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','accepted','expired','revoked')),
  accepted_person_id uuid references public.persons on delete restrict, accepted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (account_id, school_id) references public.schools(account_id, id) on delete restrict,
  foreign key (account_id, school_id, cafeteria_id) references public.cafeterias(account_id, school_id, id) on delete restrict,
  foreign key (scope_kind, role_code) references pikas_private.roles on delete restrict,
  check ((scope_kind = 'account' and school_id is null and cafeteria_id is null)
      or (scope_kind = 'school' and school_id is not null and cafeteria_id is null)
      or (scope_kind = 'cafeteria' and school_id is not null and cafeteria_id is not null)),
  check (expires_at > created_at),
  check ((status = 'accepted' and accepted_person_id is not null and accepted_at is not null
          and accepted_at >= created_at and accepted_at < expires_at)
      or (status <> 'accepted' and accepted_person_id is null and accepted_at is null))
);
create index invitations_scope_idx on public.invitations(account_id, school_id, cafeteria_id, status);
create index invitations_inviter_idx on public.invitations(invited_by);
create index invitations_acceptor_idx on public.invitations(accepted_person_id);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_person_id uuid references public.persons on delete restrict,
  -- Historical Auth identifier, deliberately not an FK deleted along with auth.users.
  authenticated_user_id uuid,
  actor_role text not null, actor_scope_kind text not null check (actor_scope_kind in ('account','school','cafeteria','identity','system')),
  account_id uuid references public.accounts on delete restrict, school_id uuid, cafeteria_id uuid,
  action text not null check (length(action) between 1 and 100),
  target_type text not null check (length(target_type) between 1 and 100), target_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  request_id uuid, outcome text not null check (outcome in ('succeeded','denied','failed')),
  before_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(before_metadata) = 'object'),
  after_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(after_metadata) = 'object'),
  foreign key (account_id, school_id) references public.schools(account_id, id) on delete restrict,
  foreign key (account_id, school_id, cafeteria_id) references public.cafeterias(account_id, school_id, id) on delete restrict,
  check (school_id is null or account_id is not null),
  check (cafeteria_id is null or school_id is not null)
);
create index audit_scope_time_idx on public.audit_events(account_id, school_id, cafeteria_id, occurred_at desc);
create index audit_actor_idx on public.audit_events(actor_person_id);

-- No recursive RLS joins: these narrowly scoped helpers read as their trusted owner.
create function pikas_private.current_person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.persons p where p.auth_user_id = (select auth.uid()) and p.status = 'active'
$$;
create function pikas_private.scope_active(a uuid, s uuid default null, c uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.accounts ac
    where ac.id = a and ac.status = 'active'
      and (s is not null or c is null)
      and (s is null or exists (select 1 from public.schools sc where sc.id = s and sc.account_id = a and sc.status = 'active'))
      and (c is null or exists (
        select 1 from public.cafeterias ca
        join public.school_locations sl on sl.account_id = ca.account_id
          and sl.school_id = ca.school_id and sl.id = ca.school_location_id
        where ca.id = c and ca.account_id = a and ca.school_id = s
          and ca.status = 'active' and sl.status = 'active'
      ))
  )
$$;
create function pikas_private.has_capability(cap text, a uuid, s uuid default null, c uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select pikas_private.scope_active(a,s,c) and exists (
    select 1 from (
      select m.scope_kind, m.role_code from public.account_memberships m
        where m.person_id = pikas_private.current_person_id() and m.account_id = a and m.status = 'active'
      union all
      select m.scope_kind, m.role_code from public.school_memberships m
        where m.person_id = pikas_private.current_person_id() and m.account_id = a and m.school_id = s and m.status = 'active'
      union all
      select m.scope_kind, m.role_code from public.cafeteria_memberships m
        where m.person_id = pikas_private.current_person_id() and m.account_id = a and m.school_id = s and m.cafeteria_id = c and m.status = 'active'
    ) membership join pikas_private.role_capabilities rc using (scope_kind, role_code)
    where rc.capability = cap
  )
$$;

-- A cafeteria membership permits reading its parent campus metadata only.
-- It never grants school authority or access to another cafeteria on that campus.
create function pikas_private.can_read_school_location(a uuid, s uuid, l uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select pikas_private.scope_active(a,s) and exists (
    select 1 from public.school_locations sl
    where sl.account_id = a and sl.school_id = s and sl.id = l and sl.status = 'active'
      and (pikas_private.has_capability('location:read',a,s)
        or exists (select 1 from public.cafeterias ca
          where ca.account_id = a and ca.school_id = s and ca.school_location_id = l
            and pikas_private.has_capability('location:read',a,s,ca.id)))
  )
$$;

-- Tenant identity and creation times are immutable; moving scopes means a new record.
create function pikas_private.guard_identity() returns trigger
language plpgsql set search_path = '' as $$
declare key text;
begin
  foreach key in array array['id','account_id','school_id','school_location_id','cafeteria_id','person_id','created_at'] loop
    if to_jsonb(old)->key is distinct from to_jsonb(new)->key then
      raise exception using errcode = '23514', message = 'immutable_identity_or_scope';
    end if;
  end loop;
  new.updated_at := clock_timestamp();
  return new;
end $$;
create function pikas_private.validate_school_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.business_timezone) then
    raise exception using errcode = '23514', message = 'invalid_school_timezone';
  end if;
  return new;
end $$;
create trigger valid_school_timezone before insert or update on public.schools
for each row execute function pikas_private.validate_school_timezone();
create function pikas_private.reject_audit_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception using errcode = '23514', message = 'audit_events_are_append_only'; end $$;
create trigger audit_immutable before update or delete on public.audit_events
for each row execute function pikas_private.reject_audit_mutation();
create trigger audit_no_truncate before truncate on public.audit_events
for each statement execute function pikas_private.reject_audit_mutation();

-- Automatically captures selective foundation changes, not whole rows or invitation secrets.
-- Phase 1 provisioning is trusted database maintenance, not an application/service-role write API.
create function pikas_private.audit_foundation_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  n jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  r jsonb; a uuid; s uuid; c uuid; actor uuid;
begin
  r := case when tg_op = 'DELETE' then b else n end;
  a := (r->>'account_id')::uuid; s := (r->>'school_id')::uuid; c := (r->>'cafeteria_id')::uuid;
  if tg_table_name = 'accounts' then a := (r->>'id')::uuid; end if;
  if tg_table_name = 'schools' then s := (r->>'id')::uuid; end if;
  if tg_table_name = 'cafeterias' then c := (r->>'id')::uuid; end if;
  select id into actor from public.persons where auth_user_id = auth.uid();
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,
    account_id,school_id,cafeteria_id,action,target_type,target_id,outcome,before_metadata,after_metadata)
  values(actor,auth.uid(),'database_maintenance','system',a,s,c,
    lower(tg_op),tg_table_name,(r->>'id')::uuid,'succeeded',
    jsonb_strip_nulls(jsonb_build_object('status',b->'status','role_code',b->'role_code')),
    jsonb_strip_nulls(jsonb_build_object('status',n->'status','role_code',n->'role_code')));
  return coalesce(new,old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['accounts','schools','cafeterias','school_locations','persons',
    'account_memberships','school_memberships','cafeteria_memberships','invitations'] loop
    execute format('create trigger guard_identity before update on public.%I for each row execute function pikas_private.guard_identity()',t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function pikas_private.audit_foundation_change()',t);
  end loop;
  foreach t in array array['accounts','schools','cafeterias','school_locations','persons',
    'account_memberships','school_memberships','cafeteria_memberships','invitations','audit_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
  end loop;
end $$;
revoke all on all tables in schema pikas_private from public, anon, authenticated, service_role;
revoke all on all functions in schema pikas_private from public, anon, authenticated, service_role;
grant execute on function pikas_private.current_person_id(), pikas_private.scope_active(uuid,uuid,uuid),
  pikas_private.has_capability(text,uuid,uuid,uuid),
  pikas_private.can_read_school_location(uuid,uuid,uuid) to authenticated;
grant select on public.accounts, public.schools, public.cafeterias, public.school_locations,
  public.persons, public.account_memberships, public.school_memberships, public.cafeteria_memberships,
  public.audit_events to authenticated;
-- Column grants deliberately exclude token_hash; SELECT * is not an invitation API.
grant select(id,account_id,school_id,cafeteria_id,scope_kind,role_code,intended_email,email_key,
  invited_by,expires_at,status,accepted_person_id,accepted_at,created_at,updated_at) on public.invitations to authenticated;

create policy account_read on public.accounts for select to authenticated
using (pikas_private.has_capability('account:read',id));
create policy school_read on public.schools for select to authenticated
using (pikas_private.has_capability('school:read',account_id,id));
create policy cafeteria_read on public.cafeterias for select to authenticated
using (pikas_private.has_capability('cafeteria:read',account_id,school_id,id));
create policy location_read on public.school_locations for select to authenticated
using (pikas_private.can_read_school_location(account_id,school_id,id));
create policy person_self_read on public.persons for select to authenticated
using (id = (select pikas_private.current_person_id()));
create policy account_membership_read on public.account_memberships for select to authenticated
using (pikas_private.scope_active(account_id) and (person_id = (select pikas_private.current_person_id())
  or pikas_private.has_capability('account:memberships:read',account_id)));
create policy school_membership_read on public.school_memberships for select to authenticated
using (pikas_private.scope_active(account_id,school_id) and (person_id = (select pikas_private.current_person_id())
  or pikas_private.has_capability('school:memberships:read',account_id,school_id)));
create policy cafeteria_membership_read on public.cafeteria_memberships for select to authenticated
using (pikas_private.scope_active(account_id,school_id,cafeteria_id) and (person_id = (select pikas_private.current_person_id())
  or pikas_private.has_capability('cafeteria:memberships:read',account_id,school_id,cafeteria_id)));
create policy invitation_read on public.invitations for select to authenticated
using (pikas_private.has_capability(scope_kind || ':invitations:read',account_id,school_id,cafeteria_id));
create policy audit_read on public.audit_events for select to authenticated
using (pikas_private.has_capability(
  case when cafeteria_id is not null then 'cafeteria:audit:read'
       when school_id is not null then 'school:audit:read' else 'account:audit:read' end,
  account_id,school_id,cafeteria_id));

comment on table public.persons is 'Stable PIKAS identity; optional Auth linkage is not a global application role.';
comment on table public.invitations is 'Pending access only. Token is SHA-256 of a high-entropy random secret. No acceptance or delivery API in Phase 1.';
comment on table public.audit_events is 'Scoped administrative evidence, not a financial ledger. Identity-only maintenance events are not customer-readable.';
commit;
