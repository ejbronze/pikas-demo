-- Permission helper ACL hardening (202611180001). Rollback-only; fictional local fixtures only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
-- A NULL proacl means the PostgreSQL default, which includes PUBLIC EXECUTE.
create function pg_temp.public_execute(f regprocedure) returns boolean language sql as $$
 select p.proacl is null or exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')
 from pg_proc p where p.oid=f $$;

-- 1. Exactly one signature per helper, and none is executable by PUBLIC.
select is((select count(*) from pg_proc where pronamespace='pikas_private'::regnamespace and proname in ('has_capability','require_cafeteria_admin','sandbox_admin_has_capability')),3::bigint,'Each hardened helper has exactly one signature');
select ok(not pg_temp.public_execute('pikas_private.has_capability(text,uuid,uuid,uuid)'),'has_capability: no PUBLIC EXECUTE');
select ok(not pg_temp.public_execute('pikas_private.require_cafeteria_admin(uuid,boolean)'),'require_cafeteria_admin: no PUBLIC EXECUTE');
select ok(not pg_temp.public_execute('pikas_private.sandbox_admin_has_capability(text,text,uuid,uuid,uuid)'),'sandbox_admin_has_capability: no PUBLIC EXECUTE');

-- Intended authority model (matches the renamed *_tenant originals): has_capability for authenticated only, the other two owner-only.
select ok(has_function_privilege('authenticated','pikas_private.has_capability(text,uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','pikas_private.has_capability(text,uuid,uuid,uuid)','execute')
  and not has_function_privilege('service_role','pikas_private.has_capability(text,uuid,uuid,uuid)','execute'),'has_capability is executable by authenticated only');
select ok(not has_function_privilege('anon','pikas_private.require_cafeteria_admin(uuid,boolean)','execute')
  and not has_function_privilege('authenticated','pikas_private.require_cafeteria_admin(uuid,boolean)','execute')
  and not has_function_privilege('service_role','pikas_private.require_cafeteria_admin(uuid,boolean)','execute'),'require_cafeteria_admin is owner-only');
select ok(not has_function_privilege('anon','pikas_private.sandbox_admin_has_capability(text,text,uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','pikas_private.sandbox_admin_has_capability(text,text,uuid,uuid,uuid)','execute')
  and not has_function_privilege('service_role','pikas_private.sandbox_admin_has_capability(text,text,uuid,uuid,uuid)','execute'),'sandbox_admin_has_capability is owner-only');
select ok(not pg_temp.public_execute('pikas_private.has_capability_tenant(text,uuid,uuid,uuid)')
  and has_function_privilege('authenticated','pikas_private.has_capability_tenant(text,uuid,uuid,uuid)','execute')
  and not pg_temp.public_execute('pikas_private.require_cafeteria_admin_tenant(uuid,boolean)')
  and not pg_temp.public_execute('pikas_private.sandbox_admin_has_capability_tenant(text,text,uuid,uuid,uuid)'),'The *_tenant originals keep their unchanged ACLs');
select ok(not has_schema_privilege('anon','pikas_private','usage') and has_schema_privilege('authenticated','pikas_private','usage'),'Private schema usage is unchanged');
select is((select count(*) from pg_policies where coalesce(qual,'')||coalesce(with_check,'') ~ '(has_capability|require_cafeteria_admin|sandbox_admin_has_capability)\('),0::bigint,'No RLS policy depends on the hardened wrappers');

-- 2. Anonymous callers cannot reach the helpers.
set local role anon;
select throws_ok($$select pikas_private.has_capability('school:read','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011')$$,'42501',null,'Anonymous cannot call has_capability');
select throws_ok($$select pikas_private.require_cafeteria_admin('00000000-0000-0000-0000-000000000111',false)$$,'42501',null,'Anonymous cannot call require_cafeteria_admin');
select throws_ok($$select pikas_private.sandbox_admin_has_capability('school_admin','school:wallets:read','03e71159-69e9-4387-9b3b-65799d49faf0')$$,'42501',null,'Anonymous cannot call sandbox_admin_has_capability');
reset role;

-- 3. Legitimate released callers keep working.
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select lives_ok($$select pikas_private.has_capability('cafeteria:read','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111')$$,'Authenticated keeps the foundation has_capability contract');
select throws_ok($$select pikas_private.require_cafeteria_admin('00000000-0000-0000-0000-000000000111',false)$$,'42501',null,'Authenticated cannot call require_cafeteria_admin directly');
select throws_ok($$select pikas_private.sandbox_admin_has_capability('school_admin','school:wallets:read','03e71159-69e9-4387-9b3b-65799d49faf0')$$,'42501',null,'Authenticated cannot call sandbox_admin_has_capability directly');
select lives_ok($$select public.get_cafeteria_open_register_sessions('00000000-0000-0000-0000-000000000111')$$,'Definer RPC using has_capability still works for the Cafeteria Admin');
select lives_ok($$select public.cafeteria_wallet_read('00000000-0000-0000-0000-000000000111','')$$,'Definer RPC using require_cafeteria_admin still works for the Cafeteria Admin');
reset role;
select set_config('t.sandbox_school',(select school_id::text from pikas_private.sandbox_pov_personas where pov_code='school_admin' and account_id='03e71159-69e9-4387-9b3b-65799d49faf0' limit 1),true);
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select platform_enter_sandbox_pov(gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe','school_admin');
select is(school_wallet_access(current_setting('t.sandbox_school')::uuid)->>'read','true','Definer RPC using sandbox_admin_has_capability still grants the Demo read');
select is(school_wallet_access(current_setting('t.sandbox_school')::uuid)->>'replenish','false','…and still refuses the Demo write');
reset role;

-- 202611240003: no private function keeps PUBLIC EXECUTE; trigger functions need no client grant; the persons RLS helper
-- stays executable by authenticated (its only policy role) and nothing else.
select is((select count(*) from pg_proc p where p.pronamespace='pikas_private'::regnamespace and pg_temp.public_execute(p.oid::regprocedure)),0::bigint,'No pikas_private function is executable by PUBLIC');
select is((select count(*) from pg_proc p where p.oid in ('pikas_private.guard_phase2_identity()'::regprocedure,'pikas_private.guard_student_enrollment_period()'::regprocedure,
 'pikas_private.guard_student_lifecycle()'::regprocedure,'pikas_private.guard_student_placement_period()'::regprocedure,'pikas_private.audit_phase2_change()'::regprocedure)
 and exists(select 1 from aclexplode(p.proacl) a where a.grantee<>p.proowner)),0::bigint,'Phase 2 trigger functions: owner only');
select ok(has_function_privilege('authenticated','pikas_private.can_read_school_person(uuid)','execute') and not has_function_privilege('anon','pikas_private.can_read_school_person(uuid)','execute')
 and not has_function_privilege('service_role','pikas_private.can_read_school_person(uuid)','execute'),'can_read_school_person: authenticated only (persons RLS policy)');
select * from finish();
rollback;
