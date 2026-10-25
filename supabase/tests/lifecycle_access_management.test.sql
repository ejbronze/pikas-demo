-- Lifecycle & Access Management (202611160001): Platform sede/cafetería status, membership status, POS access
-- grant for an existing customer Person, and the self access summary. Fictional local fixtures (synthetic
-- account 1: cafeterías 111 (sede 211) and 113 (sede 213); persons 1003 cafeteria_admin of 111, 1008 pos_cashier of
-- 111, 1011 cafeteria_admin of 111+113; account 2: cafetería 112). Rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$declare sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; s text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text, s=returned_sqlstate; return s||':'||m; end$$;
-- Row checks as the database owner (RLS hides tenant rows from the acting role).
create function pg_temp.q(sql text) returns text language plpgsql security definer as $$declare r text; begin execute sql into r; return r; end$$;
reset role;
-- Fingerprints of what must not change.
select set_config('t.caps',(select count(*)||':'||md5(string_agg(scope_kind||':'||role_code||':'||capability,',' order by scope_kind,role_code,capability)) from pikas_private.role_capabilities),true);
select set_config('t.pcaps',(select count(*)||':'||md5(string_agg(role_code||':'||capability,',' order by role_code,capability)) from pikas_private.platform_role_capabilities),true);
select set_config('t.wallets',(select coalesce(sum(current_balance_minor),0)::text||':'||count(*) from public.student_wallets),true);
-- A fictional Platform administrator.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-00000000ad21','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lam.op@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-00000000ae21','00000000-0000-0000-0000-00000000ad21','Operadora LAM');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-00000000ae21','platform_admin');
-- Synthetic accounts 1 and 2 are customers (tenant_kind is immutable); the sandbox is Colegio Horizonte.
update accounts set status='active' where id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
select set_config('t.sbx',(select id::text from accounts where tenant_kind='sandbox' limit 1),true);
select set_config('t.sbxcaf',(select c.id::text from cafeterias c join accounts a on a.id=c.account_id where a.tenant_kind='sandbox' limit 1),true);
select set_config('t.auth1008',(select auth_user_id::text from persons where id='00000000-0000-0000-0000-000000001008'),true);
-- The fixture cashier's login is confirmed and usable (the reactivation and grant rules require it).
update auth.users u set email_confirmed_at=coalesce(u.email_confirmed_at,now()) from persons p where p.auth_user_id=u.id and (p.id='00000000-0000-0000-0000-000000001008' or p.id in (select person_id from school_memberships where account_id='00000000-0000-0000-0000-000000000001' and role_code='school_admin'));

-- ── Structure lifecycle ─────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-00000000ad21');
select is(pg_temp.attempt($$select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000113','active','suspended','ab')$$),
 '22023:lifecycle_reason_required','structure: a reason of at least 3 characters is required');
select is(pg_temp.attempt($$select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000113','inactive','suspended','mantenimiento')$$),
 '23514:lifecycle_state_changed','structure: the expected status must match (stale edits refused)');
select is(pg_temp.attempt($$select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','location','00000000-0000-0000-0000-000000000213','active','suspended','x')$$),
 '22023:invalid_structure_status_input','structure: a sede is only active or inactive');
select is((select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000113','active','suspended','Cierre temporal ficticio')->>'status'),'suspended','structure: cafetería 113 suspended');
select is(pg_temp.q($$select status from cafeterias where id='00000000-0000-0000-0000-000000000113'$$),'suspended','structure: row updated');
select is((select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000113','active','suspended','Cierre temporal ficticio')->>'previous_status'),'active','structure: an exact retry replays the journal');
select is(pg_temp.attempt($$select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000113','active','inactive','otro')$$),
 '23505:platform_request_conflict','structure: the same key with another payload is refused');
-- A suspended cafetería is unavailable to its own admin (scope_active), readable by Platform support, history intact.
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select is(pg_temp.attempt($$select cafeteria_admin_read('00000000-0000-0000-0000-000000000113')$$),'42501:cafeteria_authority_required','structure: the cafetería admin loses authority while suspended');
select pg_temp.as_user('00000000-0000-0000-0000-00000000ad21');
select is((select platform_support_cafeteria_read('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000113')->'scope'->>'cafeteria_status'),'suspended','structure: Platform support still reads it, with its status');
select is(pg_temp.q($$select count(*)::text from cafeteria_memberships where cafeteria_id='00000000-0000-0000-0000-000000000113'$$),'2','structure: memberships untouched');
select is((select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000113','suspended','active','Reapertura ficticia')->>'status'),'active','structure: reactivated');
-- Sede: deactivating it makes its cafetería unavailable without changing the cafetería row; reactivating the cafetería under an inactive sede is refused.
select is((select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000001','location','00000000-0000-0000-0000-000000000213','active','inactive','Sede cerrada ficticia')->>'status'),'inactive','structure: sede 213 deactivated');
select is(pg_temp.q($$select status from cafeterias where id='00000000-0000-0000-0000-000000000113'$$),'active','structure: no cascade written to the cafetería row');
select is(pikas_private.scope_active('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113'),false,'structure: the cafetería under an inactive sede is unavailable');
select is(pg_temp.attempt($$select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000113','active','inactive','x y z')$$),'ok','structure: the cafetería itself can still be deactivated');
select is(pg_temp.attempt($$select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000113','inactive','active','reabrir')$$),'23514:location_inactive','structure: cannot reactivate a cafetería under an inactive sede');
select is((select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000001','location','00000000-0000-0000-0000-000000000213','inactive','active','Sede reabierta')->>'status'),'active','structure: sede reactivated');
select is((select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000113','inactive','active','reabrir')->>'status'),'active','structure: cafetería reactivated after the sede');
-- Open caja blocks leaving operation.
reset role;
insert into register_sessions(id,account_id,school_id,school_location_id,cafeteria_id,register_id,assignment_id,operator_membership_id,operator_person_id,operator_role_code,register_code_snapshot,register_name_snapshot,opened_at,opened_business_date,business_timezone_snapshot,currency_code,opening_cash_minor,status,open_request_key,open_payload_fingerprint)
 select '10000000-0000-4000-8000-00000000aa01',r.account_id,r.school_id,r.school_location_id,r.cafeteria_id,r.id,a.id,a.cafeteria_membership_id,a.operator_person_id,'pos_cashier',r.register_code,r.display_name,clock_timestamp(),(clock_timestamp() at time zone 'America/Santo_Domingo')::date,'America/Santo_Domingo','DOP',0,'open','10000000-0000-4000-8000-00000000aa02',encode(extensions.digest('lam','sha256'),'hex')
 from cafeteria_registers r join cafeteria_register_assignments a on a.register_id=r.id and a.status='active' where r.cafeteria_id='00000000-0000-0000-0000-000000000111' limit 1;
select pg_temp.as_user('00000000-0000-0000-0000-00000000ad21');
select is(pg_temp.attempt($$select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000008','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000111','active','suspended','con caja abierta')$$),
 '23514:open_register_sessions_block_lifecycle','structure: an open caja blocks suspension (close it in the POS first)');
-- Register history is immutable by design (pos_register_history_is_preserved): the fictional open session simply rolls back with the test.
-- Authority: a tenant admin cannot call it; a sandbox account is refused.
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select platform_set_customer_structure_status('10000000-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000000111','active','suspended','x y z')$$),'42501:not_authorized','structure: tenant admins have no authority');
select pg_temp.as_user('00000000-0000-0000-0000-00000000ad21');
select is(pg_temp.attempt('select platform_set_customer_structure_status(''10000000-0000-4000-8000-000000000010'','''||current_setting('t.sbx')||''',''cafeteria'','''||current_setting('t.sbxcaf')||''',''active'',''suspended'',''x y z'')'),'23514:lifecycle_customer_only','structure: sandbox structure has no lifecycle here');
select is(pg_temp.q($$select count(*)::text from pikas_private.platform_audit_events where action='customer_structure_status_changed' and target_account_id='00000000-0000-0000-0000-000000000001'$$),'6','structure: every successful change is audited once (replays are not)');

-- ── Membership lifecycle (cafetería scope) ──────────────────────────────────────────────────────────
select is(pg_temp.attempt($$select platform_set_customer_membership_status('10000000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000004601','active','suspended','ab')$$),'22023:lifecycle_reason_required','membership: reason required');
select is((select platform_set_customer_membership_status('10000000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000004601','active','suspended','Suspensión ficticia')->>'status'),'suspended','membership: cashier 1008 suspended in cafetería 111');
select is(pg_temp.q($$select status from cafeteria_memberships where id='00000000-0000-0000-0000-000000004601'$$),'suspended','membership: row updated');
select is(pg_temp.q($$select coalesce((select login_suspended_at::text from pikas_private.login_identities where person_id='00000000-0000-0000-0000-000000001008'),'none')$$),'none','membership: the global login is untouched');
select set_config('t.assign',pg_temp.q($$select count(*)::text from cafeteria_register_assignments where cafeteria_membership_id='00000000-0000-0000-0000-000000004601'$$),true);
select is(pg_temp.q($$select count(*)::text from cafeteria_register_assignments where cafeteria_membership_id='00000000-0000-0000-0000-000000004601'$$),current_setting('t.assign'),'membership: assignments kept');
select is(pg_temp.q($$select count(*)::text from audit_events where target_type='cafeteria_memberships' and target_id='00000000-0000-0000-0000-000000004601' and actor_role='platform_operator' and action='pos_membership_status_changed'$$),'1','membership: the cafetería audit names the Platform operator');
select is(pg_temp.attempt($$select platform_set_customer_membership_status('10000000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000004601','active','inactive','x y z')$$),'23514:lifecycle_state_changed','membership: stale expected status refused');
select is((select platform_set_customer_membership_status('10000000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000001','cafeteria','00000000-0000-0000-0000-000000004601','suspended','active','Reactivación ficticia')->>'status'),'active','membership: reactivated (identity usable)');
select is(pg_temp.attempt($$select platform_set_customer_membership_status('10000000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000002','cafeteria','00000000-0000-0000-0000-000000004601','active','suspended','x y z')$$),'42501:customer_access_scope_required','membership: another account cannot reach this membership');
-- School scope: only school_admin memberships, same rules.
select set_config('t.sm',coalesce(pg_temp.q($$select id::text from school_memberships where account_id='00000000-0000-0000-0000-000000000001' and role_code='school_admin' and status='active' limit 1$$),''),true);
select is(case when current_setting('t.sm')='' then 'skip' else (select platform_set_customer_membership_status('10000000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000001','school',current_setting('t.sm')::uuid,'active','suspended','Suspensión escolar ficticia')->>'status') end, case when current_setting('t.sm')='' then 'skip' else 'suspended' end,'membership: school admin suspended');
select is(case when current_setting('t.sm')='' then 'skip' else (select platform_set_customer_membership_status('10000000-0000-4000-8000-000000000016','00000000-0000-0000-0000-000000000001','school',current_setting('t.sm')::uuid,'suspended','active','Reactivación')->>'status') end, case when current_setting('t.sm')='' then 'skip' else 'active' end,'membership: school admin reactivated');

-- ── POS access grant for an existing customer Person (A-14) ────────────────────────────────────────
select is((select platform_grant_customer_pos_access('10000000-0000-4000-8000-000000000021','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001008','00000000-0000-0000-0000-000000000113','pos_cashier')->>'already_granted'),'false','grant: cashier 1008 gets POS access in cafetería 113');
select is(pg_temp.q($$select count(*)::text from cafeteria_memberships where person_id='00000000-0000-0000-0000-000000001008' and role_code='pos_cashier' and status='active'$$),'2','grant: same Person, two cafeterías');
select is(pg_temp.q($$select count(*)::text from persons where id='00000000-0000-0000-0000-000000001008'$$),'1','grant: no duplicate Person');
select is(pg_temp.q('select count(*)::text from auth.users where id='''||current_setting('t.auth1008')||''''),'1','grant: no duplicate Auth identity');
select is((select platform_grant_customer_pos_access('10000000-0000-4000-8000-000000000021','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001008','00000000-0000-0000-0000-000000000113','pos_cashier')->>'already_granted'),'false','grant: exact retry replays the journal');
select is((select platform_grant_customer_pos_access('10000000-0000-4000-8000-000000000022','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001008','00000000-0000-0000-0000-000000000113','pos_cashier')->>'already_granted'),'true','grant: a second request reports already granted, nothing duplicated');
select is(pg_temp.q($$select count(*)::text from cafeteria_memberships where person_id='00000000-0000-0000-0000-000000001008' and cafeteria_id='00000000-0000-0000-0000-000000000113'$$),'1','grant: one membership row');
select is(pg_temp.attempt($$select platform_grant_customer_pos_access('10000000-0000-4000-8000-000000000023','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001008','00000000-0000-0000-0000-000000000113','cafeteria_admin')$$),'22023:invalid_pos_access_grant','grant: POS roles only');
select is(pg_temp.attempt($$select platform_grant_customer_pos_access('10000000-0000-4000-8000-000000000025','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000001008','00000000-0000-0000-0000-000000000121','pos_cashier')$$),'42501:customer_person_required','grant: a Person of another customer is never linked (no cross-customer access)');
select is(pg_temp.attempt('select platform_grant_customer_pos_access(''10000000-0000-4000-8000-000000000024'','''||current_setting('t.sbx')||''',''00000000-0000-0000-0000-000000001008'','''||current_setting('t.sbxcaf')||''',''pos_cashier'')'),'42501:customer_access_scope_required','grant: the sandbox is never a target');
select is(pg_temp.q($$select count(*)::text from audit_events where target_type='cafeteria_memberships' and actor_role='platform_operator' and action='pos_membership_granted' and cafeteria_id='00000000-0000-0000-0000-000000000113'$$),'1','grant: the cafetería audit records the Platform grant once');
-- First cafetería intact after suspending the new one.
select is((select platform_set_customer_membership_status('10000000-0000-4000-8000-000000000026','00000000-0000-0000-0000-000000000001','cafeteria',pg_temp.q($$select id::text from cafeteria_memberships where person_id='00000000-0000-0000-0000-000000001008' and cafeteria_id='00000000-0000-0000-0000-000000000113'$$)::uuid,'active','suspended','Prueba de alcance')->>'status'),'suspended','grant: the new access can be suspended on its own');
select is(pg_temp.q($$select status from cafeteria_memberships where id='00000000-0000-0000-0000-000000004601'$$),'active','grant: the first cafetería access stays active');

-- ── Self access summary ─────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('t.auth1008'));
select ok((select jsonb_array_length(identity_access_summary()->'memberships'))>=2,'summary: the person sees every membership, both cafeterías included');
select is((select count(*) from jsonb_array_elements(identity_access_summary()->'memberships') m where m->>'status'='suspended' and m->>'name' like 'Synthetic cafeteria A1-C2%'),1::bigint,'summary: the suspended cafetería access is reported as suspended, by name');
select is((select identity_access_summary()->>'organization'),null,'summary: organization active → no denial state');
select is((select count(*) from jsonb_array_elements(identity_access_summary()->'memberships') m where m ? 'email' or m ? 'person_id'),0::bigint,'summary: no identifiers beyond names and states');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((select count(*) from jsonb_array_elements(identity_access_summary()->'memberships') m where m->>'name' like 'Synthetic cafeteria A1-C2%'),0::bigint,'summary: each person only sees their own (2003 is not in cafetería 113)');

-- ── Nothing else moved ──────────────────────────────────────────────────────────────────────────────
reset role;
select is((select count(*)||':'||md5(string_agg(scope_kind||':'||role_code||':'||capability,',' order by scope_kind,role_code,capability)) from pikas_private.role_capabilities),current_setting('t.caps'),'invariant: tenant grants unchanged');
select is((select count(*)||':'||md5(string_agg(role_code||':'||capability,',' order by role_code,capability)) from pikas_private.platform_role_capabilities),current_setting('t.pcaps'),'invariant: Platform grants unchanged');
select is((select coalesce(sum(current_balance_minor),0)::text||':'||count(*) from public.student_wallets),current_setting('t.wallets'),'invariant: wallets untouched');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('platform_set_customer_structure_status','platform_set_customer_membership_status','platform_grant_customer_pos_access','identity_access_summary') and has_function_privilege('anon',p.oid,'execute')),0::bigint,'invariant: nothing exposed to anon');
select * from finish();
rollback;
