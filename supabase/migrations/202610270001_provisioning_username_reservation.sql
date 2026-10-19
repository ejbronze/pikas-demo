-- Phase 6A completion: username chosen at provisioning time. Additive and forward-safe.
--
-- A username is RESERVED on the existing provisioning record (public.invitations or
-- pikas_private.platform_customer_admin_intents) before any Person exists. No parallel invitation
-- system, no Person and no Auth user is created for the reservation. A reservation is LIVE only
-- while its record is live (invitation 'pending' and unexpired; intent 'pending'/'linked' and
-- unexpired), so revoked, accepted, superseded or expired provisioning never traps a username.
-- One transaction-scoped advisory lock per normalized username serializes every claim: provisioning
-- reservations and Person usernames (pikas_private.login_identities) alike.
-- On completion the existing flows create/reuse the Person exactly as before; a trigger then
-- attaches the reserved username to that Person in the same transaction (never renaming an
-- existing username) and audits it. Legacy records keep intended_username null.
begin;

alter table public.invitations add column intended_username text
 check (intended_username is null or pikas_private.valid_username(intended_username));
alter table pikas_private.platform_customer_admin_intents add column intended_username text
 check (intended_username is null or pikas_private.valid_username(intended_username));
create index invitations_intended_username_idx on public.invitations(intended_username) where intended_username is not null;
create index platform_customer_admin_intents_intended_username_idx on pikas_private.platform_customer_admin_intents(intended_username) where intended_username is not null;

-- Idempotency binding for the username part of a provisioning request (the wrapped command keeps
-- its own journal). Same key + different username is a reused key, never a silent change.
create table pikas_private.provisioning_username_requests (
 request_id uuid primary key,
 actor_auth_user_id uuid not null,
 flow text not null check (flow in ('cafeteria_staff','school_admin','cafeteria_admin','customer_admin')),
 username text not null check (pikas_private.valid_username(username)),
 source_id uuid not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table pikas_private.provisioning_username_requests enable row level security;
revoke all on pikas_private.provisioning_username_requests from public, anon, authenticated, service_role;

create function pikas_private.lock_username(p_username text) returns void
language sql volatile security definer set search_path='' as $$
 select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pikas_username:'||p_username,20261027))
$$;

-- Live provisioning reservations of a username held for an email OTHER than p_email_key.
create function pikas_private.username_reserved_elsewhere(p_username text,p_email_key text,p_skip uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.invitations i where i.intended_username=p_username and i.status='pending' and i.expires_at>clock_timestamp()
   and i.email_key is distinct from p_email_key and i.id is distinct from p_skip)
  or exists(select 1 from pikas_private.platform_customer_admin_intents t where t.intended_username=p_username and t.status in ('pending','linked')
   and t.expires_at>clock_timestamp() and t.intended_email_key is distinct from p_email_key and t.id is distinct from p_skip)
$$;

-- Reserve on an existing provisioning record. The caller has already been authorized by the
-- wrapped provisioning command in this same transaction.
create function pikas_private.reserve_provisioning_username(p_source text,p_source_id uuid,p_username text) returns text
language plpgsql volatile security definer set search_path='' as $$
declare v text:=pikas_private.normalize_username(p_username); v_email text; current_value text; holder_email text; own_username text;
begin
 if not pikas_private.valid_username(v) then raise exception using errcode='22023',message='invalid_username'; end if;
 if exists(select 1 from pikas_private.reserved_usernames where username=v) then raise exception using errcode='22023',message='username_reserved'; end if;
 if p_source='invitation' then
  select email_key,intended_username into v_email,current_value from public.invitations where id=p_source_id and status='pending' and expires_at>clock_timestamp() for update;
 else
  select intended_email_key,intended_username into v_email,current_value from pikas_private.platform_customer_admin_intents where id=p_source_id and status='pending' and expires_at>clock_timestamp() for update;
 end if;
 if v_email is null then raise exception using errcode='23514',message='pending_provisioning_required'; end if;
 perform pikas_private.lock_username(v);
 -- An existing Person holding this username must be the same intended human (same Auth v_email).
 select lower(btrim(u.email)) into holder_email from pikas_private.login_identities li join public.persons p on p.id=li.person_id
  join auth.users u on u.id=p.auth_user_id where li.username=v;
 if found and holder_email is distinct from v_email then raise exception using errcode='23505',message='username_unavailable'; end if;
 if pikas_private.username_reserved_elsewhere(v,v_email,p_source_id) then raise exception using errcode='23505',message='username_unavailable'; end if;
 -- The intended identity may already exist with a username: never rename it silently.
 select li.username into own_username from auth.users u join public.persons p on p.auth_user_id=u.id
  join pikas_private.login_identities li on li.person_id=p.id where lower(btrim(u.email))=v_email and li.username is not null;
 if own_username is not null and own_username<>v then raise exception using errcode='23505',message='identity_has_username'; end if;
 -- One intended username per v_email across its other live provisioning records.
 if exists(select 1 from public.invitations i where i.email_key=v_email and i.status='pending' and i.expires_at>clock_timestamp()
    and i.intended_username is not null and i.intended_username<>v and i.id<>p_source_id)
  or exists(select 1 from pikas_private.platform_customer_admin_intents t where t.intended_email_key=v_email and t.status in ('pending','linked')
    and t.expires_at>clock_timestamp() and t.intended_username is not null and t.intended_username<>v and t.id<>p_source_id) then
  raise exception using errcode='23505',message='email_has_other_username'; end if;
 if current_value is distinct from v then
  -- Changing a pending reservation replaces it atomically (the previous value is released).
  if p_source='invitation' then update public.invitations set intended_username=v where id=p_source_id;
  else update pikas_private.platform_customer_admin_intents set intended_username=v where id=p_source_id; end if;
 end if;
 return v;
end $$;

-- Person usernames may not take a name live-reserved for a different intended identity.
create function pikas_private.guard_login_identity_username() returns trigger
language plpgsql security definer set search_path='' as $$
declare email text;
begin
 if new.username is null or (tg_op='UPDATE' and new.username is not distinct from old.username) then return new; end if;
 perform pikas_private.lock_username(new.username);
 select lower(btrim(u.email)) into email from public.persons p join auth.users u on u.id=p.auth_user_id where p.id=new.person_id;
 if pikas_private.username_reserved_elsewhere(new.username,email) then raise exception using errcode='23505',message='username_unavailable'; end if;
 return new;
end $$;
create trigger guard_username_reservation before insert or update of username on pikas_private.login_identities
 for each row execute function pikas_private.guard_login_identity_username();

-- Attach on completion (same transaction as the existing Person create/reuse).
create function pikas_private.attach_provisioned_username(p_person uuid,p_username text,p_email_key text,p_actor uuid,p_scope text,p_source text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare auth_id uuid; email text; existing text;
begin
 select p.auth_user_id,lower(btrim(u.email)) into auth_id,email from public.persons p join auth.users u on u.id=p.auth_user_id where p.id=p_person;
 if auth_id is null or email is distinct from p_email_key then return; end if;
 perform pikas_private.lock_username(p_username);
 select username into existing from pikas_private.login_identities where person_id=p_person;
 if existing is not null then return; end if; -- never rename an existing username
 if exists(select 1 from pikas_private.login_identities where username=p_username) then return; end if;
 insert into pikas_private.login_identities(person_id,username) values(p_person,p_username)
  on conflict (person_id) do update set username=excluded.username,version=pikas_private.login_identities.version+1,updated_at=now()
  where pikas_private.login_identities.username is null;
 insert into pikas_private.identity_audit_events(operation,actor_scope,actor_person_id,actor_auth_user_id,target_person_id,target_auth_user_id,metadata)
  values('username_set',p_scope,p_actor,(select auth.uid()),p_person,auth_id,jsonb_build_object('from',null,'to',p_username,'source',p_source));
end $$;

create function pikas_private.attach_invitation_username() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pikas_private.attach_provisioned_username(new.accepted_person_id,new.intended_username,new.email_key,new.invited_by,'tenant','provisioning');
 return null;
end $$;
create trigger attach_reserved_username after update of status on public.invitations for each row
 when (new.status='accepted' and old.status<>'accepted' and new.intended_username is not null)
 execute function pikas_private.attach_invitation_username();

create function pikas_private.attach_intent_username() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pikas_private.attach_provisioned_username(new.linked_person_id,new.intended_username,new.intended_email_key,new.created_by_person_id,'platform','provisioning');
 return null;
end $$;
create trigger attach_reserved_username after update on pikas_private.platform_customer_admin_intents for each row
 when (new.linked_person_id is not null and old.linked_person_id is null and new.intended_username is not null)
 execute function pikas_private.attach_intent_username();

-- Provisioning with a username: wraps the EXISTING prepare commands (authority, journals and
-- scope rules unchanged) and reserves in the same transaction; any failure rolls both back.
create function public.provisioning_prepare_with_username(p_flow text,p_request_id uuid,p_school_id uuid,p_cafeteria_id uuid,p_payload jsonb,p_username text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v text:=pikas_private.normalize_username(p_username); prior pikas_private.provisioning_username_requests; result jsonb; source uuid;
begin
 if p_request_id is null or p_flow not in ('cafeteria_staff','school_admin','cafeteria_admin') then raise exception using errcode='22023',message='invalid_provisioning_request'; end if;
 if exists(select 1 from pikas_private.sandbox_validated_pov()) then raise exception using errcode='22023',message='sandbox_username_unsupported'; end if;
 if not pikas_private.valid_username(v) then raise exception using errcode='22023',message='invalid_username'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,20261027));
 select * into prior from pikas_private.provisioning_username_requests where request_id=p_request_id;
 if found and (prior.username<>v or prior.flow<>p_flow or prior.actor_auth_user_id<>(select auth.uid())) then raise exception using errcode='23505',message='request_key_reused'; end if;
 if p_flow='cafeteria_staff' then
  result:=public.cafeteria_admin_command(p_cafeteria_id,p_request_id,'staff_prepare',p_payload); source:=(result->>'target_id')::uuid;
 elsif p_flow='school_admin' then
  result:=public.school_admin_command(p_school_id,p_request_id,'admin_prepare',p_payload); source:=(result->>'invitation_id')::uuid;
 else
  result:=public.cafeteria_delegation_command(p_school_id:=p_school_id,p_cafeteria_id:=p_cafeteria_id,p_request_id:=p_request_id,p_operation:='cafeteria_admin_prepare',p_payload:=p_payload);
  source:=(result->>'invitation_id')::uuid;
 end if;
 if source is null then raise exception using errcode='23514',message='pending_provisioning_required'; end if;
 if prior.request_id is null then
  perform pikas_private.reserve_provisioning_username('invitation',source,v);
  insert into pikas_private.provisioning_username_requests(request_id,actor_auth_user_id,flow,username,source_id) values(p_request_id,(select auth.uid()),p_flow,v,source);
 elsif prior.source_id<>source then raise exception using errcode='23505',message='request_key_reused'; end if;
 return result||jsonb_build_object('username',v);
end $$;

create function public.platform_prepare_customer_admin_with_username(p_request_id uuid,p_account_id uuid,p_scope_kind text,p_school_id uuid,p_cafeteria_id uuid,
 p_role_code text,p_intended_email text,p_expires_at timestamptz,p_username text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v text:=pikas_private.normalize_username(p_username); prior pikas_private.provisioning_username_requests; result jsonb; source uuid;
begin
 if not pikas_private.valid_username(v) then raise exception using errcode='22023',message='invalid_username'; end if;
 if p_request_id is null then raise exception using errcode='22023',message='invalid_provisioning_request'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,20261027));
 select * into prior from pikas_private.provisioning_username_requests where request_id=p_request_id;
 if found and (prior.username<>v or prior.flow<>'customer_admin' or prior.actor_auth_user_id<>(select auth.uid())) then raise exception using errcode='23505',message='request_key_reused'; end if;
 result:=public.platform_prepare_customer_admin(p_request_id,p_account_id,p_scope_kind,p_school_id,p_cafeteria_id,p_role_code,p_intended_email,p_expires_at);
 source:=(result->>'intent_id')::uuid;
 if source is null then raise exception using errcode='23514',message='pending_provisioning_required'; end if;
 if prior.request_id is null then
  perform pikas_private.reserve_provisioning_username('intent',source,v);
  insert into pikas_private.provisioning_username_requests(request_id,actor_auth_user_id,flow,username,source_id) values(p_request_id,(select auth.uid()),'customer_admin',v,source);
 elsif prior.source_id<>source then raise exception using errcode='23505',message='request_key_reused'; end if;
 return result;
end $$;

revoke all on function pikas_private.lock_username(text),pikas_private.username_reserved_elsewhere(text,text,uuid),
 pikas_private.reserve_provisioning_username(text,uuid,text),pikas_private.guard_login_identity_username(),
 pikas_private.attach_provisioned_username(uuid,text,text,uuid,text,text),pikas_private.attach_invitation_username(),pikas_private.attach_intent_username()
 from public,anon,authenticated,service_role;
revoke all on function public.provisioning_prepare_with_username(text,uuid,uuid,uuid,jsonb,text),
 public.platform_prepare_customer_admin_with_username(uuid,uuid,text,uuid,uuid,text,text,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.provisioning_prepare_with_username(text,uuid,uuid,uuid,jsonb,text),
 public.platform_prepare_customer_admin_with_username(uuid,uuid,text,uuid,uuid,text,text,timestamptz,text) to authenticated;

commit;
