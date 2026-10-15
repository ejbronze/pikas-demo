-- Existing cafeteria_staff source; identity activation never grants operational authority.
begin;
create function pikas_private.require_staff_activation_admin(p_invitation_id uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare i public.invitations%rowtype; ctx jsonb;
begin
 perform pikas_private.application_session_assert();
 if pikas_private.sandbox_pov_active_attempt() then raise exception 'real_cafeteria_admin_required' using errcode='42501'; end if;
 select * into i from public.invitations where id=p_invitation_id and scope_kind='cafeteria' and role_code in ('pos_cashier','pos_supervisor');
 if not found then raise exception 'staff_invitation_required' using errcode='42501'; end if;
 ctx:=pikas_private.require_cafeteria_admin(i.cafeteria_id,true);
 if not exists(select 1 from public.accounts where id=i.account_id and tenant_kind='customer' and status='active')
  or not pikas_private.has_capability('cafeteria:pos:memberships:manage',i.account_id,i.school_id,i.cafeteria_id)
  or exists(select 1 from pikas_private.platform_memberships where person_id=(ctx->>'actor_id')::uuid) then raise exception 'real_cafeteria_admin_required' using errcode='42501'; end if;
 perform pikas_private.application_session_assert();
 return (ctx->>'actor_id')::uuid;
end $$;
create function pikas_private.staff_activation_identity_state(p_invitation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i public.invitations%rowtype; f pikas_private.account_activation_flows%rowtype;
 managed pikas_private.account_activation_flows%rowtype; u auth.users%rowtype; identity_state text; link_state text:='none'; deadline timestamptz; matches integer;
begin
 select * into strict i from public.invitations where id=p_invitation_id;
 if i.status not in ('pending') or i.expires_at<=clock_timestamp() then identity_state:='unavailable';
 else
  select * into f from pikas_private.account_activation_flows where source_kind='cafeteria_staff' and source_handle=i.id::text;
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
 return jsonb_build_object('invitation_id',i.id,'account_id',i.account_id,'identity_state',identity_state,'link_state',coalesce(link_state,'none'),'expires_at',deadline);
end $$;



create function pikas_private.require_staff_password_ready(p_invitation_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 -- Preserve legacy eligibility/denial semantics for independent existing identities.
 -- Managed identities must prove the first password even when finalize was lost.
 if exists(select 1 from public.invitations i join auth.users u on lower(btrim(u.email))=i.email_key
  join pikas_private.account_activation_flows f on f.auth_id=u.id or f.owner_key=u.raw_app_meta_data->>'pikas_activation_owner'
  where i.id=p_invitation_id and (f.auth_id is distinct from u.id
   or u.raw_app_meta_data->>'pikas_activation_owner' is distinct from f.owner_key or f.password_baseline is null
   or u.email_confirmed_at is null or encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex')=f.password_baseline)) then
  raise exception 'confirmed_identity_pending' using errcode='23514';
 end if;
end $$;
create function public.cafeteria_staff_activation_status(p_invitation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare state jsonb;
begin
 perform pikas_private.require_staff_activation_admin(p_invitation_id);
 state:=pikas_private.staff_activation_identity_state(p_invitation_id);
 perform pikas_private.require_staff_activation_admin(p_invitation_id);
 return state;
end $$;
create function public.cafeteria_prepare_staff_activation(p_invitation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; i public.invitations%rowtype; flow uuid; invitation text; owner jsonb; state jsonb; issued_at timestamptz;
begin

 select * into i from public.invitations where id=p_invitation_id;
 actor:=pikas_private.require_staff_activation_admin(i.id);
 select * into i from public.invitations where id=p_invitation_id for update;
 if not found or i.scope_kind<>'cafeteria' or i.role_code not in ('pos_cashier','pos_supervisor') or i.status<>'pending' or i.expires_at<=clock_timestamp() then
  raise exception 'pending_intent_required' using errcode='42501'; end if;
 actor:=pikas_private.require_staff_activation_admin(i.id);
 perform pikas_private.require_staff_activation_admin(i.id);
 if i.expires_at<=clock_timestamp() then raise exception 'pending_intent_required' using errcode='42501'; end if;
 state:=pikas_private.staff_activation_identity_state(i.id);
 if state->>'identity_state'='ready' then return jsonb_build_object('status','identity_ready'); end if;
 if state->>'identity_state'='unavailable' then raise exception 'activation_identity_unavailable' using errcode='42501'; end if;
 insert into pikas_private.account_activation_flows(source_kind,source_handle,email_key)
 values('cafeteria_staff',i.id::text,i.email_key) on conflict(source_kind,source_handle) do nothing;
 select id into strict flow from pikas_private.account_activation_flows where source_kind='cafeteria_staff' and source_handle=i.id::text and email_key=i.email_key for update;
 owner:=pikas_private.activation_owner(flow);
 if (owner->>'ready')::boolean then raise exception 'activation_already_ready' using errcode='42501'; end if;
 perform pikas_private.require_staff_activation_admin(i.id);
 if i.expires_at<=clock_timestamp() then raise exception 'pending_intent_required' using errcode='42501'; end if;
 issued_at:=clock_timestamp();
 insert into pikas_private.account_activation_invitations(flow_id,created_by,created_at,expires_at)
 values(flow,actor,issued_at,least(i.expires_at,issued_at+interval '1 hour')) returning handle into invitation;
 insert into pikas_private.account_activation_events(invitation_handle,action,actor_auth_id) values(invitation,'prepared',auth.uid());
 return jsonb_build_object('status','prepared','handle',invitation,'email',i.email_key);
end $$;

create function public.cafeteria_bind_staff_activation(p_invitation_id uuid,p_handle text,p_digest text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; i public.invitations%rowtype;
 invitation pikas_private.account_activation_invitations%rowtype; f pikas_private.account_activation_flows%rowtype; owner jsonb;
begin

 select * into i from public.invitations where id=p_invitation_id;
 actor:=pikas_private.require_staff_activation_admin(i.id);
 select * into i from public.invitations where id=p_invitation_id for update;
 if not found or i.scope_kind<>'cafeteria' or i.role_code not in ('pos_cashier','pos_supervisor') or i.status<>'pending' or i.expires_at<=clock_timestamp() then
  raise exception 'pending_intent_required' using errcode='42501'; end if;
 actor:=pikas_private.require_staff_activation_admin(i.id);
 -- Check source association before locking another source's flow/invitation.
 if not exists(select 1 from pikas_private.account_activation_invitations ai join pikas_private.account_activation_flows af on af.id=ai.flow_id
  where ai.handle=p_handle and af.source_kind='cafeteria_staff' and af.source_handle=i.id::text and af.email_key=i.email_key) then
  raise exception 'invitation_unavailable' using errcode='42501'; end if;
 perform pikas_private.lock_activation(p_handle,null);
 select * into strict invitation from pikas_private.account_activation_invitations where handle=p_handle;
 select * into strict f from pikas_private.account_activation_flows where id=invitation.flow_id;
 if invitation.created_by<>actor then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid_digest' using errcode='22023'; end if;
 owner:=pikas_private.activation_owner(f.id);
 if owner->>'auth_id' is null or (owner->>'ready')::boolean then raise exception 'activation_identity_unavailable' using errcode='42501'; end if;
 perform pikas_private.require_staff_activation_admin(i.id);
 if invitation.expires_at<=clock_timestamp() or i.expires_at<=clock_timestamp() then raise exception 'invitation_unavailable' using errcode='42501'; end if;
 if invitation.token_digest is not null then
  if invitation.token_digest=p_digest then return; end if;
  raise exception 'invitation_unavailable' using errcode='42501';
 end if;
 update pikas_private.account_activation_invitations set revoked_at=clock_timestamp() where flow_id=f.id and handle<>p_handle and revoked_at is null;
 update pikas_private.account_activation_invitations set token_digest=p_digest where handle=p_handle;
 insert into pikas_private.account_activation_events(invitation_handle,action,actor_auth_id) values(p_handle,'bound',auth.uid());
end $$;

-- Preserve the existing command contract, journal, POS membership helper and all unrelated operations.
CREATE OR REPLACE FUNCTION public.cafeteria_admin_command(p_cafeteria_id uuid, p_request_id uuid, p_operation text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx jsonb; actor uuid; a uuid; s uuid; fp text; prior pikas_private.cafeteria_admin_requests%rowtype;
 allowed text[]; target uuid; category uuid; v integer; result jsonb; product uuid; link public.cafeteria_menu_products%rowtype;
 invite public.invitations%rowtype; member public.cafeteria_memberships%rowtype; auth_id uuid; person uuid; count_value integer;
 reg public.cafeteria_registers%rowtype; assignment public.cafeteria_register_assignments%rowtype;
begin
 perform pikas_private.begin_sandbox_admin_command('cafeteria_admin');
 ctx:=pikas_private.require_cafeteria_admin(p_cafeteria_id,true); actor:=(ctx->>'actor_id')::uuid; a:=(ctx->>'account_id')::uuid;
 select school_id into s from public.cafeterias where id=p_cafeteria_id;
 if p_request_id is null or p_operation is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception using errcode='22023',message='invalid_cafeteria_command'; end if;
 allowed:=case p_operation
 when 'product_save' then array['id','version','name','description','category','price_minor','active','available','ingredients','allergens']
 when 'category_save' then array['id','version','name','display_order','status']
 when 'menu_save' then array['id','version','name','description','active','product_ids']
 when 'shift_save' then array['id','version','menu_id','name','start_time','end_time','enabled','weekdays']
 when 'settings_save' then array['version','scheduling_enabled']
 when 'staff_prepare' then array['email','role']
 when 'staff_complete' then array['invitation_id','display_name']
 when 'staff_status' then array['membership_id','status']
 when 'register_save' then array['id','version','code','name','status']
 when 'assignment_save' then array['membership_id','register_id','status','version'] end;
 if allowed is null or not (p_payload ?& allowed) or exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(allowed) and not (p_operation='product_save' and k='unit')) then raise exception using errcode='22023',message='unsupported_command_fields'; end if;
 if p_operation='product_save' and p_payload ? 'unit' and (jsonb_typeof(p_payload->'unit') is distinct from 'string' or length(btrim(p_payload->>'unit')) not between 1 and 40) then raise exception using errcode='22023',message='invalid_product_unit'; end if;
 if not pikas_private.sandbox_admin_has_capability('cafeteria_admin',case when p_operation like 'staff_%' then 'cafeteria:pos:memberships:manage' when p_operation='assignment_save' then 'cafeteria:register_assignments:manage' when p_operation='register_save' then 'cafeteria:registers:manage' else 'cafeteria:catalog:manage' end,a,s,p_cafeteria_id) then raise exception using errcode='42501',message='cafeteria_authority_required'; end if;
 fp:=encode(extensions.digest(jsonb_build_object('cafeteria',p_cafeteria_id,'operation',p_operation,'payload',p_payload)::text,'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,20261013));
 select * into prior from pikas_private.cafeteria_admin_requests where request_id=p_request_id;
 if found then
  if prior.actor_person_id<>actor or prior.actor_auth_id<>auth.uid() or prior.cafeteria_id<>p_cafeteria_id or prior.fingerprint<>fp then raise exception using errcode='23505',message='request_key_reused'; end if;
  perform pikas_private.require_cafeteria_admin(p_cafeteria_id,true); perform set_config('pikas.admin_pov_session','',true); return prior.response;
 end if;
 -- Serialize whole menu edits and category name resolution across administrator commands.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cafeteria_id::text,20261013));
 if p_operation='product_save' and (coalesce(p_payload->>'price_minor','') !~ '^[0-9]+$' or (p_payload->>'price_minor')::numeric>9007199254740991) then raise exception using errcode='22023',message='invalid_minor_unit_price'; end if;
 target:=(p_payload->>'id')::uuid; v:=(p_payload->>'version')::integer;
 if p_operation='product_save' then
  select id into category from public.cafeteria_product_categories where cafeteria_id=p_cafeteria_id and name_key=lower(btrim(p_payload->>'category')) and status='active' for share;
  if category is null then
   category:=gen_random_uuid(); perform public.create_cafeteria_product_category(p_cafeteria_id,category,p_payload->>'category',0);
  end if;
  if v is null then perform public.create_cafeteria_product(p_cafeteria_id,target,p_payload->>'name',p_payload->>'description',category,(p_payload->>'price_minor')::bigint,(p_payload->>'active')::boolean,(p_payload->>'available')::boolean,array(select jsonb_array_elements_text(p_payload->'ingredients')),array(select jsonb_array_elements_text(p_payload->'allergens')));
  else perform public.update_cafeteria_product(p_cafeteria_id,target,v,p_payload->>'name',p_payload->>'description',category,(p_payload->>'price_minor')::bigint,(p_payload->>'active')::boolean,(p_payload->>'available')::boolean,array(select jsonb_array_elements_text(p_payload->'ingredients')),array(select jsonb_array_elements_text(p_payload->'allergens'))); end if;

  -- The nested product RPC owns version checks/increment and retains the row lock.
  -- Unit is part of the same transaction/fingerprint; legacy payloads leave it untouched.
  if p_payload ? 'unit' then update public.cafeteria_products set unit=btrim(p_payload->>'unit') where id=target and cafeteria_id=p_cafeteria_id; end if;
 elsif p_operation='category_save' then
  if v is null then perform public.create_cafeteria_product_category(p_cafeteria_id,target,p_payload->>'name',(p_payload->>'display_order')::integer); v:=1;
  else v:=public.update_cafeteria_product_category(p_cafeteria_id,target,v,p_payload->>'name',(p_payload->>'display_order')::integer); end if;
  if (select status from public.cafeteria_product_categories where id=target and cafeteria_id=p_cafeteria_id) is distinct from p_payload->>'status' then perform public.set_cafeteria_product_category_status(p_cafeteria_id,target,v,p_payload->>'status'); end if;
 elsif p_operation='menu_save' then
  if jsonb_typeof(p_payload->'product_ids') is distinct from 'array' then raise exception using errcode='22023',message='menu_products_required'; end if;
  -- The parent row lock also serializes legacy menu-product RPCs through their FK checks.
  if v is null then perform public.create_cafeteria_menu(p_cafeteria_id,target,p_payload->>'name',p_payload->>'description',0); v:=1; end if;
  perform public.update_cafeteria_menu(p_cafeteria_id,target,v,p_payload->>'name',p_payload->>'description',0,case when (p_payload->>'active')::boolean then 'active' else 'archived' end);
  for product in select distinct x::uuid from jsonb_array_elements_text(p_payload->'product_ids') x loop
   select * into link from public.cafeteria_menu_products where cafeteria_id=p_cafeteria_id and menu_id=target and product_id=product;
   if found then perform public.update_cafeteria_menu_product(p_cafeteria_id,target,product,link.version,link.display_order,true);
   else perform public.create_cafeteria_menu_product(p_cafeteria_id,target,product,0); end if;
  end loop;
  for link in select * from public.cafeteria_menu_products where cafeteria_id=p_cafeteria_id and menu_id=target and active and not (p_payload->'product_ids' ? product_id::text) loop
   perform public.update_cafeteria_menu_product(p_cafeteria_id,target,link.product_id,link.version,link.display_order,false);
  end loop;
 elsif p_operation='shift_save' then
  if v is null then perform public.create_cafeteria_service_shift(p_cafeteria_id,target,(p_payload->>'menu_id')::uuid,p_payload->>'name',(p_payload->>'start_time')::time,(p_payload->>'end_time')::time,(p_payload->>'enabled')::boolean,array(select x::integer from jsonb_array_elements_text(p_payload->'weekdays') x));
  else perform public.update_cafeteria_service_shift(p_cafeteria_id,target,v,(p_payload->>'menu_id')::uuid,p_payload->>'name',(p_payload->>'start_time')::time,(p_payload->>'end_time')::time,(p_payload->>'enabled')::boolean,array(select x::integer from jsonb_array_elements_text(p_payload->'weekdays') x)); end if;
 elsif p_operation='settings_save' then
  perform public.update_cafeteria_catalog_settings(p_cafeteria_id,(p_payload->>'scheduling_enabled')::boolean,v);
 elsif p_operation='register_save' then
  if v is null then
   if p_payload->>'status' is distinct from 'active' then raise exception using errcode='22023',message='new_register_must_be_active'; end if;
   perform public.create_cafeteria_register(p_cafeteria_id,target,p_payload->>'code',p_payload->>'name');
  else
   select * into reg from public.cafeteria_registers where id=target and cafeteria_id=p_cafeteria_id for update;
   if not found then raise exception using errcode='42501',message='register_outside_cafeteria'; end if;
   if exists(select 1 from public.register_sessions where register_id=target and status='open') then raise exception using errcode='23514',message='open_register_configuration_locked'; end if;
   perform public.update_cafeteria_register(p_cafeteria_id,target,v,p_payload->>'code',p_payload->>'name',p_payload->>'status');
  end if;
 elsif p_operation='staff_prepare' then
  if p_payload->>'role' is null or p_payload->>'role' not in ('pos_cashier','pos_supervisor') then raise exception using errcode='22023',message='pos_role_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cafeteria_id::text||lower(btrim(p_payload->>'email')),20261014));
  select id into target from public.invitations where cafeteria_id=p_cafeteria_id and scope_kind='cafeteria' and role_code=p_payload->>'role' and email_key=lower(btrim(p_payload->>'email')) and status='pending' and expires_at>clock_timestamp() order by id limit 1 for update;
  if target is null then insert into public.invitations(account_id,school_id,cafeteria_id,scope_kind,role_code,intended_email,token_hash,invited_by,expires_at)
   values(a,s,p_cafeteria_id,'cafeteria',p_payload->>'role',btrim(p_payload->>'email'),encode(extensions.digest(gen_random_uuid()::text||gen_random_uuid()::text,'sha256'),'hex'),actor,clock_timestamp()+interval '7 days') returning id into target; end if;
 elsif p_operation='staff_complete' then
  select * into invite from public.invitations where id=(p_payload->>'invitation_id')::uuid and account_id=a and school_id=s and cafeteria_id=p_cafeteria_id and scope_kind='cafeteria' and role_code in ('pos_cashier','pos_supervisor') for update;
  if not found or invite.status<>'pending' or invite.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_staff_invitation_required'; end if;
  perform pikas_private.require_staff_password_ready(invite.id);
  select count(*) into count_value from auth.users where lower(btrim(email))=invite.email_key;
  if count_value<>1 then raise exception using errcode='23514',message='confirmed_identity_pending'; end if;
  begin
   select u.id into strict auth_id from auth.users u where lower(btrim(u.email))=invite.email_key and u.confirmed_at is not null
   and (not(to_jsonb(u)?'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
   and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
   and to_jsonb(u)->>'deleted_at' is null and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false for share;
  exception when no_data_found or too_many_rows then raise exception using errcode='23514',message='confirmed_identity_pending'; end;
  -- Serialize Person creation across connected cafeterias; unique Auth linkage also fails closed against legacy onboarding races.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth_id::text,20261014));
  select id into person from public.persons where auth_user_id=auth_id for update;
  perform pikas_private.require_staff_password_ready(invite.id);
  if auth_id=auth.uid() or exists(select 1 from pikas_private.platform_memberships where person_id=person)
   or exists(select 1 from public.account_memberships where person_id=person and account_id<>a)
   or exists(select 1 from public.school_memberships where person_id=person and account_id<>a)
   or exists(select 1 from public.cafeteria_memberships where person_id=person and account_id<>a) then raise exception using errcode='42501',message='tenant_identity_required'; end if;
  if person is not null and not exists(select 1 from public.persons where id=person and status='active') then raise exception using errcode='23514',message='active_person_required'; end if;
  if nullif(btrim(p_payload->>'display_name'),'') is null or length(btrim(p_payload->>'display_name'))>200 then raise exception using errcode='22023',message='display_name_required'; end if;
  if invite.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_staff_invitation_required'; end if;
  if person is null then insert into public.persons(auth_user_id,display_name) values(auth_id,btrim(p_payload->>'display_name')) returning id into person; end if;
  select * into member from public.cafeteria_memberships where cafeteria_id=p_cafeteria_id and person_id=person and role_code=invite.role_code for update;
  if found and member.status<>'active' then raise exception using errcode='23505',message='existing_membership_not_active'; end if;
  select membership_id into target from public.set_cafeteria_pos_membership(p_cafeteria_id,person,invite.role_code,'active');
  update public.invitations set status='accepted',accepted_person_id=person,accepted_at=clock_timestamp() where id=invite.id;
 elsif p_operation in ('staff_status','assignment_save') then
  select * into member from public.cafeteria_memberships where id=(p_payload->>'membership_id')::uuid and cafeteria_id=p_cafeteria_id and role_code in ('pos_cashier','pos_supervisor');
  if not found then raise exception using errcode='42501',message='pos_membership_outside_cafeteria'; end if;
  -- Match the existing session/operator lock order before touching registers/assignments.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member.person_id::text,20261005));
  if p_payload->>'status'='active' then perform pikas_private.lock_cafeteria_pos_identity(member.person_id); end if;
  if p_operation='staff_status' then
   perform 1 from public.persons where id=member.person_id and status='active' for share;
   if not found then raise exception using errcode='23514',message='active_person_required'; end if;
   perform 1 from public.cafeteria_memberships where id=member.id for update;
   select membership_id into target from public.set_cafeteria_pos_membership(p_cafeteria_id,member.person_id,member.role_code,p_payload->>'status');
  else
   select * into reg from public.cafeteria_registers where id=(p_payload->>'register_id')::uuid and cafeteria_id=p_cafeteria_id for update;
   if not found then raise exception using errcode='42501',message='register_outside_cafeteria'; end if;
   perform 1 from public.cafeteria_memberships where id=member.id and status='active' for share;
   if (not found or reg.status<>'active') and p_payload->>'status'='active' then raise exception using errcode='23514',message='active_pos_membership_and_register_required'; end if;
   select * into assignment from public.cafeteria_register_assignments where cafeteria_id=p_cafeteria_id and cafeteria_membership_id=member.id and register_id=reg.id for update;
   if not found then
    if p_payload->>'status' is distinct from 'active' then raise exception using errcode='23503',message='assignment_required'; end if;
    select assignment_id into target from public.create_cafeteria_register_assignment(p_cafeteria_id,p_request_id,member.id,reg.id);
   else
    if v is null then raise exception using errcode='40001',message='assignment_version_required'; end if;
    perform public.update_cafeteria_register_assignment(p_cafeteria_id,assignment.id,v,p_payload->>'status'); target:=assignment.id;
   end if;
  end if;
 end if;
 perform pikas_private.require_cafeteria_admin(p_cafeteria_id,true);
 result:=jsonb_build_object('request_id',p_request_id,'operation',p_operation,'target_id',target);
 perform pikas_private.revalidate_sandbox_admin_command();
 insert into pikas_private.cafeteria_admin_requests(request_id,actor_person_id,actor_auth_id,cafeteria_id,fingerprint,response,sandbox_pov_session_id) values(p_request_id,actor,auth.uid(),p_cafeteria_id,fp,result,nullif(current_setting('pikas.admin_pov_session',true),'')::uuid);
 insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,school_id,cafeteria_id,action,target_type,target_id,request_id,outcome,after_metadata)
 values(actor,auth.uid(),'cafeteria_admin','cafeteria',a,s,p_cafeteria_id,'cafeteria_admin_'||p_operation,'cafeterias',p_cafeteria_id,p_request_id,'succeeded',jsonb_build_object('operation',p_operation)||case when p_operation='product_save' then jsonb_build_object('product_id',target,'unit',(select unit from public.cafeteria_products where id=target and cafeteria_id=p_cafeteria_id)) else '{}'::jsonb end);
 perform set_config('pikas.admin_pov_session','',true); return result;
end $function$;
revoke all on function pikas_private.require_staff_activation_admin(uuid),pikas_private.staff_activation_identity_state(uuid),pikas_private.require_staff_password_ready(uuid) from public,anon,authenticated,service_role;
revoke all on function public.cafeteria_staff_activation_status(uuid),public.cafeteria_prepare_staff_activation(uuid),public.cafeteria_bind_staff_activation(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.cafeteria_staff_activation_status(uuid),public.cafeteria_prepare_staff_activation(uuid),public.cafeteria_bind_staff_activation(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
