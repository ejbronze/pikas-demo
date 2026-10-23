-- Focused, rollback-only session policy assertions. Creates its own fictional sandbox operator.
begin;
-- Transactional fictional sandbox operator (rolled back with the test); no prior browser walkthrough is required.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('7b000000-0000-4000-8000-00000000b001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tx-sandbox-operator@example.invalid','',now(),now(),now(),'{}','{}');
insert into public.persons(id,auth_user_id,display_name) values('7b000000-0000-4000-8000-00000000b002','7b000000-0000-4000-8000-00000000b001','Operador sandbox de prueba');
insert into pikas_private.platform_memberships(person_id,role_code) values('7b000000-0000-4000-8000-00000000b002','platform_sandbox_operator');

create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(28);
create temporary table fixture as
select auth_user_id uid, '7f000000-0000-4000-8000-000000000001'::uuid sid,
 '7f000000-0000-4000-8000-000000000002'::uuid sid2
from public.persons where id='7b000000-0000-4000-8000-00000000b002';
insert into auth.sessions(id,user_id,created_at,updated_at)
select sid,uid,clock_timestamp(),clock_timestamp() from fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid)::text,true) from fixture;
set local role authenticated;
select set_config('request.path','/rpc/platform_get_active_sandbox_pov',true);
select throws_ok('select pikas_private.application_session_pre_request()','42501','application_session_expired','protected request cannot implicitly start an app session');
select set_config('request.path','/rpc/activation_password_status',true);
select lives_ok('select pikas_private.application_session_pre_request()','activation remains accessible before application session creation');
select set_config('request.headers','{"x-pikas-session-id":"7f000000-0000-4000-8000-000000000002"}',true);
select throws_ok('select pikas_private.application_session_pre_request()','PT409','authentication_session_changed','stale tab header fails before any protected action');
select set_config('request.headers','{}',true);
select lives_ok('select public.pikas_session_start()','new Auth session starts');
select is((public.pikas_session_status()->>'idle_seconds')::int,1800,'admin idle is 30 minutes');
select is(extract(epoch from ((public.pikas_session_status()->>'absolute_deadline')::timestamptz-(public.pikas_session_status()->>'started_at')::timestamptz))::int,28800,'absolute deadline is exactly eight hours');
select is((public.pikas_session_status()->>'session_id')::uuid,(select nullif(auth.jwt()->>'session_id','')::uuid),'record bound to authenticated session');
select throws_ok('select * from pikas_private.application_sessions','42501',null,'client cannot write/read private deadline table');
reset role;
select is((select user_id from pikas_private.application_sessions where session_id=(select sid from fixture)),(select uid from fixture),'record bound to real user');
select is((select started_at from pikas_private.application_sessions where session_id=(select sid from fixture)),(select created_at from auth.sessions where id=(select sid from fixture)),'start is authoritative Auth creation time');
update pikas_private.application_sessions set last_active_at=last_active_at + interval '1 second' where session_id=(select sid from fixture);
create temporary table initial as select * from pikas_private.application_sessions where session_id=(select sid from fixture);
set local role authenticated;
select lives_ok('select public.pikas_session_start()','repeated start is idempotent');
reset role;
select is((select last_active_at from pikas_private.application_sessions where session_id=(select sid from fixture)),(select last_active_at from initial),'start does not touch activity');
set local role authenticated;
select lives_ok($q$select public.pikas_session_activity('7f000000-0000-4000-8000-000000000001')$q$,'explicit activity accepted');
reset role;
select is((select started_at from pikas_private.application_sessions where session_id=(select sid from fixture)),(select started_at from initial),'activity never extends absolute start');
select ok((select last_active_at <= clock_timestamp() from pikas_private.application_sessions where session_id=(select sid from fixture)),'activity uses database time');
set local role authenticated;
select throws_ok($q$select public.pikas_session_activity('7f000000-0000-4000-8000-000000000002')$q$,'PT409','authentication_session_changed','stale session cannot touch replacement');
select is((public.pikas_session_status(null,true)->>'idle_seconds')::int,900,'POS uses 15 minutes');
reset role;
update pikas_private.application_sessions set started_at=clock_timestamp()-interval '1 hour',last_active_at=clock_timestamp()-interval '16 minutes' where session_id=(select sid from fixture);
set local role authenticated;
select throws_ok('select public.pikas_session_status()','42501','application_session_expired','POS expiry applies across same-session tabs');
select throws_ok($q$select public.pikas_session_activity('7f000000-0000-4000-8000-000000000001')$q$,'42501','application_session_expired','activity cannot revive idle expiry');
select set_config('request.path','/rpc/checkout_purchase',true);
select throws_ok('select pikas_private.application_session_pre_request()','42501','application_session_expired','protected RPC hook denies expiry before command');
reset role;
update pikas_private.application_sessions set started_at=clock_timestamp()-interval '9 hours',last_active_at=clock_timestamp() where session_id=(select sid from fixture);
set local role authenticated;
select throws_ok('select public.pikas_session_status()','42501','application_session_expired','eight-hour absolute expiry wins over activity');
select lives_ok($q$select public.pikas_session_end('7f000000-0000-4000-8000-000000000001')$q$,'expired application session can be ended locally');
reset role;
select ok((select ended_at is not null from pikas_private.application_sessions where session_id=(select sid from fixture)),'logout marks authoritative end');
insert into auth.sessions(id,user_id,created_at,updated_at) select sid2,uid,clock_timestamp(),clock_timestamp() from fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid2)::text,true) from fixture;
set local role authenticated;
select lives_ok('select public.pikas_session_start()','same user reauthentication starts a distinct app session');
select is((public.pikas_session_status()->>'idle_seconds')::int,1800,'new Auth session does not inherit old POS policy/deadline');
select throws_ok($q$select public.pikas_session_end('7f000000-0000-4000-8000-000000000001')$q$,'PT409','authentication_session_changed','old tab cannot end replacement');
select set_config('request.path','/rpc/activation_password_status',true);
select lives_ok('select pikas_private.application_session_pre_request()','activation exception retains separate frozen authority');
reset role;
select ok(not has_function_privilege('anon','public.pikas_session_activity(uuid,boolean)','execute'),'anonymous activity cannot extend sessions');
select * from finish();
rollback;
