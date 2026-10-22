-- PIKAS UX 11: Demo and real Platform operations are mutually exclusive modes, also at the database.
--
-- The application refuses real Platform mutations while the operator has a current Demo POV
-- (19302e2); this migration closes the remaining path: direct authenticated PostgREST RPC calls.
-- One shared guard, pikas_private.require_no_current_demo(), raises 42501 'demo_mode_active' when the
-- caller has a CURRENT Demo POV (status 'active' and not expired: the predicate of
-- pikas_private.sandbox_pov_current_attempt(), introduced in 202611020001). Expired or exited history
-- never blocks, another operator's POV never blocks, and tenant users never hold a POV.
--
-- The guard is inserted as the first statement of each real Platform mutation RPC that had no
-- database Demo check. Every function below is otherwise its live definition verbatim: parameters,
-- return shapes, authority checks, business logic, grants and ownership are unchanged.
-- Left alone on purpose: Customer Operations (require_customer_operations_scope already refuses a
-- current POV, which also covers platform_customer_staff_command, platform_staff_activation_prepare/
-- bind and platform_support_cafeteria_command), platform_set_customer_lifecycle and
-- provisioning_prepare_with_username (sandbox_validated_pov), finance (FIN 2/3), the Demo controls
-- platform_enter/exit_sandbox_pov, and identity_complete_password_change (the caller's own
-- credential, not customer state). No capability, grant, role, membership, RLS or data change.
begin;

create function pikas_private.require_no_current_demo() returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 if pikas_private.sandbox_pov_current_attempt() then
  raise exception using errcode='42501',message='demo_mode_active';
 end if;
end $$;
revoke all on function pikas_private.require_no_current_demo() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.identity_begin_email_change(p_person_id uuid, p_email text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx jsonb; v text:=lower(btrim(coalesce(p_email,''))); current_email text;
begin
 perform pikas_private.require_no_current_demo();
 ctx:=pikas_private.require_identity_support(p_person_id,true);
 if length(v) not between 3 and 254 or v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception using errcode='22023',message='invalid_email'; end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null or length(btrim(p_reason))<3 then raise exception using errcode='22023',message='reason_required'; end if;
 select u.email into current_email from auth.users u where u.id=(ctx->>'target_auth')::uuid;
 if lower(current_email)=v then raise exception using errcode='22023',message='email_unchanged'; end if;
 if exists(select 1 from auth.users u where lower(u.email)=v and u.id<>(ctx->>'target_auth')::uuid) then raise exception using errcode='23505',message='email_unavailable'; end if;
 update pikas_private.login_identities set pending_email=v,version=version+1,updated_at=now() where person_id=p_person_id;
 perform pikas_private.identity_audit(ctx,p_person_id,'email_change_requested',jsonb_build_object('from',current_email,'to',v),p_reason);
 return jsonb_build_object('auth_user_id',ctx->>'target_auth','email',v);
end $function$;

CREATE OR REPLACE FUNCTION public.identity_begin_temporary_access(p_person_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx jsonb;
begin
 perform pikas_private.require_no_current_demo();
 ctx:=pikas_private.require_identity_support(p_person_id);
 update pikas_private.login_identities set must_change_password=true,password_baseline=null,temporary_requested_at=clock_timestamp(),
  temporary_issued_at=null,version=version+1,updated_at=now() where person_id=p_person_id;
 perform pikas_private.end_identity_sessions((ctx->>'target_auth')::uuid);
 perform pikas_private.identity_audit(ctx,p_person_id,'temporary_access_requested');
 return jsonb_build_object('auth_user_id',ctx->>'target_auth');
end $function$;

CREATE OR REPLACE FUNCTION public.identity_finish_email_change(p_person_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx jsonb; pending text; actual text;
begin
 perform pikas_private.require_no_current_demo();
 ctx:=pikas_private.require_identity_support(p_person_id,true);
 select pending_email into pending from pikas_private.login_identities where person_id=p_person_id;
 select lower(u.email) into actual from auth.users u where u.id=(ctx->>'target_auth')::uuid;
 if pending is null or actual is distinct from pending then raise exception using errcode='40001',message='email_change_unconfirmed'; end if;
 update pikas_private.login_identities set pending_email=null,version=version+1,updated_at=now() where person_id=p_person_id;
 perform pikas_private.identity_audit(ctx,p_person_id,'email_changed',jsonb_build_object('to',actual));
 return pikas_private.identity_summary(p_person_id);
end $function$;

CREATE OR REPLACE FUNCTION public.identity_finish_temporary_access(p_person_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx jsonb; li pikas_private.login_identities; hash text;
begin
 perform pikas_private.require_no_current_demo();
 ctx:=pikas_private.require_identity_support(p_person_id);
 select * into li from pikas_private.login_identities where person_id=p_person_id;
 if not li.must_change_password or li.temporary_requested_at is null or li.password_baseline is not null then
  raise exception using errcode='40001',message='temporary_access_not_pending'; end if;
 select encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex') into hash from auth.users u where u.id=(ctx->>'target_auth')::uuid;
 update pikas_private.login_identities set password_baseline=hash,temporary_issued_at=clock_timestamp(),version=version+1,updated_at=now() where person_id=p_person_id;
 perform pikas_private.identity_audit(ctx,p_person_id,'temporary_access_issued',jsonb_build_object('requires_password_change',true));
 return pikas_private.identity_summary(p_person_id);
end $function$;

CREATE OR REPLACE FUNCTION public.identity_set_login_suspended(p_person_id uuid, p_suspended boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx jsonb; was boolean;
begin
 perform pikas_private.require_no_current_demo();
 ctx:=pikas_private.require_identity_support(p_person_id,true);
 if p_suspended is null then raise exception using errcode='22023',message='invalid_state'; end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null or length(btrim(p_reason))<3 then raise exception using errcode='22023',message='reason_required'; end if;
 select login_suspended_at is not null into was from pikas_private.login_identities where person_id=p_person_id;
 if was=p_suspended then return jsonb_build_object('auth_user_id',ctx->>'target_auth','changed',false); end if;
 update pikas_private.login_identities set login_suspended_at=case when p_suspended then clock_timestamp() end,version=version+1,updated_at=now() where person_id=p_person_id;
 if p_suspended then perform pikas_private.end_identity_sessions((ctx->>'target_auth')::uuid); end if;
 perform pikas_private.identity_audit(ctx,p_person_id,case when p_suspended then 'login_suspended' else 'login_reactivated' end,'{}'::jsonb,p_reason);
 return jsonb_build_object('auth_user_id',ctx->>'target_auth','changed',true);
end $function$;

CREATE OR REPLACE FUNCTION public.identity_set_username(p_person_id uuid, p_username text, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx jsonb; v text:=pikas_private.normalize_username(p_username); before text; ver bigint;
begin
 perform pikas_private.require_no_current_demo();
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_add_school_location(p_request_id uuid, p_account_id uuid, p_school_id uuid, p_location_code text, p_location_name text, p_cafeteria_code text, p_cafeteria_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid; auth_actor uuid; payload jsonb; fingerprint text; replay jsonb;
  account_status text; school_status text;
  location_id_value uuid; cafeteria_id_value uuid; result jsonb;
  location_code_value text; location_name_value text;
  cafeteria_code_value text; cafeteria_name_value text;
begin
 perform pikas_private.require_no_current_demo();
  actor:=pikas_private.require_platform_capability('platform:tenant:provision');
  auth_actor:=auth.uid();
  location_code_value:=nullif(btrim(p_location_code),'');
  location_name_value:=nullif(btrim(p_location_name),'');
  cafeteria_code_value:=nullif(btrim(p_cafeteria_code),'');
  cafeteria_name_value:=nullif(btrim(p_cafeteria_name),'');
  -- Codes are optional: when omitted PIKAS assigns SEDE-NN / CAF-NN below (explicit codes still accepted).
  if p_account_id is null or p_school_id is null
    or length(location_code_value)>64
    or location_name_value is null or length(location_name_value)>200
    or length(cafeteria_code_value)>64
    or cafeteria_name_value is null or length(cafeteria_name_value)>200 then
    raise exception using errcode='22023',message='invalid_school_location_input';
  end if;

  payload:=jsonb_build_object(
    'account_id',p_account_id,'school_id',p_school_id,
    'location_code',location_code_value,'location_name',location_name_value,
    'cafeteria_code',cafeteria_code_value,'cafeteria_name',cafeteria_name_value
  );
  fingerprint:=pikas_private.platform_request_fingerprint(payload);
  replay:=pikas_private.platform_replay_request(
    p_request_id,'school_location_add',fingerprint,actor
  );
  if replay is not null then return replay; end if;

  select a.status into account_status
  from public.accounts a where a.id=p_account_id for update;
  if not found or account_status<>'active' then
    raise exception using errcode='23503',message='active_account_school_required';
  end if;
  select s.status into school_status
  from public.schools s
  where s.id=p_school_id and s.account_id=p_account_id
  for update;
  if not found or school_status<>'active' then
    raise exception using errcode='23503',message='active_account_school_required';
  end if;

  location_code_value:=coalesce(location_code_value,pikas_private.next_scoped_code('sede',p_school_id));
  begin
    insert into public.school_locations(account_id,school_id,code,name)
      values(p_account_id,p_school_id,location_code_value,location_name_value)
      returning id into location_id_value;
    cafeteria_code_value:=coalesce(cafeteria_code_value,pikas_private.next_scoped_code('cafeteria',location_id_value));
    insert into public.cafeterias(
      account_id,school_id,school_location_id,code,name
    ) values (
      p_account_id,p_school_id,location_id_value,cafeteria_code_value,cafeteria_name_value
    ) returning id into cafeteria_id_value;
  exception when unique_violation then
    raise exception using errcode='23505',message='platform_tenant_code_conflict';
  end;

  result:=jsonb_build_object(
    'account_id',p_account_id,'school_id',p_school_id,
    'location_id',location_id_value,'cafeteria_id',cafeteria_id_value,
    'location_code',location_code_value,'cafeteria_code',cafeteria_code_value
  );
  insert into pikas_private.platform_requests(
    request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response
  ) values(p_request_id,'school_location_add',fingerprint,auth_actor,actor,result);
  perform pikas_private.record_platform_audit(
    p_request_id,actor,auth_actor,'platform:tenant:provision','school_location_added',
    'school_location_added',p_account_id,p_school_id,location_id_value,cafeteria_id_value,
    null,null,payload||jsonb_build_object('location_code',location_code_value,'cafeteria_code',cafeteria_code_value)
  );
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.platform_bind_activation(p_handle text, p_digest text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; i pikas_private.account_activation_invitations%rowtype; owner jsonb;
begin
 perform pikas_private.require_no_current_demo();
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_bind_customer_activation(p_intent_id uuid, p_handle text, p_digest text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; i pikas_private.platform_customer_admin_intents%rowtype;
 invitation pikas_private.account_activation_invitations%rowtype; f pikas_private.account_activation_flows%rowtype; owner jsonb;
begin
 perform pikas_private.require_no_current_demo();
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_complete_initial_customer_admin(p_request_id uuid, p_intent_id uuid, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; fingerprint text; replay jsonb; intent pikas_private.platform_customer_admin_intents%rowtype;
 target_auth uuid; matching_identities integer; result jsonb; payload jsonb;
begin
 perform pikas_private.require_no_current_demo();
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_grant_cafeteria_admin(p_request_id uuid, p_account_id uuid, p_person_id uuid, p_cafeteria_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; auth_actor uuid; payload jsonb; fingerprint text; replay jsonb; c public.cafeterias%rowtype;
 member uuid; member_status text; already boolean; result jsonb;
begin
 perform pikas_private.require_no_current_demo();
 actor:=pikas_private.require_platform_capability('platform:customer:access:provision');
 auth_actor:=auth.uid();
 if p_request_id is null or p_account_id is null or p_person_id is null or p_cafeteria_id is null then
  raise exception using errcode='22023',message='invalid_cafeteria_admin_grant';
 end if;
 payload:=jsonb_build_object('account_id',p_account_id,'person_id',p_person_id,'cafeteria_id',p_cafeteria_id);
 fingerprint:=pikas_private.platform_request_fingerprint(payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'cafeteria_admin_grant',fingerprint,actor);
 if replay is not null then return replay; end if;
 perform pikas_private.require_customer_provisioning(p_account_id,array['active']);
 select * into c from public.cafeterias where id=p_cafeteria_id and account_id=p_account_id for share;
 if not found then raise exception using errcode='42501',message='customer_access_scope_required'; end if;
 if not pikas_private.scope_active(c.account_id,c.school_id,c.id) then raise exception using errcode='23514',message='inactive_cafeteria'; end if;
 perform pikas_private.require_customer_person(p_account_id,p_person_id);
 -- Active Person with a confirmed, usable login (the existing POS identity rule).
 perform pikas_private.lock_cafeteria_pos_identity(p_person_id);
 select id,status into member,member_status from public.cafeteria_memberships
  where person_id=p_person_id and cafeteria_id=c.id and role_code='cafeteria_admin' for update;
 if found and member_status<>'active' then raise exception using errcode='23505',message='existing_membership_not_active'; end if;
 already:=member is not null;
 if not already then
  insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code)
  values(c.account_id,c.school_id,c.id,p_person_id,'cafeteria_admin') returning id into member;
 end if;
 result:=jsonb_build_object('membership_id',member,'person_id',p_person_id,'cafeteria_id',c.id,'already_granted',already);
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
 values(p_request_id,'cafeteria_admin_grant',fingerprint,auth_actor,actor,result);
 perform pikas_private.record_platform_audit(p_request_id,actor,auth_actor,'platform:customer:access:provision','cafeteria_admin_granted',
  'cafeteria_admin_granted',p_account_id,c.school_id,c.school_location_id,c.id,p_person_id,null,jsonb_build_object('already_granted',already));
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.platform_grant_customer_admin(p_request_id uuid, p_intent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid; auth_actor uuid; intent pikas_private.platform_customer_admin_intents%rowtype;
  target_person public.persons%rowtype; membership_id_value uuid; existing_status text;
  payload jsonb; fingerprint text; replay jsonb; result jsonb;
begin
 perform pikas_private.require_no_current_demo();
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_link_customer_admin_identity(p_request_id uuid, p_intent_id uuid, p_auth_user_id uuid, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid; auth_actor uuid; intent pikas_private.platform_customer_admin_intents%rowtype;
  target_user record; target_person_id uuid; display_name_value text;
  payload jsonb; fingerprint text; replay jsonb; result jsonb;
begin
 perform pikas_private.require_no_current_demo();
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_onboard_school(p_request_id uuid, p_school_name text, p_tax_id text, p_address_line text, p_country_code text, p_subdivision_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; auth_actor uuid; name_value text; tax_value text; address_value text;
 payload jsonb; fingerprint text; replay jsonb; suffix text; school_code_value text; tenant jsonb; result jsonb;
begin
 perform pikas_private.require_no_current_demo();
 actor:=pikas_private.require_platform_capability('platform:tenant:provision');
 auth_actor:=auth.uid();
 name_value:=nullif(btrim(p_school_name),'');
 tax_value:=pg_catalog.regexp_replace(coalesce(p_tax_id,''),'[[:space:]-]','','g');
 address_value:=nullif(btrim(p_address_line),'');
 if p_request_id is null or name_value is null or length(name_value)>200
   or tax_value !~ '^([0-9]{9}|[0-9]{11})$' or address_value is null or length(address_value)>300 then
  raise exception using errcode='22023',message='invalid_school_onboarding_input';
 end if;
 -- Current rollout: República Dominicana only, with a canonical province.
 if p_country_code is distinct from 'DO' or not exists(select 1 from pikas_private.country_subdivisions
   where country_code='DO' and code=p_subdivision_code) then
  raise exception using errcode='22023',message='unsupported_school_region';
 end if;
 payload:=jsonb_build_object('school_name',name_value,'tax_id',tax_value,'address_line',address_value,
  'country_code','DO','subdivision_code',p_subdivision_code);
 fingerprint:=pikas_private.platform_request_fingerprint(payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'school_onboard',fingerprint,actor);
 if replay is not null then return replay; end if;

 -- Codes derive only from the request key: a retry reproduces them and they reveal nothing about
 -- the colegio. Existing code_key uniqueness still rejects a collision (23505).
 suffix:=upper(substr(encode(extensions.digest('pikas:school-onboarding:'||p_request_id::text,'sha256'),'hex'),1,10));
 school_code_value:='COL-'||suffix;
 tenant:=public.platform_provision_tenant(
  pg_catalog.md5('pikas:school-onboarding:tenant:'||p_request_id::text)::uuid,
  'CLI-'||suffix,name_value,school_code_value,name_value,'America/Santo_Domingo',
  'SEDE-01','Sede principal','CAF-01','Cafetería principal');
 update public.schools set tax_id=tax_value,address_line=address_value,country_code='DO',subdivision_code=p_subdivision_code
  where id=(tenant->>'school_id')::uuid and account_id=(tenant->>'account_id')::uuid;
 if not found then raise exception using errcode='P0001',message='school_onboarding_inconsistent'; end if;

 result:=tenant||jsonb_build_object('school_code',school_code_value);
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
 values(p_request_id,'school_onboard',fingerprint,auth_actor,actor,result);
 perform pikas_private.record_platform_audit(
  p_request_id,actor,auth_actor,'platform:tenant:provision','school_onboarded','school_onboarded',
  (tenant->>'account_id')::uuid,(tenant->>'school_id')::uuid,(tenant->>'location_id')::uuid,(tenant->>'cafeteria_id')::uuid,
  null,null,jsonb_build_object('school_code',school_code_value,'country_code','DO','subdivision_code',p_subdivision_code));
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.platform_prepare_activation(p_team_handle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; intent pikas_private.platform_team_intents%rowtype; flow uuid; invitation text; owner jsonb;
begin
 perform pikas_private.require_no_current_demo();
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_prepare_customer_activation(p_intent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; i pikas_private.platform_customer_admin_intents%rowtype; flow uuid; invitation text; owner jsonb; state jsonb; issued_at timestamptz;
begin
 perform pikas_private.require_no_current_demo();
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_prepare_customer_admin(p_request_id uuid, p_account_id uuid, p_scope_kind text, p_school_id uuid, p_cafeteria_id uuid, p_role_code text, p_intended_email text, p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid; auth_actor uuid; email_key text; payload jsonb; fingerprint text; replay jsonb;
  intent_id_value uuid:=gen_random_uuid(); result jsonb;
begin
 perform pikas_private.require_no_current_demo();
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_prepare_customer_admin_named(p_request_id uuid, p_account_id uuid, p_scope_kind text, p_school_id uuid, p_cafeteria_id uuid, p_role_code text, p_intended_email text, p_expires_at timestamp with time zone, p_username text, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare name_value text:=nullif(btrim(p_display_name),''); result jsonb; stored text;
begin
 perform pikas_private.require_no_current_demo();
 if name_value is null or length(name_value)>200 then raise exception using errcode='22023',message='invalid_customer_admin_intent'; end if;
 result:=public.platform_prepare_customer_admin_with_username(p_request_id,p_account_id,p_scope_kind,p_school_id,p_cafeteria_id,p_role_code,p_intended_email,p_expires_at,p_username);
 update pikas_private.platform_customer_admin_intents set intended_display_name=name_value
  where id=(result->>'intent_id')::uuid and intended_display_name is null;
 select intended_display_name into stored from pikas_private.platform_customer_admin_intents where id=(result->>'intent_id')::uuid;
 if stored is distinct from name_value then raise exception using errcode='23505',message='platform_request_conflict'; end if;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.platform_prepare_customer_admin_with_username(p_request_id uuid, p_account_id uuid, p_scope_kind text, p_school_id uuid, p_cafeteria_id uuid, p_role_code text, p_intended_email text, p_expires_at timestamp with time zone, p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v text:=pikas_private.normalize_username(p_username); prior pikas_private.provisioning_username_requests; result jsonb; source uuid;
begin
 perform pikas_private.require_no_current_demo();
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_provision_tenant(p_request_id uuid, p_account_code text, p_account_name text, p_school_code text, p_school_name text, p_business_timezone text, p_location_code text, p_location_name text, p_cafeteria_code text, p_cafeteria_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid; auth_actor uuid; payload jsonb; fingerprint text; replay jsonb;
  account_id_value uuid; school_id_value uuid; location_id_value uuid; cafeteria_id_value uuid;
  result jsonb; account_code_value text; account_name_value text;
  school_code_value text; school_name_value text; timezone_value text;
  location_code_value text; location_name_value text; cafeteria_code_value text; cafeteria_name_value text;
begin
 perform pikas_private.require_no_current_demo();
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_rename_customer_person(p_request_id uuid, p_account_id uuid, p_person_id uuid, p_expected_name text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; auth_actor uuid; name_value text:=nullif(btrim(p_name),''); payload jsonb; fingerprint text; replay jsonb; current text; result jsonb;
begin
 perform pikas_private.require_no_current_demo();
 actor:=pikas_private.require_platform_capability('platform:customer:access:provision');
 auth_actor:=auth.uid();
 if p_request_id is null or p_account_id is null or p_person_id is null or p_expected_name is null or name_value is null or length(name_value)>200 then
  raise exception using errcode='22023',message='invalid_customer_person_name';
 end if;
 payload:=jsonb_build_object('account_id',p_account_id,'person_id',p_person_id,'expected_name',p_expected_name,'name',name_value);
 fingerprint:=pikas_private.platform_request_fingerprint(payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'customer_person_rename',fingerprint,actor);
 if replay is not null then return replay; end if;
 perform pikas_private.require_customer_provisioning(p_account_id,array['active','suspended']);
 perform pikas_private.require_customer_person(p_account_id,p_person_id);
 select display_name into current from public.persons where id=p_person_id;
 if current is distinct from p_expected_name then raise exception using errcode='23514',message='customer_person_changed'; end if;
 update public.persons set display_name=name_value where id=p_person_id;
 result:=jsonb_build_object('person_id',p_person_id,'display_name',name_value);
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
 values(p_request_id,'customer_person_rename',fingerprint,auth_actor,actor,result);
 perform pikas_private.record_platform_audit(p_request_id,actor,auth_actor,'platform:customer:access:provision','customer_person_renamed',
  'customer_person_renamed',p_account_id,null,null,null,p_person_id,null,jsonb_build_object('previous_name',current,'new_name',name_value));
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.platform_rename_customer_structure(p_request_id uuid, p_account_id uuid, p_kind text, p_target_id uuid, p_expected_name text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; auth_actor uuid; name_value text; payload jsonb; fingerprint text; replay jsonb;
 current_name text; school uuid; location uuid; cafeteria uuid; result jsonb;
begin
 perform pikas_private.require_no_current_demo();
 actor:=pikas_private.require_platform_capability('platform:customer:profile:manage');
 auth_actor:=auth.uid();
 name_value:=nullif(btrim(p_name),'');
 if p_request_id is null or p_account_id is null or p_target_id is null or p_kind is null or p_kind not in ('location','cafeteria')
   or name_value is null or length(name_value)>200 or p_expected_name is null then
  raise exception using errcode='22023',message='invalid_customer_structure_input';
 end if;
 payload:=jsonb_build_object('account_id',p_account_id,'kind',p_kind,'target_id',p_target_id,'expected_name',p_expected_name,'name',name_value);
 fingerprint:=pikas_private.platform_request_fingerprint(payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'customer_structure_rename',fingerprint,actor);
 if replay is not null then return replay; end if;

 perform pikas_private.require_customer_profile_scope(p_account_id);
 if p_kind='location' then
  select l.name,l.school_id,l.id into current_name,school,location from public.school_locations l where l.id=p_target_id and l.account_id=p_account_id for update;
 else
  select c.name,c.school_id,c.school_location_id,c.id into current_name,school,location,cafeteria from public.cafeterias c where c.id=p_target_id and c.account_id=p_account_id for update;
 end if;
 if not found then raise exception using errcode='42501',message='customer_profile_scope_required'; end if;
 if current_name is distinct from p_expected_name then raise exception using errcode='23514',message='customer_profile_changed'; end if;
 if p_kind='location' then update public.school_locations set name=name_value where id=p_target_id and account_id=p_account_id;
 else update public.cafeterias set name=name_value where id=p_target_id and account_id=p_account_id; end if;

 result:=jsonb_build_object('account_id',p_account_id,'kind',p_kind,'target_id',p_target_id,'name',name_value);
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
 values(p_request_id,'customer_structure_rename',fingerprint,auth_actor,actor,result);
 perform pikas_private.record_platform_audit(p_request_id,actor,auth_actor,'platform:customer:profile:manage','customer_structure_renamed',
  'customer_structure_renamed',p_account_id,school,location,cafeteria,null,null,jsonb_build_object('kind',p_kind,'changed',current_name is distinct from name_value));
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.platform_team_command(p_request_id uuid, p_operation text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; fp text; replay jsonb; result jsonb; allowed text[]; target uuid; auth_id uuid; matches integer;
 intent pikas_private.platform_team_intents%rowtype; member pikas_private.platform_memberships%rowtype; enabled boolean;
begin
 perform pikas_private.require_no_current_demo();
 actor:=pikas_private.lock_platform_team_actor();
 allowed:=case p_operation when 'prepare' then array['name','email','demo'] when 'complete' then array['handle'] when 'demo' then array['handle','enabled'] end;
 if allowed is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception using errcode='22023',message='invalid_team_command'; end if;
 if not(p_payload ?& allowed) or exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(allowed)) then raise exception using errcode='22023',message='unsupported_team_fields'; end if;
 fp:=pikas_private.platform_request_fingerprint(p_payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'team_'||p_operation,fp,actor);
 if replay is not null then return replay; end if;
 if p_operation='prepare' then
  if jsonb_typeof(p_payload->'name')<>'string' or jsonb_typeof(p_payload->'email')<>'string' or jsonb_typeof(p_payload->'demo')<>'boolean' then raise exception using errcode='22023',message='invalid_team_input'; end if;
  if exists(select 1 from pikas_private.platform_team_intents where email_key=lower(btrim(p_payload->>'email')) and status='pending' and expires_at>clock_timestamp()) then raise exception using errcode='23505',message='team_intent_already_pending'; end if;
  insert into pikas_private.platform_team_intents(display_name,email_key,demo,created_by) values(btrim(p_payload->>'name'),lower(btrim(p_payload->>'email')),(p_payload->>'demo')::boolean,actor);
 elsif p_operation='complete' then
  select * into intent from pikas_private.platform_team_intents where handle=p_payload->>'handle' for update;
  if not found or intent.status<>'pending' or intent.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_team_intent_required'; end if;
  select count(*) into matches from auth.users where lower(btrim(email))=intent.email_key;
  if matches<>1 then raise exception using errcode='23514',message='confirmed_identity_pending'; end if;
  begin
   select u.id into strict auth_id from auth.users u where lower(btrim(u.email))=intent.email_key and u.confirmed_at is not null
    and (not(to_jsonb(u)?'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
    and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
    and to_jsonb(u)->>'deleted_at' is null and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false for share;
  exception when no_data_found or too_many_rows then raise exception using errcode='23514',message='confirmed_identity_pending'; end;
  select id into target from public.persons where auth_user_id=auth_id for update;
  -- Never convert a customer identity or silently reactivate an existing operator.
  if auth_id=auth.uid() or exists(select 1 from public.account_memberships where person_id=target)
   or exists(select 1 from public.school_memberships where person_id=target)
   or exists(select 1 from public.cafeteria_memberships where person_id=target)
   or exists(select 1 from pikas_private.platform_memberships where person_id=target) then raise exception using errcode='42501',message='new_internal_operator_required'; end if;
  if target is not null and not exists(select 1 from public.persons where id=target and status='active') then raise exception using errcode='23514',message='active_person_required'; end if;
  if intent.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_team_intent_required'; end if;
  if target is null then insert into public.persons(auth_user_id,display_name) values(auth_id,intent.display_name) returning id into target; end if;
  insert into pikas_private.platform_memberships(person_id,role_code,granted_by_person_id) values(target,'platform_admin',actor);
  if intent.demo then insert into pikas_private.platform_memberships(person_id,role_code,granted_by_person_id) values(target,'platform_sandbox_operator',actor); end if;
  insert into pikas_private.platform_team_handles(person_id) values(target);
  update pikas_private.platform_team_intents set status='completed',person_id=target where handle=intent.handle;
 elsif p_operation='demo' then
  if jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception using errcode='22023',message='invalid_demo_flag'; end if;
  enabled:=(p_payload->>'enabled')::boolean;
  select person_id into target from pikas_private.platform_team_handles where handle=p_payload->>'handle';
  if target is null then raise exception using errcode='42501',message='internal_operator_required'; end if;
  perform 1 from public.persons where id=target and status='active' for share;
  if enabled and not found then raise exception using errcode='23514',message='active_operator_required'; end if;
  perform 1 from pikas_private.platform_memberships where person_id=target and role_code='platform_admin' and status='active' for share;
  if enabled and not found then raise exception using errcode='23514',message='active_platform_admin_required'; end if;
  if enabled then
   perform 1 from auth.users u join public.persons p on p.auth_user_id=u.id where p.id=target and u.confirmed_at is not null
    and (not(to_jsonb(u)?'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
    and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
    and to_jsonb(u)->>'deleted_at' is null and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false for share of u;
   if not found then raise exception using errcode='23514',message='confirmed_identity_pending'; end if;
  end if;
  select * into member from pikas_private.platform_memberships where person_id=target and role_code='platform_sandbox_operator' and status<>'inactive' for update;
  if enabled then
   if not found then insert into pikas_private.platform_memberships(person_id,role_code,granted_by_person_id) values(target,'platform_sandbox_operator',actor);
   elsif member.status<>'active' then update pikas_private.platform_memberships set status='active' where id=member.id; end if;
  elsif found then update pikas_private.platform_memberships set status='inactive' where id=member.id; end if;
 end if;
 if pikas_private.require_platform_capability('platform:team:manage') is distinct from actor then raise exception using errcode='42501',message='platform_actor_changed'; end if;
 result:=jsonb_build_object('request_id',p_request_id,'operation',p_operation,'status','confirmed');
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response) values(p_request_id,'team_'||p_operation,fp,auth.uid(),actor,result);
 perform pikas_private.record_platform_audit(p_request_id,actor,auth.uid(),'platform:team:manage','team_'||p_operation,
  case p_operation when 'prepare' then 'team_prepared' when 'complete' then 'team_completed' else 'team_demo_changed' end,
  null,null,null,null,target,null,jsonb_build_object('demo',case when p_operation='complete' then intent.demo when p_operation='demo' then enabled else (p_payload->>'demo')::boolean end));
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.platform_update_colegio_profile(p_request_id uuid, p_account_id uuid, p_school_id uuid, p_expected jsonb, p_name text, p_tax_id text, p_address_line text, p_country_code text, p_subdivision_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; auth_actor uuid; name_value text; tax_value text; address_value text; province_value text; country_value text;
 payload jsonb; fingerprint text; replay jsonb; current public.schools%rowtype; school_count integer; renamed boolean; changed text[]; result jsonb;
begin
 perform pikas_private.require_no_current_demo();
 actor:=pikas_private.require_platform_capability('platform:customer:profile:manage');
 auth_actor:=auth.uid();
 name_value:=nullif(btrim(p_name),'');
 tax_value:=nullif(pg_catalog.regexp_replace(coalesce(p_tax_id,''),'[[:space:]-]','','g'),'');
 address_value:=nullif(btrim(p_address_line),'');
 province_value:=nullif(btrim(p_subdivision_code),'');
 country_value:=nullif(btrim(p_country_code),'');
 if p_request_id is null or p_account_id is null or p_school_id is null or p_expected is null or jsonb_typeof(p_expected)<>'object'
   or name_value is null or length(name_value)>200 or (tax_value is not null and tax_value !~ '^([0-9]{9}|[0-9]{11})$')
   or length(address_value)>300 then
  raise exception using errcode='22023',message='invalid_customer_profile_input';
 end if;
 -- Province is optional for colegios that predate it; when present the country is República Dominicana.
 if province_value is null then country_value:=null;
 elsif country_value is distinct from 'DO' or not exists(select 1 from pikas_private.country_subdivisions where country_code='DO' and code=province_value) then
  raise exception using errcode='22023',message='unsupported_school_region';
 end if;
 payload:=jsonb_build_object('account_id',p_account_id,'school_id',p_school_id,'expected',p_expected,'name',name_value,'tax_id',tax_value,
  'address_line',address_value,'country_code',country_value,'subdivision_code',province_value);
 fingerprint:=pikas_private.platform_request_fingerprint(payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'customer_profile_update',fingerprint,actor);
 if replay is not null then return replay; end if;

 perform pikas_private.require_customer_profile_scope(p_account_id);
 select * into current from public.schools s where s.id=p_school_id and s.account_id=p_account_id for update;
 if not found then raise exception using errcode='42501',message='customer_profile_scope_required'; end if;
 -- Reject an edit made against values that changed since the operator loaded them.
 if current.name is distinct from p_expected->>'name' or current.tax_id is distinct from p_expected->>'rnc'
   or current.address_line is distinct from p_expected->>'address' or current.subdivision_code is distinct from p_expected->>'province' then
  raise exception using errcode='23514',message='customer_profile_changed';
 end if;
 changed:=array_remove(array[
  case when current.name is distinct from name_value then 'name' end,
  case when current.tax_id is distinct from tax_value then 'rnc' end,
  case when current.address_line is distinct from address_value then 'address' end,
  case when current.subdivision_code is distinct from province_value then 'province' end],null);
 update public.schools set name=name_value,tax_id=tax_value,address_line=address_value,country_code=country_value,subdivision_code=province_value
  where id=p_school_id and account_id=p_account_id;
 -- One customer → one colegio: the customer account carries the colegio's name.
 select count(*) into school_count from public.schools where account_id=p_account_id;
 -- Invariant: the customer follows its only colegio, including legacy names that never matched.
 renamed:=school_count=1 and exists(select 1 from public.accounts where id=p_account_id and name is distinct from name_value);
 if renamed then update public.accounts set name=name_value where id=p_account_id; end if;

 result:=jsonb_build_object('account_id',p_account_id,'school_id',p_school_id,'account_renamed',renamed,'changed',to_jsonb(changed));
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
 values(p_request_id,'customer_profile_update',fingerprint,auth_actor,actor,result);
 perform pikas_private.record_platform_audit(p_request_id,actor,auth_actor,'platform:customer:profile:manage','customer_profile_updated',
  'customer_profile_updated',p_account_id,p_school_id,null,null,null,null,jsonb_build_object('changed',to_jsonb(changed),'account_renamed',renamed));
 return result;
end $function$;

-- Every guarded function must carry the guard; a missing one fails the migration.
do $$declare missing text; begin
 select string_agg(p.proname,', ') into missing from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('identity_begin_email_change','identity_begin_temporary_access','identity_finish_email_change','identity_finish_temporary_access','identity_set_login_suspended','identity_set_username','platform_add_school_location','platform_bind_activation','platform_bind_customer_activation','platform_complete_initial_customer_admin','platform_grant_cafeteria_admin','platform_grant_customer_admin','platform_link_customer_admin_identity','platform_onboard_school','platform_prepare_activation','platform_prepare_customer_activation','platform_prepare_customer_admin','platform_prepare_customer_admin_named','platform_prepare_customer_admin_with_username','platform_provision_tenant','platform_rename_customer_person','platform_rename_customer_structure','platform_team_command','platform_update_colegio_profile') and p.prosrc !~ 'require_no_current_demo';
 if missing is not null then raise exception 'demo guard missing: %', missing; end if;
end$$;
commit;
