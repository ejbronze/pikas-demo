-- Phase 6B: sandbox tenant classification, sandbox cashier POV and POS-only effective actor resolution.
-- Frozen migrations are untouched. No tenant is classified as sandbox and no persona, membership,
-- register or assignment is created by this migration.
begin;

-- A. Authoritative account-level classification. Written only at account creation; never by tenants.
alter table public.accounts
  add column tenant_kind text not null default 'customer' check (tenant_kind in ('customer','sandbox'));

create function pikas_private.guard_account_tenant_kind() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.tenant_kind is distinct from old.tenant_kind then
    raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
  end if;
  return new;
end $$;
create trigger accounts_tenant_kind_immutable before update on public.accounts
for each row execute function pikas_private.guard_account_tenant_kind();
revoke all on function pikas_private.guard_account_tenant_kind() from public,anon,authenticated,service_role;

-- B0. Independent platform roles: one Person may hold several platform roles (at most one live
-- membership per role). Capability helpers already resolve across all active memberships.
alter table pikas_private.platform_memberships drop constraint platform_memberships_person_id_key;
create unique index platform_memberships_person_role_live_uidx
  on pikas_private.platform_memberships(person_id,role_code) where status<>'inactive';

create or replace function public.platform_get_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  with held as (
    select r.role_code, rc.capability
    from public.persons p
    join pikas_private.platform_memberships m on m.person_id=p.id and m.status='active'
    join pikas_private.platform_roles r on r.role_code=m.role_code and r.status='active'
    left join pikas_private.platform_role_capabilities rc on rc.role_code=r.role_code
    where p.auth_user_id=(select auth.uid()) and p.status='active'
  )
  select jsonb_build_object(
    'role',case when bool_or(role_code='platform_admin') then 'platform_admin' else min(role_code) end,
    'roles',(select jsonb_agg(distinct role_code order by role_code) from held),
    'capabilities',coalesce((select jsonb_agg(c order by c) from (select distinct capability c from held where capability is not null) x),'[]'::jsonb)
  )
  from held
  having count(*)>0
$$;

-- B. Dedicated platform authority. Deliberately NOT granted to platform_admin.
insert into pikas_private.platform_roles(role_code) values ('platform_sandbox_operator');
insert into pikas_private.platform_capabilities(capability) values ('platform:sandbox:pov:enter');
insert into pikas_private.platform_role_capabilities(role_code,capability)
values ('platform_sandbox_operator','platform:sandbox:pov:enter');

alter table pikas_private.platform_audit_events drop constraint platform_audit_events_reason_code_check;
alter table pikas_private.platform_audit_events add constraint platform_audit_events_reason_code_check
  check (reason_code in (
    'owner_root_bootstrap','tenant_provisioned','school_location_added','customer_admin_intent_prepared',
    'identity_linked','customer_admin_granted','sandbox_pov_entered','sandbox_pov_exited'
  ));

-- C. Persona registry (owner/migration managed; no client write path) and POV sessions.
create table pikas_private.sandbox_pov_personas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  pov_code text not null check (pov_code in ('cashier')),
  person_id uuid not null references public.persons(id) on delete restrict,
  cafeteria_membership_id uuid not null references public.cafeteria_memberships(id) on delete restrict,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (account_id,school_id,cafeteria_id) references public.cafeterias(account_id,school_id,id) on delete restrict
);
create unique index sandbox_pov_personas_active_key
  on pikas_private.sandbox_pov_personas(cafeteria_id,pov_code) where status='active';

create function pikas_private.guard_sandbox_pov_persona() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='23514',message='sandbox_pov_persona_must_be_deactivated_not_deleted';
  end if;
  if tg_op='UPDATE' then
    if old.id is distinct from new.id or old.account_id is distinct from new.account_id
      or old.school_id is distinct from new.school_id or old.cafeteria_id is distinct from new.cafeteria_id
      or old.pov_code is distinct from new.pov_code or old.person_id is distinct from new.person_id
      or old.cafeteria_membership_id is distinct from new.cafeteria_membership_id
      or old.created_at is distinct from new.created_at then
      raise exception using errcode='23514',message='sandbox_pov_persona_identity_is_immutable';
    end if;
    if old.status='inactive' and new.status<>'inactive' then
      raise exception using errcode='23514',message='sandbox_pov_persona_cannot_be_reactivated';
    end if;
    new.updated_at:=clock_timestamp();
    return new;
  end if;
  if not exists(select 1 from public.accounts a where a.id=new.account_id and a.tenant_kind='sandbox') then
    raise exception using errcode='23514',message='sandbox_pov_persona_requires_sandbox_account';
  end if;
  if not exists(select 1 from public.persons p where p.id=new.person_id and p.status='active' and p.auth_user_id is null) then
    raise exception using errcode='23514',message='sandbox_pov_persona_must_not_have_auth_identity';
  end if;
  if not exists(select 1 from public.cafeteria_memberships m
    where m.id=new.cafeteria_membership_id and m.person_id=new.person_id and m.account_id=new.account_id
      and m.school_id=new.school_id and m.cafeteria_id=new.cafeteria_id and m.status='active'
      and m.role_code='pos_cashier') then
    raise exception using errcode='23514',message='sandbox_pov_persona_membership_mismatch';
  end if;
  return new;
end $$;
create trigger sandbox_pov_persona_guard before insert or update or delete on pikas_private.sandbox_pov_personas
for each row execute function pikas_private.guard_sandbox_pov_persona();
create trigger sandbox_pov_personas_no_truncate before truncate on pikas_private.sandbox_pov_personas
for each statement execute function pikas_private.reject_platform_truncate();

create table pikas_private.sandbox_pov_sessions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  initiator_person_id uuid not null references public.persons(id) on delete restrict,
  initiator_auth_user_id uuid not null,
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  pov_code text not null check (pov_code in ('cashier')),
  persona_id uuid not null references pikas_private.sandbox_pov_personas(id) on delete restrict,
  persona_person_id uuid not null references public.persons(id) on delete restrict,
  persona_membership_id uuid not null references public.cafeteria_memberships(id) on delete restrict,
  status text not null default 'active' check (status in ('active','exited')),
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_reason text check (end_reason in ('exited','superseded')),
  foreign key (account_id,school_id,cafeteria_id) references public.cafeterias(account_id,school_id,id) on delete restrict,
  check (expires_at>started_at),
  check ((status='active' and ended_at is null and end_reason is null)
      or (status='exited' and ended_at is not null and end_reason is not null))
);
create unique index sandbox_pov_sessions_one_active_per_initiator
  on pikas_private.sandbox_pov_sessions(initiator_person_id) where status='active';
create index sandbox_pov_sessions_scope_idx
  on pikas_private.sandbox_pov_sessions(account_id,cafeteria_id,started_at desc);

create function pikas_private.guard_sandbox_pov_session() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='23514',message='sandbox_pov_session_is_append_only';
  end if;
  if old.id is distinct from new.id or old.request_id is distinct from new.request_id
    or old.initiator_person_id is distinct from new.initiator_person_id
    or old.initiator_auth_user_id is distinct from new.initiator_auth_user_id
    or old.account_id is distinct from new.account_id or old.school_id is distinct from new.school_id
    or old.cafeteria_id is distinct from new.cafeteria_id or old.pov_code is distinct from new.pov_code
    or old.persona_id is distinct from new.persona_id or old.persona_person_id is distinct from new.persona_person_id
    or old.persona_membership_id is distinct from new.persona_membership_id
    or old.started_at is distinct from new.started_at or old.expires_at is distinct from new.expires_at then
    raise exception using errcode='23514',message='sandbox_pov_session_identity_is_immutable';
  end if;
  if old.status='exited' and (new.status<>'exited' or old.ended_at is distinct from new.ended_at
    or old.end_reason is distinct from new.end_reason) then
    raise exception using errcode='23514',message='sandbox_pov_session_cannot_be_reactivated';
  end if;
  return new;
end $$;
create trigger sandbox_pov_session_guard before update or delete on pikas_private.sandbox_pov_sessions
for each row execute function pikas_private.guard_sandbox_pov_session();
create trigger sandbox_pov_sessions_no_truncate before truncate on pikas_private.sandbox_pov_sessions
for each statement execute function pikas_private.reject_platform_truncate();

-- G. Authoritative link between a sandbox POV session and the persona-attributed operations it produced.
create table pikas_private.sandbox_pov_operation_links (
  id uuid primary key default gen_random_uuid(),
  pov_session_id uuid not null references pikas_private.sandbox_pov_sessions(id) on delete restrict,
  target_type text not null check (target_type in ('register_session','purchase')),
  target_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (target_type,target_id)
);
create index sandbox_pov_operation_links_session_idx on pikas_private.sandbox_pov_operation_links(pov_session_id);
create function pikas_private.reject_sandbox_pov_link_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception using errcode='23514',message='sandbox_pov_operation_links_are_immutable'; end $$;
create trigger sandbox_pov_links_immutable before update or delete on pikas_private.sandbox_pov_operation_links
for each row execute function pikas_private.reject_sandbox_pov_link_mutation();
create trigger sandbox_pov_links_no_truncate before truncate on pikas_private.sandbox_pov_operation_links
for each statement execute function pikas_private.reject_platform_truncate();

do $$
declare t text;
begin
  foreach t in array array['sandbox_pov_personas','sandbox_pov_sessions','sandbox_pov_operation_links'] loop
    execute format('alter table pikas_private.%I enable row level security',t);
    execute format('alter table pikas_private.%I force row level security',t);
    execute format('revoke all on pikas_private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
revoke all on function pikas_private.guard_sandbox_pov_persona() from public,anon,authenticated,service_role;
revoke all on function pikas_private.guard_sandbox_pov_session() from public,anon,authenticated,service_role;
revoke all on function pikas_private.reject_sandbox_pov_link_mutation() from public,anon,authenticated,service_role;

-- E. POS-only effective actor resolution. pikas_private.current_person_id() is intentionally untouched.
create function pikas_private.sandbox_pov_context()
returns table(
  pov_session_id uuid,initiator_person_id uuid,account_id uuid,school_id uuid,cafeteria_id uuid,
  pov_code text,persona_id uuid,persona_person_id uuid,persona_membership_id uuid,expires_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select s.id,s.initiator_person_id,s.account_id,s.school_id,s.cafeteria_id,s.pov_code,
         s.persona_id,s.persona_person_id,s.persona_membership_id,s.expires_at
  from public.persons ip
  join pikas_private.sandbox_pov_sessions s on s.initiator_person_id=ip.id and s.status='active'
    and s.expires_at>clock_timestamp()
  join public.accounts ac on ac.id=s.account_id and ac.status='active' and ac.tenant_kind='sandbox'
  join pikas_private.sandbox_pov_personas pr on pr.id=s.persona_id and pr.status='active'
    and pr.pov_code=s.pov_code and pr.person_id=s.persona_person_id
    and pr.cafeteria_membership_id=s.persona_membership_id and pr.account_id=s.account_id
    and pr.school_id=s.school_id and pr.cafeteria_id=s.cafeteria_id
  join public.persons pp on pp.id=pr.person_id and pp.status='active' and pp.auth_user_id is null
  join public.cafeteria_memberships m on m.id=pr.cafeteria_membership_id and m.person_id=pp.id
    and m.status='active' and m.role_code='pos_cashier' and m.account_id=s.account_id
    and m.school_id=s.school_id and m.cafeteria_id=s.cafeteria_id
  where ip.auth_user_id=(select auth.uid()) and ip.status='active'
    and pikas_private.scope_active(s.account_id,s.school_id,s.cafeteria_id)
    and exists(
      select 1 from pikas_private.platform_memberships pm
      join pikas_private.platform_roles r on r.role_code=pm.role_code and r.status='active'
      join pikas_private.platform_role_capabilities rc on rc.role_code=r.role_code
      where pm.person_id=ip.id and pm.status='active' and rc.capability='platform:sandbox:pov:enter')
$$;

create function pikas_private.pos_actor_person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.persona_person_id from pikas_private.sandbox_pov_context() c),
                  pikas_private.current_person_id())
$$;

create function pikas_private.pos_is_operator_membership(
  p_membership_id uuid,p_person_id uuid,p_account_id uuid,p_school_id uuid,p_cafeteria_id uuid,p_capability text
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cafeteria_memberships m
    join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
    where m.id=p_membership_id and m.person_id=p_person_id and m.account_id=p_account_id
      and m.school_id=p_school_id and m.cafeteria_id=p_cafeteria_id and m.status='active'
      and p_person_id=pikas_private.pos_actor_person_id() and rc.capability=p_capability)
$$;

-- With a valid sandbox POV, authority is only the persona's registered cashier membership in the exact
-- POV cafeteria. Without one, the normal tenant checker applies unchanged.
create function pikas_private.pos_has_capability(cap text,a uuid,s uuid default null,c uuid default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select case when exists(select 1 from pikas_private.sandbox_pov_context()) then (
    pikas_private.scope_active(a,s,c) and exists(
      select 1 from pikas_private.sandbox_pov_context() x
      join public.cafeteria_memberships m on m.id=x.persona_membership_id and m.person_id=x.persona_person_id
        and m.status='active'
      join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
      where x.account_id=a and x.school_id=s and x.cafeteria_id=c and rc.capability=cap))
  else pikas_private.has_capability(cap,a,s,c) end
$$;

revoke all on function pikas_private.sandbox_pov_context() from public,anon,authenticated,service_role;
revoke all on function pikas_private.pos_actor_person_id() from public,anon,authenticated,service_role;
revoke all on function pikas_private.pos_is_operator_membership(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function pikas_private.pos_has_capability(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- G. Attribution stamping.
alter table public.audit_events
  add column sandbox_pov_session_id uuid references pikas_private.sandbox_pov_sessions(id) on delete restrict;

create function pikas_private.stamp_audit_sandbox_pov() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ctx record;
begin
  select * into ctx from pikas_private.sandbox_pov_context() c limit 1;
  if found and new.actor_person_id=ctx.persona_person_id and new.account_id=ctx.account_id then
    new.sandbox_pov_session_id:=ctx.pov_session_id;
  else
    new.sandbox_pov_session_id:=null;
  end if;
  return new;
end $$;
create trigger audit_events_stamp_sandbox_pov before insert on public.audit_events
for each row execute function pikas_private.stamp_audit_sandbox_pov();

create function pikas_private.link_sandbox_pov_operation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ctx record;
begin
  select * into ctx from pikas_private.sandbox_pov_context() c limit 1;
  if found and new.operator_person_id=ctx.persona_person_id and new.cafeteria_id=ctx.cafeteria_id then
    insert into pikas_private.sandbox_pov_operation_links(pov_session_id,target_type,target_id)
    values(ctx.pov_session_id,tg_argv[0],new.id);
  end if;
  return null;
end $$;
create trigger register_sessions_link_sandbox_pov after insert on public.register_sessions
for each row execute function pikas_private.link_sandbox_pov_operation('register_session');
create trigger purchases_link_sandbox_pov after insert on public.purchases
for each row execute function pikas_private.link_sandbox_pov_operation('purchase');
revoke all on function pikas_private.stamp_audit_sandbox_pov() from public,anon,authenticated,service_role;
revoke all on function pikas_private.link_sandbox_pov_operation() from public,anon,authenticated,service_role;

-- D. Enter / exit contracts (platform capability, never tenant authority).
create function public.platform_enter_sandbox_pov(
  p_request_id uuid,p_account_id uuid,p_cafeteria_id uuid,p_pov_code text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid; auth_actor uuid; payload jsonb; fingerprint text; replay jsonb; result jsonb;
  school_uuid uuid; persona pikas_private.sandbox_pov_personas%rowtype; persona_name text;
  session_uuid uuid:=gen_random_uuid(); started timestamptz; expiry timestamptz;
begin
  actor:=pikas_private.require_platform_capability('platform:sandbox:pov:enter');
  auth_actor:=auth.uid();
  if p_account_id is null or p_cafeteria_id is null or p_pov_code is distinct from 'cashier' then
    raise exception using errcode='22023',message='invalid_sandbox_pov_request';
  end if;
  payload:=jsonb_build_object('account_id',p_account_id,'cafeteria_id',p_cafeteria_id,'pov_code',p_pov_code);
  fingerprint:=pikas_private.platform_request_fingerprint(payload);
  replay:=pikas_private.platform_replay_request(p_request_id,'sandbox_pov_enter',fingerprint,actor);
  if replay is not null then return replay; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261009));

  select ca.school_id into school_uuid from public.cafeterias ca
    join public.accounts ac on ac.id=ca.account_id and ac.status='active' and ac.tenant_kind='sandbox'
    where ca.id=p_cafeteria_id and ca.account_id=p_account_id
      and pikas_private.scope_active(ca.account_id,ca.school_id,ca.id);
  if school_uuid is null then
    raise exception using errcode='42501',message='sandbox_pov_not_available';
  end if;
  select pr.* into persona from pikas_private.sandbox_pov_personas pr
    join public.persons pp on pp.id=pr.person_id and pp.status='active' and pp.auth_user_id is null
    join public.cafeteria_memberships m on m.id=pr.cafeteria_membership_id and m.person_id=pp.id
      and m.status='active' and m.role_code='pos_cashier' and m.account_id=pr.account_id
      and m.school_id=pr.school_id and m.cafeteria_id=pr.cafeteria_id
    where pr.account_id=p_account_id and pr.cafeteria_id=p_cafeteria_id and pr.pov_code=p_pov_code
      and pr.status='active';
  if not found then
    raise exception using errcode='42501',message='sandbox_pov_not_available';
  end if;
  select pp.display_name into persona_name from public.persons pp where pp.id=persona.person_id;

  update pikas_private.sandbox_pov_sessions s set status='exited',ended_at=clock_timestamp(),end_reason='superseded'
    where s.initiator_person_id=actor and s.status='active';
  started:=clock_timestamp(); expiry:=started+interval '4 hours';
  insert into pikas_private.sandbox_pov_sessions(
    id,request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,
    persona_id,persona_person_id,persona_membership_id,started_at,expires_at
  ) values (
    session_uuid,p_request_id,actor,auth_actor,p_account_id,school_uuid,p_cafeteria_id,p_pov_code,
    persona.id,persona.person_id,persona.cafeteria_membership_id,started,expiry
  );
  result:=jsonb_build_object(
    'session_id',session_uuid,'account_id',p_account_id,'school_id',school_uuid,'cafeteria_id',p_cafeteria_id,
    'pov_code',p_pov_code,'persona_person_id',persona.person_id,'persona_display_name',persona_name,
    'persona_membership_id',persona.cafeteria_membership_id,'started_at',started,'expires_at',expiry);
  insert into pikas_private.platform_requests(
    request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response
  ) values(p_request_id,'sandbox_pov_enter',fingerprint,auth_actor,actor,result);
  perform pikas_private.record_platform_audit(
    p_request_id,actor,auth_actor,'platform:sandbox:pov:enter','sandbox_pov_entered','sandbox_pov_entered',
    p_account_id,school_uuid,null,p_cafeteria_id,persona.person_id,null,
    jsonb_build_object('session_id',session_uuid,'pov_code',p_pov_code,'persona_id',persona.id,
      'persona_membership_id',persona.cafeteria_membership_id,'expires_at',expiry));
  return result;
end $$;

create function public.platform_exit_sandbox_pov(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid; auth_actor uuid; payload jsonb; fingerprint text; replay jsonb; result jsonb;
  session_row pikas_private.sandbox_pov_sessions%rowtype;
begin
  actor:=pikas_private.require_platform_capability('platform:sandbox:pov:enter');
  auth_actor:=auth.uid();
  payload:='{}'::jsonb;
  fingerprint:=pikas_private.platform_request_fingerprint(payload);
  replay:=pikas_private.platform_replay_request(p_request_id,'sandbox_pov_exit',fingerprint,actor);
  if replay is not null then return replay; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261009));
  select s.* into session_row from pikas_private.sandbox_pov_sessions s
    where s.initiator_person_id=actor and s.status='active' for update;
  if not found then
    raise exception using errcode='23514',message='sandbox_pov_not_active';
  end if;
  update pikas_private.sandbox_pov_sessions s set status='exited',ended_at=clock_timestamp(),end_reason='exited'
    where s.id=session_row.id;
  result:=jsonb_build_object('session_id',session_row.id,'status','exited');
  insert into pikas_private.platform_requests(
    request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response
  ) values(p_request_id,'sandbox_pov_exit',fingerprint,auth_actor,actor,result);
  perform pikas_private.record_platform_audit(
    p_request_id,actor,auth_actor,'platform:sandbox:pov:enter','sandbox_pov_exited','sandbox_pov_exited',
    session_row.account_id,session_row.school_id,null,session_row.cafeteria_id,session_row.persona_person_id,null,
    jsonb_build_object('session_id',session_row.id,'pov_code',session_row.pov_code));
  return result;
end $$;

revoke all on function public.platform_enter_sandbox_pov(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.platform_exit_sandbox_pov(uuid) from public,anon,authenticated,service_role;
grant execute on function public.platform_enter_sandbox_pov(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.platform_exit_sandbox_pov(uuid) to authenticated;

-- F. Persona-aware receipt operator assertion and POS-only wrappers in the POS/register/checkout/receipt
-- contracts. The definitions below are the deployed definitions with ONLY the actor/capability helper
-- calls swapped for their POS-only counterparts.
CREATE OR REPLACE FUNCTION pikas_private.assert_receipt_operator(p_membership_id uuid, p_person_id uuid, p_register_id uuid, p_account_id uuid, p_school_id uuid, p_school_location_id uuid, p_cafeteria_id uuid, p_purchase_operator uuid, p_own_purchase_only boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare role_value text;
begin
 if p_person_id is null or p_person_id is distinct from pikas_private.pos_actor_person_id() then
  raise exception using errcode='42501',message='UNAUTHORIZED';
 end if;
 perform 1 from public.persons p where p.id=p_person_id and p.status='active'
  and (p.auth_user_id=auth.uid()
    or exists(select 1 from pikas_private.sandbox_pov_context() x where x.persona_person_id=p.id)) for share;
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
end $function$;

CREATE OR REPLACE FUNCTION public.list_my_operable_registers()
 RETURNS TABLE(cafeteria_id uuid, register_id uuid, assignment_id uuid, register_code text, display_name text, register_version integer, assignment_version integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
  actor:=pikas_private.pos_actor_person_id();
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
      and pikas_private.pos_is_operator_membership(ra.cafeteria_membership_id,actor,
        ra.account_id,ra.school_id,ra.cafeteria_id,'cafeteria:pos:session:open');
end $function$;

CREATE OR REPLACE FUNCTION public.get_my_open_register_session()
 RETURNS TABLE(session_id uuid, cafeteria_id uuid, register_id uuid, assignment_id uuid, register_code_snapshot text, register_name_snapshot text, opened_at timestamp with time zone, opened_business_date date, business_timezone_snapshot text, currency_code text, opening_cash_minor bigint, status text, version integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
  actor:=pikas_private.pos_actor_person_id();
  if actor is null then raise exception using errcode='42501',message='not_authorized'; end if;
  return query select rs.id,rs.cafeteria_id,rs.register_id,rs.assignment_id,rs.register_code_snapshot,
    rs.register_name_snapshot,rs.opened_at,rs.opened_business_date,rs.business_timezone_snapshot,
    rs.currency_code,rs.opening_cash_minor,rs.status,rs.version
  from public.register_sessions rs where rs.operator_person_id=actor and rs.status='open';
end $function$;

CREATE OR REPLACE FUNCTION public.open_register_session(p_register_id uuid, p_assignment_id uuid, p_opening_cash_minor bigint, p_open_request_key text)
 RETURNS TABLE(session_id uuid, status text, opened_at timestamp with time zone, currency_code text, version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; a uuid; s uuid; l uuid; c uuid; zone text; scope_row record;
  register_row public.cafeteria_registers%rowtype; assignment_row public.cafeteria_register_assignments%rowtype;
  membership_id uuid; role_value text; currency text; existing public.register_sessions%rowtype;
  fingerprint text; now_value timestamptz; new_id uuid;
begin
  actor:=pikas_private.pos_actor_person_id();
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
  if not found or not pikas_private.pos_is_operator_membership(membership_id,actor,a,s,c,'cafeteria:pos:session:open') then
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
end $function$;

CREATE OR REPLACE FUNCTION public.close_my_register_session(p_session_id uuid, p_expected_version integer, p_counted_cash_minor bigint, p_close_request_key text)
 RETURNS TABLE(session_id uuid, status text, closed_at timestamp with time zone, counted_cash_minor bigint, close_type text, version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; session_operator uuid; register_id_value uuid; a uuid; s uuid; c uuid;
  existing public.register_sessions%rowtype; fingerprint text; now_value timestamptz;
begin
  actor:=pikas_private.pos_actor_person_id();
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
end $function$;

CREATE OR REPLACE FUNCTION public.checkout_purchase(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid; v_request_key text; request_session_id uuid; request_customer_id uuid;
  request_tender_type text; request_cash_received bigint; expected_total bigint; expected_total_text text;
  items_json jsonb; tender_json jsonb; item_json jsonb; item_map jsonb:='{}'::jsonb;
  item_key text; item_value jsonb; product_uuid uuid; line_quantity integer; merged_quantity numeric;
  expected_version integer; expected_price numeric; canonical_items jsonb; snapshot_items jsonb:='[]'::jsonb;
  line record; line_number integer:=0; line_total numeric; total_numeric numeric:=0; total_minor bigint;
  account_uuid uuid; school_uuid uuid; campus_uuid uuid; cafeteria_uuid uuid; register_uuid uuid;
  session_row public.register_sessions%rowtype; scope_row record;
  existing_purchase public.purchases%rowtype; current_customer public.cafeteria_customers%rowtype;
  student_uuid uuid; staff_uuid uuid; student_name text; staff_name text; customer_type text;
  control_row public.student_spending_controls%rowtype; spent_today numeric:=0;
  wallet_row public.student_wallets%rowtype; wallet_balance_after bigint; wallet_version_after bigint;
  receivable public.staff_receivable_accounts%rowtype; receivable_balance_after bigint;
  staff_credit_tender_id uuid;
  setting_currency text; scheduling_on boolean; purchased_time timestamptz;
  service_row record; service_shift_uuid uuid; service_shift_name text; menu_uuid uuid; menu_name text;
  product_row public.cafeteria_products%rowtype; purchase_uuid uuid; number_value bigint;
  fingerprint text; result_json jsonb; item_count integer; change_minor bigint;
begin
  actor:=pikas_private.pos_actor_person_id();
  if actor is null then raise exception using errcode='42501',message='OPERATOR_NOT_AUTHORIZED'; end if;
  if p_request is null or jsonb_typeof(p_request)<>'object'
      or not (p_request ?& array['request_key','register_session_id','cafeteria_customer_id','items','tender'])
      or exists(select 1 from jsonb_object_keys(p_request) as k(key)
        where key not in ('request_key','register_session_id','cafeteria_customer_id','items','tender','expected_total_minor')) then
    raise exception using errcode='22023',message='INVALID_CHECKOUT_REQUEST';
  end if;
  if jsonb_typeof(p_request->'request_key')<>'string' or p_request->>'request_key' is null or length(p_request->>'request_key') not between 16 and 128 then
    raise exception using errcode='22023',message='INVALID_REQUEST_KEY';
  end if;
  v_request_key:=p_request->>'request_key';
  if jsonb_typeof(p_request->'register_session_id')<>'string'
      or (p_request->>'register_session_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='INVALID_REGISTER_SESSION_ID';
  end if;
  request_session_id:=(p_request->>'register_session_id')::uuid;
  if p_request->'cafeteria_customer_id'<>'null'::jsonb then
    if jsonb_typeof(p_request->'cafeteria_customer_id')<>'string'
        or (p_request->>'cafeteria_customer_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode='22023',message='INVALID_CAFETERIA_CUSTOMER_ID';
    end if;
    request_customer_id:=(p_request->>'cafeteria_customer_id')::uuid;
  end if;
  items_json:=p_request->'items';
  if jsonb_typeof(items_json)<>'array' or jsonb_array_length(items_json) not between 1 and 30 then
    raise exception using errcode='22023',message='INVALID_PURCHASE_ITEMS';
  end if;
  tender_json:=p_request->'tender';
  if jsonb_typeof(tender_json)<>'object' or jsonb_typeof(tender_json->'type')<>'string' then
    raise exception using errcode='22023',message='INVALID_TENDER';
  end if;
  request_tender_type:=tender_json->>'type';
  if request_tender_type='cash' then
    if (select count(*) from jsonb_object_keys(tender_json))<>2 or not (tender_json ? 'cash_received_minor')
        or jsonb_typeof(tender_json->'cash_received_minor')<>'string'
        or (tender_json->>'cash_received_minor') !~ '^(0|[1-9][0-9]{0,18})$' then
      raise exception using errcode='22023',message='INVALID_CASH_TENDER';
    end if;
    if (tender_json->>'cash_received_minor')::numeric>9223372036854775807::numeric then
      raise exception using errcode='22003',message='AMOUNT_OVERFLOW';
    end if;
    request_cash_received:=(tender_json->>'cash_received_minor')::bigint;
  elsif request_tender_type='student_wallet' then
    if (select count(*) from jsonb_object_keys(tender_json))<>1 then raise exception using errcode='22023',message='INVALID_WALLET_TENDER'; end if;
  elsif request_tender_type='staff_credit' then
    if (select count(*) from jsonb_object_keys(tender_json))<>1 then raise exception using errcode='22023',message='INVALID_STAFF_CREDIT_TENDER'; end if;
  else
    raise exception using errcode='22023',message='UNSUPPORTED_TENDER_TYPE';
  end if;
  if p_request ? 'expected_total_minor' then
    if jsonb_typeof(p_request->'expected_total_minor')<>'string'
        or (p_request->>'expected_total_minor') !~ '^(0|[1-9][0-9]{0,18})$'
        or (p_request->>'expected_total_minor')::numeric>9223372036854775807::numeric then
      raise exception using errcode='22023',message='INVALID_EXPECTED_TOTAL';
    end if;
    expected_total_text:=p_request->>'expected_total_minor';
    expected_total:=expected_total_text::bigint;
  end if;

  for item_json in select value from jsonb_array_elements(items_json) as x(value) loop
    if jsonb_typeof(item_json)<>'object' or (select count(*) from jsonb_object_keys(item_json))<>4
        or not (item_json ?& array['product_id','quantity','expected_product_version','expected_unit_price_minor'])
        or exists(select 1 from jsonb_object_keys(item_json) as k(key)
          where key not in ('product_id','quantity','expected_product_version','expected_unit_price_minor')) then
      raise exception using errcode='22023',message='INVALID_PURCHASE_ITEM_SHAPE';
    end if;
    if jsonb_typeof(item_json->'product_id')<>'string'
        or (item_json->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(item_json->'quantity')<>'number'
        or (item_json->>'quantity') !~ '^[0-9]+$'
        or jsonb_typeof(item_json->'expected_product_version')<>'number'
        or (item_json->>'expected_product_version') !~ '^[0-9]+$'
        or jsonb_typeof(item_json->'expected_unit_price_minor')<>'string'
        or (item_json->>'expected_unit_price_minor') !~ '^(0|[1-9][0-9]{0,18})$' then
      raise exception using errcode='22023',message='INVALID_PURCHASE_ITEM_VALUE';
    end if;
    product_uuid:=(item_json->>'product_id')::uuid;
    line_quantity:=(item_json->>'quantity')::integer;
    expected_version:=(item_json->>'expected_product_version')::integer;
    expected_price:=(item_json->>'expected_unit_price_minor')::numeric;
    if line_quantity<1 or line_quantity>20 or expected_version<1
        or expected_price>9223372036854775807::numeric then
      raise exception using errcode='22023',message='INVALID_PURCHASE_ITEM_VALUE';
    end if;
    item_key:=product_uuid::text;
    if item_map ? item_key then
      item_value:=item_map->item_key;
      if (item_value->>'version')::integer<>expected_version
          or (item_value->>'price')::numeric<>expected_price then
        raise exception using errcode='22023',message='DUPLICATE_PRODUCT_EVIDENCE_CONFLICT';
      end if;
      merged_quantity:=(item_value->>'quantity')::numeric+line_quantity::numeric;
      if merged_quantity>20 then raise exception using errcode='22023',message='INVALID_QUANTITY'; end if;
      item_map:=jsonb_set(item_map,array[item_key],jsonb_build_object('quantity',merged_quantity::integer,
        'version',expected_version,'price',expected_price::text),false);
    else
      item_map:=jsonb_set(item_map,array[item_key],jsonb_build_object('quantity',line_quantity,
        'version',expected_version,'price',expected_price::text),true);
    end if;
  end loop;
  select count(*)::integer into item_count from jsonb_object_keys(item_map);
  if item_count<1 or item_count>30 then raise exception using errcode='22023',message='INVALID_PURCHASE_ITEMS'; end if;
  select jsonb_agg(jsonb_build_object('product_id',e.key,'quantity',(e.value->>'quantity')::integer,
    'expected_product_version',(e.value->>'version')::integer,
    'expected_unit_price_minor',e.value->>'price') order by e.key)
    into canonical_items from jsonb_each(item_map) as e(key,value);

  select rs.* into session_row from public.register_sessions rs where rs.id=request_session_id;
  if not found then raise exception using errcode='42501',message='SESSION_NOT_FOUND'; end if;
  account_uuid:=session_row.account_id; school_uuid:=session_row.school_id; campus_uuid:=session_row.school_location_id;
  cafeteria_uuid:=session_row.cafeteria_id; register_uuid:=session_row.register_id;
  if session_row.operator_person_id<>actor then raise exception using errcode='42501',message='OPERATOR_NOT_AUTHORIZED'; end if;
  select * into scope_row from pikas_private.lock_active_cafeteria_scope(cafeteria_uuid);
  if not found or scope_row.account_id<>account_uuid or scope_row.school_id<>school_uuid
      or scope_row.school_location_id<>campus_uuid then
    raise exception using errcode='42501',message='INACTIVE_TENANT_SCOPE';
  end if;
  if not pikas_private.pos_has_capability('cafeteria:pos:purchase:create',account_uuid,school_uuid,cafeteria_uuid) then
    raise exception using errcode='42501',message='OPERATOR_NOT_AUTHORIZED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(account_uuid::text||':'||v_request_key,20261006));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261005));
  perform 1 from public.cafeteria_memberships m
    join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
    where m.id=session_row.operator_membership_id and m.account_id=account_uuid and m.school_id=school_uuid
      and m.cafeteria_id=cafeteria_uuid and m.person_id=actor and m.status='active'
      and m.role_code=session_row.operator_role_code and rc.capability='cafeteria:pos:purchase:create'
    for share of m;
  if not found then raise exception using errcode='42501',message='OPERATOR_NOT_AUTHORIZED'; end if;

  select p.* into existing_purchase from public.purchases p
    where p.account_id=account_uuid and p.request_key=v_request_key;
  if found then
    if existing_purchase.operator_person_id<>actor
        or not pikas_private.pos_has_capability('cafeteria:pos:purchase:create',existing_purchase.account_id,
          existing_purchase.school_id,existing_purchase.cafeteria_id) then
      raise exception using errcode='42501',message='OPERATOR_NOT_AUTHORIZED';
    end if;
    if existing_purchase.payload_fingerprint<>encode(extensions.digest(convert_to(jsonb_build_object(
      'account_id',account_uuid,'operator_person_id',actor,'operator_membership_id',session_row.operator_membership_id,
        'register_session_id',request_session_id,'cafeteria_customer_id',request_customer_id,
        'tender_type',request_tender_type,'cash_received_minor',request_cash_received::text,
        'expected_total_minor',expected_total_text,'items',canonical_items)::text,'UTF8'),'sha256'),'hex') then
      raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT';
    end if;
    return (select jsonb_build_object('purchase_id',p.id,'purchase_number',p.purchase_number::text,
      'purchased_at',p.purchased_at,'business_date',p.business_date,'business_timezone',p.business_timezone_snapshot,
      'currency_code',p.currency_code,'total_minor',p.total_minor::text,'register_id',p.register_id,
      'register_session_id',p.register_session_id,'cafeteria_customer_id',p.cafeteria_customer_id,
      'customer_type',p.customer_type_snapshot,'customer_name',p.customer_display_name_snapshot,
      'service_shift_id',p.service_shift_id,'service_shift_name',p.service_shift_name_snapshot,
      'menu_id',p.menu_id,'menu_name',p.menu_name_snapshot,
      'tender_type',t.tender_type,'cash_received_minor',ct.cash_received_minor::text,
      'change_due_minor',ct.change_due_minor::text,'wallet_balance_after_minor',wl.balance_after_minor::text,
      'items',(select jsonb_agg(jsonb_build_object('product_id',i.product_id,'name',i.product_name_snapshot,
        'product_version',i.product_version_snapshot,'unit_price_minor',i.unit_price_minor::text,
        'quantity',i.quantity,'line_total_minor',i.line_total_minor::text) order by i.line_number)
        from public.purchase_items i where i.purchase_id=p.id))
      from public.purchases p join public.purchase_tenders t on t.purchase_id=p.id
      left join public.purchase_cash_tenders ct on ct.tender_id=t.id
      left join public.purchase_wallet_tenders wt on wt.tender_id=t.id
      left join public.wallet_ledger_entries wl on wl.purchase_debit_id=wt.wallet_purchase_debit_id
      where p.id=existing_purchase.id);
  end if;

  if not exists(select 1 from public.cafeteria_registers r where r.id=register_uuid
      and r.account_id=account_uuid and r.school_id=school_uuid and r.school_location_id=campus_uuid
      and r.cafeteria_id=cafeteria_uuid and r.status='active' for share) then
    raise exception using errcode='23514',message='REGISTER_INACTIVE';
  end if;
  if not exists(select 1 from public.cafeteria_register_assignments ra
      where ra.id=session_row.assignment_id and ra.account_id=account_uuid and ra.school_id=school_uuid
        and ra.school_location_id=campus_uuid and ra.cafeteria_id=cafeteria_uuid
        and ra.register_id=register_uuid and ra.operator_person_id=actor and ra.cafeteria_membership_id=session_row.operator_membership_id
        and ra.status='active' for share) then
    raise exception using errcode='42501',message='ASSIGNMENT_INACTIVE';
  end if;
  perform 1 from public.cafeteria_memberships m
    join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
    where m.id=session_row.operator_membership_id and m.person_id=actor and m.status='active'
      and m.account_id=account_uuid and m.school_id=school_uuid and m.cafeteria_id=cafeteria_uuid
      and rc.capability='cafeteria:pos:purchase:create' for share of m;
  if not found then raise exception using errcode='42501',message='OPERATOR_NOT_AUTHORIZED'; end if;
  select rs.* into session_row from public.register_sessions rs where rs.id=request_session_id for share;
  if not found or session_row.status<>'open' or session_row.operator_person_id<>actor
      or session_row.register_id<>register_uuid or session_row.cafeteria_id<>cafeteria_uuid then
    raise exception using errcode='23514',message='SESSION_CLOSED';
  end if;
  select os.catalog_currency_code,os.scheduling_enabled into setting_currency,scheduling_on
    from public.cafeteria_operation_settings os where os.account_id=account_uuid
      and os.school_id=school_uuid and os.cafeteria_id=cafeteria_uuid for share;
  if not found or setting_currency<>session_row.currency_code then
    raise exception using errcode='23514',message='SESSION_CURRENCY_MISMATCH';
  end if;
  if scheduling_on then
    -- Frozen 4B shift RPCs lock this advisory key before shift rows. Its menu/product triggers take it after row locks;
    -- checkout therefore reads their committed MVCC versions under the shared fence without waiting on those rows.
    perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(cafeteria_uuid::text,20261004));
  end if;
  perform 1 from public.supported_currencies cu where cu.currency_code=setting_currency and cu.status='enabled' for share;
  if not found then raise exception using errcode='23514',message='CURRENCY_DISABLED'; end if;

  if request_tender_type in ('student_wallet','staff_credit') and request_customer_id is null then
    raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE';
  end if;
  if request_customer_id is not null then
    select cc.* into current_customer from public.cafeteria_customers cc
      where cc.id=request_customer_id and cc.account_id=account_uuid and cc.school_id=school_uuid
        and cc.cafeteria_id=cafeteria_uuid and cc.status='active' for share;
    if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
    perform 1 from public.school_cafeteria_shares sh
      join public.school_cafeteria_share_categories cat on cat.share_id=sh.id
      where sh.account_id=account_uuid and sh.school_id=school_uuid and sh.cafeteria_id=cafeteria_uuid
        and sh.status='active' and cat.category='basic_identification' and cat.enabled
      for share of sh,cat;
    if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
    if current_customer.student_id is not null then
      customer_type:='student'; student_uuid:=current_customer.student_id;
      select st.display_name into student_name from public.students st
        join public.persons person on person.id=st.person_id and person.status='active'
        where st.id=student_uuid and st.account_id=account_uuid and st.school_id=school_uuid and st.status='active'
        for share of st,person;
      if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
    elsif current_customer.staff_affiliation_id is not null then
      customer_type:='staff'; staff_uuid:=current_customer.staff_affiliation_id;
      if request_tender_type='student_wallet' then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
      select person.display_name into staff_name from public.school_staff_affiliations sf
        join public.persons person on person.id=sf.person_id and person.status='active'
        where sf.id=staff_uuid and sf.account_id=account_uuid and sf.school_id=school_uuid and sf.status='active'
        for share of sf,person;
      if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
      if request_tender_type='staff_credit' then
        perform 1 from public.staff_campus_affiliations sca
         where sca.account_id=account_uuid and sca.school_id=school_uuid
          and sca.staff_affiliation_id=staff_uuid and sca.school_location_id=campus_uuid
          and sca.status='active' for share;
        if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
        perform 1 from pikas_private.role_capabilities rc
        join public.cafeteria_memberships m on m.scope_kind=rc.scope_kind and m.role_code=rc.role_code
        where m.id=session_row.operator_membership_id and m.person_id=actor
         and m.account_id=account_uuid and m.school_id=school_uuid and m.cafeteria_id=cafeteria_uuid
         and rc.capability='cafeteria:pos:staff_credit:purchase';
        if not found then raise exception using errcode='42501',message='STAFF_CREDIT_NOT_AUTHORIZED'; end if;
        select a.* into receivable from public.staff_receivable_accounts a
         where a.account_id=account_uuid and a.school_id=school_uuid
          and a.staff_affiliation_id=staff_uuid and a.currency_code=setting_currency for update;
        if not found or not receivable.credit_enabled then
         raise exception using errcode='23514',message='STAFF_CREDIT_DISABLED';
        end if;
      end if;
    else
      raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE';
    end if;
  end if;
  if request_tender_type='student_wallet' and student_uuid is null then
    raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE';
  end if;
  if request_tender_type='staff_credit' and (staff_uuid is null or customer_type<>'staff') then
    raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE';
  end if;
  if student_uuid is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(student_uuid::text,0));
    perform 1 from public.student_enrollments en
      where en.account_id=account_uuid and en.school_id=school_uuid and en.student_id=student_uuid
        and en.status='active' for share;
    if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
    select sc.* into control_row from public.student_spending_controls sc
      where sc.account_id=account_uuid and sc.school_id=school_uuid and sc.student_id=student_uuid
        and sc.currency_code=setting_currency for share;
    if request_tender_type='student_wallet' then
      select w.* into wallet_row from public.student_wallets w where w.account_id=account_uuid
        and w.school_id=school_uuid and w.student_id=student_uuid and w.currency_code=setting_currency for update;
      if not found or wallet_row.status<>'active' then raise exception using errcode='23514',message='WALLET_FROZEN'; end if;
    end if;
  end if;

  for line in select e.key from jsonb_each(item_map) as e(key) order by e.key loop
    perform 1 from public.cafeteria_products p where p.id=line.key::uuid
      and p.account_id=account_uuid and p.school_id=school_uuid and p.cafeteria_id=cafeteria_uuid for share;
    if not found then raise exception using errcode='23503',message='PRODUCT_UNAVAILABLE'; end if;
  end loop;
  perform 1 from public.cafeteria_purchase_counters c where c.cafeteria_id=cafeteria_uuid
    and c.account_id=account_uuid and c.school_id=school_uuid and c.school_location_id=campus_uuid for update;
  if not found then raise exception using errcode='23514',message='PURCHASE_COUNTER_MISSING'; end if;

  purchased_time:=clock_timestamp();
  select * into service_row from pikas_private.resolve_cafeteria_service_at(cafeteria_uuid,purchased_time);
  if not found then raise exception using errcode='23514',message='NO_ACTIVE_SERVICE'; end if;
  if not scheduling_on then
    if service_row.status<>'manual' then raise exception using errcode='23514',message='NO_ACTIVE_SERVICE'; end if;
  elsif service_row.status<>'active' then
    raise exception using errcode='23514',message='NO_ACTIVE_SERVICE';
  end if;
  if scheduling_on then
    service_shift_uuid:=service_row.service_shift_id; service_shift_name:=service_row.service_shift_name;
    menu_uuid:=service_row.menu_id; menu_name:=service_row.menu_name;
  end if;

  for line in select e.key,e.value from jsonb_each(item_map) as e(key,value) order by e.key loop
    product_uuid:=line.key::uuid;
    expected_version:=(line.value->>'version')::integer;
    expected_price:=(line.value->>'price')::numeric;
    line_quantity:=(line.value->>'quantity')::integer;
    select p.* into product_row from public.cafeteria_products p where p.id=product_uuid
      and p.account_id=account_uuid and p.school_id=school_uuid and p.cafeteria_id=cafeteria_uuid for share;
    if not found then raise exception using errcode='23503',message='PRODUCT_UNAVAILABLE'; end if;
    if product_row.version<>expected_version or product_row.price_minor::numeric<>expected_price then
      raise exception using errcode='40001',message='PRODUCT_STALE';
    end if;
    if not product_row.active or not product_row.available then
      raise exception using errcode='23514',message='PRODUCT_UNAVAILABLE';
    end if;
    if scheduling_on and not exists(select 1 from public.cafeteria_menu_products mp
        where mp.account_id=account_uuid and mp.school_id=school_uuid and mp.cafeteria_id=cafeteria_uuid
          and mp.menu_id=menu_uuid and mp.product_id=product_uuid and mp.active) then
      raise exception using errcode='23514',message='PRODUCT_UNAVAILABLE';
    end if;
    line_total:=product_row.price_minor::numeric*line_quantity::numeric;
    if line_total>9223372036854775807::numeric or total_numeric+line_total>9223372036854775807::numeric then
      raise exception using errcode='22003',message='AMOUNT_OVERFLOW';
    end if;
    total_numeric:=total_numeric+line_total;
    line_number:=line_number+1;
    snapshot_items:=snapshot_items||jsonb_build_array(jsonb_build_object('product_id',product_uuid,
      'line_number',line_number,'name',product_row.name,'version',product_row.version,
      'unit_price_minor',product_row.price_minor::text,'quantity',line_quantity,'line_total_minor',line_total::text));
  end loop;
  total_minor:=total_numeric::bigint;
  if expected_total is not null and expected_total<>total_minor then
    raise exception using errcode='40001',message='TOTAL_STALE';
  end if;
  if request_tender_type='student_wallet' and total_minor=0 then
    raise exception using errcode='22023',message='ZERO_TOTAL_WALLET_NOT_ALLOWED';
  end if;
  if request_tender_type='staff_credit' and total_minor=0 then
    raise exception using errcode='22023',message='ZERO_TOTAL_STAFF_CREDIT_NOT_ALLOWED';
  end if;
  if request_tender_type='cash' and request_cash_received<total_minor then
    raise exception using errcode='22023',message='CASH_INSUFFICIENT';
  end if;

  if student_uuid is not null then
    select sc.* into control_row from public.student_spending_controls sc
      where sc.account_id=account_uuid and sc.school_id=school_uuid and sc.student_id=student_uuid
        and sc.currency_code=setting_currency for share;
    if found then
      if control_row.per_transaction_limit_enabled and total_minor>control_row.per_transaction_limit_minor then
        raise exception using errcode='23514',message='TRANSACTION_LIMIT_EXCEEDED';
      end if;
      if control_row.daily_limit_enabled and total_minor>0 then
        select coalesce(sum(d.amount_minor::numeric),0) into spent_today from public.student_daily_spend_events d
          where d.account_id=account_uuid and d.school_id=school_uuid and d.student_id=student_uuid
            and d.business_date=service_row.business_date and d.currency_code=setting_currency;
        if spent_today+total_minor::numeric>control_row.daily_limit_minor::numeric then
          raise exception using errcode='23514',message='DAILY_LIMIT_EXCEEDED';
        end if;
      end if;
    end if;
  end if;

  if request_tender_type='student_wallet' then
    select w.* into wallet_row from public.student_wallets w where w.account_id=account_uuid
      and w.school_id=school_uuid and w.student_id=student_uuid and w.currency_code=setting_currency for update;
    if not found or wallet_row.status<>'active' then raise exception using errcode='23514',message='WALLET_FROZEN'; end if;
    if wallet_row.current_balance_minor<total_minor then raise exception using errcode='23514',message='INSUFFICIENT_BALANCE'; end if;
    if wallet_row.balance_version=9223372036854775807 then raise exception using errcode='22003',message='AMOUNT_OVERFLOW'; end if;
    wallet_balance_after:=wallet_row.current_balance_minor-total_minor;
    wallet_version_after:=wallet_row.balance_version+1;
  elsif request_tender_type='staff_credit' then
    if receivable.id is null then
      raise exception using errcode='23514',message='STAFF_CREDIT_DISABLED';
    end if;
    if receivable.balance_version=9223372036854775807 then
      raise exception using errcode='22003',message='STAFF_RECEIVABLE_VERSION_EXHAUSTED';
    end if;
    if receivable.current_balance_minor::numeric+total_minor::numeric>9223372036854775807::numeric then
      raise exception using errcode='22003',message='STAFF_RECEIVABLE_BALANCE_OVERFLOW';
    end if;
    receivable_balance_after:=receivable.current_balance_minor+total_minor;
    if receivable.credit_limit_minor is not null
     and receivable_balance_after>receivable.credit_limit_minor then
      raise exception using errcode='23514',message='STAFF_CREDIT_LIMIT_EXCEEDED';
    end if;
  end if;

  if cafeteria_uuid is null then raise exception using errcode='23514',message='PURCHASE_COUNTER_MISSING'; end if;
  update public.cafeteria_purchase_counters c set last_purchase_number=c.last_purchase_number+1,
      updated_at=clock_timestamp()
    where c.cafeteria_id=cafeteria_uuid and c.account_id=account_uuid and c.school_id=school_uuid
      and c.school_location_id=campus_uuid and c.last_purchase_number<9223372036854775807
    returning c.last_purchase_number into number_value;
  if not found then raise exception using errcode='22003',message='PURCHASE_NUMBER_EXHAUSTED'; end if;

  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('account_id',account_uuid,
    'operator_person_id',actor,'operator_membership_id',session_row.operator_membership_id,
    'register_session_id',request_session_id,'cafeteria_customer_id',request_customer_id,
    'tender_type',request_tender_type,'cash_received_minor',request_cash_received::text,
    'expected_total_minor',expected_total_text,'items',canonical_items)::text,'UTF8'),'sha256'),'hex');
  insert into public.purchases(account_id,school_id,school_location_id,cafeteria_id,purchase_number,
    register_id,register_session_id,operator_person_id,operator_membership_id,operator_role_code,
    cafeteria_customer_id,customer_type_snapshot,customer_display_name_snapshot,student_id,staff_affiliation_id,
    business_timezone_snapshot,business_date,purchased_at,currency_code,total_minor,
    service_shift_id,service_shift_name_snapshot,menu_id,menu_name_snapshot,request_key,payload_fingerprint)
  values(account_uuid,school_uuid,campus_uuid,cafeteria_uuid,number_value,register_uuid,request_session_id,
    actor,session_row.operator_membership_id,session_row.operator_role_code,request_customer_id,customer_type,
    case when customer_type='student' then student_name when customer_type='staff' then staff_name else null end,
    student_uuid,staff_uuid,scope_row.business_timezone,service_row.business_date,purchased_time,setting_currency,
    total_minor,service_shift_uuid,service_shift_name,menu_uuid,menu_name,v_request_key,fingerprint)
  returning id into purchase_uuid;

  for line in select value from jsonb_array_elements(snapshot_items) as x(value) loop
    insert into public.purchase_items(account_id,school_id,school_location_id,cafeteria_id,purchase_id,
      line_number,product_id,product_name_snapshot,product_version_snapshot,unit_price_minor,quantity,line_total_minor)
    values(account_uuid,school_uuid,campus_uuid,cafeteria_uuid,purchase_uuid,(line.value->>'line_number')::smallint,
      (line.value->>'product_id')::uuid,line.value->>'name',(line.value->>'version')::integer,
      (line.value->>'unit_price_minor')::bigint,(line.value->>'quantity')::integer,(line.value->>'line_total_minor')::bigint);
  end loop;

  if request_tender_type='cash' then
    change_minor:=(request_cash_received::numeric-total_minor::numeric)::bigint;
    insert into public.purchase_tenders(account_id,school_id,cafeteria_id,purchase_id,currency_code,tender_type)
    values(account_uuid,school_uuid,cafeteria_uuid,purchase_uuid,setting_currency,'cash') returning id into product_uuid;
    insert into public.purchase_cash_tenders(tender_id,cash_received_minor,change_due_minor)
    values(product_uuid,request_cash_received,change_minor);
  elsif request_tender_type='student_wallet' then
    insert into public.wallet_purchase_debits(account_id,school_id,cafeteria_id,student_id,wallet_id,
      currency_code,purchase_id,amount_minor,actor_person_id,posted_at)
    values(account_uuid,school_uuid,cafeteria_uuid,student_uuid,wallet_row.id,setting_currency,purchase_uuid,
      total_minor,actor,purchased_time) returning id into product_uuid;
    update public.student_wallets set current_balance_minor=wallet_balance_after,
      balance_version=wallet_version_after where id=wallet_row.id;
    insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,
      balance_after_minor,balance_version_after,purchase_debit_id,occurred_at)
    values(account_uuid,school_uuid,wallet_row.id,setting_currency,'purchase',-total_minor,
      wallet_balance_after,wallet_version_after,product_uuid,purchased_time);
    insert into public.purchase_tenders(account_id,school_id,cafeteria_id,purchase_id,currency_code,tender_type)
    values(account_uuid,school_uuid,cafeteria_uuid,purchase_uuid,setting_currency,'student_wallet') returning id into register_uuid;
    insert into public.purchase_wallet_tenders(tender_id,account_id,school_id,cafeteria_id,purchase_id,
      student_id,wallet_id,currency_code,wallet_purchase_debit_id)
    values(register_uuid,account_uuid,school_uuid,cafeteria_uuid,purchase_uuid,student_uuid,wallet_row.id,
      setting_currency,product_uuid);
  else
    insert into public.purchase_tenders(account_id,school_id,cafeteria_id,purchase_id,currency_code,tender_type)
    values(account_uuid,school_uuid,cafeteria_uuid,purchase_uuid,setting_currency,'staff_credit')
    returning id into staff_credit_tender_id;
    insert into public.purchase_staff_credit_tenders(tender_id,account_id,school_id,school_location_id,
      cafeteria_id,purchase_id,receivable_account_id,currency_code,tender_type,amount_minor,posted_at)
    values(staff_credit_tender_id,account_uuid,school_uuid,campus_uuid,cafeteria_uuid,purchase_uuid,
      receivable.id,setting_currency,'staff_credit',total_minor,purchased_time);
  end if;
  if student_uuid is not null and total_minor>0 then
    insert into public.student_daily_spend_events(account_id,school_id,cafeteria_id,student_id,business_date,
      currency_code,purchase_id,amount_minor,occurred_at)
    values(account_uuid,school_uuid,cafeteria_uuid,student_uuid,service_row.business_date,
      setting_currency,purchase_uuid,total_minor,purchased_time);
  end if;
  perform pikas_private.record_purchase_audit(actor,auth.uid(),session_row.operator_role_code,
    account_uuid,school_uuid,cafeteria_uuid,'purchase_committed','purchases',purchase_uuid);
  select jsonb_build_object('purchase_id',p.id,'purchase_number',p.purchase_number::text,
    'purchased_at',p.purchased_at,'business_date',p.business_date,'business_timezone',p.business_timezone_snapshot,
    'currency_code',p.currency_code,'total_minor',p.total_minor::text,'register_id',p.register_id,
    'register_session_id',p.register_session_id,'cafeteria_customer_id',p.cafeteria_customer_id,
    'customer_type',p.customer_type_snapshot,'customer_name',p.customer_display_name_snapshot,
    'service_shift_id',p.service_shift_id,'service_shift_name',p.service_shift_name_snapshot,
    'menu_id',p.menu_id,'menu_name',p.menu_name_snapshot,'tender_type',t.tender_type,
    'cash_received_minor',ct.cash_received_minor::text,'change_due_minor',ct.change_due_minor::text,
    'wallet_balance_after_minor',case when wt.wallet_id is null then null else wl.balance_after_minor::text end,
    'items',(select jsonb_agg(jsonb_build_object('product_id',i.product_id,'name',i.product_name_snapshot,
      'product_version',i.product_version_snapshot,'unit_price_minor',i.unit_price_minor::text,
      'quantity',i.quantity,'line_total_minor',i.line_total_minor::text) order by i.line_number)
      from public.purchase_items i where i.purchase_id=p.id)) into result_json
  from public.purchases p join public.purchase_tenders t on t.purchase_id=p.id
  left join public.purchase_cash_tenders ct on ct.tender_id=t.id
  left join public.purchase_wallet_tenders wt on wt.tender_id=t.id
  left join public.wallet_ledger_entries wl on wl.purchase_debit_id=wt.wallet_purchase_debit_id
  where p.id=purchase_uuid;
  return result_json;
end $function$;

CREATE OR REPLACE FUNCTION public.cafeteria_customer_projection(p_cafeteria_id uuid, p_query text)
 RETURNS TABLE(customer_id uuid, customer_type text, display_name text, student_code text, grade_label text, class_label text, restrictions jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; allowed_categories text[];
begin
  if p_query is null or length(btrim(p_query)) not between 2 and 80
      or position('%' in p_query)>0 or position('_' in p_query)>0 or position(pg_catalog.chr(92) in p_query)>0 then return; end if;
  select c.account_id,c.school_id into a,s from public.cafeterias c
    join public.school_locations l on l.account_id=c.account_id and l.school_id=c.school_id and l.id=c.school_location_id
    where c.id=p_cafeteria_id and c.status='active' and l.status='active';
  if a is null or not pikas_private.pos_has_capability('cafeteria:customer:lookup',a,s,p_cafeteria_id) then return; end if;
  select array_agg(c.category) into allowed_categories
    from public.school_cafeteria_shares sh join public.school_cafeteria_share_categories c on c.share_id=sh.id
    where sh.account_id=a and sh.school_id=s and sh.cafeteria_id=p_cafeteria_id and sh.status='active' and c.enabled;
  if not ('basic_identification'=any(coalesce(allowed_categories,'{}'::text[]))) then return; end if;
  return query
    select cc.id,'student'::text,st.display_name,
      case when 'student_code'=any(allowed_categories) then st.student_code else null end,
      case when 'placement'=any(allowed_categories) then pl.grade_label else null end,
      case when 'placement'=any(allowed_categories) then pl.class_label else null end,
      case when 'dietary_restrictions'=any(allowed_categories) then coalesce((select jsonb_agg(jsonb_build_object('type',r.restriction_type,'code',r.restriction_code,'label',r.display_label) order by r.restriction_type,r.code_key)
        from public.student_dietary_restrictions r where r.student_id=st.id and r.status='active'),'[]'::jsonb) else '[]'::jsonb end
    from public.cafeteria_customers cc join public.students st on st.account_id=cc.account_id and st.school_id=cc.school_id and st.id=cc.student_id
    join public.persons sp on sp.id=st.person_id and sp.status='active'
    join public.student_enrollments en on en.account_id=st.account_id and en.school_id=st.school_id and en.student_id=st.id and en.status='active'
    left join public.student_campus_placements pl on pl.account_id=en.account_id and pl.school_id=en.school_id and pl.enrollment_id=en.id and pl.status='active'
    where cc.account_id=a and cc.school_id=s and cc.cafeteria_id=p_cafeteria_id and cc.status='active'
      and st.status='active' and (lower(st.display_name) like '%'||lower(btrim(p_query))||'%' or
        ('student_code'=any(allowed_categories) and lower(st.student_code) like '%'||lower(btrim(p_query))||'%'))
    union all
    select cc.id,'staff'::text,p.display_name,null::text,null::text,null::text,'[]'::jsonb
    from public.cafeteria_customers cc join public.school_staff_affiliations sf
      on sf.account_id=cc.account_id and sf.school_id=cc.school_id and sf.id=cc.staff_affiliation_id
    join public.persons p on p.id=sf.person_id and p.status='active'
    where cc.account_id=a and cc.school_id=s and cc.cafeteria_id=p_cafeteria_id and cc.status='active'
      and sf.status='active' and lower(p.display_name) like '%'||lower(btrim(p_query))||'%'
    limit 20;
end $function$;

CREATE OR REPLACE FUNCTION public.get_cafeteria_saleable_catalog(p_cafeteria_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid;
begin
  select ca.account_id,ca.school_id into a,s from public.cafeterias ca where ca.id=p_cafeteria_id;
  if not found or not (pikas_private.pos_has_capability('cafeteria:catalog:read',a,s,p_cafeteria_id)
      or pikas_private.pos_has_capability('cafeteria:pos:catalog:read',a,s,p_cafeteria_id)) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  return pikas_private.saleable_catalog_at(p_cafeteria_id,pg_catalog.now());
end $function$;

CREATE OR REPLACE FUNCTION public.claim_purchase_receipt_print_job(p_register_id uuid, p_membership_id uuid, p_purchase_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; a uuid; s uuid; loc uuid; c uuid; target public.receipt_print_jobs%rowtype;
 p public.purchases%rowtype; r public.cafeteria_registers%rowtype;
 token uuid; expiry timestamptz; snapshot_value jsonb;
begin
 actor:=pikas_private.pos_actor_person_id();
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
end $function$;

CREATE OR REPLACE FUNCTION public.report_receipt_print_job(p_job_id uuid, p_claim_token uuid, p_result text, p_error_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; j public.receipt_print_jobs%rowtype; p public.purchases%rowtype;
begin
 actor:=pikas_private.pos_actor_person_id();
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
end $function$;

CREATE OR REPLACE FUNCTION public.retry_receipt_print_job(p_job_id uuid, p_membership_id uuid, p_acknowledge_possible_duplicate boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; j public.receipt_print_jobs%rowtype; p public.purchases%rowtype; role_value text;
begin
 actor:=pikas_private.pos_actor_person_id();
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
end $function$;

CREATE OR REPLACE FUNCTION public.request_purchase_receipt_reprint(p_purchase_id uuid, p_register_id uuid, p_membership_id uuid, p_request_key text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; p public.purchases%rowtype; original public.receipt_print_jobs%rowtype;
 role_value text; fp text; j public.receipt_print_jobs%rowtype;
begin
 actor:=pikas_private.pos_actor_person_id();
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
end $function$;

-- H. Narrow, cashier-safe, informational pre-sale purchasing context. checkout_purchase remains the
-- sole financial authority and revalidates every rule at sale time.
create function public.get_pos_customer_purchase_context(p_cafeteria_id uuid,p_cafeteria_customer_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a uuid; s uuid; currency text; as_of timestamptz; service_row record; customer public.cafeteria_customers%rowtype;
  allowed_categories text[]; wallet public.student_wallets%rowtype; control public.student_spending_controls%rowtype;
  wallet_found boolean:=false; control_found boolean:=false; spent numeric:=0; remaining numeric; available numeric;
  restrictions jsonb:='[]'::jsonb; result jsonb;
begin
  select ca.account_id,ca.school_id into a,s from public.cafeterias ca where ca.id=p_cafeteria_id;
  if not found
    or not pikas_private.pos_has_capability('cafeteria:customer:lookup',a,s,p_cafeteria_id)
    or not pikas_private.pos_has_capability('cafeteria:pos:purchase:create',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  select os.catalog_currency_code into currency from public.cafeteria_operation_settings os
    where os.account_id=a and os.school_id=s and os.cafeteria_id=p_cafeteria_id;
  as_of:=clock_timestamp();
  select * into service_row from pikas_private.resolve_cafeteria_service_at(p_cafeteria_id,as_of);
  if currency is null or not found then
    raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE';
  end if;
  select array_agg(cat.category) into allowed_categories
    from public.school_cafeteria_shares sh join public.school_cafeteria_share_categories cat on cat.share_id=sh.id
    where sh.account_id=a and sh.school_id=s and sh.cafeteria_id=p_cafeteria_id and sh.status='active' and cat.enabled;
  select cc.* into customer from public.cafeteria_customers cc
    where cc.id=p_cafeteria_customer_id and cc.account_id=a and cc.school_id=s
      and cc.cafeteria_id=p_cafeteria_id and cc.status='active';
  if not found or not ('basic_identification'=any(coalesce(allowed_categories,'{}'::text[]))) then
    raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE';
  end if;

  if customer.student_id is not null then
    perform 1 from public.students st
      join public.persons sp on sp.id=st.person_id and sp.status='active'
      join public.student_enrollments en on en.account_id=st.account_id and en.school_id=st.school_id
        and en.student_id=st.id and en.status='active'
      where st.id=customer.student_id and st.account_id=a and st.school_id=s and st.status='active';
    if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
    select w.* into wallet from public.student_wallets w where w.account_id=a and w.school_id=s
      and w.student_id=customer.student_id and w.currency_code=currency;
    wallet_found:=found;
    select sc.* into control from public.student_spending_controls sc where sc.account_id=a and sc.school_id=s
      and sc.student_id=customer.student_id and sc.currency_code=currency;
    control_found:=found;
    select coalesce(sum(d.amount_minor::numeric),0) into spent from public.student_daily_spend_events d
      where d.account_id=a and d.school_id=s and d.student_id=customer.student_id
        and d.business_date=service_row.business_date and d.currency_code=currency;
    if 'dietary_restrictions'=any(allowed_categories) then
      select coalesce(jsonb_agg(jsonb_build_object('type',r.restriction_type,'code',r.restriction_code,
          'label',r.display_label) order by r.restriction_type,r.code_key),'[]'::jsonb) into restrictions
        from public.student_dietary_restrictions r where r.student_id=customer.student_id and r.status='active';
    end if;
    if not wallet_found or wallet.status<>'active' then
      available:=0;
    else
      available:=wallet.current_balance_minor::numeric;
      if control_found and control.daily_limit_enabled then
        remaining:=greatest(0,control.daily_limit_minor::numeric-spent);
        available:=least(available,remaining);
      end if;
    end if;
    result:=jsonb_build_object(
      'customer_id',customer.id,'customer_type','student','currency_code',currency,
      'business_date',service_row.business_date,'business_timezone',service_row.business_timezone,'as_of',as_of,
      'wallet',case when wallet_found then jsonb_build_object('status',wallet.status,
        'balance_minor',wallet.current_balance_minor::text) else null end,
      'daily_limit',jsonb_build_object('enabled',coalesce(control.daily_limit_enabled,false),
        'limit_minor',case when coalesce(control.daily_limit_enabled,false) then control.daily_limit_minor::text else null end),
      'per_transaction_limit',jsonb_build_object('enabled',coalesce(control.per_transaction_limit_enabled,false),
        'limit_minor',case when coalesce(control.per_transaction_limit_enabled,false) then control.per_transaction_limit_minor::text else null end),
      'spent_today_minor',spent::text,'available_today_minor',available::text,'restrictions',restrictions);
  elsif customer.staff_affiliation_id is not null then
    perform 1 from public.school_staff_affiliations sf
      join public.persons p on p.id=sf.person_id and p.status='active'
      where sf.id=customer.staff_affiliation_id and sf.account_id=a and sf.school_id=s and sf.status='active';
    if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
    result:=jsonb_build_object(
      'customer_id',customer.id,'customer_type','staff','currency_code',currency,
      'business_date',service_row.business_date,'business_timezone',service_row.business_timezone,'as_of',as_of,
      'wallet',null,'daily_limit',null,'per_transaction_limit',null,
      'spent_today_minor',null,'available_today_minor',null,'restrictions','[]'::jsonb);
  else
    raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE';
  end if;
  return result;
end $$;

revoke all on function public.get_pos_customer_purchase_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_pos_customer_purchase_context(uuid,uuid) to authenticated;

comment on table pikas_private.sandbox_pov_sessions is 'Real PIKAS operator sandbox POV sessions; never tenant authority and never customer-visible.';
comment on table pikas_private.sandbox_pov_operation_links is 'Append-only link from sandbox POV sessions to persona-attributed register sessions and purchases.';

commit;
