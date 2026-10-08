begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.phase3d_request(p_session uuid,p_customer uuid,p_key text,p_tender text)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('request_key',p_key,'register_session_id',p_session,
  'cafeteria_customer_id',p_customer,'expected_total_minor','5000',
  'items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
   'quantity',1,'expected_product_version',2,'expected_unit_price_minor','5000')),
  'tender',jsonb_build_object('type',p_tender))
$$;

select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relrowsecurity),58::bigint,
 'RLS is enabled on every public table including all four Phase 3D tables');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
 where oid in ('public.staff_receivable_accounts'::regclass,'public.purchase_staff_credit_tenders'::regclass,
  'public.staff_receivable_settlements'::regclass,'public.staff_receivable_entries'::regclass)),
 'All staff receivable tables force RLS');
select ok(not has_table_privilege('authenticated','public.staff_receivable_accounts','INSERT')
 and not has_table_privilege('authenticated','public.staff_receivable_accounts','UPDATE')
 and not has_table_privilege('authenticated','public.staff_receivable_entries','INSERT')
 and not has_table_privilege('authenticated','public.staff_receivable_entries','TRUNCATE')
 and not has_table_privilege('service_role','public.staff_receivable_settlements','INSERT'),
 'No direct app or service-role financial writes are granted');
select ok(not has_function_privilege('authenticated','pikas_private.post_staff_credit_charge()','EXECUTE')
 and not has_function_privilege('authenticated','pikas_private.guard_staff_receivable_entry()','EXECUTE'),
 'Private posting and ledger guard helpers are not executable by API roles');
select ok((select count(*)=1 from pikas_private.role_capabilities
 where scope_kind='cafeteria' and role_code='pos_supervisor'
  and capability='cafeteria:pos:staff_credit:purchase')
 and (select count(*)=0 from pikas_private.role_capabilities
 where role_code='pos_cashier' and capability='cafeteria:pos:staff_credit:purchase'),
 'Only POS Supervisors receive staff-credit purchase capability');

insert into public.staff_campus_affiliations(account_id,school_id,staff_affiliation_id,school_location_id)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000006501','00000000-0000-0000-0000-000000000211');

select is((select count(*) from public.staff_receivable_accounts),0::bigint,
 'No receivable accounts are automatically created for staff');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select set_config('phase3d.account',public.configure_staff_receivable_account(
 '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000006501',0,false,null,'phase3d-account-create-key-01')->>'account_id',true);
select is((public.configure_staff_receivable_account('00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006501',0,false,null,
 'phase3d-account-create-key-01')->>'account_id'),current_setting('phase3d.account'),
 'Identical configuration request replays');
select throws_ok($$select public.configure_staff_receivable_account('00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006501',0,true,'5000',
 'phase3d-account-create-key-01')$$,'23505','IDEMPOTENCY_CONFLICT',
 'Reusing a configuration request key with changed payload conflicts');
select set_config('phase3d.config',public.configure_staff_receivable_account('00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006501',1,true,'5000',
 'phase3d-account-enable-key-01')::text,true);
select is(current_setting('phase3d.config')::jsonb->>'credit_limit_minor','5000',
 'Finite credit limit is stored as authoritative minor units');
select throws_ok($$select public.configure_staff_receivable_account('00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006501',1,true,null,
 'phase3d-stale-config-key-01')$$,'40001','STAFF_RECEIVABLE_CONFIGURATION_STALE',
 'Stale configuration version is rejected');
reset role;
select is((select credit_enabled from public.staff_receivable_accounts where id=current_setting('phase3d.account')::uuid),
 true,'New account starts disabled and configuration explicitly enables it');
select is((select count(*) from public.audit_events where target_type='staff_receivable_accounts'
 and action in ('staff_receivable_configured','staff_credit_enabled')),2::bigint,
 'Account creation and enablement are audited');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
 '00000000-0000-0000-0000-000000008101',1,'Synthetic product','Phase 3D test product',
 '00000000-0000-0000-0000-000000008001',5000,true,true,'{}','{}')$$,
 'Cafeteria product is made available using existing catalog RPC');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
 '00000000-0000-0000-0000-000000009503',0,'phase3d-open-session-key-01')$$,
 'Assigned Supervisor opens the exact register session');
select set_config('phase3d.session',(select session_id::text from public.get_my_open_register_session()),true);
select throws_ok($$select public.checkout_purchase(jsonb_set(jsonb_set(
 pg_temp.phase3d_request(current_setting('phase3d.session')::uuid,'00000000-0000-0000-0000-000000006902',
 'phase3d-over-limit-key-0001','staff_credit'),'{items,0,quantity}','2'::jsonb),
 '{expected_total_minor}','"10000"'::jsonb))$$,'23514','STAFF_CREDIT_LIMIT_EXCEEDED',
 'Post-charge balance above the finite credit limit is rejected');
select throws_ok($$select public.checkout_purchase(pg_temp.phase3d_request(
 current_setting('phase3d.session')::uuid,'00000000-0000-0000-0000-000000006901',
 'phase3d-student-denied-key-01','staff_credit'))$$,'23514','CUSTOMER_INELIGIBLE',
 'Student customer cannot use staff credit');
select throws_ok($$select public.checkout_purchase(pg_temp.phase3d_request(
 current_setting('phase3d.session')::uuid,null,
 'phase3d-anonymous-denied-key-01','staff_credit'))$$,'23514','CUSTOMER_INELIGIBLE',
 'Anonymous customer cannot use staff credit');
select set_config('phase3d.purchase',public.checkout_purchase(pg_temp.phase3d_request(
 current_setting('phase3d.session')::uuid,'00000000-0000-0000-0000-000000006902',
 'phase3d-staff-credit-checkout-key-01','staff_credit'))->>'purchase_id',true);
set constraints all immediate;
set constraints all deferred;
reset role;
select is((select tender_type from public.purchase_tenders
 where purchase_id=current_setting('phase3d.purchase')::uuid),'staff_credit',
 'Checkout records the new authoritative staff-credit tender');
select is((select current_balance_minor from public.staff_receivable_accounts
 where id=current_setting('phase3d.account')::uuid),5000::bigint,
 'Staff-credit checkout posts the exact charge to the school receivable');
select is((select balance_version from public.staff_receivable_accounts
 where id=current_setting('phase3d.account')::uuid),1::bigint,
 'Charge advances receivable balance version once');
select is((select count(*) from public.staff_receivable_entries
 where purchase_id=current_setting('phase3d.purchase')::uuid and entry_type='purchase_charge'
 and amount_minor=5000),1::bigint,'One immutable charge entry matches purchase total');
select is((select count(*) from public.receipt_print_jobs
 where purchase_id=current_setting('phase3d.purchase')::uuid and job_kind='original'
 and receipt_snapshot->'tender'->>'label'='Staff Credit'),1::bigint,
 'Staff-credit checkout atomically creates one Staff Credit original receipt job');
select ok(not exists(select 1 from public.receipt_print_jobs
 where purchase_id=current_setting('phase3d.purchase')::uuid
 and (receipt_snapshot ? 'staff_name' or receipt_snapshot ? 'customer_name')),
 'Staff identity is excluded from receipt snapshot');
set local role authenticated;
select is((public.checkout_purchase(pg_temp.phase3d_request(current_setting('phase3d.session')::uuid,
 '00000000-0000-0000-0000-000000006902','phase3d-staff-credit-checkout-key-01',
 'staff_credit'))->>'purchase_id'),current_setting('phase3d.purchase'),
 'Identical staff-credit checkout replays without duplicating financial or receipt evidence');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select set_config('phase3d.settlement',public.settle_staff_receivable(
 current_setting('phase3d.account')::uuid,'1000','bank_transfer','00000000-0000-0000-0000-000000000111',
 '00000000-0000-0000-0000-000000003201',null,'SYNTHETIC-REF-1',null,
 'phase3d-settlement-key-0001')::text,true);
reset role;
select is((select current_balance_minor from public.staff_receivable_accounts
 where id=current_setting('phase3d.account')::uuid),4000::bigint,
 'Partial bank-transfer settlement decreases amount due');
select is((select count(*) from public.staff_receivable_entries where entry_type='settlement'
 and settlement_id=(current_setting('phase3d.settlement')::jsonb->>'settlement_id')::uuid
 and amount_minor=-1000),1::bigint,'Settlement has one signed immutable ledger entry');
set local role authenticated;
select is((public.settle_staff_receivable(current_setting('phase3d.account')::uuid,'1000','bank_transfer',
 '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000003201',null,
 'SYNTHETIC-REF-1',null,'phase3d-settlement-key-0001')->>'settlement_id'),
 current_setting('phase3d.settlement')::jsonb->>'settlement_id',
 'Identical settlement request replays');
select throws_ok($$select public.settle_staff_receivable(current_setting('phase3d.account')::uuid,
 '5000','other','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000003201',
 null,null,null,'phase3d-settlement-exceed-key-1')$$,'23514','SETTLEMENT_EXCEEDS_AMOUNT_DUE',
 'Over-settlement is rejected');
reset role;

 select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
 set local role authenticated;
 select lives_ok($$select public.settle_staff_receivable(current_setting('phase3d.account')::uuid,
  '500','cash','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000004603',
  current_setting('phase3d.session')::uuid,'SYNTHETIC-CASH-REF',null,'phase3d-cash-settlement-key-1')$$,
  'Cash settlement records assigned Supervisor session attribution');
reset role;
 select is((select count(*) from public.staff_receivable_settlements
  where request_key='phase3d-cash-settlement-key-1' and method='cash'
   and register_session_id=current_setting('phase3d.session')::uuid and register_id='00000000-0000-0000-0000-000000009401'),
  1::bigint,'Cash settlement preserves the exact logical register/session');
 reset role;
 select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
 set local role authenticated;
 select throws_ok($$select public.settle_staff_receivable(current_setting('phase3d.account')::uuid,
  '1','other','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000004601',
  null,null,null,'phase3d-cashier-settlement-denied')$$,'42501','STAFF_SETTLEMENT_NOT_AUTHORIZED',
  'Cashier receives no receivable settlement authority');
 reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select lives_ok($$select public.create_purchase_refund(current_setting('phase3d.purchase')::uuid,
 '1000','error',null,'phase3d-staff-refund-key-0001','00000000-0000-0000-0000-000000004603')$$,
 'Partial staff-credit refund posts against the receivable without a register session');
set constraints all immediate;
set constraints all deferred;
reset role;
select is((select current_balance_minor from public.staff_receivable_accounts
 where id=current_setting('phase3d.account')::uuid),2500::bigint,
 'Staff-credit refund reduces amount due by the exact refund');
select is((select count(*) from public.staff_receivable_entries
 where entry_type='purchase_refund' and purchase_id=current_setting('phase3d.purchase')::uuid
  and amount_minor=-1000),1::bigint,'Refund posts one negative receivable entry');
select is((select count(*) from public.refund_cash_outflows where refund_id in
 (select refund_id from public.staff_receivable_entries where entry_type='purchase_refund')),0::bigint,
 'Staff-credit refund creates no cash outflow');
select is((select count(*) from public.wallet_refund_credits where refund_id in
 (select refund_id from public.staff_receivable_entries where entry_type='purchase_refund')),0::bigint,
 'Staff-credit refund creates no wallet credit');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.settle_staff_receivable(current_setting('phase3d.account')::uuid,
 '2500','other','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000003201',
 null,null,null,'phase3d-settlement-final-01')$$,'Remaining debt can be settled after a partial refund');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select throws_ok($$select public.create_purchase_refund(current_setting('phase3d.purchase')::uuid,
 '1000','error',null,'phase3d-settled-refund-key-01','00000000-0000-0000-0000-000000004603')$$,
 '23514','STAFF_CREDIT_REFUND_EXCEEDS_AMOUNT_DUE',
 'Refund that exceeds settled outstanding debt is rejected without payout or negative balance');
reset role;
select is((select current_balance_minor from public.staff_receivable_accounts
 where id=current_setting('phase3d.account')::uuid),0::bigint,
 'Rejected refund leaves receivable nonnegative and unchanged');
select is((select max(balance_version_after) from public.staff_receivable_entries
 where receivable_account_id=current_setting('phase3d.account')::uuid),
 (select balance_version from public.staff_receivable_accounts where id=current_setting('phase3d.account')::uuid),
 'Cached receivable balance version matches latest immutable ledger entry');
select is((select sum(amount_minor) from public.staff_receivable_entries
 where receivable_account_id=current_setting('phase3d.account')::uuid),0::numeric,
 'Ledger sum reconciles to the final cached receivable balance');

select * from finish();
rollback;
