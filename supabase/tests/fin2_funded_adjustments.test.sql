-- PIKAS FIN 2 funded adjustment authority (202611110001). Fictional local fixtures only; everything rolls back.
-- Foundation fixtures: account 1 / school 11 / student 5201 (wallet 7001) and 5202 (no wallet) / Cafetería 111 /
-- customer 6901 / product 8101 at RD$ 50 / register 9401 (cashier 2008, assignment 9501) / supervisor 2011.
-- Personas: 2001 Account Admin, 2002 School Admin (school 11), 2003 Cafeteria Admin (Cafetería 111).
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
create function pg_temp.bal() returns bigint language sql as $$select current_balance_minor from student_wallets where id='00000000-0000-0000-0000-000000007001'$$;
create function pg_temp.school_adjust(amount bigint,key uuid,student text default '00000000-0000-0000-0000-000000005201') returns jsonb language sql as $$
 select school_wallet_adjust('00000000-0000-0000-0000-000000000011',student::uuid,amount,
  case when amount>0 then 'authorized_credit' else 'authorized_debit' end,'Ajuste ficticio FIN 2',key)$$;
create function pg_temp.cafeteria_adjust(amount bigint,key uuid) returns jsonb language sql as $$
 select cafeteria_wallet_adjust('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201',amount,
  case when amount>0 then 'authorized_credit' else 'authorized_debit' end,'Ajuste ficticio FIN 2',key)$$;
create function pg_temp.older_adjust(amount bigint,key text) returns text language sql as $$
 select (post_student_wallet_adjustment('00000000-0000-0000-0000-000000007001',amount,'administrative_correction',key,'REF-FIN2',null)).status$$;
create function pg_temp.fund(amount bigint,key text,explanation text default 'Corrección financiada ficticia') returns jsonb language sql as $$
 select platform_finance_fund_wallet_adjustment('00000000-0000-0000-0000-000000005201',amount,'administrative_correction',explanation,key)$$;
create function pg_temp.sale(key text,qty integer) returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',current_setting('t.sid'),
 'cafeteria_customer_id','00000000-0000-0000-0000-000000006901','items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',qty,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor',(5000*qty)::text,
 'tender',jsonb_build_object('type','student_wallet')))->>'purchase_id')::uuid$$;
create function pg_temp.items(p uuid,qty integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('purchase_item_id',(select id from purchase_items where purchase_id=p),'quantity',qty))$$;
-- Writes that a refused adjustment must not produce.
create function pg_temp.state() returns text language sql as $$
 select (select count(*) from wallet_adjustments)||'/'||(select count(*) from wallet_ledger_entries)||'/'||(select count(*) from financial_entries)
  ||'/'||(select count(*) from financial_obligations)||'/'||(select count(*) from audit_events)||'/'||(select count(*) from student_wallets)
  ||'/'||(select string_agg(current_balance_minor||':'||balance_version,',' order by id) from student_wallets)$$;

-- Fictional Platform people: f2d01 Platform Admin (no finance authority); f2d03 holds only a fictional
-- role granted platform:finance:adjustments:fund inside this transaction.
reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000f2d01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin2.operador@example.invalid','',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-0000000f2d03','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin2.fondos@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values
 ('00000000-0000-0000-0000-0000000f2e01','00000000-0000-0000-0000-0000000f2d01','Operadora FIN 2 ficticia'),
 ('00000000-0000-0000-0000-0000000f2e03','00000000-0000-0000-0000-0000000f2d03','Fondos FIN 2 ficticia');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-0000000f2e01','platform_admin');

-- ── 12. Capability ─────────────────────────────────────────────────────────────────────────────
select ok(exists(select 1 from pikas_private.platform_capabilities where capability='platform:finance:adjustments:fund'),'12. Funded-adjustment capability is catalogued');
select is((select count(*) from pikas_private.platform_role_capabilities where capability like 'platform:finance:%'),0::bigint,'12. No Platform role holds any finance capability (not Edwin, not Platform Admin)');
select ok(not has_function_privilege('authenticated','pikas_private.finance_fund_wallet_adjustment(uuid,uuid,bigint,text,text,text)','execute')
 and not has_function_privilege('authenticated','pikas_private.guard_funded_wallet_adjustment()','execute'),'Primitive and guard are not client-callable');

-- ── 1–4. Legacy (not activated) customer: unchanged tenant behaviour ───────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',1000,'fin2f-open-cashier-01')),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',500000,'f2f00000-0000-4000-8000-000000000001','Ref local','Verificado');
reset role; select set_config('t.lb',pg_temp.bal()::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.school_adjust(1000,'f2f00000-0000-4000-8000-0000000000a1')->>'balance_after_minor',(current_setting('t.lb')::bigint+1000)::text,'1. Legacy positive School adjustment still works');
select is(pg_temp.older_adjust(400,'fin2f-older-adjust-legacy-01'),'posted','1. Legacy positive adjustment through the older path still works');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select is(pg_temp.school_adjust(-500,'f2f00000-0000-4000-8000-0000000000a2')->>'balance_after_minor',(current_setting('t.lb')::bigint+900)::text,'2. Legacy negative Account Admin adjustment still works');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.cafeteria_adjust(700,'f2f00000-0000-4000-8000-0000000000a3')->>'actor_role','cafeteria_admin','1. Legacy positive Cafetería Admin adjustment still works');
reset role;
select is(pg_temp.bal(),current_setting('t.lb')::bigint+1600,'1–2. Legacy balance moves exactly');
select is((select count(*) from financial_entries),0::bigint,'3–4. Legacy adjustments need no finance capability and create no FIN 2 events');
-- Pre-activation wallet purchase (refunded after activation below).
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.p0',pg_temp.sale('fin2f-legacy-sale-0001',3)::text,true);
reset role;
create temp table p0_before as select to_jsonb(p) j from purchases p where id=current_setting('t.p0')::uuid
 union all select to_jsonb(i) from purchase_items i where purchase_id=current_setting('t.p0')::uuid
 union all select to_jsonb(d) from wallet_purchase_debits d where purchase_id=current_setting('t.p0')::uuid;

-- ── Activation ─────────────────────────────────────────────────────────────────────────────────
select pikas_private.finance_activate_customer('00000000-0000-0000-0000-000000000001',1,'Piloto ficticio FIN 2','fin2f-activate-account1-01');
select is((select count(*) from financial_entries where entry_type='opening_legacy_stored_value_liability'),1::bigint,'Customer activated with its opening liability');
-- A pre-activation positive request replays its original result.
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.school_adjust(1000,'f2f00000-0000-4000-8000-0000000000a1')->>'amount_minor','1000','Pre-activation positive adjustment replays (no new value)');

-- ── 5–8. Activated: tenant positive adjustments refused before any write ───────────────────────
reset role; select set_config('t.s0',pg_temp.state(),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt($$select pg_temp.school_adjust(1000,'f2f00000-0000-4000-8000-0000000000b1')$$),'42501:finance_adjustment_authority_required','5. School Admin positive adjustment refused');
select is(pg_temp.attempt($$select pg_temp.older_adjust(1000,'fin2f-older-adjust-active-01')$$),'42501:finance_adjustment_authority_required','5. The older School adjustment path is refused too');
select is(pg_temp.attempt($$select pg_temp.school_adjust(1000,'f2f00000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000005202')$$),'42501:finance_adjustment_authority_required',
 '5. A positive adjustment that would open a new wallet is refused');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select is(pg_temp.attempt($$select pg_temp.school_adjust(1000,'f2f00000-0000-4000-8000-0000000000b3')$$),'42501:finance_adjustment_authority_required','6. Account Admin positive adjustment refused');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.cafeteria_adjust(1000,'f2f00000-0000-4000-8000-0000000000b4')$$),'42501:finance_adjustment_authority_required','7. Cafetería Admin positive adjustment refused');
reset role;
select is(pg_temp.state(),current_setting('t.s0'),'8. No adjustment, ledger entry, financial event, obligation, audit row or wallet was written');
select is(pg_temp.attempt($$insert into wallet_adjustments(account_id,school_id,wallet_id,currency_code,amount_minor,reason_code,status,actor_person_id,posted_at,idempotency_key,payload_fingerprint)
  select account_id,school_id,id,currency_code,100,'administrative_correction','posted','00000000-0000-0000-0000-0000000f2e01',now(),'fin2f-direct-row-0001',repeat('0',64)
  from student_wallets where id='00000000-0000-0000-0000-000000007001'$$),'42501:finance_adjustment_authority_required','The table itself refuses non-finance positive value');
-- 9–10. Negative adjustments keep their tenant authority.
select set_config('t.b1',pg_temp.bal()::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select lives_ok($$select pg_temp.school_adjust(-2000,'f2f00000-0000-4000-8000-0000000000c1')$$,'9. School negative adjustment still succeeds');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select lives_ok($$select pg_temp.cafeteria_adjust(-300,'f2f00000-0000-4000-8000-0000000000c2')$$,'9. Cafetería negative adjustment still succeeds');
reset role;
select is(pg_temp.bal(),current_setting('t.b1')::bigint-2300,'9. Wallet reduced exactly');
select is((select string_agg(e.entry_type||':'||e.amount_minor,',' order by e.amount_minor) from financial_entries e join wallet_adjustments a on a.id=e.wallet_adjustment_id
  where a.idempotency_key in ('f2f00000-0000-4000-8000-0000000000c1','f2f00000-0000-4000-8000-0000000000c2')),
 'adjustment_stored_value_reduction:300,adjustment_stored_value_reduction:2000','10. Each creates adjustment_stored_value_reduction');

-- ── 11. Ordinary Platform Admin ────────────────────────────────────────────────────────────────
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d01');
select is(pg_temp.attempt($$select pg_temp.fund(25000,'fin2f-fund-admin-00001')$$),'42501:not_authorized','11. Platform Admin cannot fund a positive adjustment');
reset role;

-- ── 13–23. Fictional role granted only platform:finance:adjustments:fund ───────────────────────
insert into pikas_private.platform_roles(role_code) values('fin2_ficticio_fondos');
insert into pikas_private.platform_role_capabilities(role_code,capability) values('fin2_ficticio_fondos','platform:finance:adjustments:fund');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-0000000f2e03','fin2_ficticio_fondos');
select set_config('t.b2',pg_temp.bal()::text,true);
select set_config('t.side',(select count(*) from replenishment_requests)||'/'||(select count(*) from wallet_replenishments)||'/'||(select count(*) from financial_obligations)
  ||'/'||(select count(*) from financial_entries where entry_type in ('replenishment_fee_earned','replenishment_gross_collected','stored_value_issued')),true);
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d03');
select set_config('t.f',pg_temp.fund(25000,'fin2f-fund-finance-0001')::text,true);
select is(current_setting('t.f')::jsonb->>'state','posted','13. Finance-authorized actor funds the positive adjustment');
select ok(current_setting('t.f')::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','23. The response contains no internal UUIDs');
select ok(current_setting('t.f')::text !~ 'balance','30. The response reveals no wallet balance');
reset role;
select is(pg_temp.bal(),current_setting('t.b2')::bigint+25000,'14. Wallet increases by exactly RD$ 250');
select is((select l.amount_minor||':'||l.balance_after_minor from wallet_ledger_entries l join wallet_adjustments a on a.id=l.adjustment_id where a.idempotency_key='fin2f-fund-finance-0001'),
 '25000:'||pg_temp.bal(),'15. Wallet ledger entry records it');
select is((select sum(amount_minor)::bigint from wallet_ledger_entries where wallet_id='00000000-0000-0000-0000-000000007001'),pg_temp.bal(),'15. Wallet ledger reconciles');
select is((select count(*)||':'||max(e.entry_type)||':'||max(e.amount_minor)||':'||max(p.kind) from financial_entries e join financial_parties p on p.id=e.funding_party_id
  join wallet_adjustments a on a.id=e.wallet_adjustment_id where a.idempotency_key='fin2f-fund-finance-0001'),'1:clearing_funded_adjustment:25000:clearing','16–17. Exactly one clearing_funded_adjustment, funded by clearing');
select is((select count(*) from replenishment_requests)||'/'||(select count(*) from wallet_replenishments)||'/'||(select count(*) from financial_obligations)
  ||'/'||(select count(*) from financial_entries where entry_type in ('replenishment_fee_earned','replenishment_gross_collected','stored_value_issued')),current_setting('t.side'),
 '18–21. No fee, replenishment, collection or Cafetería obligation');
select is((select actor_role||':'||actor_scope_kind||':'||actor_source from wallet_adjustments where idempotency_key='fin2f-fund-finance-0001'),'platform_finance_operator:platform:platform_finance',
 'The source record identifies the finance operation');
select is((select a.action||':'||a.actor_role||':'||a.actor_scope_kind||':'||a.actor_person_id from audit_events a join wallet_adjustments w on w.id=a.target_id where w.idempotency_key='fin2f-fund-finance-0001'),
 'wallet_funded_adjustment_posted:platform_finance_operator:platform:00000000-0000-0000-0000-0000000f2e03','22. Audit identifies the Platform finance operation and operator');
-- 24–26. Idempotency.
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d03');
select is(pg_temp.fund(25000,'fin2f-fund-finance-0001'),current_setting('t.f')::jsonb,'24. Replay returns the same result');
select is(pg_temp.attempt($$select pg_temp.fund(26000,'fin2f-fund-finance-0001')$$),'23505:IDEMPOTENCY_CONFLICT','25. Same key, different amount fails');
select is(pg_temp.attempt($$select pg_temp.fund(25000,'fin2f-fund-finance-0001','Otra explicación ficticia')$$),'23505:IDEMPOTENCY_CONFLICT','25. Same key, different explanation fails');
select is(pg_temp.attempt($$select pg_temp.fund(25000,'f2f00000-0000-4000-8000-0000000000c1')$$),'23505:IDEMPOTENCY_CONFLICT','A tenant adjustment key cannot be reused as a funded adjustment');
reset role;
select is(pg_temp.bal(),current_setting('t.b2')::bigint+25000,'26. Replay did not credit again');
select is((select count(*) from wallet_adjustments where idempotency_key='fin2f-fund-finance-0001')||'/'||(select count(*) from financial_entries e join wallet_adjustments a on a.id=e.wallet_adjustment_id where a.idempotency_key='fin2f-fund-finance-0001'),
 '1/1','26. Exactly one funded adjustment and one event');
-- Input rules.
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d03');
select is(pg_temp.attempt($$select pg_temp.fund(-100,'fin2f-fund-negative-01')$$)||'|'||pg_temp.attempt($$select pg_temp.fund(0,'fin2f-fund-zero-00001')$$),
 '22023:INVALID_ADJUSTMENT_AMOUNT|22023:INVALID_ADJUSTMENT_AMOUNT','Positive amounts only');
select is(pg_temp.attempt($$select platform_finance_fund_wallet_adjustment('00000000-0000-0000-0000-000000005201',100,'authorized_debit','Corrección ficticia','fin2f-fund-debit-0001')$$),
 '22023:INVALID_ADJUSTMENT_REASON','A debit reason is refused');
select is(pg_temp.attempt($$select platform_finance_fund_wallet_adjustment('00000000-0000-0000-0000-000000005202',100,'administrative_correction','Corrección ficticia','fin2f-fund-nowallet-01')$$),
 '23514:WALLET_NOT_FOUND','No wallet is opened by a funded adjustment');
reset role;
-- A customer that is not activated cannot receive funded value.
savepoint not_active;
select pikas_private.finance_end_customer_activation('00000000-0000-0000-0000-000000000001','Fin de prueba ficticia');
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d03');
select is(pg_temp.attempt($$select pg_temp.fund(100,'fin2f-fund-inactive-01')$$),'23514:FINANCIAL_POLICY_NOT_ACTIVE','The customer must be financially activated');
reset role;
rollback to savepoint not_active;
-- 30. No general wallet, tenant or other finance authority.
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d03');
select is(pg_temp.attempt($$select school_wallet_read('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201')$$),'42501:school_authority_required','30. No School wallet read');
select is(pg_temp.attempt($$select pg_temp.school_adjust(-100,'f2f00000-0000-4000-8000-0000000000d1')$$),'42501:school_authority_required','30. No School adjustment, even negative');
select is(pg_temp.attempt($$select pg_temp.cafeteria_adjust(-100,'f2f00000-0000-4000-8000-0000000000d2')$$),'42501:cafeteria_authority_required','30. No Cafetería authority');
select is(pg_temp.attempt($$select school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',100,'f2f00000-0000-4000-8000-0000000000d3','Ref','Verificado')$$),
 '42501:school_authority_required','30. No replenishment authority');
select is(pg_temp.attempt($$select platform_finance_reverse_replenishment('REC-00000001','wrong_amount',null,'fin2f-reverse-attempt-01')$$),'42501:not_authorized','30. No reversal authority');
select is(pg_temp.attempt($$select platform_finance_replenishment_read('REC-00000001')$$),'42501:not_authorized','30. No finance read');
select is((select count(*) from student_wallets),0::bigint,'30. No wallet rows visible to the finance operator');
reset role;
-- 31. Sandbox POV.
savepoint pov;
insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,expires_at)
 select gen_random_uuid(),'00000000-0000-0000-0000-0000000f2e03','00000000-0000-0000-0000-0000000f2d03',p.account_id,p.school_id,p.cafeteria_id,'cashier',p.id,p.person_id,p.cafeteria_membership_id,clock_timestamp()+interval '1 hour'
 from pikas_private.sandbox_pov_personas p where p.pov_code='cashier' limit 1;
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d03');
select is(pg_temp.attempt($$select pg_temp.fund(100,'fin2f-fund-pov-000001')$$),'42501:finance_authority_required','31. A sandbox POV cannot fund value');
reset role;
rollback to savepoint pov;
-- Atomicity: if the financial event fails, the adjustment does not exist.
create function pg_temp.fail_entry() returns trigger language plpgsql as $$begin if new.entry_type='clearing_funded_adjustment' then raise exception 'forced financial failure'; end if; return new; end$$;
create trigger fin2f_test_fail before insert on financial_entries for each row execute function pg_temp.fail_entry();
select set_config('t.s1',pg_temp.state(),true);
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f2d03');
select ok(pg_temp.attempt($$select pg_temp.fund(100,'fin2f-fund-failing-001')$$) like '%forced financial failure%','The funded adjustment fails when its financial event fails');
reset role; drop trigger fin2f_test_fail on financial_entries;
select is((select count(*) from wallet_adjustments where idempotency_key='fin2f-fund-failing-001'),0::bigint,'No adjustment without its financial event');

-- ── 32. Owner-approved legacy_purchase_refund ──────────────────────────────────────────────────
select set_config('t.b3',pg_temp.bal()::text,true);
select set_config('t.side',(select count(*) from replenishment_requests)||'/'||(select count(*) from wallet_replenishments)||'/'||(select count(*) from financial_entries where entry_type='replenishment_fee_earned'),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.appr',(issue_purchase_item_refund_approval(current_setting('t.sid')::uuid,current_setting('t.p0')::uuid,pg_temp.items(current_setting('t.p0')::uuid,1),'wrong_product',null,'fin2f-legacy-approval-1')->>'approval_id'),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.rf',create_purchase_item_refund(current_setting('t.sid')::uuid,current_setting('t.p0')::uuid,pg_temp.items(current_setting('t.p0')::uuid,1),'wrong_product',null,'fin2f-legacy-refund-001',current_setting('t.appr')::uuid)::text,true);
select is(create_purchase_item_refund(current_setting('t.sid')::uuid,current_setting('t.p0')::uuid,pg_temp.items(current_setting('t.p0')::uuid,1),'wrong_product',null,'fin2f-legacy-refund-001',current_setting('t.appr')::uuid)::text,
 current_setting('t.rf'),'32. Refund replay returns the same result');
reset role;
select is(pg_temp.bal(),current_setting('t.b3')::bigint+5000,'32. Wallet receives exactly the RD$ 50 refund');
select is((select string_agg(o.reason||':'||o.amount_minor||':'||d.kind||'>'||c.kind,',') from financial_obligations o join financial_parties d on d.id=o.debtor_party_id join financial_parties c on c.id=o.creditor_party_id
  join financial_entries e on e.id=o.source_entry_id join wallet_refund_credits r on r.id=e.wallet_refund_credit_id join wallet_purchase_debits pd on pd.id=r.original_purchase_debit_id
  where pd.purchase_id=current_setting('t.p0')::uuid),'legacy_purchase_refund:5000:cafeteria>clearing','32. One Cafetería → clearing obligation equal to the wallet refund (none duplicated on replay)');
select is((select count(*) from replenishment_requests)||'/'||(select count(*) from wallet_replenishments)||'/'||(select count(*) from financial_entries where entry_type='replenishment_fee_earned'),
 current_setting('t.side'),'32. No fee and no replenishment');
select is((select count(*) from financial_entries e join wallet_purchase_debits d on d.id=e.wallet_purchase_debit_id where d.purchase_id=current_setting('t.p0')::uuid),0::bigint,
 '32. No historical clearing entry manufactured for the original purchase');
select is((select array_agg(j order by j::text) from (select to_jsonb(p) j from purchases p where id=current_setting('t.p0')::uuid
  union all select to_jsonb(i) from purchase_items i where purchase_id=current_setting('t.p0')::uuid
  union all select to_jsonb(d) from wallet_purchase_debits d where purchase_id=current_setting('t.p0')::uuid) x),(select array_agg(j order by j::text) from p0_before),'32. The original purchase is unchanged');
select is(pg_temp.attempt(format($$update purchases set total_minor=1 where id=%L$$,current_setting('t.p0'))),'23514:purchase_financial_history_is_immutable','32. The original purchase stays immutable');

-- ── Invariant: no tenant path creates PIKAS-funded value ───────────────────────────────────────
select is((select count(*) from financial_entries e join wallet_adjustments a on a.id=e.wallet_adjustment_id
  where e.entry_type='clearing_funded_adjustment' and a.actor_source is distinct from 'platform_finance'),0::bigint,'Every clearing-funded adjustment was executed by Platform finance');
select is((select sum(current_balance_minor)::numeric from student_wallets where account_id='00000000-0000-0000-0000-000000000001' and currency_code='DOP'),
 (select (a.opening_legacy_liability_minor - a.opening_negative_balance_minor)::numeric
   + coalesce(sum(e.amount_minor) filter (where e.entry_type in ('stored_value_issued','clearing_funded_adjustment','stored_value_restored')),0)
   - coalesce(sum(e.amount_minor) filter (where e.entry_type in ('stored_value_redeemed','stored_value_cancelled','adjustment_stored_value_reduction','legacy_stored_value_reversed')),0)
   from customer_financial_activations a left join financial_entries e on e.account_id=a.account_id where a.account_id='00000000-0000-0000-0000-000000000001' and a.status='active'
   group by a.opening_legacy_liability_minor, a.opening_negative_balance_minor),'Value-source invariant holds');

select * from finish();
rollback;
