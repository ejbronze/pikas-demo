-- PIKAS Settlement after activation ends (202611210001). Fictional local fixtures only; everything rolls back.
-- Financial activation governs NEW financial activity; it never strands obligations already created while active.
-- Foundation fixtures as in settlement_financial_operations.test.sql (account 1, Cafetería 111, student 5201, register 9401).
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
-- Finance operator acting with an injected clock (ended weeks).
create function pg_temp.fin(sql text) returns jsonb language plpgsql as $$declare r jsonb; begin
 perform pg_temp.as_operator('00000000-0000-0000-0000-0000000f6d01'); execute 'reset role'; execute sql into r; return r; end$$;
create function pg_temp.money() returns text language sql security definer as $$ select concat_ws('|',
 (select count(*) from public.financial_entries),(select count(*) from public.financial_obligations),(select sum(current_balance_minor) from public.student_wallets),
 (select count(*) from public.wallet_ledger_entries),(select count(*) from public.replenishment_requests),(select count(*) from public.wallet_adjustments)) $$;
create function pg_temp.obligations() returns text language sql security definer as $$
 select string_agg(reason||':'||amount_minor,',' order by reason,amount_minor) from public.financial_obligations where cafeteria_id='00000000-0000-0000-0000-000000000111'$$;
grant execute on all functions in schema pg_temp to authenticated;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-0000000f6d01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','settle.end.f1@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-0000000f6e01','00000000-0000-0000-0000-0000000f6d01','Cierre financiero ficticio');
insert into pikas_private.platform_roles(role_code) values('settle_end_test');
-- The approved finance bundle plus, only for scenario 3, the funded-adjustment capability (never in the default bundle).
insert into pikas_private.platform_role_capabilities(role_code,capability) values('settle_end_test','platform:finance:read'),('settle_end_test','platform:finance:settlement:manage'),
 ('settle_end_test','platform:finance:adjustments:fund');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-0000000f6e01','settle_end_test');
select set_config('t.w',pikas_private.settlement_week_start(clock_timestamp())::text,true);

-- ── Scenario 1: obligations created while active stay settleable after activation ends ─────────
select ok((pikas_private.finance_activate_customer('00000000-0000-0000-0000-000000000001',1,'Piloto ficticio','settle-end-activation-01')->>'activation_id') is not null,'Fictional account 1 activated');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok((cafeteria_wallet_collect_cash('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201',200000,null,'5e100000-0000-4000-8000-000000000001')->>'reference') is not null,'While active: cash RD$ 2,000 collected');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',0,'settle-end-open-cashier')),true);
select set_config('t.p',pg_temp.sale('settle-end-sale-key-0001',2)::text,true);
reset role;
select is(pg_temp.obligations(),'cash_collection:200000,wallet_purchase_fulfillment:10000','While active: cash obligation and wallet-sale payable recorded');
select lives_ok($$select pikas_private.finance_end_customer_activation('00000000-0000-0000-0000-000000000001','Fin del piloto ficticio')$$,'Financial activation ended before the period is calculated');
select is(pikas_private.financial_activation('00000000-0000-0000-0000-000000000001'),null,'No active policy now');
select set_config('t.m1',pg_temp.money(),true);

-- ── Scenario 2: a NEW cash collection after the end is refused and writes nothing ──────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select cafeteria_wallet_collect_cash('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201',50000,null,'5e100000-0000-4000-8000-000000000002')$$),
 '23514:FINANCIAL_POLICY_NOT_ACTIVE','After the end: a new cash collection is refused');
-- ── Scenario 3: other NEW activity governed by the policy is refused too ───────────────────────
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f6d01');
select is(pg_temp.attempt($$select platform_finance_fund_wallet_adjustment('00000000-0000-0000-0000-000000005201',5000,'administrative_correction','Ajuste ficticio tras el cierre','settle-end-fund-key-0001')$$),
 '23514:FINANCIAL_POLICY_NOT_ACTIVE','After the end: a PIKAS-funded adjustment (a new policy event) is refused');
reset role;
select is(pg_temp.money(),current_setting('t.m1'),'Refusals after the end write nothing (no entry, obligation, request, adjustment or wallet change)');
-- A plain sale after the end is the pre-activation (legacy) model again: no new obligation is created.
select pg_temp.as_user('00000000-0000-0000-0000-000000002008'); select pg_temp.sale('settle-end-sale-key-0002',1); reset role;
select is(pg_temp.obligations(),'cash_collection:200000,wallet_purchase_fulfillment:10000','After the end: a sale creates no new obligation (no fee-era activity without a policy)');

-- The Cafetería keeps seeing its settlement history after the end (customer still active).
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((select concat_ws('/',x->>'enabled',x->'current'->>'cafeteria_owes_minor',x->'current'->>'clearing_owes_minor') from (select cafeteria_settlements_read('00000000-0000-0000-0000-000000000111') x) y),
 'true/200000/10000','After the end: the Cafetería still sees what it owes (enabled by its historical obligations)');
reset role;
-- ── Scenario 6 (part 1): customer and Cafetería become operationally unavailable ───────────────
update cafeterias set status='suspended' where id='00000000-0000-0000-0000-000000000111';
update accounts set status='suspended' where id='00000000-0000-0000-0000-000000000001';
-- Tenant access is not reopened to settle: the Cafetería read refuses while the customer is suspended.
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok(pg_temp.attempt($$select cafeteria_settlements_read('00000000-0000-0000-0000-000000000111')$$) like '42501:%','Suspended customer: no tenant settlement access is reopened');
reset role;

-- ── Scenario 4: Platform finance still calculates, reviews and confirms the historical period ──
select set_config('t.m2',pg_temp.money(),true);
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f6d01');
select is(jsonb_array_length(platform_finance_settlements_read('action',null)->'ready'),0,'Week still open (real clock): nothing ready yet');
reset role;
select set_config('t.f',pg_temp.fin($$select pikas_private.settlement_run('00000000-0000-0000-0000-0000000f6e01','settle-end-run-key-0001',clock_timestamp()+interval '8 days')$$)::text,true);
select is((select concat_ws('/',x->>'status',x->>'cafeteria_owes_minor',x->>'clearing_owes_minor',x->>'net_direction',x->>'net_amount_minor',x->>'line_count')
 from (select current_setting('t.f')::jsonb->'finalized'->0 x) y),'due/200000/10000/cafeteria_to_clearing/190000/2',
 'Activation ended + customer and Cafetería suspended: the historical week is still calculated with both obligations');
select set_config('t.ref',current_setting('t.f')::jsonb->'finalized'->0->>'reference',true);
select is((pg_temp.fin($$select pikas_private.settlement_finalize('00000000-0000-0000-0000-000000000111','$$||current_setting('t.w')||$$','00000000-0000-0000-0000-0000000f6e01','settle-end-final-key-01',clock_timestamp()+interval '8 days')$$)->>'replayed')::boolean,true,
 'Direct finalization of the same week replays it');
update accounts set status='closed' where id='00000000-0000-0000-0000-000000000001';
update cafeterias set status='inactive' where id='00000000-0000-0000-0000-000000000111';
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f6d01');
select is((platform_finance_settlement_detail(current_setting('t.ref'))->>'status'),'due','Closed customer, inactive Cafetería: Platform finance still reads the settlement');
select is((platform_finance_settlement_review(current_setting('t.ref'),'open','cafeteria_dispute','Revisión tras el cierre del piloto','settle-end-rev-key-00001')->>'status'),'in_review','…can place it in review');
select is((platform_finance_settlement_confirm_payment(current_setting('t.ref'),190000,'TRX-CIERRE-01',current_date,'Pago final del piloto','settle-end-pay-key-00001')->>'status'),'settled','…and confirm its payment: settled');
select is((select concat_ws('/',jsonb_array_length(x->'settlements'),x->'settlements'->0->>'status') from (select platform_finance_settlements_read('history',null) x) y),'1/settled','History shows it settled');
reset role;
select is(pg_temp.money(),current_setting('t.m2'),'Settling wrote no financial entry, obligation, request, adjustment or wallet change');

-- ── Scenario 6 (part 2): lifecycle changes never removed historical settlement state ──────────
select is((select count(*) from settlement_lines l join settlements s on s.id=l.settlement_id where s.reference=current_setting('t.ref')),2::bigint,'Settlement lines intact');
select is((select string_agg(e.kind,',' order by e.occurred_at,e.id) from settlement_events e join settlements s on s.id=e.settlement_id where s.reference=current_setting('t.ref')),
 'finalized,review_opened,payment_confirmed','Event history intact');
select is((select count(*) from financial_obligations where cafeteria_id='00000000-0000-0000-0000-000000000111'),2::bigint,'Obligations intact');

-- ── Scenario 5: re-activation after the historical settlement duplicates nothing ───────────────
update accounts set status='active' where id='00000000-0000-0000-0000-000000000001';
update cafeterias set status='active' where id='00000000-0000-0000-0000-000000000111';
select ok((pikas_private.finance_activate_customer('00000000-0000-0000-0000-000000000001',1,'Reanudación ficticia','settle-end-activation-02')->>'activation_id') is not null,'Financial activation resumes');
select is((select count(*) from customer_financial_activations where account_id='00000000-0000-0000-0000-000000000001'),2::bigint,'Two activations: the ended one is kept, a new one is active');
select is(pg_temp.obligations(),'cash_collection:200000,wallet_purchase_fulfillment:10000','Re-activation recreates no obligation');
select is((pg_temp.fin($$select pikas_private.settlement_run('00000000-0000-0000-0000-0000000f6e01','settle-end-run-key-0002',clock_timestamp()+interval '8 days')$$)->>'count')::int,0,
 'Re-running settlement after re-activation: nothing to finalize');
select is((select count(*) from settlements where cafeteria_id='00000000-0000-0000-0000-000000000111'),1::bigint,'No duplicate settlement');
select is((select count(*) from settlement_lines where cafeteria_id='00000000-0000-0000-0000-000000000111'),2::bigint,'No reattached line');
select is((select status||'/'||net_amount_minor||'/'||cafeteria_owes_minor||'/'||clearing_owes_minor from settlements where reference=current_setting('t.ref')),'settled/190000/200000/10000','The finalized snapshot is unchanged');
-- New activity under the resumed policy settles normally, in its own later settlement.
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok((cafeteria_wallet_collect_cash('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201',30000,null,'5e100000-0000-4000-8000-000000000003')->>'reference') is not null,'After re-activation: cash collection works again');
reset role;
select set_config('t.f2',pg_temp.fin($$select pikas_private.settlement_run('00000000-0000-0000-0000-0000000f6e01','settle-end-run-key-0003',clock_timestamp()+interval '15 days')$$)::text,true);
select is((select concat_ws('/',x->>'cafeteria_owes_minor',x->>'clearing_owes_minor',x->>'late_line_count',x->>'week_start') from (select current_setting('t.f2')::jsonb->'finalized'->0 x) y),
 '30000/0/1/'||(current_setting('t.w')::date+7),'The new obligation (this week, already settled) carries into the next settlement as late, alone');

-- ── Authority and ACLs unchanged ───────────────────────────────────────────────────────────────
select is((select count(*) from pikas_private.platform_role_capabilities where capability='platform:finance:settlement:manage' and role_code not like 'settle_%'),0::bigint,'settlement:manage still granted to no real role');
select is((select count(*) from pg_proc p where p.oid in ('pikas_private.settlement_finalize(uuid,date,uuid,text,timestamptz)'::regprocedure,'pikas_private.settlement_run(uuid,text,timestamptz)'::regprocedure)
 and (p.proacl is null or exists(select 1 from aclexplode(p.proacl) a where a.grantee<>p.proowner))),0::bigint,'Changed private functions: no client EXECUTE');
select ok(has_function_privilege('authenticated','platform_finance_settlements_read(text,text)','execute') and not has_function_privilege('anon','platform_finance_settlements_read(text,text)','execute')
 and has_function_privilege('authenticated','cafeteria_settlements_read(uuid)','execute') and not has_function_privilege('anon','cafeteria_settlements_read(uuid)','execute')
 and not exists(select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname in ('platform_finance_settlements_read','cafeteria_settlements_read') and a.grantee=0),'Changed public reads: authenticated only, no PUBLIC or anon');
select is(pg_temp.attempt($$select pg_temp.fin('select pikas_private.settlement_finalize((select id from cafeterias where account_id=''03e71159-69e9-4387-9b3b-65799d49faf0'' limit 1),'''||current_setting('t.w')||''',''00000000-0000-0000-0000-0000000f6e01'',''settle-end-sandbox-key1'',clock_timestamp()+interval ''8 days'')')$$),
 '42501:SETTLEMENT_SANDBOX_REFUSED','Sandbox still refused');

select * from finish();
rollback;
