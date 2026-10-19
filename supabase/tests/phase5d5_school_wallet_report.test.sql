-- Phase 5D.5 School PIKAS Cash report (202610250001). Fictional local fixtures only; rolled back.
-- Account 1: school 11 (cafeterias 111, 113) and school 12; account 2: school 21.
-- 2001 Account Admin (account 1); 2002 School Admin 11; 2005 School Admin 11+12; 2006 School Admin 21;
-- 2003 Cafeteria Admin 111; 2011 Cafeteria Admin + POS Supervisor (registers 9401/9404); 2008 cashier.
-- Student 5201 (wallet) at cafeterias 111 (customer 6901) and 113 (customer added below).
-- Totals are compared as deltas against a baseline taken in the same transaction.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.rep(period text default 'today',f date default null,t date default null,school text default '00000000-0000-0000-0000-000000000011') returns jsonb
 language sql as $$select school_wallet_report(school::uuid,period,f,t)$$;
create function pg_temp.attempt(period text default 'today',f date default null,t date default null,school text default '00000000-0000-0000-0000-000000000011') returns text
 language plpgsql as $$declare m text; begin perform school_wallet_report(school::uuid,period,f,t); return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
-- Delta of a numeric field between two reports (path as text[]).
create function pg_temp.d(a jsonb,b jsonb,variadic p text[]) returns numeric language sql as $$select (a#>>p)::numeric-(b#>>p)::numeric$$;
create function pg_temp.caf(r jsonb,id text) returns jsonb language sql as $$select x from jsonb_array_elements(r->'cafeterias') x where x->>'cafeteria_id'=id$$;
create function pg_temp.cafd(a jsonb,b jsonb,id text,k text) returns numeric language sql as $$
 select coalesce((pg_temp.caf(a,id)->>k)::numeric,0)-coalesce((pg_temp.caf(b,id)->>k)::numeric,0)$$;
create function pg_temp.sale(sid text,key text,qty integer,tender text,product text default '00000000-0000-0000-0000-000000008101',price integer default 5000,customer text default '00000000-0000-0000-0000-000000006901') returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',sid,
 'cafeteria_customer_id',case when tender='cash' then null else customer end,'items',jsonb_build_array(jsonb_build_object('product_id',product,
 'quantity',qty,'expected_product_version',1,'expected_unit_price_minor',price::text)),'expected_total_minor',(price*qty)::text,
 'tender',case tender when 'cash' then jsonb_build_object('type','cash','cash_received_minor',(price*qty)::text) else jsonb_build_object('type',tender) end))->>'purchase_id')::uuid$$;
reset role; select set_config('t.platform',(select p.auth_user_id::text from pikas_private.platform_memberships m join persons p on p.id=m.person_id
 where m.status='active' and m.role_code='platform_admin' and p.auth_user_id is not null limit 1),true);

-- Privileges
select ok(has_function_privilege('authenticated','school_wallet_report(uuid,text,date,date)','execute'),'Authenticated may call the report');
select ok(not has_function_privilege('anon','school_wallet_report(uuid,text,date,date)','execute')
 and not has_function_privilege('service_role','school_wallet_report(uuid,text,date,date)','execute'),'No anonymous or service bypass');
select ok((select prosecdef from pg_proc where proname='school_wallet_report'),'Security definer read');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.wallet_ledger_entries'::regclass,'public.student_wallets'::regclass,'public.wallet_purchase_debits'::regclass,'public.wallet_refund_credits'::regclass)),'Wallet tables keep RLS (no grant change)');

-- Authority
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt(),'ok','School Admin reads own school');
select alike(pg_temp.attempt(school=>'00000000-0000-0000-0000-000000000012'),'42501:%','School Admin of 11 cannot read sibling school 12');
select alike(pg_temp.attempt(school=>'00000000-0000-0000-0000-000000000021'),'42501:%','School Admin of 11 cannot read another account''s school');
select pg_temp.as_user('00000000-0000-0000-0000-000000002005');
select is(pg_temp.attempt(school=>'00000000-0000-0000-0000-000000000012'),'ok','School Admin of 11+12 reads school 12');
select pg_temp.as_user('00000000-0000-0000-0000-000000002006');
select alike(pg_temp.attempt(),'42501:%','School Admin of account 2 cannot read account 1');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select is(pg_temp.attempt(),'ok','Account Admin reads school 11 of its account');
select is(pg_temp.attempt(school=>'00000000-0000-0000-0000-000000000012'),'ok','Account Admin reads school 12 of its account');
select alike(pg_temp.attempt(school=>'00000000-0000-0000-0000-000000000021'),'42501:%','Account Admin cannot read another account''s school');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select alike(pg_temp.attempt(),'42501:%','Cafeteria Admin denied (D13: no aggregated wallet data)');
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select alike(pg_temp.attempt(),'42501:%','POS Supervisor + Cafeteria Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select alike(pg_temp.attempt(),'42501:%','Cashier denied');
select pg_temp.as_user(current_setting('t.platform'));
select alike(pg_temp.attempt(),'42501:%','Platform Admin has no standing tenant financial read');
reset role;
select set_config('t.sandbox_school',(select school_id::text from pikas_private.sandbox_pov_personas where pov_code='school_admin' limit 1),true);
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select platform_enter_sandbox_pov(gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe','school_admin');
select is(pg_temp.attempt(school=>current_setting('t.sandbox_school')),'42501:wallet_report_authority_required','Sandbox School Admin POV denied financial reporting');
reset role;

-- Period contract (shared with 5D.1–5D.4)
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select set_config('t.today',pg_temp.rep()->>'today',true);
select is(pg_temp.rep('last_7_days')->>'from',(current_setting('t.today')::date-6)::text,'Últimos 7 días is inclusive of today');
select is(pg_temp.rep('last_30_days')->>'from',(current_setting('t.today')::date-29)::text,'Últimos 30 días is inclusive of today');
select is(pg_temp.attempt('custom',current_setting('t.today')::date-91,current_setting('t.today')::date),'ok','92-day custom range accepted');
select is(pg_temp.attempt('custom',current_setting('t.today')::date-92,current_setting('t.today')::date),'22023:report_range_too_long','93-day range rejected');
select is(pg_temp.attempt('custom',current_setting('t.today')::date,current_setting('t.today')::date-1),'22023:invalid_report_range','Reversed range rejected');
select is(pg_temp.attempt('custom',current_setting('t.today')::date,current_setting('t.today')::date+1),'22023:invalid_report_range','Future end rejected');
select is(pg_temp.attempt('custom',null,current_setting('t.today')::date),'22023:invalid_report_range','Incomplete custom range rejected');
select is(pg_temp.attempt('today',current_setting('t.today')::date),'22023:invalid_report_period','Preset with explicit dates rejected');
select is(pg_temp.attempt('yesterday'),'22023:invalid_report_period','Unknown period rejected');
reset role;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select '2026-11-01 02:30:00+00'::timestamptz$$;
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.rep()->>'today','2026-10-31','Hoy is the school-local business date (02:30 UTC Nov 1 = Oct 31 in Santo Domingo)');
select is(concat_ws('/',pg_temp.rep()->>'from',pg_temp.rep()->>'to'),'2026-10-31/2026-10-31','Hoy covers that local business day');
reset role;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()$$;

-- Baselines
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select set_config('t.b',pg_temp.rep()::text,true);
select set_config('t.by',pg_temp.rep('custom',current_setting('t.today')::date-1,current_setting('t.today')::date-1)::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002005');
select set_config('t.b12',pg_temp.rep(school=>'00000000-0000-0000-0000-000000000012')::text,true);
reset role;
select set_config('t.rows0',(select concat_ws('/',(select count(*) from wallet_ledger_entries),(select sum(current_balance_minor) from student_wallets),(select count(*) from wallet_replenishments))),true);

-- Fixture A: replenishments, reversal, administrative credit/debit (school 11, student 5201).
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select set_config('t.r1',school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',100000,'5d500000-0000-4000-8000-000000000001','Fondos locales 5D.5','Verificado')->>'replenishment_id',true);
select set_config('t.r2',school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',20000,'5d500000-0000-4000-8000-000000000002','Recarga duplicada 5D.5','Verificado')->>'replenishment_id',true);
select school_wallet_reverse_replenishment('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',current_setting('t.r2')::uuid,'duplicate_replenishment','Reversión ficticia 5D.5','5d500000-0000-4000-8000-000000000003');
select school_wallet_adjust('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',2500,'authorized_credit','Crédito ficticio 5D.5','5d500000-0000-4000-8000-000000000004');
select school_wallet_adjust('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',-1000,'authorized_debit','Débito ficticio 5D.5','5d500000-0000-4000-8000-000000000005');

-- Fixture B: cafeteria 111 — PIKAS Cash ×2 (10000), cash ×3, staff credit ×1, then a PIKAS Cash refund of 1 unit.
reset role;
insert into staff_campus_affiliations(account_id,school_id,staff_affiliation_id,school_location_id)
values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006501','00000000-0000-0000-0000-000000000211')
on conflict do nothing;
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select configure_staff_receivable_account('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000006501',0,false,null,'5d5-staff-create-0001');
select configure_staff_receivable_account('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000006501',1,true,'100000','5d5-staff-enable-0001');
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401'::uuid,'00000000-0000-0000-0000-000000009503'::uuid,10000,'5d5-open-session-0001')),true);
select set_config('t.wallet_sale',pg_temp.sale(current_setting('t.sid'),'5d5-sale-wallet-00001',2,'student_wallet')::text,true);
select pg_temp.sale(current_setting('t.sid'),'5d5-sale-cash-000001',3,'cash');
select pg_temp.sale(current_setting('t.sid'),'5d5-sale-staff-00001',1,'staff_credit',customer=>'00000000-0000-0000-0000-000000006902');
select create_purchase_item_refund(current_setting('t.sid')::uuid,current_setting('t.wallet_sale')::uuid,
 jsonb_build_array(jsonb_build_object('purchase_item_id',(select id from purchase_items where purchase_id=current_setting('t.wallet_sale')::uuid),'quantity',1)),'wrong_product',null,'5d5-refund-wallet-001',null);
select close_my_register_session(current_setting('t.sid')::uuid,1,25000,'5d5-close-session-0001');

-- Fixture C: cafeteria 113 — a second cafeteria where the same student pays 3000 with PIKAS Cash.
reset role;
insert into school_cafeteria_shares(id,account_id,school_id,cafeteria_id,status) values('5d500000-0000-4000-8000-000000000101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113','active') on conflict do nothing;
insert into school_cafeteria_share_categories(id,account_id,school_id,cafeteria_id,share_id,category,enabled) values('5d500000-0000-4000-8000-000000000104','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113','5d500000-0000-4000-8000-000000000101','basic_identification',true);
insert into cafeteria_customers(id,account_id,school_id,cafeteria_id,student_id,status) values('5d500000-0000-4000-8000-000000000102','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113','00000000-0000-0000-0000-000000005201','active');
insert into cafeteria_products(id,account_id,school_id,cafeteria_id,category_id,name,description,price_minor,active,available,ingredients,allergens,version,unit)
 values('5d500000-0000-4000-8000-000000000103','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113',null,'Jugo ficticio 5D.5','Producto ficticio',3000,true,true,'{}','{}',1,'Unidad');
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.sid2',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009404'::uuid,'00000000-0000-0000-0000-000000009505'::uuid,0,'5d5-open-session-0002')),true);
select pg_temp.sale(current_setting('t.sid2'),'5d5-sale-wallet-00113',1,'student_wallet','5d500000-0000-4000-8000-000000000103',3000,'5d500000-0000-4000-8000-000000000102');

-- Period movements (deltas, school 11, Hoy)
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select set_config('t.r',pg_temp.rep()::text,true);
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'movements','replenishments','amount_minor'),120000::numeric,'Recargas: both replenishments counted on their own date');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'movements','replenishments','count'),2::numeric,'Recargas count');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'movements','reversals','amount_minor'),20000::numeric,'Reversiones separate (not a refund, original replenishment unchanged)');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'movements','net_replenished_minor'),100000::numeric,'Recargas netas = Recargas − Reversiones');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'movements','purchases','amount_minor'),13000::numeric,'Compras con PIKAS Cash: wallet-paid only (no cash, no staff credit)');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'movements','purchases','count'),2::numeric,'PIKAS Cash purchase count');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'movements','refunds','amount_minor'),5000::numeric,'Reembolsos a PIKAS Cash');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'movements','adjustment_credits','amount_minor'),2500::numeric,'Positive administrative adjustment');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'movements','adjustment_debits','amount_minor'),1000::numeric,'Negative administrative adjustment (magnitude)');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'movements','historical_adjustments','count'),0::numeric,'New adjustments are not historical');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'movements','net_movement_minor'),93500::numeric,'Movimiento neto = Σ all entries (120000 − 20000 − 13000 + 5000 + 2500 − 1000)');
select is(pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'current','total_balance_minor'),
 pg_temp.d(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'movements','net_movement_minor'),'Identity: Σ period movements equals the change in total balance');
reset role;
select is((current_setting('t.r')::jsonb#>>'{current,total_balance_minor}')::numeric,(select sum(current_balance_minor)::numeric from student_wallets where school_id='00000000-0000-0000-0000-000000000011' and currency_code='DOP'),'Current balance equals Σ stored wallet balances');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.rep('custom',current_setting('t.today')::date-1,current_setting('t.today')::date-1)->'current',current_setting('t.r')::jsonb->'current','Current balance is point-in-time, independent of the period');
select is(pg_temp.rep('custom',current_setting('t.today')::date-1,current_setting('t.today')::date-1)->'movements',current_setting('t.by')::jsonb->'movements','Yesterday does not include today''s events');
select ok((pg_temp.rep('last_7_days')#>>'{movements,replenishments,amount_minor}')::numeric>=(current_setting('t.r')::jsonb#>>'{movements,replenishments,amount_minor}')::numeric,'Últimos 7 días includes today');
select ok((pg_temp.rep('last_30_days')#>>'{movements,purchases,amount_minor}')::numeric>=(current_setting('t.r')::jsonb#>>'{movements,purchases,amount_minor}')::numeric,'Últimos 30 días includes today');

-- Cafeteria attribution (PIKAS Cash only)
select is(pg_temp.cafd(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'00000000-0000-0000-0000-000000000111','spent_minor'),10000::numeric,'Cafeteria 111: only the PIKAS Cash sale (cash ×3 and staff credit excluded)');
select is(pg_temp.cafd(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'00000000-0000-0000-0000-000000000111','refunded_minor'),5000::numeric,'Cafeteria 111: PIKAS Cash refund attributed to the purchase cafeteria');
select is(pg_temp.cafd(current_setting('t.r')::jsonb,current_setting('t.b')::jsonb,'00000000-0000-0000-0000-000000000113','spent_minor'),3000::numeric,'Cafeteria 113: second cafeteria attributed separately');
select is(pg_temp.caf(current_setting('t.r')::jsonb,'00000000-0000-0000-0000-000000000113')->>'name','Synthetic cafeteria A1-C2','Cafeteria named');
select is((select sum((x->>'spent_minor')::numeric) from jsonb_array_elements(current_setting('t.r')::jsonb->'cafeterias') x),(current_setting('t.r')::jsonb#>>'{movements,purchases,amount_minor}')::numeric,'Breakdown sums to Compras con PIKAS Cash');
select ok(not exists(select 1 from jsonb_object_keys(pg_temp.caf(current_setting('t.r')::jsonb,'00000000-0000-0000-0000-000000000111')) k
 where k not in ('cafeteria_id','name','spent_minor','purchase_count','refunded_minor','refund_count')),'Cafeteria rows carry PIKAS Cash fields only');
select ok(current_setting('t.r') !~* '(cash_|gross|sales|staff|expected|counted|ticket|transactions|register)','No sales, cash, staff-credit, register or all-tender fields in the report');

-- Scope: school 12 sees none of school 11's activity
select pg_temp.as_user('00000000-0000-0000-0000-000000002005');
select is(pg_temp.rep(school=>'00000000-0000-0000-0000-000000000012')->'movements',current_setting('t.b12')::jsonb->'movements','School 11 activity never reaches school 12');
select is(pg_temp.rep(school=>'00000000-0000-0000-0000-000000000012')->'current',current_setting('t.b12')::jsonb->'current','School 12 balances unchanged');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select is(pg_temp.rep()->'movements',current_setting('t.r')::jsonb->'movements','Account Admin sees the same school report as the School Admin');

-- Read-only: the report writes nothing
reset role;
select set_config('t.rows1',(select concat_ws('/',(select count(*) from wallet_ledger_entries),(select sum(current_balance_minor) from student_wallets),(select count(*) from wallet_replenishments),(select count(*) from purchases),(select count(*) from refunds))),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select pg_temp.rep('last_30_days'); select pg_temp.rep();
reset role;
select is(concat_ws('/',(select count(*) from wallet_ledger_entries),(select sum(current_balance_minor) from student_wallets),(select count(*) from wallet_replenishments),(select count(*) from purchases),(select count(*) from refunds)),current_setting('t.rows1'),'Report execution mutates no financial rows');

select * from finish();
rollback;
