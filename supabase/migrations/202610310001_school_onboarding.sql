-- Backoffice "Agregar colegio": one Platform onboarding command for the colegio the operator
-- understands. It reuses the existing tenant provisioning journal (account + school + first
-- location + cafeteria in one transaction), adds the colegio's legal/address profile and lets
-- PIKAS generate every code. The initial administrator keeps the existing Phase 6A intent flow.
begin;

-- Canonical subdivisions (ISO 3166-2). The rollout seeds República Dominicana only; the model
-- itself stays country-agnostic.
create table pikas_private.country_subdivisions (
 country_code text not null check (country_code ~ '^[A-Z]{2}$'),
 code text not null check (code ~ '^[A-Z]{2}-[0-9A-Z]{1,3}$' and left(code,2)=country_code),
 name text not null check (length(btrim(name)) between 1 and 120),
 primary key (country_code,code)
);
insert into pikas_private.country_subdivisions(country_code,code,name) values
 ('DO','DO-01','Distrito Nacional'),('DO','DO-02','Azua'),('DO','DO-03','Baoruco'),('DO','DO-04','Barahona'),
 ('DO','DO-05','Dajabón'),('DO','DO-06','Duarte'),('DO','DO-07','Elías Piña'),('DO','DO-08','El Seibo'),
 ('DO','DO-09','Espaillat'),('DO','DO-10','Independencia'),('DO','DO-11','La Altagracia'),('DO','DO-12','La Romana'),
 ('DO','DO-13','La Vega'),('DO','DO-14','María Trinidad Sánchez'),('DO','DO-15','Monte Cristi'),('DO','DO-16','Pedernales'),
 ('DO','DO-17','Peravia'),('DO','DO-18','Puerto Plata'),('DO','DO-19','Hermanas Mirabal'),('DO','DO-20','Samaná'),
 ('DO','DO-21','San Cristóbal'),('DO','DO-22','San Juan'),('DO','DO-23','San Pedro de Macorís'),('DO','DO-24','Sánchez Ramírez'),
 ('DO','DO-25','Santiago'),('DO','DO-26','Santiago Rodríguez'),('DO','DO-27','Valverde'),('DO','DO-28','Monseñor Nouel'),
 ('DO','DO-29','Monte Plata'),('DO','DO-30','Hato Mayor'),('DO','DO-31','San José de Ocoa'),('DO','DO-32','Santo Domingo');
revoke all on table pikas_private.country_subdivisions from public,anon,authenticated;

-- The colegio is the customer-facing entity, so its RNC and address live on the school. Nullable:
-- schools provisioned before this milestone have no profile.
alter table public.schools
 add column tax_id text check (tax_id ~ '^([0-9]{9}|[0-9]{11})$'),
 add column address_line text check (length(btrim(address_line)) between 1 and 300),
 add column country_code text,
 add column subdivision_code text,
 add constraint schools_region_complete check ((country_code is null)=(subdivision_code is null)),
 add constraint schools_subdivision_fkey foreign key (country_code,subdivision_code)
  references pikas_private.country_subdivisions(country_code,code) on delete restrict;

alter table pikas_private.platform_audit_events drop constraint platform_audit_events_reason_code_check;
alter table pikas_private.platform_audit_events add constraint platform_audit_events_reason_code_check check (reason_code in (
 'owner_root_bootstrap','tenant_provisioned','school_location_added','customer_admin_intent_prepared','identity_linked',
 'customer_admin_granted','sandbox_pov_entered','sandbox_pov_exited','team_prepared','team_completed','team_demo_changed',
 'customer_suspended','customer_reactivated','customer_closed','customer_reopened','school_onboarded'));

create function public.platform_onboard_school(
 p_request_id uuid,p_school_name text,p_tax_id text,p_address_line text,p_country_code text,p_subdivision_code text
) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; auth_actor uuid; name_value text; tax_value text; address_value text;
 payload jsonb; fingerprint text; replay jsonb; suffix text; school_code_value text; tenant jsonb; result jsonb;
begin
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
  'SEDE-PRINCIPAL','Sede principal','CAF-PRINCIPAL','Cafetería principal');
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
end $$;

revoke all on function public.platform_onboard_school(uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.platform_onboard_school(uuid,text,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
