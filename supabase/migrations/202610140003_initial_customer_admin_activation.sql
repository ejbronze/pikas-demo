-- 4D.8 bounded bridge to existing 4D.5. No new activation tables or tenant grants.
begin;
create function pikas_private.lock_customer_activation_actor() returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;
begin
 perform pikas_private.application_session_assert();
 actor:=pikas_private.require_platform_capability('platform:customer_admin:provision');
 perform pikas_private.require_platform_capability('platform:identity:link');
 perform 1 from public.persons where id=actor for share;
 perform 1 from pikas_private.platform_memberships where person_id=actor order by id for share;
 perform pikas_private.application_session_assert();
 if pikas_private.require_platform_capability('platform:customer_admin:provision') is distinct from actor
  or pikas_private.require_platform_capability('platform:identity:link') is distinct from actor then
  raise exception 'platform_actor_changed' using errcode='42501';
 end if;
 return actor;
end $$;

-- Private projection only: never returns Auth UUIDs, provenance markers or credentials.
create function pikas_private.customer_activation_state(p_intent_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i pikas_private.platform_customer_admin_intents%rowtype; f pikas_private.account_activation_flows%rowtype;
 managed pikas_private.account_activation_flows%rowtype; u auth.users%rowtype; identity_state text; link_state text:='none'; deadline timestamptz; matches integer;
begin
 select * into strict i from pikas_private.platform_customer_admin_intents where id=p_intent_id;
 if i.status not in ('pending','linked') or i.expires_at<=clock_timestamp() then identity_state:='unavailable';
 else
  select * into f from pikas_private.account_activation_flows where source_kind='initial_customer_admin' and source_handle=i.id::text;
  select count(*) into matches from auth.users where lower(btrim(email))=i.intended_email_key;
  if matches=0 then identity_state:=case when f.auth_id is null then 'missing' else 'unavailable' end;
  elsif matches<>1 then identity_state:='unavailable';
  else
   select * into strict u from auth.users where lower(btrim(email))=i.intended_email_key;
   select * into managed from pikas_private.account_activation_flows where auth_id=u.id;
   if u.deleted_at is not null or u.is_anonymous or (u.banned_until is not null and u.banned_until>clock_timestamp())
    or u.id=auth.uid() or exists(select 1 from public.persons p join pikas_private.platform_memberships m on m.person_id=p.id where p.auth_user_id=u.id)
    or exists(select 1 from public.persons where auth_user_id=u.id and status<>'active')
    or (f.auth_id is not null and f.auth_id<>u.id) then identity_state:='unavailable';
   elsif f.id is not null and u.raw_app_meta_data->>'pikas_activation_owner'=f.owner_key and not exists(select 1 from public.persons where auth_user_id=u.id) then
    identity_state:=case when f.auth_id=u.id and u.email_confirmed_at is not null and f.password_baseline is not null
     and encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex')<>f.password_baseline then 'ready' else 'activation_pending' end;
   elsif managed.id is not null and (u.raw_app_meta_data->>'pikas_activation_owner' is distinct from managed.owner_key
    or managed.password_baseline is null or encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex')=managed.password_baseline) then identity_state:='unavailable';
   elsif u.email_confirmed_at is not null and (f.auth_id is null or f.auth_id=u.id) then identity_state:='ready';
   else identity_state:='unavailable'; end if;
  end if;
  select case when revoked_at is not null then 'replaced' when expires_at<=clock_timestamp() then 'expired' else 'active' end,expires_at
   into link_state,deadline from pikas_private.account_activation_invitations where flow_id=f.id and token_digest is not null order by created_at desc,handle desc limit 1;
 end if;
 return jsonb_build_object('intent_id',i.id,'account_id',i.account_id,'identity_state',identity_state,'link_state',coalesce(link_state,'none'),'expires_at',deadline);
end $$;

create function public.platform_customer_activation_status(p_intent_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i pikas_private.platform_customer_admin_intents%rowtype; result jsonb;
begin
 perform pikas_private.application_session_assert();
 perform pikas_private.require_platform_capability('platform:customer_admin:provision');
 select * into i from pikas_private.platform_customer_admin_intents where id=p_intent_id;
 if not found or i.scope_kind<>'account' or i.role_code<>'account_admin' or not exists(select 1 from public.accounts where id=i.account_id and tenant_kind='customer' and status='active') then
  raise exception 'initial_customer_admin_intent_required' using errcode='42501';
 end if;
 result:=pikas_private.customer_activation_state(i.id);
 perform pikas_private.application_session_assert();
 perform pikas_private.require_platform_capability('platform:customer_admin:provision');
 return result;
end $$;

create function public.platform_prepare_customer_activation(p_intent_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; i pikas_private.platform_customer_admin_intents%rowtype; flow uuid; invitation text; owner jsonb; state jsonb; issued_at timestamptz;
begin
 actor:=pikas_private.lock_customer_activation_actor();
 select * into i from pikas_private.platform_customer_admin_intents where id=p_intent_id for update;
 if not found or i.scope_kind<>'account' or i.role_code<>'account_admin' or i.status<>'pending' or i.expires_at<=clock_timestamp() then
  raise exception 'pending_intent_required' using errcode='42501'; end if;
 perform 1 from public.accounts where id=i.account_id and tenant_kind='customer' and status='active' for share;
 if not found or exists(select 1 from public.account_memberships where account_id=i.account_id and role_code='account_admin') then
  raise exception 'active_unassigned_customer_required' using errcode='42501'; end if;
 perform pikas_private.lock_customer_activation_actor();
 if i.expires_at<=clock_timestamp() then raise exception 'pending_intent_required' using errcode='42501'; end if;
 state:=pikas_private.customer_activation_state(i.id);
 if state->>'identity_state'='ready' then return jsonb_build_object('status','identity_ready'); end if;
 if state->>'identity_state'='unavailable' then raise exception 'activation_identity_unavailable' using errcode='42501'; end if;
 insert into pikas_private.account_activation_flows(source_kind,source_handle,email_key)
 values('initial_customer_admin',i.id::text,i.intended_email_key) on conflict(source_kind,source_handle) do nothing;
 select id into strict flow from pikas_private.account_activation_flows where source_kind='initial_customer_admin' and source_handle=i.id::text and email_key=i.intended_email_key for update;
 owner:=pikas_private.activation_owner(flow);
 if (owner->>'ready')::boolean then raise exception 'activation_already_ready' using errcode='42501'; end if;
 perform pikas_private.lock_customer_activation_actor();
 if i.expires_at<=clock_timestamp() then raise exception 'pending_intent_required' using errcode='42501'; end if;
 issued_at:=clock_timestamp();
 insert into pikas_private.account_activation_invitations(flow_id,created_by,created_at,expires_at)
 values(flow,actor,issued_at,least(i.expires_at,issued_at+interval '1 hour')) returning handle into invitation;
 insert into pikas_private.account_activation_events(invitation_handle,action,actor_auth_id) values(invitation,'prepared',auth.uid());
 return jsonb_build_object('status','prepared','handle',invitation,'email',i.intended_email_key);
end $$;

create function public.platform_bind_customer_activation(p_intent_id uuid,p_handle text,p_digest text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; i pikas_private.platform_customer_admin_intents%rowtype;
 invitation pikas_private.account_activation_invitations%rowtype; f pikas_private.account_activation_flows%rowtype; owner jsonb;
begin
 actor:=pikas_private.lock_customer_activation_actor();
 select * into i from pikas_private.platform_customer_admin_intents where id=p_intent_id for update;
 if not found or i.scope_kind<>'account' or i.role_code<>'account_admin' or i.status<>'pending' or i.expires_at<=clock_timestamp() then
  raise exception 'pending_intent_required' using errcode='42501'; end if;
 perform 1 from public.accounts where id=i.account_id and tenant_kind='customer' and status='active' for share;
 if not found or exists(select 1 from public.account_memberships where account_id=i.account_id and role_code='account_admin') then
  raise exception 'active_unassigned_customer_required' using errcode='42501'; end if;
 -- Check source association before locking another source's flow/invitation.
 if not exists(select 1 from pikas_private.account_activation_invitations ai join pikas_private.account_activation_flows af on af.id=ai.flow_id
  where ai.handle=p_handle and af.source_kind='initial_customer_admin' and af.source_handle=i.id::text and af.email_key=i.intended_email_key) then
  raise exception 'invitation_unavailable' using errcode='42501'; end if;
 perform pikas_private.lock_activation(p_handle,null);
 select * into strict invitation from pikas_private.account_activation_invitations where handle=p_handle;
 select * into strict f from pikas_private.account_activation_flows where id=invitation.flow_id;
 if invitation.created_by<>actor then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid_digest' using errcode='22023'; end if;
 owner:=pikas_private.activation_owner(f.id);
 if owner->>'auth_id' is null or (owner->>'ready')::boolean then raise exception 'activation_identity_unavailable' using errcode='42501'; end if;
 perform pikas_private.lock_customer_activation_actor();
 if invitation.expires_at<=clock_timestamp() or i.expires_at<=clock_timestamp() then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 if invitation.token_digest is not null then
  if invitation.token_digest=p_digest then return; end if;
  raise exception 'invitation_unavailable' using errcode='42501';
 end if;
 update pikas_private.account_activation_invitations set revoked_at=clock_timestamp() where flow_id=f.id and handle<>p_handle and revoked_at is null;
 update pikas_private.account_activation_invitations set token_digest=p_digest where handle=p_handle;
 insert into pikas_private.account_activation_events(invitation_handle,action,actor_auth_id) values(p_handle,'bound',auth.uid());
end $$;

create or replace function public.platform_complete_initial_customer_admin(p_request_id uuid,p_intent_id uuid,p_display_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; fingerprint text; replay jsonb; intent pikas_private.platform_customer_admin_intents%rowtype;
 target_auth uuid; matching_identities integer; result jsonb; payload jsonb;
begin
 perform pikas_private.application_session_assert();
 actor:=pikas_private.lock_customer_activation_actor();
 perform pikas_private.require_platform_capability('platform:identity:link');
 if p_intent_id is null or nullif(btrim(p_display_name),'') is null or length(btrim(p_display_name))>200 then
   raise exception using errcode='22023',message='invalid_initial_admin_input';
 end if;
 payload:=jsonb_build_object('intent_id',p_intent_id,'display_name',btrim(p_display_name));
 fingerprint:=pikas_private.platform_request_fingerprint(payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'initial_customer_admin_complete',fingerprint,actor);
 if replay is not null then perform pikas_private.application_session_assert(); return replay; end if;
 select * into intent from pikas_private.platform_customer_admin_intents where id=p_intent_id for update;
 if not found or intent.status not in ('pending','linked') or intent.expires_at<=clock_timestamp()
   or intent.scope_kind<>'account' or intent.role_code<>'account_admin' then
   raise exception using errcode='23514',message='initial_customer_admin_intent_required';
 end if;
 perform 1 from public.accounts where id=intent.account_id and tenant_kind='customer' and status='active' for update;
 if not found then raise exception using errcode='42501',message='active_customer_required'; end if;
 if exists(select 1 from public.account_memberships where account_id=intent.account_id and role_code='account_admin') then
   raise exception using errcode='23505',message='initial_admin_already_exists';
 end if;
 -- Stabilize any activation-managed identity before taking Auth locks.
 perform 1 from pikas_private.account_activation_flows where email_key=intent.intended_email_key order by id for update;
 -- Reject ambiguous email matches rather than selecting an arbitrary Auth identity.
 select count(*) into matching_identities from auth.users u where lower(btrim(u.email))=intent.intended_email_key;
 if matching_identities<>1 then raise exception using errcode='23514',message='confirmed_identity_pending'; end if;
 -- The browser never supplies an Auth UUID. Resolve only the intended, confirmed identity.
 begin
 select u.id into strict target_auth from auth.users u where lower(btrim(u.email))=intent.intended_email_key
   and u.confirmed_at is not null
   -- The local Auth fixture is intentionally minimal. When GoTrue fields exist,
   -- require email confirmation (phone confirmation is insufficient) and eligibility.
   and (not (to_jsonb(u) ? 'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
   and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
   and to_jsonb(u)->>'deleted_at' is null
   and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false for share;
 exception when no_data_found or too_many_rows then
   raise exception using errcode='23514',message='confirmed_identity_pending';
 end;
 -- Confirmation occurs before first-password creation in /activar. Do not grant early.
 if pikas_private.customer_activation_state(p_intent_id)->>'identity_state'<>'ready' then
  raise exception 'activation_password_pending' using errcode='23514';
 end if;
 -- Lock an existing Person before checking eligibility or invoking link/grant.
 perform 1 from public.persons where auth_user_id=target_auth for update;
 if pikas_private.require_platform_capability('platform:customer_admin:provision') is distinct from actor
   or pikas_private.require_platform_capability('platform:identity:link') is distinct from actor then
   raise exception using errcode='42501',message='platform_actor_changed';
 end if;
 if intent.expires_at<=clock_timestamp() then
   raise exception using errcode='23514',message='initial_customer_admin_intent_required';
 end if;
 if target_auth=auth.uid() or exists(select 1 from public.persons p join pikas_private.platform_memberships m on m.person_id=p.id
   where p.auth_user_id=target_auth) then
   raise exception using errcode='42501',message='customer_identity_required';
 end if;
 if intent.status='pending' then
   perform public.platform_link_customer_admin_identity(gen_random_uuid(),p_intent_id,target_auth,btrim(p_display_name));
 elsif intent.linked_auth_user_id is distinct from target_auth then
   raise exception using errcode='42501',message='confirmed_identity_mismatch';
 end if;
 if intent.expires_at<=clock_timestamp() then
   raise exception using errcode='23514',message='initial_customer_admin_intent_required';
 end if;
 perform pikas_private.application_session_assert();
 result:=public.platform_grant_customer_admin(gen_random_uuid(),p_intent_id);
 perform pikas_private.application_session_assert();
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
 values(p_request_id,'initial_customer_admin_complete',fingerprint,auth.uid(),actor,result);
 -- Existing link/grant RPCs emit real-operator audit events; no parallel audit system.
 return result;
end $$;

revoke all on function pikas_private.lock_customer_activation_actor(),pikas_private.customer_activation_state(uuid) from public,anon,authenticated,service_role;
revoke all on function public.platform_customer_activation_status(uuid),public.platform_prepare_customer_activation(uuid),public.platform_bind_customer_activation(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.platform_customer_activation_status(uuid),public.platform_prepare_customer_activation(uuid),public.platform_bind_customer_activation(uuid,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
