-- UX 12B closure (202611140001): a temporary password expires 15 minutes after issuance if unused.
-- Fictional local fixtures (same shape as phase6a): Cafeteria Admin 111 (Auth 2003 / Person 1003) issues a
-- temporary credential to a test-only POS cashier of 111 (Auth 2101 / Person 7101). Clock is simulated by
-- moving temporary_issued_at; nothing sleeps. Rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text, s text default null) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated','session_id',s)::text,true);
 execute 'set local role authenticated'; end$$;
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.li() returns text language sql security definer set search_path=public as
 $$select concat_ws('/',must_change_password,password_baseline is not null,temporary_issued_at is not null,version) from pikas_private.login_identities where person_id='00000000-0000-0000-0000-000000007101'$$;
create function pg_temp.issued(p interval) returns void language sql security definer set search_path=public as
 $$update pikas_private.login_identities set temporary_issued_at=clock_timestamp()-p where person_id='00000000-0000-0000-0000-000000007101'$$;
create function pg_temp.baseline() returns text language sql security definer set search_path=public as
 $$select coalesce(password_baseline,'') from pikas_private.login_identities where person_id='00000000-0000-0000-0000-000000007101'$$;
create function pg_temp.issued_at() returns timestamptz language sql security definer set search_path=public as
 $$select temporary_issued_at from pikas_private.login_identities where person_id='00000000-0000-0000-0000-000000007101'$$;
create function pg_temp.hash(p text) returns void language sql security definer set search_path=public as
 $$update auth.users set encrypted_password=extensions.crypt(p,extensions.gen_salt('bf')) where id='00000000-0000-0000-0000-000000002101'$$;
reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-000000002101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cajera.12c@example.invalid',
  extensions.crypt('original-password',extensions.gen_salt('bf')),now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-000000007101','00000000-0000-0000-0000-000000002101','Cajera Ficticia 12C');
insert into cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000007101','pos_cashier','active');
-- An Auth session for the cashier (what signInWithPassword creates) so pikas_session_start can be exercised.
insert into auth.sessions(id,user_id,created_at,updated_at) values('00000000-0000-0000-0000-00000000c101','00000000-0000-0000-0000-000000002101',now(),now());
select set_config('t.cashier','00000000-0000-0000-0000-000000007101',true);
select set_config('t.sess','00000000-0000-0000-0000-00000000c101',true);

-- Function surface
select ok(not has_function_privilege('authenticated','pikas_private.temporary_access_expired(uuid)','execute') and not has_function_privilege('anon','pikas_private.temporary_access_expired(uuid)','execute'),'The expiry predicate is private');
select is(pikas_private.temporary_access_expired(current_setting('t.cashier')::uuid),false,'No login identity row: not expired (permanent password unaffected)');

-- 1. Fresh temporary credential (issued by the Cafetería Admin of 111) works
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok((identity_begin_temporary_access(current_setting('t.cashier')::uuid)->>'auth_user_id')='00000000-0000-0000-0000-000000002101','Cafetería Admin begins temporary access for own cashier');
select pg_temp.hash('temporary-one');
select is(identity_finish_temporary_access(current_setting('t.cashier')::uuid)->>'temporary_expired','false','Fresh issuance is not expired in the summary');
select pg_temp.as_user('00000000-0000-0000-0000-000000002101',current_setting('t.sess'));
select is(identity_credential_state()->>'temporary_expired','false','Fresh credential: credential state not expired');
select is(identity_credential_state()->>'must_change_password','true','Fresh credential: change still required');
select is(pg_temp.attempt('select pikas_session_start()'),'ok','Fresh credential starts an application session');
reset role; delete from pikas_private.application_sessions where session_id=current_setting('t.sess')::uuid;

-- 2. 14:59 remains valid
select pg_temp.issued(interval '14 minutes 59 seconds');
select pg_temp.as_user('00000000-0000-0000-0000-000000002101',current_setting('t.sess'));
select is(identity_credential_state()->>'temporary_expired','false','14:59 after issuance: still valid');
select is(pg_temp.attempt('select pikas_session_start()'),'ok','14:59: application session starts');
reset role; delete from pikas_private.application_sessions where session_id=current_setting('t.sess')::uuid;

-- 3./4. Over 15 minutes: refused, with zero unintended mutation
select pg_temp.issued(interval '15 minutes 1 second');
select set_config('t.before',pg_temp.li(),true);
select set_config('t.sessions_before',(select count(*)::text from pikas_private.application_sessions),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002101',current_setting('t.sess'));
select is(identity_credential_state()->>'temporary_expired','true','Over 15 minutes: credential state reports expiry');
select is(pg_temp.attempt('select pikas_session_start()'),'42501:temporary_access_expired','Expired temporary credential starts no application session (stable business outcome)');
select pg_temp.hash('attacker-chosen');
select is(pg_temp.attempt('select identity_complete_password_change()'),'42501:temporary_access_expired','Expired temporary credential cannot become a permanent password');
reset role;
select is(pg_temp.li(),current_setting('t.before'),'Expired attempts changed nothing in the login identity (must_change, baseline, issuance, version)');
select is((select count(*)::text from pikas_private.application_sessions),current_setting('t.sessions_before'),'Expired attempts left no application session');
select ok(not exists(select 1 from pikas_private.identity_audit_events where target_person_id=current_setting('t.cashier')::uuid and operation='password_change_completed'),'No completion audited for the expired credential');
-- The admin's read shows the state truthfully
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(identity_support_read_membership((select id from cafeteria_memberships where person_id=current_setting('t.cashier')::uuid))->>'temporary_expired','true','Cafetería Admin read reports the expired temporary credential');

-- 5./6. Reissue opens a new window; the prior credential no longer counts
select set_config('t.old_baseline',pg_temp.baseline(),true);
select ok((identity_begin_temporary_access(current_setting('t.cashier')::uuid)->>'auth_user_id') is not null,'Reissue: begin');
select pg_temp.hash('temporary-two');
select is(identity_finish_temporary_access(current_setting('t.cashier')::uuid)->>'temporary_expired','false','Reissue: new 15-minute window');
reset role;
select ok(pg_temp.baseline() is distinct from current_setting('t.old_baseline'),'Reissue: the prior temporary baseline is replaced (prior credential is gone)');
select ok(pg_temp.issued_at() > clock_timestamp()-interval '1 minute','Reissue: issuance time reset');
select pg_temp.as_user('00000000-0000-0000-0000-000000002101',current_setting('t.sess'));
select is(pg_temp.attempt('select pikas_session_start()'),'ok','Reissued credential starts an application session');

-- 7./8. A successful change kills the temporary credential; the permanent password is never subject to the rule
select pg_temp.hash('chosen-by-user');
select is(identity_complete_password_change()->>'must_change_password','false','Within the window a new password completes the change');
reset role;
select is(pg_temp.li(),'f/f/t/'||split_part(pg_temp.li(),'/',4),'After completion: no change pending, no baseline (issuance time kept as history)');
select pg_temp.issued(interval '3 days');
select is(pikas_private.temporary_access_expired(current_setting('t.cashier')::uuid),false,'A permanent password is never expired by the rule, however old the last issuance');
select pg_temp.as_user('00000000-0000-0000-0000-000000002101',current_setting('t.sess'));
select is(identity_credential_state()->>'temporary_expired','false','Permanent password: credential state not expired');
select is(pg_temp.attempt('select pikas_session_start()'),'ok','Permanent password: application session starts');
reset role; delete from pikas_private.application_sessions where session_id=current_setting('t.sess')::uuid;

-- 9./10. Nothing retrievable, nothing leaked
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok(not (identity_support_read_membership((select id from cafeteria_memberships where person_id=current_setting('t.cashier')::uuid))::text ilike any(array['%temporary-one%','%temporary-two%','%chosen-by-user%','%encrypted_password%','%password_baseline%'])),'The Cafetería Admin read never carries a password or its hash');
reset role;
select ok(not exists(select 1 from pikas_private.identity_audit_events where target_person_id=current_setting('t.cashier')::uuid and metadata::text ilike any(array['%temporary-one%','%temporary-two%','%chosen-by-user%'])),'No credential values in the identity audit');
select is((select string_agg(operation,',' order by occurred_at) from pikas_private.identity_audit_events where target_person_id=current_setting('t.cashier')::uuid),
 'temporary_access_requested,temporary_access_issued,temporary_access_requested,temporary_access_issued,password_change_completed','Audit records issuance, reissue and completion; expired attempts add nothing');
select ok(not has_table_privilege('authenticated','pikas_private.login_identities','select'),'Credential storage remains unreadable to clients');

select * from finish();
rollback;
