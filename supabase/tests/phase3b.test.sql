begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.phase3b_request(p_session uuid,p_customer uuid,p_key text,p_items jsonb,
  p_tender text,p_cash bigint default null,p_expected_total bigint default null)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare request_value jsonb;
begin
  request_value:=jsonb_build_object('request_key',p_key,'register_session_id',p_session,
    'cafeteria_customer_id',p_customer,'items',p_items,
    'tender',case when p_tender='cash' then jsonb_build_object('type','cash','cash_received_minor',p_cash::text)
      else jsonb_build_object('type',p_tender) end);
  if p_expected_total is not null then
    request_value:=request_value||jsonb_build_object('expected_total_minor',p_expected_total::text);
  end if;
  return request_value;
end $$;

select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity),58::bigint,
  'RLS is enabled on all public tables through Phase 5B');
select is((select count(*) from public.purchases),0::bigint,'No purchase history is fabricated by fixtures');
select is((select count(*) from public.purchase_items),0::bigint,'No purchase items are fabricated');
select is((select count(*) from public.purchase_tenders),0::bigint,'No tenders are fabricated');
select is((select count(*) from public.cafeteria_purchase_counters where last_purchase_number<>0),0::bigint,
  'Each synthetic cafeteria counter begins at zero');
select is((select count(*) from public.cafeteria_purchase_counters),4::bigint,
  'Counter rows are initialized for every existing cafeteria');
select is((select count(*) from public.student_spending_controls),0::bigint,
  'No spending control means no configured limit');
select is((select count(*) from public.wallet_purchase_debits),0::bigint,
  'No wallet purchase debits are fabricated');
select is((select count(*) from public.student_daily_spend_events),0::bigint,
  'No daily spend is fabricated');
select ok(not has_table_privilege('authenticated','public.purchases','INSERT')
  and not has_table_privilege('authenticated','public.purchases','UPDATE')
  and not has_table_privilege('authenticated','public.purchases','DELETE')
  and not has_table_privilege('authenticated','public.purchases','TRUNCATE')
  and not has_table_privilege('service_role','public.purchase_items','INSERT')
  and not has_table_privilege('authenticated','public.wallet_purchase_debits','INSERT'),
  'Financial tables expose no direct application or service-role writes');
select ok(has_function_privilege('authenticated','public.checkout_purchase(jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.checkout_purchase(jsonb)','EXECUTE')
  and not has_function_privilege('service_role','public.checkout_purchase(jsonb)','EXECUTE'),
  'Checkout RPC execution is authenticated-only');
select ok((select count(*)=1 from pikas_private.role_capabilities
  where role_code='pos_cashier' and capability='cafeteria:pos:purchase:create')
  and (select count(*)=1 from pikas_private.role_capabilities
  where role_code='pos_supervisor' and capability='cafeteria:pos:purchase:create')
  and not exists(select 1 from pikas_private.role_capabilities where role_code='cafeteria_admin'
    and capability='cafeteria:pos:purchase:create'),
  'Only explicit POS roles receive purchase creation capability');
select ok(not exists(select 1 from pikas_private.role_capabilities where role_code='pos_operator'
  and capability='cafeteria:pos:purchase:create'),'Reserved pos_operator gains no purchase authority');
select is((select count(*) from pikas_private.role_capabilities
  where role_code='school_admin' and capability='school:spending_controls:manage'),1::bigint,
  'Spending control management is an explicit School Admin capability');
select is((select count(*) from pikas_private.role_capabilities
  where role_code in ('cafeteria_admin','pos_cashier','pos_supervisor','account_admin','pos_operator')
    and capability='school:spending_controls:manage'),0::bigint,
  'No cafeteria, POS, or account role can manage student limits');
select is((select count(*) from information_schema.columns where table_schema='public'
  and table_name='purchases' and column_name in ('status','pending_at','failed_at')),0::bigint,
  'A purchase row represents a committed sale and has no pending/failed state');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008101',1,'Agua mineral','Synthetic active saleable product',
  '00000000-0000-0000-0000-000000008001',5000,true,true,'{}','{peanut}')$$,
  'Cafeteria Admin configures a synthetic allergen-bearing product for non-blocking checkout tests');
select is((select version from public.cafeteria_products where id='00000000-0000-0000-0000-000000008101'),2,
  'Product version advances through the existing catalog RPC');
select throws_ok($$select * from public.set_student_spending_control('00000000-0000-0000-0000-000000005201',
  'DOP',0,true,15000,false,0)$$,'42501',null,
  'Cafeteria Admin cannot manage School-owned spending controls');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select * from public.post_manual_wallet_replenishment(
  '00000000-0000-0000-0000-000000007001',1000,'phase3b-wallet-seed-first-0001',
  'synthetic test','initial balance',null)$$,'School Admin funds the synthetic wallet through the Phase 3A RPC');
set constraints all immediate;
set constraints all deferred;
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  '00000000-0000-0000-0000-000000009999','00000000-0000-0000-0000-000000006901',
  'phase3b-no-session-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',1,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '42501',null,'Checkout requires an existing owned register session');
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase3b-open-cashier-session-0001')$$,
  'Cashier opens the exact assigned register session');
select set_config('phase3b.session_id',(select session_id::text from public.get_my_open_register_session()),true);
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-stale-product-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',1,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '40001',null,'Changed product version rejects a stale cart before any purchase writes');
select is((select count(*) from public.purchases),0::bigint,'Stale product rejection leaves no purchase');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008101',2,'Agua mineral','Synthetic active saleable product',
  '00000000-0000-0000-0000-000000008001',9223372036854775807,true,true,'{}','{peanut}')$$,
  'Synthetic product can represent a legal maximum BIGINT price');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-line-overflow-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',2,'expected_product_version',3,'expected_unit_price_minor','9223372036854775807')),'cash',0,null))$$,
  '22003',null,'NUMERIC multiplication detects line-total BIGINT overflow before any write');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008101',3,'Agua mineral','Synthetic active saleable product',
  '00000000-0000-0000-0000-000000008001',5000,true,true,'{}','{peanut}')$$,
  'Admin restores the synthetic product price after overflow coverage');
select lives_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008101',4,'Agua mineral','Synthetic active saleable product',
  '00000000-0000-0000-0000-000000008001',5000,true,false,'{}','{peanut}')$$,
  'Admin disables current product availability through the versioned RPC');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-product-unavailable-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',5,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '23514',null,'Current unavailable state rejects saleability');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008101',5,'Agua mineral','Synthetic active saleable product',
  '00000000-0000-0000-0000-000000008001',5000,true,true,'{}','{peanut}')$$,
  'Admin reactivates availability with a new product version');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-stale-price-version-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',5,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '40001',null,'Availability/version mutation invalidates the old cart version');
select is((select count(*) from public.purchases),0::bigint,'Overflow and availability rejections leave no purchase');

select set_config('phase3b.cash_result',public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-student-cash-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',6000,5000))::text,true);
set constraints all immediate;
set constraints all deferred;
select is((current_setting('phase3b.cash_result')::jsonb->>'total_minor'),'5000',
  'Identified student cash purchase uses server-computed product total');
select is((current_setting('phase3b.cash_result')::jsonb->>'change_due_minor'),'1000',
  'Cash change is computed from received cash and authoritative total');
select is((current_setting('phase3b.cash_result')::jsonb->>'customer_type'),'student',
  'Identified cash retains a typed cafeteria customer');
select is((current_setting('phase3b.cash_result')::jsonb->>'purchase_number'),'1',
  'First cafeteria purchase receives number one');
select is((current_setting('phase3b.cash_result')::jsonb->>'business_date')::date,
  ((current_setting('phase3b.cash_result')::jsonb->>'purchased_at')::timestamptz
    at time zone (current_setting('phase3b.cash_result')::jsonb->>'business_timezone'))::date,
  'Purchase business date derives from DB timestamp and school timezone');
select set_config('phase3b.cash_purchase',(current_setting('phase3b.cash_result')::jsonb->>'purchase_id'),true);
select is((select count(*) from public.purchase_items where purchase_id=current_setting('phase3b.cash_purchase')::uuid),1::bigint,
  'A successful sale creates one immutable item snapshot');
select is((select product_name_snapshot from public.purchase_items where purchase_id=current_setting('phase3b.cash_purchase')::uuid),
  'Agua mineral','Product name is snapshotted even when dietary metadata is present');
select is((select count(*) from public.purchase_tenders where purchase_id=current_setting('phase3b.cash_purchase')::uuid
  and tender_type='cash'),1::bigint,'Identified student cash creates exactly one cash tender');
select is((select student_id from public.purchases where id=current_setting('phase3b.cash_purchase')::uuid),
  '00000000-0000-0000-0000-000000005201'::uuid,'Student identity is derived from the cafeteria customer');
reset role;
select is((select count(*) from public.student_daily_spend_events where purchase_id=current_setting('phase3b.cash_purchase')::uuid),
  1::bigint,'Identified student cash consumes daily capacity');
select is((select count(*) from public.wallet_purchase_debits),0::bigint,'Cash purchase never touches the wallet');
select is((select current_balance_minor from public.student_wallets where id='00000000-0000-0000-0000-000000007001'),1000::bigint,
  'Student cash does not change wallet balance');
set local role authenticated;

select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-wallet-insufficient-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'student_wallet',null,5000))$$,
  '23514',null,'Insufficient wallet balance rejects an otherwise eligible student wallet purchase');
select is((select count(*) from public.purchases),1::bigint,'Insufficient wallet rejection leaves no purchase');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select * from public.post_manual_wallet_replenishment(
  '00000000-0000-0000-0000-000000007001',50000,'phase3b-wallet-seed-second-0001',
  'synthetic test','wallet purchase balance',null)$$,'School Admin adds synthetic wallet funds through the Phase 3A source');
set constraints all immediate;
set constraints all deferred;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select set_config('phase3b.wallet_result',public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-student-wallet-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'student_wallet',null,5000))::text,true);
set constraints all immediate;
set constraints all deferred;
select is((current_setting('phase3b.wallet_result')::jsonb->>'purchase_number'),'2',
  'Wallet sale receives the next cafeteria purchase number');
select is((current_setting('phase3b.wallet_result')::jsonb->>'wallet_balance_after_minor'),'46000',
  'Wallet success response returns ledger balance-after evidence');
select set_config('phase3b.wallet_purchase',(current_setting('phase3b.wallet_result')::jsonb->>'purchase_id'),true);
reset role;
select is((select amount_minor from public.wallet_purchase_debits where purchase_id=current_setting('phase3b.wallet_purchase')::uuid),5000::bigint,
  'Wallet purchase debit source stores a positive purchase amount');
select is((select amount_minor from public.wallet_ledger_entries where purchase_debit_id=
    (select id from public.wallet_purchase_debits where purchase_id=current_setting('phase3b.wallet_purchase')::uuid)),-5000::bigint,
  'Wallet ledger records the purchase as a negative movement');
select is((select balance_version_after from public.wallet_ledger_entries where purchase_debit_id=
    (select id from public.wallet_purchase_debits where purchase_id=current_setting('phase3b.wallet_purchase')::uuid)),3::bigint,
  'Purchase debit continues the existing Phase 3A wallet version chain');
select is((select count(*) from public.student_daily_spend_events where student_id='00000000-0000-0000-0000-000000005201'),2::bigint,
  'Cash and wallet purchases both append school-wide student usage');
set local role authenticated;

select lives_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,null,'phase3b-free-anonymous-cash-0001',
  jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008104',
    'quantity',1,'expected_product_version',1,'expected_unit_price_minor','0')),'cash',0,0))$$,
  'Unidentified zero-total cash sale is valid');
set constraints all immediate;
set constraints all deferred;
select is((select total_minor from public.purchases where request_key='phase3b-free-anonymous-cash-0001'),0::bigint,
  'Free item purchase preserves a zero total');
select is((select cash_received_minor from public.purchase_cash_tenders ct join public.purchase_tenders t on t.id=ct.tender_id
  where t.purchase_id=(select id from public.purchases where request_key='phase3b-free-anonymous-cash-0001')),0::bigint,
  'Free cash purchase records zero received');
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-free-wallet-rejected-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008104',
    'quantity',1,'expected_product_version',1,'expected_unit_price_minor','0')),'student_wallet',null,0))$$,
  '22023',null,'Zero-total wallet purchase is rejected without a zero ledger entry');
reset role;
select is((select count(*) from public.student_daily_spend_events),2::bigint,
  'Zero-total sales do not append meaningless daily usage');
set local role authenticated;

select lives_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006902',
  'phase3b-staff-cash-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  'Active identified staff customer may make a cash sale');
set constraints all immediate;
set constraints all deferred;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006902',
  'phase3b-staff-wallet-rejected-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'student_wallet',null,5000))$$,
  '23514',null,'Staff customer cannot use student wallet tender');
reset role;
select is((select count(*) from public.student_daily_spend_events),2::bigint,
  'Staff cash purchase does not consume student allowance');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select * from public.set_student_spending_control('00000000-0000-0000-0000-000000005201',
  'DOP',0,true,15000,false,0)$$,'School Admin creates a student/currency-scoped daily control');
select is((select count(*) from public.student_spending_controls where student_id='00000000-0000-0000-0000-000000005201'),1::bigint,
  'Spending control is scoped to the student in the school');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select is((select count(*) from public.student_spending_controls),0::bigint,
  'Cashier cannot read school-owned student spending controls directly');
select lives_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-daily-capacity-exact-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  'Identified cash may consume the exact remaining daily capacity');
set constraints all immediate;
set constraints all deferred;
reset role;
select is((select count(*) from public.student_daily_spend_events where student_id='00000000-0000-0000-0000-000000005201'),3::bigint,
  'Student cash and wallet purchases share school-wide daily usage');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-daily-limit-exceeded-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '23514',null,'Identified student cash purchase over daily limit is rejected');
select lives_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-student-free-cash-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008104',
    'quantity',1,'expected_product_version',1,'expected_unit_price_minor','0')),'cash',0,0))$$,
  'Identified student RD$0 cash purchase remains valid at the daily limit');
set constraints all immediate;
set constraints all deferred;
reset role;
select is((select count(*) from public.student_daily_spend_events where student_id='00000000-0000-0000-0000-000000005201'),3::bigint,
  'Zero-total student purchase does not create meaningless spend usage');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select * from public.set_student_spending_control('00000000-0000-0000-0000-000000005201',
  'DOP',1,true,15000,true,4000)$$,'School Admin enables the independent per-transaction limit');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-per-transaction-limit-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '23514',null,'Enabled per-transaction limit independently rejects student cash purchase');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select * from public.set_student_spending_control('00000000-0000-0000-0000-000000005201',
  'DOP',2,false,15000,false,4000)$$,'School Admin disables both configured limit dimensions');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-disabled-limit-unlimited-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  'Disabled spending dimensions behave as unlimited');
set constraints all immediate;
set constraints all deferred;

reset role;
select is((select count(*) from public.student_daily_spend_events where student_id='00000000-0000-0000-0000-000000005201'),4::bigint,
  'Daily-spend events remain append-only across disabled-limit purchases');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select is((select count(*) from public.purchases),7::bigint,'Cashier sees only their own purchases');
select is((select count(*) from public.purchase_items),7::bigint,'Cashier sees items only for their own purchases');
select is((select count(*) from public.student_spending_controls),0::bigint,
  'Cashier still cannot inspect School-owned controls after creating sales');
select set_config('phase3b.canonical_request',pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-canonical-cart-0001',jsonb_build_array(
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008104','quantity',1,
      'expected_product_version',1,'expected_unit_price_minor','0'),
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',1,
      'expected_product_version',6,'expected_unit_price_minor','5000'),
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',1,
      'expected_product_version',6,'expected_unit_price_minor','5000')),
  'cash',10000,10000)::text,true);
select set_config('phase3b.canonical_result',public.checkout_purchase(
  current_setting('phase3b.canonical_request')::jsonb)::text,true);
set constraints all immediate;
set constraints all deferred;
select lives_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-canonical-cart-0001',jsonb_build_array(
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',2,
      'expected_product_version',6,'expected_unit_price_minor','5000'),
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008104','quantity',1,
      'expected_product_version',1,'expected_unit_price_minor','0')),'cash',10000,10000))$$,
  'Semantically identical merged/reordered cart retries are idempotent');
select is((public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-canonical-cart-0001',jsonb_build_array(
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',2,
      'expected_product_version',6,'expected_unit_price_minor','5000'),
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008104','quantity',1,
      'expected_product_version',1,'expected_unit_price_minor','0')),'cash',10000,10000))->>'purchase_id'),
  (current_setting('phase3b.canonical_result')::jsonb->>'purchase_id'),
  'Canonical retry returns the same purchase UUID');
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-canonical-cart-0001',jsonb_build_array(
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',3,
      'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',15000,15000))$$,
  '23505',null,'Same request key with changed canonical payload conflicts');
select is((select count(*) from public.purchase_items where purchase_id=
  (current_setting('phase3b.canonical_result')::jsonb->>'purchase_id')::uuid),2::bigint,
  'Duplicate product lines merge while distinct products preserve separate snapshots');
select set_config('phase3b.closed_retry_request',pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-canonical-cart-0001',jsonb_build_array(
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',2,
      'expected_product_version',6,'expected_unit_price_minor','5000'),
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008104','quantity',1,
      'expected_product_version',1,'expected_unit_price_minor','0')),'cash',10000,10000)::text,true);
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select is((select count(*) from public.purchases),0::bigint,
  'School Admin receives no purchase/student history by implication');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select is((select count(*) from public.purchases),8::bigint,
  'Supervisor purchase read is limited to its exact cafeteria capability scope');
select is((select count(*) from public.purchases where cafeteria_id='00000000-0000-0000-0000-000000000112'),0::bigint,
  'Supervisor cannot read another cafeteria purchases');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002001',true);
set local role authenticated;
select is((select count(*) from public.purchases),0::bigint,
  'Account Admin receives no financial history by implication');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select is((select count(*) from public.purchases),8::bigint,
  'Cafeteria Admin may read exact-cafeteria purchase reporting');
select is((select count(*) from public.purchases where cafeteria_id='00000000-0000-0000-0000-000000000113'),0::bigint,
  'Cafeteria Admin cannot read sibling-cafeteria purchases');
select ok(not pikas_private.has_capability('cafeteria:pos:purchase:create',
  '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111'),'Cafeteria Admin has no purchase authority without explicit POS membership');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select is((select count(*) from public.purchases),0::bigint,
  'Reserved pos_operator customer lookup role cannot read purchases');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002012',true);
set local role authenticated;
select is((select count(*) from public.purchases),0::bigint,
  'Staff affiliation without POS membership cannot read purchases');
reset role;
insert into auth.users(id,aud,role,email) values
  ('00000000-0000-0000-0000-000000002201','authenticated','authenticated','phase3b-student@example.invalid'),
  ('00000000-0000-0000-0000-000000002202','authenticated','authenticated','phase3b-guardian@example.invalid');
update public.persons set auth_user_id='00000000-0000-0000-0000-000000002201'
  where id='00000000-0000-0000-0000-000000005101';
update public.persons set auth_user_id='00000000-0000-0000-0000-000000002202'
  where id='00000000-0000-0000-0000-000000005103';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002201',true);
set local role authenticated;
select is((select count(*) from public.purchases),0::bigint,'Student identity does not receive purchase history in Phase 3B');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002202',true);
set local role authenticated;
select is((select count(*) from public.purchases),0::bigint,'Guardian relationship does not receive purchase history in Phase 3B');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase('{}'::jsonb)$$,'22023',null,
  'Checkout rejects missing and unknown request fields');
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-unknown-input-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000)
  ||jsonb_build_object('operator_person_id','00000000-0000-0000-0000-000000001008'))$$,'22023',null,
  'Client-supplied operator identity is rejected');
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-expected-total-mismatch-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,6000))$$,
  '40001',null,'Mismatched client expected total is evidence-only and rejects');
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-insufficient-cash-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',4000,5000))$$,
  '22023',null,'Cash received below authoritative total rejects');
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-zero-quantity-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',0,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,0))$$,
  '22023',null,'Zero quantity rejects before writes');
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-conflicting-duplicate-0001',jsonb_build_array(
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',1,
      'expected_product_version',6,'expected_unit_price_minor','5000'),
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',1,
      'expected_product_version',5,'expected_unit_price_minor','5000')),'cash',10000,10000))$$,
  '22023',null,'Duplicate product lines with conflicting versions reject');
reset role;
select is((select count(*) from public.purchases),8::bigint,'Invalid cart/tender inputs leave no purchase');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-other-operator-session-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '42501',null,'Supervisor cannot purchase through another Cashier open session');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001008','pos_cashier','suspended')$$,'Admin suspends the active cashier membership');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-suspended-membership-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '42501',null,'Open session alone does not authorize suspended operator');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001008','pos_cashier','active')$$,'Admin restores cashier membership');
select lives_ok($$select public.update_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009501',1,'inactive')$$,'Admin deactivates the exact current assignment');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-inactive-assignment-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '42501',null,'Open session cannot substitute for an inactive exact assignment');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009501',2,'active')$$,'Admin restores the exact register assignment');
select lives_ok($$select public.update_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009401',1,'CAJA-1','Caja 1','inactive')$$,'Admin deactivates the assigned register');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-inactive-register-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '23514',null,'Open session cannot substitute for an inactive register');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009401',2,'CAJA-1','Caja 1','active')$$,'Admin reactivates the assigned register');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.update_cafeteria_catalog_settings('00000000-0000-0000-0000-000000000111',true,1)$$,
  'Scheduling can be enabled independently from drawer opening');
reset role;
update public.cafeteria_service_shifts set enabled=false where cafeteria_id='00000000-0000-0000-0000-000000000111';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,null,'phase3b-scheduled-no-service-0001',
  jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '23514',null,'Scheduled mode requires a current active service shift');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009101',1,'00000000-0000-0000-0000-000000009001','All-day test',
  '00:00','23:59:59.999999',true,array[1,2,3,4,5,6,7])$$,
  'Admin configures a current-day synthetic service window');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select set_config('phase3b.scheduled_result',public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,null,'phase3b-scheduled-sale-0001',
  jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))::text,true);
set constraints all immediate;
set constraints all deferred;
select is((current_setting('phase3b.scheduled_result')::jsonb->>'service_shift_id'),
  '00000000-0000-0000-0000-000000009101','Scheduled purchase snapshots the active service shift');
select is((current_setting('phase3b.scheduled_result')::jsonb->>'menu_id'),
  '00000000-0000-0000-0000-000000009001','Scheduled purchase snapshots the authoritative menu');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_catalog_settings('00000000-0000-0000-0000-000000000111',false,2)$$,
  'Admin restores manual saleability mode');
reset role;

update public.persons set status='suspended' where id='00000000-0000-0000-0000-000000005101';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-suspended-customer-person-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '23514',null,'Suspended customer person blocks a new identified sale');
reset role;
update public.persons set status='active' where id='00000000-0000-0000-0000-000000005101';

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select public.withdraw_student_enrollment('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005302',current_date)$$,
  'School Admin withdraws the synthetic student through the Phase 2 lifecycle RPC');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-withdrawn-student-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '23514',null,'Current active enrollment is required for new identified purchases');
reset role;

update public.supported_currencies set status='disabled' where currency_code='DOP';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,null,'phase3b-disabled-currency-0001',
  jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '23514',null,'Disabled currency rejects a new sale without rewriting historical currency');
reset role;
update public.supported_currencies set status='enabled' where currency_code='DOP';

update public.schools set status='inactive' where id='00000000-0000-0000-0000-000000000011';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,null,'phase3b-inactive-school-0001',
  jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '42501',null,'Inactive tenant ancestry blocks purchase even with an open session');
reset role;
update public.schools set status='active' where id='00000000-0000-0000-0000-000000000011';

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008101',6,'Agua revaluada','Synthetic active saleable product',
  '00000000-0000-0000-0000-000000008001',6000,false,false,'{}','{peanut}')$$,
  'Admin reprices and deactivates the product after committed purchase history exists');
reset role;
select is((select product_name_snapshot||'|'||unit_price_minor::text from public.purchase_items
  where purchase_id=(current_setting('phase3b.canonical_result')::jsonb->>'purchase_id')::uuid
    and product_id='00000000-0000-0000-0000-000000008101'),
  'Agua mineral|5000','Historical item snapshot survives later product rename, repricing, and deactivation');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,null,'phase3b-deactivated-product-0001',
  jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',7,'expected_unit_price_minor','6000')),'cash',6000,6000))$$,
  '23514',null,'Current inactive product blocks a new sale');
reset role;

select throws_ok($$update public.purchases set total_minor=0
  where id=(current_setting('phase3b.canonical_result')::jsonb->>'purchase_id')::uuid$$,'23514',null,
  'Trusted direct UPDATE cannot rewrite committed purchase totals');
select throws_ok($$delete from public.purchases
  where id=(current_setting('phase3b.canonical_result')::jsonb->>'purchase_id')::uuid$$,'23514',null,
  'Trusted direct DELETE cannot remove committed purchase history');
select throws_ok($$update public.purchase_items set unit_price_minor=0
  where purchase_id=(current_setting('phase3b.canonical_result')::jsonb->>'purchase_id')::uuid$$,'23514',null,
  'Trusted direct UPDATE cannot rewrite item snapshots');

grant insert,update,delete,truncate on public.purchases,public.purchase_items,public.purchase_tenders,
  public.purchase_cash_tenders,public.purchase_wallet_tenders,public.wallet_purchase_debits,
  public.student_daily_spend_events,public.cafeteria_purchase_counters,public.student_spending_controls,
  public.wallet_ledger_entries to authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$insert into public.purchases(id,account_id,school_id,school_location_id,cafeteria_id,
  purchase_number,register_id,register_session_id,operator_person_id,operator_membership_id,operator_role_code,
  business_timezone_snapshot,business_date,purchased_at,currency_code,total_minor,request_key,payload_fingerprint)
  values('00000000-0000-0000-0000-000000009801','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000111',999,'00000000-0000-0000-0000-000000009401',
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000001008',
  '00000000-0000-0000-0000-000000004601','pos_cashier','America/Santo_Domingo',
  (clock_timestamp() at time zone 'America/Santo_Domingo')::date,clock_timestamp(),'DOP',5000,
  'phase3b-direct-insert-request-0001',repeat('a',64))$$,'42501',null,
  'Broad table grants still do not allow direct purchase insertion');
with changed as (update public.purchases set total_minor=1
  where id=(current_setting('phase3b.canonical_result')::jsonb->>'purchase_id')::uuid returning id)
select is(count(*),0::bigint,'RLS has no direct purchase UPDATE policy') from changed;
with removed as (delete from public.purchase_items
  where purchase_id=(current_setting('phase3b.canonical_result')::jsonb->>'purchase_id')::uuid returning id)
select is(count(*),0::bigint,'RLS has no direct purchase-item DELETE policy') from removed;
select throws_ok($$truncate table public.purchase_items$$,'23514',null,
  'Broad TRUNCATE grant is still blocked by purchase-history immutability');
reset role;
revoke insert,update,delete,truncate on public.purchases,public.purchase_items,public.purchase_tenders,
  public.purchase_cash_tenders,public.purchase_wallet_tenders,public.wallet_purchase_debits,
  public.student_daily_spend_events,public.cafeteria_purchase_counters,public.student_spending_controls,
  public.wallet_ledger_entries from authenticated;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select is((select count(*) from public.purchases),9::bigint,
  'Cashier reads exact own-session purchase history including scheduled sale');
select is((select count(*) from public.purchases where operator_person_id='00000000-0000-0000-0000-000000001011'),0::bigint,
  'Cashier cannot read a colleague purchases');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(current_setting('phase3b.closed_retry_request')::jsonb)$$,
  '42501',null,'Another Supervisor cannot replay a purchase through the owners session');
reset role;

update public.cafeteria_customers set status='inactive' where id='00000000-0000-0000-0000-000000006901';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-inactive-customer-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '23514',null,'Inactive exact-cafeteria customer link blocks identified checkout');
reset role;
update public.cafeteria_customers set status='active' where id='00000000-0000-0000-0000-000000006901';
update public.school_cafeteria_share_categories set enabled=false
  where cafeteria_id='00000000-0000-0000-0000-000000000111' and category='basic_identification';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-customer-sharing-revoked-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '23514',null,'Disabled basic-identification sharing blocks identified checkout');
reset role;
update public.school_cafeteria_share_categories set enabled=true
  where cafeteria_id='00000000-0000-0000-0000-000000000111' and category='basic_identification';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select public.set_student_status('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201','suspended')$$,
  'School Admin suspends the student for current eligibility regression');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-suspended-student-0001',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '23514',null,'Suspended student is ineligible for identified cash checkout');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select public.set_student_status('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201','active')$$,
  'School Admin restores student for subsequent history tests');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.close_my_register_session(
  current_setting('phase3b.session_id')::uuid,1,0,'phase3b-close-cashier-session-0001')$$,
  'Original owner closes the register session after purchase testing');
select set_config('phase3b.closed_retry_result',public.checkout_purchase(
  current_setting('phase3b.closed_retry_request')::jsonb)::text,true);
select is((current_setting('phase3b.closed_retry_result')::jsonb->>'purchase_id'),
  (current_setting('phase3b.canonical_result')::jsonb->>'purchase_id'),
  'Authorized exact retry returns the committed purchase after its session closes');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001008','pos_cashier','suspended')$$,
  'Admin suspends the original Cashier before a replay attempt');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(current_setting('phase3b.closed_retry_request')::jsonb)$$,
  '42501',null,'Suspended original operator cannot retrieve an idempotent purchase result');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001008','pos_cashier','active')$$,
  'Admin restores the Cashier after replay authorization test');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,null,'phase3b-new-sale-after-close-0001',
  jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
    'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'cash',5000,5000))$$,
  '23514',null,'A new purchase through the closed session is rejected');
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(
  current_setting('phase3b.session_id')::uuid,'00000000-0000-0000-0000-000000006901',
  'phase3b-canonical-cart-0001',jsonb_build_array(
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',2,
      'expected_product_version',6,'expected_unit_price_minor','5000'),
    jsonb_build_object('product_id','00000000-0000-0000-0000-000000008104','quantity',1,
      'expected_product_version',1,'expected_unit_price_minor','0')),'cash',12000,10000))$$,
  '23505',null,'Same key with changed cash evidence conflicts after session close');
select is((select count(*) from public.purchases),9::bigint,
  'Idempotent replay and rejected new sale add no duplicate purchase');

reset role;
-- Future Phase 3C must add its reviewed compensating source and constraints additively.
select throws_ok($$insert into public.student_daily_spend_events(account_id,school_id,cafeteria_id,student_id,
  business_date,currency_code,purchase_id,amount_minor,event_type,occurred_at)
select p.account_id,p.school_id,p.cafeteria_id,p.student_id,p.business_date,p.currency_code,p.id,-1000,'refund',now()
from public.purchases p where p.id=current_setting('phase3b.cash_purchase')::uuid$$,
  '23514',null,'Phase 3B does not accept unbacked future refund compensation');
select is((select sum(amount_minor) from public.student_daily_spend_events
  where purchase_id=current_setting('phase3b.cash_purchase')::uuid),5000::numeric,
  'Original positive purchase usage is preserved without Phase 3C semantics');

-- Privileged probes distinguish constraints from RLS. Each throws_ok subtransaction rolls back.
create function pg_temp.phase3b_bad_cash(kind text) returns void
language plpgsql set search_path='' as $$
declare p public.purchases%rowtype; i public.purchase_items%rowtype; t public.purchase_tenders%rowtype;
  c public.purchase_cash_tenders%rowtype; e public.student_daily_spend_events%rowtype;
  d public.wallet_purchase_debits%rowtype; w public.student_wallets%rowtype;
begin
  select * into p from public.purchases where id=current_setting('phase3b.cash_purchase')::uuid;
  select * into i from public.purchase_items where purchase_id=p.id;
  select * into t from public.purchase_tenders where purchase_id=p.id;
  select * into c from public.purchase_cash_tenders where tender_id=t.id;
  select * into e from public.student_daily_spend_events where purchase_id=p.id;
  p.id:=gen_random_uuid(); p.purchase_number:=100000+(case kind when 'ancestry' then 1 when 'membership' then 2 when 'total' then 3 when 'line' then 4 when 'gap' then 5 when 'multiplication' then 6 when 'no_items' then 7 when 'no_tender' then 8 when 'no_subtype' then 9 when 'two_tenders' then 10 when 'change' then 11 else 12 end); p.request_key:='privileged-probe-'||kind;
  i.id:=gen_random_uuid(); i.purchase_id:=p.id;
  t.id:=gen_random_uuid(); t.purchase_id:=p.id;
  c.tender_id:=t.id;
  e.id:=gen_random_uuid(); e.purchase_id:=p.id;
  if kind='ancestry' then p.school_location_id:='00000000-0000-0000-0000-000000000213'; end if;
  if kind='membership' then p.operator_membership_id:='00000000-0000-0000-0000-000000004603'; end if;
  if kind='total' then p.total_minor:=5001; e.amount_minor:=5001; end if;
  if kind='line' then i.line_total_minor:=1; end if;
  if kind='gap' then i.line_number:=2; end if;
  if kind='multiplication' then i.unit_price_minor:=9223372036854775807; i.quantity:=2; end if;
  insert into public.purchases select p.*;
  if kind<>'no_items' then insert into public.purchase_items select i.*; end if;
  insert into public.student_daily_spend_events select e.*;
  if kind<>'no_tender' then insert into public.purchase_tenders select t.*; end if;
  if kind='change' then c.change_due_minor:=1001; end if;
  if kind not in ('no_tender','no_subtype') then insert into public.purchase_cash_tenders select c.*; end if;
  if kind='two_tenders' then t.id:=gen_random_uuid(); insert into public.purchase_tenders select t.*; end if;
  if kind='cash_debit' then
    select * into w from public.student_wallets where id='00000000-0000-0000-0000-000000007001' for update;
    insert into public.wallet_purchase_debits(account_id,school_id,cafeteria_id,student_id,wallet_id,currency_code,
      purchase_id,amount_minor,actor_person_id,posted_at)
    values(p.account_id,p.school_id,p.cafeteria_id,p.student_id,w.id,p.currency_code,p.id,p.total_minor,
      p.operator_person_id,p.purchased_at) returning * into d;
    update public.student_wallets set current_balance_minor=w.current_balance_minor-p.total_minor,
      balance_version=w.balance_version+1 where id=w.id;
    insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,
      balance_after_minor,balance_version_after,purchase_debit_id,occurred_at)
    values(p.account_id,p.school_id,w.id,p.currency_code,'purchase',-p.total_minor,
      w.current_balance_minor-p.total_minor,w.balance_version+1,d.id,p.purchased_at);
  end if;
  set constraints all immediate;
end $$;
select throws_ok($$select pg_temp.phase3b_bad_cash('ancestry')$$,'23503',null,'Privileged wrong-campus purchase rejects by composite FK');
select throws_ok($$select pg_temp.phase3b_bad_cash('membership')$$,'23503',null,'Privileged substituted session membership rejects by composite FK');
select throws_ok($$select pg_temp.phase3b_bad_cash('line')$$,'23514',null,'Privileged incorrect line multiplication rejects');
select throws_ok($$select pg_temp.phase3b_bad_cash('multiplication')$$,'23514',null,'Numeric line proof cannot wrap at BIGINT multiplication boundary');
select throws_ok($$select pg_temp.phase3b_bad_cash('gap')$$,'23514','purchase_requires_nonempty_items_and_matching_total','Privileged noncontiguous line numbering rejects at deferred validation');
select throws_ok($$select pg_temp.phase3b_bad_cash('total')$$,'23514','purchase_requires_nonempty_items_and_matching_total','Privileged total must equal sum of items at deferred validation');
select throws_ok($$select pg_temp.phase3b_bad_cash('no_items')$$,'23514','purchase_requires_nonempty_items_and_matching_total','Committed purchase requires at least one item');
select throws_ok($$select pg_temp.phase3b_bad_cash('no_tender')$$,'23514','purchase_requires_exactly_one_tender','Committed purchase cannot omit tender');
select throws_ok($$select pg_temp.phase3b_bad_cash('no_subtype')$$,'23514','cash_purchase_requires_only_cash_tender','Cash base tender requires its subtype');
select throws_ok($$select pg_temp.phase3b_bad_cash('two_tenders')$$,'23505',null,'Unique purchase tender rejects a second base tender');
select throws_ok($$select pg_temp.phase3b_bad_cash('change')$$,'23514','cash_tender_amount_or_change_mismatch','Privileged cash change must match total and received');
select throws_ok($$select pg_temp.phase3b_bad_cash('cash_debit')$$,'23514','cash_purchase_requires_only_cash_tender','Cash cannot carry an otherwise valid wallet debit and ledger movement');
create function pg_temp.phase3b_extra_cash() returns void language plpgsql set search_path='' as $$
begin
  insert into public.purchase_cash_tenders(tender_id,cash_received_minor,change_due_minor)
  select id,5000,0 from public.purchase_tenders where purchase_id=current_setting('phase3b.wallet_purchase')::uuid;
  set constraints all immediate;
end $$;
select throws_ok($$select pg_temp.phase3b_extra_cash()$$,'23514','wallet_purchase_requires_positive_single_wallet_tender',
  'Wallet tender cannot also carry a cash subtype');
select throws_ok($$insert into public.purchase_cash_tenders(tender_id,cash_received_minor,change_due_minor)
values(gen_random_uuid(),0,0)$$,'23503',null,'Orphan cash subtype rejects independently of RPC');

select ok(not has_function_privilege('authenticated','pikas_private.guard_student_daily_spend_event()','EXECUTE')
  and not has_function_privilege('anon','pikas_private.guard_student_daily_spend_event()','EXECUTE'),
  'New private event trigger helper has no application execute grant');
select is((pikas_private.resolve_cafeteria_service_at('00000000-0000-0000-0000-000000000111',
  '2026-10-05 02:00:00+00')).business_date,'2026-10-04'::date,
  'Deterministic UTC/local rollover uses the school timezone');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select is(public.checkout_purchase(pg_temp.phase3b_request(current_setting('phase3b.session_id')::uuid,
  '00000000-0000-0000-0000-000000006901','phase3b-student-wallet-0001',
  jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
  'quantity',1,'expected_product_version',6,'expected_unit_price_minor','5000')),'student_wallet',null,5000)),
  current_setting('phase3b.wallet_result')::jsonb,'Exact wallet replay after closure and product changes returns original evidence');
select throws_ok(format('select public.checkout_purchase(%L::jsonb)',jsonb_set(
  current_setting('phase3b.canonical_request')::jsonb,'{request_key}','12345678901234567890'::jsonb)),
  '22023','INVALID_REQUEST_KEY','Request key must be a JSON string, never coerced numeric data');
select throws_ok(format('select public.checkout_purchase(%L::jsonb)',jsonb_set(
  current_setting('phase3b.canonical_request')::jsonb,'{items,0,expected_unit_price_minor}',to_jsonb(v.value))),
  '22023','INVALID_PURCHASE_ITEM_VALUE','Strict money rejects '||v.label)
from (values ('-1','negative'),('1.0','fraction'),('1e3','scientific'),(' 1','whitespace'),('+1','plus'),
  ('9223372036854775808','overflow'),('01','leading zero')) as v(value,label);
reset role;

-- Reopen a session for independent final adversarial probes.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
 '00000000-0000-0000-0000-000000009501',0,'phase3b-review-open-session')$$,'Review opens a fresh owner session');
select set_config('phase3b.review_session',(select session_id::text from public.get_my_open_register_session()),true);
select set_config('phase3b.review_request',pg_temp.phase3b_request(current_setting('phase3b.review_session')::uuid,null,
 'phase3b-review-free-request',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008104',
 'quantity',1,'expected_product_version',1,'expected_unit_price_minor','0')),'cash',0,0)::text,true);
select throws_ok(format('select public.checkout_purchase(%L::jsonb)',jsonb_set(current_setting('phase3b.review_request')::jsonb,
 '{items,0,extra}',to_jsonb('unknown'::text))),'22023','INVALID_PURCHASE_ITEM_SHAPE','Unknown item field rejects');
select throws_ok(format('select public.checkout_purchase(%L::jsonb)',jsonb_set(current_setting('phase3b.review_request')::jsonb,
 '{tender,extra}',to_jsonb('unknown'::text))),'22023','INVALID_CASH_TENDER','Unknown tender field rejects');
select throws_ok(format('select public.checkout_purchase(%L::jsonb)',jsonb_set(current_setting('phase3b.review_request')::jsonb,
 '{items,0,expected_unit_price_minor}','0'::jsonb)),'22023','INVALID_PURCHASE_ITEM_VALUE','JSON numeric money rejects');
select throws_ok(format('select public.checkout_purchase(%L::jsonb)',jsonb_set(current_setting('phase3b.review_request')::jsonb,
 '{items}','[]'::jsonb)),'22023','INVALID_PURCHASE_ITEMS','Empty items reject');
select throws_ok(format('select public.checkout_purchase(%L::jsonb)',jsonb_set(current_setting('phase3b.review_request')::jsonb,
 '{items}',(select jsonb_agg(current_setting('phase3b.review_request')::jsonb->'items'->0) from generate_series(1,31)))),
 '22023','INVALID_PURCHASE_ITEMS','More than 30 input products rejects');
select throws_ok($$select public.checkout_purchase(pg_temp.phase3b_request(current_setting('phase3b.review_session')::uuid,null,
 'phase3b-anonymous-wallet-review',current_setting('phase3b.review_request')::jsonb->'items','student_wallet',null,0))$$,
 '23514','CUSTOMER_INELIGIBLE','Anonymous wallet rejects before writes');
reset role;
-- Exact customer type is a database invariant even for privileged writes.
select throws_ok($$insert into public.purchases select (jsonb_populate_record(null::public.purchases,
 to_jsonb(p)||jsonb_build_object('id',gen_random_uuid(),'purchase_number',200001,
 'request_key','phase3b-null-customer-type','customer_type_snapshot',null))).*
 from public.purchases p where p.id=current_setting('phase3b.cash_purchase')::uuid$$,
 '23514',null,'Nullable SQL CHECK semantics cannot admit an unidentified typed customer');

-- Counter rollback after successful allocation, then deterministic safe reuse.
savepoint counter_rollback;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select public.checkout_purchase(current_setting('phase3b.review_request')::jsonb)$$,
 'Counter allocation and complete sale succeed inside rollback savepoint');
set constraints all immediate;
rollback to counter_rollback;
reset role;
select is((select count(*) from public.purchases where request_key='phase3b-review-free-request'),0::bigint,
 'Rollback leaves no purchase exposing the allocated number');
select is((select last_purchase_number from public.cafeteria_purchase_counters where cafeteria_id='00000000-0000-0000-0000-000000000111'),9::bigint,
 'Rollback restores last-allocated counter');
set local role authenticated;
select set_config('phase3b.review_free',public.checkout_purchase(current_setting('phase3b.review_request')::jsonb)::text,true);
select is(current_setting('phase3b.review_free')::jsonb->>'purchase_number','10','Rolled-back purchase number is safely reused');
set constraints all immediate;
set constraints all deferred;
reset role;
savepoint counter_overflow;
update public.cafeteria_purchase_counters set last_purchase_number=9223372036854775807
 where cafeteria_id='00000000-0000-0000-0000-000000000111';
set local role authenticated;
select throws_ok(format('select public.checkout_purchase(%L::jsonb)',jsonb_set(current_setting('phase3b.review_request')::jsonb,
 '{request_key}',to_jsonb('phase3b-counter-overflow-review'::text))),'22003','PURCHASE_NUMBER_EXHAUSTED','BIGINT counter refuses overflow');
reset role;
rollback to counter_overflow;

-- Student cash must work without any wallet and must not provision controls implicitly.
insert into public.cafeteria_customers(id,account_id,school_id,cafeteria_id,student_id)
values('00000000-0000-0000-0000-000000006999','00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005202');
select is((select count(*) from public.student_wallets where student_id='00000000-0000-0000-0000-000000005202'),0::bigint,
 'No-wallet cash probe has no preexisting wallet');
-- Free product becomes positive through authoritative catalog RPC, leaving original product snapshots intact.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
 '00000000-0000-0000-0000-000000008104',1,'Review cash item',null,null,100,true,true,'{}','{}')$$,
 'Review configures positive cash price through catalog RPC');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select set_config('phase3b.no_wallet_request',pg_temp.phase3b_request(current_setting('phase3b.review_session')::uuid,
 '00000000-0000-0000-0000-000000006999','phase3b-no-wallet-cash-review',
 jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008104',
 'quantity',1,'expected_product_version',2,'expected_unit_price_minor','100')),'cash',100,100)::text,true);
select lives_ok($$select public.checkout_purchase(current_setting('phase3b.no_wallet_request')::jsonb)$$,
 'Positive student cash works without wallet or control row');
set constraints all immediate;
set constraints all deferred;
reset role;
select is((select count(*) from public.student_wallets where student_id='00000000-0000-0000-0000-000000005202'),0::bigint,
 'Cash does not implicitly create a wallet');
select is((select count(*) from public.student_spending_controls where student_id='00000000-0000-0000-0000-000000005202'),0::bigint,
 'Missing control remains unlimited without implicit provisioning');
select is((select amount_minor from public.student_daily_spend_events where student_id='00000000-0000-0000-0000-000000005202'),100::bigint,
 'No-wallet student cash still records positive daily usage');

-- Same person, two roles: alternate authority cannot revive exact session membership.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
 '00000000-0000-0000-0000-000000001008','pos_supervisor','active')$$,'Same cashier gains a separate active Supervisor membership');
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
 '00000000-0000-0000-0000-000000001008','pos_cashier','suspended')$$,'Exact cashier session membership is suspended');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select public.checkout_purchase(current_setting('phase3b.no_wallet_request')::jsonb)$$,
 '42501','OPERATOR_NOT_AUTHORIZED','Other active same-person POS membership cannot authorize replay');
select throws_ok(format('select public.checkout_purchase(%L::jsonb)',jsonb_set(current_setting('phase3b.no_wallet_request')::jsonb,
 '{request_key}',to_jsonb('phase3b-other-role-new-purchase'::text))),
 '42501','OPERATOR_NOT_AUTHORIZED','Other active same-person POS membership cannot authorize a new sale');
select lives_ok($$select * from public.close_my_register_session(current_setting('phase3b.review_session')::uuid,
 1,0,'phase3b-review-close-suspended')$$,'Suspended session membership retains owner-close recovery');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
 '00000000-0000-0000-0000-000000001008','pos_cashier','active')$$,'Review restores cashier authority');
reset role;

-- A real colleague sale makes read isolation assertions non-vacuous.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
 '00000000-0000-0000-0000-000000009503',0,'phase3b-review-supervisor-open')$$,'Supervisor opens own assigned session');
select set_config('phase3b.supervisor_session',(select session_id::text from public.get_my_open_register_session()),true);
select set_config('phase3b.supervisor_request',pg_temp.phase3b_request(current_setting('phase3b.supervisor_session')::uuid,null,
 'phase3b-review-supervisor-purchase',current_setting('phase3b.no_wallet_request')::jsonb->'items','cash',100,100)::text,true);
select set_config('phase3b.supervisor_purchase',(public.checkout_purchase(current_setting('phase3b.supervisor_request')::jsonb)->>'purchase_id'),true);
set constraints all immediate;
set constraints all deferred;
reset role;
select is((select count(*) from public.purchases where id=current_setting('phase3b.supervisor_purchase')::uuid),1::bigint,
 'Privileged control confirms colleague purchase exists');
-- Remove alternate Supervisor role before testing cashier-only reads.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
 '00000000-0000-0000-0000-000000001008','pos_supervisor','inactive')$$,'Review removes alternate reporting authority');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select is((select count(*) from public.purchases where id=current_setting('phase3b.supervisor_purchase')::uuid),0::bigint,
 'Cashier cannot see existing colleague purchase');
select is((select count(*) from public.purchase_items where purchase_id=current_setting('phase3b.supervisor_purchase')::uuid),0::bigint,
 'Child item RLS cannot expose existing hidden purchase');
select is((select count(*) from public.purchase_tenders where purchase_id=current_setting('phase3b.supervisor_purchase')::uuid),0::bigint,
 'Base tender RLS cannot expose existing hidden purchase');
select is((select count(*) from public.purchase_cash_tenders c join public.purchase_tenders t on t.id=c.tender_id
 where t.purchase_id=current_setting('phase3b.supervisor_purchase')::uuid),0::bigint,
 'Cash subtype RLS cannot expose existing hidden purchase');
reset role;

-- Force required success audit failure; the entire checkout must roll back.
create function pg_temp.phase3b_fail_audit() returns trigger language plpgsql as $$
begin if new.action in ('purchase_committed','spending_control_created','spending_control_updated') then
 raise exception using errcode='23514',message='review_forced_audit_failure'; end if; return new; end $$;
create trigger phase3b_review_audit_failure before insert on public.audit_events
 for each row execute function pg_temp.phase3b_fail_audit();
select set_config('phase3b.counter_before_audit',(select last_purchase_number::text from public.cafeteria_purchase_counters
 where cafeteria_id='00000000-0000-0000-0000-000000000111'),true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select throws_ok(format('select public.checkout_purchase(%L::jsonb)',jsonb_set(current_setting('phase3b.supervisor_request')::jsonb,
 '{request_key}',to_jsonb('phase3b-forced-audit-failure'::text))),
 '23514','review_forced_audit_failure','Required audit failure rolls back checkout');
reset role;
select is((select count(*) from public.purchases where request_key='phase3b-forced-audit-failure'),0::bigint,
 'Forced audit failure leaves no sale');
select is((select last_purchase_number::text from public.cafeteria_purchase_counters where cafeteria_id='00000000-0000-0000-0000-000000000111'),
 current_setting('phase3b.counter_before_audit'),'Forced audit failure restores number counter');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select throws_ok($$select * from public.set_student_spending_control('00000000-0000-0000-0000-000000005202',
 'DOP',0,true,100,false,0)$$,'23514','review_forced_audit_failure','Required control audit failure rolls back control creation');
reset role;
select is((select count(*) from public.student_spending_controls where student_id='00000000-0000-0000-0000-000000005202'),0::bigint,
 'Forced control audit failure leaves no configuration');
drop trigger phase3b_review_audit_failure on public.audit_events;

-- Every immutable financial table blocks privileged update/delete/truncate, regardless of RLS.
select throws_ok(format('update public.%I set created_at=created_at where %s',v.table_name,v.predicate),
 '23514','purchase_financial_history_is_immutable','Immutable privileged UPDATE: '||v.table_name)
from (values ('purchases','true'),('purchase_items','true'),('purchase_tenders','true'),
 ('purchase_cash_tenders','true'),('purchase_wallet_tenders','true'),('wallet_purchase_debits','true'),
 ('student_daily_spend_events','true')) v(table_name,predicate);
select throws_ok(format('delete from public.%I',v.table_name),
 '23514','purchase_financial_history_is_immutable','Immutable privileged DELETE: '||v.table_name)
from (values ('purchases'),('purchase_items'),('purchase_tenders'),('purchase_cash_tenders'),
 ('purchase_wallet_tenders'),('wallet_purchase_debits'),('student_daily_spend_events')) v(table_name);
select throws_ok(format('truncate public.%I cascade',v.table_name),
 '23514','purchase_financial_history_is_immutable','Immutable privileged TRUNCATE: '||v.table_name)
from (values ('purchase_items'),('purchase_cash_tenders'),('purchase_wallet_tenders'),('student_daily_spend_events')) v(table_name);
select throws_ok($$delete from public.cafeteria_products where id='00000000-0000-0000-0000-000000008104'$$,
 '23503',null,'Restrictive FK preserves item history on privileged product deletion');
select throws_ok($$delete from public.cafeteria_customers where id='00000000-0000-0000-0000-000000006999'$$,
 '23503',null,'Restrictive FK preserves identified purchase on privileged customer deletion');
select throws_ok($$delete from public.persons where id='00000000-0000-0000-0000-000000001008'$$,
 '23503',null,'Restrictive FK preserves operator attribution on privileged person deletion');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select throws_ok($$select * from public.set_student_spending_control('00000000-0000-0000-0000-000000005201',
 'DOP',null,false,15000,false,4000)$$,'40001','stale_spending_control_version','NULL expected control version cannot bypass optimistic concurrency');
select throws_ok($$select * from public.set_student_spending_control('00000000-0000-0000-0000-000000005201',
 'DOP',1,false,15000,false,4000)$$,'40001','stale_spending_control_version','Stale expected control version rejects');
reset role;
select ok(not exists(select 1 from public.audit_events where action in ('purchase_committed','spending_control_created','spending_control_updated')
 and after_metadata<>'{}'::jsonb),'Purchase/control audits never duplicate financial or profile payload');
-- Independent cafeteria/campus must consume the same school-wide student allowance.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select public.set_school_cafeteria_sharing('00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113','active',array['basic_identification'])$$,
 'School enables exact sibling cafeteria customer sharing');
select set_config('phase3b.sibling_customer',public.create_cafeteria_customer('00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113',
 '00000000-0000-0000-0000-000000005202',null)::text,true);
select lives_ok($$select * from public.set_student_spending_control('00000000-0000-0000-0000-000000005202',
 'DOP',0,true,200,false,0)$$,'School configures combined two-cafeteria daily limit');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select lives_ok($$select * from public.close_my_register_session(current_setting('phase3b.supervisor_session')::uuid,
 1,0,'phase3b-review-supervisor-close')$$,'Supervisor closes first cafeteria before sibling probe');
select lives_ok($$select * from public.create_cafeteria_product('00000000-0000-0000-0000-000000000113',
 '00000000-0000-0000-0000-000000008199','Review sibling item',null,null,100,true,true,'{}','{}')$$,
 'Authoritative catalog RPC creates sibling cafeteria product');
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009404',
 '00000000-0000-0000-0000-000000009505',0,'phase3b-review-sibling-open')$$,'Supervisor opens sibling cafeteria session');
select set_config('phase3b.sibling_session',(select session_id::text from public.get_my_open_register_session()),true);
select set_config('phase3b.sibling_request',pg_temp.phase3b_request(current_setting('phase3b.sibling_session')::uuid,
 current_setting('phase3b.sibling_customer')::uuid,'phase3b-review-sibling-purchase',
 jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008199',
 'quantity',1,'expected_product_version',1,'expected_unit_price_minor','100')),'cash',100,100)::text,true);
select lives_ok($$select public.checkout_purchase(current_setting('phase3b.sibling_request')::jsonb)$$,
 'Sibling cafeteria uses exact remaining school-wide daily capacity');
set constraints all immediate;
set constraints all deferred;
select throws_ok(format('select public.checkout_purchase(%L::jsonb)',jsonb_set(current_setting('phase3b.sibling_request')::jsonb,
 '{request_key}',to_jsonb('phase3b-review-sibling-exceeded'::text))),
 '23514','DAILY_LIMIT_EXCEEDED','Changing cafeteria or campus does not reset student daily usage');
select throws_ok(format('select public.checkout_purchase(%L::jsonb)',jsonb_set(current_setting('phase3b.sibling_request')::jsonb,
 '{cafeteria_customer_id}',to_jsonb('00000000-0000-0000-0000-000000006999'::text))
 ||jsonb_build_object('request_key','phase3b-review-wrong-cafeteria-customer')),
 '23514','CUSTOMER_INELIGIBLE','Sibling purchase cannot substitute first cafeteria customer identity');
reset role;
select is((select sum(amount_minor) from public.student_daily_spend_events where student_id='00000000-0000-0000-0000-000000005202'),
 200::numeric,'School-wide usage combines both cafeteria purchases');

select * from finish();
rollback;
