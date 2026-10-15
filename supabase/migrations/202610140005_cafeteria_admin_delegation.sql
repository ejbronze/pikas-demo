-- Explicit customer delegation only. No implicit cafeteria/POS authority.
begin;
insert into pikas_private.role_capabilities values ('account','account_admin','account:cafeteria_admins:manage');
alter table pikas_private.account_activation_flows drop constraint account_activation_flows_source_kind_check;
alter table pikas_private.account_activation_flows add constraint account_activation_flows_source_kind_check
 check(source_kind in ('platform_team','initial_customer_admin','school_admin','cafeteria_staff','cafeteria_admin'));

create function pikas_private.require_cafeteria_delegator(p_cafeteria_id uuid,p_school_id uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; c public.cafeterias%rowtype;
begin
 perform pikas_private.application_session_assert();
 if pikas_private.sandbox_pov_active_attempt() then raise exception 'customer_account_admin_required' using errcode='42501'; end if;
 actor:=pikas_private.current_person_id();
 select * into c from public.cafeterias where id=p_cafeteria_id and school_id=p_school_id;
 if actor is null or c.id is null then raise exception 'customer_account_admin_required' using errcode='42501'; end if;
 perform 1 from public.persons where id=actor and status='active' for share;
 perform 1 from public.accounts where id=c.account_id and status='active' and tenant_kind='customer' for share;
 if not found then raise exception 'customer_account_admin_required' using errcode='42501'; end if;
 perform 1 from public.schools where id=c.school_id for share;
 perform 1 from public.school_locations where id=c.school_location_id for share;
 perform 1 from public.cafeterias where id=c.id for share;
 perform 1 from public.account_memberships where person_id=actor and account_id=c.account_id and role_code='account_admin' and status='active' for share;
 if not found or actor is distinct from pikas_private.current_person_id() or not pikas_private.scope_active(c.account_id,c.school_id,c.id)
  or not pikas_private.has_capability('account:cafeteria_admins:manage',c.account_id)
  or exists(select 1 from pikas_private.platform_memberships where person_id=actor) then
  raise exception 'customer_account_admin_required' using errcode='42501'; end if;
 perform pikas_private.application_session_assert();
 return actor;
end $$;
create or replace function pikas_private.lock_activation_source(p_kind text,p_handle text,p_email text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_kind='platform_team' then
  perform 1 from pikas_private.platform_team_intents where handle=p_handle and email_key=p_email
   and status='pending' and expires_at>clock_timestamp() for share;
 elsif p_kind='initial_customer_admin' then
  perform 1 from pikas_private.platform_customer_admin_intents where id::text=p_handle and intended_email_key=p_email
   and status in ('pending','linked') and expires_at>clock_timestamp() for share;
 elsif p_kind in ('school_admin','cafeteria_staff','cafeteria_admin') then
  perform 1 from public.invitations where id::text=p_handle and email_key=p_email and status='pending' and expires_at>clock_timestamp()
   and ((p_kind='school_admin' and scope_kind='school' and role_code='school_admin')
    or (p_kind='cafeteria_admin' and scope_kind='cafeteria' and role_code='cafeteria_admin')
    or (p_kind='cafeteria_staff' and scope_kind='cafeteria' and role_code in ('pos_cashier','pos_supervisor'))) for share;
 else raise exception using errcode='42501',message='unsupported_activation_source';
 end if;
 if not found then raise exception using errcode='42501',message='pending_intent_required'; end if;
end $$;
revoke all on function pikas_private.lock_activation_source(text,text,text) from public,anon,authenticated,service_role;

create function pikas_private.cafeteria_delegation_identity_state(p_invitation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i public.invitations%rowtype; f pikas_private.account_activation_flows%rowtype;
 managed pikas_private.account_activation_flows%rowtype; u auth.users%rowtype; identity_state text; link_state text:='none'; deadline timestamptz; matches integer;
begin
 select * into strict i from public.invitations where id=p_invitation_id;
 if i.status not in ('pending') or i.expires_at<=clock_timestamp() then identity_state:='unavailable';
 else
  select * into f from pikas_private.account_activation_flows where source_kind='cafeteria_admin' and source_handle=i.id::text;
  select count(*) into matches from auth.users where lower(btrim(email))=i.email_key;
  if matches=0 then identity_state:=case when f.auth_id is null then 'missing' else 'unavailable' end;
  elsif matches<>1 then identity_state:='unavailable';
  else
   select * into strict u from auth.users where lower(btrim(email))=i.email_key;
   select * into managed from pikas_private.account_activation_flows where auth_id=u.id;
   if u.deleted_at is not null or u.is_anonymous or (u.banned_until is not null and u.banned_until>clock_timestamp())
    or u.id=auth.uid() or exists(select 1 from public.persons p join pikas_private.platform_memberships m on m.person_id=p.id where p.auth_user_id=u.id)
    or exists(select 1 from public.persons where auth_user_id=u.id and status<>'active')
    or exists(select 1 from public.persons p where p.auth_user_id=u.id and (exists(select 1 from public.account_memberships m where m.person_id=p.id and m.account_id<>i.account_id) or exists(select 1 from public.school_memberships m where m.person_id=p.id and m.account_id<>i.account_id) or exists(select 1 from public.cafeteria_memberships m where m.person_id=p.id and m.account_id<>i.account_id)))
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


create function public.cafeteria_delegation_read(p_school_id uuid,p_cafeteria_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; result jsonb;
begin
 actor:=pikas_private.require_cafeteria_delegator(p_cafeteria_id,p_school_id);
 result:=jsonb_build_object('self_status',(select status from public.cafeteria_memberships where cafeteria_id=p_cafeteria_id and person_id=actor and role_code='cafeteria_admin'),
 'administrators',coalesce((select jsonb_agg(jsonb_build_object('name',p.display_name,'status',m.status) order by p.display_name,m.id) from public.cafeteria_memberships m join public.persons p on p.id=m.person_id where cafeteria_id=p_cafeteria_id and role_code='cafeteria_admin'),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.intended_email,'status',case when i.status='pending' and i.expires_at<=clock_timestamp() then 'expired' else i.status end,'identity',pikas_private.cafeteria_delegation_identity_state(i.id)->>'identity_state','link_state',pikas_private.cafeteria_delegation_identity_state(i.id)->>'link_state') order by i.created_at,i.id) from public.invitations i where i.cafeteria_id=p_cafeteria_id and i.role_code='cafeteria_admin'),'[]'::jsonb));
 perform pikas_private.require_cafeteria_delegator(p_cafeteria_id,p_school_id);
 return result;
end $$;

create function public.cafeteria_delegation_command(p_school_id uuid,p_cafeteria_id uuid,p_request_id uuid,p_operation text,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; c public.cafeterias%rowtype; fp text; prior pikas_private.school_admin_requests%rowtype;
 i public.invitations%rowtype; target uuid; target_auth uuid; member uuid; member_status text; result jsonb; allowed text[];
begin
 actor:=pikas_private.require_cafeteria_delegator(p_cafeteria_id,p_school_id);
 select * into strict c from public.cafeterias where id=p_cafeteria_id;
 allowed:=case p_operation when 'cafeteria_admin_self' then array['cafeteria_id'] when 'cafeteria_admin_prepare' then array['cafeteria_id','email'] when 'cafeteria_admin_complete' then array['cafeteria_id','invitation_id','display_name'] end;
 if allowed is null or p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or (p_payload->>'cafeteria_id')::uuid is distinct from c.id or exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(allowed)) then raise exception 'invalid_delegation_payload' using errcode='22023'; end if;
 fp:=encode(extensions.digest(jsonb_build_object('school',p_school_id,'cafeteria',p_cafeteria_id,'operation',p_operation,'payload',p_payload)::text,'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,202610140005));
 perform pikas_private.require_cafeteria_delegator(p_cafeteria_id,p_school_id);
 select * into prior from pikas_private.school_admin_requests where request_id=p_request_id;
 if found then
  if prior.actor_auth_id<>auth.uid() or prior.actor_person_id<>actor or prior.school_id<>p_school_id or prior.fingerprint<>fp then raise exception 'delegation_request_mismatch' using errcode='42501'; end if;
  return prior.response;
 end if;
 if p_operation='cafeteria_admin_prepare' then
  if p_payload->>'email' is null or length(btrim(p_payload->>'email')) not between 3 and 254 or position('@' in btrim(p_payload->>'email'))<2 then raise exception 'invalid_admin_email' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.id::text||lower(btrim(p_payload->>'email')),202610140005));
  select * into i from public.invitations where cafeteria_id=c.id and role_code='cafeteria_admin' and email_key=lower(btrim(p_payload->>'email')) and status='pending' and expires_at>clock_timestamp() order by id limit 1 for update;
  if not found then
   insert into public.invitations(account_id,school_id,cafeteria_id,scope_kind,role_code,intended_email,token_hash,invited_by,expires_at)
   values(c.account_id,c.school_id,c.id,'cafeteria','cafeteria_admin',btrim(p_payload->>'email'),encode(extensions.gen_random_bytes(32),'hex'),actor,clock_timestamp()+interval '7 days') returning * into i;
  end if;
  result:=jsonb_build_object('invitation_id',i.id,'status','pending');
 else
  if p_operation='cafeteria_admin_self' then target:=actor;
  else
   select * into i from public.invitations where id=(p_payload->>'invitation_id')::uuid and account_id=c.account_id and school_id=c.school_id and cafeteria_id=c.id and scope_kind='cafeteria' and role_code='cafeteria_admin' for update;
   if not found or i.status<>'pending' or i.expires_at<=clock_timestamp() then raise exception 'pending_cafeteria_invitation_required' using errcode='23514'; end if;
   if pikas_private.cafeteria_delegation_identity_state(i.id)->>'identity_state'<>'ready' then raise exception 'confirmed_identity_pending' using errcode='23514'; end if;
   select id into strict target_auth from auth.users where lower(btrim(email))=i.email_key for share;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_auth::text,202610140005));
   -- Re-read eligibility after identity lock waits; matching email alone never proves activation ownership.
   if pikas_private.cafeteria_delegation_identity_state(i.id)->>'identity_state'<>'ready' or i.expires_at<=clock_timestamp() then raise exception 'confirmed_identity_pending' using errcode='23514'; end if;
   select id into target from public.persons where auth_user_id=target_auth for share;
   if target is null then
    if nullif(btrim(p_payload->>'display_name'),'') is null or length(btrim(p_payload->>'display_name'))>200 then raise exception 'display_name_required' using errcode='22023'; end if;
    insert into public.persons(auth_user_id,display_name) values(target_auth,btrim(p_payload->>'display_name')) returning id into target;
   end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.id::text||target::text,202610140005));
  select id,status into member,member_status from public.cafeteria_memberships where person_id=target and cafeteria_id=c.id and role_code='cafeteria_admin' for update;
  if found and member_status<>'active' then raise exception 'existing_membership_not_active' using errcode='23505'; end if;
  if member is null then insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code) values(c.account_id,c.school_id,c.id,target,'cafeteria_admin') returning id into member; end if;
  if i.id is not null then update public.invitations set status='accepted',accepted_person_id=target,accepted_at=clock_timestamp() where id=i.id; end if;
  result:=jsonb_build_object('membership_id',member,'status','accepted');
 end if;
 perform pikas_private.require_cafeteria_delegator(p_cafeteria_id,p_school_id);
 insert into pikas_private.school_admin_requests(request_id,actor_person_id,actor_auth_id,account_id,school_id,fingerprint,response) values(p_request_id,actor,auth.uid(),c.account_id,c.school_id,fp,result);
 insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,school_id,cafeteria_id,action,target_type,target_id,request_id,outcome,after_metadata)
 values(actor,auth.uid(),'account_admin','account',c.account_id,c.school_id,c.id,p_operation,case when p_operation='cafeteria_admin_prepare' then 'invitations' else 'cafeteria_memberships' end,coalesce(member,i.id),p_request_id,'succeeded',jsonb_build_object('role','cafeteria_admin','invitation_id',i.id));
 return result;
end $$;

create function public.cafeteria_prepare_admin_activation(p_invitation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; i public.invitations%rowtype; flow uuid; invitation text; owner jsonb; state jsonb; issued_at timestamptz;
begin

 select * into i from public.invitations where id=p_invitation_id;
 actor:=pikas_private.require_cafeteria_delegator(i.cafeteria_id,i.school_id);
 select * into i from public.invitations where id=p_invitation_id for update;
 if not found or i.scope_kind<>'cafeteria' or i.role_code<>'cafeteria_admin' or i.status<>'pending' or i.expires_at<=clock_timestamp() then
  raise exception 'pending_intent_required' using errcode='42501'; end if;
 actor:=pikas_private.require_cafeteria_delegator(i.cafeteria_id,i.school_id);
 perform pikas_private.require_cafeteria_delegator(i.cafeteria_id,i.school_id);
 if i.expires_at<=clock_timestamp() then raise exception 'pending_intent_required' using errcode='42501'; end if;
 state:=pikas_private.cafeteria_delegation_identity_state(i.id);
 if state->>'identity_state'='ready' then return jsonb_build_object('status','identity_ready'); end if;
 if state->>'identity_state'='unavailable' then raise exception 'activation_identity_unavailable' using errcode='42501'; end if;
 insert into pikas_private.account_activation_flows(source_kind,source_handle,email_key)
 values('cafeteria_admin',i.id::text,i.email_key) on conflict(source_kind,source_handle) do nothing;
 select id into strict flow from pikas_private.account_activation_flows where source_kind='cafeteria_admin' and source_handle=i.id::text and email_key=i.email_key for update;
 owner:=pikas_private.activation_owner(flow);
 if (owner->>'ready')::boolean then raise exception 'activation_already_ready' using errcode='42501'; end if;
 perform pikas_private.require_cafeteria_delegator(i.cafeteria_id,i.school_id);
 if i.expires_at<=clock_timestamp() then raise exception 'pending_intent_required' using errcode='42501'; end if;
 issued_at:=clock_timestamp();
 insert into pikas_private.account_activation_invitations(flow_id,created_by,created_at,expires_at)
 values(flow,actor,issued_at,least(i.expires_at,issued_at+interval '1 hour')) returning handle into invitation;
 insert into pikas_private.account_activation_events(invitation_handle,action,actor_auth_id) values(invitation,'prepared',auth.uid());
 return jsonb_build_object('status','prepared','handle',invitation,'email',i.email_key);
end $$;

create function public.cafeteria_bind_admin_activation(p_invitation_id uuid,p_handle text,p_digest text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; i public.invitations%rowtype;
 invitation pikas_private.account_activation_invitations%rowtype; f pikas_private.account_activation_flows%rowtype; owner jsonb;
begin

 select * into i from public.invitations where id=p_invitation_id;
 actor:=pikas_private.require_cafeteria_delegator(i.cafeteria_id,i.school_id);
 select * into i from public.invitations where id=p_invitation_id for update;
 if not found or i.scope_kind<>'cafeteria' or i.role_code<>'cafeteria_admin' or i.status<>'pending' or i.expires_at<=clock_timestamp() then
  raise exception 'pending_intent_required' using errcode='42501'; end if;
 actor:=pikas_private.require_cafeteria_delegator(i.cafeteria_id,i.school_id);
 -- Check source association before locking another source's flow/invitation.
 if not exists(select 1 from pikas_private.account_activation_invitations ai join pikas_private.account_activation_flows af on af.id=ai.flow_id
  where ai.handle=p_handle and af.source_kind='cafeteria_admin' and af.source_handle=i.id::text and af.email_key=i.email_key) then
  raise exception 'invitation_unavailable' using errcode='42501'; end if;
 perform pikas_private.lock_activation(p_handle,null);
 select * into strict invitation from pikas_private.account_activation_invitations where handle=p_handle;
 select * into strict f from pikas_private.account_activation_flows where id=invitation.flow_id;
 if invitation.created_by<>actor then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid_digest' using errcode='22023'; end if;
 owner:=pikas_private.activation_owner(f.id);
 if owner->>'auth_id' is null or (owner->>'ready')::boolean then raise exception 'activation_identity_unavailable' using errcode='42501'; end if;
 perform pikas_private.require_cafeteria_delegator(i.cafeteria_id,i.school_id);
 if invitation.expires_at<=clock_timestamp() or i.expires_at<=clock_timestamp() then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 if invitation.token_digest is not null then
  if invitation.token_digest=p_digest then return; end if;
  raise exception 'invitation_unavailable' using errcode='42501';
 end if;
 update pikas_private.account_activation_invitations set revoked_at=clock_timestamp() where flow_id=f.id and handle<>p_handle and revoked_at is null;
 update pikas_private.account_activation_invitations set token_digest=p_digest where handle=p_handle;
 insert into pikas_private.account_activation_events(invitation_handle,action,actor_auth_id) values(p_handle,'bound',auth.uid());
end $$;


revoke all on function pikas_private.require_cafeteria_delegator(uuid,uuid),pikas_private.cafeteria_delegation_identity_state(uuid) from public,anon,authenticated,service_role;
revoke all on function public.cafeteria_delegation_read(uuid,uuid),public.cafeteria_delegation_command(uuid,uuid,uuid,text,jsonb),public.cafeteria_prepare_admin_activation(uuid),public.cafeteria_bind_admin_activation(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.cafeteria_delegation_read(uuid,uuid),public.cafeteria_delegation_command(uuid,uuid,uuid,text,jsonb),public.cafeteria_prepare_admin_activation(uuid),public.cafeteria_bind_admin_activation(uuid,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
