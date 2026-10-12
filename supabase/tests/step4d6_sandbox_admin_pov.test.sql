-- Focused local-only test: run after scripts/setup-local-horizonte.py --web.
-- All mutations, including the second synthetic operator, roll back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_actor(u uuid,q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
 perform set_config('request.jwt.claim.sub',u::text,true);
 set local role authenticated;
 execute q into r;
 reset role;
 return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.denied(u uuid,q text) returns text language plpgsql as $$
begin perform pg_temp.as_actor(u,q); return 'allowed'; exception when others then return sqlstate; end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('4d6f0000-0000-4000-8000-000000000100','authenticated','authenticated','oscar-4d6@example.invalid',now());
insert into public.persons(id,auth_user_id,display_name) values('4d6f0000-0000-4000-8000-000000000101','4d6f0000-0000-4000-8000-000000000100','Oscar · Local');
insert into pikas_private.platform_memberships(person_id,role_code) values('4d6f0000-0000-4000-8000-000000000101','platform_sandbox_operator');
create function pg_temp.enter_as(u uuid,code text) returns jsonb language sql as $$
 select pg_temp.as_actor(u,format('select public.platform_enter_sandbox_pov(%L,%L,%L,%L)',gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe',code))
$$;
select is(jsonb_array_length(pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.platform_list_sandbox_pov_targets()')),3,'three registered experiences');
select is(pg_temp.denied('00000000-0000-0000-0000-000000002002',$q$select public.platform_enter_sandbox_pov(gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe','school_admin')$q$),'42501','tenant administrator without sandbox capability denied');
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$q$select public.platform_enter_sandbox_pov(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','school_admin')$q$),'42501','customer target denied');
select is(pg_temp.enter_as('ec08ad21-4020-4b0d-b041-ee4a1fe09471','school_admin')->>'pov_code','school_admin','Edwin school experience');
select is(pg_temp.enter_as('4d6f0000-0000-4000-8000-000000000100','school_admin')->>'pov_code','school_admin','Oscar school experience');
select is((select count(*) from pikas_private.sandbox_pov_sessions where status='active' and initiator_person_id in ('82af93c4-730f-468c-9e4c-2c5238f226f1','4d6f0000-0000-4000-8000-000000000101')),2::bigint,'independent operator sessions');
select is(pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select to_jsonb(pikas_private.current_person_id())')#>>'{}','82af93c4-730f-468c-9e4c-2c5238f226f1','real identity retained');
select is(jsonb_array_length(pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$q$select public.school_admin_read('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','students')$q$)->'rows'),4,'four authoritative students');
select ok(pg_temp.as_actor('4d6f0000-0000-4000-8000-000000000100',$q$select public.school_admin_read('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','students')$q$)->'rows' @> '[{"display_name":"Luna Castillo"},{"display_name":"Mateo Ventura"},{"display_name":"Alma Robles"},{"display_name":"Bruno Peña"}]','shared named roster');
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_pos_access_context()'),'42501','school persona cannot resolve POS authority');
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_cafeteria_admin_context()'),'42501','school persona cannot resolve cafeteria authority');
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$q$select public.school_admin_read('00000000-0000-0000-0000-000000000011','students')$q$),'42501','other school denied');
create temp table command_result as select pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$q$select public.school_admin_command('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','4d6f0000-0000-4000-8000-000000000201','student_status','{"student_id":"4c000000-0000-4000-8000-000000000201","status":"suspended"}')$q$) result;
select is((select status from public.students where id='4c000000-0000-4000-8000-000000000201'),'suspended','nested student mutation works');
select is(pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$q$select public.school_admin_command('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','4d6f0000-0000-4000-8000-000000000201','student_status','{"student_id":"4c000000-0000-4000-8000-000000000201","status":"suspended"}')$q$),(select result from command_result),'exact school replay');
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$q$select public.school_admin_command('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','4d6f0000-0000-4000-8000-000000000201','student_status','{"student_id":"4c000000-0000-4000-8000-000000000201","status":"active"}')$q$),'23505','changed school payload denied');
select is(pg_temp.denied('4d6f0000-0000-4000-8000-000000000100',$q$select public.school_admin_command('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','4d6f0000-0000-4000-8000-000000000201','student_status','{"student_id":"4c000000-0000-4000-8000-000000000201","status":"suspended"}')$q$),'23505','cross-operator school replay denied');
select ok(exists(select 1 from public.audit_events e join pikas_private.sandbox_pov_sessions s on s.id=e.sandbox_pov_session_id where e.request_id='4d6f0000-0000-4000-8000-000000000201' and e.actor_person_id='4d600000-0000-4000-8000-000000000001' and e.authenticated_user_id='ec08ad21-4020-4b0d-b041-ee4a1fe09471' and s.initiator_person_id='82af93c4-730f-468c-9e4c-2c5238f226f1' and e.after_metadata->>'pov_code'='school_admin'),'dual identity + session audit');
select ok(exists(select 1 from pikas_private.school_admin_requests where request_id='4d6f0000-0000-4000-8000-000000000201' and sandbox_pov_session_id is not null),'request retains originating session');
select lives_ok($q$select pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$s$select public.school_admin_command('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488',gen_random_uuid(),'student_create','{"first_name":"Local","last_name":"Fixture","student_code":"4D6-NEW","location_id":"cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4","starts_on":"2026-10-12","grade":"5","class":"A","homeroom":null}')$s$)$q$,'nested person/student/enrollment creation');
select lives_ok($q$select pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$s$select public.school_admin_command('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488',gen_random_uuid(),'sharing_set','{"cafeteria_id":"b9496342-5079-46ae-83b8-05c39bcbd7fe","status":"active","categories":["basic_identification","student_code","placement","dietary_restrictions"]}')$s$)$q$,'nested sharing mutation');
select is(pg_temp.enter_as('ec08ad21-4020-4b0d-b041-ee4a1fe09471','cafeteria_admin')->>'pov_code','cafeteria_admin','switch supersedes school session');
select is(pg_temp.enter_as('4d6f0000-0000-4000-8000-000000000100','cafeteria_admin')->>'pov_code','cafeteria_admin','Oscar cafeteria experience');
select is((select count(*) from pikas_private.sandbox_pov_sessions where status='active' and initiator_person_id in ('82af93c4-730f-468c-9e4c-2c5238f226f1','4d6f0000-0000-4000-8000-000000000101')),2::bigint,'one active per operator after switch');
select is(jsonb_array_length(pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$q$select public.cafeteria_admin_read('b9496342-5079-46ae-83b8-05c39bcbd7fe')$q$)->'products'),6,'six authoritative products');
select ok(pg_temp.as_actor('4d6f0000-0000-4000-8000-000000000100',$q$select public.cafeteria_admin_read('b9496342-5079-46ae-83b8-05c39bcbd7fe')$q$)->'staff' @> '[{"name":"José Ramírez","role":"pos_cashier"}]','Jose visible');
select ok(pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$q$select public.cafeteria_admin_read('b9496342-5079-46ae-83b8-05c39bcbd7fe')$q$)->'registers' @> '[{"code":"HZ-01","name":"Caja demo Horizonte"}]','register visible');
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_pos_access_context()'),'42501','cafeteria persona cannot resolve POS authority');
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_school_admin_context()'),'42501','cafeteria persona cannot resolve school authority');
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$q$select public.cafeteria_admin_read('00000000-0000-0000-0000-000000000111')$q$),'42501','other cafeteria denied');
select lives_ok($q$select pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$s$select public.cafeteria_admin_command('b9496342-5079-46ae-83b8-05c39bcbd7fe','4d6f0000-0000-4000-8000-000000000202','settings_save','{"version":1,"scheduling_enabled":false}')$s$)$q$,'nested settings command');
select lives_ok($q$select pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$s$select public.cafeteria_admin_command('b9496342-5079-46ae-83b8-05c39bcbd7fe','4d6f0000-0000-4000-8000-000000000202','settings_save','{"version":1,"scheduling_enabled":false}')$s$)$q$,'exact cafeteria replay');
select is(pg_temp.denied('4d6f0000-0000-4000-8000-000000000100',$q$select public.cafeteria_admin_command('b9496342-5079-46ae-83b8-05c39bcbd7fe','4d6f0000-0000-4000-8000-000000000202','settings_save','{"version":1,"scheduling_enabled":false}')$q$),'23505','cross-operator cafeteria replay denied');
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$q$select public.cafeteria_admin_command('b9496342-5079-46ae-83b8-05c39bcbd7fe','4d6f0000-0000-4000-8000-000000000203','staff_status','{"membership_id":"6c000000-0000-4000-8000-000000000002","status":"active"}')$q$),'23514','Auth-less Jose cannot be reactivated as authenticated staff');
select lives_ok($q$select pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$s$select public.cafeteria_admin_command('b9496342-5079-46ae-83b8-05c39bcbd7fe',gen_random_uuid(),'product_save','{"id":"4c000000-0000-4000-8000-000000000030","version":1,"name":"Agua natural","description":"Producto ficticio del sandbox Horizonte","category":"Bebidas","price_minor":2500,"active":true,"available":true,"ingredients":["agua"],"allergens":[]}')$s$)$q$,'nested product edit');
select lives_ok($q$select pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$s$select public.cafeteria_admin_command('b9496342-5079-46ae-83b8-05c39bcbd7fe',gen_random_uuid(),'menu_save','{"id":"4d6f0000-0000-4000-8000-000000000210","version":null,"name":"Menú local","description":"Fixture","active":true,"product_ids":["4c000000-0000-4000-8000-000000000030"]}')$s$)$q$,'nested menu and product link creation');
select lives_ok($q$select pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$s$select public.cafeteria_admin_command('b9496342-5079-46ae-83b8-05c39bcbd7fe',gen_random_uuid(),'shift_save','{"id":"4d6f0000-0000-4000-8000-000000000211","version":null,"menu_id":"4d6f0000-0000-4000-8000-000000000210","name":"Turno local","start_time":"08:00","end_time":"10:00","enabled":true,"weekdays":[1]}')$s$)$q$,'nested shift creation');
select lives_ok($q$select pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$s$select public.cafeteria_admin_command('b9496342-5079-46ae-83b8-05c39bcbd7fe',gen_random_uuid(),'register_save','{"id":"4d6f0000-0000-4000-8000-000000000212","version":null,"code":"4D6-LOCAL","name":"Caja local","status":"active"}')$s$)$q$,'nested register creation');
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$q$select public.cafeteria_admin_command('b9496342-5079-46ae-83b8-05c39bcbd7fe','4d6f0000-0000-4000-8000-000000000202','settings_save','{"version":1,"scheduling_enabled":true}')$q$),'23505','changed cafeteria replay denied');
select ok(exists(select 1 from public.audit_events e join pikas_private.sandbox_pov_sessions pv on pv.id=e.sandbox_pov_session_id where e.request_id='4d6f0000-0000-4000-8000-000000000202' and e.actor_person_id='4d600000-0000-4000-8000-000000000002' and pv.initiator_person_id='82af93c4-730f-468c-9e4c-2c5238f226f1' and e.after_metadata->>'pov_code'='cafeteria_admin'),'cafeteria dual identity audit');
select is(pg_temp.enter_as('ec08ad21-4020-4b0d-b041-ee4a1fe09471','cashier')->>'pov_code','cashier','cashier experience preserved');
select is(pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_pos_access_context()')->'actor'->>'display_name','José Ramírez','cashier actor remains Jose');
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_school_admin_context()'),'42501','cashier cannot resolve school authority');
select lives_ok($q$select pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$s$select to_jsonb(x) from public.open_register_session('4c000000-0000-4000-8000-000000000010','4c000000-0000-4000-8000-000000000011',0,'4d6-cashier-regression-key') x$s$)$q$,'cashier opens exact assigned register');
select is(pg_temp.enter_as('ec08ad21-4020-4b0d-b041-ee4a1fe09471','school_admin')->>'pov_code','school_admin','reenter school');
select lives_ok($q$select pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471',$s$select public.school_admin_command('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','4d6f0000-0000-4000-8000-000000000201','student_status','{"student_id":"4c000000-0000-4000-8000-000000000201","status":"suspended"}')$s$)$q$,'same operator can recover original request after authorized reentry');
select lives_ok($q$select pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.platform_exit_sandbox_pov(gen_random_uuid())')$q$,'exit');
select is(jsonb_array_length(pg_temp.as_actor('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_school_admin_context()')->'schools'),0,'exit removes effective authority');
select is(pg_temp.enter_as('ec08ad21-4020-4b0d-b041-ee4a1fe09471','school_admin')->>'pov_code','school_admin','reenter before revocation');
update pikas_private.platform_memberships set status='suspended' where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1' and role_code='platform_sandbox_operator';
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_school_admin_context()'),'42501','revoked capability fails closed');
update pikas_private.platform_memberships set status='active' where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1' and role_code='platform_sandbox_operator';
update public.school_memberships set status='suspended' where id='4d600000-0000-4000-8000-000000000011';
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_school_admin_context()'),'42501','suspended persona membership fails closed');
update public.school_memberships set status='active' where id='4d600000-0000-4000-8000-000000000011';
update public.school_locations set status='inactive' where id='cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_school_admin_context()'),'42501','inactive exact campus denied');
update public.school_locations set status='active' where id='cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
update pikas_private.sandbox_pov_sessions set status='exited',ended_at=clock_timestamp(),end_reason='superseded' where initiator_person_id='82af93c4-730f-468c-9e4c-2c5238f226f1' and status='active';
insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,persona_school_membership_id,started_at,expires_at)
select gen_random_uuid(),initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,persona_school_membership_id,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour'
from pikas_private.sandbox_pov_sessions where initiator_person_id='82af93c4-730f-468c-9e4c-2c5238f226f1' order by started_at desc limit 1;
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_school_admin_context()'),'42501','expired active attempt fails closed');
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_pos_access_context()'),'42501','expired admin attempt cannot fall back into POS');
select is(pg_temp.enter_as('ec08ad21-4020-4b0d-b041-ee4a1fe09471','school_admin')->>'pov_code','school_admin','explicit fresh entry supersedes expired attempt');
update pikas_private.sandbox_pov_personas set status='inactive' where id='4d600000-0000-4000-8000-000000000021';
select is(pg_temp.denied('ec08ad21-4020-4b0d-b041-ee4a1fe09471','select public.get_school_admin_context()'),'42501','inactive registered persona fails closed');
select is((select count(*) from (select person_id from public.account_memberships union all select person_id from public.school_memberships union all select person_id from public.cafeteria_memberships) m where person_id in ('82af93c4-730f-468c-9e4c-2c5238f226f1','4d6f0000-0000-4000-8000-000000000101')),0::bigint,'zero operator tenant memberships');
-- Normal customer authority remains usable without a POV.
select is(jsonb_array_length(pg_temp.as_actor('00000000-0000-0000-0000-000000002002','select public.get_school_admin_context()')->'schools'),1,'normal school context preserved');
select lives_ok($q$select pg_temp.as_actor('00000000-0000-0000-0000-000000002003',$s$select public.cafeteria_admin_read('00000000-0000-0000-0000-000000000111')$s$)$q$,'normal cafeteria read preserved');
select * from finish();
rollback;
