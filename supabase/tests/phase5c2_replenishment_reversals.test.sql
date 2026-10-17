-- Phase 5C.2 replenishment reversals (202610190001). Fictional local fixtures only.
-- 2001 Account Admin (account 1); 2002 School Admin school 11; 2005 School Admin schools 11+12;
-- 2006 School Admin account 2; 2003 Cafeteria Admin; 2011 POS Supervisor; 2008 cashier.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.credit(amount bigint,key uuid) returns uuid language sql as $$
 select (school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',amount,key,'Ref local','Verificado')->>'replenishment_id')::uuid$$;
create function pg_temp.reverse(rep uuid,key uuid,reason text default 'wrong_amount',note text default null) returns jsonb language sql as $$
 select school_wallet_reverse_replenishment('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',rep,reason,note,key)$$;
create function pg_temp.balance() returns bigint language sql security definer as $$select current_balance_minor from student_wallets where id='00000000-0000-0000-0000-000000007001'$$;
create function pg_temp.sale(key text) returns jsonb language sql as $$select checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',current_setting('t.sid'),
 'cafeteria_customer_id','00000000-0000-0000-0000-000000006901','items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',1,
 'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor','5000','tender',jsonb_build_object('type','student_wallet')))$$;
create function pg_temp.expected() returns text language sql security definer as $$select pikas_private.register_cash_summary(current_setting('t.sid')::uuid)->>'expected_minor'$$;

select ok(not has_function_privilege('anon','school_wallet_reverse_replenishment(uuid,uuid,uuid,text,text,uuid)','execute')
 and not has_function_privilege('service_role','school_wallet_reverse_replenishment(uuid,uuid,uuid,text,text,uuid)','execute'),'No anonymous or service reversal bypass');
select is((select array_agg(role_code order by role_code) from pikas_private.role_capabilities where capability='school:wallets:reverse_replenishment'),array['account_admin','school_admin'],'Only Account and School Admin may reverse');
select is((select count(*) from pikas_private.platform_role_capabilities where capability like '%wallet%'),0::bigint,'Platform has no standing wallet authority');

-- Setup: two verified replenishments, a cash-free wallet purchase from an open register.
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select set_config('t.r1',pg_temp.credit(10000,'5c200000-0000-4000-8000-000000000001')::text,true);
select set_config('t.r2',pg_temp.credit(2500,'5c200000-0000-4000-8000-000000000002')::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',1000,'5c2-open-cashier-0001')),true);
select lives_ok($$select pg_temp.sale('5c2-wallet-sale-00001')$$,'Wallet purchase before reversals');
reset role; select is(pg_temp.balance(),7500::bigint,'Balance after credits and purchase');
select set_config('t.cash',pg_temp.expected(),true);

-- Authority
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select throws_ok($$select pg_temp.reverse(current_setting('t.r1')::uuid,'5c200000-0000-4000-8000-0000000000a1')$$,'42501',null,'Cafeteria Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select throws_ok($$select pg_temp.reverse(current_setting('t.r1')::uuid,'5c200000-0000-4000-8000-0000000000a2')$$,'42501',null,'POS Supervisor denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select throws_ok($$select pg_temp.reverse(current_setting('t.r1')::uuid,'5c200000-0000-4000-8000-0000000000a3')$$,'42501',null,'Cashier denied');
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select throws_ok($$select pg_temp.reverse(current_setting('t.r1')::uuid,'5c200000-0000-4000-8000-0000000000a4')$$,'42501',null,'Platform operator has no standing authority');
select pg_temp.as_user('00000000-0000-0000-0000-000000002006');
select throws_ok($$select pg_temp.reverse(current_setting('t.r1')::uuid,'5c200000-0000-4000-8000-0000000000a5')$$,'42501',null,'Cross-account School Admin denied');

-- Reason rules
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select throws_ok($$select pg_temp.reverse(current_setting('t.r2')::uuid,'5c200000-0000-4000-8000-0000000000b1','other',' ')$$,'22023','INVALID_REVERSAL_NOTE','"Otro" requires explanation');
select throws_ok($$select pg_temp.reverse(current_setting('t.r2')::uuid,'5c200000-0000-4000-8000-0000000000b2','')$$,'22023','INVALID_REVERSAL_REASON','Reason required');

-- School Admin reverses within assigned school
select set_config('t.v2',pg_temp.reverse(current_setting('t.r2')::uuid,'5c200000-0000-4000-8000-0000000000c1','duplicate_replenishment')::text,true);
select is(current_setting('t.v2')::jsonb->>'amount_minor','2500','Reversal amount equals the original replenishment');
select is(current_setting('t.v2')::jsonb->>'balance_after_minor','5000','Resulting balance authoritative');
select is(pg_temp.reverse(current_setting('t.r2')::uuid,'5c200000-0000-4000-8000-0000000000c1','duplicate_replenishment')->>'reversal_id',current_setting('t.v2')::jsonb->>'reversal_id','Exact retry returns the original reversal');
select throws_ok($$select pg_temp.reverse(current_setting('t.r2')::uuid,'5c200000-0000-4000-8000-0000000000c1','wrong_amount')$$,'23505',null,'Changed payload under same key rejected');
select throws_ok($$select pg_temp.reverse(current_setting('t.r2')::uuid,'5c200000-0000-4000-8000-0000000000c2','duplicate_replenishment')$$,'23514','REPLENISHMENT_ALREADY_REVERSED','A replenishment is reversed at most once');
reset role;
select is((select count(*) from wallet_replenishment_reversals where replenishment_id=current_setting('t.r2')::uuid),1::bigint,'No duplicate reversal row');
select is((select amount_minor from wallet_ledger_entries where replenishment_id=current_setting('t.r2')::uuid),2500::bigint,'Original ledger entry unchanged');
select throws_ok($$update wallet_replenishments set amount_minor=1 where id=current_setting('t.r2')::uuid$$,'23514',null,'Original replenishment immutable');
select throws_ok($$update wallet_replenishment_reversals set note='x'$$,'23514',null,'Reversal immutable');
select is((select l.entry_type||':'||l.amount_minor from wallet_ledger_entries l join wallet_replenishment_reversals v on v.id=l.replenishment_reversal_id where v.replenishment_id=current_setting('t.r2')::uuid),'replenishment_reversal:-2500','Linked negative ledger entry');

-- Account Admin reverses after the funds were partly spent: wallet becomes negative
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select is(pg_temp.reverse(current_setting('t.r1')::uuid,'5c200000-0000-4000-8000-0000000000d1','wrong_student','Estudiante equivocado')->>'balance_after_minor','-5000','Account Admin reversal may produce negative balance');
reset role;
select is((select array[(select auth_user_id::text from persons where id=actor_person_id),actor_role,reason,note,(reversed_at is not null)::text,replenishment_id::text]
 from wallet_replenishment_reversals where replenishment_id=current_setting('t.r1')::uuid),
 array['00000000-0000-0000-0000-000000002001','account_admin','wrong_student','Estudiante equivocado','true',current_setting('t.r1')],'Actor, role, reason, note, timestamp and linkage recorded');
select is((select actor_role from audit_events where action='wallet_replenishment_reversed' and target_id=(select id from wallet_replenishment_reversals where replenishment_id=current_setting('t.r1')::uuid)),'account_admin','Audited with actor role');
select is(pg_temp.balance()::numeric,(select sum(amount_minor::numeric) from wallet_ledger_entries where wallet_id='00000000-0000-0000-0000-000000007001'),'Balance equals signed ledger sum');
select is(pg_temp.expected(),current_setting('t.cash'),'Reversals do not affect register expected cash');

-- History shows original and reversal independently
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is((select count(*) from jsonb_array_elements(school_wallet_read('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201')->'movements') m where m->>'type'='replenishment_reversal'),2::bigint,'Reversals visible in history');
select isnt((select m->>'reversal_id' from jsonb_array_elements(school_wallet_read('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201')->'movements') m where m->>'replenishment_id'=current_setting('t.r1')),null,'Original shows its reversal');
select is(school_wallet_read('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201')->'wallet'->>'balance_minor','-5000','Negative balance visible');
select is(school_wallet_access('00000000-0000-0000-0000-000000000011')->>'reverse','true','Reverse capability exposed to UI');

-- Negative balance blocks PIKAS Cash purchases until legitimate replenishments restore enough
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select throws_ok($$select pg_temp.sale('5c2-wallet-sale-00002')$$,'23514','INSUFFICIENT_BALANCE','Negative balance blocks purchase');
select is((get_pos_customer_purchase_context('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000006901')->'wallet'->>'balance_minor'),'-5000','POS context reports the negative balance');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select pg_temp.credit(2000,'5c200000-0000-4000-8000-000000000003');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select throws_ok($$select pg_temp.sale('5c2-wallet-sale-00003')$$,'23514','INSUFFICIENT_BALANCE','Still negative: still blocked');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select pg_temp.credit(10000,'5c200000-0000-4000-8000-000000000004');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select lives_ok($$select pg_temp.sale('5c2-wallet-sale-00004')$$,'Restored balance allows purchase');
reset role; select is(pg_temp.balance(),2000::bigint,'-5000 + 2000 + 10000 - 5000');

-- Cross-school: a School Admin of school 11 cannot reverse a school 12 replenishment
insert into persons(id,display_name) values('5c200000-0000-4000-8000-000000000012','Estudiante escuela 12');
insert into students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name) values('5c200000-0000-4000-8000-000000000112','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','5c200000-0000-4000-8000-000000000012','R12','Estudiante','escuela 12','Estudiante escuela 12');
insert into student_enrollments(account_id,school_id,student_id,starts_on) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','5c200000-0000-4000-8000-000000000112','2026-01-01');
select pg_temp.as_user('00000000-0000-0000-0000-000000002005');
select set_config('t.r12',(school_wallet_replenish('00000000-0000-0000-0000-000000000012','5c200000-0000-4000-8000-000000000112',1000,'5c200000-0000-4000-8000-000000000005','Ref','Verificado')->>'replenishment_id'),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select throws_ok($$select school_wallet_reverse_replenishment('00000000-0000-0000-0000-000000000012','5c200000-0000-4000-8000-000000000112',current_setting('t.r12')::uuid,'wrong_amount',null,'5c200000-0000-4000-8000-0000000000e1')$$,'42501',null,'Cross-school reversal denied');
select throws_ok($$select school_wallet_reverse_replenishment('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',current_setting('t.r12')::uuid,'wrong_amount',null,'5c200000-0000-4000-8000-0000000000e2')$$,'42501',null,'Foreign replenishment through own school denied');

-- Suspended authority
reset role; update school_memberships set status='suspended' where person_id='00000000-0000-0000-0000-000000001002';
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select throws_ok($$select pg_temp.reverse(current_setting('t.r1')::uuid,'5c200000-0000-4000-8000-0000000000d1','wrong_student','Estudiante equivocado')$$,'42501',null,'Suspended School Admin cannot reverse or replay');

-- Sandbox POV
reset role;
select set_config('t.sandbox_school',(select school_id::text from pikas_private.sandbox_pov_personas where pov_code='school_admin' limit 1),true);
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select platform_enter_sandbox_pov(gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe','school_admin');
select is(school_wallet_access(current_setting('t.sandbox_school')::uuid)->>'reverse','false','Sandbox POV has no reversal authority');
reset role;
set constraints all immediate;
select * from finish();
rollback;
