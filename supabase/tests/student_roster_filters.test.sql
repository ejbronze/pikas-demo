-- Local fictional operator fixture. All changes roll back.
begin;
-- Transactional fictional sandbox operator (rolled back with the test); no prior browser walkthrough is required.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('7b000000-0000-4000-8000-00000000b001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tx-sandbox-operator@example.invalid','',now(),now(),now(),'{}','{}');
insert into public.persons(id,auth_user_id,display_name) values('7b000000-0000-4000-8000-00000000b002','7b000000-0000-4000-8000-00000000b001','Operador sandbox de prueba');
insert into pikas_private.platform_memberships(person_id,role_code) values('7b000000-0000-4000-8000-00000000b002','platform_sandbox_operator');

create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create temporary table fixture as select auth_user_id uid,'b2b00000-0000-4000-8000-000000000001'::uuid sid from persons where id='7b000000-0000-4000-8000-00000000b002';
insert into auth.sessions(id,user_id,created_at,updated_at) select sid,uid,clock_timestamp(),clock_timestamp() from fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid)::text,true) from fixture;
select public.pikas_session_start();
select public.platform_enter_sandbox_pov(gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe','school_admin');
insert into school_locations(id,account_id,school_id,code,name,status) values ('b2b00000-0000-4000-8000-000000000099','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','B2B-SECOND','B2B Second','active'),('b2b00000-0000-4000-8000-000000000098','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','B2B-INACTIVE','B2B Inactive','inactive');
select public.school_student_bulk_commit('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488',gen_random_uuid(),(select jsonb_agg(jsonb_build_object('source_row',n,'first_name','B2B Filter','last_name','Test','student_code','B2B-FILTER-'||n,'starts_on',(clock_timestamp() at time zone 'America/Santo_Domingo')::date::text,'location_id',case when n=61 then 'b2b00000-0000-4000-8000-000000000099' else 'cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4' end,'grade',case when n<=55 then 'B2B 4' else 'B2B 40' end)) from generate_series(1,61) n),array(select generate_series(1,61)),true);
create function pg_temp.roster(p_grade text default null,p_location uuid default null,p_after uuid default null,p_limit integer default 50) returns jsonb language sql as $$select public.school_student_roster('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','B2B Filter','',p_after,p_limit,p_location,p_grade)$$;
set local role authenticated;
select is(jsonb_array_length(pg_temp.roster('B2B 40')->'rows'),6,'exact grade filter before pagination selects all six beyond 50-row unfiltered boundary');
select is(pg_temp.roster('B2B 40')->>'next_cursor',null::text,'filtered six rows have no next page');
select is(jsonb_array_length(pg_temp.roster('B2B 4')->'rows'),50,'grade result preserves page limit');
select ok(pg_temp.roster('B2B 4')->>'next_cursor' is not null,'grade result preserves cursor');
select is(jsonb_array_length(pg_temp.roster('B2B 4',null,(pg_temp.roster('B2B 4')->>'next_cursor')::uuid)->'rows'),5,'second filtered page contains five remaining students');
select is(jsonb_array_length(pg_temp.roster('b2b 4')->'rows'),0,'grade comparison exact and case sensitive');
select is(jsonb_array_length(pg_temp.roster('B2B 4','cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4')->'rows'),50,'campus and grade combine before pagination');
select is(jsonb_array_length(pg_temp.roster('B2B 40','cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4')->'rows'),5,'campus filter excludes other same-school campus');
select is(jsonb_array_length(pg_temp.roster(null,'b2b00000-0000-4000-8000-000000000099')->'rows'),1,'other active campus returns only its own student');
select throws_ok($q$select pg_temp.roster(null,'b2b00000-0000-4000-8000-000000000098')$q$,'22023','invalid_school_location','inactive campus rejected');
select ok((pg_temp.roster()->'grades') ? 'B2B 40','choices derive from authoritative current placements');
select is(jsonb_array_length(public.school_student_roster('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','B2B-FILTER-61','active')->'rows'),1,'name/code search and status preserved');
select is(jsonb_array_length(public.school_student_roster('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','B2B Filter','inactive')->'rows'),0,'status filters authoritative');
select throws_ok($q$select pg_temp.roster(null,'00000000-0000-4000-8000-000000000099')$q$,'22023','invalid_school_location','unknown campus rejected');
select throws_ok($q$select pg_temp.roster('')$q$,'22023','invalid_school_filter','empty explicit grade rejected');
select throws_ok($q$select pg_temp.roster(null,null,null,101)$q$,'22023','invalid_school_filter','bounded page limit');
reset role;
select throws_ok(format('select pg_temp.roster(null,%L)',(select id from school_locations where school_id<>'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488' limit 1)),'22023','invalid_school_location','cross-school campus rejected');
select throws_ok(format('select public.school_student_roster(%L)',(select id from schools where id<>'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488' limit 1)),'42501','school_authority_required','cross-school roster denied');
update pikas_private.application_sessions set started_at=clock_timestamp()-interval '1 hour',last_active_at=clock_timestamp()-interval '31 minutes' where session_id=(select sid from fixture);
select throws_ok($q$select pg_temp.roster()$q$,'42501','application_session_expired','expired application session denied');
select * from finish();
rollback;
