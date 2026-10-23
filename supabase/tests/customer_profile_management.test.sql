-- Backoffice customer profile management: colegio profile edits and sede/cafetería renames.
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
create function pg_temp.memberships(p uuid) returns text language sql security definer set search_path=public as $$
 select concat_ws('|',(select count(*) from account_memberships where person_id=p),(select count(*) from school_memberships where person_id=p),(select count(*) from cafeteria_memberships where person_id=p)) $$;
-- Expected values exactly as the overview shows them.
create function pg_temp.expected(s uuid) returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('name',name,'rnc',tax_id,'address',address_line,'province',subdivision_code) from schools where id=s $$;

reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-00000000e2a0','00000000-0000-0000-0000-000000000000','authenticated','authenticated','perfil.gestion@example.invalid','',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-00000000e2a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','perfil.soporte@example.invalid','',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-00000000e2a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','perfil.demo@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-00000000e2b0','00000000-0000-0000-0000-00000000e2a0','Operador perfil ficticio'),
 ('00000000-0000-0000-0000-00000000e2b1','00000000-0000-0000-0000-00000000e2a1','Soporte sin perfil'),
 ('00000000-0000-0000-0000-00000000e2b2','00000000-0000-0000-0000-00000000e2a2','Operador en Demo');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-00000000e2b0','platform_admin'),('00000000-0000-0000-0000-00000000e2b2','platform_admin');
set local session_replication_role=replica;
insert into pikas_private.platform_roles(role_code) values('test_profile_ops_only');
insert into pikas_private.platform_role_capabilities(role_code,capability) values('test_profile_ops_only','platform:customer:operations:manage'),('test_profile_ops_only','platform:tenant:provision');
set local session_replication_role=origin;
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-00000000e2b1','test_profile_ops_only');
-- Current Demo POV for one operator.
insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,status,started_at,expires_at)
 select gen_random_uuid(),'00000000-0000-0000-0000-00000000e2b2','00000000-0000-0000-0000-00000000e2a2',p.account_id,p.school_id,p.cafeteria_id,'cashier',p.id,p.person_id,p.cafeteria_membership_id,'active',now()-interval '5 minutes',now()+interval '1 hour'
 from pikas_private.sandbox_pov_personas p where p.pov_code='cashier' order by p.id limit 1;
select set_config('t.tenant',(select auth_user_id::text from persons where id=(select person_id from account_memberships where account_id='00000000-0000-0000-0000-000000000001' and status='active' limit 1)),true);
select set_config('t.before',pg_temp.memberships('00000000-0000-0000-0000-00000000e2b0'),true);
select set_config('t.money',pg_temp.q($s$select concat_ws('|',(select count(*) from purchases),(select count(*) from wallet_ledger_entries),(select count(*) from cafeteria_products),(select count(*) from cafeteria_registers))$s$),true);

select ok(exists(select 1 from pikas_private.platform_role_capabilities where role_code='platform_admin' and capability='platform:customer:profile:manage'),'Profile capability granted to platform_admin');
select ok(not has_function_privilege('anon','platform_update_colegio_profile(uuid,uuid,uuid,jsonb,text,text,text,text,text)','execute')
 and not has_function_privilege('anon','platform_rename_customer_structure(uuid,uuid,text,uuid,text,text)','execute'),'Anonymous cannot edit profiles');
select ok(not has_function_privilege('authenticated','pikas_private.require_customer_profile_scope(uuid)','execute'),'Profile scope guard is not client-callable');

-- One-colegio customer: colegio and customer account renamed together; profile completed from nulls.
select pg_temp.as_user('00000000-0000-0000-0000-00000000e2a0');
select set_config('t.e2',pg_temp.expected('00000000-0000-0000-0000-000000000021')::text,true);
select set_config('t.r',platform_update_colegio_profile('00000000-0000-4000-8000-00000000e301','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021',
 current_setting('t.e2')::jsonb,'Colegio Ficticio Renombrado','1-01-23456-7','Calle Ficticia 9','DO','DO-01')::text,true);
select is(current_setting('t.r')::jsonb->'account_renamed','true'::jsonb,'One-colegio customer account renamed with its colegio');
select is(pg_temp.q($s$select concat_ws('|',s.name,s.tax_id,s.address_line,s.country_code,s.subdivision_code,a.name,s.code,a.code,a.status) from schools s join accounts a on a.id=s.account_id where s.id='00000000-0000-0000-0000-000000000021'$s$),
 pg_temp.q($s$select concat_ws('|','Colegio Ficticio Renombrado','101234567','Calle Ficticia 9','DO','DO-01','Colegio Ficticio Renombrado',s.code,a.code,'active') from schools s join accounts a on a.id=s.account_id where s.id='00000000-0000-0000-0000-000000000021'$s$),
 'Profile saved (RNC normalized); codes and lifecycle untouched');
select is(platform_update_colegio_profile('00000000-0000-4000-8000-00000000e301','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021',
 current_setting('t.e2')::jsonb,'Colegio Ficticio Renombrado','1-01-23456-7','Calle Ficticia 9','DO','DO-01'),current_setting('t.r')::jsonb,'Exact retry replays the original result');
select is(pg_temp.attempt($$select platform_update_colegio_profile('00000000-0000-4000-8000-00000000e301','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021','{}','Otro','','','','')$$),'23505:platform_request_conflict','Same key with a different payload is a conflict');
select is(pg_temp.attempt(format($$select platform_update_colegio_profile(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021',%L::jsonb,'Tarde','','','','')$$,current_setting('t.e2'))),
 '23514:customer_profile_changed','An edit based on stale values is rejected');
-- Clearing optional fields is allowed (never fabricated); country follows the province.
select is(platform_update_colegio_profile(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021',
 pg_temp.expected('00000000-0000-0000-0000-000000000021'),'Colegio Ficticio Renombrado','','','DO','')->'changed','["rnc", "address", "province"]'::jsonb,'Optional profile fields can be cleared');
select is(pg_temp.q($s$select concat_ws('|',coalesce(tax_id,'∅'),coalesce(address_line,'∅'),coalesce(country_code,'∅'),coalesce(subdivision_code,'∅')) from schools where id='00000000-0000-0000-0000-000000000021'$s$),'∅|∅|∅|∅','Cleared values stored as null, never invented');

-- Multi-colegio customer: only the colegio is renamed.
select set_config('t.acct1',pg_temp.q($s$select name from accounts where id='00000000-0000-0000-0000-000000000001'$s$),true);
select is(platform_update_colegio_profile(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 pg_temp.expected('00000000-0000-0000-0000-000000000011'),'Colegio Ficticio A1','131987654','Av. Ficticia 1','DO','DO-25')->'account_renamed','false'::jsonb,'Multi-colegio customer: account name unchanged');
select is(pg_temp.q($s$select name from accounts where id='00000000-0000-0000-0000-000000000001'$s$),current_setting('t.acct1'),'Customer account keeps its name');

-- Sede and cafetería renames.
select is(platform_rename_customer_structure(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','location','00000000-0000-0000-0000-000000000211','Synthetic campus A1-C1','Sede Norte Ficticia')->>'name','Sede Norte Ficticia','Sede renamed');
select is(platform_rename_customer_structure(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000111',
 pg_temp.q($s$select name from cafeterias where id='00000000-0000-0000-0000-000000000111'$s$),'Cafetería Norte Ficticia')->>'name','Cafetería Norte Ficticia','Cafetería renamed');
select is(pg_temp.attempt($$select platform_rename_customer_structure(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','location','00000000-0000-0000-0000-000000000211','Synthetic campus A1-C1','Otra')$$),'23514:customer_profile_changed','Stale rename rejected');
select is(pg_temp.attempt($$select platform_rename_customer_structure(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000121','Synthetic cafeteria B1-C1','Robada')$$),'42501:customer_profile_scope_required','Cross-customer cafetería rename denied');
select is(pg_temp.attempt($$select platform_rename_customer_structure(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','school','00000000-0000-0000-0000-000000000011','x','y')$$),'22023:invalid_customer_structure_input','Only sede and cafetería can be renamed here');
select is(pg_temp.attempt($$select platform_update_colegio_profile(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000021','{}','X','','','','')$$),'42501:customer_profile_scope_required','Colegio of another customer denied');
select is(pg_temp.attempt($$select platform_update_colegio_profile(gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','{}','X','','','','')$$),'42501:customer_profile_scope_required','Sandbox tenant is not editable here');

-- Validation.
select is(pg_temp.attempt($$select platform_update_colegio_profile(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021','{}',' ','','','','')$$),'22023:invalid_customer_profile_input','Name required');
select is(pg_temp.attempt($$select platform_update_colegio_profile(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021','{}','X','12','','','')$$),'22023:invalid_customer_profile_input','Invalid RNC rejected');
select is(pg_temp.attempt($$select platform_update_colegio_profile(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021','{}','X','','','US','US-NY')$$),'22023:unsupported_school_region','Other countries rejected');
select is(pg_temp.attempt($$select platform_update_colegio_profile(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021','{}','X','','','DO','Santiago')$$),'22023:unsupported_school_region','Free-text province rejected');

-- Lifecycle: suspended editable, closed read-only.
reset role; update accounts set status='suspended' where id='00000000-0000-0000-0000-000000000002';
select pg_temp.as_user('00000000-0000-0000-0000-00000000e2a0');
select is(platform_rename_customer_structure(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','cafeteria','00000000-0000-0000-0000-000000000121','Synthetic cafeteria B1-C1','Cafetería B Ficticia')->>'name','Cafetería B Ficticia','Suspended customer can be corrected');
reset role; update accounts set status='closed' where id='00000000-0000-0000-0000-000000000002';
select pg_temp.as_user('00000000-0000-0000-0000-00000000e2a0');
select is(pg_temp.attempt(format($$select platform_update_colegio_profile(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021',%L::jsonb,'Cerrado','','','','')$$,pg_temp.expected('00000000-0000-0000-0000-000000000021'))),'23514:customer_profile_closed','Closed customer is read-only');
reset role; update accounts set status='active' where id='00000000-0000-0000-0000-000000000002';

-- Authority: other Platform capabilities and a current Demo POV cannot edit.
select pg_temp.as_user('00000000-0000-0000-0000-00000000e2a1');
select is(pg_temp.attempt($$select platform_rename_customer_structure(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','location','00000000-0000-0000-0000-000000000212','Synthetic campus A2-C1','X')$$),'42501:not_authorized','operations:manage and tenant:provision cannot edit profiles');
select pg_temp.as_user('00000000-0000-0000-0000-00000000e2a2');
select is(pg_temp.attempt($$select platform_rename_customer_structure(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','location','00000000-0000-0000-0000-000000000212','Synthetic campus A2-C1','X')$$),'42501:demo_mode_active','Current Demo POV cannot edit profiles (UX11 demo_mode_active guard, 202611130001)');
select pg_temp.as_user(current_setting('t.tenant'));
select alike(pg_temp.attempt($$select platform_rename_customer_structure(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','location','00000000-0000-0000-0000-000000000212','Synthetic campus A2-C1','X')$$),'42501:%','Tenant administrator cannot use the Platform command');

-- Audit and side effects.
reset role;
select is((select count(*)::int from pikas_private.platform_audit_events where actor_person_id='00000000-0000-0000-0000-00000000e2b0' and reason_code in ('customer_profile_updated','customer_structure_renamed')),6,'Every edit audited to the real Platform operator');
select is(pg_temp.memberships('00000000-0000-0000-0000-00000000e2b0'),current_setting('t.before'),'Operator gains no tenant membership');
select is(pg_temp.q($s$select concat_ws('|',(select count(*) from purchases),(select count(*) from wallet_ledger_entries),(select count(*) from cafeteria_products),(select count(*) from cafeteria_registers))$s$),current_setting('t.money'),'No financial, catalog or register change');

select * from finish();
rollback;
