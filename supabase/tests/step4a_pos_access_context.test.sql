begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,confirmed_at) values
 ('00000000-0000-0000-0000-000000002801','authenticated','authenticated','step4-op@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002802','authenticated','authenticated','step4-other@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002803','authenticated','authenticated','step4-admin@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002804','authenticated','authenticated','step4-tenant@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002805','authenticated','authenticated','step4-unlinked@example.invalid',now());
insert into public.persons(id,auth_user_id,display_name,status) values
 ('00000000-0000-0000-0000-000000001801','00000000-0000-0000-0000-000000002801','Sandbox initiator','active'),('00000000-0000-0000-0000-000000001802','00000000-0000-0000-0000-000000002802','Other initiator','active'),
 ('00000000-0000-0000-0000-000000001803','00000000-0000-0000-0000-000000002803','Admin only','active'),('00000000-0000-0000-0000-000000001804','00000000-0000-0000-0000-000000002804','Ordinary POS user','active'),
 ('00000000-0000-0000-0000-000000001810',null,'José Ramírez','active');
insert into pikas_private.platform_memberships(person_id,role_code) values
 ('00000000-0000-0000-0000-000000001801','platform_sandbox_operator'),('00000000-0000-0000-0000-000000001802','platform_sandbox_operator'),('00000000-0000-0000-0000-000000001803','platform_admin');
insert into public.accounts(id,code,name,tenant_kind) values
 ('00000000-0000-0000-0000-000000000081','STEP4-SANDBOX','Colegio Horizonte','sandbox'),('00000000-0000-0000-0000-000000000091','STEP4-TENANT','Ordinary school','customer');
insert into public.schools(id,account_id,code,name) values ('00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000082','Sandbox school'),('00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000091','T','Tenant school');
insert into public.school_locations(id,account_id,school_id,code,name) values
 ('00000000-0000-0000-0000-000000000083','00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000082','MAIN','Sandbox campus'),('00000000-0000-0000-0000-000000000093','00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000092','MAIN','Tenant campus');
insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name) values
 ('00000000-0000-0000-0000-000000000084','00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000083','CAF','Cafetería Escolar'),('00000000-0000-0000-0000-000000000085','00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000083','OTHER','Other sandbox cafeteria'),
 ('00000000-0000-0000-0000-000000000094','00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000093','CAF','Tenant cafeteria'),('00000000-0000-0000-0000-000000000095','00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000093','OTHER','Second tenant cafeteria');
insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values
 ('00000000-0000-0000-0000-000000004801','00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000084','00000000-0000-0000-0000-000000001810','pos_cashier'),('00000000-0000-0000-0000-000000004802','00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000085','00000000-0000-0000-0000-000000001810','pos_cashier'),
 ('00000000-0000-0000-0000-000000004803','00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000094','00000000-0000-0000-0000-000000001804','pos_cashier'),('00000000-0000-0000-0000-000000004804','00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000095','00000000-0000-0000-0000-000000001804','pos_supervisor');
insert into pikas_private.sandbox_pov_personas(id,account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id)
 values ('00000000-0000-0000-0000-000000008911','00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000084','cashier','00000000-0000-0000-0000-000000001810','00000000-0000-0000-0000-000000004801');

select ok(has_function_privilege('authenticated','public.get_pos_access_context()','EXECUTE')
 and not has_function_privilege('anon','public.get_pos_access_context()','EXECUTE')
 and not has_function_privilege('service_role','public.get_pos_access_context()','EXECUTE'),'Only authenticated clients may execute the RPC');
select ok((select provolatile='s' and prosecdef and pronargs=0 and proconfig=array['search_path=""']::text[]
 from pg_proc where oid='public.get_pos_access_context()'::regprocedure),'RPC is stable, security definer, empty search path and takes no authority arguments');
set local role anon;
select throws_ok($$select public.get_pos_access_context()$$,'42501',null,'Anonymous RPC access is denied');
reset role;
set local role service_role;
select throws_ok($$select public.get_pos_access_context()$$,'42501',null,'Service-role execution is not exposed');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select is(public.get_pos_access_context(),null::jsonb,'Missing Auth identity resolves no authority');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002803',true);
set local role authenticated;
select is(public.get_pos_access_context(),null::jsonb,'Platform admin alone is not POS authority');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002801',true);
set local role authenticated;
select is(public.get_pos_access_context(),null::jsonb,'Sandbox capability without active POV is not POS authority');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002804',true);
set local role authenticated;
select is(public.get_pos_access_context()->'actor',jsonb_build_object('person_id','00000000-0000-0000-0000-000000001804','display_name','Ordinary POS user'),'Ordinary tenant resolves its own Person');
select is(jsonb_array_length(public.get_pos_access_context()->'memberships'),2,'All active authorized tenant POS scopes resolve');
select is(public.get_pos_access_context()->'memberships'->0->>'membership_id','00000000-0000-0000-0000-000000004803','Cashier membership ID is authoritative');
select is(public.get_pos_access_context()->'memberships'->1->>'role_code','pos_supervisor','Ordinary supervisor remains supported');
select is(public.get_pos_access_context()->'pov','null'::jsonb,'Ordinary access has no POV');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002801',true);
set local role authenticated;
select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-000000009811','00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000084','cashier');
reset role;
create temp table expected_context as select public.get_pos_access_context() as data;
set local role authenticated;
select is(public.get_pos_access_context()->'actor',jsonb_build_object('person_id','00000000-0000-0000-0000-000000001810','display_name','José Ramírez'),'POV resolves José rather than its initiator');
select is(jsonb_array_length(public.get_pos_access_context()->'memberships'),1,'POV exposes only its registered exact-cafeteria membership');
select is(public.get_pos_access_context()->'memberships'->0,jsonb_build_object(
 'membership_id','00000000-0000-0000-0000-000000004801','role_code','pos_cashier','account_id','00000000-0000-0000-0000-000000000081','account_name','Colegio Horizonte','tenant_kind','sandbox',
 'school_id','00000000-0000-0000-0000-000000000082','school_location_id','00000000-0000-0000-0000-000000000083','cafeteria_id','00000000-0000-0000-0000-000000000084','cafeteria_name','Cafetería Escolar'),'Exact scope and all display labels come from the database');
select is(public.get_pos_access_context()->'pov'->>'pov_code','cashier','Active POV is specifically cashier');
select ok((public.get_pos_access_context()->'pov'->>'expires_at')::timestamptz>now(),'Active POV returns its expiry');
select is((select array_agg(key order by key) from jsonb_object_keys(public.get_pos_access_context()) key),array['actor','memberships','pov']::text[],'Return contract contains only actor, memberships and POV');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002802',true);
set local role authenticated;
select is(public.get_pos_access_context(),null::jsonb,'Another operator cannot read the first operators POV');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002801',true);

-- Each invalid-state fixture and read runs in a rolled-back subtransaction.
create function pg_temp.context_after(setup_sql text) returns jsonb language plpgsql as $$
declare result_value jsonb;
begin
 begin
  execute setup_sql;
  set local role authenticated;
  result_value:=public.get_pos_access_context();
  raise exception using errcode='Z0001',message='rollback_fixture';
 exception when sqlstate 'Z0001' then null;
 end;
 return result_value;
end $$;
select is(pg_temp.context_after($case$update public.persons set status='suspended' where id='00000000-0000-0000-0000-000000001810'$case$),null::jsonb,'Suspended persona Person fails closed');
select is(pg_temp.context_after($case$update public.persons set status='inactive' where id='00000000-0000-0000-0000-000000001801'$case$),null::jsonb,'Inactive initiator fails closed');
select is(pg_temp.context_after($case$update public.cafeteria_memberships set status='suspended' where id='00000000-0000-0000-0000-000000004801'$case$),null::jsonb,'Suspended persona membership fails closed');
select is(pg_temp.context_after($case$update pikas_private.platform_memberships set status='suspended' where person_id='00000000-0000-0000-0000-000000001801'$case$),null::jsonb,'Revoked platform capability fails closed');
select is(pg_temp.context_after($case$update pikas_private.sandbox_pov_personas set status='inactive' where id='00000000-0000-0000-0000-000000008911'$case$),null::jsonb,'Inactive persona registration fails closed');
select is(pg_temp.context_after($case$update public.accounts set status='suspended' where id='00000000-0000-0000-0000-000000000081'$case$),null::jsonb,'Inactive account fails closed');
select is(pg_temp.context_after($case$update public.schools set status='inactive' where id='00000000-0000-0000-0000-000000000082'$case$),null::jsonb,'Inactive school fails closed');
select is(pg_temp.context_after($case$update public.school_locations set status='inactive' where id='00000000-0000-0000-0000-000000000083'$case$),null::jsonb,'Inactive campus fails closed');
select is(pg_temp.context_after($case$update public.cafeterias set status='inactive' where id='00000000-0000-0000-0000-000000000084'$case$),null::jsonb,'Inactive cafeteria fails closed');
select is(pg_temp.context_after($case$set local session_replication_role=replica; update pikas_private.sandbox_pov_sessions set started_at=now()-interval '2 hours',expires_at=now()-interval '1 minute' where request_id='00000000-0000-0000-0000-000000009811'; set local session_replication_role=origin$case$),null::jsonb,'Expired POV fails closed');
select is(pg_temp.context_after($case$update pikas_private.sandbox_pov_sessions set status='exited',ended_at=now(),end_reason='exited' where request_id='00000000-0000-0000-0000-000000009811'$case$),null::jsonb,'Exited POV fails closed');
select is(pg_temp.context_after($case$set local session_replication_role=replica; update public.persons set auth_user_id='00000000-0000-0000-0000-000000002805' where id='00000000-0000-0000-0000-000000001810'; set local session_replication_role=origin$case$),null::jsonb,'Auth-linked persona fails closed');
select is(public.get_pos_access_context(),(select data from expected_context),'Invalid-state reads leave the original context unchanged');
-- A user with ordinary authority falls back to that authority after an invalid/expired POV.
insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code)
 values ('00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000094','00000000-0000-0000-0000-000000001801','pos_cashier');
select is(pg_temp.context_after($case$set local session_replication_role=replica;
 update pikas_private.sandbox_pov_sessions set started_at=now()-interval '2 hours',expires_at=now()-interval '1 minute' where request_id='00000000-0000-0000-0000-000000009811';
 set local session_replication_role=origin$case$)->'actor'->>'person_id','00000000-0000-0000-0000-000000001801','Expired POV preserves ordinary tenant identity fallback');
select is(jsonb_array_length(public.get_pos_access_context()->'memberships'),1,'Valid POV never merges the initiators tenant scopes');

create function pg_temp.snapshot() returns jsonb language plpgsql as $$
declare r record; rows_value jsonb; result_value jsonb:='{}'::jsonb;
begin
 for r in select schemaname,tablename from pg_tables where schemaname in ('public','pikas_private','auth') loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from %I.%I t',r.schemaname,r.tablename) into rows_value;
  result_value:=result_value||jsonb_build_object(r.schemaname||'.'||r.tablename,rows_value);
 end loop;
 return result_value;
end $$;
create temp table before_reads as select pg_temp.snapshot() as data;
set local role authenticated;
select lives_ok($$select public.get_pos_access_context()$$,'Bootstrap succeeds without catalog settings, register or assignment');
select lives_ok($$select public.get_pos_access_context()$$,'Repeated reads are safe');
reset role;
select is(pg_temp.snapshot(),(select data from before_reads),'RPC changes no identity, membership, authority, POV, audit or POS row');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002804',true);
select is(pg_temp.context_after($case$update public.persons set status='suspended' where id='00000000-0000-0000-0000-000000001804'$case$),null::jsonb,'Suspended ordinary Person fails closed');
select is(pg_temp.context_after($case$update public.cafeteria_memberships set status='inactive' where person_id='00000000-0000-0000-0000-000000001804'$case$),null::jsonb,'Inactive ordinary memberships fail closed');
select is(jsonb_array_length(pg_temp.context_after($case$update public.cafeterias set status='inactive' where id='00000000-0000-0000-0000-000000000094'$case$)->'memberships'),1,'An inactive scope does not remove another valid ordinary scope');
select * from finish();
rollback;
