-- PIKAS UX 11: the server resolves the CURRENT Demo POV of the signed-in operator only. Fictional local
-- fixtures; everything rolls back. Sandbox tenant: Colegio Horizonte / Cafetería Escolar with its personas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.as_operator(u text) returns void language plpgsql as $$declare sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; s text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text, s=returned_sqlstate; return s||':'||m; end$$;
-- Two fictional operators with Demo access (A, B) and one with none (C).
reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 select ('00000000-0000-0000-0000-00000000ad1'||n)::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ux11.op'||n||'@example.invalid','',now(),now(),now(),'{}','{}' from unnest(array['1','2','3']) n;
insert into persons(id,auth_user_id,display_name) select ('00000000-0000-0000-0000-00000000ae1'||n)::uuid,('00000000-0000-0000-0000-00000000ad1'||n)::uuid,'Operador UX11 '||n from unnest(array['1','2','3']) n;
insert into pikas_private.platform_memberships(person_id,role_code) values
 ('00000000-0000-0000-0000-00000000ae11','platform_sandbox_operator'),('00000000-0000-0000-0000-00000000ae12','platform_sandbox_operator'),('00000000-0000-0000-0000-00000000ae13','platform_admin');
select set_config('t.acct',(select id::text from accounts where tenant_kind='sandbox' limit 1),true);
select set_config('t.caf',(select c.id::text from cafeterias c join accounts a on a.id=c.account_id where a.tenant_kind='sandbox' limit 1),true);

-- 1. No current POV → nothing to resolve.
select pg_temp.as_operator('00000000-0000-0000-0000-00000000ad11');
select is(platform_get_active_sandbox_pov(),null,'1. No current POV: the resolver returns null');
-- 2. Current POV → resolved, with the context the shell presents.
select set_config('t.s1',(platform_enter_sandbox_pov(gen_random_uuid(),current_setting('t.acct')::uuid,current_setting('t.caf')::uuid,'cafeteria_admin')->>'session_id'),true);
select is(platform_get_active_sandbox_pov()->>'session_id',current_setting('t.s1'),'2. Current POV: resolved for its operator');
select ok((platform_get_active_sandbox_pov()) ?& array['account_name','cafeteria_name','pov_code','persona_display_name','expires_at'],'2. The resolver carries account, cafetería, experience and persona');
-- 5. Demo state belongs to the operator who entered it: another Demo operator and a Platform Admin see none.
select pg_temp.as_operator('00000000-0000-0000-0000-00000000ad12');
select is(platform_get_active_sandbox_pov(),null,'5. Another Demo operator has no current POV');
select pg_temp.as_operator('00000000-0000-0000-0000-00000000ad13');
select is(pg_temp.attempt($$select platform_get_active_sandbox_pov()$$),'42501:not_authorized','5. Without Demo access the resolver refuses (never leaks a session)');
-- 3. Expired POV → none, while the fail-closed tenant guard still sees the history. Sessions are
-- immutable, so the expired one is a direct insert of an identical session whose time has passed.
select pg_temp.as_operator('00000000-0000-0000-0000-00000000ad11');
select platform_exit_sandbox_pov(gen_random_uuid());
reset role;
insert into pikas_private.sandbox_pov_sessions(id,request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,persona_school_membership_id,status,started_at,expires_at)
 select gen_random_uuid(),gen_random_uuid(),initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,persona_school_membership_id,'active',clock_timestamp()-interval '5 hours',clock_timestamp()-interval '1 hour'
 from pikas_private.sandbox_pov_sessions where id=current_setting('t.s1')::uuid;
select pg_temp.as_operator('00000000-0000-0000-0000-00000000ad11');
select is(platform_get_active_sandbox_pov(),null,'3. Expired POV: resolver returns null (normal Platform mode)');
-- The private predicates are owner-only; the JWT claim set above stays for the transaction.
reset role;
select is(pikas_private.sandbox_pov_current_attempt(),false,'3. Expired POV does not count as a current Demo attempt');
select is(pikas_private.sandbox_pov_active_attempt(),true,'3. The fail-closed tenant guard still sees the history (unchanged)');
-- A real customer-operations read is not blocked by expired history.
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-00000000ae11','platform_admin');
select pg_temp.as_operator('00000000-0000-0000-0000-00000000ad11');
select is(pg_temp.attempt(format($$select platform_customer_operations_overview(%L)$$,'00000000-0000-0000-0000-000000000001')),'ok','3. Expired Demo history never blocks real customer operations');
-- 2b. A current POV blocks real customer operations at the database (the conflict the UI must explain).
select set_config('t.s2',(platform_enter_sandbox_pov(gen_random_uuid(),current_setting('t.acct')::uuid,current_setting('t.caf')::uuid,'school_admin')->>'session_id'),true);
select is(pg_temp.attempt(format($$select platform_customer_operations_overview(%L)$$,'00000000-0000-0000-0000-000000000001')),'42501:customer_operations_authority_required','2. Current POV: real customer operations refused by the database');
select is(platform_get_active_sandbox_pov()->>'pov_code','school_admin','Switching supersedes the previous session: the current one is resolved');
-- 4. Exited POV → none; real operations resume.
select platform_exit_sandbox_pov(gen_random_uuid());
select is(platform_get_active_sandbox_pov(),null,'4. Exited POV: resolver returns null');
select is(pg_temp.attempt(format($$select platform_customer_operations_overview(%L)$$,'00000000-0000-0000-0000-000000000001')),'ok','4. After exit, real customer operations work again');
select is(pg_temp.attempt($$select platform_exit_sandbox_pov(gen_random_uuid())$$),'23514:sandbox_pov_not_active','Exit is not repeatable once nothing is active (the API treats this as already exited)');

select * from finish();
rollback;
