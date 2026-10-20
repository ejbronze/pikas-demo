-- Backoffice "Agregar colegio": one onboarding command, server-generated codes, DR-only profile.
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
create function pg_temp.q(sql text) returns text language plpgsql security definer set search_path=public as $$declare r text; begin execute sql into r; return r; end$$;

reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-00000000e0a0','00000000-0000-0000-0000-000000000000','authenticated','authenticated','onboarding.admin@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-00000000e0b0','00000000-0000-0000-0000-00000000e0a0','Operador onboarding ficticio');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-00000000e0b0','platform_admin');
-- A fictional support manager without tenant provisioning proves operations:manage is no bypass.
set local session_replication_role=replica;
insert into pikas_private.platform_roles(role_code) values('test_onboarding_support');
insert into pikas_private.platform_role_capabilities(role_code,capability) values
 ('test_onboarding_support','platform:customer:operations:read'),('test_onboarding_support','platform:customer:operations:manage'),
 ('test_onboarding_support','platform:customer_admin:provision');
set local session_replication_role=origin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-00000000e0a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','onboarding.support@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-00000000e0b1','00000000-0000-0000-0000-00000000e0a1','Soporte sin aprovisionamiento');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-00000000e0b1','test_onboarding_support');

select ok(not has_function_privilege('anon','platform_onboard_school(uuid,text,text,text,text,text)','execute'),'Anonymous cannot onboard');
select ok(not has_table_privilege('authenticated','pikas_private.country_subdivisions','select'),'Subdivision reference is not client-readable');
select is((select count(*)::int from pikas_private.country_subdivisions where country_code='DO'),32,'Canonical República Dominicana provinces seeded');

select pg_temp.as_user('00000000-0000-0000-0000-00000000e0a1');
select is(pg_temp.attempt($$select platform_onboard_school('00000000-0000-4000-8000-00000000e101','Colegio Ficticio','101234567','Calle 1','DO','DO-01')$$),'42501:not_authorized','operations:manage cannot onboard a colegio');

select pg_temp.as_user('00000000-0000-0000-0000-00000000e0a0');
select is(pg_temp.attempt($$select platform_onboard_school(gen_random_uuid(),'Colegio Ficticio','101234567','Calle 1','US','US-NY')$$),'22023:unsupported_school_region','Other countries rejected in this rollout');
select is(pg_temp.attempt($$select platform_onboard_school(gen_random_uuid(),'Colegio Ficticio','101234567','Calle 1','DO','Santiago')$$),'22023:unsupported_school_region','Free-text province rejected');
select is(pg_temp.attempt($$select platform_onboard_school(gen_random_uuid(),'Colegio Ficticio','101234567','Calle 1','DO','DO-40')$$),'22023:unsupported_school_region','Non-canonical province code rejected');
select is(pg_temp.attempt($$select platform_onboard_school(gen_random_uuid(),'Colegio Ficticio','12-34','Calle 1','DO','DO-01')$$),'22023:invalid_school_onboarding_input','Invalid RNC rejected');
select is(pg_temp.attempt($$select platform_onboard_school(gen_random_uuid(),' ','101234567','Calle 1','DO','DO-01')$$),'22023:invalid_school_onboarding_input','Name required');
select is(pg_temp.attempt($$select platform_onboard_school(gen_random_uuid(),'Colegio Ficticio','101234567',' ','DO','DO-01')$$),'22023:invalid_school_onboarding_input','Address required');

select set_config('t.r',platform_onboard_school('00000000-0000-4000-8000-00000000e102','Colegio Ficticio Atlántico','1-01-23456-7','Calle Ficticia 1, Ensanche Prueba','DO','DO-25')::text,true);
select matches(current_setting('t.r')::jsonb->>'school_code','^COL-[0-9A-F]{10}$','School code generated by PIKAS');
select is(pg_temp.q(format($s$select concat_ws('|',s.name,s.code,s.tax_id,s.address_line,s.country_code,s.subdivision_code,s.business_timezone,a.name,a.tenant_kind,a.status)
 from schools s join accounts a on a.id=s.account_id where s.id=%L$s$,current_setting('t.r')::jsonb->>'school_id')),
 concat_ws('|','Colegio Ficticio Atlántico',current_setting('t.r')::jsonb->>'school_code','101234567','Calle Ficticia 1, Ensanche Prueba','DO','DO-25','America/Santo_Domingo','Colegio Ficticio Atlántico','customer','active'),
 'Colegio, normalized RNC, address, country, province and customer account recorded together');
select is(pg_temp.q(format($s$select concat_ws('|',(select count(*) from schools where account_id=%1$L),(select count(*) from school_locations where account_id=%1$L),(select count(*) from cafeterias where account_id=%1$L))$s$,
 current_setting('t.r')::jsonb->>'account_id')),'1|1|1','One customer → one colegio with its first sede and cafetería');
select is(platform_onboard_school('00000000-0000-4000-8000-00000000e102','Colegio Ficticio Atlántico','101234567','Calle Ficticia 1, Ensanche Prueba','DO','DO-25'),
 current_setting('t.r')::jsonb,'Exact retry replays the original result');
select is(pg_temp.q($s$select count(*)::text from accounts where name='Colegio Ficticio Atlántico'$s$),'1','Retry creates no second customer');
select is(pg_temp.attempt($$select platform_onboard_school('00000000-0000-4000-8000-00000000e102','Otro Colegio','101234567','Calle Ficticia 1, Ensanche Prueba','DO','DO-25')$$),'23505:platform_request_conflict','Same key with a different payload is a conflict');
select isnt(platform_onboard_school('00000000-0000-4000-8000-00000000e103','Colegio Ficticio Atlántico','101234567','Otra calle','DO','DO-01')->>'school_code',
 current_setting('t.r')::jsonb->>'school_code','A distinct onboarding gets a distinct generated code');
select is(pg_temp.q($s$select string_agg(reason_code||':'||actor_person_id,',' order by reason_code) from pikas_private.platform_audit_events
 where request_id='00000000-0000-4000-8000-00000000e102' or target_account_id=(current_setting('t.r')::jsonb->>'account_id')::uuid$s$),
 'school_onboarded:00000000-0000-0000-0000-00000000e0b0,tenant_provisioned:00000000-0000-0000-0000-00000000e0b0','Platform audit names the real operator for onboarding and provisioning');

-- The colegio's initial administrator uses the existing Phase 6A intent; nothing is granted yet.
select is(platform_prepare_customer_admin_with_username(gen_random_uuid(),(current_setting('t.r')::jsonb->>'account_id')::uuid,'account',null,null,'account_admin',
 'director.atlantico@example.invalid',now()+interval '7 days','director.atlantico')->>'status','pending','Initial colegio administrator prepared through the existing intent');
select is(pg_temp.q(format($s$select count(*)::text from account_memberships where account_id=%L$s$,current_setting('t.r')::jsonb->>'account_id')),'0','Preparation grants no membership');
select is(pg_temp.q($s$select concat_ws('|',(select count(*) from account_memberships m join persons p on p.id=m.person_id where p.auth_user_id='00000000-0000-0000-0000-00000000e0a0'),(select count(*) from school_memberships m join persons p on p.id=m.person_id where p.auth_user_id='00000000-0000-0000-0000-00000000e0a0'))$s$),'0|0','Operator gains no tenant membership');

select * from finish();
rollback;
