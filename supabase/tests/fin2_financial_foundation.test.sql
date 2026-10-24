-- PIKAS FIN 2 financial foundation (202611090001). Fictional local fixtures only; everything rolls back.
-- Foundation fixtures: account 1 / school 11 / student 5201 / wallet 7001 / Cafetería 111 / customer 6901 /
-- product 8101 at RD$ 50 / register 9401 (cashier 2008, assignment 9501) / supervisor 2011 (assignment 9503).
-- Personas: 2002 School Admin (account 1), 2006 School Admin (account 2), 2003 Cafeteria Admin (Cafetería 111).
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; s text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text, s=returned_sqlstate; return s||':'||m; end$$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
-- Platform operator with a real application session (Platform reads require one).
create function pg_temp.as_operator(u text) returns void language plpgsql as $$declare sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;
create function pg_temp.q(sql text) returns text language plpgsql as $$declare r text; begin execute sql into r; return r; end$$;
create function pg_temp.bal() returns bigint language sql as $$select current_balance_minor from student_wallets where id='00000000-0000-0000-0000-000000007001'$$;
create function pg_temp.legacy_credit(amount bigint,key uuid) returns uuid language sql as $$
 select (school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',amount,key,'Ref local','Verificado')->>'replenishment_id')::uuid$$;
create function pg_temp.reverse(rep uuid,key uuid) returns jsonb language sql as $$
 select school_wallet_reverse_replenishment('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',rep,'wrong_amount',null,key)$$;
create function pg_temp.adjust(amount bigint,key uuid) returns jsonb language sql as $$
 select school_wallet_adjust('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',amount,
  case when amount>0 then 'authorized_credit' else 'authorized_debit' end,'Ajuste ficticio FIN 2',key)$$;
create function pg_temp.sale(key text,qty integer) returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',current_setting('t.sid'),
 'cafeteria_customer_id','00000000-0000-0000-0000-000000006901','items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',qty,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor',(5000*qty)::text,
 'tender',jsonb_build_object('type','student_wallet')))->>'purchase_id')::uuid$$;
create function pg_temp.items(p uuid,qty integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('purchase_item_id',(select id from purchase_items where purchase_id=p),'quantity',qty))$$;
-- Internal primitives, called as the database owner exactly as FIN 3/4 wrappers will call them.
create function pg_temp.activate(key text,reason text default 'Piloto ficticio FIN 2') returns jsonb language sql as $$
 select pikas_private.finance_activate_customer('00000000-0000-0000-0000-000000000001',1,reason,key)$$;
create function pg_temp.bank(gross bigint,key text) returns jsonb language sql as $$
 select pikas_private.finance_submit_bank_replenishment(current_setting('t.op_person')::uuid,'platform_operator','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',gross,'BANCO-REF-0001','Madre ficticia',null,'WhatsApp 21/10 10:02',key)$$;
create function pg_temp.decide(ref text,decision text,reason text,key text) returns jsonb language sql as $$
 select pikas_private.finance_decide_bank_replenishment((select id from replenishment_requests where reference=ref),current_setting('t.op_person')::uuid,decision,reason,key)$$;
create function pg_temp.cash(gross bigint,key text) returns jsonb language sql as $$
 select pikas_private.finance_post_cash_replenishment((select id from persons where auth_user_id='00000000-0000-0000-0000-000000002008'),
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000006901',gross,'Padre ficticio',key)$$;
-- Fee-era reversal is a Platform finance operation (202611100001).
create function pg_temp.freverse(ref text,key text) returns jsonb language sql as $$
 select pikas_private.finance_reverse_replenishment((select id from replenishment_requests where reference=ref),current_setting('t.op_person')::uuid,'wrong_amount',null,key)$$;
create function pg_temp.entries(ref text,t text) returns bigint language sql as $$
 select coalesce(sum(e.amount_minor),0)::bigint from financial_entries e join replenishment_requests r on r.id=e.replenishment_request_id where r.reference=ref and e.entry_type=t$$;
create function pg_temp.purchase_obligation(p uuid) returns financial_obligations language sql as $$
 select o.* from financial_obligations o join financial_entries e on e.id=o.source_entry_id join wallet_purchase_debits d on d.id=e.wallet_purchase_debit_id where d.purchase_id=p$$;

-- Fictional Platform operator (platform_admin, no finance capability).
reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-0000000f2d01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin2.operador@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-0000000f2e01','00000000-0000-0000-0000-0000000f2d01','Operadora FIN 2 ficticia');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-0000000f2e01','platform_admin');
select set_config('t.op_person','00000000-0000-0000-0000-0000000f2e01',true);

-- ── Shape, authority and inert default ─────────────────────────────────────────────────────────
select is((select count(*) from customer_financial_activations),0::bigint,'Inert by default: no customer is activated by the migration');
select is((select count(*)::int from financial_entries)+(select count(*)::int from financial_obligations)+(select count(*)::int from replenishment_requests),0,'No backfill: no historical financial records');
select is((select array_agg(version||':'||replenishment_fee_bps||':'||rounding_rule||':'||currency_code) from financial_fee_policies),array['1:300:half_up:DOP'],'Policy v1 = 300 bps, half-up, DOP');
select is((select count(*) from pikas_private.platform_role_capabilities where capability like 'platform:finance:%'),0::bigint,'Finance capabilities exist ungranted (50)');
select is((select count(*) from pikas_private.platform_capabilities where capability in ('platform:finance:replenishments:verify','platform:finance:read','platform:finance:settlement:manage')),3::bigint,'Three Platform finance capabilities catalogued');
select is((select array_agg(role_code||':'||capability order by capability) from pikas_private.role_capabilities where capability in ('cafeteria:wallets:collect_cash','cafeteria:finance:obligations:read','cafeteria:wallets:replenish')),array['cafeteria_admin:cafeteria:finance:obligations:read','cafeteria_admin:cafeteria:wallets:collect_cash'],'Settlement: Cafetería Admin holds collect_cash (FIN 4) and the read of its own obligations/settlements; the legacy replenish stays withdrawn');
select ok(not has_function_privilege('authenticated','pikas_private.finance_submit_bank_replenishment(uuid,text,uuid,uuid,uuid,bigint,text,text,text,text,text)','execute')
 and not has_function_privilege('authenticated','pikas_private.finance_post_cash_replenishment(uuid,uuid,uuid,bigint,text,text)','execute')
 and not has_function_privilege('authenticated','pikas_private.finance_activate_customer(uuid,integer,text,text)','execute'),'Primitives are not client-callable');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pikas_private'
  and (p.proname like 'finance%' or p.proname in ('replenishment_fee_minor','financial_activation','clearing_party','cafeteria_party','settlement_week_start','record_obligation',
   'guard_financial_obligation','guard_fee_policy','guard_customer_activation','guard_replenishment_request','assert_replenishment_request_complete'))
  and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))),0::bigint,'No FIN 2 private function is client-callable');
select ok(not has_table_privilege('authenticated','financial_entries','select') and not has_table_privilege('authenticated','financial_obligations','select')
 and not has_table_privilege('authenticated','replenishment_requests','select'),'No direct table access');
-- 5. Historical balances: untouched and still equal to their ledgers.
select is((select count(*) from student_wallets w where w.current_balance_minor <> (select coalesce(sum(l.amount_minor),0) from wallet_ledger_entries l where l.wallet_id=w.id)),
 (select count(*) from student_wallets w where w.current_balance_minor <> (select coalesce(sum(l.amount_minor),0) from wallet_ledger_entries l where l.wallet_id=w.id)),'Historical balances unchanged by the migration');

-- ── Fee calculation (10–14) ────────────────────────────────────────────────────────────────────
select is(pikas_private.replenishment_fee_minor(200000,300),6000::bigint,'RD$ 2,000.00 → fee RD$ 60.00 (exact cent)');
select is(pikas_private.replenishment_fee_minor(33333,300),1000::bigint,'RD$ 333.33 → 999.99 centavos rounds half-up to 1,000');
select is(pikas_private.replenishment_fee_minor(49,300),1::bigint,'1.47 centavos (below .5) → 1');
select is(pikas_private.replenishment_fee_minor(50,300),2::bigint,'1.50 centavos (exactly .5) → 2');
select is(pikas_private.replenishment_fee_minor(51,300),2::bigint,'1.53 centavos (above .5) → 2');
select is(pikas_private.replenishment_fee_minor(1,300),0::bigint,'Minimum 1 centavo → fee 0, net 1');
select is(pikas_private.replenishment_fee_minor(9007199254740991,300),270215977642230::bigint,'Largest allowed gross computes exactly');
select ok(pg_get_functiondef('pikas_private.replenishment_fee_minor(bigint,integer)'::regprocedure) !~* '(float|double|real)','Integer/numeric arithmetic only');

-- ── 1–4. Legacy customer (before activation) ───────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',1000,'fin2-open-cashier-001')),true);
reset role; select set_config('t.b0',pg_temp.bal()::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select set_config('t.legacy',pg_temp.legacy_credit(200000,'f2000000-0000-4000-8000-000000000001')::text,true);
reset role; select is(pg_temp.bal(),current_setting('t.b0')::bigint+200000,'1. Scenario 1: legacy RD$ 2,000 credits the full RD$ 2,000');
select is((select amount_minor from wallet_replenishments where id=current_setting('t.legacy')::uuid),200000::bigint,'Legacy replenishment record keeps the full amount, no fee');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.lp',pg_temp.sale('fin2-legacy-sale-00001',1)::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.lappr',(issue_purchase_item_refund_approval(current_setting('t.sid')::uuid,current_setting('t.lp')::uuid,pg_temp.items(current_setting('t.lp')::uuid,1),'wrong_product',null,'fin2-legacy-approval-01')->>'approval_id'),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.lrf',(create_purchase_item_refund(current_setting('t.sid')::uuid,current_setting('t.lp')::uuid,pg_temp.items(current_setting('t.lp')::uuid,1),'wrong_product',null,'fin2-legacy-refund-001',current_setting('t.lappr')::uuid))::text,true);
reset role; select is(pg_temp.bal(),current_setting('t.b0')::bigint+200000,'2–3. Legacy purchase and refund behave as before');
select is((select count(*)::int from financial_entries)+(select count(*)::int from financial_obligations),0,'Scenario 1: no fee, no financial event, no obligation for a legacy customer');
-- 4. Legacy reversal may still go negative (existing behaviour).
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select set_config('t.legacy2',pg_temp.legacy_credit(3000,'f2000000-0000-4000-8000-000000000002')::text,true);
select pg_temp.adjust(-(pg_temp.bal()-1000),'f2000000-0000-4000-8000-0000000000a1');
select lives_ok($$select pg_temp.reverse(current_setting('t.legacy2')::uuid,'f2000000-0000-4000-8000-0000000000b1')$$,'4. Legacy reversal still allowed below its amount');
reset role; select is(pg_temp.bal(),-2000::bigint,'Legacy reversal may leave the wallet negative (unchanged behaviour)');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002'); select pg_temp.adjust(1002000,'f2000000-0000-4000-8000-0000000000a2');
reset role; select is(pg_temp.bal(),1000000::bigint,'Balance restored to RD$ 10,000 with a legacy adjustment');

-- ── 7. Activation required; activation (A/B, 6, 9) ─────────────────────────────────────────────
select is(pg_temp.attempt($$select pg_temp.bank(200000,'fin2-bank-before-activation')$$),'23514:FINANCIAL_POLICY_NOT_ACTIVE','7. No fee-era request without customer activation');
select set_config('t.act',pg_temp.activate('fin2-activate-account1-001')::text,true);
select is(current_setting('t.act')::jsonb->>'opening_stored_value_minor',(select sum(current_balance_minor)::text from student_wallets where account_id='00000000-0000-0000-0000-000000000001'),
 'Activation records the existing stored value of the customer (opening snapshot)');
select is(pg_temp.activate('fin2-activate-account1-001'),current_setting('t.act')::jsonb,'Activation replay returns the same result');
select is(pg_temp.attempt($$select pg_temp.activate('fin2-activate-account1-001','Otro motivo')$$),'23505:IDEMPOTENCY_CONFLICT','Activation key reused with different content fails');
select is(pg_temp.attempt($$select pg_temp.activate('fin2-activate-account1-002')$$),'23514:FINANCIAL_POLICY_ALREADY_ACTIVE','One active activation per customer');
select is(pg_temp.attempt($$update financial_fee_policies set replenishment_fee_bps=250$$),'55000:FEE_POLICY_IMMUTABLE','6. Fee rate immutable');
select is(pg_temp.attempt($$delete from financial_fee_policies$$),'55000:FEE_POLICY_IMMUTABLE','6. Fee policy cannot be deleted');
select is(pg_temp.attempt($$update customer_financial_activations set policy_id=gen_random_uuid()$$),'55000:ACTIVATION_IMMUTABLE','Activation cannot switch policy');
-- 9 / R. School replenishment for an activated customer needs a collection source; an earlier request still replays.
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt($$select pg_temp.legacy_credit(5000,'f2000000-0000-4000-8000-000000000003')$$),'23514:collection_source_required','Activated customer: direct School replenishment refused');
select is(pg_temp.legacy_credit(200000,'f2000000-0000-4000-8000-000000000001')::text,current_setting('t.legacy'),'Pre-activation request replays its original result');
-- 8. Another customer stays legacy.
select pg_temp.as_user('00000000-0000-0000-0000-000000002006');
select set_config('t.b2',coalesce((select current_balance_minor::text from student_wallets where student_id='00000000-0000-0000-0000-000000005202'),'0'),true);
select is(pg_temp.attempt($$select school_wallet_replenish('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000005202',10000,'f2000000-0000-4000-8000-000000000004','Ref','Verificado')$$),
 pg_temp.attempt($$select school_wallet_replenish('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000005202',10000,'f2000000-0000-4000-8000-000000000004','Ref','Verificado')$$),
 '8. Another customer keeps legacy behaviour (same result as before FIN 2)');
reset role;

-- ── 15–22. Scenario 2: activated bank transfer ─────────────────────────────────────────────────
select set_config('t.b1',pg_temp.bal()::text,true);
select set_config('t.bank',pg_temp.bank(200000,'fin2-bank-request-0001')::text,true);
select set_config('t.ref',current_setting('t.bank')::jsonb->>'reference',true);
select ok(current_setting('t.ref') ~ '^REC-[0-9]{8}$','Human-facing reference REC-NNNNNNNN, no UUID');
select is(current_setting('t.bank')::jsonb->>'state','submitted','15. Submitted request');
select is(pg_temp.bal(),current_setting('t.b1')::bigint,'15. A submitted request does not credit the wallet');
select is((current_setting('t.bank')::jsonb->>'gross_minor')||'/'||(current_setting('t.bank')::jsonb->>'fee_minor')||'/'||(current_setting('t.bank')::jsonb->>'net_minor'),'200000/6000/194000','Gross RD$ 2,000 / fee RD$ 60 / net RD$ 1,940');
select is((select policy_id::text||':'||fee_bps from replenishment_requests where reference=current_setting('t.ref')),(select id::text||':300' from financial_fee_policies where version=1),'9. Policy and rate snapshot on the request');
select is(pg_temp.bank(200000,'fin2-bank-request-0001'),current_setting('t.bank')::jsonb,'16. Duplicate submission returns the same request');
select is(pg_temp.attempt($$select pg_temp.bank(250000,'fin2-bank-request-0001')$$),'23505:IDEMPOTENCY_CONFLICT','44. Same key, different body fails');
select is(pg_temp.attempt($$select pg_temp.bank(0,'fin2-bank-request-zero')$$)||'|'||pg_temp.attempt($$select pg_temp.bank(-100,'fin2-bank-request-negative')$$),
 '22023:INVALID_GROSS_AMOUNT|22023:INVALID_GROSS_AMOUNT','14. Zero and negative amounts refused');
select is(pg_temp.attempt($$update replenishment_requests set gross_minor=1 where reference=current_setting('t.ref')$$),'55000:REPLENISHMENT_REQUEST_IMMUTABLE','Request amounts cannot be edited');
-- 17. Rejected request cannot post.
select set_config('t.rej',pg_temp.bank(50000,'fin2-bank-request-0002')->>'reference',true);
select is(pg_temp.decide(current_setting('t.rej'),'reject','Comprobante no coincide','fin2-decide-reject-0001')->>'state','rejected','Rejection recorded with its reason');
select is(pg_temp.attempt($$select pg_temp.decide(current_setting('t.rej'),'approve',null,'fin2-decide-approve-0002')$$),'23514:REQUEST_ALREADY_DECIDED','17. A rejected request cannot post');
select is(pg_temp.attempt($$update replenishment_requests set state='posted' where reference=current_setting('t.rej')$$),'55000:REPLENISHMENT_REQUEST_IMMUTABLE','17. Rejected state is final');
-- 18–22. Approval posts net.
select set_config('t.post',pg_temp.decide(current_setting('t.ref'),'approve',null,'fin2-decide-approve-0001')::text,true);
select is(pg_temp.bal(),current_setting('t.b1')::bigint+194000,'18. Scenario 2: wallet receives RD$ 1,940 (net)');
select is((select l.amount_minor from wallet_ledger_entries l join replenishment_requests r on r.wallet_replenishment_id=l.replenishment_id where r.reference=current_setting('t.ref')),194000::bigint,'19. Wallet ledger = net');
select is((select w.source||':'||w.amount_minor from wallet_replenishments w join replenishment_requests r on r.id=w.financial_request_id where r.reference=current_setting('t.ref')),'bank_transfer_verified:194000','Existing immutable wallet replenishment records the posting');
select is(pg_temp.entries(current_setting('t.ref'),'replenishment_fee_earned'),6000::bigint,'20. Fee event RD$ 60');
select is(pg_temp.entries(current_setting('t.ref'),'replenishment_gross_collected'),pg_temp.entries(current_setting('t.ref'),'replenishment_fee_earned')+pg_temp.entries(current_setting('t.ref'),'stored_value_issued'),'21. Gross = fee + net in the financial events');
select is((select count(*) from wallet_replenishments w join replenishment_requests r on r.id=w.financial_request_id where r.reference=current_setting('t.ref')),1::bigint,'22. Exactly one wallet replenishment per request');
select is((select count(*) from financial_obligations o join financial_entries e on e.id=o.source_entry_id join replenishment_requests r on r.id=e.replenishment_request_id where r.reference=current_setting('t.ref')),0::bigint,
 'Bank transfer: the clearing account received the gross; no Cafetería obligation');
select is(pg_temp.decide(current_setting('t.ref'),'approve',null,'fin2-decide-approve-0001'),current_setting('t.post')::jsonb,'43. Approval replay returns the original result');
select is(pg_temp.bal(),current_setting('t.b1')::bigint+194000,'42. Replay cannot double-credit');
select is(pg_temp.attempt($$select pg_temp.decide(current_setting('t.ref'),'approve',null,'fin2-decide-approve-0003')$$),'23514:REQUEST_ALREADY_DECIDED','A posted request cannot be decided again');

-- ── 23–26. Scenario 3: cash at the Cafetería ───────────────────────────────────────────────────
select set_config('t.b2',pg_temp.bal()::text,true);
select set_config('t.cash',pg_temp.cash(200000,'fin2-cash-request-0001')::text,true);
select set_config('t.cref',current_setting('t.cash')::jsonb->>'reference',true);
select is(current_setting('t.cash')::jsonb->>'state','posted','Cash collection posts atomically');
select is(pg_temp.bal(),current_setting('t.b2')::bigint+194000,'26. Scenario 3: wallet receives RD$ 1,940');
select is((select collecting_cafeteria_id::text from replenishment_requests where reference=current_setting('t.cref')),'00000000-0000-0000-0000-000000000111','23. The collecting Cafetería is recorded');
select is(pg_temp.entries(current_setting('t.cref'),'replenishment_fee_earned'),6000::bigint,'25. Fee recorded separately');
select is((select o.reason||':'||o.amount_minor||':'||d.kind||'>'||c.kind from financial_obligations o join financial_parties d on d.id=o.debtor_party_id join financial_parties c on c.id=o.creditor_party_id
  join financial_entries e on e.id=o.source_entry_id join replenishment_requests r on r.id=e.replenishment_request_id where r.reference=current_setting('t.cref')),
 'cash_collection:200000:cafeteria>clearing','24. Cafetería → clearing obligation for the full gross RD$ 2,000');
select is((select extract(isodow from settlement_week_start)::int||':'||(settlement_due_on-settlement_week_start) from financial_obligations limit 1),'1:8','Settlement week starts Monday; due the following Tuesday');
select is(pg_temp.cash(200000,'fin2-cash-request-0001'),current_setting('t.cash')::jsonb,'Cash replay returns the original result');

-- ── 27–30. Scenario 4: wallet purchase ─────────────────────────────────────────────────────────
select set_config('t.b3',pg_temp.bal()::text,true);
select set_config('t.fees',(select count(*)::text from financial_entries where entry_type='replenishment_fee_earned'),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.p',pg_temp.sale('fin2-wallet-sale-000001',10)::text,true);
reset role;
select is(pg_temp.bal(),current_setting('t.b3')::bigint-50000,'Scenario 4: wallet −RD$ 500');
select is((pg_temp.purchase_obligation(current_setting('t.p')::uuid)).amount_minor,50000::bigint,'28. Obligation = wallet tender RD$ 500');
select is((select d.kind||'>'||c.kind||':'||o.reason from financial_obligations o join financial_parties d on d.id=o.debtor_party_id join financial_parties c on c.id=o.creditor_party_id
  where o.id=(pg_temp.purchase_obligation(current_setting('t.p')::uuid)).id),'clearing>cafeteria:wallet_purchase_fulfillment','27. Clearing → fulfilling Cafetería obligation');
select is((select count(*)::text from financial_entries where entry_type='replenishment_fee_earned'),current_setting('t.fees'),'29. No replenishment fee at purchase');
-- 30. Atomicity: if the accounting side-effect fails, the purchase does not exist.
create function pg_temp.fail_obligation() returns trigger language plpgsql as $$begin if new.amount_minor=35000 then raise exception 'forced obligation failure'; end if; return new; end$$;
create trigger fin2_test_fail before insert on financial_obligations for each row execute function pg_temp.fail_obligation();
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select ok(pg_temp.attempt($$select pg_temp.sale('fin2-wallet-sale-failing',7)$$) like '%forced obligation failure%','30. Purchase fails when its obligation fails');
reset role; drop trigger fin2_test_fail on financial_obligations;
select is((select count(*) from purchases where request_key='fin2-wallet-sale-failing'),0::bigint,'30. No partial purchase');
select is(pg_temp.bal(),current_setting('t.b3')::bigint-50000,'30. Wallet unchanged by the failed purchase');

-- ── 31–33. Scenario 5: wallet refund RD$ 200 ───────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.appr',(issue_purchase_item_refund_approval(current_setting('t.sid')::uuid,current_setting('t.p')::uuid,pg_temp.items(current_setting('t.p')::uuid,4),'wrong_product',null,'fin2-refund-approval-001')->>'approval_id'),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select lives_ok($$select create_purchase_item_refund(current_setting('t.sid')::uuid,current_setting('t.p')::uuid,pg_temp.items(current_setting('t.p')::uuid,4),'wrong_product',null,'fin2-wallet-refund-0001',current_setting('t.appr')::uuid)$$,
 'Wallet refund of 4 items');
reset role;
select is(pg_temp.bal(),current_setting('t.b3')::bigint-30000,'Scenario 5: wallet +RD$ 200');
select is((select o.reason||':'||o.amount_minor||':'||d.kind||'>'||c.kind from financial_obligations o join financial_parties d on d.id=o.debtor_party_id join financial_parties c on c.id=o.creditor_party_id
  where o.corrects_obligation_id=(pg_temp.purchase_obligation(current_setting('t.p')::uuid)).id),'wallet_refund_correction:20000:cafeteria>clearing','31/33. Counter-obligation RD$ 200, opposite direction');
select is((pg_temp.purchase_obligation(current_setting('t.p')::uuid)).amount_minor,50000::bigint,'32. Original obligation unchanged');

-- ── 34–41. Reversals ───────────────────────────────────────────────────────────────────────────
-- Scenario 6: the cash replenishment reverses while the wallet still holds RD$ 1,940.
select set_config('t.cash_rep',(select wallet_replenishment_id::text from replenishment_requests where reference=current_setting('t.cref')),true);
select set_config('t.b4',pg_temp.bal()::text,true);
select set_config('t.rv',pg_temp.freverse(current_setting('t.cref'),'f2000000-0000-4000-8000-0000000000c1')::text,true);
select is(pg_temp.bal(),current_setting('t.b4')::bigint-194000,'34/35. Scenario 6: reversal removes the net RD$ 1,940');
select is(pg_temp.entries(current_setting('t.cref'),'replenishment_fee_reversed')||'/'||pg_temp.entries(current_setting('t.cref'),'stored_value_cancelled')||'/'||pg_temp.entries(current_setting('t.cref'),'replenishment_gross_reversed'),
 '6000/194000/200000','36. Fee, net and gross countered');
select is((select o.reason||':'||o.amount_minor||':'||d.kind||'>'||c.kind from financial_obligations o join financial_parties d on d.id=o.debtor_party_id join financial_parties c on c.id=o.creditor_party_id
  where o.reason='cash_collection_reversal'),'cash_collection_reversal:200000:clearing>cafeteria','37. Cash obligation corrected by a counter-obligation');
select is(pg_temp.entries(current_setting('t.cref'),'replenishment_fee_earned'),6000::bigint,'38. Original fee event remains');
select is(pg_temp.freverse(current_setting('t.cref'),'f2000000-0000-4000-8000-0000000000c1'),current_setting('t.rv')::jsonb,'39. Reversal replay returns the same result');
select is(pg_temp.attempt($$select pg_temp.freverse(current_setting('t.cref'),'f2000000-0000-4000-8000-0000000000c2')$$),'23514:REPLENISHMENT_ALREADY_REVERSED','39. Second reversal refused');
-- Scenario 7: after spending, the remaining balance is below the net credit → blocked, nothing changes.
reset role;
select set_config('t.c7',pg_temp.cash(10000,'fin2-cash-request-0007')->>'reference',true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002'); select pg_temp.adjust(-(pg_temp.bal()-5000),'f2000000-0000-4000-8000-0000000000a3');
reset role; select set_config('t.b5',pg_temp.bal()::text,true);
select set_config('t.c7rep',(select wallet_replenishment_id::text from replenishment_requests where reference=current_setting('t.c7')),true);
select set_config('t.ent',(select count(*)::text from financial_entries),true);
select is(pg_temp.attempt($$select pg_temp.freverse(current_setting('t.c7'),'f2000000-0000-4000-8000-0000000000c7')$$),'23514:FINANCIAL_RESOLUTION_REQUIRED','40. Scenario 7: fee-era reversal blocked (RD$ 50 left < RD$ 97 net)');
select is(pg_temp.bal(),current_setting('t.b5')::bigint,'Scenario 7: wallet unchanged by the failed reversal');
select is((select count(*)::text from financial_entries),current_setting('t.ent'),'Scenario 7: no partial financial mutation');
select is((select count(*) from wallet_replenishment_reversals where replenishment_id=current_setting('t.c7rep')::uuid),0::bigint,'Scenario 7: no reversal record');
select ok(exists(select 1 from financial_entries e join wallet_adjustments a on a.id=e.wallet_adjustment_id where a.idempotency_key='f2000000-0000-4000-8000-0000000000a3' and e.entry_type='adjustment_stored_value_reduction'),
 'Adjustments of an activated customer are recorded as stored-value events');
-- 41. A pre-activation (legacy) replenishment keeps legacy reversal behaviour after activation.
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select lives_ok($$select pg_temp.reverse(current_setting('t.legacy')::uuid,'f2000000-0000-4000-8000-0000000000d1')$$,'41. Legacy replenishment reverses as before');
reset role; select ok(pg_temp.bal() < 0,'41. Legacy reversal may still go negative');
select is((select string_agg(entry_type||':'||amount_minor,',') from financial_entries where wallet_replenishment_reversal_id=(select id from wallet_replenishment_reversals where replenishment_id=current_setting('t.legacy')::uuid)),
 'legacy_stored_value_reversed:200000','41. A legacy reversal after activation records only the removed wallet value (no fee, no obligation)');

-- ── Reconciliation: wallets = opening + issued + restored + funded adjustments − redeemed − cancelled − reductions ─
select is((select sum(current_balance_minor) from student_wallets where account_id='00000000-0000-0000-0000-000000000001'),
 (select (current_setting('t.act')::jsonb->>'opening_stored_value_minor')::numeric
   + coalesce(sum(amount_minor) filter (where entry_type in ('stored_value_issued','stored_value_restored','clearing_funded_adjustment')),0)
   - coalesce(sum(amount_minor) filter (where entry_type in ('stored_value_redeemed','stored_value_cancelled','adjustment_stored_value_reduction','legacy_stored_value_reversed')),0)
   from financial_entries where account_id='00000000-0000-0000-0000-000000000001'),
 'Reconciliation: activated customer wallet balances = opening snapshot + stored-value events, exactly');
select is((select count(*) from replenishment_requests r where r.state='posted' and r.gross_minor<>pg_temp.entries(r.reference,'replenishment_fee_earned')+pg_temp.entries(r.reference,'stored_value_issued')),0::bigint,
 'Reconciliation: every posted request has gross = fee + net in its events');

-- ── 47–51. Security ────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt(format($$select platform_finance_replenishment_read(%L)$$,current_setting('t.ref'))),'42501:not_authorized','47. School cannot use Platform finance reads');
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d01');
select is(pg_temp.attempt(format($$select platform_finance_replenishment_read(%L)$$,current_setting('t.ref'))),'42501:not_authorized','49. Platform Admin without finance authority cannot read');
select is(pg_temp.attempt(format($$select platform_finance_decide_bank_replenishment(%L,'approve',null,'fin2-wrapper-key-0001')$$,current_setting('t.rej'))),'42501:not_authorized','50. Ungranted verify capability is unusable');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt($$select cafeteria_financial_obligations_read('00000000-0000-0000-0000-000000000111')$$),'42501:finance_authority_required','50. Settlement grants the obligations read to Cafetería Admin only: a School Admin is refused');
select is(pg_temp.attempt($$select count(*) from financial_obligations$$),'42501:permission denied for table financial_obligations','No direct table read');
-- Transient, rolled-back grants prove scoping once FIN 3/4 grant these capabilities.
reset role;
insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values('cafeteria','cafeteria_admin','cafeteria:finance:obligations:read') on conflict do nothing;
insert into pikas_private.platform_role_capabilities(role_code,capability) values('platform_admin','platform:finance:read');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok(jsonb_array_length(cafeteria_financial_obligations_read('00000000-0000-0000-0000-000000000111')->'obligations')>=4,'With the capability, a Cafetería reads its own obligations');
select is(pg_temp.attempt($$select cafeteria_financial_obligations_read('00000000-0000-0000-0000-000000000112')$$),'42501:finance_authority_required','48. A Cafetería cannot read another Cafetería''s obligations');
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d01');
select is(platform_finance_replenishment_read(current_setting('t.ref'))->>'net_minor','194000','With finance read, Platform sees one replenishment explained');
select ok(platform_finance_replenishment_read(current_setting('t.ref'))::text !~ '"(account_id|student_id|wallet_id|submitted_by)"','The read carries no internal people or wallet identifiers');
reset role;
insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,expires_at)
 select gen_random_uuid(),'00000000-0000-0000-0000-0000000f2e01','00000000-0000-0000-0000-0000000f2d01',p.account_id,p.school_id,p.cafeteria_id,'cashier',p.id,p.person_id,p.cafeteria_membership_id,clock_timestamp()+interval '1 hour'
 from pikas_private.sandbox_pov_personas p where p.pov_code='cashier' limit 1;
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d01');
select is(pg_temp.attempt(format($$select platform_finance_replenishment_read(%L)$$,current_setting('t.ref'))),'42501:finance_authority_required','51. A sandbox POV does not reach finance data, even with the capability');
reset role;

-- ── 52–54. Immutability ────────────────────────────────────────────────────────────────────────
select ok(pg_temp.attempt($$update financial_entries set amount_minor=1$$) = '23514:wallet_financial_history_is_immutable','52. Financial events cannot be updated');
select ok(pg_temp.attempt($$delete from financial_entries$$) = '23514:wallet_financial_history_is_immutable','52. Financial events cannot be deleted');
select ok(pg_temp.attempt($$update financial_obligations set amount_minor=1$$) = '23514:wallet_financial_history_is_immutable','53. Obligations cannot be edited');
select ok(pg_temp.attempt($$delete from financial_obligations$$) = '23514:wallet_financial_history_is_immutable','53. Obligations cannot be deleted');
select is(pg_temp.attempt(format($$insert into financial_obligations(account_id,school_id,cafeteria_id,currency_code,reason,debtor_party_id,creditor_party_id,amount_minor,source_entry_id,corrects_obligation_id,settlement_week_start,settlement_due_on)
  select o.account_id,o.school_id,o.cafeteria_id,o.currency_code,'wallet_refund_correction',o.creditor_party_id,o.debtor_party_id,40000,e.id,o.id,o.settlement_week_start,o.settlement_due_on
  from financial_obligations o, financial_entries e where o.id=%L and e.entry_type='replenishment_fee_earned' limit 1$$,(pg_temp.purchase_obligation(current_setting('t.p')::uuid)).id)),
 '23514:OBLIGATION_CORRECTION_EXCEEDS_ORIGINAL','54. Corrections are additive and can never exceed the original');
select is(pg_temp.attempt($$update financial_fee_policies set status='retired', retired_at=now()$$),'ok','A policy can be retired (rate stays fixed)');

select * from finish();
rollback;
