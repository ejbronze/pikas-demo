-- PIKAS UX 11: real Platform mutation RPCs refuse a CURRENT Demo POV at the database (202611130001).
-- Fictional local fixtures; everything rolls back. Sandbox Demo: Colegio Horizonte / Cafetería Escolar.
-- Operators: A and B (platform_admin + Demo access), T (tenant Cafetería Admin 2003, never holds a POV).
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
create function pg_temp.sp(sql text) returns text language plpgsql as $$begin return pg_temp.attempt(sql); end$$;
reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 select ('00000000-0000-0000-0000-00000000bd1'||n)::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ux11m.op'||n||'@example.invalid','',now(),now(),now(),'{}','{}' from unnest(array['1','2']) n;
insert into persons(id,auth_user_id,display_name) select ('00000000-0000-0000-0000-00000000be1'||n)::uuid,('00000000-0000-0000-0000-00000000bd1'||n)::uuid,'Operador UX11M '||n from unnest(array['1','2']) n;
insert into pikas_private.platform_memberships(person_id,role_code) values
 ('00000000-0000-0000-0000-00000000be11','platform_admin'),('00000000-0000-0000-0000-00000000be11','platform_sandbox_operator'),('00000000-0000-0000-0000-00000000be12','platform_sandbox_operator'),('00000000-0000-0000-0000-00000000be12','platform_admin');
select set_config('t.acct',(select id::text from accounts where tenant_kind='sandbox' limit 1),true);
select set_config('t.caf',(select c.id::text from cafeterias c join accounts a on a.id=c.account_id where a.tenant_kind='sandbox' limit 1),true);
select set_config('t.cashier',(select p.id::text from persons p where p.auth_user_id='00000000-0000-0000-0000-000000002008'),true);

-- The guard itself and its coverage.
select ok(not has_function_privilege('authenticated','pikas_private.require_no_current_demo()','execute'),'The shared guard is not client-callable');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosrc ~ 'require_no_current_demo'),26::bigint,'26 real mutation RPCs carry the shared guard (Lifecycle: none; Demo Lab: platform_reset_sandbox; FIN 4: cafeteria_wallet_collect_cash)');
select ok((select prosrc ~ 'require_no_current_demo' from pg_proc where proname='cafeteria_wallet_collect_cash'),'FIN 4 cash collection refuses an active Demo');
select is((select string_agg(p.proname,',' order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname='public' and (p.proname like 'platform\_%' or p.proname like 'identity\_%') and has_function_privilege('authenticated',p.oid,'execute') and p.provolatile='v'
  and p.prosrc ~* '(insert into|update [a-z_.]+ set|delete from)'
  and p.prosrc !~ 'require_no_current_demo|sandbox_pov_current_attempt|sandbox_validated_pov|require_customer_operations_scope|begin_customer_operations_scope|require_customer_provisioning'),
 'identity_complete_password_change,platform_enter_sandbox_pov,platform_exit_sandbox_pov','The only unguarded writers are the Demo controls and the caller''s own password change');

-- Real mutations as A with no POV: the representative command of each family runs (authority permitting).
select pg_temp.as_operator('00000000-0000-0000-0000-00000000bd11');
select set_config('t.team',pg_temp.attempt($$select platform_team_command(gen_random_uuid(),'prepare',jsonb_build_object('name','Persona Ficticia UX11M','email','ux11m.team@example.invalid','demo',false))$$),true);
select is(current_setting('t.team'),'ok','1. No POV: team prepare runs');
select set_config('t.onb',(platform_onboard_school(gen_random_uuid(),'Colegio Ficticio UX11M','131555555','Calle Ficticia 1','DO','DO-25'))::text,true);
select set_config('t.real',current_setting('t.onb')::jsonb->>'account_id',true);
-- Structure ids are read as the owner: RLS hides them from the operator role.
reset role;
select set_config('t.cafid',(select id::text from cafeterias where account_id=current_setting('t.real')::uuid limit 1),true);
select set_config('t.cafname',(select name from cafeterias where account_id=current_setting('t.real')::uuid limit 1),true);
select set_config('t.sch',(select id::text from schools where account_id=current_setting('t.real')::uuid limit 1),true);
select pg_temp.as_operator('00000000-0000-0000-0000-00000000bd11');
select is(pg_temp.attempt(format($$select platform_rename_customer_structure(gen_random_uuid(),%L,'cafeteria',%L::uuid,%L,'Renombrada UX11M')$$,current_setting('t.real'),current_setting('t.cafid'),current_setting('t.cafname'))),'ok','1. No POV: structure rename runs');
select ok(pg_temp.attempt(format($$select identity_set_username(%L,'ux11m.cajero',coalesce((select version from pikas_private.login_identities where person_id=%L),0))$$,current_setting('t.cashier'),current_setting('t.cashier'))) !~ 'demo_mode_active','1. No POV: identity support reaches the identity logic (never a Demo refusal)');

-- 2. Current POV (A enters the Demo): every family is refused before any write.
select set_config('t.s1',(platform_enter_sandbox_pov(gen_random_uuid(),current_setting('t.acct')::uuid,current_setting('t.caf')::uuid,'cafeteria_admin')->>'session_id'),true);
reset role; select set_config('t.w0',(select (select count(*) from pikas_private.platform_customer_admin_intents)||'/'||(select count(*) from accounts)||'/'||(select count(*) from cafeterias where name like 'Renombrada%')||'/'||(select count(*) from pikas_private.platform_requests)||'/'||(select count(*) from pikas_private.identity_audit_events)||'/'||(select count(*) from pikas_private.login_identities)),true);
select pg_temp.as_operator('00000000-0000-0000-0000-00000000bd11');
select is(pg_temp.attempt($$select platform_team_command(gen_random_uuid(),'prepare',jsonb_build_object('name','Otra Persona','email','ux11m.team2@example.invalid','demo',false))$$),'42501:demo_mode_active','2. Current POV: team command refused');
select is(pg_temp.attempt($$select platform_onboard_school(gen_random_uuid(),'Colegio Ficticio UX11M Dos','131555555','Calle Ficticia 2','DO','DO-25')$$),'42501:demo_mode_active','2. Current POV: onboarding refused');
select is(pg_temp.attempt(format($$select platform_prepare_customer_admin_named(gen_random_uuid(),%L,'account',null,null,'account_admin','ux11m.admin@example.invalid',clock_timestamp()+interval '7 days','ux11m.admin','Admin Ficticio')$$,current_setting('t.real'))),'42501:demo_mode_active','2. Current POV: customer admin provisioning refused');
select is(pg_temp.attempt(format($$select platform_update_colegio_profile(gen_random_uuid(),%L,%L::uuid,'{}'::jsonb,'Colegio Ficticio UX11M','131555555','Calle Ficticia 1','DO','DO-25')$$,current_setting('t.real'),current_setting('t.sch'))),'42501:demo_mode_active','2. Current POV: profile update refused');
select is(pg_temp.attempt(format($$select platform_rename_customer_structure(gen_random_uuid(),%L,'cafeteria',%L::uuid,'Renombrada UX11M','Otra vez')$$,current_setting('t.real'),current_setting('t.cafid'))),'42501:demo_mode_active','2. Current POV: structure rename refused');
select is(pg_temp.attempt(format($$select platform_add_school_location(gen_random_uuid(),%L,%L::uuid,'SEDE-02','Sede Ficticia','CAF-02','Cafetería Ficticia')$$,current_setting('t.real'),current_setting('t.sch'))),'42501:demo_mode_active','2. Current POV: add location refused');
select is(pg_temp.attempt($$select platform_prepare_activation('a'||repeat('b',31))$$),'42501:demo_mode_active','2. Current POV: team activation refused');
select is(pg_temp.attempt(format($$select platform_prepare_customer_activation(%L)$$,gen_random_uuid())),'42501:demo_mode_active','2. Current POV: customer activation refused');
select is(pg_temp.attempt(format($$select identity_set_username(%L,'ux11m.cajero2',1)$$,current_setting('t.cashier'))),'42501:demo_mode_active','2. Current POV: identity username change refused');
select is(pg_temp.attempt(format($$select identity_begin_temporary_access(%L)$$,current_setting('t.cashier'))),'42501:demo_mode_active','2. Current POV: temporary access refused');
select is(pg_temp.attempt(format($$select identity_set_login_suspended(%L,true,'Motivo ficticio')$$,current_setting('t.cashier'))),'42501:demo_mode_active','2. Current POV: suspension refused');
select is(pg_temp.attempt(format($$select identity_begin_email_change(%L,'nuevo@example.invalid','Motivo ficticio')$$,current_setting('t.cashier'))),'42501:demo_mode_active','2. Current POV: email change refused');
-- Demo controls and reads keep working under the current POV.
select is(platform_get_active_sandbox_pov()->>'session_id',current_setting('t.s1'),'Demo read still resolves under the POV');
select is(pg_temp.attempt($$select platform_list_customers('',null,null,null,5)$$),'ok','Platform reads are not touched by the guard');
select is(pg_temp.attempt(format($$select platform_enter_sandbox_pov(gen_random_uuid(),%L,%L,'school_admin')$$,current_setting('t.acct'),current_setting('t.caf'))),'ok','Switching experience keeps working');
reset role;
select is((select (select count(*) from pikas_private.platform_customer_admin_intents)||'/'||(select count(*) from accounts)||'/'||(select count(*) from cafeterias where name like 'Renombrada%')||'/'||(select count(*) from pikas_private.platform_requests where operation not like 'sandbox_pov%')||'/'||(select count(*) from pikas_private.identity_audit_events)||'/'||(select count(*) from pikas_private.login_identities)),
 (select split_part(current_setting('t.w0'),'/',1)||'/'||split_part(current_setting('t.w0'),'/',2)||'/'||split_part(current_setting('t.w0'),'/',3)||'/'||(select count(*) from pikas_private.platform_requests where operation not like 'sandbox_pov%')||'/'||split_part(current_setting('t.w0'),'/',5)||'/'||split_part(current_setting('t.w0'),'/',6)),
 '6. Refused calls wrote nothing (intents, accounts, renames, requests, identity audit, identities)');

-- 5. Another operator's POV has no effect: B holds a current POV while A has none.
select pg_temp.as_operator('00000000-0000-0000-0000-00000000bd11'); select platform_exit_sandbox_pov(gen_random_uuid());
select pg_temp.as_operator('00000000-0000-0000-0000-00000000bd12'); select platform_enter_sandbox_pov(gen_random_uuid(),current_setting('t.acct')::uuid,current_setting('t.caf')::uuid,'cashier');
select pg_temp.as_operator('00000000-0000-0000-0000-00000000bd11');
select is(pg_temp.attempt(format($$select platform_rename_customer_structure(gen_random_uuid(),%L,'cafeteria',%L::uuid,'Renombrada UX11M','Renombrada UX11M B')$$,current_setting('t.real'),current_setting('t.cafid'))),'ok','5. Another operator''s current POV does not block A');
-- 4. Exited POV (A exited above): A mutates normally.
select is(pg_temp.attempt(format($$select platform_add_school_location(gen_random_uuid(),%L,%L::uuid,'SEDE-02','Sede Ficticia UX11M','CAF-02','Cafetería Ficticia UX11M')$$,current_setting('t.real'),current_setting('t.sch'))),'ok','4. Exited POV: mutation works again');
-- 3. Expired POV: an identical session whose time has passed (sessions are immutable, so a direct insert).
reset role;
insert into pikas_private.sandbox_pov_sessions(id,request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,persona_school_membership_id,status,started_at,expires_at)
 select gen_random_uuid(),gen_random_uuid(),initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,persona_school_membership_id,'active',clock_timestamp()-interval '5 hours',clock_timestamp()-interval '1 hour'
 from pikas_private.sandbox_pov_sessions where id=current_setting('t.s1')::uuid;
select pg_temp.as_operator('00000000-0000-0000-0000-00000000bd11');
select is(pg_temp.attempt(format($$select platform_rename_customer_structure(gen_random_uuid(),%L,'cafeteria',%L::uuid,'Renombrada UX11M B','Renombrada UX11M C')$$,current_setting('t.real'),current_setting('t.cafid'))),'ok','3. Expired POV never blocks');
-- Tenant users are never affected: a Cafetería Admin's own staff support runs while Demo operators hold POVs.
select pg_temp.as_operator('00000000-0000-0000-0000-000000002003');
select ok(pg_temp.attempt(format($$select identity_set_username(%L,'ux11m.cajero3',(select version from pikas_private.login_identities where person_id=%L))$$,current_setting('t.cashier'),current_setting('t.cashier'))) !~ 'demo_mode_active','Tenant identity support never meets the Demo guard');
-- 7. Customer Operations, lifecycle and finance keep their own, unchanged guards.
select pg_temp.as_operator('00000000-0000-0000-0000-00000000bd12');
select is(pg_temp.attempt(format($$select platform_customer_operations_overview(%L)$$,current_setting('t.real'))),'42501:customer_operations_authority_required','7. Customer Operations guard unchanged (its own message)');
select is((select (p.prosrc ~ 'sandbox_validated_pov') and (p.prosrc !~ 'require_no_current_demo') from pg_proc p where proname='platform_set_customer_lifecycle'),true,'7. Lifecycle keeps its original guard, untouched');
select is((select bool_and(p.prosrc ~ 'sandbox_pov_current_attempt' and p.prosrc !~ 'require_no_current_demo') from pg_proc p where proname in ('platform_finance_decide_bank_replenishment','platform_finance_reverse_replenishment','platform_finance_fund_wallet_adjustment')),true,'7. Finance guards untouched');

select * from finish();
rollback;
