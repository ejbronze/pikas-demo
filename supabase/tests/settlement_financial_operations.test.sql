-- PIKAS Settlement & Financial Operations (202611200001). Fictional local fixtures only; everything rolls back.
-- Foundation fixtures: account 1 / school 11 / Cafetería 111 (admin 2003) and 112 (admin 2004) / student 5201 (wallet 7001,
-- customer 6901) / product 8101 at RD$ 50 / register 9401 (cashier 2008, assignment 9501) / supervisor 2011 / School Admin 2002.
-- Activity is posted with the real clock (this week); finalization is driven through the internal function with a later
-- "now" so ended weeks can be settled. The public wrappers call the same function with clock_timestamp().
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; s text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text, s=returned_sqlstate; return s||':'||m; end$$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.as_operator(u text) returns void language plpgsql as $$declare sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;
create function pg_temp.sale(key text,qty integer) returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',current_setting('t.sid'),
 'cafeteria_customer_id','00000000-0000-0000-0000-000000006901','items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',qty,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor',(5000*qty)::text,
 'tender',jsonb_build_object('type','student_wallet')))->>'purchase_id')::uuid$$;
create function pg_temp.items(p uuid,qty integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('purchase_item_id',(select id from purchase_items where purchase_id=p),'quantity',qty))$$;
create function pg_temp.refund(p uuid,qty integer,key text) returns void language plpgsql as $$declare appr uuid; begin
 perform pg_temp.as_user('00000000-0000-0000-0000-000000002011');
 appr:=(issue_purchase_item_refund_approval(current_setting('t.sid')::uuid,p,pg_temp.items(p,qty),'wrong_product',null,key||'-appr')->>'approval_id')::uuid;
 perform pg_temp.as_user('00000000-0000-0000-0000-000000002008');
 perform create_purchase_item_refund(current_setting('t.sid')::uuid,p,pg_temp.items(p,qty),'wrong_product',null,key,appr);
 execute 'reset role'; end$$;
-- Finance operator F1 (read + settlement:manage) acting with an injected clock.
create function pg_temp.fin(sql text) returns jsonb language plpgsql as $$declare r jsonb; begin
 perform pg_temp.as_operator('00000000-0000-0000-0000-0000000f5d01'); execute 'reset role'; execute sql into r; return r; end$$;
create function pg_temp.settlements() returns bigint language sql security definer as $$select count(*) from public.settlements where cafeteria_id='00000000-0000-0000-0000-000000000111'$$;
create function pg_temp.money() returns text language sql security definer as $$ select concat_ws('|',
 (select count(*) from public.financial_entries),(select count(*) from public.financial_obligations),(select sum(current_balance_minor) from public.student_wallets),
 (select count(*) from public.wallet_ledger_entries),(select count(*) from public.purchases),(select count(*) from public.refunds),(select count(*) from public.replenishment_requests)) $$;
grant execute on all functions in schema pg_temp to authenticated;

-- Fictional finance operators: F1 read + settlement manage; F2 read only. Local roles, removed by rollback.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-0000000f5d01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','settle.test.f1@example.invalid','',now(),now(),now(),'{}','{}'),
       ('00000000-0000-0000-0000-0000000f5d02','00000000-0000-0000-0000-000000000000','authenticated','authenticated','settle.test.f2@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-0000000f5e01','00000000-0000-0000-0000-0000000f5d01','Liquidaciones ficticia'),
 ('00000000-0000-0000-0000-0000000f5e02','00000000-0000-0000-0000-0000000f5d02','Lectura financiera ficticia');
insert into pikas_private.platform_roles(role_code) values('settle_test_manage'),('settle_test_read');
insert into pikas_private.platform_role_capabilities(role_code,capability) values('settle_test_manage','platform:finance:read'),('settle_test_manage','platform:finance:settlement:manage'),
 ('settle_test_read','platform:finance:read');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-0000000f5e01','settle_test_manage'),('00000000-0000-0000-0000-0000000f5e02','settle_test_read');

-- ── Shape, grants and ACLs ─────────────────────────────────────────────────────────────────────
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('public.settlements'::regclass,'public.settlement_lines'::regclass,'public.settlement_events'::regclass)),
 'Settlement tables: forced RLS');
select is((select count(*) from information_schema.role_table_grants where table_schema='public' and table_name in ('settlements','settlement_lines','settlement_events')
 and grantee in ('PUBLIC','anon','authenticated','service_role')),0::bigint,'No table privilege for client roles (reads go through checked functions)');
select is((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'platform_finance_settlement%' or p.proname like 'cafeteria_settlement%')
 and (p.proacl is null or exists(select 1 from aclexplode(p.proacl) a where a.grantee in (0,'anon'::regrole::oid,'service_role'::regrole::oid)) or not has_function_privilege('authenticated',p.oid,'execute'))),0::bigint,
 'Public settlement RPCs: authenticated only; no PUBLIC, anon or service_role');
select is((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'platform_finance_settlement%' or p.proname like 'cafeteria_settlement%')),9::bigint,'Nine public settlement RPCs');
select is((select count(*) from pg_proc p where p.pronamespace='pikas_private'::regnamespace and (p.proname like 'settlement%' or p.proname in ('guard_settlement_update','guard_settlement_line','require_cafeteria_settlement_read'))
 and (p.proacl is null or exists(select 1 from aclexplode(p.proacl) a where a.grantee<>p.proowner))),0::bigint,'Private settlement helpers: no PUBLIC, anon, authenticated or service_role EXECUTE');
select ok((select bool_and(prosecdef and proconfig=array['search_path=""']) from pg_proc p where p.pronamespace='public'::regnamespace
 and (p.proname like 'platform_finance_settlement%' or p.proname like 'cafeteria_settlement%')),'Public settlement RPCs: SECURITY DEFINER with an empty search path');
select ok((select bool_and(prosrc like '%sandbox_pov_current_attempt%') from pg_proc where proname like 'platform_finance_settlement%'),'Every Platform settlement RPC refuses an active sandbox POV');
select is((select count(*) from pikas_private.platform_role_capabilities where capability='platform:finance:settlement:manage' and role_code not like 'settle_test_%'),0::bigint,
 'platform:finance:settlement:manage is granted to no real Platform role (not Platform Admin)');
select is((select array_agg(scope_kind||':'||role_code) from pikas_private.role_capabilities where capability='cafeteria:finance:obligations:read'),array['cafeteria:cafeteria_admin'],
 'Cafetería settlement read: Cafetería Admin only (not School, POS or Account)');
select is((select count(*) from pikas_private.role_capabilities where capability like '%settlement%'),0::bigint,'No tenant role can manage settlement');

-- ── Calendar: Monday 00:00 → Sunday 23:59:59 America/Santo_Domingo, due the following Tuesday ──
select is(pikas_private.settlement_week_start('2026-10-25 23:59:59-04'),'2026-10-19'::date,'Sunday 23:59:59 local belongs to the week of Monday Oct 19');
select is(pikas_private.settlement_week_start('2026-10-26 00:00:00-04'),'2026-10-26'::date,'Monday 00:00:00 local starts the next week');
select is(pikas_private.settlement_week_start('2026-10-26 03:59:59+00'),'2026-10-19'::date,'UTC Monday 03:59:59 is still Sunday in Santo Domingo');
select is(pikas_private.settlement_week_start('2026-10-26 04:00:00+00'),'2026-10-26'::date,'UTC Monday 04:00:00 is Monday 00:00 in Santo Domingo');
select is(pikas_private.settlement_period_start('2026-10-19'),'2026-10-19 04:00:00+00'::timestamptz,'Period starts Monday 00:00 local (04:00 UTC)');
select is(pikas_private.settlement_period_end('2026-10-19'),'2026-10-26 04:00:00+00'::timestamptz,'Period ends at the next Monday 00:00 local (exclusive)');
select is(('2026-10-19'::date + 8),'2026-10-27'::date,'Due date: the Tuesday after the closed week');
select is((select count(*) from (select ('2026-01-05'::date + 7*g) w from generate_series(0,52) g) x
  where pikas_private.settlement_period_end(x.w)-pikas_private.settlement_period_start(x.w)<>interval '7 days'
     or to_char(pikas_private.settlement_period_start(x.w) at time zone 'UTC','HH24:MI')<>'04:00'),0::bigint,
 'Every 2026 week is exactly 7 days and starts 04:00 UTC: no DST in the named zone, including US/EU DST weeks');

-- ── Activation off and sandbox: refused ────────────────────────────────────────────────────────
select set_config('t.w',pikas_private.settlement_week_start(clock_timestamp())::text,true);
select set_config('t.m0',pg_temp.money(),true);
select is(pg_temp.attempt($$select pg_temp.fin('select pikas_private.settlement_finalize(''00000000-0000-0000-0000-000000000111'','''||current_setting('t.w')||''',''00000000-0000-0000-0000-0000000f5e01'',''settle-test-key-inactive-1'',clock_timestamp()+interval ''8 days'')')$$),
 '23514:NOTHING_TO_SETTLE','Never activated: no obligation exists, so there is nothing to settle (settlement follows obligations, not current activation)');
select is(pg_temp.attempt($$select pg_temp.fin('select pikas_private.settlement_finalize((select id from cafeterias where account_id=''03e71159-69e9-4387-9b3b-65799d49faf0'' limit 1),'''||current_setting('t.w')||''',''00000000-0000-0000-0000-0000000f5e01'',''settle-test-key-sandbox-1'',clock_timestamp()+interval ''8 days'')')$$),
 '42501:SETTLEMENT_SANDBOX_REFUSED','Sandbox (Colegio Horizonte): settlement refused');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((cafeteria_settlements_read('00000000-0000-0000-0000-000000000111')->>'enabled')::boolean,false,'Activation off: the Cafetería read says settlement is not enabled');
reset role; select is(pg_temp.money(),current_setting('t.m0'),'Refusals write nothing');

select ok((pikas_private.finance_activate_customer('00000000-0000-0000-0000-000000000001',1,'Piloto ficticio liquidaciones','settle-activation-key-01')->>'activation_id') is not null,
 'Fictional account 1 activated (backend only)');

-- ── Period W activity: cash RD$ 2,000 (owed to clearing), wallet sales RD$ 750 + RD$ 100, a same-period refund RD$ 50 ──
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok((cafeteria_wallet_collect_cash('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201',200000,null,'5e000000-0000-4000-8000-000000000001')->>'reference') is not null,'Cash RD$ 2,000 collected');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',0,'settle-open-cashier-1')),true);
select set_config('t.pa',pg_temp.sale('settle-sale-key-a0001',15)::text,true);
select set_config('t.pb',pg_temp.sale('settle-sale-key-b0001',2)::text,true);
reset role; select pg_temp.refund(current_setting('t.pb')::uuid,1,'settle-refund-b-0001');
select is((select string_agg(reason||':'||amount_minor,',' order by reason,amount_minor) from financial_obligations where cafeteria_id='00000000-0000-0000-0000-000000000111'),
 'cash_collection:200000,wallet_purchase_fulfillment:10000,wallet_purchase_fulfillment:75000,wallet_refund_correction:5000',
 'FIN 2 obligations already exist: gross cash, one payable per wallet sale (wallet amount), refund correction');
select is((select count(distinct settlement_week_start) from financial_obligations where cafeteria_id='00000000-0000-0000-0000-000000000111'),1::bigint,'All in the current week');

-- Live view before the week ends: Cafetería sees the open week; Platform has nothing ready; finalization refused.
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((select concat_ws('/',x->'current'->>'cafeteria_owes_minor',x->'current'->>'clearing_owes_minor',x->'current'->>'line_count',jsonb_array_length(x->'pending'),jsonb_array_length(x->'settlements'))
 from (select cafeteria_settlements_read('00000000-0000-0000-0000-000000000111') x) y),'205000/85000/4/0/0','Open week (live): owes 205000, owed 85000, 4 items; nothing pending or settled');
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f5d01');
select is(jsonb_array_length(platform_finance_settlements_read('action',null)->'ready'),0,'Platform: no ready period while the week is open');
select is(pg_temp.attempt($$select platform_finance_settlement_finalize('00000000-0000-0000-0000-000000000111','$$||current_setting('t.w')||$$','settle-test-key-early-01')$$),'23514:PERIOD_NOT_ENDED',
 'Finalizing the open week is refused');
select is(pg_temp.attempt($$select platform_finance_settlement_finalize('00000000-0000-0000-0000-000000000111','$$||(current_setting('t.w')::date+1)||$$','settle-test-key-tuesday1')$$),'22023:INVALID_SETTLEMENT_WEEK',
 'A week must start on Monday');
reset role;

-- Wrong authority.
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f5d02');
select is(pg_temp.attempt($$select platform_finance_settlement_run('settle-test-key-readonly1')$$),'42501:not_authorized','Finance read only: cannot run settlement');
select ok((platform_finance_settlements_read('history',null)->>'view')='history','Finance read only: can read settlements');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select platform_finance_settlement_run('settle-test-key-cafadmin1')$$),'42501:not_authorized','Cafetería Admin: cannot run settlement');
select is(pg_temp.attempt($$select platform_finance_settlements_read('action',null)$$),'42501:not_authorized','Cafetería Admin: cannot read Platform settlements');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt($$select platform_finance_settlement_finalize('00000000-0000-0000-0000-000000000111','$$||current_setting('t.w')||$$','settle-test-key-school01')$$),'42501:not_authorized','School Admin: cannot finalize');
select is(pg_temp.attempt($$select cafeteria_settlements_read('00000000-0000-0000-0000-000000000111')$$) like '42501:%',true,'School Admin: no Cafetería settlement read');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select is(pg_temp.attempt($$select cafeteria_settlements_read('00000000-0000-0000-0000-000000000111')$$) like '42501:%',true,'POS cashier: no settlement read');
reset role;

-- ── Finalize W (week ended): Cafetería owes 205000, PIKAS owes 85000 → Cafetería sends 120000 ──
select set_config('t.f1',pg_temp.fin($$select pikas_private.settlement_finalize('00000000-0000-0000-0000-000000000111','$$||current_setting('t.w')||$$','00000000-0000-0000-0000-0000000f5e01','settle-test-key-final-01',clock_timestamp()+interval '8 days')$$)::text,true);
select is((select concat_ws('/',x->>'status',x->>'cafeteria_owes_minor',x->>'clearing_owes_minor',x->>'net_direction',x->>'net_amount_minor',x->>'line_count',x->>'late_line_count',x->>'replayed')
 from (select current_setting('t.f1')::jsonb x) y),'due/205000/85000/cafeteria_to_clearing/120000/4/0/false','Finalized: gross both ways preserved, net Cafetería → PIKAS 120000, due');
select is((current_setting('t.f1')::jsonb->>'due_on')::date,current_setting('t.w')::date+8,'Due the following Tuesday');
select ok((current_setting('t.f1')::jsonb->>'reference') ~ '^LIQ-[0-9]{8}$','Authoritative LIQ- reference');
select set_config('t.ref1',current_setting('t.f1')::jsonb->>'reference',true);
select is((select count(*) from settlement_lines l join settlements s on s.id=l.settlement_id where s.reference=current_setting('t.ref1')),4::bigint,'Four lines: each obligation exactly once');
select is((select count(*) from financial_obligations o where o.cafeteria_id='00000000-0000-0000-0000-000000000111' and not exists(select 1 from settlement_lines l where l.obligation_id=o.id)),0::bigint,
 'No obligation of the week is left out');
select is((select sum(amount_minor) filter (where direction='cafeteria_to_clearing')||'/'||sum(amount_minor) filter (where direction='clearing_to_cafeteria') from settlement_lines l join settlements s on s.id=l.settlement_id
 where s.reference=current_setting('t.ref1')),'205000/85000','Lines add up to the snapshot (no fee recalculated: cash obligation is gross 200000)');
-- Idempotent: the same period again (another key, another run) returns the same settlement.
select is((pg_temp.fin($$select pikas_private.settlement_finalize('00000000-0000-0000-0000-000000000111','$$||current_setting('t.w')||$$','00000000-0000-0000-0000-0000000f5e01','settle-test-key-final-02',clock_timestamp()+interval '8 days')$$)
 ->>'reference'),current_setting('t.ref1'),'Repeat finalization replays the same settlement');
select is((pg_temp.fin($$select pikas_private.settlement_run('00000000-0000-0000-0000-0000000f5e01','settle-test-key-run-0001',clock_timestamp()+interval '8 days')$$)->>'count')::int,0,
 'Run after finalization: nothing left to finalize');
select is(pg_temp.settlements(),1::bigint,'Still one settlement for the period');
select ok(exists(select 1 from audit_events where action='settlement_finalized' and actor_person_id='00000000-0000-0000-0000-0000000f5e01' and actor_role='platform_finance_operator'
 and after_metadata->>'reference'=current_setting('t.ref1') and after_metadata->>'net_direction'='cafeteria_to_clearing' and after_metadata->>'net_amount_minor'='120000' and after_metadata->>'to_status'='due'),
 'Finalization audited: actor, settlement, new status, direction and amount');

-- Immutable snapshot.
select is(pg_temp.attempt($$update settlements set cafeteria_owes_minor=1 where reference='$$||current_setting('t.ref1')||$$'$$),'23514:wallet_financial_history_is_immutable','Snapshot totals cannot be edited');
select is(pg_temp.attempt($$delete from settlement_lines where settlement_id=(select id from settlements where reference='$$||current_setting('t.ref1')||$$')$$),'23514:wallet_financial_history_is_immutable','Lines cannot be removed');
select is(pg_temp.attempt($$delete from settlements where reference='$$||current_setting('t.ref1')||$$'$$),'23514:wallet_financial_history_is_immutable','A settlement cannot be deleted');
select is(pg_temp.attempt($$insert into settlement_lines(settlement_id,account_id,cafeteria_id,obligation_id,reason,direction,amount_minor,obligation_week_start,late)
 select l.settlement_id,l.account_id,l.cafeteria_id,l.obligation_id,l.reason,l.direction,l.amount_minor,l.obligation_week_start,l.late from settlement_lines l limit 1$$) like '23505:%',true,
 'An obligation can never be attached twice');

-- ── Late activity: a refund of the closed week's sale goes to a later settlement, never into the finalized one ──
select pg_temp.refund(current_setting('t.pa')::uuid,4,'settle-refund-a-0001');
select is((select cafeteria_owes_minor||'/'||clearing_owes_minor||'/'||line_count from settlements where reference=current_setting('t.ref1')),'205000/85000/4','Finalized settlement unchanged by the later refund');
select is((pg_temp.fin($$select pikas_private.settlement_run('00000000-0000-0000-0000-0000000f5e01','settle-test-key-run-0002',clock_timestamp()+interval '8 days')$$)->>'count')::int,0,
 'While its own week is settled and no later week has ended, the refund waits in the open period');
select set_config('t.r2',pg_temp.fin($$select pikas_private.settlement_run('00000000-0000-0000-0000-0000000f5e01','settle-test-key-run-0003',clock_timestamp()+interval '15 days')$$)::text,true);
select is((select concat_ws('/',x->>'week_start',x->>'cafeteria_owes_minor',x->>'clearing_owes_minor',x->>'net_direction',x->>'net_amount_minor',x->>'late_line_count')
 from (select current_setting('t.r2')::jsonb->'finalized'->0 x) y),(current_setting('t.w')::date+7)||'/20000/0/cafeteria_to_clearing/20000/1',
 'Next ended week carries the late refund (RD$ 200, marked late)');
select set_config('t.ref2',current_setting('t.r2')::jsonb->'finalized'->0->>'reference',true);
select is((select l.late::text||':'||l.obligation_week_start from settlement_lines l join settlements s on s.id=l.settlement_id where s.reference=current_setting('t.ref2')),
 'true:'||current_setting('t.w'),'The late line keeps its original week');

-- ── Net zero: cash RD$ 100 and wallet sales RD$ 100 → settles at finalization without a payment ──
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok((cafeteria_wallet_collect_cash('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201',10000,null,'5e000000-0000-4000-8000-000000000002')->>'reference') is not null,'Cash RD$ 100');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008'); select pg_temp.sale('settle-sale-key-zero01',2); reset role;
select set_config('t.r3',pg_temp.fin($$select pikas_private.settlement_run('00000000-0000-0000-0000-0000000f5e01','settle-test-key-run-0004',clock_timestamp()+interval '22 days')$$)::text,true);
select is((select concat_ws('/',x->>'status',x->>'cafeteria_owes_minor',x->>'clearing_owes_minor',x->>'net_direction',x->>'net_amount_minor')
 from (select current_setting('t.r3')::jsonb->'finalized'->0 x) y),'settled/10000/10000/none/0','Net zero: RD$ 0, settled at finalization, no payment');
select is((select count(*) from settlement_events e join settlements s on s.id=e.settlement_id where s.reference=current_setting('t.r3')::jsonb->'finalized'->0->>'reference' and e.kind like 'payment%'),0::bigint,
 'No fake payment recorded');

-- ── PIKAS owes: wallet sales RD$ 200 only → clearing → Cafetería 20000 ──
select pg_temp.as_user('00000000-0000-0000-0000-000000002008'); select pg_temp.sale('settle-sale-key-pikas1',4); reset role;
select set_config('t.r4',pg_temp.fin($$select pikas_private.settlement_run('00000000-0000-0000-0000-0000000f5e01','settle-test-key-run-0005',clock_timestamp()+interval '29 days')$$)::text,true);
select is((select concat_ws('/',x->>'status',x->>'cafeteria_owes_minor',x->>'clearing_owes_minor',x->>'net_direction',x->>'net_amount_minor')
 from (select current_setting('t.r4')::jsonb->'finalized'->0 x) y),'due/0/20000/clearing_to_cafeteria/20000','PIKAS owes the Cafetería RD$ 200');
select set_config('t.ref4',current_setting('t.r4')::jsonb->'finalized'->0->>'reference',true);
select is(pg_temp.settlements(),4::bigint,'Four settlements, one per week with activity');
select is((select count(*) from financial_obligations o where o.cafeteria_id='00000000-0000-0000-0000-000000000111' and not exists(select 1 from settlement_lines l where l.obligation_id=o.id)),0::bigint,
 'Every obligation is in exactly one settlement');
select is((select count(*) from settlement_lines)::bigint,(select count(*) from financial_obligations where cafeteria_id='00000000-0000-0000-0000-000000000111'),'Lines = obligations (none twice)');

-- ── Payment confirmation ───────────────────────────────────────────────────────────────────────
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f5d01');
select is(pg_temp.attempt($$select platform_finance_settlement_confirm_payment('$$||current_setting('t.ref1')||$$',120000,'TX',current_date,null,'settle-pay-key-0000001')$$),'22023:INVALID_PAYMENT_REFERENCE','Payment reference required (3+)');
select is(pg_temp.attempt($$select platform_finance_settlement_confirm_payment('$$||current_setting('t.ref1')||$$',120000,'TRX-0001',current_date+3,null,'settle-pay-key-0000002')$$),'22023:INVALID_PAYMENT_DATE','Payment date cannot be in the future');
-- A different amount is recorded and sent to review, never settled partially.
select is((platform_finance_settlement_confirm_payment(current_setting('t.ref1'),100000,'TRX-0001',current_date,'Llegó menos','settle-pay-key-0000003')->>'status'),'in_review',
 'Payment RD$ 1,000 against RD$ 1,200: recorded as a mismatch, settlement goes to review');
select set_config('t.pay',(platform_finance_settlement_confirm_payment(current_setting('t.ref1'),120000,'TRX-0002',current_date,null,'settle-pay-key-0000004'))::text,true);
select is((current_setting('t.pay')::jsonb->>'status')||'/'||(current_setting('t.pay')::jsonb->>'event'),'settled/payment_confirmed','Exact amount: settled');
select is((platform_finance_settlement_confirm_payment(current_setting('t.ref1'),120000,'TRX-0002',current_date,null,'settle-pay-key-0000004')->>'replayed')::boolean,true,'Same key, same payment: replay');
select is(pg_temp.attempt($$select platform_finance_settlement_confirm_payment('$$||current_setting('t.ref1')||$$',120000,'TRX-0099',current_date,null,'settle-pay-key-0000004')$$),'23505:IDEMPOTENCY_CONFLICT','Same key, other payment: conflict');
select is(pg_temp.attempt($$select platform_finance_settlement_confirm_payment('$$||current_setting('t.ref1')||$$',120000,'TRX-0003',current_date,null,'settle-pay-key-0000005')$$),'23514:SETTLEMENT_ALREADY_SETTLED','A settled settlement cannot be paid again');
reset role;
select is((select string_agg(kind||':'||coalesce(from_status,'-')||'>'||to_status||':'||coalesce(amount_minor::text,'-'),',' order by e.occurred_at,e.id) from settlement_events e join settlements s on s.id=e.settlement_id
 where s.reference=current_setting('t.ref1')),'finalized:->due:-,payment_mismatch:due>in_review:100000,payment_confirmed:in_review>settled:120000','Event history: finalized → mismatch → confirmed');
select ok((select settled_at is not null and status='settled' and cafeteria_owes_minor=205000 and net_amount_minor=120000 from settlements where reference=current_setting('t.ref1')),'Settled; totals unchanged');
select ok(exists(select 1 from audit_events where action='settlement_payment_confirmed' and actor_person_id='00000000-0000-0000-0000-0000000f5e01' and after_metadata->>'reference'=current_setting('t.ref1')
 and after_metadata->>'from_status'='in_review' and after_metadata->>'to_status'='settled' and after_metadata->>'amount_minor'='120000' and after_metadata->>'payment_reference'='TRX-0002'),
 'Payment audited: actor, old/new status, amount, reference');
select ok(exists(select 1 from audit_events where action='settlement_payment_mismatch' and after_metadata->>'reference'=current_setting('t.ref1')),'Mismatch audited');

-- ── Review: Platform opens and resolves; totals never change ───────────────────────────────────
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f5d01');
select is(pg_temp.attempt($$select platform_finance_settlement_review('$$||current_setting('t.ref4')||$$','open','bogus',null,'settle-rev-key-0000001')$$),'22023:INVALID_REVIEW_REASON','Review needs a known reason');
select is((platform_finance_settlement_review(current_setting('t.ref4'),'open','wallet_sales_differ','La cafetería reporta otra cifra','settle-rev-key-0000002')->>'status'),'in_review','Review opened');
select is(pg_temp.attempt($$select platform_finance_settlement_review('$$||current_setting('t.ref4')||$$','open','other','Otra vez','settle-rev-key-0000003')$$),'23514:SETTLEMENT_STATUS_CONFLICT','Already in review');
select is(pg_temp.attempt($$select platform_finance_settlement_review('$$||current_setting('t.ref4')||$$','resolve',null,null,'settle-rev-key-0000004')$$),'22023:INVALID_SETTLEMENT_NOTE','Resolving needs a note');
select is((platform_finance_settlement_review(current_setting('t.ref4'),'resolve',null,'Cifras verificadas con los recibos','settle-rev-key-0000005')->>'status'),'due','Resolved: back to due');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select platform_finance_settlement_review('$$||current_setting('t.ref4')||$$','open','cafeteria_dispute',null,'settle-rev-key-0000006')$$),'42501:not_authorized','Cafetería cannot change settlement state');
reset role;
select is((select clearing_owes_minor||'/'||net_amount_minor||'/'||status from settlements where reference=current_setting('t.ref4')),'20000/20000/due','Review never changes totals');
select ok(exists(select 1 from audit_events where action='settlement_review_opened' and after_metadata->>'reason'='wallet_sales_differ') and exists(select 1 from audit_events where action='settlement_review_resolved'),'Review transitions audited');

-- ── Cafetería read: own only, truthful, no PIKAS operator identity ─────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((select concat_ws('/',x->>'enabled',jsonb_array_length(x->'settlements')) from (select cafeteria_settlements_read('00000000-0000-0000-0000-000000000111') x) y),'true/4','Cafetería sees its four settlements');
select set_config('t.cd',cafeteria_settlement_detail('00000000-0000-0000-0000-000000000111',current_setting('t.ref1'))::text,true);
select is((select concat_ws('/',x->>'status',x->>'net_direction',x->>'net_amount_minor',jsonb_array_length(x->'lines'),jsonb_array_length(x->'events')) from (select current_setting('t.cd')::jsonb x) y),
 'settled/cafeteria_to_clearing/120000/4/3','Detail: status, net, four lines, three events');
select is((select count(*) from jsonb_array_elements(current_setting('t.cd')::jsonb->'events') e where e->>'actor' is not null),0::bigint,'The PIKAS operator is not named to the Cafetería');
select ok((select bool_and((e->>'reason'='cash_collection' and e->>'replenishment_reference' ~ '^REC-') or (e->>'reason'<>'cash_collection' and e->>'receipt_number' is not null))
 from jsonb_array_elements(current_setting('t.cd')::jsonb->'lines') e),'Each line can be reconciled: REC- reference for cash, receipt number for sales and refunds');
select ok(current_setting('t.cd')::jsonb::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','No internal identifiers in the Cafetería detail');
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select is(pg_temp.attempt($$select cafeteria_settlements_read('00000000-0000-0000-0000-000000000111')$$) like '42501:%',true,'Another Cafetería Admin cannot read Cafetería 111');
select is(pg_temp.attempt($$select cafeteria_settlement_detail('00000000-0000-0000-0000-000000000112','$$||current_setting('t.ref1')||$$')$$),'23503:SETTLEMENT_NOT_FOUND','…nor reach its settlement through its own Cafetería');
reset role;

-- ── Platform reads ─────────────────────────────────────────────────────────────────────────────
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f5d02');
select is((select string_agg(e->>'status',',' order by e->>'week_start') from jsonb_array_elements(platform_finance_settlements_read('action',null)->'settlements') e),'due,due',
 'Queue: settlements needing action (the RD$ 200 due ones); settled ones are history');
select is(jsonb_array_length(platform_finance_settlements_read('history',null)->'settlements'),4,'History lists all four');
select is((select count(*) from jsonb_array_elements(platform_finance_settlement_detail(current_setting('t.ref1'))->'events') e where e->>'actor'='Liquidaciones ficticia'),3::bigint,
 'Platform detail names the finance operator on each event');
select is(pg_temp.attempt($$select platform_finance_settlement_detail('LIQ-99999999')$$),'23503:SETTLEMENT_NOT_FOUND','Unknown reference');
reset role;

-- School keeps student-level support only: its wallet read carries no settlement economics.
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select ok(school_wallet_read('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',null)::text !~* 'settle|liquid|obligation|clearing','School wallet read: no settlement, obligation or clearing data');
reset role;

select * from finish();
rollback;
