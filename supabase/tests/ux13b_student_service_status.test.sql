-- UX 13B (202611150001): cafeteria_admin_read.student_service — School-owned facts as operational status only,
-- for the cafetería the caller already administers. Fictional local fixtures (synthetic account 1: cafeterías 111/113
-- in school 11, 112 in school 12; account 2: cafetería 121). Rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.ss(c text) returns jsonb language sql as $$select public.cafeteria_admin_read(c::uuid)->'student_service'$$;
reset role;
select set_config('t.caps',(select count(*)||':'||md5(string_agg(scope_kind||':'||role_code||':'||capability,',' order by scope_kind,role_code,capability)) from pikas_private.role_capabilities),true);
select set_config('t.pcaps',(select count(*)||':'||md5(string_agg(role_code||':'||capability,',' order by role_code,capability)) from pikas_private.platform_role_capabilities),true);
-- Start every fixture cafetería from "never shared" and no eligibility, then build states up.
delete from cafeteria_customers where cafeteria_id in ('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000113');
delete from school_cafeteria_share_categories where share_id in (select id from school_cafeteria_shares where cafeteria_id='00000000-0000-0000-0000-000000000111');
delete from school_cafeteria_shares where cafeteria_id='00000000-0000-0000-0000-000000000111';

-- Contract: exactly the approved keys, nothing identifying
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((select string_agg(k,',' order by k) from jsonb_object_keys(pg_temp.ss('00000000-0000-0000-0000-000000000111')) k),'enabled_students,identification_shared,school_has_students,sharing,state','student_service carries exactly the approved keys');
-- 1. never shared
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'sharing','never','Never shared: sharing=never');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'state','not_shared','Never shared: state=not_shared');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'identification_shared','false','Never shared: identification not shared');
-- 6. active share without basic identification
reset role;
insert into school_cafeteria_shares(id,account_id,school_id,cafeteria_id,status) values('00000000-0000-0000-0000-00000000c111','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','active');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'state','identification_not_shared','Active share without basic identification: identification_not_shared');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'sharing','active','… while sharing=active');
-- 2. active share + identification, zero school students (school 12 → cafetería 112, admin 2004)
reset role;
insert into school_cafeteria_shares(id,account_id,school_id,cafeteria_id,status) values('00000000-0000-0000-0000-00000000c112','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000112','active');
insert into school_cafeteria_share_categories(account_id,school_id,cafeteria_id,share_id,category,enabled) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000112','00000000-0000-0000-0000-00000000c112','basic_identification',true);
select is((select count(*) from students where school_id='00000000-0000-0000-0000-000000000012' and status='active'),0::bigint,'Fixture: school 12 has no active students');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000112')->>'state','no_students','Shared with identification but the school has no students: no_students');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000112')->>'school_has_students','false','… school_has_students=false');
-- 3. active share + identification + students, zero enabled (school 11 → 111)
reset role;
insert into school_cafeteria_share_categories(account_id,school_id,cafeteria_id,share_id,category,enabled) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-00000000c111','basic_identification',true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'state','no_students_enabled','Students exist, none enabled: no_students_enabled');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'enabled_students','0','… enabled_students=0');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'school_has_students','true','… school_has_students=true (no count exposed)');
-- 4. enabled students → ready; only active students on active rows count
reset role;
insert into cafeteria_customers(account_id,school_id,cafeteria_id,student_id,status)
 select account_id,school_id,'00000000-0000-0000-0000-000000000111',id,'active' from students where school_id='00000000-0000-0000-0000-000000000011' and status='active';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'state','ready','Enabled students: ready');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'enabled_students','2','… enabled_students counts active rows of active students');
reset role; update cafeteria_customers set status='inactive' where cafeteria_id='00000000-0000-0000-0000-000000000111' and student_id=(select id from students where school_id='00000000-0000-0000-0000-000000000011' and status='active' order by id limit 1);
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'enabled_students','1','A disabled eligibility row no longer counts');
-- 5. revoked share
reset role; update school_cafeteria_shares set status='revoked' where id='00000000-0000-0000-0000-00000000c111';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'sharing','revoked','Revoked: sharing=revoked');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'state','sharing_revoked','Revoked: state=sharing_revoked (eligibility rows kept, not counted as service)');
select is(pg_temp.ss('00000000-0000-0000-0000-000000000111')->>'identification_shared','false','Revoked: identification not considered shared');
-- 7./8./9. Scope: own cafetería only; another cafetería and another customer refused (same error as before)
select is(pg_temp.attempt('select public.cafeteria_admin_read(''00000000-0000-0000-0000-000000000112'')'),'42501:cafeteria_authority_required','Cafetería 111 admin cannot read cafetería 112');
select is(pg_temp.attempt('select public.cafeteria_admin_read(''00000000-0000-0000-0000-000000000121'')'),'42501:cafeteria_authority_required','Another customer''s cafetería refused');
-- 10. suspended membership refused
reset role; update cafeteria_memberships set status='suspended' where person_id='00000000-0000-0000-0000-000000001003' and cafeteria_id='00000000-0000-0000-0000-000000000111';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt('select public.cafeteria_admin_read(''00000000-0000-0000-0000-000000000111'')'),'42501:cafeteria_authority_required','A suspended cafetería admin membership is refused');
reset role; update cafeteria_memberships set status='active' where person_id='00000000-0000-0000-0000-000000001003' and cafeteria_id='00000000-0000-0000-0000-000000000111';
-- 11. no identity leaks: nothing from the roster in the whole read beyond the approved status
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok(not (public.cafeteria_admin_read('00000000-0000-0000-0000-000000000111')::text ilike any(array['%student_code%','%display_name":"Sol%','%Ficticia Beta%','%grade%','%dietary%','%student_id%'])),'The read carries no student names, ids, codes, placements or restrictions');
-- 12. no School mutation becomes available to the cafetería
select is(pg_temp.attempt(format('select public.cafeteria_admin_command(%L,gen_random_uuid(),''sharing_set'',''{"cafeteria_id":"00000000-0000-0000-0000-000000000111","status":"active","categories":[]}''::jsonb)','00000000-0000-0000-0000-000000000111')),'22023:unsupported_command_fields','sharing_set is not a cafetería command');
select is(pg_temp.attempt(format('select public.cafeteria_admin_command(%L,gen_random_uuid(),''customer_set'',''{"cafeteria_id":"00000000-0000-0000-0000-000000000111","student_id":"00000000-0000-0000-0000-000000000111","enabled":true}''::jsonb)','00000000-0000-0000-0000-000000000111')),'22023:unsupported_command_fields','customer_set is not a cafetería command');
select is(pg_temp.attempt('select public.school_admin_command(''00000000-0000-0000-0000-000000000011'',gen_random_uuid(),''sharing_set'',''{"cafeteria_id":"00000000-0000-0000-0000-000000000111","status":"active","categories":[]}''::jsonb)') ~ '^42501:', true, 'A cafetería admin cannot run the School sharing command');
-- 13. capability/grant fingerprints unchanged; surface unchanged
reset role;
select is((select count(*)||':'||md5(string_agg(scope_kind||':'||role_code||':'||capability,',' order by scope_kind,role_code,capability)) from pikas_private.role_capabilities),current_setting('t.caps'),'Tenant capability grants unchanged');
select is((select count(*)||':'||md5(string_agg(role_code||':'||capability,',' order by role_code,capability)) from pikas_private.platform_role_capabilities),current_setting('t.pcaps'),'Platform grants unchanged');
select ok(has_function_privilege('authenticated','public.cafeteria_admin_read(uuid)','execute') and not has_function_privilege('anon','public.cafeteria_admin_read(uuid)','execute'),'cafeteria_admin_read grants unchanged (authenticated only)');
select ok(not exists(select 1 from pg_policies where tablename in ('school_cafeteria_shares','cafeteria_customers','school_cafeteria_share_categories') and qual ilike '%cafeteria:%'),'No cafetería-side RLS was added to School-owned tables');

select * from finish();
rollback;
