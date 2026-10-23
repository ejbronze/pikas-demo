-- Phase 5D.2 top products by net units (202610220001). Fictional local fixtures only.
-- 2003 Cafeteria Admin 111; 2004 Cafeteria Admin 112; 2011 POS Supervisor of 111 (register 9401 /
-- assignment 9503 / membership 4603); 2008 cashier 111 / supervisor 112; 2002 School Admin; 2001 Account Admin.
-- Test products have new IDs (5d200000-…-01xx) so assertions hold regardless of other local data.
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
create function pg_temp.pid(n integer) returns uuid language sql immutable as $$select ('5d200000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid$$;
create function pg_temp.top(period text,f date default null,t date default null,caf text default '00000000-0000-0000-0000-000000000111') returns jsonb
 language sql as $$select cafeteria_report_read(caf::uuid,'top_products',period,f,t)$$;
create function pg_temp.attempt(period text,f date default null,t date default null,caf text default '00000000-0000-0000-0000-000000000111') returns text
 language plpgsql as $$declare m text; begin perform cafeteria_report_read(caf::uuid,'top_products',period,f,t); return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
-- One product's row (or null) and its rank within a result.
create function pg_temp.row(r jsonb,n integer) returns jsonb language sql as $$
 select x from jsonb_array_elements(r->'data'->'products') x where x->>'product_id'=pg_temp.pid(n)::text$$;
create function pg_temp.units(r jsonb,n integer) returns text language sql as $$
 select (pg_temp.row(r,n)->>'gross_units')||'/'||(pg_temp.row(r,n)->>'refunded_units')||'/'||(pg_temp.row(r,n)->>'net_units')$$;
create function pg_temp.rank(r jsonb,n integer) returns integer language sql as $$select (pg_temp.row(r,n)->>'rank')::integer$$;
create function pg_temp.product(n integer,name text,version integer default null) returns void language sql as $$
 select cafeteria_admin_command('00000000-0000-0000-0000-000000000111',gen_random_uuid(),'product_save',jsonb_build_object('id',pg_temp.pid(n),'version',version,
  'name',name,'description','Producto ficticio 5D.2','category','Pruebas 5D.2','price_minor',1000,'unit','unidad','active',true,'available',true,'ingredients','[]'::jsonb,'allergens','[]'::jsonb))$$;
create function pg_temp.sale(key text,n integer,qty integer,version integer default 1) returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',current_setting('t.sid'),'cafeteria_customer_id',null,
  'items',jsonb_build_array(jsonb_build_object('product_id',pg_temp.pid(n),'quantity',qty,'expected_product_version',version,'expected_unit_price_minor','1000')),
  'expected_total_minor',(1000*qty)::text,'tender',jsonb_build_object('type','cash','cash_received_minor',(1000*qty)::text)))->>'purchase_id')::uuid$$;
create function pg_temp.refund(p uuid,qty integer,key text) returns jsonb language sql as $$
 select create_purchase_item_refund(current_setting('t.sid')::uuid,p,
  jsonb_build_array(jsonb_build_object('purchase_item_id',(select id from purchase_items where purchase_id=p),'quantity',qty)),'wrong_product',null,key,null)$$;
reset role; select set_config('t.platform','7a000000-0000-4000-8000-00000000ad01',true);

-- Authority (identical to 5D.1 sales_summary)
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.top('today')->>'kind','top_products','Cafeteria Admin reads own top products');
select alike(pg_temp.attempt('today',null,null,'00000000-0000-0000-0000-000000000112'),'42501:%','Cafeteria Admin of 111 cannot read cafeteria 112');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select alike(pg_temp.attempt('today'),'42501:%','Unrelated Cafeteria Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select alike(pg_temp.attempt('today'),'42501:%','School Admin denied (D1)');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select alike(pg_temp.attempt('today'),'42501:%','Account Admin denied (D2)');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select alike(pg_temp.attempt('today'),'42501:%','Cashier denied');
select alike(pg_temp.attempt('today',null,null,'00000000-0000-0000-0000-000000000112'),'42501:%','POS Supervisor without admin membership denied');
select pg_temp.as_user(current_setting('t.platform'));
select alike(pg_temp.attempt('today'),'42501:%','Platform Admin denied');

-- Same period contract as 5D.1
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.today',pg_temp.top('today')->>'today',true);
select is(pg_temp.attempt('custom',current_setting('t.today')::date-92,current_setting('t.today')::date),'22023:report_range_too_long','>92 days rejected');
select is(pg_temp.attempt('custom',current_setting('t.today')::date,current_setting('t.today')::date-1),'22023:invalid_report_range','Reversed range rejected');
select is(pg_temp.top('last_30_days')->>'from',(current_setting('t.today')::date-29)::text,'Top products follow the selected period (30 days is a period, not a fixed window)');
select is(pg_temp.top('last_7_days')->>'from',(current_setting('t.today')::date-6)::text,'Top products follow a 7-day selection');
reset role;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select '2026-11-01 02:30:00+00'::timestamptz$$;
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.top('today')->>'today','2026-10-31','Business-date boundary uses the school timezone');
reset role;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()$$;

-- Fixture products: P4 and P5 deliberately share a display name.
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select pg_temp.product(1,'Top Uno'); select pg_temp.product(2,'Top Dos'); select pg_temp.product(3,'Top Tres');
select pg_temp.product(4,'Producto gemelo'); select pg_temp.product(5,'Producto gemelo');
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009503',100000,'5d2-open-supervisor-001')),true);
select set_config('t.p1',pg_temp.sale('5d2-sale-p1-000001',1,15)::text,true);
select set_config('t.p2',pg_temp.sale('5d2-sale-p2-000001',2,13)::text,true);
select set_config('t.p3',pg_temp.sale('5d2-sale-p3-000001',3,6)::text,true);
select set_config('t.p4',pg_temp.sale('5d2-sale-p4-000001',4,5)::text,true);
select set_config('t.p5',pg_temp.sale('5d2-sale-p5-000001',5,5)::text,true);
-- Partial refund (P1 3 of 15); P3 fully refunded through two refunds (2 then 4).
select pg_temp.refund(current_setting('t.p1')::uuid,3,'5d2-refund-p1-part1');
select pg_temp.refund(current_setting('t.p3')::uuid,2,'5d2-refund-p3-part1');
select pg_temp.refund(current_setting('t.p3')::uuid,4,'5d2-refund-p3-part2');
-- Amount-only (legacy pre-5C.1 API) refund on a separate purchase of P4: never allocated to units.
select set_config('t.p4b',pg_temp.sale('5d2-sale-p4-000002',4,2)::text,true);
select set_config('t.legacy',(create_purchase_refund(current_setting('t.p4b')::uuid,'1000','error',null,'5d2-legacy-amount-0001',
 '00000000-0000-0000-0000-000000004603',current_setting('t.sid')::uuid,null)->>'refund_id'),true);
reset role;
select is((select count(*) from refund_items where refund_id=current_setting('t.legacy')::uuid),0::bigint,'Legacy refund has no item detail (detectable)');

select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.a',pg_temp.top('today')::text,true);
select is(pg_temp.units(current_setting('t.a')::jsonb,1),'15/3/12','Partial item refund: 15 sold, 3 refunded, 12 net');
select is(pg_temp.units(current_setting('t.a')::jsonb,2),'13/0/13','Unrefunded product: gross = net');
select is(pg_temp.units(current_setting('t.a')::jsonb,3),'6/6/0','Multiple refunds sum to a full item refund (net 0)');
select is(pg_temp.units(current_setting('t.a')::jsonb,4),'7/0/7','Amount-only refund is not fabricated into refunded units');
select ok(pg_temp.rank(current_setting('t.a')::jsonb,2)<pg_temp.rank(current_setting('t.a')::jsonb,1),'Ranked by net units, not gross (13 net above 15 gross / 12 net)');
select ok(pg_temp.rank(current_setting('t.a')::jsonb,1)<pg_temp.rank(current_setting('t.a')::jsonb,4) and pg_temp.rank(current_setting('t.a')::jsonb,4)<pg_temp.rank(current_setting('t.a')::jsonb,5),'Net-unit order 12 > 7 > 5');
select ok(pg_temp.rank(current_setting('t.a')::jsonb,5)<pg_temp.rank(current_setting('t.a')::jsonb,3),'Zero-net product still listed after positive ones');
select is((current_setting('t.a')::jsonb->'data'->>'refunds_without_item_detail')::integer>=1,true,'Refunds lacking item detail are counted for the UI limitation note');
select is(pg_temp.row(current_setting('t.a')::jsonb,4)->>'product_name','Producto gemelo','G5: name from the purchase-item snapshot');
select isnt(pg_temp.row(current_setting('t.a')::jsonb,4)->>'product_id',pg_temp.row(current_setting('t.a')::jsonb,5)->>'product_id','Same display name, distinct product IDs stay separate');
select is((select bool_and((x->>'rank')::integer=o) and bool_and((x->>'net_units')::numeric=(x->>'gross_units')::numeric-(x->>'refunded_units')::numeric)
 from jsonb_array_elements(current_setting('t.a')::jsonb->'data'->'products') with ordinality e(x,o)),true,'Ranks are contiguous and net = gross − refunded on every row');
select is((select bool_and(prev is null or prev_net>(x->>'net_units')::numeric or (prev_net=(x->>'net_units')::numeric and prev<(x->>'product_id')))
 from (select x,lag(x->>'product_id') over w prev,lag((x->>'net_units')::numeric) over w prev_net
  from jsonb_array_elements(current_setting('t.a')::jsonb->'data'->'products') with ordinality e(x,o) window w as (order by o)) s),true,'Deterministic order: net units desc, then product_id asc');

-- G5 rename and tie: P1 renamed then sold once more → net 13 ties P2; lower product_id ranks first.
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select pg_temp.product(1,'Top Uno Renombrado',1);
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select pg_temp.sale('5d2-sale-p1-000002',1,1,2);
-- Six more products (net 2 each) push the zero-net P3 out of the top 10.
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select pg_temp.product(n,'Top extra '||n) from generate_series(6,11) n;
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select pg_temp.sale('5d2-sale-extra-'||lpad(n::text,5,'0'),n,2) from generate_series(6,11) n;
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.b',pg_temp.top('today')::text,true);
select is(pg_temp.units(current_setting('t.b')::jsonb,1),'16/3/13','Renamed product keeps one identity (activity not split)');
select is(pg_temp.row(current_setting('t.b')::jsonb,1)->>'product_name','Top Uno Renombrado','G5: most recent contributing snapshot name is shown');
select is(pg_temp.rank(current_setting('t.b')::jsonb,2)-pg_temp.rank(current_setting('t.b')::jsonb,1),1,'Tie on net units broken by product_id ascending');
select is(jsonb_array_length(current_setting('t.b')::jsonb->'data'->'products'),10,'At most 10 products returned');
select ok((current_setting('t.b')::jsonb->'data'->>'product_count')::integer>=11,'product_count reports all products with activity');
select ok(pg_temp.row(current_setting('t.b')::jsonb,3) is null,'Products outside the top 10 are not returned');

-- Cross-period refund (event period): 2 units of P2 refunded three business days later.
reset role;
create or replace function pikas_private.refund_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()+interval '3 days'$$;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()+interval '3 days'$$;
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select pg_temp.refund(current_setting('t.p2')::uuid,2,'5d2-refund-p2-later');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.c',pg_temp.top('today')::text,true);
select is(pg_temp.units(current_setting('t.c')::jsonb,2),'0/2/-2','Refund-only period: 0 sold, 2 refunded, −2 net (not clamped)');
select is((current_setting('t.c')::jsonb->'data'->>'product_count')::integer,1,'Refund-only product appears; nothing else that day');
select is(pg_temp.units(pg_temp.top('custom',current_setting('t.today')::date,current_setting('t.today')::date),2),'13/0/13','Original sale day is not rewritten by the later refund');
select is(pg_temp.units(pg_temp.top('custom',current_setting('t.today')::date,current_setting('t.today')::date+3),2),'13/2/11','A range covering both days nets both events');
select is(pg_temp.top('custom',current_setting('t.today')::date+1,current_setting('t.today')::date+2)->'data','{"products": [], "product_count": 0, "refunds_without_item_detail": 0}'::jsonb,'No activity: empty list, zero count');

-- Cross-cafeteria isolation
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.top('last_30_days',null,null,'00000000-0000-0000-0000-000000000112')->'data'->'products') x
 where x->>'product_id' like '5d200000-%'),'Cafeteria 111 products never appear in cafeteria 112');

-- 5D.1 regression through the replaced function
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.units(current_setting('t.a')::jsonb,1),'15/3/12','(fixture unchanged)');
select ok((cafeteria_report_read('00000000-0000-0000-0000-000000000111','sales_summary','custom',current_setting('t.today')::date,current_setting('t.today')::date+3)->'data'->>'refunds_minor')::numeric>=12000,
 'sales_summary still reports refunds by event date (3+2+4+2 units and the 1000 amount-only refund)');
select is(cafeteria_report_read('00000000-0000-0000-0000-000000000111','sales_summary','today')->'data'->>'net_sales_minor','-2000','sales_summary refund-only day still negative');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select throws_ok($$select cafeteria_report_read('00000000-0000-0000-0000-000000000111','sales_summary','today')$$,'42501',null,'sales_summary authority unchanged (School Admin denied)');
select * from finish();
rollback;
