-- Cafetería Hoy V1 read (202611070001). Fictional local fixtures only.
-- 2003 Cafeteria Admin 111; 2004 Cafeteria Admin 112; 2011 POS Supervisor (register 9401 /
-- assignment 9503) of 111; 2008 cashier 111 / supervisor 112; 2002 School Admin 11; 2001 Account Admin.
-- The report clock is moved to Tuesday 2030-03-12 12:40 in Santo Domingo (UTC−4), and the
-- fixture sales are placed on that day and on the same weekday one week earlier, so no
-- pre-existing local sale can fall on either day.
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
create function pg_temp.today(caf text default '00000000-0000-0000-0000-000000000111') returns jsonb
 language sql as $$select cafeteria_today_read(caf::uuid)$$;
create function pg_temp.attempt(caf text default '00000000-0000-0000-0000-000000000111') returns text
 language plpgsql as $$declare m text; begin perform cafeteria_today_read(caf::uuid); return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.hour(r jsonb,h integer,k text) returns text language sql as $$
 select x->>k from jsonb_array_elements(r->'data'->'hours') x where (x->>'hour')::integer=h$$;
create function pg_temp.sale(key text,qty integer,tender text,customer text default '00000000-0000-0000-0000-000000006901') returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',current_setting('t.sid'),
 'cafeteria_customer_id',customer,'items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',qty,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor',(5000*qty)::text,
 'tender',case tender when 'cash' then jsonb_build_object('type','cash','cash_received_minor',(5000*qty)::text) else jsonb_build_object('type',tender) end))->>'purchase_id')::uuid$$;
-- Fixture placement only: checkout always stamps the real time, so the test moves its own fictional
-- sales with triggers bypassed for this one owner statement. Everything is rolled back; the
-- business_date check constraint still holds because it is recomputed from the new time.
create function pg_temp.place(p uuid,at timestamptz) returns void language plpgsql as $$begin
 set local session_replication_role=replica;
 update purchases set purchased_at=at,business_date=(at at time zone business_timezone_snapshot)::date where id=p;
 set local session_replication_role=origin; end$$;
create function pg_temp.clock(at text) returns void language plpgsql as $$begin
 execute 'reset role';
 execute format('create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='''' as $c$select %L::timestamptz$c$',at);
end$$;

-- Privileges
select ok(has_function_privilege('authenticated','cafeteria_today_read(uuid)','execute'),'Authenticated may call the Hoy read');
select ok(not has_function_privilege('anon','cafeteria_today_read(uuid)','execute')
 and not has_function_privilege('service_role','cafeteria_today_read(uuid)','execute'),'No anonymous or service bypass');
reset role; select set_config('t.platform','7a000000-0000-4000-8000-00000000ad01',true);

-- Authority: the 5D.1 purchase-history authority, nothing broader
select pg_temp.clock('2030-03-12 16:40:00+00');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt(),'ok','Cafeteria Admin reads its own cafeteria');
select alike(pg_temp.attempt('00000000-0000-0000-0000-000000000112'),'42501:%','Cafeteria Admin of 111 cannot read cafeteria 112');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select alike(pg_temp.attempt(),'42501:%','Admin of another cafeteria denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select alike(pg_temp.attempt(),'42501:%','School Admin gets no cafeteria commercial data');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select alike(pg_temp.attempt(),'42501:%','Account Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select alike(pg_temp.attempt(),'42501:%','Cashier denied');
select alike(pg_temp.attempt('00000000-0000-0000-0000-000000000112'),'42501:%','POS Supervisor without admin membership denied');
select pg_temp.as_user(current_setting('t.platform'));
select alike(pg_temp.attempt(),'42501:%','Platform Admin has no standing tenant commercial read');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select alike((select pg_temp.attempt('7e000000-0000-4000-8000-00000000dead')),'42501:%','Unknown cafeteria id refused');

-- No history: an empty day and an empty baseline
select set_config('t.empty',pg_temp.today()::text,true);
select is(current_setting('t.empty')::jsonb->>'today','2030-03-12','Hoy is the school-local business date');
select is(current_setting('t.empty')::jsonb->>'baseline_date','2030-03-05','Baseline is the same weekday last week');
select is(current_setting('t.empty')::jsonb->>'as_of_local','2030-03-12T12:40','Cutoff is the current local time');
select is(current_setting('t.empty')::jsonb->>'business_timezone','America/Santo_Domingo','School business timezone');
select is(jsonb_array_length(current_setting('t.empty')::jsonb->'data'->'hours'),24,'Always 24 hourly rows');
select is(current_setting('t.empty')::jsonb->'data'->>'today_gross_minor','0','Zero sales today: RD$0');
select is((current_setting('t.empty')::jsonb->'data'->>'today_count')::integer,0,'Zero sales today: no transactions');
select is((current_setting('t.empty')::jsonb->'data'->'baseline'->>'day_count')::integer,0,'No baseline history reported as zero baseline sales');
select ok((select bool_and(x->>'today_gross_minor'='0' and x->>'baseline_gross_minor'='0') from jsonb_array_elements(current_setting('t.empty')::jsonb->'data'->'hours') x),'Empty day: every hour is zero');

-- Fixture sales by the POS Supervisor, then placed on the two days
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009503',10000,'hoy-open-supervisor-0001')),true);
select set_config('t.s1',pg_temp.sale('hoy-sale-today-0815',2,'cash')::text,true);
select set_config('t.s2',pg_temp.sale('hoy-sale-today-1210',1,'cash')::text,true);
select set_config('t.s3',pg_temp.sale('hoy-sale-today-1239',1,'cash')::text,true);
select set_config('t.b1',pg_temp.sale('hoy-sale-base-0930',1,'cash')::text,true);
select set_config('t.b2',pg_temp.sale('hoy-sale-base-1240',1,'cash')::text,true);
select set_config('t.b3',pg_temp.sale('hoy-sale-base-1241',1,'cash')::text,true);
select set_config('t.b4',pg_temp.sale('hoy-sale-base-1500',2,'cash')::text,true);
select set_config('t.y1',pg_temp.sale('hoy-sale-yesterday',1,'cash')::text,true);
-- A refund of the 08:15 sale (refund events are reported by the summary, never netted here)
select create_purchase_item_refund(current_setting('t.sid')::uuid,current_setting('t.s1')::uuid,
 jsonb_build_array(jsonb_build_object('purchase_item_id',(select id from purchase_items where purchase_id=current_setting('t.s1')::uuid),'quantity',1)),'wrong_product',null,'hoy-refund-today-0815',null);
reset role;
select pg_temp.place(current_setting('t.s1')::uuid,'2030-03-12 12:15:00+00');
select pg_temp.place(current_setting('t.s2')::uuid,'2030-03-12 16:10:00+00');
select pg_temp.place(current_setting('t.s3')::uuid,'2030-03-12 16:39:30+00');
select pg_temp.place(current_setting('t.b1')::uuid,'2030-03-05 13:30:00+00');
select pg_temp.place(current_setting('t.b2')::uuid,'2030-03-05 16:40:00+00');
select pg_temp.place(current_setting('t.b3')::uuid,'2030-03-05 16:41:00+00');
select pg_temp.place(current_setting('t.b4')::uuid,'2030-03-05 19:00:00+00');
select pg_temp.place(current_setting('t.y1')::uuid,'2030-03-11 16:00:00+00');

select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.r',pg_temp.today()::text,true);
select is(current_setting('t.r')::jsonb->'data'->>'today_gross_minor','20000','Today: gross of the three sales placed today');
select is((current_setting('t.r')::jsonb->'data'->>'today_count')::integer,3,'Today: each purchase counted once');
select is(current_setting('t.r')::jsonb->'data'->>'today_gross_minor',
 cafeteria_report_read('00000000-0000-0000-0000-000000000111','sales_summary','today')->'data'->>'gross_sales_minor','Today matches the 5D.1 Ventas brutas exactly');
select is(pg_temp.hour(current_setting('t.r')::jsonb,8,'today_gross_minor'),'10000','08:15 local sale in hour 8 (refund not netted)');
select is(pg_temp.hour(current_setting('t.r')::jsonb,12,'today_gross_minor'),'10000','12:10 and 12:39 local sales in hour 12');
select is(pg_temp.hour(current_setting('t.r')::jsonb,12,'today_count'),'2','Hour 12 counts two sales');
select is(pg_temp.hour(current_setting('t.r')::jsonb,16,'today_gross_minor'),'0','UTC hour is never used as the local hour');
select is((select sum((x->>'today_gross_minor')::numeric) from jsonb_array_elements(current_setting('t.r')::jsonb->'data'->'hours') x),20000::numeric,'Hourly rows sum to today''s gross');
select is((current_setting('t.r')::jsonb->'data'->'baseline'->>'day_count')::integer,4,'Baseline day: all four sales of last Tuesday');
select is(current_setting('t.r')::jsonb->'data'->'baseline'->>'to_cutoff_gross_minor','10000','Same-time baseline: 09:30 and 12:40:00 included, 12:41 and 15:00 excluded');
select is((current_setting('t.r')::jsonb->'data'->'baseline'->>'to_cutoff_count')::integer,2,'Same-time baseline count');
select is(pg_temp.hour(current_setting('t.r')::jsonb,15,'baseline_gross_minor'),'10000','Baseline hourly shape covers the whole day');
select is(pg_temp.hour(current_setting('t.r')::jsonb,12,'baseline_count'),'2','Baseline hour 12 has both 12:40 and 12:41');
select is((select sum((x->>'baseline_gross_minor')::numeric) from jsonb_array_elements(current_setting('t.r')::jsonb->'data'->'hours') x),25000::numeric,'Yesterday''s sale is in neither day');
select is(current_setting('t.r')::jsonb->'data'->'last_sale'->>'purchased_local','2030-03-12T12:39','Last sale in local time');
select is(current_setting('t.r')::jsonb->'data'->'last_sale'->>'business_date','2030-03-12','Last sale business date');
select ok(length(current_setting('t.r')::jsonb->'data'->'last_sale'->>'register_name')>0,'Last sale carries its register name snapshot');
select ok((current_setting('t.r')::jsonb->'data'->>'first_sale_date')::date<='2030-03-05','First sale date is the oldest sale');

-- Later in the day the cutoff moves with the clock: 15:00 local includes the 15:00 baseline sale
select pg_temp.clock('2030-03-12 19:00:00+00');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.today()->'data'->'baseline'->>'to_cutoff_gross_minor','25000','Cutoff 15:00 includes every baseline sale up to 15:00');
-- 22:30 local on the 12th is already the 13th in UTC: still Tuesday's business day
select pg_temp.clock('2030-03-13 02:30:00+00');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.today()->>'today','2030-03-12','After 20:00 local the business day has not rolled over');
select is(pg_temp.today()->'data'->>'today_gross_minor','20000','Same business day, same total');
-- The next Tuesday's baseline is this Tuesday
select pg_temp.clock('2030-03-19 16:40:00+00');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.today()->'data'->'baseline'->>'to_cutoff_gross_minor','20000','A week later, all three pre-12:40 sales become the baseline (12:39:30 included)');
select is(pg_temp.today()->'data'->>'today_count','0','A week later, a new day starts empty');
select is(pg_temp.today()->'data'->'last_sale'->>'business_date','2030-03-12','Last sale may be an earlier day');

-- Scoping: cafeteria 111 sales never reach cafeteria 112
select pg_temp.clock('2030-03-12 16:40:00+00');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select is(pg_temp.today('00000000-0000-0000-0000-000000000112')->'data'->>'today_gross_minor','0','No leakage into cafeteria 112 today');
select is((pg_temp.today('00000000-0000-0000-0000-000000000112')->'data'->'baseline'->>'day_count')::integer,0,'No leakage into cafeteria 112 baseline');

select * from finish();
rollback;
