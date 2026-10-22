-- PIKAS FIN 2 owner refinement (202611100001). Fictional local fixtures only; everything rolls back.
-- Foundation fixtures: account 1 / school 11 / students 5201 (wallet 7001) and 5202 (no wallet) / Cafetería 111 /
-- customer 6901 / product 8101 at RD$ 50 / register 9401 (cashier 2008, assignment 9501) / supervisor 2011.
-- Personas: 2002 School Admin (account 1). Account 2 has no wallets.
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
create function pg_temp.bal(w text default '00000000-0000-0000-0000-000000007001') returns bigint language sql as $$select current_balance_minor from student_wallets where id=w::uuid$$;
create function pg_temp.legacy_credit(student text,amount bigint,key uuid) returns uuid language sql as $$
 select (school_wallet_replenish('00000000-0000-0000-0000-000000000011',student::uuid,amount,key,'Ref local','Verificado')->>'replenishment_id')::uuid$$;
create function pg_temp.reverse(student text,rep uuid,key uuid) returns jsonb language sql as $$
 select school_wallet_reverse_replenishment('00000000-0000-0000-0000-000000000011',student::uuid,rep,'wrong_amount',null,key)$$;
create function pg_temp.adjust(amount bigint,key uuid,student text default '00000000-0000-0000-0000-000000005201') returns jsonb language sql as $$
 select school_wallet_adjust('00000000-0000-0000-0000-000000000011',student::uuid,amount,
  case when amount>0 then 'authorized_credit' else 'authorized_debit' end,'Ajuste ficticio FIN 2',key)$$;
create function pg_temp.sale(key text,qty integer) returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',current_setting('t.sid'),
 'cafeteria_customer_id','00000000-0000-0000-0000-000000006901','items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',qty,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor',(5000*qty)::text,
 'tender',jsonb_build_object('type','student_wallet')))->>'purchase_id')::uuid$$;
create function pg_temp.items(p uuid,qty integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('purchase_item_id',(select id from purchase_items where purchase_id=p),'quantity',qty))$$;
create function pg_temp.refund(p uuid,qty integer,key text) returns void language plpgsql as $$declare a text; begin
 perform pg_temp.as_user('00000000-0000-0000-0000-000000002011');
 a:=issue_purchase_item_refund_approval(current_setting('t.sid')::uuid,p,pg_temp.items(p,qty),'wrong_product',null,key||'-approval')->>'approval_id';
 perform pg_temp.as_user('00000000-0000-0000-0000-000000002008');
 perform create_purchase_item_refund(current_setting('t.sid')::uuid,p,pg_temp.items(p,qty),'wrong_product',null,key,a::uuid);
 execute 'reset role'; end$$;
create function pg_temp.activate(account text,key text) returns jsonb language sql as $$
 select pikas_private.finance_activate_customer(account::uuid,1,'Piloto ficticio FIN 2',key)$$;
create function pg_temp.bank(student text,gross bigint,key text) returns text language sql as $$
 select pikas_private.finance_submit_bank_replenishment(current_setting('t.op_person')::uuid,'platform_operator','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',student::uuid,gross,'BANCO-REF-0001','Madre ficticia',null,'WhatsApp 22/10 10:02',key)->>'reference'$$;
create function pg_temp.approve(ref text,key text) returns jsonb language sql as $$
 select pikas_private.finance_decide_bank_replenishment((select id from replenishment_requests where reference=ref),current_setting('t.op_person')::uuid,'approve',null,key)$$;
create function pg_temp.cash(gross bigint,key text) returns text language sql as $$
 select pikas_private.finance_post_cash_replenishment((select id from persons where auth_user_id='00000000-0000-0000-0000-000000002008'),
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000006901',gross,'Padre ficticio',key)->>'reference'$$;
create function pg_temp.wrep(ref text) returns uuid language sql as $$select wallet_replenishment_id from replenishment_requests where reference=ref$$;
create function pg_temp.entry_total(t text) returns bigint language sql as $$
 select coalesce(sum(amount_minor),0)::bigint from financial_entries where account_id='00000000-0000-0000-0000-000000000001' and entry_type=t$$;
create function pg_temp.counts() returns text language sql as $$
 select (select count(*) from financial_entries)||'/'||(select count(*) from financial_obligations)||'/'||(select count(*) from wallet_replenishment_reversals)
  ||'/'||(select count(*) from wallet_ledger_entries)||'/'||(select count(*) from audit_events)$$;

-- Fictional Platform people: f2d01 is a Platform Admin without finance authority; f2d02 holds only a
-- fictional role granted platform:finance:replenishments:reverse inside this transaction.
reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000f2d01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin2.operador@example.invalid','',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-0000000f2d02','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin2.finanzas@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values
 ('00000000-0000-0000-0000-0000000f2e01','00000000-0000-0000-0000-0000000f2d01','Operadora FIN 2 ficticia'),
 ('00000000-0000-0000-0000-0000000f2e02','00000000-0000-0000-0000-0000000f2d02','Finanzas FIN 2 ficticia');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-0000000f2e01','platform_admin');
select set_config('t.op_person','00000000-0000-0000-0000-0000000f2e01',true);

-- ── Capability ─────────────────────────────────────────────────────────────────────────────────
select ok(exists(select 1 from pikas_private.platform_capabilities where capability='platform:finance:replenishments:reverse'),'A4. Finance reversal capability is catalogued');
select is((select count(*) from pikas_private.platform_role_capabilities where capability='platform:finance:replenishments:reverse'),0::bigint,'A4. It is granted to no Platform role (not Edwin, not Platform Admin)');
select is((select count(*) from pikas_private.role_capabilities where capability like '%finance%'),0::bigint,'No tenant role holds any finance capability');
select ok(not has_function_privilege('authenticated','pikas_private.finance_reverse_replenishment(uuid,uuid,text,text,text)','execute'),'The reversal primitive is not client-callable');

-- ── Pre-activation (legacy) history on account 1 ───────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',1000,'fin2r-open-cashier-01')),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select pg_temp.legacy_credit('00000000-0000-0000-0000-000000005201',5000000,'f2b00000-0000-4000-8000-000000000001');
select set_config('t.l1',pg_temp.legacy_credit('00000000-0000-0000-0000-000000005201',3000,'f2b00000-0000-4000-8000-000000000002')::text,true);
reset role; select set_config('t.lb',pg_temp.bal()::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select pg_temp.adjust(1000,'f2b00000-0000-4000-8000-0000000000a1'); select pg_temp.adjust(-1000,'f2b00000-0000-4000-8000-0000000000a2');
reset role;
select is(pg_temp.bal(),current_setting('t.lb')::bigint,'D12. Legacy adjustments behave as before (+1,000 / −1,000)');
select is((select count(*) from financial_entries),0::bigint,'D13. No financial events for a legacy customer''s adjustments');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.p0',pg_temp.sale('fin2r-legacy-sale-0001',2)::text,true);
reset role;

-- ── Opening liability: negative-only and zero customers (savepoint, rolled back) ───────────────
savepoint opening_edge;
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select pg_temp.adjust(-(pg_temp.bal()-1000),'f2b00000-0000-4000-8000-0000000000a3');
select pg_temp.reverse('00000000-0000-0000-0000-000000005201',current_setting('t.l1')::uuid,'f2b00000-0000-4000-8000-0000000000b1');
reset role;
select is(pg_temp.bal(),-2000::bigint,'Edge: the only DOP wallet is negative (−RD$ 20) before activation');
select set_config('t.neg',pg_temp.activate('00000000-0000-0000-0000-000000000001','fin2r-activate-negative-01')::text,true);
select is((current_setting('t.neg')::jsonb->>'opening_legacy_liability_minor')||'/'||(current_setting('t.neg')::jsonb->>'opening_negative_balance_minor')||'/'||(current_setting('t.neg')::jsonb->>'opening_stored_value_minor'),
 '0/2000/-2000','Negative balances are recorded on the activation, not as liability');
select is((select count(*) from financial_entries),0::bigint,'No opening money event when the positive liability is zero');
select lives_ok($$select pg_temp.activate('00000000-0000-0000-0000-000000000002','fin2r-activate-zero-0001')$$,'C1. A customer with no wallet value activates');
select is((select opening_legacy_liability_minor||'/'||opening_wallet_count from customer_financial_activations where account_id='00000000-0000-0000-0000-000000000002'),'0/0','C1. Zero opening liability');
select is((select count(*) from financial_entries),0::bigint,'C1. No zero-value financial event');
rollback to savepoint opening_edge;

-- ── Activation with positive legacy value (and a wallet in another currency) ───────────────────
insert into supported_currencies(currency_code,minor_unit_exponent,status) values('USD',2,'enabled') on conflict do nothing;
insert into student_wallets(account_id,school_id,student_id,currency_code,current_balance_minor)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201','USD',7700);
select is((select count(*) from student_wallets where account_id='00000000-0000-0000-0000-000000000001' and currency_code='DOP'),1::bigint,'Student 5202 has no wallet before activation');
create temp table pre_ledger as select * from wallet_ledger_entries;
create temp table pre_wallets as select id,current_balance_minor,balance_version from student_wallets;
select set_config('t.dop',(select sum(current_balance_minor)::text from student_wallets where account_id='00000000-0000-0000-0000-000000000001' and currency_code='DOP'),true);
select set_config('t.act',pg_temp.activate('00000000-0000-0000-0000-000000000001','fin2r-activate-account1-01')::text,true);
select is((select string_agg(entry_type||':'||amount_minor||':'||currency_code,',') from financial_entries),
 'opening_legacy_stored_value_liability:'||current_setting('t.dop')||':DOP','C2. One opening legacy-liability event = the exact positive DOP stored value');
select is((select e.customer_financial_activation_id::text||'|'||coalesce(e.school_id::text,'-')||'|'||(e.occurred_at=a.activated_at) from financial_entries e join customer_financial_activations a on a.id=e.customer_financial_activation_id),
 (current_setting('t.act')::jsonb->>'activation_id')||'|-|true','C2. The event references its activation, is account-level and dated at activation');
select is(current_setting('t.act')::jsonb->>'opening_legacy_liability_minor',current_setting('t.dop'),'C4. The USD wallet (RD$ policy) is not aggregated');
select is((select count(*) from financial_entries where entry_type in ('replenishment_fee_earned','replenishment_gross_collected','stored_value_issued'))
 +(select count(*) from replenishment_requests)+(select count(*) from financial_obligations),0::bigint,'C2. No fee, no collection, no replenishment, no obligation');
select is((select count(*) from student_wallets w join pre_wallets p using(id) where (w.current_balance_minor,w.balance_version)<>(p.current_balance_minor,p.balance_version)),0::bigint,'C2. Wallet balances unchanged');
select is((select count(*) from wallet_ledger_entries),(select count(*) from pre_ledger),'C2. Wallet ledgers unchanged');
select is(pg_temp.activate('00000000-0000-0000-0000-000000000001','fin2r-activate-account1-01'),current_setting('t.act')::jsonb,'C3. Activation replay returns the original result');
select is((select count(*) from financial_entries where entry_type='opening_legacy_stored_value_liability'),1::bigint,'C3. Replay cannot duplicate the opening liability');

-- ── Fee-era replenishment and positive adjustment ──────────────────────────────────────────────
select set_config('t.bank',pg_temp.bank('00000000-0000-0000-0000-000000005201',200000,'fin2r-bank-request-0001'),true);
select pg_temp.approve(current_setting('t.bank'),'fin2r-bank-approve-0001');
select set_config('t.b1',pg_temp.bal()::text,true);
select set_config('t.c1',pg_temp.counts(),true);
-- Positive value for an activated customer is a Platform finance operation (202611110001).
select pikas_private.finance_fund_wallet_adjustment('00000000-0000-0000-0000-000000005201',current_setting('t.op_person')::uuid,100000,'administrative_correction',
 'Corrección financiada ficticia','f2b00000-0000-4000-8000-0000000000a4');
select is(pg_temp.bal(),current_setting('t.b1')::bigint+100000,'B1. Positive adjustment adds exactly RD$ 1,000');
select is((select l.amount_minor||':'||l.balance_after_minor from wallet_ledger_entries l join wallet_adjustments a on a.id=l.adjustment_id where a.idempotency_key='f2b00000-0000-4000-8000-0000000000a4'),
 '100000:'||pg_temp.bal(),'B2. Wallet ledger records the adjustment');
select is((select e.entry_type||':'||e.amount_minor||':'||p.kind from financial_entries e join financial_parties p on p.id=e.funding_party_id join wallet_adjustments a on a.id=e.wallet_adjustment_id
  where a.idempotency_key='f2b00000-0000-4000-8000-0000000000a4'),'clearing_funded_adjustment:100000:clearing','B3. Financial event: value funded by clearing');
select is((select count(*) from financial_entries e join wallet_adjustments a on a.id=e.wallet_adjustment_id where a.idempotency_key='f2b00000-0000-4000-8000-0000000000a4'),1::bigint,'B4/B5. One event only: no fee, no collection');
select is((select count(*) from replenishment_requests)||'/'||(select count(*) from wallet_replenishments where financial_request_id is not null),'1/1','B5. No fake replenishment');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.p1',pg_temp.sale('fin2r-wallet-sale-0001',4)::text,true);
reset role;
select is((select o.reason||':'||o.amount_minor from financial_obligations o join financial_entries e on e.id=o.source_entry_id join wallet_purchase_debits d on d.id=e.wallet_purchase_debit_id
  where d.purchase_id=current_setting('t.p1')::uuid),'wallet_purchase_fulfillment:20000','B6. The later purchase creates the normal Cafetería payable');

-- ── Negative adjustment ────────────────────────────────────────────────────────────────────────
select set_config('t.b2',pg_temp.bal()::text,true);
select set_config('t.f2',(pg_temp.entry_total('replenishment_fee_earned'))::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select pg_temp.adjust(-30000,'f2b00000-0000-4000-8000-0000000000a5');
reset role;
select is(pg_temp.bal(),current_setting('t.b2')::bigint-30000,'B8. Negative adjustment removes RD$ 300');
select is((select e.entry_type||':'||e.amount_minor||':'||p.kind from financial_entries e join financial_parties p on p.id=e.funding_party_id join wallet_adjustments a on a.id=e.wallet_adjustment_id
  where a.idempotency_key='f2b00000-0000-4000-8000-0000000000a5'),'adjustment_stored_value_reduction:30000:clearing','B9. Stored-value liability reduction recorded');
select is(pg_temp.entry_total('replenishment_fee_earned')::text,current_setting('t.f2'),'B10. No fee from adjustments');
select is((select count(*) from financial_obligations o join financial_entries e on e.id=o.source_entry_id where e.wallet_adjustment_id is not null),0::bigint,'B11. No collection or payout obligation from adjustments');

-- ── Refunds: post-activation purchase and pre-activation purchase ──────────────────────────────
select pg_temp.refund(current_setting('t.p1')::uuid,1,'fin2r-refund-after-001');
select is((select o.reason||':'||o.amount_minor from financial_obligations o where o.corrects_obligation_id is not null and o.reason='wallet_refund_correction'),
 'wallet_refund_correction:5000','Refund corrects the prior Cafetería payable');
select pg_temp.refund(current_setting('t.p0')::uuid,1,'fin2r-refund-legacy-01');
select is((select o.reason||':'||o.amount_minor||':'||d.kind||'>'||c.kind||':'||(o.corrects_obligation_id is null) from financial_obligations o
  join financial_parties d on d.id=o.debtor_party_id join financial_parties c on c.id=o.creditor_party_id where o.reason='legacy_purchase_refund'),
 'legacy_purchase_refund:5000:cafeteria>clearing:true','Refund of a pre-activation purchase: the Cafetería returns the value to clearing');

-- ── Reversal authority ─────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select lives_ok($$select pg_temp.reverse('00000000-0000-0000-0000-000000005201',current_setting('t.l1')::uuid,'f2b00000-0000-4000-8000-0000000000b2')$$,'A1. School still reverses a legacy replenishment');
reset role;
select is((select string_agg(e.entry_type||':'||e.amount_minor,',') from financial_entries e join wallet_replenishment_reversals v on v.id=e.wallet_replenishment_reversal_id where v.replenishment_id=current_setting('t.l1')::uuid),
 'legacy_stored_value_reversed:3000','A1. Legacy reversal after activation records the removed value');
select set_config('t.cash',pg_temp.cash(100000,'fin2r-cash-request-0001'),true);
select set_config('t.c2',pg_temp.counts(),true); select set_config('t.b3',pg_temp.bal()::text,true);
select set_config('t.cash_rep',pg_temp.wrep(current_setting('t.cash'))::text,true); select set_config('t.bank_rep',pg_temp.wrep(current_setting('t.bank'))::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt(format($$select pg_temp.reverse('00000000-0000-0000-0000-000000005201',%L,'f2b00000-0000-4000-8000-0000000000b3')$$,current_setting('t.cash_rep'))),
 '42501:finance_reversal_authority_required','A2. School cannot reverse a fee-era replenishment');
select is(pg_temp.attempt(format($$select pg_temp.reverse('00000000-0000-0000-0000-000000005201',%L,'f2b00000-0000-4000-8000-0000000000b4')$$,current_setting('t.bank_rep'))),
 '42501:finance_reversal_authority_required','A2. Nor a verified bank-transfer replenishment');
reset role;
select is(pg_temp.counts()||'|'||pg_temp.bal(),current_setting('t.c2')||'|'||current_setting('t.b3'),'A2. Refused attempts change nothing');
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d01');
select is(pg_temp.attempt(format($$select platform_finance_reverse_replenishment(%L,'wrong_amount',null,'fin2r-reverse-admin-01')$$,current_setting('t.cash'))),
 '42501:not_authorized','A3. Platform Admin without the capability cannot reverse');
reset role;
select is(pg_temp.attempt($$insert into wallet_replenishment_reversals(account_id,school_id,wallet_id,student_id,replenishment_id,currency_code,amount_minor,reason,actor_person_id,actor_role,request_key,payload_fingerprint,reversed_at)
  select r.account_id,r.school_id,r.wallet_id,'00000000-0000-0000-0000-000000005201',r.id,r.currency_code,r.amount_minor,'wrong_amount','00000000-0000-0000-0000-0000000f2e01','school_admin','fin2r-direct-row-0001',repeat('0',64),clock_timestamp()
  from wallet_replenishments r where r.id=pg_temp.wrep(current_setting('t.cash'))$$),'42501:finance_reversal_authority_required','A2. The table itself refuses a tenant-role fee-era reversal');
-- A5. A fictional Platform role explicitly granted only the reversal capability.
insert into pikas_private.platform_roles(role_code) values('fin2_ficticio_reversiones');
insert into pikas_private.platform_role_capabilities(role_code,capability) values('fin2_ficticio_reversiones','platform:finance:replenishments:reverse');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-0000000f2e02','fin2_ficticio_reversiones');
select set_config('t.f3',(pg_temp.entry_total('replenishment_fee_reversed'))::text,true);
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d02');
select set_config('t.rv',platform_finance_reverse_replenishment(current_setting('t.cash'),'wrong_amount',null,'fin2r-reverse-finance-01')::text,true);
select is(current_setting('t.rv')::jsonb->>'state','reversed','A5. A role granted the capability reverses a valid fee-era replenishment');
select ok(current_setting('t.rv')::text !~ '"(wallet_id|student_id|account_id|reversal_id)"','A5. The result carries no internal identifiers');
select is(platform_finance_reverse_replenishment(current_setting('t.cash'),'wrong_amount',null,'fin2r-reverse-finance-01'),current_setting('t.rv')::jsonb,'Replay returns the original result');
select is(pg_temp.attempt(format($$select platform_finance_reverse_replenishment(%L,'wrong_amount','Otra nota','fin2r-reverse-finance-01')$$,current_setting('t.cash'))),'23505:IDEMPOTENCY_CONFLICT','Same key, different body fails');
select is(pg_temp.attempt(format($$select platform_finance_reverse_replenishment(%L,'wrong_amount',null,'fin2r-reverse-finance-02')$$,current_setting('t.cash'))),'23514:REPLENISHMENT_ALREADY_REVERSED','Second reversal refused');
-- A6. No tenant/customer wallet authority and no other finance authority.
select is(pg_temp.attempt(format($$select pg_temp.reverse('00000000-0000-0000-0000-000000005201',%L,'f2b00000-0000-4000-8000-0000000000b5')$$,current_setting('t.l1'))),'42501:school_authority_required','A6. No School reversal authority');
select is(pg_temp.attempt($$select pg_temp.adjust(100,'f2b00000-0000-4000-8000-0000000000a6')$$),'42501:school_authority_required','A6. No wallet adjustment authority');
select is(pg_temp.attempt($$select pg_temp.legacy_credit('00000000-0000-0000-0000-000000005201',100,'f2b00000-0000-4000-8000-000000000003')$$),'42501:school_authority_required','A6. No School replenishment authority');
select is(pg_temp.attempt($$select school_wallet_read('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201')$$),'42501:school_authority_required','A6. No School wallet read');
select is(pg_temp.attempt(format($$select platform_finance_replenishment_read(%L)$$,current_setting('t.cash'))),'42501:not_authorized','A6. No finance read or verification by implication');
reset role;
select is(pg_temp.entry_total('replenishment_fee_reversed')-current_setting('t.f3')::bigint,3000::bigint,'Full reversal also reverses the RD$ 30 fee');
select is((select o.reason||':'||o.amount_minor from financial_obligations o join financial_entries e on e.id=o.source_entry_id join replenishment_requests r on r.id=e.replenishment_request_id
  where r.reference=current_setting('t.cash') and o.corrects_obligation_id is not null),'cash_collection_reversal:100000','Cash obligation corrected');
select is((select actor_role||':'||actor_scope_kind from audit_events where action='wallet_replenishment_reversed' order by occurred_at desc limit 1),'platform_finance_operator:platform','Audit attributes the finance operator');
-- A7. Insufficient balance through the finance path: refused, nothing written.
select set_config('t.small',pg_temp.cash(10000,'fin2r-cash-request-0002'),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002'); select pg_temp.adjust(-(pg_temp.bal()-5000),'f2b00000-0000-4000-8000-0000000000a7');
reset role; select set_config('t.c3',pg_temp.counts(),true); select set_config('t.b4',pg_temp.bal()::text,true);
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d02');
select is(pg_temp.attempt(format($$select platform_finance_reverse_replenishment(%L,'wrong_amount',null,'fin2r-reverse-finance-03')$$,current_setting('t.small'))),
 '23514:FINANCIAL_RESOLUTION_REQUIRED','A7. RD$ 50 left < RD$ 97 net: FINANCIAL_RESOLUTION_REQUIRED');
reset role;
select is(pg_temp.counts()||'|'||pg_temp.bal(),current_setting('t.c3')||'|'||current_setting('t.b4'),'A7. No partial reversal, event, obligation, ledger or audit row');
-- A sandbox POV never reaches the finance operation, even with the capability (POV rows are append-only).
savepoint pov;
insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,expires_at)
 select gen_random_uuid(),'00000000-0000-0000-0000-0000000f2e02','00000000-0000-0000-0000-0000000f2d02',p.account_id,p.school_id,p.cafeteria_id,'cashier',p.id,p.person_id,p.cafeteria_membership_id,clock_timestamp()+interval '1 hour'
 from pikas_private.sandbox_pov_personas p where p.pov_code='cashier' limit 1;
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d02');
select is(pg_temp.attempt(format($$select platform_finance_reverse_replenishment(%L,'wrong_amount',null,'fin2r-reverse-finance-04')$$,current_setting('t.bank'))),
 '42501:finance_authority_required','A sandbox POV cannot reverse');
reset role;
rollback to savepoint pov;

-- ── C5. A wallet created after activation starts at zero; value arrives through a financial path ─
select set_config('t.new',pg_temp.bank('00000000-0000-0000-0000-000000005202',10000,'fin2r-bank-request-0002'),true);
select pg_temp.approve(current_setting('t.new'),'fin2r-bank-approve-0002');
select is((select string_agg(l.entry_type||':'||l.amount_minor,',') from wallet_ledger_entries l join student_wallets w on w.id=l.wallet_id where w.student_id='00000000-0000-0000-0000-000000005202'),
 'replenishment:9700','C5. The new wallet holds only its fee-era net credit');
select is((select count(*)||':'||sum(amount_minor) from financial_entries where entry_type='opening_legacy_stored_value_liability'),'1:'||current_setting('t.dop'),'C5. No new opening liability');

-- ── Reconciliation and the value-source invariant ──────────────────────────────────────────────
select is((select sum(current_balance_minor) from student_wallets where account_id='00000000-0000-0000-0000-000000000001' and currency_code='DOP'),
 (select a.opening_legacy_liability_minor - a.opening_negative_balance_minor
   + coalesce(sum(e.amount_minor) filter (where e.entry_type in ('stored_value_issued','clearing_funded_adjustment','stored_value_restored')),0)
   - coalesce(sum(e.amount_minor) filter (where e.entry_type in ('stored_value_redeemed','stored_value_cancelled','adjustment_stored_value_reduction','legacy_stored_value_reversed')),0)
   from customer_financial_activations a left join financial_entries e on e.account_id=a.account_id where a.account_id='00000000-0000-0000-0000-000000000001' and a.status='active'
   group by a.opening_legacy_liability_minor, a.opening_negative_balance_minor),
 'Wallets = opening liability − opening negatives + issued + funded adjustments + restored − redeemed − cancelled − reductions − legacy reversed');
select is(pg_temp.entry_total('opening_legacy_stored_value_liability'),(select opening_legacy_liability_minor from customer_financial_activations where account_id='00000000-0000-0000-0000-000000000001' and status='active'),
 'The opening event equals the activation''s assumed liability');
select is((select count(*) from wallet_ledger_entries l join student_wallets w on w.id=l.wallet_id
  where w.account_id='00000000-0000-0000-0000-000000000001' and l.amount_minor>0 and not exists(select 1 from pre_ledger p where p.id=l.id)
  and not exists(select 1 from financial_entries e where (e.entry_type='stored_value_issued' and e.wallet_replenishment_id=l.replenishment_id)
    or (e.entry_type='clearing_funded_adjustment' and e.wallet_adjustment_id=l.adjustment_id) or (e.entry_type='stored_value_restored' and e.wallet_refund_credit_id=l.refund_credit_id))),0::bigint,
 'Every positive wallet movement after activation has an economic event');
select is((select count(*) from financial_entries i where i.entry_type='stored_value_issued'
  and not exists(select 1 from financial_entries g where g.replenishment_request_id=i.replenishment_request_id and g.entry_type='replenishment_gross_collected')),0::bigint,'Issued value is always funded by a gross collection');
select is((select count(*) from financial_entries e where e.entry_type='stored_value_restored'
  and (select count(*) from financial_obligations o where o.source_entry_id=e.id and o.reason in ('wallet_refund_correction','legacy_purchase_refund'))<>1),0::bigint,'Restored value always carries exactly one Cafetería → clearing obligation');
select is((select count(*) from financial_entries e where e.entry_type='clearing_funded_adjustment' and e.funding_party_id<>pikas_private.clearing_party()),0::bigint,'Funded adjustments name the clearing party');
select is((select count(*) from financial_entries where entry_type='replenishment_fee_earned' and replenishment_request_id is null),0::bigint,'Fees exist only on replenishment requests (none on purchases or adjustments)');
select is((select count(*) from replenishment_requests r where r.state='posted' and r.fee_minor<>(select coalesce(sum(amount_minor),0) from financial_entries e where e.replenishment_request_id=r.id and e.entry_type='replenishment_fee_earned')),0::bigint,
 'Every posted request carries exactly its snapshotted fee');
select is((select count(*) from financial_obligations p where (select coalesce(sum(c.amount_minor),0) from financial_obligations c where c.corrects_obligation_id=p.id)>p.amount_minor),0::bigint,'Obligations reconcile: no correction exceeds its original');
select is((select count(*) from pre_ledger p join wallet_ledger_entries l using(id) where (l.amount_minor,l.balance_after_minor,l.balance_version_after)<>(p.amount_minor,p.balance_after_minor,p.balance_version_after))
  +(select count(*) from pre_ledger p where not exists(select 1 from wallet_ledger_entries l where l.id=p.id)),0::bigint,'No historical balance or ledger changes');
-- Future Platform finance reads can answer each question separately.
select is((select jsonb_build_object(
   'opening',sum(amount_minor) filter (where entry_type='opening_legacy_stored_value_liability')::text,
   'replenishment_funded',(coalesce(sum(amount_minor) filter (where entry_type='stored_value_issued'),0)-coalesce(sum(amount_minor) filter (where entry_type='stored_value_cancelled'),0))::text,
   'pikas_funded_adjustments',sum(amount_minor) filter (where entry_type='clearing_funded_adjustment')::text,
   'fee_revenue',(coalesce(sum(amount_minor) filter (where entry_type='replenishment_fee_earned'),0)-coalesce(sum(amount_minor) filter (where entry_type='replenishment_fee_reversed'),0))::text)
  from financial_entries where account_id='00000000-0000-0000-0000-000000000001'),
 jsonb_build_object('opening',current_setting('t.dop'),'replenishment_funded',(194000+9700+9700)::text,'pikas_funded_adjustments','100000','fee_revenue',(6000+300+300)::text),
 'Opening liability, replenishment-funded value, PIKAS-funded adjustments and fee revenue are separate');
select is((select jsonb_object_agg(reason,s) from (select reason,sum(amount_minor)::text s from financial_obligations where account_id='00000000-0000-0000-0000-000000000001' group by reason) x),
 jsonb_build_object('cash_collection','110000','cash_collection_reversal','100000','wallet_purchase_fulfillment','20000','wallet_refund_correction','5000','legacy_purchase_refund','5000'),
 'Collection obligations, wallet-sale payables and corrections are separate');

-- ── Immutability ───────────────────────────────────────────────────────────────────────────────
select is(pg_temp.attempt($$update financial_entries set amount_minor=1 where entry_type='opening_legacy_stored_value_liability'$$),'23514:wallet_financial_history_is_immutable','The opening liability cannot be edited');
select is(pg_temp.attempt($$delete from financial_entries where entry_type in ('clearing_funded_adjustment','adjustment_stored_value_reduction')$$),'23514:wallet_financial_history_is_immutable','Adjustment events cannot be deleted');
select is(pg_temp.attempt($$update customer_financial_activations set opening_legacy_liability_minor=0$$),'55000:ACTIVATION_IMMUTABLE','The activation snapshot cannot be edited');
select is(pg_temp.attempt($$insert into financial_entries(account_id,currency_code,entry_type,amount_minor,customer_financial_activation_id)
  select account_id,'DOP','opening_legacy_stored_value_liability',1,id from customer_financial_activations where account_id='00000000-0000-0000-0000-000000000001'$$),
 '23505:duplicate key value violates unique constraint "financial_entries_customer_financial_activation_id_key"','One opening liability per activation');
select is(pg_temp.attempt($$insert into financial_entries(account_id,school_id,currency_code,entry_type,amount_minor,wallet_adjustment_id)
  select account_id,school_id,'DOP','clearing_funded_adjustment',1,id from wallet_adjustments limit 1$$),
 '23514:new row for relation "financial_entries" violates check constraint "financial_entries_source_check"','A funded adjustment must name its funding party');

select * from finish();
rollback;
