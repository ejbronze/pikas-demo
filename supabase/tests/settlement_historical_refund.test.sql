-- PIKAS Settlement: historical refund continuity (202611220001). Fictional local fixtures only; everything rolls back.
-- A refund's financial treatment follows its ORIGINAL purchase, not the customer's activation on the day of the refund.
-- Foundation fixtures: account 1 / Cafetería 111 (admin 2003) / student 5201 (wallet 7001, customer 6901) / product 8101 at RD$ 50 /
-- register 9401 (cashier 2008, assignment 9501) / supervisor 2011 (approves refunds).
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
create function pg_temp.sale(key text,qty integer,tender jsonb) returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',current_setting('t.sid'),
 'cafeteria_customer_id','00000000-0000-0000-0000-000000006901','items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',qty,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor',(5000*qty)::text,'tender',tender))->>'purchase_id')::uuid$$;
create function pg_temp.items(p uuid,qty integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('purchase_item_id',(select id from purchase_items where purchase_id=p),'quantity',qty))$$;
-- Supervisor approves, cashier refunds (the existing 5C.1 path). Returns the approval so a retry can reuse it.
create function pg_temp.approve(p uuid,qty integer,key text) returns uuid language plpgsql as $$declare a uuid; begin
 perform pg_temp.as_user('00000000-0000-0000-0000-000000002011');
 a:=(issue_purchase_item_refund_approval(current_setting('t.sid')::uuid,p,pg_temp.items(p,qty),'wrong_product',null,key)->>'approval_id')::uuid;
 execute 'reset role'; return a; end$$;
create function pg_temp.refund(p uuid,qty integer,key text,appr uuid) returns jsonb language plpgsql as $$declare r jsonb; begin
 perform pg_temp.as_user('00000000-0000-0000-0000-000000002008');
 r:=create_purchase_item_refund(current_setting('t.sid')::uuid,p,pg_temp.items(p,qty),'wrong_product',null,key,appr);
 execute 'reset role'; return r; end$$;
create function pg_temp.fin(sql text) returns jsonb language plpgsql as $$declare r jsonb; begin
 perform pg_temp.as_operator('00000000-0000-0000-0000-0000000f7d01'); execute 'reset role'; execute sql into r; return r; end$$;
create function pg_temp.bal() returns bigint language sql security definer as $$select current_balance_minor from public.student_wallets where id='00000000-0000-0000-0000-000000007001'$$;
create function pg_temp.payable(p uuid) returns public.financial_obligations language sql security definer as $$
 select o.* from public.financial_obligations o join public.financial_entries e on e.id=o.source_entry_id join public.wallet_purchase_debits d on d.id=e.wallet_purchase_debit_id
 where d.purchase_id=p and o.reason='wallet_purchase_fulfillment'$$;
create function pg_temp.corrections(p uuid) returns text language sql security definer as $$
 select coalesce(string_agg(o.reason||':'||o.amount_minor,',' order by o.created_at),'none') from public.financial_obligations o join public.financial_entries e on e.id=o.source_entry_id
 join public.wallet_refund_credits c on c.id=e.wallet_refund_credit_id where c.purchase_id=p$$;
create function pg_temp.untouched() returns text language sql security definer as $$ select concat_ws('|',
 (select count(*) from public.replenishment_requests),(select count(*) from public.wallet_replenishments),
 (select count(*) from public.financial_entries where entry_type in ('replenishment_gross_collected','replenishment_fee_earned','stored_value_issued','clearing_funded_adjustment')),
 (select count(*) from public.customer_financial_activations where status='active')) $$;
-- Test clock: business dates and settlement weeks are America/Santo_Domingo, never the session's UTC date or "now + N days"
-- (which on a Sunday already crosses two week ends). after_week(k) is one hour after week W+k ends.
create function pg_temp.sd_today() returns date language sql as $$select (clock_timestamp() at time zone 'America/Santo_Domingo')::date$$;
create function pg_temp.after_week(k integer) returns timestamptz language sql as $$
 select pikas_private.settlement_period_end(current_setting('t.w')::date + 7*k) + interval '1 hour'$$;
grant execute on all functions in schema pg_temp to authenticated;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-0000000f7d01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','settle.refund.f1@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-0000000f7e01','00000000-0000-0000-0000-0000000f7d01','Finanzas reembolsos ficticia');
insert into pikas_private.platform_roles(role_code) values('settle_refund_test');
insert into pikas_private.platform_role_capabilities(role_code,capability) values('settle_refund_test','platform:finance:read'),('settle_refund_test','platform:finance:settlement:manage');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-0000000f7e01','settle_refund_test');
select set_config('t.w',pikas_private.settlement_week_start(clock_timestamp())::text,true);

-- ── While active: wallet sales create payables; a cash sale creates none ───────────────────────
select ok((pikas_private.finance_activate_customer('00000000-0000-0000-0000-000000000001',1,'Piloto ficticio','settle-refund-activation-1')->>'activation_id') is not null,'Fictional account 1 activated');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok((cafeteria_wallet_collect_cash('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201',100000,null,'5e200000-0000-4000-8000-000000000001')->>'reference') is not null,'Cash RD$ 1,000 collected (funds the wallet)');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',100000,'settle-refund-open-01')),true);
select set_config('t.p1',pg_temp.sale('settle-refund-sale-p1-001',2,'{"type":"student_wallet"}')::text,true);
select set_config('t.p2',pg_temp.sale('settle-refund-sale-p2-001',4,'{"type":"student_wallet"}')::text,true);
select set_config('t.p3',pg_temp.sale('settle-refund-sale-p3-001',2,'{"type":"student_wallet"}')::text,true);
select set_config('t.p4',pg_temp.sale('settle-refund-sale-p4-001',2,'{"type":"cash","cash_received_minor":"10000"}')::text,true);
select set_config('t.p5',pg_temp.sale('settle-refund-sale-p5-001',5,'{"type":"student_wallet"}')::text,true);
reset role;
select is((pg_temp.payable(current_setting('t.p1')::uuid)).amount_minor,10000::bigint,'A. Activated RD$ 100 PIKAS Cash sale: clearing → Cafetería payable RD$ 100');
select is((pg_temp.payable(current_setting('t.p4')::uuid)).id,null,'F. The cash sale created no PIKAS payable');

-- ── D. Refund before the original period is finalized: reduces that same period ───────────────
select set_config('t.a3',pg_temp.approve(current_setting('t.p3')::uuid,1,'settle-refund-appr-p3-01')::text,true);
select pg_temp.refund(current_setting('t.p3')::uuid,1,'settle-refund-p3-key-0001',current_setting('t.a3')::uuid);
select is(pg_temp.corrections(current_setting('t.p3')::uuid),'wallet_refund_correction:5000','D. Same-period refund while active: correction RD$ 50 (existing behavior)');
select set_config('t.s1',pg_temp.fin($$select pikas_private.settlement_finalize('00000000-0000-0000-0000-000000000111','$$||current_setting('t.w')||$$','00000000-0000-0000-0000-0000000f7e01','settle-refund-final-key-1',pg_temp.after_week(0))$$)::text,true);
select is((select concat_ws('/',x->>'cafeteria_owes_minor',x->>'clearing_owes_minor',x->>'net_direction',x->>'net_amount_minor',x->>'line_count') from (select current_setting('t.s1')::jsonb x) y),
 '105000/65000/cafeteria_to_clearing/40000/6','D. The original week settles with the same-period refund inside it (cash 1,000 + refund 50 vs sales 650)');
select set_config('t.ref1',current_setting('t.s1')::jsonb->>'reference',true);

-- ── Activation ends; the original settlement is fixed ──────────────────────────────────────────
select lives_ok($$select pikas_private.finance_end_customer_activation('00000000-0000-0000-0000-000000000001','Fin del piloto ficticio')$$,'Financial activation ended');
select set_config('t.u0',pg_temp.untouched(),true);

-- ── A. Full refund of an activated sale after activation ended ─────────────────────────────────
select set_config('t.b0',pg_temp.bal()::text,true);
select set_config('t.a1',pg_temp.approve(current_setting('t.p1')::uuid,2,'settle-refund-appr-p1-01')::text,true);
select set_config('t.r1',pg_temp.refund(current_setting('t.p1')::uuid,2,'settle-refund-p1-key-0001',current_setting('t.a1')::uuid)::text,true);
select is(pg_temp.bal(),current_setting('t.b0')::bigint+10000,'A. Wallet restored by RD$ 100');
select is(pg_temp.corrections(current_setting('t.p1')::uuid),'wallet_refund_correction:10000','A. Historical financial correction RD$ 100 (Cafetería → clearing), activation still ended');
select ok((select o.corrects_obligation_id=(pg_temp.payable(current_setting('t.p1')::uuid)).id and o.debtor_party_id=pikas_private.cafeteria_party('00000000-0000-0000-0000-000000000111')
 and o.creditor_party_id=pikas_private.clearing_party() from financial_obligations o join financial_entries e on e.id=o.source_entry_id join wallet_refund_credits c on c.id=e.wallet_refund_credit_id
 where c.purchase_id=current_setting('t.p1')::uuid),'A. The correction points to the original payable and runs Cafetería → clearing');
select is((select count(*) from financial_entries e join wallet_refund_credits c on c.id=e.wallet_refund_credit_id where c.purchase_id=current_setting('t.p1')::uuid and e.entry_type='stored_value_restored'),1::bigint,
 'A. One stored_value_restored entry for the restored wallet value');
select is(pg_temp.untouched(),current_setting('t.u0'),'A. No replenishment, no fee, no new funding, no reactivation');

-- ── G. The same refund retried: one wallet credit, one correction ──────────────────────────────
select set_config('t.b1',pg_temp.bal()::text,true);
select is((pg_temp.refund(current_setting('t.p1')::uuid,2,'settle-refund-p1-key-0001',current_setting('t.a1')::uuid)->>'refund_id'),current_setting('t.r1')::jsonb->>'refund_id','G. Retry with the same key replays the same refund');
select is(pg_temp.bal(),current_setting('t.b1')::bigint,'G. No second wallet credit');
select is(pg_temp.corrections(current_setting('t.p1')::uuid),'wallet_refund_correction:10000','G. No second financial correction');
select is(pg_temp.attempt($$select pg_temp.refund('$$||current_setting('t.p1')||$$'::uuid,1,'settle-refund-p1-key-0002',null)$$) like '%:%',true,'G. Nothing left to refund on the sale: a further refund is refused');

-- ── C. Full refund of a sale whose week is already finalized ───────────────────────────────────
select set_config('t.a2',pg_temp.approve(current_setting('t.p2')::uuid,4,'settle-refund-appr-p2-01')::text,true);
select pg_temp.refund(current_setting('t.p2')::uuid,4,'settle-refund-p2-key-0001',current_setting('t.a2')::uuid);
select is(pg_temp.corrections(current_setting('t.p2')::uuid),'wallet_refund_correction:20000','C. Correction RD$ 200 for the finalized week''s sale');

-- ── E. Partial (itemized) refund: correction equals only the refunded wallet amount ────────────
select set_config('t.a5',pg_temp.approve(current_setting('t.p5')::uuid,2,'settle-refund-appr-p5-01')::text,true);
select pg_temp.refund(current_setting('t.p5')::uuid,2,'settle-refund-p5-key-0001',current_setting('t.a5')::uuid);
select is(pg_temp.corrections(current_setting('t.p5')::uuid),'wallet_refund_correction:10000','E. 2 of 5 items refunded: correction RD$ 100 of the RD$ 250 payable');

-- ── F. Cash sale refund: no PIKAS correction ───────────────────────────────────────────────────
select set_config('t.a4',pg_temp.approve(current_setting('t.p4')::uuid,2,'settle-refund-appr-p4-01')::text,true);
select pg_temp.refund(current_setting('t.p4')::uuid,2,'settle-refund-p4-key-0001',current_setting('t.a4')::uuid);
select is(pg_temp.corrections(current_setting('t.p4')::uuid),'none','F. The cash sale refund creates no wallet credit and no PIKAS correction');
select is((select count(*) from refunds where purchase_id=current_setting('t.p4')::uuid and tender_type='cash'),1::bigint,'F. …it is a normal cash refund');

-- ── H. New activity is still refused ───────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select cafeteria_wallet_collect_cash('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201',50000,null,'5e200000-0000-4000-8000-000000000002')$$),
 '23514:FINANCIAL_POLICY_NOT_ACTIVE','H. After the end: a new cash collection is refused');
reset role;
-- A sale after the end is not financialized, so its later refund is not either.
select pg_temp.as_user('00000000-0000-0000-0000-000000002008'); select set_config('t.p6',pg_temp.sale('settle-refund-sale-p6-001',1,'{"type":"student_wallet"}')::text,true); reset role;
select set_config('t.a6',pg_temp.approve(current_setting('t.p6')::uuid,1,'settle-refund-appr-p6-01')::text,true);
select pg_temp.refund(current_setting('t.p6')::uuid,1,'settle-refund-p6-key-0001',current_setting('t.a6')::uuid);
select is(pg_temp.corrections(current_setting('t.p6')::uuid),'none','H. A sale made after the end, and its refund, stay outside the financial model (no arbitrary obligation)');
select is(pg_temp.untouched(),current_setting('t.u0'),'H. Still no replenishment, fee or funding');

-- ── I. Lifecycle: the customer is suspended; tenant refunds stop, historical accounting still closes ──
update accounts set status='suspended' where id='00000000-0000-0000-0000-000000000001';
select set_config('t.c0',(select count(*) from financial_obligations)::text,true);
select ok(pg_temp.attempt($$select pg_temp.approve('$$||current_setting('t.p5')||$$'::uuid,1,'settle-refund-appr-p5-02')$$) <> 'ok','I. Suspended customer: no tenant refund path is reopened');
select is((select count(*) from financial_obligations)::text,current_setting('t.c0'),'I. …and nothing is written');

-- ── B. Settle after the refunds, activation still ended (customer suspended) ───────────────────
select set_config('t.s2',pg_temp.fin($$select pikas_private.settlement_run('00000000-0000-0000-0000-0000000f7e01','settle-refund-run-key-01',pg_temp.after_week(1))$$)::text,true);
select is((select concat_ws('/',x->>'week_start',x->>'cafeteria_owes_minor',x->>'clearing_owes_minor',x->>'net_direction',x->>'net_amount_minor',x->>'line_count',x->>'late_line_count')
 from (select current_setting('t.s2')::jsonb->'finalized'->0 x) y),(current_setting('t.w')::date+7)||'/40000/0/cafeteria_to_clearing/40000/3/3',
 'B/C. The next settlement carries the three historical corrections (100 + 200 + 100) as late lines: the Cafetería returns RD$ 400');
select is((select cafeteria_owes_minor||'/'||clearing_owes_minor||'/'||line_count from settlements where reference=current_setting('t.ref1')),'105000/65000/6','C. The original settlement is unchanged');
select is((select count(*) from settlement_lines l join financial_obligations o on o.id=l.obligation_id join settlement_lines orig on orig.obligation_id=o.corrects_obligation_id
 join settlements os on os.id=orig.settlement_id where l.settlement_id=(select id from settlements where reference=current_setting('t.s2')::jsonb->'finalized'->0->>'reference') and os.reference=current_setting('t.ref1')),3::bigint,
 'C. Each late correction traces to its original payable inside the original settlement');
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f7d01');
select ok((select bool_and(e->>'receipt_number' is not null and (e->>'late')::boolean) from jsonb_array_elements(platform_finance_settlement_detail(current_setting('t.s2')::jsonb->'finalized'->0->>'reference')->'lines') e),
 'C. The detail shows each correction with the original receipt, marked late');
select is((platform_finance_settlement_confirm_payment(current_setting('t.s2')::jsonb->'finalized'->0->>'reference',40000,'TRX-REEMB-01',pg_temp.sd_today(),null,'settle-refund-pay-key-01')->>'status'),'settled',
 'B. Payment of the correction settlement confirmed while activation is ended and the customer suspended');
reset role;
select is((select count(*) from (select obligation_id from settlement_lines group by 1 having count(*)>1) x),0::bigint,'No obligation in two settlements');
select is((select coalesce(sum(o.amount_minor),0)::bigint from financial_obligations o where o.reason='wallet_refund_correction' and o.corrects_obligation_id=(pg_temp.payable(current_setting('t.p5')::uuid)).id),10000::bigint,
 'E. Corrections never exceed what was refunded (the FIN 2 guard still caps them at the payable)');

-- ── Security ───────────────────────────────────────────────────────────────────────────────────
select is((select count(*) from pg_proc p where p.oid='pikas_private.finance_after_wallet_refund()'::regprocedure and (p.proacl is null or exists(select 1 from aclexplode(p.proacl) a where a.grantee<>p.proowner))),0::bigint,
 'The changed trigger function has no client EXECUTE');
select ok((select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='pikas_private.finance_after_wallet_refund()'::regprocedure),'…SECURITY DEFINER with an empty search path');

select * from finish();
rollback;
