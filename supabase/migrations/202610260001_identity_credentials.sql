-- Phase 6A identity, credentials and provisioning support. Additive and forward-safe.
--
-- Model: one Auth identity → one Person (unchanged) → memberships (unchanged). PIKAS adds a
-- first-class, globally unique, case-insensitive username per Person and credential state
-- (forced password change, login suspension). Supabase Auth keeps email/password; the app maps a
-- username to that same Auth email server-side (service role only). Changing username, email or
-- password never creates a Person or Auth user and never touches memberships.
--
-- Authority: Platform identity support uses the narrow capability platform:identity:support and
-- never grants or reads tenant authority. Tenant-side support (username, temporary access) is
-- limited to identities whose every held membership the actor manages (no peers, no upward
-- reach, no Platform identities). Every mutation is audited without secrets.
begin;

insert into pikas_private.platform_capabilities(capability) values ('platform:identity:support');
insert into pikas_private.platform_role_capabilities(role_code,capability) values ('platform_admin','platform:identity:support');

-- Canonical username: lowercase a-z 0-9 with single . _ - separators, no leading/trailing
-- separator, 3–40 chars. It can never contain '@', so it can never be an email.
create function pikas_private.normalize_username(p_value text) returns text
language sql immutable set search_path='' as $$ select nullif(lower(btrim(coalesce(p_value,''))),'') $$;
create function pikas_private.valid_username(p_value text) returns boolean
language sql immutable set search_path='' as $$
 select p_value is not null and length(p_value) between 3 and 40 and p_value ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
$$;

create table pikas_private.login_identities (
 person_id uuid primary key references public.persons(id) on delete restrict,
 username text unique check (username is null or pikas_private.valid_username(username)),
 must_change_password boolean not null default false,
 -- sha256 of the Auth password hash at temporary issuance; the forced change is complete only
 -- when the stored hash differs. Never a password, never shown.
 password_baseline text check (password_baseline is null or password_baseline ~ '^[0-9a-f]{64}$'),
 temporary_requested_at timestamptz,
 temporary_issued_at timestamptz,
 login_suspended_at timestamptz,
 pending_email text check (pending_email is null or (length(pending_email) between 3 and 254 and position('@' in pending_email)>1)),
 version bigint not null default 1 check (version>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (not must_change_password or temporary_requested_at is not null)
);
alter table pikas_private.login_identities enable row level security;
revoke all on pikas_private.login_identities from public,anon,authenticated,service_role;

-- Reserved/system usernames can be added later without code changes; empty in 6A.
create table pikas_private.reserved_usernames (
 username text primary key check (pikas_private.valid_username(username)),
 created_at timestamptz not null default now()
);
alter table pikas_private.reserved_usernames enable row level security;
revoke all on pikas_private.reserved_usernames from public,anon,authenticated,service_role;

create table pikas_private.identity_audit_events (
 id uuid primary key default gen_random_uuid(),
 occurred_at timestamptz not null default clock_timestamp(),
 operation text not null check (operation in ('username_set','username_changed','email_change_requested','email_changed',
  'temporary_access_requested','temporary_access_issued','password_change_completed','login_suspended','login_reactivated')),
 actor_scope text not null check (actor_scope in ('platform','tenant','self')),
 actor_person_id uuid not null references public.persons(id) on delete restrict,
 actor_auth_user_id uuid,
 target_person_id uuid not null references public.persons(id) on delete restrict,
 target_auth_user_id uuid,
 metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'
  and not (metadata ?| array['password','temporary_password','password_hash','token','secret','otp','link'])),
 reason text check (reason is null or length(btrim(reason)) between 3 and 300)
);
create index identity_audit_target_idx on pikas_private.identity_audit_events(target_person_id,occurred_at desc);
alter table pikas_private.identity_audit_events enable row level security;
revoke all on pikas_private.identity_audit_events from public,anon,authenticated,service_role;
create function pikas_private.reject_identity_audit_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501',message='identity_audit_immutable'; end $$;
create trigger identity_audit_immutable before update or delete on pikas_private.identity_audit_events
 for each row execute function pikas_private.reject_identity_audit_mutation();

-- Fail closed: a Person whose login is suspended or who must replace a temporary password holds
-- no PIKAS authority until resolved. Platform checks keep their own path (platform_person_id).
create or replace function pikas_private.current_person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.persons p where p.auth_user_id = (select auth.uid()) and p.status = 'active'
   and not exists (select 1 from pikas_private.login_identities li
    where li.person_id=p.id and (li.login_suspended_at is not null or li.must_change_password))
$$;

-- Who may support this identity? 'platform' | 'tenant' | null. Targets must be an Auth-linked
-- Person with no Platform membership. Never the actor itself, never under a sandbox POV.
create function pikas_private.identity_support_scope(p_target uuid) returns text
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;
begin
 if exists(select 1 from pikas_private.sandbox_validated_pov()) then return null; end if;
 if not exists(select 1 from public.persons where id=p_target and auth_user_id is not null) then return null; end if;
 if exists(select 1 from pikas_private.platform_memberships where person_id=p_target and status<>'inactive') then return null; end if;
 if pikas_private.platform_has_capability('platform:identity:support') then
  if exists(select 1 from public.persons where id=p_target and auth_user_id=(select auth.uid())) then return null; end if;
  return 'platform';
 end if;
 actor:=pikas_private.current_person_id();
 if actor is null or actor=p_target then return null; end if;
 -- Every held (non-inactive) membership of the target must be managed by an active actor role.
 if not exists(select 1 from public.school_memberships where person_id=p_target and status<>'inactive')
  and not exists(select 1 from public.cafeteria_memberships where person_id=p_target and status<>'inactive') then return null; end if;
 if exists(select 1 from public.account_memberships where person_id=p_target and status<>'inactive') then return null; end if;
 if exists(select 1 from public.school_memberships m where m.person_id=p_target and m.status<>'inactive'
  and not exists(select 1 from public.account_memberships a where a.person_id=actor and a.status='active' and a.role_code='account_admin' and a.account_id=m.account_id)) then return null; end if;
 if exists(select 1 from public.cafeteria_memberships m where m.person_id=p_target and m.status<>'inactive' and not (
   exists(select 1 from public.account_memberships a where a.person_id=actor and a.status='active' and a.role_code='account_admin' and a.account_id=m.account_id)
   or exists(select 1 from public.school_memberships s where s.person_id=actor and s.status='active' and s.role_code='school_admin' and s.account_id=m.account_id and s.school_id=m.school_id)
   or (m.role_code in ('pos_cashier','pos_supervisor') and exists(select 1 from public.cafeteria_memberships c where c.person_id=actor and c.status='active'
    and c.role_code='cafeteria_admin' and c.account_id=m.account_id and c.school_id=m.school_id and c.cafeteria_id=m.cafeteria_id)))) then return null; end if;
 return 'tenant';
end $$;

create function pikas_private.require_identity_support(p_target uuid,p_platform_only boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare scope text:=pikas_private.identity_support_scope(p_target); actor uuid;
begin
 if scope is null or (p_platform_only and scope<>'platform') then raise exception using errcode='42501',message='identity_support_required'; end if;
 actor:=case when scope='platform' then pikas_private.platform_person_id() else pikas_private.current_person_id() end;
 if actor is null then raise exception using errcode='42501',message='identity_support_required'; end if;
 insert into pikas_private.login_identities(person_id) values(p_target) on conflict (person_id) do nothing;
 perform 1 from pikas_private.login_identities where person_id=p_target for update;
 return jsonb_build_object('scope',scope,'actor',actor,'target_auth',(select auth_user_id from public.persons where id=p_target));
end $$;

create function pikas_private.identity_audit(p_ctx jsonb,p_target uuid,p_operation text,p_metadata jsonb default '{}'::jsonb,p_reason text default null) returns void
language sql volatile security definer set search_path='' as $$
 insert into pikas_private.identity_audit_events(operation,actor_scope,actor_person_id,actor_auth_user_id,target_person_id,target_auth_user_id,metadata,reason)
 values(p_operation,p_ctx->>'scope',(p_ctx->>'actor')::uuid,(select auth.uid()),p_target,(p_ctx->>'target_auth')::uuid,p_metadata,nullif(btrim(p_reason),''))
$$;

-- Ends every PIKAS application session of an Auth user; the pre-request guard then rejects them.
create function pikas_private.end_identity_sessions(p_auth uuid) returns void
language sql volatile security definer set search_path='' as $$
 update pikas_private.application_sessions set ended_at=clock_timestamp() where user_id=p_auth and ended_at is null
$$;

create function pikas_private.identity_summary(p_target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('person_id',p.id,'display_name',p.display_name,'person_status',p.status,
  'username',li.username,'email',u.email,'email_confirmed',u.email_confirmed_at is not null,'last_sign_in_at',u.last_sign_in_at,
  'must_change_password',coalesce(li.must_change_password,false),'login_suspended',li.login_suspended_at is not null,
  'temporary_issued_at',li.temporary_issued_at,'pending_email',li.pending_email,'version',coalesce(li.version,1),
  'memberships',coalesce((select jsonb_agg(x order by x->>'scope',x->>'name') from (
    select jsonb_build_object('scope','account','role',m.role_code,'status',m.status,'name',a.name) x from public.account_memberships m join public.accounts a on a.id=m.account_id where m.person_id=p.id
    union all select jsonb_build_object('scope','school','role',m.role_code,'status',m.status,'name',s.name) from public.school_memberships m join public.schools s on s.id=m.school_id where m.person_id=p.id
    union all select jsonb_build_object('scope','cafeteria','role',m.role_code,'status',m.status,'name',c.name) from public.cafeteria_memberships m join public.cafeterias c on c.id=m.cafeteria_id where m.person_id=p.id) q),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(jsonb_build_object('operation',e.operation,'occurred_at',e.occurred_at,'actor_scope',e.actor_scope,
     'actor_name',ap.display_name,'metadata',e.metadata,'reason',e.reason) order by e.occurred_at desc)
   from (select * from pikas_private.identity_audit_events where target_person_id=p.id order by occurred_at desc limit 20) e join public.persons ap on ap.id=e.actor_person_id),'[]'::jsonb))
 from public.persons p left join pikas_private.login_identities li on li.person_id=p.id left join auth.users u on u.id=p.auth_user_id where p.id=p_target
$$;

-- READS ------------------------------------------------------------------------------------
-- Platform lookup by exact username or exact email only (no browsing, no fuzzy search).
create function public.identity_support_lookup(p_identifier text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare target uuid; v text:=lower(btrim(coalesce(p_identifier,'')));
begin
 perform pikas_private.require_platform_capability('platform:identity:support');
 if length(v) not between 3 and 254 then raise exception using errcode='22023',message='invalid_identifier'; end if;
 if position('@' in v)>0 then select p.id into target from auth.users u join public.persons p on p.auth_user_id=u.id where lower(u.email)=v;
 else select person_id into target from pikas_private.login_identities where username=v; end if;
 if target is null or pikas_private.identity_support_scope(target) is distinct from 'platform' then return jsonb_build_object('result',null); end if;
 return jsonb_build_object('result',pikas_private.identity_summary(target));
end $$;

create function public.identity_support_read(p_person_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare scope text:=pikas_private.identity_support_scope(p_person_id);
begin
 if scope is null then raise exception using errcode='42501',message='identity_support_required'; end if;
 return pikas_private.identity_summary(p_person_id)||jsonb_build_object('support_scope',scope);
end $$;

-- Tenant entry point from an existing membership row (the tenant UIs list memberships, not Persons).
create function public.identity_support_read_membership(p_membership_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare target uuid;
begin
 select person_id into target from public.cafeteria_memberships where id=p_membership_id;
 if target is null then select person_id into target from public.school_memberships where id=p_membership_id; end if;
 if target is null or pikas_private.identity_support_scope(target) is null then raise exception using errcode='42501',message='identity_support_required'; end if;
 return public.identity_support_read(target);
end $$;

-- MUTATIONS --------------------------------------------------------------------------------
create function public.identity_set_username(p_person_id uuid,p_username text,p_expected_version bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; v text:=pikas_private.normalize_username(p_username); before text; ver bigint;
begin
 ctx:=pikas_private.require_identity_support(p_person_id);
 if not pikas_private.valid_username(v) then raise exception using errcode='22023',message='invalid_username'; end if;
 if exists(select 1 from pikas_private.reserved_usernames where username=v) then raise exception using errcode='22023',message='username_reserved'; end if;
 select username,version into before,ver from pikas_private.login_identities where person_id=p_person_id;
 if p_expected_version is distinct from ver then raise exception using errcode='40001',message='identity_version_changed'; end if;
 if before is not distinct from v then return pikas_private.identity_summary(p_person_id); end if;
 begin
  update pikas_private.login_identities set username=v,version=version+1,updated_at=now() where person_id=p_person_id;
 exception when unique_violation then raise exception using errcode='23505',message='username_unavailable'; end;
 perform pikas_private.identity_audit(ctx,p_person_id,case when before is null then 'username_set' else 'username_changed' end,
  jsonb_build_object('from',before,'to',v));
 return pikas_private.identity_summary(p_person_id);
end $$;

-- Email correction (Platform only). Step 1 authorizes and records the request; the server then
-- updates the SAME Auth user through the Auth admin API; step 2 confirms and audits.
create function public.identity_begin_email_change(p_person_id uuid,p_email text,p_reason text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; v text:=lower(btrim(coalesce(p_email,''))); current_email text;
begin
 ctx:=pikas_private.require_identity_support(p_person_id,true);
 if length(v) not between 3 and 254 or v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception using errcode='22023',message='invalid_email'; end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null or length(btrim(p_reason))<3 then raise exception using errcode='22023',message='reason_required'; end if;
 select u.email into current_email from auth.users u where u.id=(ctx->>'target_auth')::uuid;
 if lower(current_email)=v then raise exception using errcode='22023',message='email_unchanged'; end if;
 if exists(select 1 from auth.users u where lower(u.email)=v and u.id<>(ctx->>'target_auth')::uuid) then raise exception using errcode='23505',message='email_unavailable'; end if;
 update pikas_private.login_identities set pending_email=v,version=version+1,updated_at=now() where person_id=p_person_id;
 perform pikas_private.identity_audit(ctx,p_person_id,'email_change_requested',jsonb_build_object('from',current_email,'to',v),p_reason);
 return jsonb_build_object('auth_user_id',ctx->>'target_auth','email',v);
end $$;

create function public.identity_finish_email_change(p_person_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; pending text; actual text;
begin
 ctx:=pikas_private.require_identity_support(p_person_id,true);
 select pending_email into pending from pikas_private.login_identities where person_id=p_person_id;
 select lower(u.email) into actual from auth.users u where u.id=(ctx->>'target_auth')::uuid;
 if pending is null or actual is distinct from pending then raise exception using errcode='40001',message='email_change_unconfirmed'; end if;
 update pikas_private.login_identities set pending_email=null,version=version+1,updated_at=now() where person_id=p_person_id;
 perform pikas_private.identity_audit(ctx,p_person_id,'email_changed',jsonb_build_object('to',actual));
 return pikas_private.identity_summary(p_person_id);
end $$;

-- Temporary access (Platform or tenant scope). Step 1 gates the Person (forced change, no
-- authority) and ends live sessions BEFORE any password exists; the server sets the password on
-- the SAME Auth user; step 2 records the hash baseline. If step 2 never runs, the identity stays
-- gated (fail closed) until access is reissued.
create function public.identity_begin_temporary_access(p_person_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb;
begin
 ctx:=pikas_private.require_identity_support(p_person_id);
 update pikas_private.login_identities set must_change_password=true,password_baseline=null,temporary_requested_at=clock_timestamp(),
  temporary_issued_at=null,version=version+1,updated_at=now() where person_id=p_person_id;
 perform pikas_private.end_identity_sessions((ctx->>'target_auth')::uuid);
 perform pikas_private.identity_audit(ctx,p_person_id,'temporary_access_requested');
 return jsonb_build_object('auth_user_id',ctx->>'target_auth');
end $$;

create function public.identity_finish_temporary_access(p_person_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; li pikas_private.login_identities; hash text;
begin
 ctx:=pikas_private.require_identity_support(p_person_id);
 select * into li from pikas_private.login_identities where person_id=p_person_id;
 if not li.must_change_password or li.temporary_requested_at is null or li.password_baseline is not null then
  raise exception using errcode='40001',message='temporary_access_not_pending'; end if;
 select encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex') into hash from auth.users u where u.id=(ctx->>'target_auth')::uuid;
 update pikas_private.login_identities set password_baseline=hash,temporary_issued_at=clock_timestamp(),version=version+1,updated_at=now() where person_id=p_person_id;
 perform pikas_private.identity_audit(ctx,p_person_id,'temporary_access_issued',jsonb_build_object('requires_password_change',true));
 return pikas_private.identity_summary(p_person_id);
end $$;

-- Login suspension (Platform only; tenant admins keep membership status). Ends live sessions.
create function public.identity_set_login_suspended(p_person_id uuid,p_suspended boolean,p_reason text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; was boolean;
begin
 ctx:=pikas_private.require_identity_support(p_person_id,true);
 if p_suspended is null then raise exception using errcode='22023',message='invalid_state'; end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null or length(btrim(p_reason))<3 then raise exception using errcode='22023',message='reason_required'; end if;
 select login_suspended_at is not null into was from pikas_private.login_identities where person_id=p_person_id;
 if was=p_suspended then return jsonb_build_object('auth_user_id',ctx->>'target_auth','changed',false); end if;
 update pikas_private.login_identities set login_suspended_at=case when p_suspended then clock_timestamp() end,version=version+1,updated_at=now() where person_id=p_person_id;
 if p_suspended then perform pikas_private.end_identity_sessions((ctx->>'target_auth')::uuid); end if;
 perform pikas_private.identity_audit(ctx,p_person_id,case when p_suspended then 'login_suspended' else 'login_reactivated' end,'{}'::jsonb,p_reason);
 return jsonb_build_object('auth_user_id',ctx->>'target_auth','changed',true);
end $$;

-- SELF -------------------------------------------------------------------------------------
create function public.identity_credential_state() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('must_change_password',coalesce(bool_or(li.must_change_password),false),
  'login_suspended',coalesce(bool_or(li.login_suspended_at is not null),false))
 from public.persons p left join pikas_private.login_identities li on li.person_id=p.id where p.auth_user_id=(select auth.uid())
$$;

create function public.identity_complete_password_change() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare target uuid; li pikas_private.login_identities; hash text;
begin
 select p.id into target from public.persons p where p.auth_user_id=(select auth.uid()) and p.status='active';
 if target is null then raise exception using errcode='42501',message='identity_required'; end if;
 select * into li from pikas_private.login_identities where person_id=target for update;
 if li.person_id is null or not li.must_change_password then return jsonb_build_object('must_change_password',false); end if;
 if li.login_suspended_at is not null then raise exception using errcode='42501',message='identity_required'; end if;
 select encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex') into hash from auth.users u where u.id=(select auth.uid());
 if li.password_baseline is null or hash=li.password_baseline then raise exception using errcode='22023',message='password_change_required'; end if;
 update pikas_private.login_identities set must_change_password=false,password_baseline=null,version=version+1,updated_at=now() where person_id=target;
 insert into pikas_private.identity_audit_events(operation,actor_scope,actor_person_id,actor_auth_user_id,target_person_id,target_auth_user_id)
  values('password_change_completed','self',target,(select auth.uid()),target,(select auth.uid()));
 return jsonb_build_object('must_change_password',false);
end $$;

-- LOGIN RESOLUTION (service role only; never callable by anon/authenticated) ---------------
create function public.login_identifier_email(p_username text) returns text
language sql stable security definer set search_path='' as $$
 select u.email from pikas_private.login_identities li join public.persons p on p.id=li.person_id and p.status='active'
 join auth.users u on u.id=p.auth_user_id where li.username=pikas_private.normalize_username(p_username)
$$;

revoke all on function pikas_private.normalize_username(text),pikas_private.valid_username(text),pikas_private.identity_support_scope(uuid),
 pikas_private.require_identity_support(uuid,boolean),pikas_private.identity_audit(jsonb,uuid,text,jsonb,text),pikas_private.end_identity_sessions(uuid),
 pikas_private.identity_summary(uuid),pikas_private.reject_identity_audit_mutation() from public,anon,authenticated,service_role;
revoke all on function public.identity_support_lookup(text),public.identity_support_read(uuid),public.identity_support_read_membership(uuid),
 public.identity_set_username(uuid,text,bigint),public.identity_begin_email_change(uuid,text,text),public.identity_finish_email_change(uuid),
 public.identity_begin_temporary_access(uuid),public.identity_finish_temporary_access(uuid),public.identity_set_login_suspended(uuid,boolean,text),
 public.identity_credential_state(),public.identity_complete_password_change(),public.login_identifier_email(text) from public,anon,authenticated,service_role;
grant execute on function public.identity_support_lookup(text),public.identity_support_read(uuid),public.identity_support_read_membership(uuid),
 public.identity_set_username(uuid,text,bigint),public.identity_begin_email_change(uuid,text,text),public.identity_finish_email_change(uuid),
 public.identity_begin_temporary_access(uuid),public.identity_finish_temporary_access(uuid),public.identity_set_login_suspended(uuid,boolean,text),
 public.identity_credential_state(),public.identity_complete_password_change() to authenticated;
grant execute on function public.login_identifier_email(text) to service_role;
commit;
