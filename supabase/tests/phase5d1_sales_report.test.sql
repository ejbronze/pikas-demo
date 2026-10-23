-- Phase 5D.1 Cafeteria Admin sales summary (202610210001). Fictional local fixtures only.
-- 2003 Cafeteria Admin 111; 2004 Cafeteria Admin 112; 2011 POS Supervisor (register 9401 /
-- assignment 9503) of 111; 2008 cashier 111 / supervisor 112; 2002 School Admin 11; 2001 Account Admin.
-- Assertions compare deltas so pre-existing local fixture sales never affect the result.
begin;
-- Transactional Platform Admin fixture (fictional; rolled back with the test). The canonical local DB has no platform_admin.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('7a000000-0000-4000-8000-00000000ad01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tx-platform-admin@example.invalid','',now(),now(),now(),'{}','{}');
insert into public.persons(id,auth_user_id,display_name) values('7a000000-0000-4000-8000-00000000ad02','7a000000-0000-4000-8000-00000000ad01','Platform Admin de prueba');
insert into pikas_private.platform_memberships(person_id,role_code) values('7a000000-0000-4000-8000-00000000ad02','platform_admin');

create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.report(period text,f date default null,t date default null,caf text default '00000000-0000-0000-0000-000000000111') returns jsonb
 language sql as $$select cafeteria_report_read(caf::uuid,'sales_summary',period,f,t)$$;
create function pg_temp.attempt(period text,f date default null,t date default null,caf text default '00000000-0000-0000-0000-000000000111',kind text default 'sales_summary') returns text
 language plpgsql as $$declare m text; begin perform cafeteria_report_read(caf::uuid,kind,period,f,t); return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.d(a jsonb,b jsonb,k text) returns text language sql as $$select ((a->'data'->>k)::numeric-(b->'data'->>k)::numeric)::text$$;
create function pg_temp.tender(r jsonb,k text,f text) returns numeric language sql as $$
 select (x->>f)::numeric from jsonb_array_elements(r->'data'->'tenders') x where x->>'tender'=k$$;
create function pg_temp.sale(key text,qty integer,tender text,customer text default '00000000-0000-0000-0000-000000006901') returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',current_setting('t.sid'),
 'cafeteria_customer_id',customer,'items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',qty,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor',(5000*qty)::text,
 'tender',case tender when 'cash' then jsonb_build_object('type','cash','cash_received_minor',(5000*qty)::text) else jsonb_build_object('type',tender) end))->>'purchase_id')::uuid$$;
create function pg_temp.refund(p uuid,qty integer,key text) returns jsonb language sql as $$
 select create_purchase_item_refund(current_setting('t.sid')::uuid,p,
  jsonb_build_array(jsonb_build_object('purchase_item_id',(select id from purchase_items where purchase_id=p),'quantity',qty)),'wrong_product',null,key,null)$$;

-- Privileges
select ok(has_function_privilege('authenticated','cafeteria_report_read(uuid,text,text,date,date)','execute'),'Authenticated may call the report');
select ok(not has_function_privilege('anon','cafeteria_report_read(uuid,text,text,date,date)','execute')
 and not has_function_privilege('service_role','cafeteria_report_read(uuid,text,text,date,date)','execute'),'No anonymous or service report bypass');
select ok(not has_function_privilege('authenticated','pikas_private.report_clock()','execute'),'Report clock seam is private');
reset role; select set_config('t.platform','7a000000-0000-4000-8000-00000000ad01',true);

-- Authority
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.report('today')->>'kind','sales_summary','Cafeteria Admin reads own cafeteria report');
select is(pg_temp.report('today')->>'business_timezone','America/Santo_Domingo','Report uses the school business timezone');
select alike(pg_temp.attempt('today',null,null,'00000000-0000-0000-0000-000000000112'),'42501:%','Cafeteria Admin of 111 cannot read cafeteria 112');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select alike(pg_temp.attempt('today'),'42501:%','Unrelated Cafeteria Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select alike(pg_temp.attempt('today'),'42501:%','School Admin of the connected school denied commercial reporting (D1)');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select alike(pg_temp.attempt('today'),'42501:%','Account Admin denied commercial reporting (D2)');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select alike(pg_temp.attempt('today'),'42501:%','Cashier denied');
select alike(pg_temp.attempt('today',null,null,'00000000-0000-0000-0000-000000000112'),'42501:%','POS Supervisor (no admin membership) denied');
select pg_temp.as_user(current_setting('t.platform'));
select alike(pg_temp.attempt('today'),'42501:%','Platform Admin has no standing tenant commercial reporting');

-- Validation
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.today',pg_temp.report('today')->>'today',true);
select is(pg_temp.attempt('custom',current_setting('t.today')::date-91,current_setting('t.today')::date),'ok','92-day custom range accepted');
select is(pg_temp.attempt('custom',current_setting('t.today')::date-92,current_setting('t.today')::date),'22023:report_range_too_long','93-day range rejected');
select is(pg_temp.attempt('custom',current_setting('t.today')::date,current_setting('t.today')::date-1),'22023:invalid_report_range','Reversed range rejected');
select is(pg_temp.attempt('custom',current_setting('t.today')::date,current_setting('t.today')::date+1),'22023:invalid_report_range','Future end rejected');
select is(pg_temp.attempt('custom',null,current_setting('t.today')::date),'22023:invalid_report_range','Incomplete custom range rejected');
select is(pg_temp.attempt('today',current_setting('t.today')::date,null),'22023:invalid_report_period','Preset with explicit dates rejected');
select is(pg_temp.attempt('yesterday'),'22023:invalid_report_period','Unknown period rejected');
select is(pg_temp.attempt('today',null,null,'00000000-0000-0000-0000-000000000111','products'),'22023:invalid_report_kind','Later-slice kinds are not available');

-- Business-time boundaries: 02:30 UTC on Nov 1 is still Oct 31 in Santo Domingo (UTC−4).
reset role;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select '2026-11-01 02:30:00+00'::timestamptz$$;
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.report('today')->>'today','2026-10-31','Hoy is the school-local business date, not the UTC date');
select is(pg_temp.report('last_7_days')->>'from','2026-10-25','Últimos 7 días is inclusive of today');
select is(pg_temp.report('last_30_days')->>'from','2026-10-02','Últimos 30 días is inclusive of today');
select is(pg_temp.report('custom','2026-10-01','2026-10-31')->>'to','2026-10-31','Custom range returns its inclusive bounds');
reset role;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()$$;

-- Baselines (deltas isolate pre-existing local data)
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.base',pg_temp.report('today')::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select set_config('t.base112',pg_temp.report('today',null,null,'00000000-0000-0000-0000-000000000112')::text,true);

-- Wallet movements are not sales: recarga and administrative adjustment
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',100000,'5d100000-0000-4000-8000-000000000001','Fondos locales 5D.1','Verificado');
select school_wallet_adjust('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',2500,'administrative_correction','Ajuste ficticio 5D.1','5d100000-0000-4000-8000-000000000002');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.report('today')->'data',current_setting('t.base')::jsonb->'data','Recarga and administrative adjustment do not change any sales metric');

-- Staff-credit fixture (existing Phase 3D receivable flow)
reset role;
insert into staff_campus_affiliations(account_id,school_id,staff_affiliation_id,school_location_id)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006501','00000000-0000-0000-0000-000000000211')
 on conflict do nothing;
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select configure_staff_receivable_account('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000006501',0,false,null,'5d1-staff-credit-create-001');
select configure_staff_receivable_account('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000006501',1,true,'100000','5d1-staff-credit-enable-001');

-- Sales by the POS Supervisor from its own register: cash 2×, PIKAS Cash 1×, staff credit 1×
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009503',10000,'5d1-open-supervisor-0001')),true);
select set_config('t.cash',pg_temp.sale('5d1-sale-cash-000001',2,'cash')::text,true);
select set_config('t.wallet',pg_temp.sale('5d1-sale-wallet-00001',1,'student_wallet')::text,true);
select set_config('t.staff',pg_temp.sale('5d1-sale-staff-000001',1,'staff_credit','00000000-0000-0000-0000-000000006902')::text,true);
-- Partial cash refund (1 of 2) and full PIKAS Cash refund, same day
select pg_temp.refund(current_setting('t.cash')::uuid,1,'5d1-refund-cash-part1');
select pg_temp.refund(current_setting('t.wallet')::uuid,1,'5d1-refund-wallet-full');

select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.r',pg_temp.report('today')::text,true);
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.base')::jsonb,'gross_sales_minor'),'20000','Cash, PIKAS Cash and staff-credit sales all count in Ventas brutas (D5)');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.base')::jsonb,'transaction_count'),'3','Each committed purchase counts once, refunded or not');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.base')::jsonb,'refunds_minor'),'10000','Partial cash and full PIKAS Cash refunds count in Reembolsos');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.base')::jsonb,'refund_count'),'2','Refund events counted');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.base')::jsonb,'net_sales_minor'),'10000','Ventas netas = Ventas brutas − Reembolsos');
select is(((current_setting('t.r')::jsonb->'data'->'refunds_by_tender'->>'cash')::numeric-(current_setting('t.base')::jsonb->'data'->'refunds_by_tender'->>'cash')::numeric),5000::numeric,'Cash refund attributed to cash');
select is(((current_setting('t.r')::jsonb->'data'->'refunds_by_tender'->>'student_wallet')::numeric-(current_setting('t.base')::jsonb->'data'->'refunds_by_tender'->>'student_wallet')::numeric),5000::numeric,'PIKAS Cash refund attributed to PIKAS Cash');
select is(pg_temp.tender(current_setting('t.r')::jsonb,'cash','gross_sales_minor')-pg_temp.tender(current_setting('t.base')::jsonb,'cash','gross_sales_minor'),10000::numeric,'Cash tender gross unaffected by refund');
select is(pg_temp.tender(current_setting('t.r')::jsonb,'student_wallet','transaction_count')-pg_temp.tender(current_setting('t.base')::jsonb,'student_wallet','transaction_count'),1::numeric,'Fully refunded PIKAS Cash sale still counted in its tender');
select is(pg_temp.tender(current_setting('t.r')::jsonb,'staff_credit','gross_sales_minor')-pg_temp.tender(current_setting('t.base')::jsonb,'staff_credit','gross_sales_minor'),5000::numeric,'Staff-credit tender reported separately');
select is((select sum((x->>'gross_sales_minor')::numeric) from jsonb_array_elements(current_setting('t.r')::jsonb->'data'->'tenders') x),
 (current_setting('t.r')::jsonb->'data'->>'gross_sales_minor')::numeric,'Tender rows sum to Ventas brutas');
select is((select sum((x->>'transaction_count')::numeric) from jsonb_array_elements(current_setting('t.r')::jsonb->'data'->'tenders') x),
 (current_setting('t.r')::jsonb->'data'->>'transaction_count')::numeric,'Tender counts sum to Transacciones');
select is(current_setting('t.r')::jsonb->'data'->>'average_ticket_minor',
 round((current_setting('t.r')::jsonb->'data'->>'gross_sales_minor')::numeric/(current_setting('t.r')::jsonb->'data'->>'transaction_count')::numeric)::text,
 'Ticket promedio = Ventas brutas ÷ Transacciones (gross, not net)');
select is(pg_temp.report('last_7_days')->'data'->>'gross_sales_minor',pg_temp.report('custom',current_setting('t.today')::date-6,current_setting('t.today')::date)->'data'->>'gross_sales_minor','Últimos 7 días equals the equivalent custom range');
select ok((pg_temp.report('last_30_days')->'data'->>'gross_sales_minor')::numeric>=(current_setting('t.r')::jsonb->'data'->>'gross_sales_minor')::numeric,'Últimos 30 días includes today');

-- Scoping: cafeteria 111 data never reaches cafeteria 112
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select is(pg_temp.report('today',null,null,'00000000-0000-0000-0000-000000000112')->'data',current_setting('t.base112')::jsonb->'data','Cafeteria 111 activity does not leak into cafeteria 112');

-- Cross-period refund (D3): the remaining cash unit is refunded three business days later.
reset role;
create or replace function pikas_private.refund_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()+interval '3 days'$$;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()+interval '3 days'$$;
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select is(pg_temp.refund(current_setting('t.cash')::uuid,1,'5d1-refund-cash-later')->>'authorization_mode','supervisor_direct','Later refund completes the cash sale refund');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.later',pg_temp.report('today')::text,true);
select is(current_setting('t.later')::jsonb->'data'->>'gross_sales_minor','0','Refund-only day: Ventas brutas RD$0');
select is(current_setting('t.later')::jsonb->'data'->>'refunds_minor','5000','Refund-only day: refund reported when it occurred');
select is(current_setting('t.later')::jsonb->'data'->>'net_sales_minor','-5000','Refund-only day: Ventas netas negative, not clamped');
select is((current_setting('t.later')::jsonb->'data'->>'transaction_count')::integer,0,'Refund-only day: no transactions');
select ok(current_setting('t.later')::jsonb->'data'->'average_ticket_minor'='null'::jsonb,'Zero transactions: no average ticket (no division by zero)');
select is(pg_temp.report('custom',current_setting('t.today')::date,current_setting('t.today')::date)->'data'->>'gross_sales_minor',current_setting('t.r')::jsonb->'data'->>'gross_sales_minor','Later refund does not rewrite the original day''s Ventas brutas');
select is(pg_temp.report('custom',current_setting('t.today')::date,current_setting('t.today')::date)->'data'->>'transaction_count',current_setting('t.r')::jsonb->'data'->>'transaction_count','Later refund does not erase the original transaction');
select is(pg_temp.report('custom',current_setting('t.today')::date,current_setting('t.today')::date)->'data'->>'refunds_minor',current_setting('t.r')::jsonb->'data'->>'refunds_minor','Original day keeps only refunds that occurred on it');
select is(pg_temp.report('custom',current_setting('t.today')::date+1,current_setting('t.today')::date+1)->'data'->>'transaction_count','0','Sales stay on their business date (next day excluded)');
select is(pg_temp.d(pg_temp.report('custom',current_setting('t.today')::date,current_setting('t.today')::date+3),current_setting('t.base')::jsonb,'refunds_minor'),'15000','A range spanning both days includes both refunds');

select * from finish();
rollback;
