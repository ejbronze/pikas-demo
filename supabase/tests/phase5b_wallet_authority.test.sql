-- Owner-approved Beta wallet authority (202610170001). Fictional local fixtures only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
-- 2001 account_admin (account 1, no school membership, as initial-customer provisioning creates)
-- 2002/2009 school_admin school 11; 2006 school_admin account 2; 2003 cafeteria_admin 111 (school 11)
-- 2004 cafeteria_admin 112 (school 12); 2008 POS cashier/supervisor.
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.credit(amount bigint,key uuid,student uuid default '00000000-0000-0000-0000-000000005201',school uuid default '00000000-0000-0000-0000-000000000011',note text default 'Fondos ficticios verificados') returns jsonb language sql as $$
 select school_wallet_replenish(school,student,amount,key,'Referencia local',note)$$;
create function pg_temp.balance(school uuid default '00000000-0000-0000-0000-000000000011',student uuid default '00000000-0000-0000-0000-000000005201') returns text language sql as $$
 select school_wallet_read(school,student)->'wallet'->>'balance_minor'$$;
-- Fictional cross-account student and a newly enrolled student without a wallet.
insert into persons(id,display_name) values('5bf00000-0000-4000-8000-000000000021','Estudiante otra cuenta'),('5bf00000-0000-4000-8000-000000000011','Estudiante sin monedero');
insert into students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name) values
 ('5bf00000-0000-4000-8000-000000000121','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021','5bf00000-0000-4000-8000-000000000021','AUTH-21','Estudiante','otra cuenta','Estudiante otra cuenta'),
 ('5bf00000-0000-4000-8000-000000000111','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','5bf00000-0000-4000-8000-000000000011','AUTH-11','Estudiante','sin monedero','Estudiante sin monedero');
insert into student_enrollments(account_id,school_id,student_id,starts_on) values
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021','5bf00000-0000-4000-8000-000000000121','2026-01-01'),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','5bf00000-0000-4000-8000-000000000111','2026-01-01');

-- Policy shape
select ok(not has_function_privilege('anon','school_wallet_access(uuid)','execute') and not has_function_privilege('anon','cafeteria_wallet_read(uuid,text)','execute'),'Anonymous cannot use new wallet reads');
select ok(not has_function_privilege('service_role','cafeteria_wallet_read(uuid,text)','execute'),'No service-role wallet bypass');
select is((select array_agg(capability order by capability) from pikas_private.role_capabilities where scope_kind='account' and role_code='account_admin' and capability like '%wallet%'),array['school:wallets:read','school:wallets:replenish'],'Account Admin: read + replenish only');
select is((select array_agg(capability order by capability) from pikas_private.role_capabilities where role_code='school_admin' and capability like '%wallet%'),array['school:wallets:adjust','school:wallets:manage','school:wallets:read','school:wallets:replenish'],'School Admin authority unchanged');
select is((select array_agg(capability order by capability) from pikas_private.role_capabilities where role_code='cafeteria_admin' and capability like '%wallet%'),array['cafeteria:wallets:read'],'Cafeteria Admin: scoped read only');
select is((select count(*) from pikas_private.role_capabilities where role_code in ('pos_operator','pos_cashier','pos_supervisor') and capability like '%wallet%'),0::bigint,'POS roles have no administrative wallet capability');
select is((select count(*) from pikas_private.platform_role_capabilities where capability like '%wallet%'),0::bigint,'Platform has no standing wallet capability');

-- Account Admin (initial-customer shape)
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select is(school_wallet_access('00000000-0000-0000-0000-000000000011'),jsonb_build_object('school_id','00000000-0000-0000-0000-000000000011','read',true,'replenish',true),'Account Admin wallet access derived server-side');
select is(pg_temp.balance(),'0','Account Admin reads balance');
select is(pg_temp.credit(2500,'5bf00000-0000-4000-8000-0000000000a1')->>'balance_after_minor','2500','Account Admin manual_verified replenish');
select is(pg_temp.credit(2500,'5bf00000-0000-4000-8000-0000000000a1')->>'balance_after_minor','2500','Exact retry returns original result');
select throws_ok($$select pg_temp.credit(2600,'5bf00000-0000-4000-8000-0000000000a1')$$,'23505',null,'Changed payload under same key rejected');
select is(school_wallet_read('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201')->'movements'->0->>'source','manual_verified','Replenishment source preserved');
select is(pg_temp.credit(100,'5bf00000-0000-4000-8000-0000000000a2','5bf00000-0000-4000-8000-000000000111')->>'balance_after_minor','100','First verified credit opens wallet for newly enrolled student');
select throws_ok($$select create_student_wallet('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005202','DOP')$$,'42501',null,'Account Admin cannot manage (standalone wallet creation)');
select throws_ok($$select set_student_wallet_status('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000007001','frozen')$$,'42501',null,'Account Admin cannot manage (freeze)');
select throws_ok($$select post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',100,'correction','auth-adjust-local-0001','Local','Nota')$$,'42501',null,'Account Admin cannot adjust');
select is(school_wallet_access('00000000-0000-0000-0000-000000000021')->>'read','false','No cross-account wallet access');
select throws_ok($$select school_wallet_read('00000000-0000-0000-0000-000000000021','5bf00000-0000-4000-8000-000000000121')$$,'42501',null,'Cross-account read denied');
select throws_ok($$select pg_temp.credit(100,'5bf00000-0000-4000-8000-0000000000a3','5bf00000-0000-4000-8000-000000000121','00000000-0000-0000-0000-000000000021')$$,'42501',null,'Cross-account replenish denied');
select throws_ok($$select school_wallet_read('00000000-0000-0000-0000-000000000011','5bf00000-0000-4000-8000-000000000121')$$,'42501',null,'Foreign student through own school denied');
reset role;
select is((select actor_role from audit_events where action='wallet_replenishment_posted' and target_id=(select id from wallet_replenishments where idempotency_key='5bf00000-0000-4000-8000-0000000000a1')),'account_admin','Credit attributed to Account Admin');
select is((select actor_role from audit_events where action='wallet_created' and target_id=(select id from student_wallets where student_id='5bf00000-0000-4000-8000-000000000111')),'account_admin','Wallet opening attributed to Account Admin');

-- School Admins
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.balance(),'2500','School Admin reads same authoritative balance');
select is(pg_temp.credit(5000,'5bf00000-0000-4000-8000-0000000000b1')->>'balance_after_minor','7500','School Admin replenish unchanged');
select lives_ok($$select set_student_wallet_status('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000007001','frozen')$$,'School Admin retains manage');
select lives_ok($$select set_student_wallet_status('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000007001','active')$$,'School Admin restores wallet');
reset role;select pg_temp.as_user('00000000-0000-0000-0000-000000002010');
select is(pg_temp.credit(1000,'5bf00000-0000-4000-8000-0000000000b2')->>'balance_after_minor','8500','Second School Admin of same school replenishes');
reset role;select pg_temp.as_user('00000000-0000-0000-0000-000000002009');
select throws_ok($$select pg_temp.balance()$$,'42501',null,'Suspended person with active School Admin membership denied');
reset role;select pg_temp.as_user('00000000-0000-0000-0000-000000002006');
select is(school_wallet_access('00000000-0000-0000-0000-000000000011')->>'read','false','Wrong-school admin has no access');
select throws_ok($$select pg_temp.balance()$$,'42501',null,'Wrong-school admin read denied');
select throws_ok($$select pg_temp.credit(100,'5bf00000-0000-4000-8000-0000000000b3')$$,'42501',null,'Wrong-school admin replenish denied');

-- Cafeteria Admin: scoped read only
reset role;select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((select s->>'balance_minor' from jsonb_array_elements(cafeteria_wallet_read('00000000-0000-0000-0000-000000000111','sofia')->'students') s where s->>'student_id'='00000000-0000-0000-0000-000000005201'),'8500','Cafeteria Admin reads eligible customer balance');
select set_config('auth5b.cafe_read',cafeteria_wallet_read('00000000-0000-0000-0000-000000000111','')::text,true);
reset role;
select is((select count(*) from jsonb_array_elements(current_setting('auth5b.cafe_read')::jsonb->'students') s
 where not exists(select 1 from cafeteria_customers cc where cc.cafeteria_id='00000000-0000-0000-0000-000000000111' and cc.status='active' and cc.student_id=(s->>'student_id')::uuid)),0::bigint,'Only active shared customers of this cafeteria');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((select count(*) from jsonb_array_elements(cafeteria_wallet_read('00000000-0000-0000-0000-000000000111','')->'students') s, jsonb_object_keys(s) k where k not in ('student_id','display_name','wallet_status','balance_minor')),0::bigint,'No history, references or actors exposed');
select throws_ok($$select cafeteria_wallet_read('00000000-0000-0000-0000-000000000112','')$$,'42501',null,'Other cafeteria denied');
select throws_ok($$select cafeteria_wallet_read('00000000-0000-0000-0000-000000000121','')$$,'42501',null,'Cross-account cafeteria denied');
select is(school_wallet_access('00000000-0000-0000-0000-000000000011')->>'read','false','Cafeteria Admin has no school wallet access');
select throws_ok($$select pg_temp.balance()$$,'42501',null,'Cafeteria Admin cannot read school ledger');
select throws_ok($$select pg_temp.credit(100,'5bf00000-0000-4000-8000-0000000000c1')$$,'42501',null,'Cafeteria Admin cannot replenish via school path');
select throws_ok($$select post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',100,'auth-cafe-credit-local-01','Local','Nota','00000000-0000-0000-0000-000000006901')$$,'42501',null,'Legacy cafeteria credit withdrawn');
select throws_ok($$select set_student_wallet_status('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000007001','frozen')$$,'42501',null,'Cafeteria Admin cannot manage');
select throws_ok($$select post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',100,'correction','auth-adjust-local-0002','Local','Nota')$$,'42501',null,'Cafeteria Admin cannot adjust');
reset role;select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select is(jsonb_array_length(cafeteria_wallet_read('00000000-0000-0000-0000-000000000112','sofia')->'students'),0,'Unrelated-school cafeteria does not see student');

-- POS: operational wallet purchase only
reset role;select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select throws_ok($$select cafeteria_wallet_read('00000000-0000-0000-0000-000000000111','')$$,'42501',null,'POS cannot use administrative cafeteria read');
select throws_ok($$select pg_temp.balance()$$,'42501',null,'POS cannot read school ledger');
select open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',0,'auth5b-open-local-0001');
select set_config('auth5b.sid',(select session_id::text from get_my_open_register_session()),true);
select lives_ok($$select checkout_purchase(jsonb_build_object('request_key','auth5b-wallet-sale-0001','register_session_id',current_setting('auth5b.sid'),'cafeteria_customer_id','00000000-0000-0000-0000-000000006901','items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',1,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor','5000','tender',jsonb_build_object('type','student_wallet')))$$,'POS wallet purchase unchanged');
reset role;
select is((select current_balance_minor from student_wallets where id='00000000-0000-0000-0000-000000007001'),3500::bigint,'Purchase debits balance after credits');
select is((select current_balance_minor::numeric from student_wallets where id='00000000-0000-0000-0000-000000007001'),(select sum(amount_minor::numeric) from wallet_ledger_entries where wallet_id='00000000-0000-0000-0000-000000007001'),'Balance equals signed ledger sum');
select is((select pikas_private.register_cash_summary(current_setting('auth5b.sid')::uuid)->>'expected_minor'),'0','Credits and wallet purchase create no register cash');

-- Revocation
update account_memberships set status='suspended' where person_id=(select id from persons where auth_user_id='00000000-0000-0000-0000-000000002001') and account_id='00000000-0000-0000-0000-000000000001';
update school_memberships set status='suspended' where person_id=(select id from persons where auth_user_id='00000000-0000-0000-0000-000000002002');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select is(school_wallet_access('00000000-0000-0000-0000-000000000011')->>'read','false','Suspended Account Admin loses access');
select throws_ok($$select pg_temp.credit(100,'5bf00000-0000-4000-8000-0000000000a1')$$,'42501',null,'Suspended Account Admin cannot even replay');
reset role;select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select throws_ok($$select pg_temp.balance()$$,'42501',null,'Suspended School Admin cannot read');
reset role;
update cafeteria_memberships set status='suspended' where person_id=(select id from persons where auth_user_id='00000000-0000-0000-0000-000000002003') and cafeteria_id='00000000-0000-0000-0000-000000000111';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select throws_ok($$select cafeteria_wallet_read('00000000-0000-0000-0000-000000000111','')$$,'42501',null,'Suspended Cafeteria Admin cannot read');
reset role;

-- Sandbox POV and Platform: no standing or POV wallet access
select set_config('auth5b.sandbox_school',(select school_id::text from pikas_private.sandbox_pov_personas where pov_code='school_admin' limit 1),true);
select set_config('auth5b.sandbox_student',(select id::text from students where school_id=current_setting('auth5b.sandbox_school')::uuid limit 1),true);
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select is(school_wallet_access('00000000-0000-0000-0000-000000000011')->>'read','false','Platform operator has no customer wallet access');
select throws_ok($$select cafeteria_wallet_read('00000000-0000-0000-0000-000000000111','')$$,'42501',null,'Platform operator cannot read cafeteria balances');
select platform_enter_sandbox_pov(gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe','school_admin');
select is(school_wallet_access(current_setting('auth5b.sandbox_school')::uuid)->>'read','false','Sandbox POV has no wallet access');
select throws_ok($$select school_wallet_replenish(current_setting('auth5b.sandbox_school')::uuid,current_setting('auth5b.sandbox_student')::uuid,1,gen_random_uuid(),'Local','Verificado')$$,'42501',null,'Sandbox POV cannot replenish');
reset role;
set constraints all immediate;
select * from finish();
rollback;
