-- Phase 6A identity, credentials and support (202610260001). Fictional local fixtures; rolled back.
-- Persons: 1001/2001 Account Admin (account 1); 1002/2002 School Admin 11; 1005/2005 School Admin 11+12;
-- 1003/2003 Cafeteria Admin 111; 1004/2004 Cafeteria Admin 112; 1011/2011 Cafeteria Admin + POS Supervisor 111;
-- 1008/2008 cashier 111 + POS Supervisor 112. Test-only: a POS-only cashier of 111 (Auth 2101 / Person 7101).
begin;
-- Transactional Platform Admin fixture (fictional; rolled back with the test). The canonical local DB has no platform_admin.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('7a000000-0000-4000-8000-00000000ad01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tx-platform-admin@example.invalid','',now(),now(),now(),'{}','{}');
insert into public.persons(id,auth_user_id,display_name) values('7a000000-0000-4000-8000-00000000ad02','7a000000-0000-4000-8000-00000000ad01','Platform Admin de prueba');
insert into pikas_private.platform_memberships(person_id,role_code) values('7a000000-0000-4000-8000-00000000ad02','platform_admin');

create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.ver(p uuid) returns bigint language sql security definer set search_path=public as $$select coalesce((select version from pikas_private.login_identities where person_id=p),1)$$;
create function pg_temp.me() returns uuid language sql as $$select pikas_private.current_person_id()$$;
reset role; select set_config('t.platform','7a000000-0000-4000-8000-00000000ad01',true);
select set_config('t.platform_person',(select id::text from persons where auth_user_id=current_setting('t.platform')::uuid),true);

-- Test-only POS cashier of cafeteria 111 (fictional), with a password hash.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-000000002101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cajera.6a@example.invalid',
  extensions.crypt('original-password',extensions.gen_salt('bf')),now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-000000007101','00000000-0000-0000-0000-000000002101','Cajera Ficticia 6A');
insert into cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000007101','pos_cashier','active');
select set_config('t.cashier','00000000-0000-0000-0000-000000007101',true);
select set_config('t.memberships',(select count(*)::text from cafeteria_memberships where person_id=current_setting('t.cashier')::uuid),true);
select set_config('t.platform_memberships',(select concat_ws('/',(select count(*) from account_memberships where person_id=current_setting('t.platform_person')::uuid),
 (select count(*) from school_memberships where person_id=current_setting('t.platform_person')::uuid),(select count(*) from cafeteria_memberships where person_id=current_setting('t.platform_person')::uuid))),true);

-- Privileges and storage
select ok(not has_function_privilege('anon','login_identifier_email(text)','execute') and not has_function_privilege('authenticated','login_identifier_email(text)','execute')
 and has_function_privilege('service_role','login_identifier_email(text)','execute'),'Username→email resolution is service-role only (no client enumeration endpoint)');
select ok(not has_function_privilege('anon','identity_support_lookup(text)','execute'),'No anonymous identity lookup');
select ok(not has_table_privilege('authenticated','pikas_private.login_identities','select') and not has_table_privilege('authenticated','pikas_private.identity_audit_events','select'),'Credential and audit tables are not client-readable');
select ok(exists(select 1 from pikas_private.platform_role_capabilities where role_code='platform_admin' and capability='platform:identity:support'),'Narrow platform:identity:support capability granted to platform_admin');

-- Normalization
select is(pikas_private.normalize_username('  Jeanne.Cepoint '),'jeanne.cepoint','Normalized to trimmed lowercase');
select ok(pikas_private.valid_username('jeanne.cepoint') and pikas_private.valid_username('demo_pos-1') and pikas_private.valid_username('abc'),'Valid usernames accepted');
select ok(not pikas_private.valid_username('ab') and not pikas_private.valid_username('.abc') and not pikas_private.valid_username('abc.') and not pikas_private.valid_username('a..bc')
 and not pikas_private.valid_username('a@b.com') and not pikas_private.valid_username('ABC') and not pikas_private.valid_username('a b c') and not pikas_private.valid_username(repeat('a',41)),'Malformed, separator-only, email-like, uppercase raw and too long rejected');

-- Platform support: username
select pg_temp.as_user(current_setting('t.platform'));
select is(identity_support_read(current_setting('t.cashier')::uuid)->>'support_scope','platform','Platform operator holds identity-support scope');
select is(identity_set_username(current_setting('t.cashier')::uuid,'  Cajera.6A ',pg_temp.ver(current_setting('t.cashier')::uuid))->>'username','cajera.6a','Username set and normalized');
select is(identity_support_lookup('CAJERA.6A')->'result'->>'person_id',current_setting('t.cashier'),'Lookup by username is case-insensitive');
select is(identity_support_lookup('Cajera.6A@Example.Invalid')->'result'->>'person_id',current_setting('t.cashier'),'Lookup by email resolves the same Person');
select is(identity_support_lookup('nadie.6a')->'result','null'::jsonb,'Unknown identifier returns no result');
select is(identity_support_read('00000000-0000-0000-0000-000000001008')->>'version','1','A target without a credential row reports the initial version');
select is(pg_temp.attempt($$select identity_set_username('00000000-0000-0000-0000-000000001008','cajera.6a',1)$$),'23505:username_unavailable','Duplicate username rejected');
select is(pg_temp.attempt($$select identity_set_username('00000000-0000-0000-0000-000000001008','CAJERA.6A',1)$$),'23505:username_unavailable','Case collision rejected');
select is(pg_temp.attempt($$select identity_set_username('00000000-0000-0000-0000-000000001008','a..b',1)$$),'22023:invalid_username','Malformed username rejected');
select is(pg_temp.attempt($$select identity_set_username('00000000-0000-0000-0000-000000001008','x@y.com',1)$$),'22023:invalid_username','Email-shaped username rejected');
select is(pg_temp.attempt(format('select identity_set_username(%L,%L,1)',current_setting('t.cashier'),'otra.6a')),'40001:identity_version_changed','Stale version rejected');
reset role; insert into pikas_private.reserved_usernames(username) values('soporte'); select pg_temp.as_user(current_setting('t.platform'));
select is(pg_temp.attempt($$select identity_set_username('00000000-0000-0000-0000-000000001008','soporte',1)$$),'22023:username_reserved','Reserved usernames can be introduced without code');
select is(pg_temp.attempt(format('select identity_support_read(%L)',current_setting('t.platform_person'))),'42501:identity_support_required','Platform identities are never support targets');
reset role;
select is((select username from pikas_private.login_identities where person_id=current_setting('t.cashier')::uuid),'cajera.6a','One username row for the Person');
set local role service_role;
select is(login_identifier_email('Cajera.6A'),'cajera.6a@example.invalid','Server-side resolution: username → the same Auth email');
select is(login_identifier_email('nadie.6a'),null,'Unknown username resolves to nothing (route answers generically)');
reset role;

-- Platform support never grants tenant authority
select is(concat_ws('/',(select count(*) from account_memberships where person_id=current_setting('t.platform_person')::uuid),
 (select count(*) from school_memberships where person_id=current_setting('t.platform_person')::uuid),(select count(*) from cafeteria_memberships where person_id=current_setting('t.platform_person')::uuid)),
 current_setting('t.platform_memberships'),'Support actions created no membership for the Platform operator');
select pg_temp.as_user(current_setting('t.platform'));
select alike(pg_temp.attempt($$select cafeteria_admin_read('00000000-0000-0000-0000-000000000111')$$),'42501:%','Support capability does not open tenant cafeteria data');
select alike(pg_temp.attempt($$select cafeteria_operations_read('00000000-0000-0000-0000-000000000111','transactions',0,null)$$),'42501:%','Support capability does not open tenant financial history');

-- Tenant scope (every held membership of the target must be managed by the actor)
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(identity_support_read(current_setting('t.cashier')::uuid)->>'support_scope','tenant','Cafeteria Admin 111 may support a POS-only member of 111');
select is(identity_set_username(current_setting('t.cashier')::uuid,'cajera.santiago',pg_temp.ver(current_setting('t.cashier')::uuid))->>'username','cajera.santiago','Tenant-scoped username change');
select is(pg_temp.attempt($$select identity_support_read('00000000-0000-0000-0000-000000001008')$$),'42501:identity_support_required','Cafeteria Admin 111 denied for a person also holding a role in cafeteria 112');
select is(pg_temp.attempt($$select identity_support_read('00000000-0000-0000-0000-000000001011')$$),'42501:identity_support_required','Cafeteria Admin denied for a peer Cafeteria Admin');
select is(pg_temp.attempt($$select identity_support_read('00000000-0000-0000-0000-000000001002')$$),'42501:identity_support_required','Cafeteria Admin cannot reach a School Admin');
select is(pg_temp.attempt(format('select identity_begin_email_change(%L,%L,%L)',current_setting('t.cashier'),'otro.6a@example.invalid','Corrección')),'42501:identity_support_required','Email correction is Platform-only');
select is(pg_temp.attempt(format('select identity_set_login_suspended(%L,true,%L)',current_setting('t.cashier'),'Prueba')),'42501:identity_support_required','Login suspension is Platform-only');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select is(pg_temp.attempt(format('select identity_support_read(%L)',current_setting('t.cashier'))),'42501:identity_support_required','Cafeteria Admin 112 cannot reach a member of 111');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt($$select identity_support_read('00000000-0000-0000-0000-000000001008')$$),'42501:identity_support_required','School Admin 11 denied: the target also holds a role in school 12');
select is(identity_support_read(current_setting('t.cashier')::uuid)->>'support_scope','tenant','School Admin 11 may support a member of a school-11 cafeteria');
select pg_temp.as_user('00000000-0000-0000-0000-000000002005');
select is(identity_support_read('00000000-0000-0000-0000-000000001008')->>'support_scope','tenant','School Admin of 11+12 may support the cross-school member');
select is(pg_temp.attempt($$select identity_support_read('00000000-0000-0000-0000-000000001002')$$),'42501:identity_support_required','School Admin cannot reach a peer School Admin');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select is(identity_support_read('00000000-0000-0000-0000-000000001002')->>'support_scope','tenant','Account Admin may support a School Admin of its account');
select is(pg_temp.attempt($$select identity_support_read('00000000-0000-0000-0000-000000001001')$$),'42501:identity_support_required','Nobody tenant-side supports themselves or Account Admins');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select is(pg_temp.attempt(format('select identity_support_read(%L)',current_setting('t.cashier'))),'42501:identity_support_required','A cashier holds no support scope');
reset role;

-- Temporary access + forced password change (same Person throughout)
select pg_temp.as_user('00000000-0000-0000-0000-000000002101');
select is(pg_temp.me()::text,current_setting('t.cashier'),'Before: the cashier resolves to their Person');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt(format('select identity_finish_temporary_access(%L)',current_setting('t.cashier'))),'40001:temporary_access_not_pending','Finish without begin rejected');
select ok((identity_begin_temporary_access(current_setting('t.cashier')::uuid)->>'auth_user_id')='00000000-0000-0000-0000-000000002101','Begin returns the SAME Auth user (no new identity)');
select pg_temp.as_user('00000000-0000-0000-0000-000000002101');
select is(pg_temp.me(),null,'While a temporary password is pending the Person holds no PIKAS authority (fail closed)');
select is(identity_credential_state()->>'must_change_password','true','Self state reports the forced change');
reset role; update auth.users set encrypted_password=extensions.crypt('temporary-password',extensions.gen_salt('bf')) where id='00000000-0000-0000-0000-000000002101';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(identity_finish_temporary_access(current_setting('t.cashier')::uuid)->>'must_change_password','true','Finish records the baseline; change still required');
select pg_temp.as_user('00000000-0000-0000-0000-000000002101');
select is(pg_temp.attempt('select identity_complete_password_change()'),'22023:password_change_required','Keeping the temporary password does not complete the change');
reset role; update auth.users set encrypted_password=extensions.crypt('chosen-by-user',extensions.gen_salt('bf')) where id='00000000-0000-0000-0000-000000002101';
select pg_temp.as_user('00000000-0000-0000-0000-000000002101');
select is(identity_complete_password_change()->>'must_change_password','false','A new password completes the forced change');
select is(pg_temp.me()::text,current_setting('t.cashier'),'After: the SAME Person regains authority');
reset role;
select is((select count(*)::text from cafeteria_memberships where person_id=current_setting('t.cashier')::uuid),current_setting('t.memberships'),'Memberships unchanged by credential work');
select is((select count(*) from persons where auth_user_id='00000000-0000-0000-0000-000000002101'),1::bigint,'Still exactly one Person for the Auth user');

-- Email correction (Platform; same Auth user, same Person)
select set_config('t.other_email',(select email from auth.users where id='00000000-0000-0000-0000-000000002008'),true);
select pg_temp.as_user(current_setting('t.platform'));
select is(pg_temp.attempt(format('select identity_begin_email_change(%L,%L,%L)',current_setting('t.cashier'),current_setting('t.other_email'),'Prueba')),'23505:email_unavailable','Another user''s email cannot be taken');
select is(pg_temp.attempt(format('select identity_begin_email_change(%L,%L,%L)',current_setting('t.cashier'),'no-es-correo','Prueba')),'22023:invalid_email','Malformed email rejected');
select is(pg_temp.attempt(format('select identity_begin_email_change(%L,%L,%L)',current_setting('t.cashier'),'nuevo.6a@example.invalid','')),'22023:reason_required','Email correction needs a reason');
select is(identity_begin_email_change(current_setting('t.cashier')::uuid,'Nuevo.6A@Example.Invalid','Correo mal escrito')->>'auth_user_id','00000000-0000-0000-0000-000000002101','Begin targets the same Auth user');
select is(pg_temp.attempt(format('select identity_finish_email_change(%L)',current_setting('t.cashier'))),'40001:email_change_unconfirmed','Finish refuses until Auth holds the new email');
reset role; update auth.users set email='nuevo.6a@example.invalid' where id='00000000-0000-0000-0000-000000002101';
select pg_temp.as_user(current_setting('t.platform'));
select is(identity_finish_email_change(current_setting('t.cashier')::uuid)->>'email','nuevo.6a@example.invalid','Email corrected on the same identity');
reset role; set local role service_role;
select is(login_identifier_email('cajera.santiago'),'nuevo.6a@example.invalid','Username keeps resolving to the corrected email');
reset role;
select is((select id::text from persons where auth_user_id='00000000-0000-0000-0000-000000002101'),current_setting('t.cashier'),'Person preserved across email change');

-- Login suspension (Platform)
select pg_temp.as_user(current_setting('t.platform'));
select is(identity_set_login_suspended(current_setting('t.cashier')::uuid,true,'Solicitud del cliente')->>'changed','true','Login suspended');
select pg_temp.as_user('00000000-0000-0000-0000-000000002101');
select is(pg_temp.me(),null,'A suspended login holds no PIKAS authority');
select is(identity_credential_state()->>'login_suspended','true','Self state reports suspension');
select pg_temp.as_user(current_setting('t.platform'));
select is(identity_set_login_suspended(current_setting('t.cashier')::uuid,false,'Acceso restablecido')->>'changed','true','Login reactivated');
select pg_temp.as_user('00000000-0000-0000-0000-000000002101');
select is(pg_temp.me()::text,current_setting('t.cashier'),'Reactivation restores the SAME Person');
reset role;

-- Live sessions end on suspension/temporary access
insert into auth.sessions(id,user_id,created_at,updated_at) values('00000000-0000-0000-0000-000000006a01','00000000-0000-0000-0000-000000002101',now(),now());
insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values('00000000-0000-0000-0000-000000006a01','00000000-0000-0000-0000-000000002101',now(),now());
select pg_temp.as_user(current_setting('t.platform'));
select identity_set_login_suspended(current_setting('t.cashier')::uuid,true,'Prueba de sesiones');
reset role;
select ok((select ended_at is not null from pikas_private.application_sessions where session_id='00000000-0000-0000-0000-000000006a01'),'Suspension ends the user''s live PIKAS sessions');

-- Audit
select is((select string_agg(operation,',' order by occurred_at) from pikas_private.identity_audit_events where target_person_id=current_setting('t.cashier')::uuid),
 'username_set,username_changed,temporary_access_requested,temporary_access_issued,password_change_completed,email_change_requested,email_changed,login_suspended,login_reactivated,login_suspended','Every identity mutation is audited in order');
select is((select string_agg(distinct actor_scope,',' order by actor_scope) from pikas_private.identity_audit_events where target_person_id=current_setting('t.cashier')::uuid),'platform,self,tenant','Actor scope recorded');
select is((select actor_person_id::text from pikas_private.identity_audit_events where target_person_id=current_setting('t.cashier')::uuid and operation='email_changed'),current_setting('t.platform_person'),'The real Platform operator is attributed');
select ok(not exists(select 1 from pikas_private.identity_audit_events where metadata::text ~* '(password|secret|token|otp)":'),'No secret keys in audit metadata');
select ok(not exists(select 1 from pikas_private.identity_audit_events where metadata::text ilike '%temporary-password%' or metadata::text ilike '%chosen-by-user%'),'No password values anywhere in audit');
select is(pg_temp.attempt(format('insert into pikas_private.identity_audit_events(operation,actor_scope,actor_person_id,target_person_id,metadata) values(%L,%L,%L,%L,%L)','username_set','platform',current_setting('t.platform_person'),current_setting('t.cashier'),'{"password":"x"}')),
 '23514:new row for relation "identity_audit_events" violates check constraint "identity_audit_events_metadata_check"','Audit rejects secret-bearing metadata');
select is(pg_temp.attempt('update pikas_private.identity_audit_events set reason=''x'''),'42501:identity_audit_immutable','Audit is immutable');

-- Multi-cafeteria: one Person, two Cafeteria Admin memberships, context limited to them
insert into cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113','00000000-0000-0000-0000-000000001004','cafeteria_admin','active');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select is((select string_agg(c->>'cafeteria_id',',' order by c->>'cafeteria_id') from jsonb_array_elements(get_cafeteria_admin_context()->'cafeterias') c),
 '00000000-0000-0000-0000-000000000112,00000000-0000-0000-0000-000000000113','One login lists exactly its two authorized cafeterias');
select is(cafeteria_admin_read('00000000-0000-0000-0000-000000000113')->'scope'->>'cafeteria_id','00000000-0000-0000-0000-000000000113','Second cafeteria readable in its own context');
select alike(pg_temp.attempt($$select cafeteria_admin_read('00000000-0000-0000-0000-000000000111')$$),'42501:%','A sibling cafeteria of the same school stays unauthorized');
reset role;

select * from finish();
rollback;
