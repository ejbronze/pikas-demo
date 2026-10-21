-- System-generated codes: SEDE-NN / CAF-NN in Agregar sede, CAJA-NN in register_save.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$declare sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 perform set_config('pikas.customer_operations_account','',true); perform set_config('pikas.customer_operations_school','',true);
 perform set_config('pikas.customer_operations_cafeteria','',true); perform set_config('pikas.customer_operations_mode','',true);
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;
create function pg_temp.q(sql text) returns text language plpgsql security definer set search_path=public as $$declare r text; begin execute sql into r; return r; end$$;
create function pg_temp.reg(caf uuid,key uuid,reg uuid,code text,name text) returns text language plpgsql as $$ begin
 return platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001',caf,key,'register_save',
  jsonb_build_object('id',reg,'version',null,'code',code,'name',name,'status','active'))->>'target_id'; end $$;
create function pg_temp.code(reg uuid) returns text language sql security definer set search_path=public as $$ select register_code from cafeteria_registers where id=reg $$;

reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-00000000c0d1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','codigos.admin@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-00000000c0e1','00000000-0000-0000-0000-00000000c0d1','Operador códigos ficticio');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-00000000c0e1','platform_admin');
select set_config('t.tenant',(select auth_user_id::text from persons where id='00000000-0000-0000-0000-000000001003'),true);
create temp table legacy_codes as select id::text id,code from school_locations union all select id::text,code from cafeterias union all select id::text,register_code from cafeteria_registers union all select id::text,code from schools union all select id::text,code from accounts;

select ok(not has_function_privilege('authenticated','pikas_private.next_scoped_code(text,uuid)','execute'),'Code generator is not client-callable');

-- 1-3. Agregar sede without codes: SEDE-NN within the colegio, CAF-NN within the new sede.
select pg_temp.as_user('00000000-0000-0000-0000-00000000c0d1');
select set_config('t.col',platform_onboard_school(gen_random_uuid(),'Colegio Códigos Ficticio','131987654','Calle 1','DO','DO-25')::text,true);
select is(pg_temp.q(format($s$select concat_ws('|',l.code,c.code) from school_locations l join cafeterias c on c.school_location_id=l.id where l.school_id=%L$s$,current_setting('t.col')::jsonb->>'school_id')),'SEDE-01|CAF-01','A new colegio starts with SEDE-01 and CAF-01');
select is(platform_onboard_school('00000000-0000-4000-8000-00000000c101','Colegio Códigos Dos','131987654','Calle 2','DO','DO-01')->>'school_id',
 platform_onboard_school('00000000-0000-4000-8000-00000000c101','Colegio Códigos Dos','131987654','Calle 2','DO','DO-01')->>'school_id','Agregar colegio retry returns the same colegio');
select is(pg_temp.q($s$select count(*)::text from schools where name='Colegio Códigos Dos'$s$),'1','Agregar colegio retry creates no second colegio');
select set_config('t.s2',platform_add_school_location('00000000-0000-4000-8000-00000000c201',(current_setting('t.col')::jsonb->>'account_id')::uuid,(current_setting('t.col')::jsonb->>'school_id')::uuid,null,'Sede Tamboril',null,'Cafetería Tamboril')::text,true);
select is(current_setting('t.s2')::jsonb->>'location_code','SEDE-02','1. Second sede of a colegio gets SEDE-02');
select is(current_setting('t.s2')::jsonb->>'cafeteria_code','CAF-01','2. Its first cafetería gets CAF-01');
select is(pg_temp.q(format($s$select concat_ws('|',l.code,l.name,c.code,c.name) from school_locations l join cafeterias c on c.school_location_id=l.id where l.id=%L$s$,current_setting('t.s2')::jsonb->>'location_id')),'SEDE-02|Sede Tamboril|CAF-01|Cafetería Tamboril','1/2. Stored as returned');
-- 6. Replay returns the original entity and code, creating nothing new.
select is(platform_add_school_location('00000000-0000-4000-8000-00000000c201',(current_setting('t.col')::jsonb->>'account_id')::uuid,(current_setting('t.col')::jsonb->>'school_id')::uuid,null,'Sede Tamboril',null,'Cafetería Tamboril'),
 current_setting('t.s2')::jsonb,'6. Retry returns the original sede, cafetería and codes');
select is(pg_temp.q(format($s$select count(*)::text from school_locations where school_id=%L$s$,current_setting('t.col')::jsonb->>'school_id')),'2','6. Retry created no extra sede');
-- 4. Collision skipped: a legacy SEDE-04 already exists; the next generated sede skips past it.
reset role;
insert into school_locations(account_id,school_id,code,name) select (current_setting('t.col')::jsonb->>'account_id')::uuid,(current_setting('t.col')::jsonb->>'school_id')::uuid,'sede-04','Sede legada';
select pg_temp.as_user('00000000-0000-0000-0000-00000000c0d1');
select is(platform_add_school_location(gen_random_uuid(),(current_setting('t.col')::jsonb->>'account_id')::uuid,(current_setting('t.col')::jsonb->>'school_id')::uuid,null,'Sede Norte',null,'Cafetería Norte')->>'location_code','SEDE-05','4. Taken numbers (case-insensitive) are never reused or duplicated');
-- 7. Explicit codes from compatible callers are still accepted.
select is(platform_add_school_location(gen_random_uuid(),(current_setting('t.col')::jsonb->>'account_id')::uuid,(current_setting('t.col')::jsonb->>'school_id')::uuid,'MANUAL-SEDE','Sede Manual','MANUAL-CAF','Cafetería Manual')->>'location_code','MANUAL-SEDE','7. Explicit legacy code input still honored');

-- 8-11. Cajas through register_save (Platform support path).
select set_config('t.caf',current_setting('t.s2')::jsonb->>'cafeteria_id',true);
select is(platform_support_cafeteria_command((current_setting('t.col')::jsonb->>'account_id')::uuid,current_setting('t.caf')::uuid,'00000000-0000-4000-8000-00000000c301','register_save',
 '{"id":"00000000-0000-4000-8000-00000000c311","version":null,"code":null,"name":"Caja 1","status":"active"}')->>'target_id','00000000-0000-4000-8000-00000000c311','8. Caja created without a code');
select is(pg_temp.code('00000000-0000-4000-8000-00000000c311'),'CAJA-01','8. First caja gets CAJA-01');
select ok(platform_support_cafeteria_command((current_setting('t.col')::jsonb->>'account_id')::uuid,current_setting('t.caf')::uuid,gen_random_uuid(),'register_save',
 '{"id":"00000000-0000-4000-8000-00000000c312","version":null,"code":null,"name":"Caja 2","status":"active"}') ? 'target_id','9. Second caja created');
select is(pg_temp.code('00000000-0000-4000-8000-00000000c312'),'CAJA-02','9. Second caja gets CAJA-02');
-- 10. Scoped per cafetería: another cafetería starts again at CAJA-01.
select ok(platform_support_cafeteria_command((current_setting('t.col')::jsonb->>'account_id')::uuid,(current_setting('t.col')::jsonb->>'cafeteria_id')::uuid,gen_random_uuid(),'register_save',
 '{"id":"00000000-0000-4000-8000-00000000c313","version":null,"code":null,"name":"Caja principal","status":"active"}') ? 'target_id','10. Caja in another cafetería');
select is(pg_temp.code('00000000-0000-4000-8000-00000000c313'),'CAJA-01','10. Numbering is per cafetería');
-- 11. Documented rule: with CAJA-01 and an explicit CAJA-03 present, the next is CAJA-04 (never reuses 02/03).
select ok(platform_support_cafeteria_command((current_setting('t.col')::jsonb->>'account_id')::uuid,(current_setting('t.col')::jsonb->>'cafeteria_id')::uuid,gen_random_uuid(),'register_save',
 '{"id":"00000000-0000-4000-8000-00000000c314","version":null,"code":"CAJA-03","name":"Caja manual","status":"active"}') ? 'target_id','11. Explicit CAJA-03 accepted');
select ok(platform_support_cafeteria_command((current_setting('t.col')::jsonb->>'account_id')::uuid,(current_setting('t.col')::jsonb->>'cafeteria_id')::uuid,gen_random_uuid(),'register_save',
 '{"id":"00000000-0000-4000-8000-00000000c315","version":null,"code":null,"name":"Caja siguiente","status":"active"}') ? 'target_id','11. Next caja created');
select is(pg_temp.code('00000000-0000-4000-8000-00000000c315'),'CAJA-04','11. Next after max(siblings, highest CAJA-NN) is CAJA-04');
-- Legacy-format neighbours: fixture cafetería 111 has CAJA-1 and CAJA-2 → the next is CAJA-03, never a confusing CAJA-01.
select is(pg_temp.reg('00000000-0000-0000-0000-000000000111','00000000-0000-4000-8000-00000000c302','00000000-0000-4000-8000-00000000c316',null,'Caja fixture'),'00000000-0000-4000-8000-00000000c316','Caja beside legacy codes created');
select is(pg_temp.code('00000000-0000-4000-8000-00000000c316'),'CAJA-03','Legacy CAJA-1/CAJA-2 count as 1 and 2; next is CAJA-03');
-- 12. Replay returns the original caja and code.
select is(platform_support_cafeteria_command((current_setting('t.col')::jsonb->>'account_id')::uuid,current_setting('t.caf')::uuid,'00000000-0000-4000-8000-00000000c301','register_save',
 '{"id":"00000000-0000-4000-8000-00000000c311","version":null,"code":null,"name":"Caja 1","status":"active"}')->>'target_id','00000000-0000-4000-8000-00000000c311','12. Retry returns the original caja');
select is(pg_temp.q(format($s$select string_agg(register_code,',' order by register_code) from cafeteria_registers where cafeteria_id=%L$s$,current_setting('t.caf'))),'CAJA-01,CAJA-02','12. Retry created no extra caja or code');
-- Edit with a null code keeps the assigned code.
select ok(platform_support_cafeteria_command((current_setting('t.col')::jsonb->>'account_id')::uuid,current_setting('t.caf')::uuid,gen_random_uuid(),'register_save',
 '{"id":"00000000-0000-4000-8000-00000000c311","version":1,"code":null,"name":"Caja 1 renombrada","status":"active"}') ? 'target_id','Edit without a code');
select is(pg_temp.q($s$select concat_ws('|',register_code,display_name) from cafeteria_registers where id='00000000-0000-4000-8000-00000000c311'$s$),'CAJA-01|Caja 1 renombrada','Rename keeps the assigned code');

-- 13. A used caja's code stays locked.
reset role;
set local session_replication_role=replica;
insert into register_sessions(account_id,school_id,school_location_id,cafeteria_id,register_id,assignment_id,operator_membership_id,operator_person_id,operator_role_code,register_code_snapshot,register_name_snapshot,opened_at,opened_business_date,business_timezone_snapshot,currency_code,opening_cash_minor,open_request_key,open_payload_fingerprint,status,closed_at,closed_by_person_id,counted_cash_minor,close_type,close_request_key,close_payload_fingerprint)
 select r.account_id,r.school_id,r.school_location_id,r.cafeteria_id,r.id,gen_random_uuid(),gen_random_uuid(),'00000000-0000-0000-0000-00000000c0e1','pos_cashier',r.register_code,r.display_name,now()-interval '2 hours',((now()-interval '2 hours') at time zone 'America/Santo_Domingo')::date,'America/Santo_Domingo','DOP',0,'fixture-open-key-0001',repeat('a',64),'closed',now()-interval '1 hour','00000000-0000-0000-0000-00000000c0e1',0,'normal','fixture-close-key-001',repeat('b',64)
 from cafeteria_registers r where r.id='00000000-0000-4000-8000-00000000c312';
set local session_replication_role=origin;
select pg_temp.as_user('00000000-0000-0000-0000-00000000c0d1');
select is(pg_temp.attempt($$select platform_support_cafeteria_command((current_setting('t.col')::jsonb->>'account_id')::uuid,current_setting('t.caf')::uuid,gen_random_uuid(),'register_save','{"id":"00000000-0000-4000-8000-00000000c312","version":1,"code":"OTRA","name":"Caja 2","status":"active"}')$$),
 '23514:register_code_immutable_after_session_history','13. Used caja code cannot change');

-- 14. Authorization unchanged; tenant path generates too.
select pg_temp.as_user(current_setting('t.tenant'));
select ok(cafeteria_admin_command('00000000-0000-0000-0000-000000000111','00000000-0000-4000-8000-00000000c303','register_save',
 '{"id":"00000000-0000-4000-8000-00000000c317","version":null,"code":null,"name":"Caja tenant","status":"active"}') ? 'target_id','14. Tenant cafeteria admin creates a caja without a code');
select is(pg_temp.code('00000000-0000-4000-8000-00000000c317'),'CAJA-04','14. Tenant path uses the same generator');
select alike(pg_temp.attempt($$select platform_add_school_location(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',null,'X',null,'Y')$$),'42501:%','14. Tenant user cannot add a sede');
select alike(pg_temp.attempt($$select cafeteria_admin_command('00000000-0000-0000-0000-000000000121',gen_random_uuid(),'register_save','{"id":"00000000-0000-4000-8000-00000000c318","version":null,"code":null,"name":"Ajena","status":"active"}')$$),'42501:%','14. Tenant user cannot create a caja elsewhere');
reset role;
select is((select count(*)::int from legacy_codes l where l.code is distinct from (select x.code from (select id::text id,code from school_locations union all select id::text,code from cafeterias union all select id::text,register_code from cafeteria_registers union all select id::text,code from schools union all select id::text,code from accounts) x where x.id=l.id)),0,
 '3. Every pre-existing account, colegio, sede, cafetería and caja code is unchanged');

select * from finish();
rollback;
