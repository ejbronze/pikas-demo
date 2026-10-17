-- Phase 5C.3 administrative wallet adjustments (202610200001). Fictional local fixtures only.
-- 2001 Account Admin; 2002 School Admin school 11; 2003 Cafeteria Admin 111 (Sofia 5201 is its customer 6901);
-- 2004 Cafeteria Admin 112 (school 12); 2008 cashier at 111 and POS Supervisor at 112.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.adj(amount bigint,key uuid,reason text default 'administrative_correction',expl text default 'Corrección documentada local',student uuid default '00000000-0000-0000-0000-000000005201',school uuid default '00000000-0000-0000-0000-000000000011') returns jsonb language sql as $$
 select school_wallet_adjust(school,student,amount,reason,expl,key)$$;
create function pg_temp.cadj(cafe uuid,amount bigint,key uuid,student uuid default '00000000-0000-0000-0000-000000005201',reason text default 'authorized_debit') returns jsonb language sql as $$
 select cafeteria_wallet_adjust(cafe,student,amount,reason,'Ajuste de cafetería documentado',key)$$;
create function pg_temp.balance() returns bigint language sql security definer as $$select current_balance_minor from student_wallets where id='00000000-0000-0000-0000-000000007001'$$;
create function pg_temp.sale(key text) returns jsonb language sql as $$select checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',current_setting('t.sid'),
 'cafeteria_customer_id','00000000-0000-0000-0000-000000006901','items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',1,
 'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor','5000','tender',jsonb_build_object('type','student_wallet')))$$;
create function pg_temp.expected() returns text language sql security definer as $$select pikas_private.register_cash_summary(current_setting('t.sid')::uuid)->>'expected_minor'$$;

select ok(not has_function_privilege('anon','school_wallet_adjust(uuid,uuid,bigint,text,text,uuid)','execute') and not has_function_privilege('service_role','cafeteria_wallet_adjust(uuid,uuid,bigint,text,text,uuid)','execute'),'No anonymous or service adjustment bypass');
select is((select array_agg(role_code order by role_code) from pikas_private.role_capabilities where capability like '%administrative_adjust'),array['account_admin','cafeteria_admin','school_admin'],'Account, School and Cafeteria Admin only');
select is((select count(*) from pikas_private.platform_role_capabilities where capability like '%wallet%'),0::bigint,'Platform has no standing wallet authority');

select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',5000,'5c300000-0000-4000-8000-000000000001','Ref','Verificado');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',1000,'5c3-open-cashier-0001')),true);
reset role; select set_config('t.cash',pg_temp.expected(),true);

-- Validation
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select throws_ok($$select pg_temp.adj(100,'5c300000-0000-4000-8000-0000000000a1','administrative_correction','   ')$$,'22023','ADJUSTMENT_EXPLANATION_REQUIRED','Explanation required for every adjustment');
select throws_ok($$select pg_temp.adj(100,'5c300000-0000-4000-8000-0000000000a2','')$$,'22023','INVALID_ADJUSTMENT_REASON','Reason required');
select throws_ok($$select pg_temp.adj(100,'5c300000-0000-4000-8000-0000000000a3','duplicate_manual_credit_correction')$$,'22023','INVALID_ADJUSTMENT_REASON','Reversal-like reasons not offered');
select throws_ok($$select pg_temp.adj(-100,'5c300000-0000-4000-8000-0000000000a4','authorized_credit')$$,'22023','ADJUSTMENT_DIRECTION_MISMATCH','Credit reason must be positive');
select throws_ok($$select pg_temp.adj(0,'5c300000-0000-4000-8000-0000000000a5')$$,'22023','INVALID_ADJUSTMENT_AMOUNT','Zero rejected');

-- Account Admin: positive and negative
select set_config('t.a1',pg_temp.adj(10000,'5c300000-0000-4000-8000-000000000011','authorized_credit','Crédito autorizado por dirección')::text,true);
select is(array[current_setting('t.a1')::jsonb->>'balance_before_minor',current_setting('t.a1')::jsonb->>'balance_after_minor',current_setting('t.a1')::jsonb->>'actor_role'],array['5000','15000','account_admin'],'Account Admin positive adjustment');
select is(pg_temp.adj(10000,'5c300000-0000-4000-8000-000000000011','authorized_credit','Crédito autorizado por dirección')->>'adjustment_id',current_setting('t.a1')::jsonb->>'adjustment_id','Exact retry returns the original adjustment');
select throws_ok($$select pg_temp.adj(9000,'5c300000-0000-4000-8000-000000000011','authorized_credit','Crédito autorizado por dirección')$$,'23505',null,'Changed payload under same key rejected');
select is(pg_temp.adj(-2000,'5c300000-0000-4000-8000-000000000012','data_migration_correction','Saldo migrado duplicado')->>'balance_after_minor','13000','Account Admin negative adjustment');

-- School Admin: assigned school only
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.adj(1000,'5c300000-0000-4000-8000-000000000021','initial_balance_correction','Saldo inicial omitido')->>'actor_role','school_admin','School Admin adjusts assigned school');
reset role;
insert into persons(id,display_name) values('5c300000-0000-4000-8000-000000000012','Estudiante escuela 12');
insert into students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name) values('5c300000-0000-4000-8000-000000000112','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','5c300000-0000-4000-8000-000000000012','A12','Estudiante','escuela 12','Estudiante escuela 12');
insert into student_enrollments(account_id,school_id,student_id,starts_on) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','5c300000-0000-4000-8000-000000000112','2026-01-01');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select throws_ok($$select pg_temp.adj(100,'5c300000-0000-4000-8000-000000000022','administrative_correction','Corrección documentada local','5c300000-0000-4000-8000-000000000112','00000000-0000-0000-0000-000000000012')$$,'42501',null,'School Admin denied outside assigned school');
select throws_ok($$select pg_temp.adj(100,'5c300000-0000-4000-8000-000000000023','administrative_correction','Corrección documentada local','5c300000-0000-4000-8000-000000000112')$$,'42501',null,'Foreign student through own school denied');

-- Cafeteria Admin: connected students of the administered cafeteria only
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.c1',pg_temp.cadj('00000000-0000-0000-0000-000000000111',-20000,'5c300000-0000-4000-8000-000000000031')::text,true);
select is(current_setting('t.c1')::jsonb->>'balance_after_minor','-6000','Cafeteria Admin adjusts connected student; negative result allowed');
select throws_ok($$select pg_temp.cadj('00000000-0000-0000-0000-000000000111',-100,'5c300000-0000-4000-8000-000000000032','00000000-0000-0000-0000-000000005202')$$,'42501',null,'Unconnected student of same school denied');
select throws_ok($$select pg_temp.cadj('00000000-0000-0000-0000-000000000112',-100,'5c300000-0000-4000-8000-000000000033')$$,'42501',null,'Other cafeteria denied');
select throws_ok($$select school_wallet_adjust('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',-100,'authorized_debit','Intento escolar','5c300000-0000-4000-8000-000000000034')$$,'42501',null,'Cafeteria Admin has no school-wide adjustment');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select throws_ok($$select pg_temp.cadj('00000000-0000-0000-0000-000000000112',-100,'5c300000-0000-4000-8000-000000000035')$$,'42501',null,'Unrelated-school Cafeteria Admin denied');

-- Roles without authority
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select throws_ok($$select pg_temp.cadj('00000000-0000-0000-0000-000000000111',-100,'5c300000-0000-4000-8000-000000000041')$$,'42501',null,'Cashier denied');
select throws_ok($$select pg_temp.cadj('00000000-0000-0000-0000-000000000112',-100,'5c300000-0000-4000-8000-000000000042')$$,'42501',null,'POS Supervisor denied');
select throws_ok($$select pg_temp.adj(-100,'5c300000-0000-4000-8000-000000000043')$$,'42501',null,'POS roles have no school adjustment');
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select throws_ok($$select pg_temp.adj(100,'5c300000-0000-4000-8000-000000000044')$$,'42501',null,'Platform operator has no standing authority (school)');
select throws_ok($$select pg_temp.cadj('00000000-0000-0000-0000-000000000111',-100,'5c300000-0000-4000-8000-000000000045')$$,'42501',null,'Platform operator has no standing authority (cafeteria)');

-- Negative balance, purchases, register
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select throws_ok($$select pg_temp.sale('5c3-wallet-sale-00001')$$,'23514','INSUFFICIENT_BALANCE','Negative wallet blocks PIKAS Cash purchase');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',20000,'5c300000-0000-4000-8000-000000000002','Ref','Verificado');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select lives_ok($$select pg_temp.sale('5c3-wallet-sale-00002')$$,'Later positive movement restores purchasing');
reset role;
select is(pg_temp.balance(),9000::bigint,'-6000 + 20000 - 5000');
select is(pg_temp.expected(),current_setting('t.cash'),'Adjustments do not affect expected register cash');
select is(pg_temp.balance()::numeric,(select sum(amount_minor::numeric) from wallet_ledger_entries where wallet_id='00000000-0000-0000-0000-000000007001'),'Balance equals signed ledger sum');

-- Attribution and immutable evidence
select is((select array[(select auth_user_id::text from persons where id=actor_person_id),actor_role,actor_scope_kind,cafeteria_id::text,cafeteria_customer_id::text,reason_code,explanatory_note,balance_before_minor::text,balance_after_minor::text,actor_source]
 from wallet_adjustments where idempotency_key='5c300000-0000-4000-8000-000000000031'),
 array['00000000-0000-0000-0000-000000002003','cafeteria_admin','cafeteria','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000006901','authorized_debit','Ajuste de cafetería documentado','14000','-6000','tenant_admin'],
 'Actor, actual role, scope, reason, explanation and balances preserved');
select is((select actor_role||':'||actor_scope_kind from wallet_adjustments where idempotency_key='5c300000-0000-4000-8000-000000000011'),'account_admin:account','Account Admin attributed with account scope');
select is((select count(*) from wallet_ledger_entries l join wallet_adjustments a on a.id=l.adjustment_id where a.idempotency_key like '5c300000%' and l.amount_minor=a.amount_minor),4::bigint,'Each adjustment has one matching immutable ledger movement');
select throws_ok($$update wallet_adjustments set explanatory_note='editado' where idempotency_key='5c300000-0000-4000-8000-000000000031'$$,'23514',null,'Adjustment immutable');
select throws_ok($$delete from wallet_adjustments where idempotency_key='5c300000-0000-4000-8000-000000000031'$$,'23514',null,'Adjustment cannot be deleted');
select is((select actor_role from audit_events where action='wallet_administrative_adjustment_posted' and target_id=(select id from wallet_adjustments where idempotency_key='5c300000-0000-4000-8000-000000000031')),'cafeteria_admin','Audit event carries actual role');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is((select m->>'adjustment_reason'||':'||(m->>'actor_role')||':'||(m->>'balance_before_minor') from jsonb_array_elements(school_wallet_read('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201')->'movements') m
 where m->>'type'='adjustment' and m->>'amount_minor'='-20000'),'authorized_debit:cafeteria_admin:14000','History exposes reason, role and balance before');
select is(school_wallet_access('00000000-0000-0000-0000-000000000011')->>'adjust','true','Adjust capability exposed to UI');

-- Revocation of authority and of the cafeteria/student relationship
reset role; update cafeteria_customers set status='inactive' where id='00000000-0000-0000-0000-000000006901';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select throws_ok($$select pg_temp.cadj('00000000-0000-0000-0000-000000000111',-100,'5c300000-0000-4000-8000-000000000051')$$,'42501',null,'Revoked cafeteria relationship denied');
reset role; update school_memberships set status='suspended' where person_id='00000000-0000-0000-0000-000000001002';
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select throws_ok($$select pg_temp.adj(100,'5c300000-0000-4000-8000-000000000052')$$,'42501',null,'Suspended School Admin denied');

-- Sandbox POV
reset role;
select set_config('t.sandbox_school',(select school_id::text from pikas_private.sandbox_pov_personas where pov_code='school_admin' limit 1),true);
select set_config('t.sandbox_student',(select id::text from students where school_id=current_setting('t.sandbox_school')::uuid limit 1),true);
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select platform_enter_sandbox_pov(gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe','school_admin');
select is(school_wallet_access(current_setting('t.sandbox_school')::uuid)->>'adjust','false','Sandbox POV has no adjustment authority');
select throws_ok($$select school_wallet_adjust(current_setting('t.sandbox_school')::uuid,current_setting('t.sandbox_student')::uuid,100,'administrative_correction','Intento sandbox',gen_random_uuid())$$,'42501',null,'Sandbox POV cannot adjust');
reset role;
set constraints all immediate;
select * from finish();
rollback;
