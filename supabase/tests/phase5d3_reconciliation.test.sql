-- Phase 5D.3 register reconciliation report (202610230001). Fictional local fixtures only.
-- 2003 Cafeteria Admin 111; 2004 Cafeteria Admin 112; 2011 Cafeteria Admin + POS Supervisor of 111
-- (register 9401 / assignment 9503 / membership 4603); 2008 cashier 111 (9401 via 9501, 9402 via 9502) and
-- POS Supervisor of 112 without an admin membership; 2002 School Admin; 2001 Account Admin.
-- Counts are compared as deltas and sessions by ID, so pre-existing local sessions never affect results.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.rec(period text,f date default null,t date default null,caf text default '00000000-0000-0000-0000-000000000111') returns jsonb
 language sql as $$select cafeteria_report_read(caf::uuid,'reconciliation',period,f,t)$$;
create function pg_temp.attempt(period text,f date default null,t date default null,caf text default '00000000-0000-0000-0000-000000000111',kind text default 'reconciliation') returns text
 language plpgsql as $$declare m text; begin perform cafeteria_report_read(caf::uuid,kind,period,f,t); return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.closed(r jsonb,sid text) returns jsonb language sql as $$
 select x from jsonb_array_elements(r->'data'->'closed_sessions') x where x->>'session_id'=sid$$;
create function pg_temp.live(r jsonb,sid text) returns jsonb language sql as $$
 select x from jsonb_array_elements(r->'data'->'open_sessions') x where x->>'session_id'=sid$$;
create function pg_temp.n(a jsonb,b jsonb,k text) returns integer language sql as $$
 select (a->'data'->'summary'->>k)::integer-(b->'data'->'summary'->>k)::integer$$;
create function pg_temp.cash(r jsonb) returns text language sql as $$
 select concat_ws('/',r->>'opening_minor',r->>'cash_sales_minor',r->>'cash_settlements_minor',r->>'cash_refunds_minor',r->>'expected_minor',r->>'counted_minor',r->>'difference_minor')$$;
create function pg_temp.open(register text,assignment text,opening bigint,key text) returns text language sql as $$
 select session_id::text from open_register_session(register::uuid,assignment::uuid,opening,key)$$;
create function pg_temp.sale(sid text,key text,qty integer,tender text,customer text default '00000000-0000-0000-0000-000000006901') returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',sid,
 'cafeteria_customer_id',case when tender='cash' then null else customer end,'items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',qty,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor',(5000*qty)::text,
 'tender',case tender when 'cash' then jsonb_build_object('type','cash','cash_received_minor',(5000*qty+1000)::text) else jsonb_build_object('type',tender) end))->>'purchase_id')::uuid$$;
create function pg_temp.refund(sid text,p uuid,qty integer,key text) returns jsonb language sql as $$
 select create_purchase_item_refund(sid::uuid,p,
  jsonb_build_array(jsonb_build_object('purchase_item_id',(select id from purchase_items where purchase_id=p),'quantity',qty)),'wrong_product',null,key,null)$$;
-- A back-dated fictional session closed through the frozen guard's single allowed closed transition,
-- so the close timestamp can sit on a business-date boundary. Rolled back with the test.
create function pg_temp.backdated(opened timestamptz,closed timestamptz,opening bigint,counted bigint,key text) returns text language plpgsql as $$
declare sid uuid; begin
 insert into register_sessions(account_id,school_id,school_location_id,cafeteria_id,register_id,assignment_id,operator_membership_id,
  operator_person_id,operator_role_code,register_code_snapshot,register_name_snapshot,opened_at,opened_business_date,business_timezone_snapshot,
  currency_code,opening_cash_minor,open_request_key,open_payload_fingerprint)
 select a.account_id,a.school_id,a.school_location_id,a.cafeteria_id,a.register_id,a.id,a.cafeteria_membership_id,a.operator_person_id,'pos_cashier',
  r.register_code,r.display_name,opened,(opened at time zone 'America/Santo_Domingo')::date,'America/Santo_Domingo','DOP',opening,key||'-open',repeat('a',64)
 from cafeteria_register_assignments a join cafeteria_registers r on r.id=a.register_id where a.id='00000000-0000-0000-0000-000000009502'
 returning id into sid;
 update register_sessions set status='closed',closed_at=closed,closed_by_person_id=operator_person_id,counted_cash_minor=counted,close_type='normal',
  close_request_key=key||'-close',close_payload_fingerprint=repeat('b',64),version=version+1 where id=sid;
 return sid::text; end $$;
reset role; select set_config('t.platform',(select p.auth_user_id::text from pikas_private.platform_memberships m join persons p on p.id=m.person_id
 where m.status='active' and m.role_code='platform_admin' and p.auth_user_id is not null limit 1),true);

-- Privileges (unchanged)
select ok(has_function_privilege('authenticated','cafeteria_report_read(uuid,text,text,date,date)','execute'),'Authenticated may call the report');
select ok(not has_function_privilege('anon','cafeteria_report_read(uuid,text,text,date,date)','execute')
 and not has_function_privilege('service_role','cafeteria_report_read(uuid,text,text,date,date)','execute'),'No anonymous or service report bypass');
select ok(not has_table_privilege('authenticated','pikas_private.register_close_reconciliations','select'),'Close capture stays private');

-- Authority
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.rec('today')->>'kind','reconciliation','Cafeteria Admin reads own reconciliation');
select alike(pg_temp.attempt('today',null,null,'00000000-0000-0000-0000-000000000112'),'42501:%','Cafeteria Admin of 111 cannot read cafeteria 112');
select alike(pg_temp.attempt('today',null,null,'b9496342-5079-46ae-83b8-05c39bcbd7fe'),'42501:%','Customer Cafeteria Admin cannot read a sandbox cafeteria');
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select is(pg_temp.rec('today')->>'kind','reconciliation','A POS Supervisor who also holds Cafeteria Admin reads through the admin role');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select alike(pg_temp.attempt('today'),'42501:%','Unrelated Cafeteria Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select alike(pg_temp.attempt('today'),'42501:%','School Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select alike(pg_temp.attempt('today'),'42501:%','Account Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select alike(pg_temp.attempt('today'),'42501:%','Cashier denied (blind close: no expected cash)');
select alike(pg_temp.attempt('today',null,null,'00000000-0000-0000-0000-000000000112'),'42501:%','POS Supervisor alone (no admin membership) denied (D7)');
select pg_temp.as_user(current_setting('t.platform'));
select alike(pg_temp.attempt('today'),'42501:%','Platform Admin denied');
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select platform_enter_sandbox_pov(gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe','cafeteria_admin');
select alike(pg_temp.attempt('today',null,null,'b9496342-5079-46ae-83b8-05c39bcbd7fe'),'42501:%','Sandbox Cafeteria Admin POV denied (frozen allowlist excludes session reads)');
reset role;

-- Period contract (shared with 5D.1/5D.2)
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.today',pg_temp.rec('today')->>'today',true);
select is(pg_temp.rec('last_7_days')->>'from',(current_setting('t.today')::date-6)::text,'Últimos 7 días is inclusive of today');
select is(pg_temp.rec('last_30_days')->>'from',(current_setting('t.today')::date-29)::text,'Últimos 30 días is inclusive of today');
select is(pg_temp.attempt('custom',current_setting('t.today')::date-91,current_setting('t.today')::date),'ok','92-day custom range accepted');
select is(pg_temp.attempt('custom',current_setting('t.today')::date-92,current_setting('t.today')::date),'22023:report_range_too_long','93-day range rejected');
select is(pg_temp.attempt('custom',current_setting('t.today')::date,current_setting('t.today')::date-1),'22023:invalid_report_range','Reversed range rejected');
select is(pg_temp.attempt('custom',current_setting('t.today')::date,current_setting('t.today')::date+1),'22023:invalid_report_range','Future end rejected');
select is(pg_temp.attempt('today',current_setting('t.today')::date,null),'22023:invalid_report_period','Preset with explicit dates rejected');
select is(pg_temp.attempt('today',null,null,'00000000-0000-0000-0000-000000000111','register_cash'),'22023:invalid_report_kind','Unknown kind rejected');
select set_config('t.base',pg_temp.rec('today')::text,true);
select set_config('t.base7',pg_temp.rec('last_7_days')::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select set_config('t.base112',pg_temp.rec('today',null,null,'00000000-0000-0000-0000-000000000112')::text,true);

-- Staff receivable for a cash collection (as Phase 5A).
reset role;
insert into staff_campus_affiliations(account_id,school_id,staff_affiliation_id,school_location_id)
values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006501','00000000-0000-0000-0000-000000000211')
on conflict do nothing;
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select set_config('t.receivable',configure_staff_receivable_account('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000006501',0,false,null,'5d3-staff-create-0001')->>'account_id',true);
select configure_staff_receivable_account('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000006501',1,true,'100000','5d3-staff-enable-0001');

-- Session A (register 9401): opening 100.00; cash 2× = 100.00; PIKAS Cash 50.00; staff credit 50.00;
-- cash collection 5.00; cash refund of 1 unit (50.00). Recarga and wallet adjustment during the session.
-- Expected = 10000 + 10000 + 500 − 5000 = 15500. Counted 15000 → Faltante −500.
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.a',pg_temp.open('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009503',10000,'5d3-open-session-a-01'),true);
-- Fund the student wallet inside session A before its PIKAS Cash sale; the test must not rely on a
-- balance left by other local runs (a freshly reset wallet starts at zero).
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',100000,'5d300000-0000-4000-8000-000000000001','Fondos locales 5D.3','Verificado');
select school_wallet_adjust('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',2500,'administrative_correction','Ajuste ficticio 5D.3','5d300000-0000-4000-8000-000000000002');
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.a_cash',pg_temp.sale(current_setting('t.a'),'5d3-sale-a-cash-0001',2,'cash')::text,true);
select pg_temp.sale(current_setting('t.a'),'5d3-sale-a-wallet-001',1,'student_wallet');
select pg_temp.sale(current_setting('t.a'),'5d3-sale-a-staff-0001',1,'staff_credit','00000000-0000-0000-0000-000000006902');
select settle_staff_receivable(current_setting('t.receivable')::uuid,'500','cash','00000000-0000-0000-0000-000000000111',
 '00000000-0000-0000-0000-000000004603',current_setting('t.a')::uuid,'Cobro ficticio 5D.3',null,'5d3-staff-collection-01');
select pg_temp.refund(current_setting('t.a'),current_setting('t.a_cash')::uuid,1,'5d3-refund-a-cash-01');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.live(pg_temp.rec('today'),current_setting('t.a'))->>'expected_minor','15500','Open session A: live 5A expected (PIKAS Cash, staff credit, recarga, adjustment excluded)');
select ok(pg_temp.closed(pg_temp.rec('today'),current_setting('t.a')) is null,'Open session A is not a closed-session record');
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select close_my_register_session(current_setting('t.a')::uuid,1,15000,'5d3-close-session-a-01');

-- Session B (register 9402, cashier): opening 200.00; cash 50.00; counted 250.00 → Cuadrada.
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.b',pg_temp.open('00000000-0000-0000-0000-000000009402','00000000-0000-0000-0000-000000009502',20000,'5d3-open-session-b-01'),true);
select pg_temp.sale(current_setting('t.b'),'5d3-sale-b-cash-0001',1,'cash');
select close_my_register_session(current_setting('t.b')::uuid,1,25000,'5d3-close-session-b-01');

-- Session C (register 9401): opening 100.00; refunds A's remaining cash unit (50.00) — a later
-- session pays the outflow. Expected 5000, counted 5500 → Sobrante +500 (opposes A's −500).
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.c',pg_temp.open('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009503',10000,'5d3-open-session-c-01'),true);
select pg_temp.refund(current_setting('t.c'),current_setting('t.a_cash')::uuid,1,'5d3-refund-c-cash-01');
select close_my_register_session(current_setting('t.c')::uuid,1,5500,'5d3-close-session-c-01');

-- Business-date boundary: closed 23:30 local (UTC−4) five days ago = 03:30 UTC the next day.
reset role;
select set_config('t.e',pg_temp.backdated(((current_setting('t.today')::date-5)::text||' 21:00 America/Santo_Domingo')::timestamptz,
 ((current_setting('t.today')::date-5)::text||' 23:30 America/Santo_Domingo')::timestamptz,1000,1000,'5d3-backdated-boundary'),true);
-- A close without a Phase 5A capture (pre-5A history): the capture trigger is bypassed for this fixture only.
alter table register_sessions disable trigger register_close_reconciliation_capture;
select set_config('t.f',pg_temp.backdated(((current_setting('t.today')::date-6)::text||' 08:00 America/Santo_Domingo')::timestamptz,
 ((current_setting('t.today')::date-6)::text||' 15:00 America/Santo_Domingo')::timestamptz,1000,1200,'5d3-backdated-precapture'),true);
alter table register_sessions enable trigger register_close_reconciliation_capture;
-- Session D (register 9401, cashier) stays open: opening 30.00; cash 50.00 → live expected 8000.
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.d',pg_temp.open('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',3000,'5d3-open-session-d-01'),true);
select pg_temp.sale(current_setting('t.d'),'5d3-sale-d-cash-0001',1,'cash');

select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.r',pg_temp.rec('today')::text,true);
-- Closed session basics: every value is the frozen capture.
select is(pg_temp.cash(pg_temp.closed(current_setting('t.r')::jsonb,current_setting('t.a'))),'10000/10000/500/5000/15500/15000/-500',
 'A: opening, cash sales, cash collection, cash refund, expected, counted, difference');
select is(pg_temp.closed(current_setting('t.r')::jsonb,current_setting('t.a'))->>'status','shortage','Negative difference → Faltante');
select is(pg_temp.cash(pg_temp.closed(current_setting('t.r')::jsonb,current_setting('t.b'))),'20000/5000/0/0/25000/25000/0','B: exact balance');
select is(pg_temp.closed(current_setting('t.r')::jsonb,current_setting('t.b'))->>'status','balanced','Zero difference → Cuadrada');
select is(pg_temp.cash(pg_temp.closed(current_setting('t.r')::jsonb,current_setting('t.c'))),'10000/0/0/5000/5000/5500/500','C: refund paid from the later session reduces C');
select is(pg_temp.closed(current_setting('t.r')::jsonb,current_setting('t.c'))->>'status','overage','Positive difference → Sobrante');
select is((select bool_and((x->>'counted_minor')::numeric-(x->>'expected_minor')::numeric=(x->>'difference_minor')::numeric)
 from jsonb_array_elements(current_setting('t.r')::jsonb->'data'->'closed_sessions') x where x->>'captured'='true'),true,'Sign convention: difference = counted − expected on every captured row');
select is(pg_temp.closed(current_setting('t.r')::jsonb,current_setting('t.a'))->>'closed_by_name','Synthetic multi-cafeteria person','Close actor from the durable Person');
select is(pg_temp.closed(current_setting('t.r')::jsonb,current_setting('t.b'))->>'operator_name','Synthetic person 8','Operator (cashier) from the durable Person');
select is(pg_temp.closed(current_setting('t.r')::jsonb,current_setting('t.b'))->>'close_type','normal','Close type is reported');
select is(pg_temp.closed(current_setting('t.r')::jsonb,current_setting('t.a'))->>'closed_business_date',current_setting('t.today'),'Closed today in the business timezone');
reset role;
select is((select string_agg(concat_ws('/',r.summary->>'opening_minor',r.summary->>'cash_sales_minor',r.summary->>'cash_settlements_minor',
  r.summary->>'cash_refunds_minor',r.summary->>'expected_minor',s.counted_cash_minor,r.difference_minor),',' order by s.closed_at)
 from pikas_private.register_close_reconciliations r join register_sessions s on s.id=r.session_id
 where s.id in (current_setting('t.a')::uuid,current_setting('t.b')::uuid,current_setting('t.c')::uuid)),
 (select string_agg(pg_temp.cash(x),',' order by x->>'closed_at') from jsonb_array_elements(current_setting('t.r')::jsonb->'data'->'closed_sessions') x
  where x->>'session_id' in (current_setting('t.a'),current_setting('t.b'),current_setting('t.c'))),
 'Report rows equal the immutable Phase 5A close captures exactly');

-- Period summary: counts only; opposing −500/+500 never net to a misleading zero.
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.n(current_setting('t.r')::jsonb,current_setting('t.base')::jsonb,'closed_count'),3,'Sesiones cerradas +3');
select is(pg_temp.n(current_setting('t.r')::jsonb,current_setting('t.base')::jsonb,'balanced_count'),1,'Cuadradas +1');
select is(pg_temp.n(current_setting('t.r')::jsonb,current_setting('t.base')::jsonb,'shortage_count'),1,'Con faltante +1');
select is(pg_temp.n(current_setting('t.r')::jsonb,current_setting('t.base')::jsonb,'overage_count'),1,'Con sobrante +1');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('t.r')::jsonb->'data'->'summary') k),
 array['balanced_count','closed_count','overage_count','shortage_count','uncaptured_count'],'Summary has counts only: no net discrepancy total');
select is((current_setting('t.r')::jsonb->'data'->'summary'->>'closed_count')::integer,
 (select (s->>'balanced_count')::integer+(s->>'shortage_count')::integer+(s->>'overage_count')::integer+(s->>'uncaptured_count')::integer
  from (select current_setting('t.r')::jsonb->'data'->'summary' s) x),'Sesiones cerradas = Cuadradas + Con faltante + Con sobrante + Sin captura');
select is((select string_agg(x->>'session_id',',' order by o) from jsonb_array_elements(current_setting('t.r')::jsonb->'data'->'closed_sessions') with ordinality e(x,o)
  where x->>'session_id' in (current_setting('t.a'),current_setting('t.b'),current_setting('t.c'))),
 concat_ws(',',current_setting('t.c'),current_setting('t.b'),current_setting('t.a')),'Closed sessions newest close first');

-- Open sessions: current state, separate from period records; nothing fabricated.
select is(pg_temp.cash(pg_temp.live(current_setting('t.r')::jsonb,current_setting('t.d'))),'3000/5000/0/0/8000','Open D: live 5A summary only');
select ok(not (pg_temp.live(current_setting('t.r')::jsonb,current_setting('t.d')) ?| array['counted_minor','difference_minor','status','captured']),'Open D: no counted cash, difference or status');
select ok(pg_temp.closed(current_setting('t.r')::jsonb,current_setting('t.d')) is null,'Open D is not counted as closed');
select is(pg_temp.live(pg_temp.rec('custom',current_setting('t.today')::date-40,current_setting('t.today')::date-35),current_setting('t.d'))->>'expected_minor','8000',
 'Open sessions are current state, shown regardless of the selected historical period');
select is(pg_temp.rec('custom',current_setting('t.today')::date-40,current_setting('t.today')::date-35)->'data'->'summary'->>'closed_count','0','Historical period without closes: zero, not failure');

-- Periods (E closed 5 days ago at 23:30 local, F 6 days ago; both created above)
select is(pg_temp.n(pg_temp.rec('last_7_days'),current_setting('t.base7')::jsonb,'closed_count'),5,'Últimos 7 días: today''s 3 closes plus the two back-dated ones');
select ok(pg_temp.closed(pg_temp.rec('last_30_days'),current_setting('t.a')) is not null,'Últimos 30 días includes today''s closes');
select ok(pg_temp.closed(pg_temp.rec('custom',current_setting('t.today')::date-1,current_setting('t.today')::date-1),current_setting('t.a')) is null,'A custom day before the close excludes it');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.closed(pg_temp.rec('custom',current_setting('t.today')::date-5,current_setting('t.today')::date-5),current_setting('t.e'))->>'closed_local',
 to_char(current_setting('t.today')::date-5,'YYYY-MM-DD')||'T23:30','Late close belongs to its local business date');
select ok(pg_temp.closed(pg_temp.rec('custom',current_setting('t.today')::date-4,current_setting('t.today')::date-4),current_setting('t.e')) is null,'Late close is not on its UTC date');
select is(pg_temp.closed(pg_temp.rec('last_7_days'),current_setting('t.e'))->>'status','balanced','Últimos 7 días includes a close 5 days ago');
select ok(pg_temp.closed(pg_temp.rec('custom',current_setting('t.today')::date-91,current_setting('t.today')::date),current_setting('t.e')) is not null,'92-day custom range includes it');
select set_config('t.pre',pg_temp.closed(pg_temp.rec('custom',current_setting('t.today')::date-6,current_setting('t.today')::date-6),current_setting('t.f'))::text,true);
select is(current_setting('t.pre')::jsonb->>'status','uncaptured','Pre-5A close is labeled without capture');
select is(pg_temp.cash(current_setting('t.pre')::jsonb),'1200','Pre-5A close: only counted cash; expected and difference never derived');
select is(pg_temp.rec('custom',current_setting('t.today')::date-6,current_setting('t.today')::date-6)->'data'->'summary'->>'uncaptured_count','1','Pre-5A close counted apart from Cuadrada/Faltante/Sobrante');
select is(pg_temp.rec('custom',current_setting('t.today')::date-6,current_setting('t.today')::date-6)->'data'->'summary'->>'balanced_count','0','Pre-5A close is never Cuadrada');

-- Historical close not rewritten by later activity (C's refund of A's sale, later sales and D).
select is(pg_temp.cash(pg_temp.closed(pg_temp.rec('today'),current_setting('t.a'))),'10000/10000/500/5000/15500/15000/-500','A unchanged after later refunds and sales');

-- Cross-cafeteria isolation
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select set_config('t.r112',pg_temp.rec('today',null,null,'00000000-0000-0000-0000-000000000112')::text,true);
select is(current_setting('t.r112')::jsonb->'data'->'summary',current_setting('t.base112')::jsonb->'data'->'summary','Cafeteria 111 closes never reach cafeteria 112 counts');
select ok(not exists(select 1 from jsonb_array_elements((current_setting('t.r112')::jsonb->'data'->'closed_sessions')||(current_setting('t.r112')::jsonb->'data'->'open_sessions')) x
 where x->>'session_id' in (current_setting('t.a'),current_setting('t.b'),current_setting('t.c'),current_setting('t.d'))),'Cafeteria 111 sessions never listed for 112');

-- Regression through the replaced shared function: 5D.1/5D.2 kinds and their authority.
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(cafeteria_report_read('00000000-0000-0000-0000-000000000111','sales_summary','today')->>'kind','sales_summary','sales_summary still served');
select ok((cafeteria_report_read('00000000-0000-0000-0000-000000000111','sales_summary','today')->'data'->>'gross_sales_minor')::numeric>=30000,'sales_summary still counts today''s sales (all tenders)');
select is(cafeteria_report_read('00000000-0000-0000-0000-000000000111','top_products','today')->>'kind','top_products','top_products still served');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select alike(pg_temp.attempt('today',null,null,'00000000-0000-0000-0000-000000000111','sales_summary'),'42501:%','Cashier still denied sales_summary');
select alike(pg_temp.attempt('today',null,null,'00000000-0000-0000-0000-000000000112','top_products'),'42501:%','POS Supervisor still denied top_products');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select alike(pg_temp.attempt('today',null,null,'00000000-0000-0000-0000-000000000111','sales_summary'),'42501:%','School Admin still denied sales_summary');

reset role;
select * from finish();
rollback;
