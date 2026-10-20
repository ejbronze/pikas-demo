-- Backoffice "Información del colegio": the existing customer overview returns the colegio profile.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$declare sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;

reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-00000000f1a0','00000000-0000-0000-0000-000000000000','authenticated','authenticated','perfil.admin@example.invalid','',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-00000000f1a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','perfil.soporte@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-00000000f1b0','00000000-0000-0000-0000-00000000f1a0','Operador perfil ficticio'),
 ('00000000-0000-0000-0000-00000000f1b1','00000000-0000-0000-0000-00000000f1a1','Soporte sin consulta de clientes');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-00000000f1b0','platform_admin');
-- A fictional Platform role without platform:tenant:lifecycle:read.
set local session_replication_role=replica;
insert into pikas_private.platform_roles(role_code) values('test_profile_ops_only');
insert into pikas_private.platform_role_capabilities(role_code,capability) values('test_profile_ops_only','platform:customer:operations:read'),('test_profile_ops_only','platform:customer:operations:manage');
set local session_replication_role=origin;
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-00000000f1b1','test_profile_ops_only');

create function pg_temp.owned_by(a uuid,ids jsonb) returns boolean language sql security definer set search_path=public as $$
 select bool_and((x->>'id')::uuid in (select id from schools where account_id=a)) from jsonb_array_elements(ids) x $$;
select set_config('t.tenant_admin',(select p.auth_user_id::text from persons p join account_memberships m on m.person_id=p.id
 where m.account_id='00000000-0000-0000-0000-000000000001' and m.status='active' and p.auth_user_id is not null limit 1),true);
select ok(not has_function_privilege('anon','platform_get_customer_overview(uuid)','execute'),'Anonymous cannot read the customer overview');

select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a0');
select set_config('t.r',platform_onboard_school('00000000-0000-4000-8000-00000000f101','Colegio Perfil Ficticio','1-31-98765-4','Av. Ficticia 12','DO','DO-25')::text,true);
select set_config('t.o',platform_get_customer_overview((current_setting('t.r')::jsonb->>'account_id')::uuid)::text,true);
select is(jsonb_array_length(current_setting('t.o')::jsonb->'schools'),1,'Onboarded customer overview has its one colegio');
select is((current_setting('t.o')::jsonb->'schools'->0)-'locations'-'business_timezone'-'status'-'id',
 jsonb_build_object('name','Colegio Perfil Ficticio','code',current_setting('t.r')::jsonb->>'school_code','rnc','131987654','address','Av. Ficticia 12',
  'country','DO','province','DO-25','province_name','Santiago'),'Authorized reader receives name, generated code, RNC, address, country, province and canonical province name');
select is(jsonb_array_length(current_setting('t.o')::jsonb->'schools'->0->'locations'),1,'Existing hierarchy projection is preserved');
select ok(current_setting('t.o')::jsonb ? 'administrators' and current_setting('t.o')::jsonb ? 'administrator_intents' and current_setting('t.o')::jsonb->>'tenant_kind'='customer','Existing overview fields are preserved');

-- Older colegios predate the profile: nulls, never fabricated, and the read still works.
select set_config('t.old',platform_get_customer_overview('00000000-0000-0000-0000-000000000001')::text,true);
select ok(jsonb_array_length(current_setting('t.old')::jsonb->'schools')>=1,'Older customer overview still reads');
select ok((select bool_and(s->'rnc'='null'::jsonb and s->'address'='null'::jsonb and s->'country'='null'::jsonb and s->'province'='null'::jsonb and s->'province_name'='null'::jsonb and s->>'code' is not null)
 from jsonb_array_elements(current_setting('t.old')::jsonb->'schools') s),'Older colegios return null profile values with their existing code');

-- Cross-customer: one customer's overview never carries another customer's profile.
select ok(position('131987654' in current_setting('t.old'))=0 and position('Av. Ficticia 12' in current_setting('t.old'))=0,'Another customer overview excludes this colegio profile');
select ok(pg_temp.owned_by('00000000-0000-0000-0000-000000000001',current_setting('t.old')::jsonb->'schools'),'Every returned colegio belongs to the requested customer');

-- Unauthorized callers: Platform without lifecycle read, and a tenant administrator.
select pg_temp.as_user('00000000-0000-0000-0000-00000000f1a1');
select is(pg_temp.attempt(format('select platform_get_customer_overview(%L)',current_setting('t.r')::jsonb->>'account_id')),'42501:not_authorized','Platform role without lifecycle read cannot obtain the profile');
select pg_temp.as_user(current_setting('t.tenant_admin'));
select is(pg_temp.attempt(format('select platform_get_customer_overview(%L)',current_setting('t.r')::jsonb->>'account_id')),'42501:not_authorized','Tenant administrator cannot obtain another colegio profile');

select * from finish();
rollback;
