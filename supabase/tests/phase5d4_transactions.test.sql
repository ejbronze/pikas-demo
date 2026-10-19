-- Phase 5D.4 Transacciones lookup (202610240001). Fictional local fixtures only; rolled back.
-- 2003 Cafeteria Admin 111; 2004 Cafeteria Admin 112; 2011 Cafeteria Admin + POS Supervisor of 111
-- (register 9401 / assignment 9503 / membership 4603); 2008 cashier 111; 2002 School Admin; 2001 Account Admin.
-- Counts are compared as deltas and rows by ID, so pre-existing local purchases never affect results.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.tx(period text default 'today',f date default null,t date default null,tender text default null,status text default null,
 receipt bigint default null,off integer default 0,caf text default '00000000-0000-0000-0000-000000000111') returns jsonb
 language sql as $$select cafeteria_transactions_read(caf::uuid,period,f,t,tender,status,receipt,off)$$;
create function pg_temp.attempt(period text default 'today',f date default null,t date default null,tender text default null,status text default null,
 receipt bigint default null,off integer default 0,caf text default '00000000-0000-0000-0000-000000000111') returns text
 language plpgsql as $$declare m text; begin perform cafeteria_transactions_read(caf::uuid,period,f,t,tender,status,receipt,off); return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.detail_attempt(p uuid,caf text default '00000000-0000-0000-0000-000000000111') returns text
 language plpgsql as $$declare m text; begin perform cafeteria_transaction_detail(caf::uuid,p); return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.n(r jsonb) returns integer language sql as $$select (r->>'total_count')::integer$$;
create function pg_temp.row(p uuid) returns jsonb language sql as $$
 select x from jsonb_array_elements((select cafeteria_transactions_read('00000000-0000-0000-0000-000000000111'::uuid,null,null,null,null,null,
  (select purchase_number from purchases where id=p),0))->'data') x where x->>'id'=p::text$$;
create function pg_temp.state(p uuid) returns text language sql as $$
 select concat_ws('/',pg_temp.row(p)->>'refund_status',pg_temp.row(p)->>'refunded_minor',pg_temp.row(p)->>'remaining_minor')$$;
create function pg_temp.receipt(p uuid) returns bigint language sql security definer set search_path=public as $$select purchase_number from purchases where id=p$$;
create function pg_temp.sale(sid text,key text,qty integer,tender text,customer text default '00000000-0000-0000-0000-000000006901') returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',sid,
 'cafeteria_customer_id',case when tender='cash' then null else customer end,'items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',qty,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor',(5000*qty)::text,
 'tender',case tender when 'cash' then jsonb_build_object('type','cash','cash_received_minor',(5000*qty)::text) else jsonb_build_object('type',tender) end))->>'purchase_id')::uuid$$;
create function pg_temp.refund(sid text,p uuid,qty integer,key text) returns jsonb language sql as $$
 select create_purchase_item_refund(sid::uuid,p,
  jsonb_build_array(jsonb_build_object('purchase_item_id',(select id from purchase_items where purchase_id=p),'quantity',qty)),'wrong_product',null,key,null)$$;
reset role; select set_config('t.platform',(select p.auth_user_id::text from pikas_private.platform_memberships m join persons p on p.id=m.person_id
 where m.status='active' and m.role_code='platform_admin' and p.auth_user_id is not null limit 1),true);

-- Privileges
select ok(has_function_privilege('authenticated','cafeteria_transactions_read(uuid,text,date,date,text,text,bigint,integer)','execute'),'Authenticated may call the transactions read');
select ok(has_function_privilege('authenticated','cafeteria_transaction_detail(uuid,uuid)','execute'),'Authenticated may call the transaction detail');
select ok(not has_function_privilege('anon','cafeteria_transactions_read(uuid,text,date,date,text,text,bigint,integer)','execute')
 and not has_function_privilege('service_role','cafeteria_transactions_read(uuid,text,date,date,text,text,bigint,integer)','execute')
 and not has_function_privilege('anon','cafeteria_transaction_detail(uuid,uuid)','execute'),'No anonymous or service bypass');
select ok(not has_function_privilege('authenticated','pikas_private.transaction_refund_state(numeric,bigint)','execute'),'Refund-state helper stays private');
select ok((select provolatile from pg_proc where proname='transaction_refund_state')='i' and not exists(select 1 from pg_proc where proname in ('cafeteria_transactions_read','cafeteria_transaction_detail') and not prosecdef),'Reads are security definer; helper is pure');

-- Authority (identical to the Phase 5A purchase-history read)
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt(),'ok','Cafeteria Admin reads own transactions');
select alike(pg_temp.attempt(caf=>'00000000-0000-0000-0000-000000000112'),'42501:%','Cafeteria Admin of 111 cannot read cafeteria 112');
select alike(pg_temp.attempt(caf=>'b9496342-5079-46ae-83b8-05c39bcbd7fe'),'42501:%','Customer Cafeteria Admin cannot read a sandbox cafeteria');
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select is(pg_temp.attempt(),'ok','POS Supervisor who also holds Cafeteria Admin reads through the admin role');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select alike(pg_temp.attempt(),'42501:%','Unrelated Cafeteria Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select alike(pg_temp.attempt(),'42501:%','School Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select alike(pg_temp.attempt(),'42501:%','Account Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select alike(pg_temp.attempt(),'42501:%','Cashier denied: no cafeteria transaction history');
select alike(pg_temp.attempt(caf=>'00000000-0000-0000-0000-000000000112'),'42501:%','POS Supervisor alone (no admin membership) denied');
select pg_temp.as_user(current_setting('t.platform'));
select alike(pg_temp.attempt(),'42501:%','Platform Admin has no standing tenant financial read');
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select platform_enter_sandbox_pov(gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe','cafeteria_admin');
select alike(pg_temp.attempt(caf=>'b9496342-5079-46ae-83b8-05c39bcbd7fe'),'42501:%','Sandbox Cafeteria Admin POV denied financial transactions');
reset role;

-- Period and filter contract (shared periods with 5D.1–5D.3)
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.today',pg_temp.tx()->>'today',true);
select is(pg_temp.tx('last_7_days')->>'from',(current_setting('t.today')::date-6)::text,'Últimos 7 días is inclusive of today');
select is(pg_temp.tx('last_30_days')->>'from',(current_setting('t.today')::date-29)::text,'Últimos 30 días is inclusive of today');
select is(pg_temp.attempt('custom',current_setting('t.today')::date-91,current_setting('t.today')::date),'ok','92-day custom range accepted');
select is(pg_temp.attempt('custom',current_setting('t.today')::date-92,current_setting('t.today')::date),'22023:report_range_too_long','93-day range rejected');
select is(pg_temp.attempt('custom',current_setting('t.today')::date,current_setting('t.today')::date-1),'22023:invalid_report_range','Reversed range rejected');
select is(pg_temp.attempt('custom',current_setting('t.today')::date,current_setting('t.today')::date+1),'22023:invalid_report_range','Future end rejected');
select is(pg_temp.attempt('today',current_setting('t.today')::date),'22023:invalid_report_period','Preset with explicit dates rejected');
select is(pg_temp.attempt('yesterday'),'22023:invalid_report_period','Unknown period rejected');
select is(pg_temp.attempt(null),'22023:invalid_report_period','A period is required unless searching a receipt');
select is(pg_temp.attempt(tender=>'card'),'22023:invalid_tender','Unknown tender rejected');
select is(pg_temp.attempt(status=>'refunded'),'22023:invalid_refund_status','Unknown refund status rejected');
select is(pg_temp.attempt(off=>-1),'22023:invalid_page','Negative page rejected');
select is(pg_temp.attempt(receipt=>5),'22023:invalid_receipt_search','Receipt search is not combined with a period');
select is(pg_temp.attempt(null,receipt=>0),'22023:invalid_receipt_search','Receipt must be positive');
select is(pg_temp.attempt(null,tender=>'cash',receipt=>5),'22023:invalid_receipt_search','Receipt search is not combined with filters');
select is(pg_temp.tx(null,receipt=>999999999)->>'total_count','0','Unknown receipt finds nothing');
select is(pg_temp.tx()->>'page_size','25','Bounded page size');

-- Business-time boundary: 02:30 UTC on Nov 1 is still Oct 31 in Santo Domingo (UTC−4).
reset role;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select '2026-11-01 02:30:00+00'::timestamptz$$;
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.tx()->>'today','2026-10-31','Hoy is the school-local business date, not the UTC date');
select is(pg_temp.tx()->>'from','2026-10-31','Hoy filters that business date');
reset role;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()$$;

-- Baselines (deltas isolate pre-existing local data)
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.b_all',pg_temp.n(pg_temp.tx())::text,true);
select set_config('t.b_cash',pg_temp.n(pg_temp.tx(tender=>'cash'))::text,true);
select set_config('t.b_wallet',pg_temp.n(pg_temp.tx(tender=>'student_wallet'))::text,true);
select set_config('t.b_staff',pg_temp.n(pg_temp.tx(tender=>'staff_credit'))::text,true);
select set_config('t.b_none',pg_temp.n(pg_temp.tx(status=>'none'))::text,true);
select set_config('t.b_partial',pg_temp.n(pg_temp.tx(status=>'partial'))::text,true);
select set_config('t.b_full',pg_temp.n(pg_temp.tx(status=>'full'))::text,true);
select set_config('t.b_full_cash',pg_temp.n(pg_temp.tx(tender=>'cash',status=>'full'))::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select set_config('t.b112',pg_temp.n(pg_temp.tx(caf=>'00000000-0000-0000-0000-000000000112'))::text,true);

-- Staff receivable for the staff-credit sale (as Phase 5A / 5D.3).
reset role;
insert into staff_campus_affiliations(account_id,school_id,staff_affiliation_id,school_location_id)
values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006501','00000000-0000-0000-0000-000000000211')
on conflict do nothing;
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select configure_staff_receivable_account('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000006501',0,false,null,'5d4-staff-create-0001');
select configure_staff_receivable_account('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000006501',1,true,'100000','5d4-staff-enable-0001');
select school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',100000,'5d400000-0000-4000-8000-000000000001','Fondos locales 5D.4','Verificado');

-- Fixture (register 9401, supervisor-direct refunds):
--  none   cash ×1             no refund
--  part   cash ×3             item refund ×1                    → partial 5000/10000
--  full   cash ×2             item refund ×1, then ×1           → cumulative full 10000/0
--  wallet PIKAS Cash ×1       item refund ×1                    → full (wallet refund)
--  staff  staff credit ×1     no refund
--  legacy cash ×2             amount-only 1000                  → partial, unallocated 1000
--  mixed  cash ×2             item ×1, then amount-only 5000    → full; 1 unit itemized, 5000 unallocated
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401'::uuid,'00000000-0000-0000-0000-000000009503'::uuid,10000,'5d4-open-session-0001')),true);
select set_config('t.none',pg_temp.sale(current_setting('t.sid'),'5d4-sale-none-00001',1,'cash')::text,true);
select set_config('t.part',pg_temp.sale(current_setting('t.sid'),'5d4-sale-part-00001',3,'cash')::text,true);
select set_config('t.full',pg_temp.sale(current_setting('t.sid'),'5d4-sale-full-00001',2,'cash')::text,true);
select set_config('t.wallet',pg_temp.sale(current_setting('t.sid'),'5d4-sale-wallet-0001',1,'student_wallet')::text,true);
select set_config('t.staff',pg_temp.sale(current_setting('t.sid'),'5d4-sale-staff-00001',1,'staff_credit','00000000-0000-0000-0000-000000006902')::text,true);
select set_config('t.legacy',pg_temp.sale(current_setting('t.sid'),'5d4-sale-legacy-0001',2,'cash')::text,true);
select set_config('t.mixed',pg_temp.sale(current_setting('t.sid'),'5d4-sale-mixed-00001',2,'cash')::text,true);
select pg_temp.refund(current_setting('t.sid'),current_setting('t.part')::uuid,1,'5d4-refund-part-0001');
select pg_temp.refund(current_setting('t.sid'),current_setting('t.full')::uuid,1,'5d4-refund-full-0001');
select pg_temp.refund(current_setting('t.sid'),current_setting('t.full')::uuid,1,'5d4-refund-full-0002');
select pg_temp.refund(current_setting('t.sid'),current_setting('t.wallet')::uuid,1,'5d4-refund-wallet-001');
select create_purchase_refund(current_setting('t.legacy')::uuid,'1000','error',null,'5d4-legacy-amount-0001',
 '00000000-0000-0000-0000-000000004603',current_setting('t.sid')::uuid,null);
-- Phase 5C forbids item refunds after an amount-only refund, so the mixed case is item first.
select pg_temp.refund(current_setting('t.sid'),current_setting('t.mixed')::uuid,1,'5d4-refund-mixed-0001');
select create_purchase_refund(current_setting('t.mixed')::uuid,'5000','error',null,'5d4-legacy-amount-0002',
 '00000000-0000-0000-0000-000000004603',current_setting('t.sid')::uuid,null);
reset role;
select is((select count(*) from refund_items ri join refunds r on r.id=ri.refund_id where r.purchase_id in (current_setting('t.legacy')::uuid,current_setting('t.mixed')::uuid)),1::bigint,
 'Fixture: only the mixed purchase has one itemized refund; amount-only refunds have no item lines');

-- Refund state on each transaction (server-computed)
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.state(current_setting('t.none')::uuid),'none/0/5000','No refund: none, nothing refunded, full amount remaining');
select is(pg_temp.state(current_setting('t.part')::uuid),'partial/5000/10000','Partial item refund: partial');
select is(pg_temp.state(current_setting('t.full')::uuid),'full/10000/0','Cumulative item refunds reaching the total: full');
select is(pg_temp.state(current_setting('t.wallet')::uuid),'full/5000/0','PIKAS Cash sale fully refunded to the wallet: full');
select is(pg_temp.state(current_setting('t.staff')::uuid),'none/0/5000','Staff-credit sale: none');
select is(pg_temp.state(current_setting('t.legacy')::uuid),'partial/1000/9000','Amount-only refund counts at transaction level: partial');
select is(pg_temp.state(current_setting('t.mixed')::uuid),'full/10000/0','Amount-only + item refund reaching the total: full');
select is(pg_temp.row(current_setting('t.wallet')::uuid)->>'tender','student_wallet','Row keeps the authoritative tender');
select is(pg_temp.row(current_setting('t.none')::uuid)->>'business_date',current_setting('t.today'),'Row carries its business date');
select is((select concat_ws('/',count(*),min(remaining_after_minor) filter (where refund_ordinal=2)) from refunds where purchase_id=current_setting('t.full')::uuid),'2/0',
 'Full status agrees with the stored remaining_after_minor (0) after 2 refunds');

-- Filters over the whole set (deltas)
select is(pg_temp.n(pg_temp.tx())-current_setting('t.b_all')::integer,7,'Hoy: all 7 new transactions');
select is(pg_temp.n(pg_temp.tx(tender=>'cash'))-current_setting('t.b_cash')::integer,5,'Efectivo: 5');
select is(pg_temp.n(pg_temp.tx(tender=>'student_wallet'))-current_setting('t.b_wallet')::integer,1,'PIKAS Cash: 1');
select is(pg_temp.n(pg_temp.tx(tender=>'staff_credit'))-current_setting('t.b_staff')::integer,1,'Crédito de personal: 1');
select is(pg_temp.n(pg_temp.tx(status=>'none'))-current_setting('t.b_none')::integer,2,'Sin reembolso: 2');
select is(pg_temp.n(pg_temp.tx(status=>'partial'))-current_setting('t.b_partial')::integer,2,'Reembolso parcial: 2 (item and amount-only)');
select is(pg_temp.n(pg_temp.tx(status=>'full'))-current_setting('t.b_full')::integer,3,'Reembolsada: 3');
select is(pg_temp.n(pg_temp.tx(tender=>'cash',status=>'full'))-current_setting('t.b_full_cash')::integer,2,'Filters combine: cash and fully refunded = 2');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.tx(status=>'partial')->'data') x where x->>'refund_status'<>'partial'),'Every returned row matches the refund-status filter');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.tx(tender=>'staff_credit')->'data') x where x->>'tender'<>'staff_credit'),'Every returned row matches the tender filter');
select is(pg_temp.n(pg_temp.tx(null,receipt=>pg_temp.receipt(current_setting('t.part')::uuid))),1,'Exact receipt search finds one transaction');
select is(pg_temp.tx(null,receipt=>pg_temp.receipt(current_setting('t.part')::uuid))->'data'->0->>'id',current_setting('t.part'),'… the right one');
select is(pg_temp.n(pg_temp.tx('custom',current_setting('t.today')::date-1,current_setting('t.today')::date-1))-0,
 (select count(*)::integer from purchases where cafeteria_id='00000000-0000-0000-0000-000000000111' and business_date=current_setting('t.today')::date-1),'Yesterday excludes today''s sales');
select is(pg_temp.n(pg_temp.tx('last_7_days'))-pg_temp.n(pg_temp.tx('custom',current_setting('t.today')::date-6,current_setting('t.today')::date)),0,'Últimos 7 días equals the matching custom range');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select is(pg_temp.n(pg_temp.tx(caf=>'00000000-0000-0000-0000-000000000112')),current_setting('t.b112')::integer,'Cafeteria 111 transactions never reach cafeteria 112');
select is(pg_temp.n(cafeteria_transactions_read('00000000-0000-0000-0000-000000000112'::uuid,null,null,null,null,null,pg_temp.receipt(current_setting('t.part')::uuid),0)),
 (select count(*)::integer from purchases where cafeteria_id='00000000-0000-0000-0000-000000000112' and purchase_number=pg_temp.receipt(current_setting('t.part')::uuid)),
 'Receipt search is scoped to the requested cafeteria');

-- Business-date boundary with real rows: three days later, today's sales are outside Hoy but inside 7 days.
reset role;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()+interval '3 days'$$;
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.tx()->'data') x where x->>'id'=current_setting('t.none')),'Three days later the sale is not in Hoy');
select is(pg_temp.n(pg_temp.tx('last_7_days')),pg_temp.n(pg_temp.tx('custom',current_setting('t.today')::date-3,current_setting('t.today')::date+3)),'… and remains in the 7-day range by business date');
reset role;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()$$;

-- Pagination: the page and the count come from the same filtered set
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
do $$begin for i in 1..24 loop perform pg_temp.sale(current_setting('t.sid'),'5d4-sale-page-'||lpad(i::text,5,'0'),1,'cash'); end loop; end$$;
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.p0',pg_temp.tx(tender=>'cash')::text,true);
select set_config('t.p1',pg_temp.tx(tender=>'cash',off=>25)::text,true);
select is(pg_temp.n(current_setting('t.p0')::jsonb)-current_setting('t.b_cash')::integer,29,'Filtered count: 29 new cash sales (5 + 24)');
select is(jsonb_array_length(current_setting('t.p0')::jsonb->'data'),25,'First page holds 25 rows');
select is((current_setting('t.p0')::jsonb->>'has_more')::boolean,pg_temp.n(current_setting('t.p0')::jsonb)>25,'has_more reflects the filtered set');
select is(jsonb_array_length(current_setting('t.p1')::jsonb->'data'),least(25,pg_temp.n(current_setting('t.p0')::jsonb)-25),'Second page holds the next rows of the filtered set');
select ok(not exists(select 1 from jsonb_array_elements(current_setting('t.p0')::jsonb->'data') a join jsonb_array_elements(current_setting('t.p1')::jsonb->'data') b on a->>'id'=b->>'id'),'Pages do not overlap');
select ok((select bool_and((x->>'purchased_at')::timestamptz>=(y->>'purchased_at')::timestamptz) from jsonb_array_elements(current_setting('t.p0')::jsonb->'data') with ordinality a(x,i)
 join jsonb_array_elements(current_setting('t.p0')::jsonb->'data') with ordinality b(y,j) on j=i+1),'Most recent first');

-- Detail
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.d',(cafeteria_transaction_detail('00000000-0000-0000-0000-000000000111',current_setting('t.part')::uuid)->'data')::text,true);
select is(current_setting('t.d')::jsonb->>'refund_status','partial','Detail: refund status');
select is(concat_ws('/',current_setting('t.d')::jsonb->'items'->0->>'quantity',current_setting('t.d')::jsonb->'items'->0->>'refunded_quantity',current_setting('t.d')::jsonb->'items'->0->>'refunded_minor'),'3/1/5000','Detail: item quantity and authoritative refunded quantity/amount');
select is(jsonb_array_length(current_setting('t.d')::jsonb->'refunds'),1,'Detail: one refund event');
select is(concat_ws('/',current_setting('t.d')::jsonb->'refunds'->0->>'amount_minor',current_setting('t.d')::jsonb->'refunds'->0->>'remaining_after_minor',
 current_setting('t.d')::jsonb->'refunds'->0->>'itemized',current_setting('t.d')::jsonb->'refunds'->0->>'authorization_mode',current_setting('t.d')::jsonb->'refunds'->0->>'tender'),
 '5000/10000/true/supervisor_direct/cash','Detail: refund event amount, remaining after, itemized, authorization and tender');
select is(current_setting('t.d')::jsonb->>'cash_received_minor','15000','Detail keeps the Phase 5A purchase detail (cash received)');
select set_config('t.dl',(cafeteria_transaction_detail('00000000-0000-0000-0000-000000000111',current_setting('t.legacy')::uuid)->'data')::text,true);
select is(concat_ws('/',current_setting('t.dl')::jsonb->'items'->0->>'refunded_quantity',current_setting('t.dl')::jsonb->'items'->0->>'refunded_minor'),'0/0','Amount-only refund is never assigned to an item');
select is(concat_ws('/',current_setting('t.dl')::jsonb->'refunds'->0->>'itemized',current_setting('t.dl')::jsonb->'refunds'->0->>'unallocated_minor',
 jsonb_array_length(current_setting('t.dl')::jsonb->'refunds'->0->'items')::text,current_setting('t.dl')::jsonb->>'unallocated_refund_minor'),'false/1000/0/1000','Amount-only refund reported as unallocated');
select set_config('t.dm',(cafeteria_transaction_detail('00000000-0000-0000-0000-000000000111',current_setting('t.mixed')::uuid)->'data')::text,true);
select is(concat_ws('/',current_setting('t.dm')::jsonb->>'refund_status',current_setting('t.dm')::jsonb->'items'->0->>'refunded_quantity',current_setting('t.dm')::jsonb->>'unallocated_refund_minor',
 jsonb_array_length(current_setting('t.dm')::jsonb->'refunds')::text),'full/1/5000/2','Mixed: full, one unit itemized, 5000 unallocated, two events');
select is(concat_ws('/',current_setting('t.dm')::jsonb->'refunds'->0->'items'->0->>'quantity',current_setting('t.dm')::jsonb->'refunds'->1->>'itemized'),'1/false','Mixed: the itemized event lists its line; the amount-only event has none');
select is(cafeteria_transaction_detail('00000000-0000-0000-0000-000000000111',current_setting('t.none')::uuid)->'data'->'refunds','[]'::jsonb,'No refunds: empty history');
select alike(pg_temp.detail_attempt(current_setting('t.none')::uuid,'00000000-0000-0000-0000-000000000112'),'42501:%','Detail of another cafeteria''s purchase via a foreign cafeteria id denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select alike(pg_temp.detail_attempt(current_setting('t.none')::uuid),'42501:%','Unrelated Cafeteria Admin cannot read the detail');
select alike(pg_temp.detail_attempt(current_setting('t.none')::uuid,'00000000-0000-0000-0000-000000000112'),'42501:not_authorized','A purchase outside the cafeteria is not found through it');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select alike(pg_temp.detail_attempt(current_setting('t.none')::uuid),'42501:%','Cashier cannot read the detail');

-- Read-only: reading never writes financial rows
reset role;
select set_config('t.rows',(select concat_ws('/',(select count(*) from purchases),(select count(*) from refunds),(select count(*) from refund_items),(select count(*) from financial_approvals))),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select pg_temp.tx('last_30_days'); select cafeteria_transaction_detail('00000000-0000-0000-0000-000000000111',current_setting('t.mixed')::uuid);
reset role;
select is(concat_ws('/',(select count(*) from purchases),(select count(*) from refunds),(select count(*) from refund_items),(select count(*) from financial_approvals)),current_setting('t.rows'),'Reads write nothing');

-- Phase 5A read unchanged
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok(not ((cafeteria_operations_read('00000000-0000-0000-0000-000000000111','transactions',0,null)->'data'->0) ? 'refund_status'),'Phase 5A transactions read is unchanged (no new fields)');

select * from finish();
rollback;
