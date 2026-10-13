-- Step 4D.7C: one additive canonical product field; authority/checkout/history unchanged.
begin;
alter table public.cafeteria_products add column unit text not null default 'Unidad'
 check (length(btrim(unit)) between 1 and 40 and unit=btrim(unit));
comment on column public.cafeteria_products.unit is 'Display unit for the current product catalog; not inventory or a price multiplier.';

create or replace function public.cafeteria_admin_read(p_cafeteria_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;
begin
 ctx:=pikas_private.require_cafeteria_admin(p_cafeteria_id);
 return jsonb_build_object('scope',ctx,
 'settings',(select jsonb_build_object('currency',catalog_currency_code,'scheduling_enabled',scheduling_enabled,'version',version) from public.cafeteria_operation_settings where cafeteria_id=p_cafeteria_id),
 'categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'display_order',display_order,'version',version) order by display_order,name,id) from public.cafeteria_product_categories where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'unit',unit,'category_id',category_id,'price_minor',price_minor,'active',active,'available',available,'ingredients',ingredients,'allergens',allergens,'version',version) order by name,id) from public.cafeteria_products where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'menus',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'active',status='active','version',version,'product_ids',coalesce((select jsonb_agg(mp.product_id order by mp.display_order,mp.product_id) from public.cafeteria_menu_products mp where mp.menu_id=m.id and mp.active),'[]'::jsonb)) order by display_order,name,id) from public.cafeteria_menus m where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'shifts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'menu_id',menu_id,'name',name,'start_time',to_char(start_time,'HH24:MI'),'end_time',to_char(end_time,'HH24:MI'),'enabled',enabled,'version',version,'weekdays',coalesce((select jsonb_agg(weekday_iso order by weekday_iso) from public.cafeteria_service_shift_days where service_shift_id=sh.id),'[]'::jsonb)) order by start_time,id) from public.cafeteria_service_shifts sh where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'registers',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'code',r.register_code,'name',r.display_name,'status',r.status,'version',r.version,'has_history',exists(select 1 from public.register_sessions rs where rs.register_id=r.id),'open',exists(select 1 from public.register_sessions rs where rs.register_id=r.id and rs.status='open')) order by r.register_code,r.id) from public.cafeteria_registers r where r.cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'staff',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',p.display_name,'role',m.role_code,'status',m.status,'open',exists(select 1 from public.register_sessions rs where rs.cafeteria_id=p_cafeteria_id and rs.operator_person_id=p.id and rs.status='open')) order by p.display_name,m.id) from public.cafeteria_memberships m join public.persons p on p.id=m.person_id where m.cafeteria_id=p_cafeteria_id and m.role_code in ('pos_cashier','pos_supervisor')),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'membership_id',cafeteria_membership_id,'register_id',register_id,'status',status,'version',version) order by id) from public.cafeteria_register_assignments where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',intended_email,'role',role_code,'status',case when status='pending' and expires_at<=clock_timestamp() then 'expired' else status end,'expires_at',expires_at) order by created_at,id) from public.invitations where cafeteria_id=p_cafeteria_id and scope_kind='cafeteria' and role_code in ('pos_cashier','pos_supervisor')),'[]'::jsonb),
 'service',(select to_jsonb(svc) from pikas_private.resolve_cafeteria_service_at(p_cafeteria_id,clock_timestamp()) svc));
end $$;

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
commit;
