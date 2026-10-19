-- Platform customer lifecycle (202610280001). Fictional local fixtures; rolled back.
-- Account 1 (SYNTHETIC-A): 2001 Account Admin, 2002 School Admin 11, 2003 Cafeteria Admin 111, 2008 cashier 111/POS Supervisor 112.
-- Account 2 (SYNTHETIC-B): school 21.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$declare sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;
create function pg_temp.status() returns text language sql security definer set search_path=public as $$select status from accounts where id='00000000-0000-0000-0000-000000000001'$$;
create function pg_temp.lc(k text,expected text,action text,reason text default 'Motivo de prueba') returns jsonb language sql as $$
 select public.platform_set_customer_lifecycle(k::uuid,'00000000-0000-0000-0000-000000000001',expected,action,reason)$$;
-- Snapshot of everything lifecycle must never touch.
create function pg_temp.snapshot() returns text language sql security definer set search_path=public as $$ select concat_ws('|',
 (select count(*) from persons),(select count(*) from auth.users),
 (select count(*) from account_memberships where account_id='00000000-0000-0000-0000-000000000001'),
 (select count(*) from school_memberships where account_id='00000000-0000-0000-0000-000000000001'),
 (select string_agg(id::text||status,',' order by id) from cafeteria_memberships where account_id='00000000-0000-0000-0000-000000000001'),
 (select count(*) from schools where account_id='00000000-0000-0000-0000-000000000001'),(select count(*) from cafeterias where account_id='00000000-0000-0000-0000-000000000001'),
 (select coalesce(string_agg(id::text||current_balance_minor||status,',' order by id),'') from student_wallets where account_id='00000000-0000-0000-0000-000000000001'),
 (select count(*) from wallet_ledger_entries),(select count(*) from purchases),(select count(*) from refunds),
 (select count(*) from register_sessions),(select count(*) from cafeteria_register_assignments),
 (select count(*) from pikas_private.login_identities where login_suspended_at is not null),
 (select count(*) from pikas_private.application_sessions where ended_at is not null)) $$;
reset role;
select set_config('t.platform','8f6f4cb4-de08-41bf-a062-156f636873b2',true);
select set_config('t.sandbox_op','ec08ad21-4020-4b0d-b041-ee4a1fe09471',true);
select set_config('t.before',pg_temp.snapshot(),true);

-- 1: provisioning starts active; capability is narrow and Platform-admin only
select is((select column_default from information_schema.columns where table_schema='public' and table_name='accounts' and column_name='status'),'''active''::text','New customers default to active');
select ok(exists(select 1 from pikas_private.platform_role_capabilities where role_code='platform_admin' and capability='platform:tenant:lifecycle:manage')
 and not exists(select 1 from pikas_private.platform_role_capabilities where role_code<>'platform_admin' and capability='platform:tenant:lifecycle:manage'),'Lifecycle mutation capability granted only to platform_admin');

-- 16: active customer operates normally
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(cafeteria_admin_read('00000000-0000-0000-0000-000000000111')->'scope'->>'cafeteria_id','00000000-0000-0000-0000-000000000111','Active: Cafeteria Admin operates');
select is(tenant_lifecycle_state(),null,'Active: no lifecycle block');

-- 10–14: only Platform lifecycle managers may mutate
select pg_temp.as_user(current_setting('t.sandbox_op'));
select alike(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000001','active','suspend')$$),'42501:%','Platform role without the capability denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select alike(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000002','active','suspend')$$),'42501:%','Tenant Account Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select alike(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000003','active','suspend')$$),'42501:%','School Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select alike(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000004','active','close')$$),'42501:%','Cafeteria Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select alike(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000005','active','close')$$),'42501:%','Cashier denied');
reset role; select is(pg_temp.status(),'active','Denied attempts changed nothing');

-- 7/9/8: validation
select pg_temp.as_user(current_setting('t.platform'));
select is(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000010','active','suspend','  ')$$),'22023:lifecycle_reason_required','Reason required');
select is(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000011','active','reactivate')$$),'22023:invalid_lifecycle_transition','ACTIVE→ACTIVE rejected');
select is(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000012','active','reopen')$$),'22023:invalid_lifecycle_transition','Reopen of a non-closed customer rejected');
select is(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000013','suspended','reactivate')$$),'40001:lifecycle_state_changed','Stale expected state rejected');
select is(pg_temp.attempt($$select public.platform_set_customer_lifecycle('6c000000-0000-4000-8000-000000000014','00000000-0000-0000-0000-0000000000a1','active','suspend','Sandbox')$$),'P0002:customer_not_found','Unknown customer rejected');

-- 2: suspend
select is(pg_temp.lc('6c000000-0000-4000-8000-000000000020','active','suspend','Pago pendiente de revisión')->>'status','suspended','Active → Suspended');
select is(pg_temp.lc('6c000000-0000-4000-8000-000000000020','active','suspend','Pago pendiente de revisión')->>'status','suspended','Exact retry replays the same result');
select is(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000020','active','suspend','Otro motivo')$$),'23505:platform_request_conflict','Same key with another payload conflicts');
select is(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000021','suspended','suspend')$$),'22023:invalid_lifecycle_transition','SUSPENDED→SUSPENDED rejected');
select is(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000022','active','close')$$),'40001:lifecycle_state_changed','A concurrent action based on the old state cannot overwrite');
-- 25: Platform management stays available
select is(platform_get_customer_overview('00000000-0000-0000-0000-000000000001')->'account'->>'status','suspended','Platform still reads the suspended customer');
select ok(platform_list_customers('','suspended')->'customers' @> jsonb_build_array(jsonb_build_object('id','00000000-0000-0000-0000-000000000001')),'Filter by Suspendido lists it');
-- 15: Platform lifecycle authority grants no tenant authority
select alike(pg_temp.attempt($$select cafeteria_admin_read('00000000-0000-0000-0000-000000000111')$$),'42501:%','Lifecycle manager has no tenant workspace access');

-- 17/19/20/21: suspended memberships stay stored but cannot operate (stale sessions included)
reset role; select is(pg_temp.snapshot(),current_setting('t.before'),'Suspension deleted/changed nothing (Persons, memberships, wallets, history, registers, identity flags, sessions)');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select alike(pg_temp.attempt($$select cafeteria_admin_read('00000000-0000-0000-0000-000000000111')$$),'42501:%','Suspended: Cafeteria Admin read denied by the central authority');
select is(jsonb_array_length(get_cafeteria_admin_context()->'cafeterias'),0,'Suspended: no cafeteria offered (bookmarked ?cafeteria= cannot resolve)');
select is(tenant_lifecycle_state(),'suspended','Suspended: self state explains the block (no reason exposed)');
-- 26: tenant provisioning blocked
select alike(pg_temp.attempt($$select cafeteria_admin_command('00000000-0000-0000-0000-000000000111','6c000000-0000-4000-8000-000000000030','staff_prepare','{"email":"nuevo.lc@example.invalid","role":"pos_cashier"}')$$),'42501:%','Suspended: staff provisioning denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(jsonb_array_length(get_school_admin_context()->'schools'),0,'Suspended: School Admin context empty');
select alike(pg_temp.attempt($$select school_admin_command('00000000-0000-0000-0000-000000000011','6c000000-0000-4000-8000-000000000031','admin_prepare','{"email":"otro.lc@example.invalid"}')$$),'42501:%','Suspended: school provisioning denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select is(get_pos_access_context(),null,'Suspended: POS has no operable membership');
select pg_temp.as_user(current_setting('t.platform'));
select alike(pg_temp.attempt($$select platform_prepare_customer_admin('6c000000-0000-4000-8000-000000000032','00000000-0000-0000-0000-000000000001','account',null,null,'account_admin','lc.admin@example.invalid',now()+interval '7 days')$$),'23503:%','Suspended: Platform cannot prepare new tenant access either');
-- 24: individual identity suspension stays independent
reset role;
insert into pikas_private.login_identities(person_id,login_suspended_at) values('00000000-0000-0000-0000-000000001011',clock_timestamp())
 on conflict(person_id) do update set login_suspended_at=clock_timestamp();
select set_config('t.before',pg_temp.snapshot(),true);

-- 3/22: reactivate restores the SAME access
select pg_temp.as_user(current_setting('t.platform'));
select is(pg_temp.lc('6c000000-0000-4000-8000-000000000040','suspended','reactivate','Pago confirmado')->>'status','active','Suspended → Active');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(cafeteria_admin_read('00000000-0000-0000-0000-000000000111')->'scope'->>'cafeteria_id','00000000-0000-0000-0000-000000000111','Reactivated: same membership operates again');
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select is(pikas_private.current_person_id(),null,'Reactivation does not lift an individual identity suspension');
reset role; select is(pg_temp.snapshot(),current_setting('t.before'),'Reactivation changed nothing else');

-- 4/5: close from active and from suspended
select pg_temp.as_user(current_setting('t.platform'));
select is(pg_temp.lc('6c000000-0000-4000-8000-000000000050','active','close','Fin del contrato')->>'status','closed','Active → Closed');
select is(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000051','closed','close')$$),'22023:invalid_lifecycle_transition','CLOSED→CLOSED rejected');
select is(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000052','closed','suspend')$$),'22023:invalid_lifecycle_transition','Closed customers cannot be suspended');
select is(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000053','closed','reactivate')$$),'22023:invalid_lifecycle_transition','Closed customers return only through reopen');
select ok(platform_list_customers('','closed')->'customers' @> jsonb_build_array(jsonb_build_object('id','00000000-0000-0000-0000-000000000001')),'Closed customer remains visible to Platform');
-- 18/29-32: closed memberships stay stored but cannot operate; nothing deleted or settled
reset role; select is(pg_temp.snapshot(),current_setting('t.before'),'Closure deleted/changed nothing (Persons, memberships, wallet balances, transactions, refunds, registers)');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select alike(pg_temp.attempt($$select cafeteria_admin_read('00000000-0000-0000-0000-000000000111')$$),'42501:%','Closed: tenant access denied');
select is(tenant_lifecycle_state(),'closed','Closed: self state explains the block');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select is(get_pos_access_context(),null,'Closed: POS blocked');

-- 6/23/33/34: reopen the SAME customer
select pg_temp.as_user(current_setting('t.platform'));
select is(pg_temp.attempt($$select pg_temp.lc('6c000000-0000-4000-8000-000000000060','closed','reopen','')$$),'22023:lifecycle_reason_required','Reopen requires a reason');
select is(pg_temp.lc('6c000000-0000-4000-8000-000000000061','closed','reopen','Nuevo contrato firmado')->>'account_id','00000000-0000-0000-0000-000000000001','Closed → Active on the SAME customer id');
reset role;
select is(pg_temp.status(),'active','Reopened customer is active');
select is(pg_temp.snapshot(),current_setting('t.before'),'Reopen recreated nothing (same structure, memberships, history)');
select is((select count(*) from accounts where code='SYNTHETIC-A'),1::bigint,'No replacement tenant created');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(cafeteria_admin_read('00000000-0000-0000-0000-000000000111')->'scope'->>'cafeteria_id','00000000-0000-0000-0000-000000000111','Reopened: same memberships operate');

-- Customer-scoped, not human-scoped: a person also serving another active customer keeps that access
reset role;
insert into school_memberships(account_id,school_id,person_id,role_code,status) values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000001003','school_admin','active');
select pg_temp.as_user(current_setting('t.platform'));
select pg_temp.lc('6c000000-0000-4000-8000-000000000070','active','suspend','Prueba multi-cliente');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(tenant_lifecycle_state(),null,'A person with another active customer is not shown as blocked');
select is((select string_agg(s->>'school_id',',') from jsonb_array_elements(get_school_admin_context()->'schools') s),'00000000-0000-0000-0000-000000000021','… and keeps exactly the other customer''s access');
select alike(pg_temp.attempt($$select cafeteria_admin_read('00000000-0000-0000-0000-000000000111')$$),'42501:%','… while the suspended customer stays blocked');
reset role;

-- 35–39: audit
select is((select string_agg(concat_ws(':',reason_code,metadata->>'from',metadata->>'to'),',' order by occurred_at) from pikas_private.platform_audit_events
 where target_account_id='00000000-0000-0000-0000-000000000001' and reason_code like 'customer_%' and request_id::text like '6c000000-%'),
 'customer_suspended:active:suspended,customer_reactivated:suspended:active,customer_closed:active:closed,customer_reopened:closed:active,customer_suspended:active:suspended','Every transition audited once with before/after state');
select is((select count(distinct actor_person_id)::text||'|'||bool_and(actor_auth_user_id=current_setting('t.platform')::uuid)::text||'|'||bool_and(request_id is not null)::text
 from pikas_private.platform_audit_events where reason_code like 'customer_%' and request_id::text like '6c000000-%'),'1|true|true','Real Platform operator and request identity recorded');
select is((select metadata->>'reason' from pikas_private.platform_audit_events where reason_code='customer_reopened' and request_id::text like '6c000000-%'),'Nuevo contrato firmado','Reason recorded');
select is(pg_temp.attempt($$update pikas_private.platform_audit_events set metadata='{}' where reason_code='customer_closed'$$),'23514:platform_audit_is_append_only','Lifecycle audit cannot be rewritten');
select pg_temp.as_user(current_setting('t.platform'));
select ok(platform_customer_lifecycle_history('00000000-0000-0000-0000-000000000001')->'events'->0->>'action'='customer_suspended' and jsonb_array_length(platform_customer_lifecycle_history('00000000-0000-0000-0000-000000000001')->'events')>=5,'Platform reads lifecycle history, newest first');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select alike(pg_temp.attempt($$select platform_customer_lifecycle_history('00000000-0000-0000-0000-000000000001')$$),'42501:%','Tenant users cannot read lifecycle history or reasons');
select ok(not has_table_privilege('authenticated','pikas_private.platform_audit_events','select'),'Audit table is not client-readable');

select * from finish();
rollback;
