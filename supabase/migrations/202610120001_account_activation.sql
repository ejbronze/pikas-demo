-- Uncommitted 4D.5 only. Identity activation never creates Person/membership authority.
begin;
create table pikas_private.account_activation_flows (
 id uuid primary key default gen_random_uuid(),
 source_kind text not null check(source_kind in ('platform_team','initial_customer_admin','school_admin','cafeteria_staff')),
 source_handle text not null, email_key text not null check(email_key=lower(btrim(email_key))),
 owner_key text not null default encode(extensions.gen_random_bytes(32),'hex'),
 auth_id uuid unique references auth.users(id),
 password_baseline text check(password_baseline ~ '^[0-9a-f]{64}$'),
 ready_at timestamptz, unique(source_kind,source_handle)
);
create table pikas_private.account_activation_invitations (
 handle text primary key default encode(extensions.gen_random_bytes(16),'hex'),
 flow_id uuid not null references pikas_private.account_activation_flows(id),
 token_digest text unique check(token_digest ~ '^[0-9a-f]{64}$'),
 created_by uuid not null references public.persons(id),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 revoked_at timestamptz, consumed_at timestamptz, consumed_auth_id uuid references auth.users(id),
 check((consumed_at is null)=(consumed_auth_id is null))
);
create table pikas_private.account_activation_events (
 id uuid primary key default gen_random_uuid(),
 invitation_handle text not null references pikas_private.account_activation_invitations(handle),
 action text not null check(action in ('prepared','bound','activated','password_ready')),
 actor_auth_id uuid not null, occurred_at timestamptz not null default clock_timestamp(),
 unique(invitation_handle,action)
);
alter table pikas_private.account_activation_flows enable row level security;
alter table pikas_private.account_activation_invitations enable row level security;
alter table pikas_private.account_activation_events enable row level security;
revoke all on pikas_private.account_activation_flows,pikas_private.account_activation_invitations,pikas_private.account_activation_events from public,anon,authenticated,service_role;
create trigger activation_events_immutable before update or delete on pikas_private.account_activation_events
 for each row execute function pikas_private.reject_platform_audit_mutation();
create trigger activation_events_no_truncate before truncate on pikas_private.account_activation_events
 for each statement execute function pikas_private.reject_platform_truncate();
-- Shared identity-only source validation. Each future issuer must apply its own existing authorization.
create function pikas_private.lock_activation_source(p_kind text,p_handle text,p_email text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_kind='platform_team' then
  perform 1 from pikas_private.platform_team_intents where handle=p_handle and email_key=p_email
   and status='pending' and expires_at>clock_timestamp() for share;
 elsif p_kind='initial_customer_admin' then
  perform 1 from pikas_private.platform_customer_admin_intents where id::text=p_handle and intended_email_key=p_email
   and status in ('pending','linked') and expires_at>clock_timestamp() for share;
 elsif p_kind in ('school_admin','cafeteria_staff') then
  perform 1 from public.invitations where id::text=p_handle and email_key=p_email and status='pending' and expires_at>clock_timestamp()
   and ((p_kind='school_admin' and scope_kind='school' and role_code='school_admin')
    or (p_kind='cafeteria_staff' and scope_kind='cafeteria' and role_code in ('pos_cashier','pos_supervisor'))) for share;
 else raise exception using errcode='42501',message='unsupported_activation_source';
 end if;
 if not found then raise exception using errcode='42501',message='pending_intent_required'; end if;
end $$;
revoke all on function pikas_private.lock_activation_source(text,text,text) from public,anon,authenticated,service_role;

-- This privileged helper inspects the exact Auth UUID and server-controlled app_metadata.
-- A matching email alone never establishes ownership. A lost createUser response can
-- be reconciled through its pre-existing, random flow marker without adopting strangers.
create function pikas_private.activation_owner(p_flow uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f pikas_private.account_activation_flows%rowtype; u auth.users%rowtype; matches integer;
begin
 select * into strict f from pikas_private.account_activation_flows where id=p_flow for update;
 select count(*) into matches from auth.users where lower(btrim(email))=f.email_key;
 if matches=0 and f.auth_id is null then
  return jsonb_build_object('email',f.email_key,'owner_key',f.owner_key,'auth_id',null,'ready',false);
 end if;
 if matches<>1 then raise exception using errcode='42501',message='activation_identity_unavailable'; end if;
 select * into strict u from auth.users where lower(btrim(email))=f.email_key for share;
 if (f.auth_id is not null and u.id<>f.auth_id)
  or u.raw_app_meta_data->>'pikas_activation_owner' is distinct from f.owner_key
  or exists(select 1 from public.persons where auth_user_id=u.id)
  or u.deleted_at is not null or u.is_anonymous or (u.banned_until is not null and u.banned_until>clock_timestamp()) then
  raise exception using errcode='42501',message='activation_identity_unavailable'; end if;
 if f.auth_id is null then
  f.password_baseline:=encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex');
  update pikas_private.account_activation_flows set auth_id=u.id,password_baseline=f.password_baseline where id=f.id;
 end if;
 return jsonb_build_object('email',f.email_key,'owner_key',f.owner_key,'auth_id',u.id,
  'ready',f.ready_at is not null or encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex') is distinct from f.password_baseline);
end $$;
revoke all on function pikas_private.activation_owner(uuid) from public,anon,authenticated,service_role;

create function public.platform_prepare_activation(p_team_handle text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; intent pikas_private.platform_team_intents%rowtype; flow uuid; invitation text; owner jsonb;
begin
 actor:=pikas_private.lock_platform_team_actor();
 select * into intent from pikas_private.platform_team_intents where handle=p_team_handle for update;
 if not found or intent.status<>'pending' or intent.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='pending_intent_required'; end if;
 insert into pikas_private.account_activation_flows(source_kind,source_handle,email_key)
 values('platform_team',intent.handle,intent.email_key) on conflict(source_kind,source_handle) do nothing;
 select id into strict flow from pikas_private.account_activation_flows
 where source_kind='platform_team' and source_handle=intent.handle and email_key=intent.email_key for update;
 owner:=pikas_private.activation_owner(flow);
 if (owner->>'ready')::boolean then raise exception using errcode='42501',message='activation_already_ready'; end if;
 insert into pikas_private.account_activation_invitations(flow_id,created_by,expires_at)
 values(flow,actor,least(intent.expires_at,clock_timestamp()+interval '1 hour')) returning handle into invitation;
 insert into pikas_private.account_activation_events(invitation_handle,action,actor_auth_id) values(invitation,'prepared',auth.uid());
 return jsonb_build_object('handle',invitation,'email',intent.email_key);
end $$;
-- Lock order everywhere: prepared source -> flow -> invitation -> Auth.
create function pikas_private.lock_activation(p_handle text,p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i pikas_private.account_activation_invitations%rowtype; f pikas_private.account_activation_flows%rowtype;
begin
 if (p_handle is null)=(p_digest is null) then raise exception using errcode='42501',message='invitation_unavailable'; end if;
 select * into i from pikas_private.account_activation_invitations
 where (p_handle is not null and handle=p_handle) or (p_digest is not null and token_digest=p_digest);
 if not found then raise exception using errcode='42501',message='invitation_unavailable'; end if;
 select * into strict f from pikas_private.account_activation_flows where id=i.flow_id;
 perform pikas_private.lock_activation_source(f.source_kind,f.source_handle,f.email_key);
 perform 1 from pikas_private.account_activation_flows where id=f.id for update;
 select * into strict i from pikas_private.account_activation_invitations where handle=i.handle for update;
 if i.revoked_at is not null or i.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='invitation_unavailable'; end if;
 return jsonb_build_object('handle',i.handle,'flow_id',i.flow_id);
end $$;
revoke all on function pikas_private.lock_activation(text,text) from public,anon,authenticated,service_role;

-- Narrow service-role RPC; Auth IDs/markers never returned by browser-facing routes.
create function public.activation_provider_context(p_handle text default null,p_digest text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare locked jsonb; owner jsonb;
begin
 locked:=pikas_private.lock_activation(p_handle,p_digest);
 owner:=pikas_private.activation_owner((locked->>'flow_id')::uuid);
 if (owner->>'ready')::boolean then raise exception using errcode='42501',message='activation_already_ready'; end if;
 if exists(select 1 from pikas_private.account_activation_invitations where handle=locked->>'handle' and expires_at<=clock_timestamp()) then
  raise exception using errcode='42501',message='invitation_unavailable'; end if;
 return owner;
end $$;
create function public.platform_bind_activation(p_handle text,p_digest text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid; i pikas_private.account_activation_invitations%rowtype; owner jsonb;
begin
 actor:=pikas_private.lock_platform_team_actor();
 perform pikas_private.lock_activation(p_handle,null);
 select * into strict i from pikas_private.account_activation_invitations where handle=p_handle;
 if i.created_by<>actor or i.token_digest is not null then raise exception using errcode='42501',message='invitation_unavailable'; end if;
 owner:=pikas_private.activation_owner(i.flow_id);
 if owner->>'auth_id' is null or (owner->>'ready')::boolean then raise exception using errcode='42501',message='activation_identity_unavailable'; end if;
 if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='invalid_digest'; end if;
 if i.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='invitation_unavailable'; end if;
 update pikas_private.account_activation_invitations set revoked_at=clock_timestamp()
 where flow_id=i.flow_id and handle<>i.handle and revoked_at is null;
 update pikas_private.account_activation_invitations set token_digest=p_digest where handle=p_handle;
 insert into pikas_private.account_activation_events(invitation_handle,action,actor_auth_id) values(p_handle,'bound',auth.uid());
end $$;
-- Digest of independent random application credential ONLY. Never a native OTP/hash.
-- Return no email, Auth UUID or ownership marker. Recovery is allowed until password exists.
create function public.activation_preview(p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare locked jsonb; owner jsonb;
begin
 begin
  locked:=pikas_private.lock_activation(null,p_digest);
  owner:=pikas_private.activation_owner((locked->>'flow_id')::uuid);
  if owner->>'auth_id' is null or (owner->>'ready')::boolean then return null; end if;
 exception when insufficient_privilege then return null; end;
 if exists(select 1 from pikas_private.account_activation_invitations where handle=locked->>'handle' and expires_at<=clock_timestamp()) then return null; end if;
 return jsonb_build_object('handle',locked->>'handle');
end $$;
create function public.activation_consume(p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare locked jsonb; owner jsonb; i pikas_private.account_activation_invitations%rowtype;
begin
 locked:=pikas_private.lock_activation(null,p_digest);
 owner:=pikas_private.activation_owner((locked->>'flow_id')::uuid);
 if owner->>'auth_id' is null or (owner->>'auth_id')::uuid is distinct from auth.uid() or (owner->>'ready')::boolean then
  raise exception using errcode='42501',message='recipient_required'; end if;
 perform 1 from auth.users where id=auth.uid() and email_confirmed_at is not null for share;
 if not found then raise exception using errcode='42501',message='recipient_required'; end if;
 select * into strict i from pikas_private.account_activation_invitations where handle=locked->>'handle';
 if i.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='invitation_unavailable'; end if;
 -- First transition is once-only; exact recipient retries safely resume the same identity.
 update pikas_private.account_activation_invitations set consumed_at=clock_timestamp(),consumed_auth_id=auth.uid()
 where handle=i.handle and consumed_at is null;
 insert into pikas_private.account_activation_events(invitation_handle,action,actor_auth_id)
 values(i.handle,'activated',auth.uid()) on conflict(invitation_handle,action) do nothing;
 return jsonb_build_object('handle',i.handle);
end $$;
-- A real Auth password closes eligibility even if the finalize response never arrived.
create function public.activation_password_context(p_handle text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from pikas_private.account_activation_invitations i
 join pikas_private.account_activation_flows f on f.id=i.flow_id join auth.users u on u.id=f.auth_id
 where i.handle=p_handle and i.consumed_auth_id=auth.uid() and i.consumed_at is not null
 and i.revoked_at is null and i.expires_at>statement_timestamp() and f.ready_at is null
 and lower(btrim(u.email))=f.email_key and u.email_confirmed_at is not null
 and u.raw_app_meta_data->>'pikas_activation_owner'=f.owner_key and encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex')=f.password_baseline)
$$;
-- Immutable first-password fingerprint prevents concurrent/retried requests from
-- choosing a second password while the external Auth outcome is uncertain.
alter table pikas_private.account_activation_flows add column password_fingerprint text
 check(password_fingerprint ~ '^[0-9a-f]{64}$');
create function public.activation_password_status(p_handle text) returns text
language plpgsql security definer set search_path='' as $$
declare i pikas_private.account_activation_invitations%rowtype; f pikas_private.account_activation_flows%rowtype; u auth.users%rowtype;
begin
 select * into i from pikas_private.account_activation_invitations where handle=p_handle;
 if not found or i.consumed_auth_id is distinct from auth.uid() or auth.uid() is null then
  raise exception using errcode='42501',message='recipient_required'; end if;
 select * into strict f from pikas_private.account_activation_flows where id=i.flow_id for update;
 select * into strict u from auth.users where id=f.auth_id for share;
 if u.id is distinct from auth.uid() or lower(btrim(u.email))<>f.email_key or u.email_confirmed_at is null
  or u.raw_app_meta_data->>'pikas_activation_owner' is distinct from f.owner_key then
  raise exception using errcode='42501',message='recipient_required'; end if;
 if encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex') is distinct from f.password_baseline then
  update pikas_private.account_activation_flows set ready_at=coalesce(ready_at,clock_timestamp()) where id=f.id;
  insert into pikas_private.account_activation_events(invitation_handle,action,actor_auth_id)
  values(i.handle,'password_ready',auth.uid()) on conflict(invitation_handle,action) do nothing;
  return 'ready';
 end if;
 if i.revoked_at is not null or i.expires_at<=clock_timestamp() or f.ready_at is not null then
  raise exception using errcode='42501',message='invitation_unavailable'; end if;
 return 'pending';
end $$;
create function public.activation_claim_password(p_handle text,p_fingerprint text) returns text
language plpgsql security definer set search_path='' as $$
declare locked jsonb; owner jsonb; prior text;
begin
 locked:=pikas_private.lock_activation(p_handle,null);
 owner:=pikas_private.activation_owner((locked->>'flow_id')::uuid);
 if (owner->>'auth_id')::uuid is distinct from auth.uid() or not public.activation_password_context(p_handle) then
  raise exception using errcode='42501',message='recipient_required'; end if;
 if exists(select 1 from pikas_private.account_activation_invitations where handle=p_handle and expires_at<=clock_timestamp()) then
  raise exception using errcode='42501',message='invitation_unavailable'; end if;
 if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='invalid_fingerprint'; end if;
 select password_fingerprint into prior from pikas_private.account_activation_flows where id=(locked->>'flow_id')::uuid;
 if prior is not null and prior<>p_fingerprint then raise exception using errcode='42501',message='same_password_required'; end if;
 update pikas_private.account_activation_flows set password_fingerprint=p_fingerprint where id=(locked->>'flow_id')::uuid;
 return 'pending';
end $$;
create function public.platform_team_activation_read() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.platform_team_read();
 return jsonb_set(result,'{prepared}',coalesce((select jsonb_agg(item||jsonb_build_object('identity_ready',
  (select count(*)=1 and bool_and(u.confirmed_at is not null
   and (not(to_jsonb(u)?'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
   and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=statement_timestamp())
   and to_jsonb(u)->>'deleted_at' is null and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false
   and (not exists(select 1 from pikas_private.account_activation_flows f where f.auth_id=u.id)
    or encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex') is distinct from
      (select f.password_baseline from pikas_private.account_activation_flows f where f.auth_id=u.id)))
   from auth.users u where lower(btrim(u.email))=item->>'email')))
  from jsonb_array_elements(result->'prepared') item),'[]'::jsonb));
end $$;
-- Release only a definitively rejected password payload; uncertain outcomes keep
-- the immutable fingerprint. The endpoint invokes this solely for weak_password.
create function public.activation_reject_password(p_handle text,p_fingerprint text,p_auth_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare locked jsonb; owner jsonb;
begin
 locked:=pikas_private.lock_activation(p_handle,null);
 owner:=pikas_private.activation_owner((locked->>'flow_id')::uuid);
 if (owner->>'auth_id')::uuid is distinct from p_auth_id or p_auth_id is null or (owner->>'ready')::boolean
  or not exists(select 1 from pikas_private.account_activation_invitations where handle=p_handle and consumed_auth_id=p_auth_id and expires_at>clock_timestamp()) then
  raise exception using errcode='42501',message='recipient_required'; end if;
 update pikas_private.account_activation_flows set password_fingerprint=null
 where id=(locked->>'flow_id')::uuid and password_fingerprint=p_fingerprint;
end $$;
revoke all on function public.platform_prepare_activation(text),public.platform_bind_activation(text,text),public.activation_provider_context(text,text),public.activation_preview(text),public.activation_consume(text),public.activation_password_context(text),public.activation_password_status(text),public.activation_claim_password(text,text),public.platform_team_activation_read() from public,anon,authenticated,service_role;
revoke all on function public.activation_reject_password(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.activation_reject_password(text,text,uuid) to service_role;
grant execute on function public.platform_prepare_activation(text),public.platform_bind_activation(text,text),public.activation_consume(text),public.activation_password_context(text),public.activation_password_status(text),public.activation_claim_password(text,text),public.platform_team_activation_read() to authenticated;
grant execute on function public.activation_preview(text) to anon,authenticated;
grant execute on function public.activation_provider_context(text,text) to service_role;
commit;
