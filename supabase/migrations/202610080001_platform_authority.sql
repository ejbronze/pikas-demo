-- Phase 6A.1: isolated PIKAS platform authority and tenant onboarding.
begin;

create table pikas_private.platform_roles (
  role_code text primary key check (role_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pikas_private.platform_capabilities (
  capability text primary key check (capability ~ '^platform(:[a-z_]+){2,3}$'),
  created_at timestamptz not null default now()
);

create table pikas_private.platform_role_capabilities (
  role_code text not null references pikas_private.platform_roles(role_code) on delete restrict,
  capability text not null references pikas_private.platform_capabilities(capability) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_code, capability)
);

create table pikas_private.platform_memberships (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references public.persons(id) on delete restrict,
  role_code text not null references pikas_private.platform_roles(role_code) on delete restrict,
  status text not null default 'active' check (status in ('active','suspended','inactive')),
  granted_by_person_id uuid references public.persons(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((status = 'inactive' and revoked_at is not null)
      or (status <> 'inactive' and revoked_at is null))
);
create index platform_memberships_role_status_idx
  on pikas_private.platform_memberships(role_code,status,person_id);

create table pikas_private.platform_requests (
  request_id uuid primary key,
  operation text not null check (length(operation) between 1 and 80),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_auth_user_id uuid not null,
  actor_person_id uuid not null references public.persons(id) on delete restrict,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
create index platform_requests_actor_time_idx
  on pikas_private.platform_requests(actor_person_id,created_at desc);

create table pikas_private.platform_customer_admin_intents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references pikas_private.platform_requests(request_id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  scope_kind text not null check (scope_kind in ('account','school','cafeteria')),
  school_id uuid,
  cafeteria_id uuid,
  role_code text not null,
  intended_email_key text not null check (
    intended_email_key = lower(btrim(intended_email_key))
    and length(intended_email_key) between 3 and 254
    and position('@' in intended_email_key) > 1
  ),
  status text not null default 'pending'
    check (status in ('pending','linked','granted','revoked','expired')),
  linked_person_id uuid references public.persons(id) on delete restrict,
  linked_auth_user_id uuid references auth.users(id) on delete restrict,
  granted_membership_id uuid,
  created_by_person_id uuid not null references public.persons(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  granted_at timestamptz,
  foreign key (account_id,school_id) references public.schools(account_id,id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id)
    references public.cafeterias(account_id,school_id,id) on delete restrict,
  check (
    (scope_kind = 'account' and role_code = 'account_admin' and school_id is null and cafeteria_id is null)
    or (scope_kind = 'school' and role_code = 'school_admin' and school_id is not null and cafeteria_id is null)
    or (scope_kind = 'cafeteria' and role_code = 'cafeteria_admin' and school_id is not null and cafeteria_id is not null)
  ),
  check (expires_at > created_at),
  check ((linked_person_id is null) = (linked_auth_user_id is null)),
  check (
    (status = 'pending' and linked_person_id is null and granted_membership_id is null and granted_at is null)
    or (status = 'linked' and linked_person_id is not null and granted_membership_id is null and granted_at is null)
    or (status = 'granted' and linked_person_id is not null and granted_membership_id is not null and granted_at is not null)
    or (status in ('revoked','expired') and granted_membership_id is null and granted_at is null)
  )
);
create index platform_customer_admin_intents_status_email_idx
  on pikas_private.platform_customer_admin_intents(status,intended_email_key);
create index platform_customer_admin_intents_scope_idx
  on pikas_private.platform_customer_admin_intents(account_id,school_id,cafeteria_id,status);
create unique index platform_customer_admin_intents_one_open_target_idx
  on pikas_private.platform_customer_admin_intents(
    account_id,scope_kind,coalesce(school_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(cafeteria_id,'00000000-0000-0000-0000-000000000000'::uuid),role_code,intended_email_key
  ) where status in ('pending','linked');

create table pikas_private.platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_kind text not null check (actor_kind in ('platform_operator','owner_root_bootstrap')),
  actor_auth_user_id uuid,
  actor_person_id uuid references public.persons(id) on delete restrict,
  capability text not null check (length(capability) between 1 and 80),
  action text not null check (length(action) between 1 and 100),
  target_account_id uuid references public.accounts(id) on delete restrict,
  target_school_id uuid,
  target_location_id uuid,
  target_cafeteria_id uuid,
  target_person_id uuid references public.persons(id) on delete restrict,
  target_intent_id uuid references pikas_private.platform_customer_admin_intents(id) on delete restrict,
  outcome text not null check (outcome in ('succeeded','denied','failed')),
  reason_code text not null check (reason_code in (
    'owner_root_bootstrap','tenant_provisioned','customer_admin_intent_prepared',
    'identity_linked','customer_admin_granted'
  )),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  check (
    (actor_kind = 'platform_operator' and actor_auth_user_id is not null and actor_person_id is not null)
    or (actor_kind = 'owner_root_bootstrap' and actor_auth_user_id is null and actor_person_id is null)
  ),
  foreign key (target_account_id,target_school_id) references public.schools(account_id,id) on delete restrict,
  foreign key (target_account_id,target_school_id,target_cafeteria_id)
    references public.cafeterias(account_id,school_id,id) on delete restrict,
  foreign key (target_account_id,target_school_id,target_location_id)
    references public.school_locations(account_id,school_id,id) on delete restrict
);
create index platform_audit_actor_time_idx
  on pikas_private.platform_audit_events(actor_person_id,occurred_at desc);
create index platform_audit_request_idx
  on pikas_private.platform_audit_events(request_id);
create index platform_audit_action_time_idx
  on pikas_private.platform_audit_events(action,occurred_at desc);
create index platform_audit_tenant_time_idx
  on pikas_private.platform_audit_events(target_account_id,target_school_id,target_cafeteria_id,occurred_at desc);

insert into pikas_private.platform_roles(role_code) values ('platform_admin');
insert into pikas_private.platform_capabilities(capability) values
  ('platform:tenant:provision'),
  ('platform:identity:link'),
  ('platform:customer_admin:provision'),
  ('platform:tenant:lifecycle:read'),
  ('platform:audit:read');
insert into pikas_private.platform_role_capabilities(role_code,capability)
select 'platform_admin',capability from pikas_private.platform_capabilities;

do $$
declare t text;
begin
  foreach t in array array[
    'platform_roles','platform_capabilities','platform_role_capabilities',
    'platform_memberships','platform_requests','platform_customer_admin_intents',
    'platform_audit_events'
  ] loop
    execute format('alter table pikas_private.%I enable row level security',t);
    execute format('alter table pikas_private.%I force row level security',t);
    execute format('revoke all on pikas_private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create function pikas_private.reject_platform_definition_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode='23514',message='platform_definitions_are_migration_managed';
end $$;
create function pikas_private.reject_platform_truncate() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode='23514',message='platform_tables_cannot_be_truncated';
end $$;
create trigger platform_roles_immutable before update or delete on pikas_private.platform_roles
for each row execute function pikas_private.reject_platform_definition_mutation();
create trigger platform_capabilities_immutable before update or delete on pikas_private.platform_capabilities
for each row execute function pikas_private.reject_platform_definition_mutation();
create trigger platform_role_capabilities_immutable before update or delete on pikas_private.platform_role_capabilities
for each row execute function pikas_private.reject_platform_definition_mutation();
create trigger platform_roles_no_truncate before truncate on pikas_private.platform_roles
for each statement execute function pikas_private.reject_platform_truncate();
create trigger platform_capabilities_no_truncate before truncate on pikas_private.platform_capabilities
for each statement execute function pikas_private.reject_platform_truncate();
create trigger platform_role_capabilities_no_truncate before truncate on pikas_private.platform_role_capabilities
for each statement execute function pikas_private.reject_platform_truncate();

create function pikas_private.guard_platform_membership() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='23514',message='platform_membership_must_be_revoked_not_deleted';
  end if;
  if tg_op='UPDATE' and (
    old.id is distinct from new.id or old.person_id is distinct from new.person_id
    or old.role_code is distinct from new.role_code or old.granted_by_person_id is distinct from new.granted_by_person_id
    or old.created_at is distinct from new.created_at
  ) then
    raise exception using errcode='23514',message='platform_membership_identity_is_immutable';
  end if;
  if tg_op='UPDATE' and old.status='inactive' and new.status<>'inactive' then
    raise exception using errcode='23514',message='platform_membership_cannot_be_reactivated';
  end if;
  new.updated_at:=clock_timestamp();
  if new.status='inactive' then new.revoked_at:=coalesce(new.revoked_at,clock_timestamp()); end if;
  return new;
end $$;
create trigger platform_membership_guard before update or delete on pikas_private.platform_memberships
for each row execute function pikas_private.guard_platform_membership();
create trigger platform_memberships_no_truncate before truncate on pikas_private.platform_memberships
for each statement execute function pikas_private.reject_platform_truncate();

create function pikas_private.reject_platform_request_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode='23514',message='platform_requests_are_immutable';
end $$;
create trigger platform_requests_immutable before update or delete on pikas_private.platform_requests
for each row execute function pikas_private.reject_platform_request_mutation();
create trigger platform_requests_no_truncate before truncate on pikas_private.platform_requests
for each statement execute function pikas_private.reject_platform_truncate();

create function pikas_private.guard_platform_intent() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='23514',message='platform_intent_must_be_revoked_not_deleted';
  end if;
  if tg_op='UPDATE' and (
    old.id is distinct from new.id or old.request_id is distinct from new.request_id
    or old.account_id is distinct from new.account_id or old.scope_kind is distinct from new.scope_kind
    or old.school_id is distinct from new.school_id or old.cafeteria_id is distinct from new.cafeteria_id
    or old.role_code is distinct from new.role_code or old.intended_email_key is distinct from new.intended_email_key
    or old.created_by_person_id is distinct from new.created_by_person_id
    or old.created_at is distinct from new.created_at or old.expires_at is distinct from new.expires_at
  ) then
    raise exception using errcode='23514',message='platform_intent_scope_and_target_are_immutable';
  end if;
  if tg_op='UPDATE' and not (
    (old.status='pending' and new.status in ('pending','linked','revoked','expired'))
    or (old.status='linked' and new.status in ('linked','granted','revoked','expired'))
    or old.status=new.status
  ) then
    raise exception using errcode='23514',message='invalid_platform_intent_transition';
  end if;
  if tg_op='UPDATE' and old.linked_person_id is not null and (
    old.linked_person_id is distinct from new.linked_person_id
    or old.linked_auth_user_id is distinct from new.linked_auth_user_id
  ) then
    raise exception using errcode='23514',message='platform_intent_identity_link_is_immutable';
  end if;
  if tg_op='UPDATE' and old.status='granted' then
    raise exception using errcode='23514',message='granted_platform_intent_is_immutable';
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
create trigger platform_intent_guard before update or delete on pikas_private.platform_customer_admin_intents
for each row execute function pikas_private.guard_platform_intent();
create trigger platform_intents_no_truncate before truncate on pikas_private.platform_customer_admin_intents
for each statement execute function pikas_private.reject_platform_truncate();

create function pikas_private.reject_platform_audit_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode='23514',message='platform_audit_is_append_only';
end $$;
create trigger platform_audit_immutable before update or delete on pikas_private.platform_audit_events
for each row execute function pikas_private.reject_platform_audit_mutation();
create trigger platform_audit_no_truncate before truncate on pikas_private.platform_audit_events
for each statement execute function pikas_private.reject_platform_audit_mutation();

create function pikas_private.platform_person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id
  from public.persons p
  where p.auth_user_id=(select auth.uid()) and p.status='active'
$$;

create function pikas_private.platform_has_capability(p_capability text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.persons p
    join pikas_private.platform_memberships m on m.person_id=p.id and m.status='active'
    join pikas_private.platform_roles r on r.role_code=m.role_code and r.status='active'
    join pikas_private.platform_role_capabilities rc on rc.role_code=r.role_code
    join pikas_private.platform_capabilities c on c.capability=rc.capability
    where p.auth_user_id=(select auth.uid())
      and p.status='active'
      and c.capability=p_capability
  )
$$;

create function pikas_private.require_platform_capability(p_capability text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid;
begin
  actor:=pikas_private.platform_person_id();
  if actor is null or not pikas_private.platform_has_capability(p_capability) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  return actor;
end $$;

create function pikas_private.platform_request_fingerprint(p_payload jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256'),'hex')
$$;

create function pikas_private.platform_replay_request(
  p_request_id uuid,p_operation text,p_fingerprint text,p_actor_person_id uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare existing pikas_private.platform_requests%rowtype;
begin
  if p_request_id is null then
    raise exception using errcode='22023',message='request_id_required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text,20261008)
  );
  select * into existing from pikas_private.platform_requests r
    where r.request_id=p_request_id;
  if not found then return null; end if;
  if existing.operation<>p_operation
    or existing.request_fingerprint<>p_fingerprint
    or existing.actor_person_id<>p_actor_person_id
    or existing.actor_auth_user_id<>(select auth.uid()) then
    raise exception using errcode='23505',message='platform_request_conflict';
  end if;
  return existing.response;
end $$;

create function pikas_private.record_platform_audit(
  p_request_id uuid,p_actor_person_id uuid,p_actor_auth_user_id uuid,
  p_capability text,p_action text,p_reason_code text,
  p_account_id uuid,p_school_id uuid,p_location_id uuid,p_cafeteria_id uuid,
  p_person_id uuid,p_intent_id uuid,p_metadata jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into pikas_private.platform_audit_events(
    request_id,actor_kind,actor_auth_user_id,actor_person_id,capability,action,
    target_account_id,target_school_id,target_location_id,target_cafeteria_id,
    target_person_id,target_intent_id,outcome,reason_code,metadata
  ) values (
    p_request_id,'platform_operator',p_actor_auth_user_id,p_actor_person_id,
    p_capability,p_action,p_account_id,p_school_id,p_location_id,p_cafeteria_id,
    p_person_id,p_intent_id,'succeeded',p_reason_code,coalesce(p_metadata,'{}'::jsonb)
  );
end $$;

create function public.platform_provision_tenant(
  p_request_id uuid,
  p_account_code text,p_account_name text,
  p_school_code text,p_school_name text,p_business_timezone text,
  p_location_code text,p_location_name text,
  p_cafeteria_code text,p_cafeteria_name text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid; auth_actor uuid; payload jsonb; fingerprint text; replay jsonb;
  account_id_value uuid; school_id_value uuid; location_id_value uuid; cafeteria_id_value uuid;
  result jsonb; account_code_value text; account_name_value text;
  school_code_value text; school_name_value text; timezone_value text;
  location_code_value text; location_name_value text; cafeteria_code_value text; cafeteria_name_value text;
begin
  actor:=pikas_private.require_platform_capability('platform:tenant:provision');
  auth_actor:=auth.uid();
  account_code_value:=nullif(btrim(p_account_code),''); account_name_value:=nullif(btrim(p_account_name),'');
  school_code_value:=nullif(btrim(p_school_code),''); school_name_value:=nullif(btrim(p_school_name),'');
  timezone_value:=nullif(btrim(p_business_timezone),'');
  location_code_value:=nullif(btrim(p_location_code),''); location_name_value:=nullif(btrim(p_location_name),'');
  cafeteria_code_value:=nullif(btrim(p_cafeteria_code),''); cafeteria_name_value:=nullif(btrim(p_cafeteria_name),'');
  if account_code_value is null or length(account_code_value)>64
    or account_name_value is null or length(account_name_value)>200
    or school_code_value is null or length(school_code_value)>64
    or school_name_value is null or length(school_name_value)>200
    or timezone_value is null or length(timezone_value)>100
    or location_code_value is null or length(location_code_value)>64
    or location_name_value is null or length(location_name_value)>200
    or cafeteria_code_value is null or length(cafeteria_code_value)>64
    or cafeteria_name_value is null or length(cafeteria_name_value)>200 then
    raise exception using errcode='22023',message='invalid_tenant_provisioning_input';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=timezone_value) then
    raise exception using errcode='22023',message='invalid_business_timezone';
  end if;
  payload:=jsonb_build_object(
    'account_code',account_code_value,'account_name',account_name_value,
    'school_code',school_code_value,'school_name',school_name_value,'timezone',timezone_value,
    'location_code',location_code_value,'location_name',location_name_value,
    'cafeteria_code',cafeteria_code_value,'cafeteria_name',cafeteria_name_value
  );
  fingerprint:=pikas_private.platform_request_fingerprint(payload);
  replay:=pikas_private.platform_replay_request(p_request_id,'tenant_provision',fingerprint,actor);
  if replay is not null then return replay; end if;

  begin
    insert into public.accounts(code,name) values(account_code_value,account_name_value)
      returning id into account_id_value;
    insert into public.schools(account_id,code,name,business_timezone)
      values(account_id_value,school_code_value,school_name_value,timezone_value)
      returning id into school_id_value;
    insert into public.school_locations(account_id,school_id,code,name)
      values(account_id_value,school_id_value,location_code_value,location_name_value)
      returning id into location_id_value;
    insert into public.cafeterias(account_id,school_id,school_location_id,code,name)
      values(account_id_value,school_id_value,location_id_value,cafeteria_code_value,cafeteria_name_value)
      returning id into cafeteria_id_value;
  exception when unique_violation then
    raise exception using errcode='23505',message='platform_tenant_code_conflict';
  end;

  result:=jsonb_build_object(
    'account_id',account_id_value,'school_id',school_id_value,
    'location_id',location_id_value,'cafeteria_id',cafeteria_id_value
  );
  insert into pikas_private.platform_requests(
    request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response
  ) values(p_request_id,'tenant_provision',fingerprint,auth_actor,actor,result);
  perform pikas_private.record_platform_audit(
    p_request_id,actor,auth_actor,'platform:tenant:provision','tenant_provisioned',
    'tenant_provisioned',account_id_value,school_id_value,location_id_value,cafeteria_id_value,
    null,null,payload
  );
  return result;
end $$;

create function public.platform_prepare_customer_admin(
  p_request_id uuid,p_account_id uuid,p_scope_kind text,p_school_id uuid,p_cafeteria_id uuid,
  p_role_code text,p_intended_email text,p_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid; auth_actor uuid; email_key text; payload jsonb; fingerprint text; replay jsonb;
  intent_id_value uuid:=gen_random_uuid(); result jsonb;
begin
  actor:=pikas_private.require_platform_capability('platform:customer_admin:provision');
  auth_actor:=auth.uid();
  email_key:=lower(btrim(coalesce(p_intended_email,'')));
  if p_account_id is null or length(email_key) not between 3 and 254
    or position('@' in email_key)<=1 or p_expires_at is null
    or p_expires_at<=clock_timestamp()
    or p_expires_at>clock_timestamp()+interval '30 days'
    or p_scope_kind is null or p_role_code is null
    or not coalesce((
      (p_scope_kind='account' and p_role_code='account_admin' and p_school_id is null and p_cafeteria_id is null)
      or (p_scope_kind='school' and p_role_code='school_admin' and p_school_id is not null and p_cafeteria_id is null)
      or (p_scope_kind='cafeteria' and p_role_code='cafeteria_admin' and p_school_id is not null and p_cafeteria_id is not null)
    ),false) then
    raise exception using errcode='22023',message='invalid_customer_admin_intent';
  end if;
  payload:=jsonb_build_object(
    'account_id',p_account_id,'scope_kind',p_scope_kind,'school_id',p_school_id,
    'cafeteria_id',p_cafeteria_id,'role_code',p_role_code,
    'intended_email_key',email_key,'expires_at',p_expires_at
  );
  fingerprint:=pikas_private.platform_request_fingerprint(payload);
  replay:=pikas_private.platform_replay_request(p_request_id,'customer_admin_prepare',fingerprint,actor);
  if replay is not null then return replay; end if;
  if not pikas_private.scope_active(p_account_id,p_school_id,p_cafeteria_id) then
    raise exception using errcode='23503',message='inactive_or_invalid_tenant_scope';
  end if;
  update pikas_private.platform_customer_admin_intents i
    set status='expired'
    where i.account_id=p_account_id and i.scope_kind=p_scope_kind
      and i.school_id is not distinct from p_school_id
      and i.cafeteria_id is not distinct from p_cafeteria_id
      and i.role_code=p_role_code and i.intended_email_key=email_key
      and i.status in ('pending','linked') and i.expires_at<=clock_timestamp();
  result:=jsonb_build_object('intent_id',intent_id_value,'status','pending');
  insert into pikas_private.platform_requests(
    request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response
  ) values(p_request_id,'customer_admin_prepare',fingerprint,auth_actor,actor,result);
  insert into pikas_private.platform_customer_admin_intents(
    id,request_id,account_id,scope_kind,school_id,cafeteria_id,role_code,
    intended_email_key,created_by_person_id,expires_at
  ) values(
    intent_id_value,p_request_id,p_account_id,p_scope_kind,p_school_id,p_cafeteria_id,
    p_role_code,email_key,actor,p_expires_at
  );
  perform pikas_private.record_platform_audit(
    p_request_id,actor,auth_actor,'platform:customer_admin:provision',
    'customer_admin_intent_prepared','customer_admin_intent_prepared',
    p_account_id,p_school_id,null,p_cafeteria_id,null,intent_id_value,
    jsonb_build_object('role_code',p_role_code,'scope_kind',p_scope_kind,'status','pending')
  );
  return result;
end $$;

create function public.platform_link_customer_admin_identity(
  p_request_id uuid,p_intent_id uuid,p_auth_user_id uuid,p_display_name text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid; auth_actor uuid; intent pikas_private.platform_customer_admin_intents%rowtype;
  target_user record; target_person_id uuid; display_name_value text;
  payload jsonb; fingerprint text; replay jsonb; result jsonb;
begin
  actor:=pikas_private.require_platform_capability('platform:identity:link');
  auth_actor:=auth.uid();
  display_name_value:=nullif(btrim(p_display_name),'');
  if p_intent_id is null or p_auth_user_id is null
    or display_name_value is null or length(display_name_value)>200 then
    raise exception using errcode='22023',message='invalid_identity_link_input';
  end if;
  payload:=jsonb_build_object('intent_id',p_intent_id,'auth_user_id',p_auth_user_id,'display_name',display_name_value);
  fingerprint:=pikas_private.platform_request_fingerprint(payload);
  replay:=pikas_private.platform_replay_request(p_request_id,'customer_admin_identity_link',fingerprint,actor);
  if replay is not null then return replay; end if;

  select * into intent from pikas_private.platform_customer_admin_intents i
    where i.id=p_intent_id for update;
  if not found or intent.status<>'pending' or intent.expires_at<=clock_timestamp() then
    raise exception using errcode='23514',message='customer_admin_intent_not_linkable';
  end if;
  select u.id,u.email,u.confirmed_at into target_user
    from auth.users u where u.id=p_auth_user_id;
  if not found or target_user.confirmed_at is null
    or lower(btrim(target_user.email))<>intent.intended_email_key then
    raise exception using errcode='42501',message='confirmed_intended_auth_identity_required';
  end if;

  select p.id,p.status into target_person_id,display_name_value
    from public.persons p where p.auth_user_id=p_auth_user_id for update;
  if found then
    if display_name_value<>'active' then
      raise exception using errcode='23514',message='linked_person_must_be_active';
    end if;
    select p.id into target_person_id from public.persons p
      where p.auth_user_id=p_auth_user_id;
  else
    insert into public.persons(auth_user_id,display_name,status)
      values(p_auth_user_id,nullif(btrim(p_display_name),''),'active')
      returning id into target_person_id;
  end if;

  update pikas_private.platform_customer_admin_intents i
    set linked_person_id=target_person_id,linked_auth_user_id=p_auth_user_id,status='linked'
    where i.id=p_intent_id;
  result:=jsonb_build_object('intent_id',p_intent_id,'person_id',target_person_id,'status','linked');
  insert into pikas_private.platform_requests(
    request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response
  ) values(p_request_id,'customer_admin_identity_link',fingerprint,auth_actor,actor,result);
  perform pikas_private.record_platform_audit(
    p_request_id,actor,auth_actor,'platform:identity:link','customer_admin_identity_linked',
    'identity_linked',intent.account_id,intent.school_id,null,intent.cafeteria_id,
    target_person_id,p_intent_id,
    jsonb_build_object('role_code',intent.role_code,'scope_kind',intent.scope_kind,'status','linked')
  );
  return result;
end $$;

create function public.platform_grant_customer_admin(
  p_request_id uuid,p_intent_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid; auth_actor uuid; intent pikas_private.platform_customer_admin_intents%rowtype;
  target_person public.persons%rowtype; membership_id_value uuid; existing_status text;
  payload jsonb; fingerprint text; replay jsonb; result jsonb;
begin
  actor:=pikas_private.require_platform_capability('platform:customer_admin:provision');
  auth_actor:=auth.uid();
  if p_intent_id is null then
    raise exception using errcode='22023',message='intent_id_required';
  end if;
  payload:=jsonb_build_object('intent_id',p_intent_id);
  fingerprint:=pikas_private.platform_request_fingerprint(payload);
  replay:=pikas_private.platform_replay_request(p_request_id,'customer_admin_grant',fingerprint,actor);
  if replay is not null then return replay; end if;
  select * into intent from pikas_private.platform_customer_admin_intents i
    where i.id=p_intent_id for update;
  if not found or intent.status<>'linked' or intent.expires_at<=clock_timestamp() then
    raise exception using errcode='23514',message='linked_customer_admin_intent_required';
  end if;
  select * into target_person from public.persons p
    where p.id=intent.linked_person_id and p.auth_user_id=intent.linked_auth_user_id
    for update;
  if not found or target_person.status<>'active' or not exists(
    select 1 from auth.users u where u.id=target_person.auth_user_id
      and u.confirmed_at is not null
      and lower(btrim(u.email))=intent.intended_email_key
  ) then
    raise exception using errcode='42501',message='active_confirmed_linked_person_required';
  end if;
  if not pikas_private.scope_active(intent.account_id,intent.school_id,intent.cafeteria_id) then
    raise exception using errcode='23503',message='inactive_or_invalid_tenant_scope';
  end if;

  if intent.scope_kind='account' then
    select m.id,m.status into membership_id_value,existing_status from public.account_memberships m
      where m.account_id=intent.account_id and m.person_id=target_person.id
        and m.role_code='account_admin' for update;
    if found and existing_status<>'active' then
      raise exception using errcode='23505',message='customer_membership_exists_inactive';
    elsif not found then
      insert into public.account_memberships(account_id,person_id,role_code,status)
        values(intent.account_id,target_person.id,'account_admin','active')
        returning id into membership_id_value;
    end if;
  elsif intent.scope_kind='school' then
    select m.id,m.status into membership_id_value,existing_status from public.school_memberships m
      where m.account_id=intent.account_id and m.school_id=intent.school_id
        and m.person_id=target_person.id and m.role_code='school_admin' for update;
    if found and existing_status<>'active' then
      raise exception using errcode='23505',message='customer_membership_exists_inactive';
    elsif not found then
      insert into public.school_memberships(account_id,school_id,person_id,role_code,status)
        values(intent.account_id,intent.school_id,target_person.id,'school_admin','active')
        returning id into membership_id_value;
    end if;
  else
    select m.id,m.status into membership_id_value,existing_status from public.cafeteria_memberships m
      where m.account_id=intent.account_id and m.school_id=intent.school_id
        and m.cafeteria_id=intent.cafeteria_id and m.person_id=target_person.id
        and m.role_code='cafeteria_admin' for update;
    if found and existing_status<>'active' then
      raise exception using errcode='23505',message='customer_membership_exists_inactive';
    elsif not found then
      insert into public.cafeteria_memberships(
        account_id,school_id,cafeteria_id,person_id,role_code,status
      ) values(
        intent.account_id,intent.school_id,intent.cafeteria_id,target_person.id,'cafeteria_admin','active'
      ) returning id into membership_id_value;
    end if;
  end if;

  update pikas_private.platform_customer_admin_intents i
    set status='granted',granted_membership_id=membership_id_value,granted_at=clock_timestamp()
    where i.id=p_intent_id;
  result:=jsonb_build_object(
    'intent_id',p_intent_id,'membership_id',membership_id_value,
    'person_id',target_person.id,'role_code',intent.role_code,'scope_kind',intent.scope_kind,'status','granted'
  );
  insert into pikas_private.platform_requests(
    request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response
  ) values(p_request_id,'customer_admin_grant',fingerprint,auth_actor,actor,result);
  perform pikas_private.record_platform_audit(
    p_request_id,actor,auth_actor,'platform:customer_admin:provision',
    'customer_admin_membership_granted','customer_admin_granted',
    intent.account_id,intent.school_id,null,intent.cafeteria_id,
    target_person.id,p_intent_id,
    jsonb_build_object('membership_id',membership_id_value,'role_code',intent.role_code,
      'scope_kind',intent.scope_kind,'status','granted')
  );
  return result;
end $$;

create function public.platform_get_tenant_lifecycle(p_account_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform pikas_private.require_platform_capability('platform:tenant:lifecycle:read');
  if p_account_id is null then
    raise exception using errcode='22023',message='account_id_required';
  end if;
  select jsonb_build_object(
    'account',jsonb_build_object('id',a.id,'code',a.code,'name',a.name,'status',a.status),
    'schools',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',s.id,'code',s.code,'name',s.name,'status',s.status,'business_timezone',s.business_timezone,
        'locations',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',l.id,'code',l.code,'name',l.name,'status',l.status,
            'cafeterias',coalesce((
              select jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'status',c.status))
              from public.cafeterias c where c.account_id=a.id and c.school_id=s.id
                and c.school_location_id=l.id
            ),'[]'::jsonb)
          )) from public.school_locations l where l.account_id=a.id and l.school_id=s.id
        ),'[]'::jsonb)
      )) from public.schools s where s.account_id=a.id
    ),'[]'::jsonb),
    'customer_admin_onboarding',coalesce((
      select jsonb_agg(jsonb_build_object(
        'intent_id',i.id,'role',i.role_code,'scope',i.scope_kind,'status',i.status,
        'person',case when p.id is null then null else jsonb_build_object('id',p.id,'display_name',p.display_name) end
      ) order by i.created_at)
      from pikas_private.platform_customer_admin_intents i
      left join public.persons p on p.id=i.linked_person_id
      where i.account_id=a.id
    ),'[]'::jsonb)
  ) into result
  from public.accounts a where a.id=p_account_id;
  if result is null then
    raise exception using errcode='P0002',message='tenant_not_found';
  end if;
  return result;
end $$;

create function public.platform_read_audit(
  p_before timestamptz default null,p_limit integer default 50
) returns table(
  id uuid,request_id uuid,occurred_at timestamptz,actor_kind text,
  actor_auth_user_id uuid,actor_person_id uuid,capability text,action text,
  target_account_id uuid,target_school_id uuid,target_location_id uuid,
  target_cafeteria_id uuid,target_person_id uuid,target_intent_id uuid,
  outcome text,reason_code text,metadata jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform pikas_private.require_platform_capability('platform:audit:read');
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode='22023',message='invalid_audit_page_size';
  end if;
  return query
    select e.id,e.request_id,e.occurred_at,e.actor_kind,e.actor_auth_user_id,e.actor_person_id,
      e.capability,e.action,e.target_account_id,e.target_school_id,e.target_location_id,
      e.target_cafeteria_id,e.target_person_id,e.target_intent_id,e.outcome,e.reason_code,e.metadata
    from pikas_private.platform_audit_events e
    where p_before is null or e.occurred_at<p_before
    order by e.occurred_at desc,e.id desc limit p_limit;
end $$;

create function public.platform_get_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role',r.role_code,
    'capabilities',coalesce(jsonb_agg(rc.capability order by rc.capability),'[]'::jsonb)
  )
  from public.persons p
  join pikas_private.platform_memberships m on m.person_id=p.id and m.status='active'
  join pikas_private.platform_roles r on r.role_code=m.role_code and r.status='active'
  left join pikas_private.platform_role_capabilities rc on rc.role_code=r.role_code
  where p.auth_user_id=(select auth.uid()) and p.status='active'
  group by r.role_code
$$;

revoke all on function pikas_private.reject_platform_definition_mutation()
  from public,anon,authenticated,service_role;
revoke all on function pikas_private.reject_platform_truncate()
  from public,anon,authenticated,service_role;
revoke all on function pikas_private.guard_platform_membership()
  from public,anon,authenticated,service_role;
revoke all on function pikas_private.reject_platform_request_mutation()
  from public,anon,authenticated,service_role;
revoke all on function pikas_private.guard_platform_intent()
  from public,anon,authenticated,service_role;
revoke all on function pikas_private.reject_platform_audit_mutation()
  from public,anon,authenticated,service_role;
revoke all on function pikas_private.platform_person_id()
  from public,anon,authenticated,service_role;
revoke all on function pikas_private.platform_has_capability(text)
  from public,anon,authenticated,service_role;
revoke all on function pikas_private.require_platform_capability(text)
  from public,anon,authenticated,service_role;
revoke all on function pikas_private.platform_request_fingerprint(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function pikas_private.platform_replay_request(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function pikas_private.record_platform_audit(uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.platform_provision_tenant(uuid,text,text,text,text,text,text,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.platform_prepare_customer_admin(uuid,uuid,text,uuid,uuid,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.platform_link_customer_admin_identity(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.platform_grant_customer_admin(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.platform_get_tenant_lifecycle(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.platform_read_audit(timestamptz,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.platform_get_context()
  from public,anon,authenticated,service_role;
grant execute on function public.platform_provision_tenant(uuid,text,text,text,text,text,text,text,text,text)
  to authenticated;
grant execute on function public.platform_prepare_customer_admin(uuid,uuid,text,uuid,uuid,text,text,timestamptz)
  to authenticated;
grant execute on function public.platform_link_customer_admin_identity(uuid,uuid,uuid,text)
  to authenticated;
grant execute on function public.platform_grant_customer_admin(uuid,uuid)
  to authenticated;
grant execute on function public.platform_get_tenant_lifecycle(uuid)
  to authenticated;
grant execute on function public.platform_read_audit(timestamptz,integer)
  to authenticated;
grant execute on function public.platform_get_context()
  to authenticated;

comment on table pikas_private.platform_memberships is 'Independent platform-level authority; never a tenant membership or tenant RLS grant.';
comment on table pikas_private.platform_customer_admin_intents is 'Email-bound onboarding authorization, separate from Auth invitations.';
comment on table pikas_private.platform_audit_events is 'Append-only, sanitized PIKAS platform provisioning audit.';

commit;
