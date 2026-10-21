-- Platform customer provisioning: PIKAS operators provision customer staff access from Backoffice.
--
-- New narrow capability platform:customer:access:provision (platform_admin only). It adds a third
-- revalidated support mode, 'provision', to the existing Customer Operations context; in that mode
-- the routed tenant guards grant ONLY cafeteria:pos:memberships:manage, so the existing staff engine
-- (prepare with username, activation link, completion) runs unchanged for POS cashiers. Platform
-- never gains a tenant membership: the real operator is the actor and every audit row says so.
-- Also: grant cafeteria_admin to an existing customer Person; correct a customer Person's name;
-- keep the intended Person name of pending requests; and keep a one-colegio customer named after
-- its colegio even when only the profile is re-saved. No financial, student or parent surface.
begin;

insert into pikas_private.platform_capabilities(capability) values ('platform:customer:access:provision');
insert into pikas_private.platform_role_capabilities(role_code,capability) values ('platform_admin','platform:customer:access:provision');

alter table pikas_private.platform_audit_events drop constraint platform_audit_events_reason_code_check;
alter table pikas_private.platform_audit_events add constraint platform_audit_events_reason_code_check check (reason_code in (
 'owner_root_bootstrap','tenant_provisioned','school_location_added','customer_admin_intent_prepared','identity_linked',
 'customer_admin_granted','sandbox_pov_entered','sandbox_pov_exited','team_prepared','team_completed','team_demo_changed',
 'customer_suspended','customer_reactivated','customer_closed','customer_reopened','school_onboarded',
 'customer_profile_updated','customer_structure_renamed','cafeteria_admin_granted','customer_person_renamed'));

-- Intended Person name collected at preparation; used to pre-fill completion. Never a credential.
alter table pikas_private.platform_customer_admin_intents
 add column intended_display_name text check (length(btrim(intended_display_name)) between 1 and 200);
alter table public.invitations
 add column intended_display_name text check (length(btrim(intended_display_name)) between 1 and 200);

-- Existing support routing, now aware of the 'provision' mode (bodies otherwise unchanged).
create or replace function pikas_private.require_customer_operations_scope(
 p_account_id uuid,p_school_id uuid default null,p_cafeteria_id uuid default null,
 p_mode text default 'manage',p_lock boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; result jsonb; required text;
begin
 required:=case p_mode when 'read' then 'platform:customer:operations:read'
   when 'manage' then 'platform:customer:operations:manage'
   when 'provision' then 'platform:customer:access:provision' end;
 if required is null then raise exception using errcode='42501',message='customer_operations_authority_required'; end if;
 actor:=pikas_private.require_platform_capability(required);
 if pikas_private.sandbox_pov_current_attempt() then
  raise exception using errcode='42501',message='customer_operations_authority_required';
 end if;
 if p_lock then
  perform 1 from public.persons where id=actor for share;
  perform 1 from pikas_private.platform_memberships where person_id=actor and status='active' order by id for share;
  perform 1 from public.accounts where id=p_account_id for share;
  if p_school_id is not null then perform 1 from public.schools where id=p_school_id and account_id=p_account_id for share; end if;
  if p_cafeteria_id is not null then perform 1 from public.cafeterias where id=p_cafeteria_id and account_id=p_account_id for share; end if;
 end if;
 select jsonb_build_object('actor_id',actor,'membership_id',null,'role','platform_support','support',true,
  'account_id',a.id,'account_name',a.name,'account_status',a.status,'tenant_kind',a.tenant_kind,
  'school_id',s.id,'school_name',s.name,'cafeteria_id',c.id,'cafeteria_name',c.name,
  'cafeteria_status',c.status,'location_name',l.name,'capabilities','[]'::jsonb)
 into result
 from public.accounts a
 left join public.schools s on s.account_id=a.id and s.id=p_school_id
 left join public.cafeterias c on c.account_id=a.id and c.id=p_cafeteria_id
  and (p_school_id is null or c.school_id=p_school_id)
 left join public.school_locations l on l.id=c.school_location_id and l.account_id=a.id
 where a.id=p_account_id and a.tenant_kind='customer'
  and (p_mode='read' or a.status='active')
  and (p_school_id is null or s.id is not null)
  and (p_cafeteria_id is null or c.id is not null);
 if result is null then raise exception using errcode='42501',message='customer_operations_scope_required'; end if;
 return result;
end $$;

create or replace function pikas_private.has_capability(cap text,a uuid,s uuid default null,c uuid default null) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare support_account text:=nullif(current_setting('pikas.customer_operations_account',true),''); mode text;
begin
 if support_account is null then return pikas_private.has_capability_tenant(cap,a,s,c); end if;
 mode:=nullif(current_setting('pikas.customer_operations_mode',true),'');
 if support_account::uuid is distinct from a then return false; end if;
 perform pikas_private.require_customer_operations_scope(a,s,c,mode,false);
 -- provision: POS staff provisioning only (no catalog, register or money capability).
 if mode='provision' then return cap='cafeteria:pos:memberships:manage'; end if;
 return mode='manage' and cap=any(array['cafeteria:catalog:manage','cafeteria:catalog:read','cafeteria:registers:manage','cafeteria:register_assignments:manage']);
end $$;

create or replace function pikas_private.sandbox_admin_has_capability(p_code text,cap text,a uuid,s uuid default null,c uuid default null) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare support_account text:=nullif(current_setting('pikas.customer_operations_account',true),''); mode text;
begin
 if support_account is null then return pikas_private.sandbox_admin_has_capability_tenant(p_code,cap,a,s,c); end if;
 mode:=nullif(current_setting('pikas.customer_operations_mode',true),'');
 if support_account::uuid is distinct from a then return false; end if;
 perform pikas_private.require_customer_operations_scope(a,s,c,mode,false);
 if p_code='cafeteria_admin' then
  if mode='provision' then return cap='cafeteria:pos:memberships:manage'; end if;
  return mode='manage' and cap=any(array['cafeteria:catalog:manage','cafeteria:catalog:read','cafeteria:registers:manage','cafeteria:register_assignments:manage']);
 end if;
 return false;
end $$;

create or replace function pikas_private.stamp_customer_operations_audit() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare a text:=nullif(current_setting('pikas.customer_operations_account',true),''); ctx jsonb;
begin
 if a is null then return new; end if;
 ctx:=pikas_private.require_customer_operations_scope(a::uuid,new.school_id,new.cafeteria_id,
  coalesce(nullif(current_setting('pikas.customer_operations_mode',true),''),'manage'),false);
 new.actor_person_id:=(ctx->>'actor_id')::uuid;
 new.authenticated_user_id:=auth.uid();
 new.actor_scope_kind:='platform';
 new.actor_role:='platform_support';
 return new;
end $$;

create or replace function public.platform_update_colegio_profile(
 p_request_id uuid,p_account_id uuid,p_school_id uuid,p_expected jsonb,
 p_name text,p_tax_id text,p_address_line text,p_country_code text,p_subdivision_code text
) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; auth_actor uuid; name_value text; tax_value text; address_value text; province_value text; country_value text;
 payload jsonb; fingerprint text; replay jsonb; current public.schools%rowtype; school_count integer; renamed boolean; changed text[]; result jsonb;
begin
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
end $$;

-- Read models now carry the intended Person name of pending requests.
create or replace function public.platform_get_customer_overview(p_account_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 -- Reuse the existing hierarchy projection and capability gate.
 result:=public.platform_get_tenant_lifecycle(p_account_id);
 result:=jsonb_set(result,'{schools}',coalesce((
  select jsonb_agg(school||jsonb_build_object('rnc',s.tax_id,'address',s.address_line,'country',s.country_code,
    'province',s.subdivision_code,'province_name',d.name) order by ordinality)
  from jsonb_array_elements(result->'schools') with ordinality as e(school,ordinality)
  left join public.schools s on s.id=(school->>'id')::uuid and s.account_id=p_account_id
  left join pikas_private.country_subdivisions d on d.country_code=s.country_code and d.code=s.subdivision_code),'[]'::jsonb));
 return result||jsonb_build_object(
  'tenant_kind',(select tenant_kind from public.accounts where id=p_account_id),
  'administrators',coalesce((select jsonb_agg(jsonb_build_object('display_name',p.display_name,'status',m.status,'person_status',p.status) order by m.id) from public.account_memberships m join public.persons p on p.id=m.person_id where m.account_id=p_account_id and m.role_code='account_admin'),'[]'::jsonb),
  'administrator_intents',case when pikas_private.platform_has_capability('platform:customer_admin:provision') then
   coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.intended_email_key,
     'status',case when i.status in ('pending','linked') and i.expires_at<=statement_timestamp() then 'expired' else i.status end,
     'expires_at',i.expires_at,'role_code',i.role_code,'scope_kind',i.scope_kind,
     'display_name',p.display_name,'intended_display_name',i.intended_display_name) order by i.created_at desc,i.id)
    from pikas_private.platform_customer_admin_intents i left join public.persons p on p.id=i.linked_person_id
    where i.account_id=p_account_id),'[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function public.platform_customer_access_read(p_account_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 perform pikas_private.require_platform_capability('platform:customer:access:read');
 if pikas_private.sandbox_pov_current_attempt() then
  raise exception using errcode='42501',message='customer_access_authority_required';
 end if;
 if not exists(select 1 from public.accounts a where a.id=p_account_id and a.tenant_kind='customer') then
  raise exception using errcode='42501',message='customer_access_scope_required';
 end if;
 with grants as (
  select m.person_id,m.id membership_id,'account'::text scope,m.role_code,m.status,m.created_at,m.updated_at,
   null::uuid school_id,null::text school_name,null::uuid cafeteria_id,null::text cafeteria_name,null::text location_name
  from public.account_memberships m where m.account_id=p_account_id
  union all
  select m.person_id,m.id,'school',m.role_code,m.status,m.created_at,m.updated_at,s.id,s.name,null,null,null
  from public.school_memberships m join public.schools s on s.id=m.school_id and s.account_id=m.account_id where m.account_id=p_account_id
  union all
  select m.person_id,m.id,'cafeteria',m.role_code,m.status,m.created_at,m.updated_at,s.id,s.name,c.id,c.name,l.name
  from public.cafeteria_memberships m join public.cafeterias c on c.id=m.cafeteria_id and c.account_id=m.account_id
   join public.schools s on s.id=c.school_id join public.school_locations l on l.id=c.school_location_id
  where m.account_id=p_account_id
 ), people as (
  select p.id,p.display_name,p.status,p.created_at,p.auth_user_id is not null has_login,li.username,u.email,nullif(u.phone,'') phone,
   u.email_confirmed_at is not null email_confirmed,u.last_sign_in_at,coalesce(li.must_change_password,false) must_change_password,
   li.login_suspended_at is not null login_suspended,li.pending_email is not null email_change_pending,li.temporary_issued_at
  from public.persons p left join pikas_private.login_identities li on li.person_id=p.id left join auth.users u on u.id=p.auth_user_id
  where p.id in (select person_id from grants)
 )
 select jsonb_build_object('account_id',p_account_id,
  'people',coalesce((select jsonb_agg(jsonb_build_object(
    'person_id',pe.id,'display_name',pe.display_name,'person_status',pe.status,'created_at',pe.created_at,'has_login',pe.has_login,
    'username',pe.username,'email',pe.email,'phone',pe.phone,'email_confirmed',pe.email_confirmed,'last_sign_in_at',pe.last_sign_in_at,
    'must_change_password',pe.must_change_password,'login_suspended',pe.login_suspended,'email_change_pending',pe.email_change_pending,
    'temporary_issued_at',pe.temporary_issued_at,
    'grants',(select jsonb_agg(jsonb_build_object('membership_id',g.membership_id,'scope',g.scope,'role_code',g.role_code,'status',g.status,
       'created_at',g.created_at,'updated_at',g.updated_at,'school_id',g.school_id,'school_name',g.school_name,'cafeteria_id',g.cafeteria_id,
       'cafeteria_name',g.cafeteria_name,'location_name',g.location_name,
       'registers',case when g.scope='cafeteria' then coalesce((select jsonb_agg(jsonb_build_object('register_id',r.id,'name',r.display_name,'code',r.register_code,
          'register_status',r.status,'assignment_status',ra.status) order by r.display_name,r.id)
         from public.cafeteria_register_assignments ra join public.cafeteria_registers r on r.id=ra.register_id
         where ra.cafeteria_membership_id=g.membership_id and ra.account_id=p_account_id),'[]'::jsonb) else '[]'::jsonb end)
      order by case g.scope when 'account' then 0 when 'school' then 1 else 2 end,g.school_name,g.cafeteria_name,g.role_code)
     from grants g where g.person_id=pe.id))
   order by pe.display_name,pe.id) from people pe),'[]'::jsonb),
  'pending',coalesce((select jsonb_agg(x order by x->>'created_at') from (
    select jsonb_build_object('kind','initial_admin','request_id',i.id,'role_code',i.role_code,'scope',i.scope_kind,'status',i.status,
     'email',i.intended_email_key,'username',i.intended_username,'intended_display_name',i.intended_display_name,'cafeteria_id',i.cafeteria_id,'school_name',null,'cafeteria_name',null,'created_at',i.created_at,'expires_at',i.expires_at,
     'request_expired',i.expires_at<=clock_timestamp(),'identity_state',s.st->>'identity_state','link_state',s.st->>'link_state') x
    from pikas_private.platform_customer_admin_intents i cross join lateral (select pikas_private.customer_activation_state(i.id) as st) s
    where i.account_id=p_account_id and i.status in ('pending','linked')
    union all
    select jsonb_build_object('kind','invitation','request_id',v.id,'role_code',v.role_code,'scope',v.scope_kind,'status',v.status,
     'email',v.email_key,'username',v.intended_username,'intended_display_name',v.intended_display_name,'cafeteria_id',v.cafeteria_id,'school_name',s.name,'cafeteria_name',c.name,'created_at',v.created_at,'expires_at',v.expires_at,
     'request_expired',v.expires_at<=clock_timestamp(),'identity_state',s2.st->>'identity_state','link_state',s2.st->>'link_state')
    from public.invitations v left join public.schools s on s.id=v.school_id left join public.cafeterias c on c.id=v.cafeteria_id
     cross join lateral (select case
       when v.role_code in ('pos_cashier','pos_supervisor') then pikas_private.staff_activation_identity_state(v.id)
       when v.role_code='cafeteria_admin' then pikas_private.cafeteria_delegation_identity_state(v.id) end as st) s2
    where v.account_id=p_account_id and v.status='pending') q),'[]'::jsonb))
 into result;
 return result;
end $$;

-- Staff activation guard: same rename-and-wrap pattern as the other routed tenant guards. Without
-- the private support context the exact original runs. In 'provision' mode the invitation must be a
-- POS invitation of the context's customer and cafeteria, and the support scope is revalidated.
alter function pikas_private.require_staff_activation_admin(uuid) rename to require_staff_activation_admin_tenant;
create function pikas_private.require_staff_activation_admin(p_invitation_id uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare a text:=nullif(current_setting('pikas.customer_operations_account',true),'');
 c text:=nullif(current_setting('pikas.customer_operations_cafeteria',true),'');
begin
 if a is null then return pikas_private.require_staff_activation_admin_tenant(p_invitation_id); end if;
 if current_setting('pikas.customer_operations_mode',true) is distinct from 'provision' or c is null
   or not exists(select 1 from public.invitations i where i.id=p_invitation_id and i.scope_kind='cafeteria'
    and i.role_code in ('pos_cashier','pos_supervisor') and i.account_id=a::uuid and i.cafeteria_id=c::uuid) then
  raise exception 'real_cafeteria_admin_required' using errcode='42501';
 end if;
 return (pikas_private.require_customer_operations_scope(a::uuid,null,c::uuid,'provision',true)->>'actor_id')::uuid;
end $$;

-- B. Platform POS staff provisioning over the existing engine. Platform prepares Personal de caja
-- (pos_cashier) only; completion uses the existing staff_complete (one login → one Person).
create function public.platform_customer_staff_command(p_account_id uuid,p_cafeteria_id uuid,p_request_id uuid,p_operation text,
 p_payload jsonb,p_username text default null,p_display_name text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; name_value text:=nullif(btrim(p_display_name),''); target uuid;
begin
 if p_operation is null or p_operation not in ('staff_prepare','staff_complete') then
  raise exception using errcode='42501',message='customer_access_command_denied';
 end if;
 if p_operation='staff_prepare' and ((p_payload->>'role') is distinct from 'pos_cashier' or name_value is null or length(name_value)>200 or p_username is null) then
  raise exception using errcode='22023',message='invalid_customer_staff_input';
 end if;
 perform pikas_private.begin_customer_operations_scope(p_account_id,null,p_cafeteria_id,'provision');
 if p_operation='staff_prepare' then
  result:=public.provisioning_prepare_with_username('cafeteria_staff',p_request_id,null,p_cafeteria_id,p_payload,p_username);
  target:=(result->>'target_id')::uuid;
  update public.invitations set intended_display_name=name_value where id=target and account_id=p_account_id and intended_display_name is null;
  result:=result||jsonb_build_object('intended_display_name',(select intended_display_name from public.invitations where id=target));
 else
  result:=public.cafeteria_admin_command(p_cafeteria_id,p_request_id,'staff_complete',p_payload);
 end if;
 perform pikas_private.end_customer_operations_scope();
 return result;
end $$;
create function public.platform_staff_activation_prepare(p_account_id uuid,p_cafeteria_id uuid,p_invitation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 perform pikas_private.begin_customer_operations_scope(p_account_id,null,p_cafeteria_id,'provision');
 result:=public.cafeteria_prepare_staff_activation(p_invitation_id);
 perform pikas_private.end_customer_operations_scope(); return result;
end $$;
create function public.platform_staff_activation_bind(p_account_id uuid,p_cafeteria_id uuid,p_invitation_id uuid,p_handle text,p_digest text) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform pikas_private.begin_customer_operations_scope(p_account_id,null,p_cafeteria_id,'provision');
 perform public.cafeteria_bind_staff_activation(p_invitation_id,p_handle,p_digest);
 perform pikas_private.end_customer_operations_scope();
end $$;

-- Shared check: an existing Person of THIS customer only (no other customer, never PIKAS staff).
create function pikas_private.require_customer_person(p_account_id uuid,p_person_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform 1 from public.persons where id=p_person_id for update;
 if not found
  or not (exists(select 1 from public.account_memberships where person_id=p_person_id and account_id=p_account_id)
   or exists(select 1 from public.school_memberships where person_id=p_person_id and account_id=p_account_id)
   or exists(select 1 from public.cafeteria_memberships where person_id=p_person_id and account_id=p_account_id))
  or exists(select 1 from public.account_memberships where person_id=p_person_id and account_id<>p_account_id)
  or exists(select 1 from public.school_memberships where person_id=p_person_id and account_id<>p_account_id)
  or exists(select 1 from public.cafeteria_memberships where person_id=p_person_id and account_id<>p_account_id)
  or exists(select 1 from pikas_private.platform_memberships where person_id=p_person_id) then
  raise exception using errcode='42501',message='customer_person_required';
 end if;
end $$;

-- Shared Platform provisioning gate for one customer, locked for the edit.
create function pikas_private.require_customer_provisioning(p_account_id uuid,p_statuses text[]) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; account_status text;
begin
 actor:=pikas_private.require_platform_capability('platform:customer:access:provision');
 if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode='42501',message='customer_access_authority_required'; end if;
 select status into account_status from public.accounts where id=p_account_id and tenant_kind='customer' for update;
 if not found then raise exception using errcode='42501',message='customer_access_scope_required'; end if;
 if account_status<>all(p_statuses) then raise exception using errcode='23514',message='customer_provisioning_inactive'; end if;
 return actor;
end $$;

-- A. Grant Administrador de cafetería to an existing customer Person (same Person, same login).
create function public.platform_grant_cafeteria_admin(p_request_id uuid,p_account_id uuid,p_person_id uuid,p_cafeteria_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; auth_actor uuid; payload jsonb; fingerprint text; replay jsonb; c public.cafeterias%rowtype;
 member uuid; member_status text; already boolean; result jsonb;
begin
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
end $$;

-- F. Correct a customer Person's display name (data correction: same Person, login, username, memberships).
create function public.platform_rename_customer_person(p_request_id uuid,p_account_id uuid,p_person_id uuid,p_expected_name text,p_name text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; auth_actor uuid; name_value text:=nullif(btrim(p_name),''); payload jsonb; fingerprint text; replay jsonb; current text; result jsonb;
begin
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
end $$;

-- E. Initial administrator request with its intended Person name (kept for completion).
create function public.platform_prepare_customer_admin_named(p_request_id uuid,p_account_id uuid,p_scope_kind text,p_school_id uuid,p_cafeteria_id uuid,
 p_role_code text,p_intended_email text,p_expires_at timestamptz,p_username text,p_display_name text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare name_value text:=nullif(btrim(p_display_name),''); result jsonb; stored text;
begin
 if name_value is null or length(name_value)>200 then raise exception using errcode='22023',message='invalid_customer_admin_intent'; end if;
 result:=public.platform_prepare_customer_admin_with_username(p_request_id,p_account_id,p_scope_kind,p_school_id,p_cafeteria_id,p_role_code,p_intended_email,p_expires_at,p_username);
 update pikas_private.platform_customer_admin_intents set intended_display_name=name_value
  where id=(result->>'intent_id')::uuid and intended_display_name is null;
 select intended_display_name into stored from pikas_private.platform_customer_admin_intents where id=(result->>'intent_id')::uuid;
 if stored is distinct from name_value then raise exception using errcode='23505',message='platform_request_conflict'; end if;
 return result;
end $$;


revoke all on function pikas_private.require_staff_activation_admin(uuid),pikas_private.require_customer_person(uuid,uuid),
 pikas_private.require_customer_provisioning(uuid,text[]) from public,anon,authenticated,service_role;
revoke all on function public.platform_customer_staff_command(uuid,uuid,uuid,text,jsonb,text,text),
 public.platform_staff_activation_prepare(uuid,uuid,uuid),public.platform_staff_activation_bind(uuid,uuid,uuid,text,text),
 public.platform_grant_cafeteria_admin(uuid,uuid,uuid,uuid),public.platform_rename_customer_person(uuid,uuid,uuid,text,text),
 public.platform_prepare_customer_admin_named(uuid,uuid,text,uuid,uuid,text,text,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.platform_customer_staff_command(uuid,uuid,uuid,text,jsonb,text,text),
 public.platform_staff_activation_prepare(uuid,uuid,uuid),public.platform_staff_activation_bind(uuid,uuid,uuid,text,text),
 public.platform_grant_cafeteria_admin(uuid,uuid,uuid,uuid),public.platform_rename_customer_person(uuid,uuid,uuid,text,text),
 public.platform_prepare_customer_admin_named(uuid,uuid,text,uuid,uuid,text,text,timestamptz,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
