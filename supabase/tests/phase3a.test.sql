begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity),39::bigint,
  'RLS is enabled on all Phase 1 through Phase 4C public tables');
select is((select count(*) from pg_policies where schemaname='public' and cmd<>'SELECT'),0::bigint,
  'No direct authenticated write policies exist');
select ok(not has_table_privilege('authenticated','public.student_wallets','UPDATE') and
  not has_table_privilege('authenticated','public.wallet_ledger_entries','INSERT') and
  not has_table_privilege('authenticated','public.wallet_adjustments','DELETE') and
  not has_table_privilege('service_role','public.student_wallets','SELECT'),
  'Client and service roles have no direct wallet mutation or financial read grants');
select is((select count(*) from supported_currencies where status='enabled'),1::bigint,
  'Only the pilot currency is enabled');
select is((select minor_unit_exponent from supported_currencies where currency_code='DOP'),2::smallint,
  'DOP uses two minor-unit digits');
select throws_ok($$update supported_currencies set minor_unit_exponent=0 where currency_code='DOP'$$,
  '23514',null,'Currency exponent is immutable for historical financial values');
select is((select current_balance_minor from student_wallets where id='00000000-0000-0000-0000-000000007001'),0::bigint,
  'Synthetic student wallet starts at zero without an opening ledger event');
select is((select count(*) from student_wallets where student_id='00000000-0000-0000-0000-000000005201'),1::bigint,
  'Student retains one school wallet despite campus placement history');
select is((select count(*) from student_wallets where student_id='00000000-0000-0000-0000-000000005202'),0::bigint,
  'Student identity does not automatically create a wallet');
select ok(exists(select 1 from pikas_private.role_capabilities where scope_kind='school' and role_code='school_admin' and capability='school:wallets:read')
  and exists(select 1 from pikas_private.role_capabilities where scope_kind='school' and role_code='school_admin' and capability='school:wallets:adjust'),
  'School Admin has explicit wallet read and adjustment capabilities');
select ok(exists(select 1 from pikas_private.role_capabilities where scope_kind='cafeteria' and role_code='cafeteria_admin' and capability='cafeteria:wallets:replenish')
  and not exists(select 1 from pikas_private.role_capabilities where scope_kind='cafeteria' and role_code='cafeteria_admin' and capability='cafeteria:wallets:adjust')
  and not exists(select 1 from pikas_private.role_capabilities where scope_kind='cafeteria' and role_code='pos_operator' and capability like '%wallet%'),
  'Cafeteria Admin can replenish only; POS receives no wallet capability');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','pikas_private') and p.prosecdef and not ('search_path=""'=any(p.proconfig))),0::bigint,
  'All Phase 3A SECURITY DEFINER functions pin an empty search path');
select ok(not has_function_privilege('anon','public.post_manual_wallet_replenishment(uuid,bigint,text,text,text,uuid)','EXECUTE') and
  not has_function_privilege('service_role','public.post_student_wallet_adjustment(uuid,bigint,text,text,text,text)','EXECUTE'),
  'Anonymous and service roles cannot invoke Phase 3A mutations');

select throws_ok($$insert into student_wallets(account_id,school_id,student_id,currency_code)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005201','USD')$$,'23503',null,'Unsupported currency cannot be assigned to wallet');
select throws_ok($$insert into student_wallets(account_id,school_id,student_id,currency_code)
  values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005202','DOP')$$,'23503',null,'Wallet cannot cross account/school ancestry');
select throws_ok($$insert into student_wallets(account_id,school_id,student_id,currency_code)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005201','DOP')$$,'23505',null,'Student has at most one wallet per currency');
select throws_ok($$update student_wallets set student_id='00000000-0000-0000-0000-000000005202'
  where id='00000000-0000-0000-0000-000000007001'$$,'23514',null,'Wallet student identity is immutable');
select throws_ok($$update student_wallets set currency_code='USD'
  where id='00000000-0000-0000-0000-000000007001'$$,'23514',null,'Wallet currency is immutable');
select throws_ok($$update student_wallets set current_balance_minor=-1
  where id='00000000-0000-0000-0000-000000007001'$$,'23514',null,'Wallet cannot have a negative balance');

insert into auth.users(id,aud,role,email)
values('00000000-0000-0000-0000-000000002013','authenticated','authenticated','wallet-student@example.invalid');
insert into public.persons(id,auth_user_id,display_name)
values('00000000-0000-0000-0000-000000005106','00000000-0000-0000-0000-000000002013','Wallet Creation Student');
insert into public.students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name)
values('00000000-0000-0000-0000-000000005204','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005106','WAL-004','Wallet','Creation','Wallet Creation Student');
insert into public.student_enrollments(id,account_id,school_id,student_id,starts_on)
values('00000000-0000-0000-0000-000000005305','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005204',current_date);

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select is((select count(*) from student_wallets),1::bigint,'School Admin reads only wallets in own school');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002006',true);
set local role authenticated;
select is((select count(*) from student_wallets),0::bigint,'Other-account School Admin cannot read wallet records');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select public.create_student_wallet('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005204','DOP')$$,
  'School Admin explicitly provisions a zero-balance wallet');
select lives_ok($$select public.create_student_wallet('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005204','DOP')$$,
  'Wallet provisioning retry returns the existing wallet');
select set_config('phase3a.test_wallet_202',(select wallet_id::text from public.create_student_wallet(
  '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005204','DOP')),true);
select is((select count(*) from student_wallets where student_id='00000000-0000-0000-0000-000000005204' and currency_code='DOP'),1::bigint,
  'Idempotent provisioning does not create duplicate wallets');
select is((select current_balance_minor from student_wallets where student_id='00000000-0000-0000-0000-000000005204'),0::bigint,
  'Wallet provisioning never fabricates an opening balance');
select ok(exists(select 1 from audit_events where target_type='student_wallets' and action='wallet_created'
  and actor_person_id='00000000-0000-0000-0000-000000001002' and actor_role='school_admin'
  and school_id='00000000-0000-0000-0000-000000000011'),
  'Wallet creation produces scoped administrative audit');
select throws_ok($$select public.create_student_wallet('00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000005204','DOP')$$,
  '42501',null,'School Admin cannot create a wallet in another tenant');
select throws_ok($$select public.create_student_wallet('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005204','USD')$$,
  '22023',null,'Wallet RPC rejects unsupported currency');
select lives_ok($$select public.post_manual_wallet_replenishment(current_setting('phase3a.test_wallet_202')::uuid,
  100,'auth-history-replenishment-01','AUTH-REF-01','Synthetic verified funding')$$,
  'Provisioned wallet receives a synthetic financial history entry before Auth unlink');

select lives_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  50000,'replenishment-key-0001','BANK-REF-001','Synthetic transfer verified')$$,
  'School Admin posts verified manual replenishment');
select is((select current_balance_minor from student_wallets where id='00000000-0000-0000-0000-000000007001'),50000::bigint,
  'Replenishment increments the wallet balance exactly');
select is((select count(*) from wallet_replenishments where idempotency_key='replenishment-key-0001'),1::bigint,
  'Replenishment operation is persisted once');
select is((select count(*) from wallet_ledger_entries where replenishment_id=(select id from wallet_replenishments where idempotency_key='replenishment-key-0001')),1::bigint,
  'Posted replenishment has exactly one ledger entry');
select is((select amount_minor from wallet_ledger_entries where replenishment_id=(select id from wallet_replenishments where idempotency_key='replenishment-key-0001')),50000::bigint,
  'Ledger records the exact positive minor-unit movement');
select is((select initiated_by=verified_by from wallet_replenishments where idempotency_key='replenishment-key-0001'),true,
  'Pilot allows the same authorized person to initiate and verify');
select is((select current_balance_minor=balance_after_minor and balance_version=1 from student_wallets w
  join wallet_ledger_entries l on l.wallet_id=w.id where l.replenishment_id=(select id from wallet_replenishments where idempotency_key='replenishment-key-0001')),
  true,'Stored balance and version match the ledger movement');
select lives_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  50000,'replenishment-key-0001','BANK-REF-001','Synthetic transfer verified')$$,
  'Identical replenishment retry returns the prior posted operation');
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  60000,'replenishment-key-0001','BANK-REF-001','Synthetic transfer verified')$$,
  '23505',null,'Changed replenishment payload cannot reuse its idempotency key');
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  '9223372036854775807'::bigint,'replenishment-overflow-key-001','BANK-REF-MAX','Overflow')$$,
  '22003',null,'Replenishment that would overflow bigint balance is rejected');
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  0,'replenishment-key-zero-001','BANK-REF-0','Zero')$$,'22023',null,'Zero replenishment is rejected');
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  -100,'replenishment-key-neg-001','BANK-REF-N','Negative')$$,'22023',null,'Negative replenishment is rejected');
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  100,'replenishment-key-note-001',null,null)$$,'23514',null,'Manual replenishment requires verification evidence');
select is((select count(*) from wallet_replenishments where idempotency_key in ('replenishment-key-zero-001','replenishment-key-neg-001','replenishment-key-note-001')),0::bigint,
  'Rejected replenishments leave no financial rows');

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  1500,'cafe-replenishment-key-01','CAF-REF-01','Verified at Cafeteria A','00000000-0000-0000-0000-000000006901')$$,
  'Cafeteria Admin posts replenishment for an exact active cafeteria customer');
reset role;
select is((select cafeteria_id from wallet_replenishments where idempotency_key='cafe-replenishment-key-01'),
  '00000000-0000-0000-0000-000000000111'::uuid,'Cafeteria-origin replenishment records exact cafeteria context');
select ok(exists(select 1 from audit_events where target_type='wallet_replenishments' and action='wallet_replenishment_posted'
  and actor_person_id='00000000-0000-0000-0000-000000001003' and actor_role='cafeteria_admin'
  and actor_scope_kind='cafeteria' and cafeteria_id='00000000-0000-0000-0000-000000000111'),
  'Cafeteria replenishment audit is exact-cafeteria scoped');
update public.cafeteria_memberships set status='suspended' where id='00000000-0000-0000-0000-000000003201';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  1000,'suspended-cafe-replenishment-01','REF-SUSP','Suspended membership','00000000-0000-0000-0000-000000006901')$$,
  '42501',null,'Suspended cafeteria membership cannot replenish');
reset role;
update public.cafeteria_memberships set status='active' where id='00000000-0000-0000-0000-000000003201';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select throws_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  1000,'administrative_correction','cafe-adjustment-denied-01','REF-CA','Cafeteria Admin denied')$$,
  '42501',null,'Cafeteria Admin replenishment authority does not grant adjustment authority');
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  1000,'cafe-no-customer-key-001','REF-02','Wrong customer','00000000-0000-0000-0000-000000006902')$$,
  '42501',null,'Cafeteria Admin cannot replenish a staff customer as student wallet');
select throws_ok($$select public.post_manual_wallet_replenishment(current_setting('phase3a.test_wallet_202')::uuid,
  1000,'cafe-other-student-key-01','REF-03','No customer')$$,
  '42501',null,'Cafeteria Admin cannot replenish another student without exact customer access');
select is((select count(*) from student_wallets),0::bigint,'Cafeteria Admin cannot directly read student wallets');
select is((select count(*) from wallet_ledger_entries),0::bigint,'Cafeteria Admin cannot directly read wallet ledger');

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002004',true);
set local role authenticated;
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  1000,'cafe-b-replenishment-key1','REF-B','Wrong school','00000000-0000-0000-0000-000000006901')$$,
  '42501',null,'Sibling-school cafeteria admin cannot replenish Cafeteria A student');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  1000,'pos-replenishment-key-001','REF-POS','Cashier denied','00000000-0000-0000-0000-000000006901')$$,
  '42501',null,'POS operator cannot replenish wallets');
select is((select count(*) from student_wallets),0::bigint,'POS operator cannot read student wallets');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002001',true);
set local role authenticated;
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  1000,'account-replenishment-key1','REF-ACCT','Account admin denied')$$,
  '42501',null,'Account Admin has no implicit financial mutation authority');
select is((select count(*) from student_wallets),0::bigint,'Account Admin has no implicit wallet data access');

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  2500,'administrative_correction','adjustment-key-positive-01','CASE-100','Synthetic correction')$$,
  'School Admin posts explicit positive adjustment');
select lives_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  -1000,'reconciliation_correction','adjustment-key-negative-01','CASE-101','Synthetic correction')$$,
  'School Admin posts explicit negative adjustment');
select is((select current_balance_minor from student_wallets where id='00000000-0000-0000-0000-000000007001'),53000::bigint,
  'Positive and negative adjustments update balance exactly');
select is((select count(*) from wallet_ledger_entries where adjustment_id in
  (select id from wallet_adjustments where idempotency_key in ('adjustment-key-positive-01','adjustment-key-negative-01'))),2::bigint,
  'Every posted adjustment has one immutable ledger movement');
select throws_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  -53001,'administrative_correction','adjustment-key-overdraw-01','CASE-102','Too large')$$,
  '23514',null,'Negative adjustment cannot overdraw wallet');
select throws_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  '9223372036854775807'::bigint,'administrative_correction','adjustment-overflow-key-01','CASE-MAX','Overflow')$$,
  '22003',null,'Positive adjustment that would overflow bigint balance is rejected');
select throws_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  '-9223372036854775808'::bigint,'administrative_correction','adjustment-underflow-key-01','CASE-MIN','Underflow')$$,
  '23514',null,'Minimum bigint negative adjustment is rejected without arithmetic overflow');
select throws_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  0,'administrative_correction','adjustment-key-zero-0001','CASE-103','Zero')$$,
  '22023',null,'Zero adjustment is rejected');
select throws_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  1,'other_authorized_correction','adjustment-key-other-001',null,null)$$,
  '23514',null,'Other adjustment requires explanatory evidence');
select lives_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  1,'other_authorized_correction','adjustment-key-other-002',null,'Approved test explanation')$$,
  'Other adjustment succeeds only with explanatory evidence');
select lives_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  2500,'administrative_correction','adjustment-key-positive-01','CASE-100','Synthetic correction')$$,
  'Identical adjustment retry returns the committed adjustment');
select throws_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  3000,'administrative_correction','adjustment-key-positive-01','CASE-100','Synthetic correction')$$,
  '23505',null,'Changed adjustment payload cannot reuse its idempotency key');
select is((select count(*) from wallet_adjustments where idempotency_key='adjustment-key-positive-01'),1::bigint,
  'Adjustment retry creates no duplicate operation');
select ok(exists(select 1 from audit_events where target_type='wallet_adjustments' and action='wallet_adjustment_posted'
  and actor_person_id='00000000-0000-0000-0000-000000001002' and actor_role='school_admin'
  and school_id='00000000-0000-0000-0000-000000000011'),
  'Adjustment produces scoped audit without duplicating financial amount');
select ok(not exists(select 1 from audit_events where target_type in ('wallet_replenishments','wallet_adjustments')
  and after_metadata ?| array['amount_minor','reference','verification_note','explanatory_note']),
  'Financial audit omits amounts and free-text evidence');

reset role;
select throws_ok($test$do $wallet_test$
declare operation_id uuid:='00000000-0000-0000-0000-000000009901';
begin
  insert into public.wallet_replenishments(id,account_id,school_id,wallet_id,currency_code,amount_minor,source,status,
    initiated_by,verified_by,initiated_at,verified_at,posted_at,idempotency_key,payload_fingerprint)
  values(operation_id,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
    current_setting('phase3a.test_wallet_202')::uuid,'DOP',100,'manual_verified','posted',
    '00000000-0000-0000-0000-000000001002','00000000-0000-0000-0000-000000001002',
    clock_timestamp(),clock_timestamp(),clock_timestamp(),'wrong-ledger-test-key-001',repeat('a',64));
  insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,
    balance_after_minor,balance_version_after,replenishment_id)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
    current_setting('phase3a.test_wallet_202')::uuid,'DOP','replenishment',99,199,2,operation_id);
  set constraints wallet_replenishment_requires_ledger immediate;
end $wallet_test$$test$,'23514',null,'Deferred ledger constraint rejects amount mismatch atomically');
select is((select count(*) from wallet_replenishments where id='00000000-0000-0000-0000-000000009901'),0::bigint,
  'Rejected operation/ledger mismatch leaves no replenishment row');
select is((select count(*) from wallet_ledger_entries where replenishment_id='00000000-0000-0000-0000-000000009901'),0::bigint,
  'Rejected operation/ledger mismatch leaves no ledger row');

reset role;
update public.supported_currencies set status='disabled' where currency_code='DOP';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  1000,'disabled-currency-replenishment-01','DOP-OFF','Currency disabled')$$,
  '22023',null,'Disabled currency blocks new replenishment');
select throws_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  1000,'administrative_correction','disabled-currency-adjustment-01','DOP-OFF','Currency disabled')$$,
  '22023',null,'Disabled currency blocks new adjustment');
select is((select is_reconciled from reconcile_student_wallet('00000000-0000-0000-0000-000000007001')),
  true,'Disabled currency does not invalidate historical wallet reconciliation');
reset role;
update public.supported_currencies set status='enabled' where currency_code='DOP';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select is((select is_reconciled from reconcile_student_wallet('00000000-0000-0000-0000-000000007001')),
  true,'School Admin reconciliation matches stored wallet and ledger');
select is((select ledger_balance_minor from reconcile_student_wallet('00000000-0000-0000-0000-000000007001')),
  53001::bigint,'Ledger sum includes replenishments and signed adjustments');
reset role;
update public.student_wallets set current_balance_minor=current_balance_minor+1
  where id='00000000-0000-0000-0000-000000007001';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select is((select is_reconciled from reconcile_student_wallet('00000000-0000-0000-0000-000000007001')),
  false,'Reconciliation detects balance drift without repairing it');
reset role;
update public.student_wallets set current_balance_minor=current_balance_minor-1
  where id='00000000-0000-0000-0000-000000007001';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002004',true);
set local role authenticated;
select throws_ok($$select * from reconcile_student_wallet('00000000-0000-0000-0000-000000007001')$$,
  '42501',null,'Cafeteria Admin cannot reconcile or inspect student wallet balance');
select is((select count(*) from wallet_replenishments),0::bigint,'Cafeteria Admin cannot read replenishment base table');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select public.set_student_wallet_status('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000007001','frozen')$$,
  'School Admin freezes wallet');
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  1000,'frozen-replenishment-key-01','REF-FROZEN','Frozen wallet')$$,
  '23514',null,'Frozen wallet blocks replenishment');
select lives_ok($$select public.set_student_wallet_status('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000007001','active')$$,
  'School Admin may explicitly unfreeze wallet');
select ok(exists(select 1 from audit_events where target_type='student_wallets' and action='wallet_status_changed'
  and actor_person_id='00000000-0000-0000-0000-000000001002' and actor_scope_kind='school'
  and school_id='00000000-0000-0000-0000-000000000011' and after_metadata->>'status'='active'),
  'Wallet status change is attributed and audited in school scope');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select public.withdraw_student_enrollment('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005302',current_date)$$,
  'School Admin withdraws a student without deleting the wallet');
select is((select current_balance_minor from student_wallets where id='00000000-0000-0000-0000-000000007001'),53001::bigint,
  'Withdrawal itself preserves wallet balance');
select lives_ok($$select public.post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',
  -1,'reconciliation_correction','withdrawn-adjustment-key-01','CASE-WD-01','Correction after withdrawal')$$,
  'School Admin may post an audited correction to an active identity after withdrawal');
select is((select current_balance_minor from student_wallets where id='00000000-0000-0000-0000-000000007001'),53000::bigint,
  'Post-withdrawal adjustment is reflected in wallet balance');
select ok(exists(select 1 from audit_events where target_type='wallet_adjustments'
  and after_metadata->>'reason_code'='reconciliation_correction' and actor_person_id='00000000-0000-0000-0000-000000001002'
  and school_id='00000000-0000-0000-0000-000000000011'),
  'Post-withdrawal correction remains attributable and audited');
select lives_ok($$select public.set_student_status('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201','inactive')$$,
  'School Admin marks withdrawn student inactive while retaining wallet history');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select throws_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',
  1000,'withdrawn-replenishment-key-01','REF-WD','Student withdrawn','00000000-0000-0000-0000-000000006901')$$,
  '23514',null,'Withdrawal blocks ordinary cafeteria replenishment');
reset role;

delete from auth.users where id='00000000-0000-0000-0000-000000002013';
select is((select auth_user_id from persons where id='00000000-0000-0000-0000-000000005106'),null::uuid,
  'Auth unlink preserves person identity');
select is((select count(*) from students s join student_wallets w on w.student_id=s.id
  where s.id='00000000-0000-0000-0000-000000005204'),1::bigint,'Auth unlink preserves student wallet');
select is((select current_balance_minor from student_wallets where student_id='00000000-0000-0000-0000-000000005204'),100::bigint,
  'Auth unlink preserves wallet balance');
select is((select count(*) from wallet_replenishments where wallet_id=(select id from student_wallets where student_id='00000000-0000-0000-0000-000000005204')),1::bigint,
  'Auth unlink preserves replenishment history');
select is((select count(*) from wallet_ledger_entries where wallet_id=(select id from student_wallets where student_id='00000000-0000-0000-0000-000000005204')),1::bigint,
  'Auth unlink preserves immutable wallet ledger history');
select is((select count(*) from student_enrollments where student_id='00000000-0000-0000-0000-000000005204'),1::bigint,
  'Auth unlink preserves enrollment history');

select throws_ok($$update wallet_replenishments set amount_minor=1 where id=(select id from wallet_replenishments limit 1)$$,
  '23514',null,'Posted replenishment is immutable');
select throws_ok($$delete from wallet_adjustments where id=(select id from wallet_adjustments limit 1)$$,
  '23514',null,'Posted adjustment is immutable');
select throws_ok($$update wallet_ledger_entries set amount_minor=1 where id=(select id from wallet_ledger_entries limit 1)$$,
  '23514',null,'Wallet ledger is immutable');
select throws_ok($$delete from wallet_ledger_entries where id=(select id from wallet_ledger_entries limit 1)$$,
  '23514',null,'Wallet ledger entries cannot be deleted');
reset role;
grant update,truncate on public.student_wallets to authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
with changed as (update public.student_wallets set current_balance_minor=1
  where id='00000000-0000-0000-0000-000000007001' returning id)
select is(count(*),0::bigint,'RLS denies raw balance mutation even after UPDATE grant is broadened') from changed;
select throws_ok($$truncate public.student_wallets$$,'0A000',null,
  'Foreign-key references reject wallet truncation despite broadened TRUNCATE grant');
reset role;
revoke update,truncate on public.student_wallets from authenticated;
select * from finish();
rollback;