-- Backoffice customer profile management: Platform support corrects a colegio's identity data.
--
-- New narrow capability platform:customer:profile:manage (platform_admin). Two commands:
--  * platform_update_colegio_profile: nombre, RNC, dirección and provincia (País stays República
--    Dominicana). For a one-colegio customer the internal customer account is renamed with it.
--  * platform_rename_customer_structure: rename one sede or cafetería of the customer.
-- Customers only (never sandbox), active or suspended (closed is read-only), no current Demo POV.
-- Each request is key/payload-bound and replay-safe; an edit based on stale values is rejected.
-- Codes, lifecycle, memberships, identities, operations and money are never touched.
begin;

insert into pikas_private.platform_capabilities(capability) values ('platform:customer:profile:manage');
insert into pikas_private.platform_role_capabilities(role_code,capability) values ('platform_admin','platform:customer:profile:manage');

alter table pikas_private.platform_audit_events drop constraint platform_audit_events_reason_code_check;
alter table pikas_private.platform_audit_events add constraint platform_audit_events_reason_code_check check (reason_code in (
 'owner_root_bootstrap','tenant_provisioned','school_location_added','customer_admin_intent_prepared','identity_linked',
 'customer_admin_granted','sandbox_pov_entered','sandbox_pov_exited','team_prepared','team_completed','team_demo_changed',
 'customer_suspended','customer_reactivated','customer_closed','customer_reopened','school_onboarded',
 'customer_profile_updated','customer_structure_renamed'));

-- Shared scope: the real Platform actor with the profile capability, outside a current Demo POV,
-- acting on one active or suspended customer, locked for the duration of the edit.
create function pikas_private.require_customer_profile_scope(p_account_id uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; account_status text;
begin
 actor:=pikas_private.require_platform_capability('platform:customer:profile:manage');
 if pikas_private.sandbox_pov_current_attempt() then
  raise exception using errcode='42501',message='customer_profile_authority_required';
 end if;
 select a.status into account_status from public.accounts a where a.id=p_account_id and a.tenant_kind='customer' for update;
 if not found then raise exception using errcode='42501',message='customer_profile_scope_required'; end if;
 if account_status not in ('active','suspended') then raise exception using errcode='23514',message='customer_profile_closed'; end if;
 return actor;
end $$;

create function public.platform_update_colegio_profile(
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
 renamed:=school_count=1 and 'name'=any(changed);
 if renamed then update public.accounts set name=name_value where id=p_account_id; end if;

 result:=jsonb_build_object('account_id',p_account_id,'school_id',p_school_id,'account_renamed',renamed,'changed',to_jsonb(changed));
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
 values(p_request_id,'customer_profile_update',fingerprint,auth_actor,actor,result);
 perform pikas_private.record_platform_audit(p_request_id,actor,auth_actor,'platform:customer:profile:manage','customer_profile_updated',
  'customer_profile_updated',p_account_id,p_school_id,null,null,null,null,jsonb_build_object('changed',to_jsonb(changed),'account_renamed',renamed));
 return result;
end $$;

create function public.platform_rename_customer_structure(
 p_request_id uuid,p_account_id uuid,p_kind text,p_target_id uuid,p_expected_name text,p_name text
) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; auth_actor uuid; name_value text; payload jsonb; fingerprint text; replay jsonb;
 current_name text; school uuid; location uuid; cafeteria uuid; result jsonb;
begin
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
end $$;

revoke all on function pikas_private.require_customer_profile_scope(uuid) from public,anon,authenticated,service_role;
revoke all on function public.platform_update_colegio_profile(uuid,uuid,uuid,jsonb,text,text,text,text,text),
 public.platform_rename_customer_structure(uuid,uuid,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.platform_update_colegio_profile(uuid,uuid,uuid,jsonb,text,text,text,text,text),
 public.platform_rename_customer_structure(uuid,uuid,text,uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
