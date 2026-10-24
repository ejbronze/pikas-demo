-- PIKAS FIN 4 Cafetería cash collection (202611190001). Fictional local fixtures only; everything rolls back.
-- Foundation fixtures: account 1 / school 11 / student 5201 (wallet 7001, served by Cafetería 111 through customer 6901) /
-- student 5202 (not served by 111) / product 8101 at RD$ 50 / register 9401 (cashier 2008, assignment 9501).
-- Personas: 2003 Cafetería Admin (111), 2004 Cafetería Admin (112, school 12), 2002 School Admin (account 1), 2008 POS cashier.
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
create function pg_temp.bal() returns bigint language sql security definer as $$select current_balance_minor from public.student_wallets where id='00000000-0000-0000-0000-000000007001'$$;
create function pg_temp.collect(gross bigint,key uuid,caf text default '00000000-0000-0000-0000-000000000111',student text default '00000000-0000-0000-0000-000000005201',payer text default 'Madre ficticia') returns jsonb language sql as $$
 select cafeteria_wallet_collect_cash(caf::uuid,student::uuid,gross,payer,key)$$;
create function pg_temp.entries(ref text,t text) returns bigint language sql security definer as $$
 select coalesce(sum(e.amount_minor),0)::bigint from public.financial_entries e join public.replenishment_requests r on r.id=e.replenishment_request_id where r.reference=ref and e.entry_type=t$$;
create function pg_temp.obligation(ref text,reason text) returns public.financial_obligations language sql security definer as $$
 select o.* from public.financial_obligations o join public.financial_entries e on e.id=o.source_entry_id join public.replenishment_requests r on r.id=e.replenishment_request_id
 where r.reference=ref and o.reason=reason$$;
-- Everything the posting can touch, as one fingerprint: atomic failures must leave it identical.
create function pg_temp.money() returns text language sql security definer as $$ select concat_ws('|',
 (select count(*) from public.replenishment_requests),(select count(*) from public.wallet_replenishments),(select count(*) from public.wallet_ledger_entries),
 (select count(*) from public.financial_entries),(select count(*) from public.financial_obligations),(select count(*) from public.wallet_replenishment_reversals),
 (select sum(current_balance_minor) from public.student_wallets),(select count(*) from public.audit_events where action in ('wallet_cash_collected','wallet_replenishment_requested'))) $$;
create function pg_temp.sale(key text,qty integer) returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',current_setting('t.sid'),
 'cafeteria_customer_id','00000000-0000-0000-0000-000000006901','items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',qty,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor',(5000*qty)::text,
 'tender',jsonb_build_object('type','student_wallet')))->>'purchase_id')::uuid$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Fictional Platform finance operator (read + reverse only) for the Platform side.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-0000000f4d01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin4.test.finanzas@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-0000000f4e01','00000000-0000-0000-0000-0000000f4d01','Finanzas FIN 4 ficticia');
insert into pikas_private.platform_roles(role_code) values('fin4_finanzas');
insert into pikas_private.platform_role_capabilities(role_code,capability) values('fin4_finanzas','platform:finance:read'),('fin4_finanzas','platform:finance:replenishments:reverse');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-0000000f4e01','fin4_finanzas');

-- ── Shape, capability and ACLs ─────────────────────────────────────────────────────────────────
select is((select array_agg(scope_kind||':'||role_code) from pikas_private.role_capabilities where capability='cafeteria:wallets:collect_cash'),array['cafeteria:cafeteria_admin'],
 'cafeteria:wallets:collect_cash is held by Cafetería Admin only (not School, Account, POS or Platform)');
select is((select count(*) from pikas_private.role_capabilities where capability='cafeteria:wallets:replenish'),0::bigint,'The broad cafeteria:wallets:replenish does not return');
select is((select count(*) from pikas_private.platform_role_capabilities where capability like 'cafeteria:%'),0::bigint,'No Platform role receives Cafetería cash authority');
select ok(has_function_privilege('authenticated','cafeteria_wallet_collect_cash(uuid,uuid,bigint,text,uuid)','execute')
 and not has_function_privilege('anon','cafeteria_wallet_collect_cash(uuid,uuid,bigint,text,uuid)','execute')
 and not has_function_privilege('service_role','cafeteria_wallet_collect_cash(uuid,uuid,bigint,text,uuid)','execute')
 and has_function_privilege('authenticated','cafeteria_cash_collections_read(uuid,text)','execute')
 and not has_function_privilege('anon','cafeteria_cash_collections_read(uuid,text)','execute'),'New RPCs: authenticated only, no anon or service role');
select is((select count(*) from pg_proc p, aclexplode(p.proacl) a where p.proname in ('cafeteria_wallet_collect_cash','cafeteria_cash_collections_read') and a.grantee=0)
 + (select count(*) from pg_proc where proname in ('cafeteria_wallet_collect_cash','cafeteria_cash_collections_read') and proacl is null),0::bigint,'No PUBLIC EXECUTE on the new RPCs');
select ok(not has_function_privilege('authenticated','pikas_private.finance_post_cash_replenishment(uuid,uuid,uuid,bigint,text,text)','execute'),'The FIN 2 primitive stays internal');
select is((select prosecdef from pg_proc where proname='cafeteria_wallet_collect_cash'),true,'The wrapper is SECURITY DEFINER with a pinned search path')
 ; select ok((select proconfig from pg_proc where proname='cafeteria_wallet_collect_cash')=array['search_path=""'],'…search_path is empty');

-- ── Activation off: refused, nothing written ───────────────────────────────────────────────────
reset role; select set_config('t.m0',pg_temp.money(),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.collect(200000,'f4000000-0000-4000-8000-000000000001')$$),'23514:FINANCIAL_POLICY_NOT_ACTIVE','Activation off: Cafetería cash is refused');
select is((cafeteria_cash_collections_read('00000000-0000-0000-0000-000000000111')->>'enabled')::boolean,false,'Activation off: the Cafetería read says collection is not enabled');
reset role; select is(pg_temp.money(),current_setting('t.m0'),'Activation off: no request, credit, entry, obligation or audit');

-- Backend-only activation (internal primitive, exactly as the owner-approved procedure calls it).
select ok((pikas_private.finance_activate_customer('00000000-0000-0000-0000-000000000001',1,'Piloto ficticio FIN 4','fin4-activation-key-0001')->>'activation_id') is not null,'Fictional account 1 activated (backend only)');
select is(pg_temp.attempt($$select pikas_private.finance_activate_customer('03e71159-69e9-4387-9b3b-65799d49faf0',1,'Sandbox','fin4-activation-key-0002')$$),'23514:ACTIVATION_REQUIRES_ACTIVE_CUSTOMER','A sandbox can never be activated');
-- 202611190003: after activation the School is told it cannot top up directly (the FIN 2 guard already refuses it).
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is((select concat_ws('/',x->>'read',x->>'replenish') from (select school_wallet_access('00000000-0000-0000-0000-000000000011') x) y),'true/false','Activated customer: School reads PIKAS Cash but no longer sees a direct top-up');
select is(pg_temp.attempt($$select school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',1000,'f4000000-0000-4000-8000-0000000000f1','Ref','Nota')$$) like '%collection_source_required%',true,'…and a direct School top-up stays refused by the database');
reset role;

-- Open a register so the later wallet purchase is a real POS sale.
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',1000,'fin4-open-cashier-0001')),true);

-- ── Gross / fee / net: RD$ 2,000.00 → RD$ 60.00 fee → RD$ 1,940.00 to the wallet; Cafetería owes RD$ 2,000.00 ──
reset role; select set_config('t.b0',pg_temp.bal()::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.r1',pg_temp.collect(200000,'f4000000-0000-4000-8000-000000000011')::text,true);
select is((current_setting('t.r1')::jsonb->>'gross_minor'),'200000','Result gross 200000');
select is((current_setting('t.r1')::jsonb->>'fee_minor'),'6000','Result fee 6000 (3 %)');
select is((current_setting('t.r1')::jsonb->>'net_minor'),'194000','Result net 194000');
select is((current_setting('t.r1')::jsonb->>'state'),'posted','Posted immediately (cash never waits)');
select ok((current_setting('t.r1')::jsonb->>'reference') ~ '^REC-[0-9]{8}$','Authoritative REC- reference');
select is((current_setting('t.r1')::jsonb->>'replayed')::boolean,false,'First submission is not a replay');
reset role; select set_config('t.ref1',current_setting('t.r1')::jsonb->>'reference',true);
select is(pg_temp.bal(),current_setting('t.b0')::bigint+194000,'Wallet receives exactly NET (+194000)');
select is((current_setting('t.r1')::jsonb->>'balance_after_minor')::bigint,pg_temp.bal(),'Result balance matches the wallet');
select is((select concat_ws(':',w.source,w.amount_minor,w.status,w.cafeteria_id) from wallet_replenishments w join replenishment_requests r on r.wallet_replenishment_id=w.id where r.reference=current_setting('t.ref1')),
 'cafeteria_cash_collected:194000:posted:00000000-0000-0000-0000-000000000111','Wallet replenishment: own source, NET, collecting Cafetería');
select is((select count(*)::int||':'||sum(l.amount_minor) from wallet_ledger_entries l join replenishment_requests r on r.wallet_replenishment_id=l.replenishment_id where r.reference=current_setting('t.ref1')),'1:194000','One ledger entry for NET (the fee is never a wallet movement)');
select is(pg_temp.entries(current_setting('t.ref1'),'replenishment_gross_collected'),200000::bigint,'Financial entry: gross collected 200000');
select is(pg_temp.entries(current_setting('t.ref1'),'replenishment_fee_earned'),6000::bigint,'Financial entry: PIKAS fee 6000');
select is(pg_temp.entries(current_setting('t.ref1'),'stored_value_issued'),194000::bigint,'Financial entry: stored value issued 194000');
select is((select count(*) from financial_entries e join replenishment_requests r on r.id=e.replenishment_request_id where r.reference=current_setting('t.ref1')),3::bigint,'Exactly three entries (no double-counted fee)');
select is((pg_temp.obligation(current_setting('t.ref1'),'cash_collection')).amount_minor,200000::bigint,'Obligation = GROSS (Cafetería → clearing 200000), not net');
select ok((select (pg_temp.obligation(current_setting('t.ref1'),'cash_collection')).debtor_party_id=pikas_private.cafeteria_party('00000000-0000-0000-0000-000000000111')
 and (pg_temp.obligation(current_setting('t.ref1'),'cash_collection')).creditor_party_id=pikas_private.clearing_party()),'Debtor is the collecting Cafetería, creditor is clearing');
select is((select count(*) from financial_obligations o where o.corrects_obligation_id=(pg_temp.obligation(current_setting('t.ref1'),'cash_collection')).id),0::bigint,'Obligation stays open: no settlement, no correction');
select ok((select r.fee_bps=300 and r.policy_id=(select policy_id from customer_financial_activations where account_id='00000000-0000-0000-0000-000000000001' and status='active')
 and r.method='cafeteria_cash' and r.collecting_cafeteria_id='00000000-0000-0000-0000-000000000111' and r.payer_name='Madre ficticia'
 and r.submitted_by=(select id from persons where auth_user_id='00000000-0000-0000-0000-000000002003') and r.submitted_role='cafeteria_staff'
 from replenishment_requests r where r.reference=current_setting('t.ref1')),'Request snapshots policy, 300 bps, source, Cafetería, payer and the real actor');
select ok((select a.actor_person_id=(select id from persons where auth_user_id='00000000-0000-0000-0000-000000002003') and a.actor_role='cafeteria_admin' and a.actor_scope_kind='cafeteria'
 and a.cafeteria_id='00000000-0000-0000-0000-000000000111' and a.after_metadata->>'gross_minor'='200000' and a.after_metadata->>'fee_minor'='6000' and a.after_metadata->>'net_minor'='194000'
 and a.after_metadata->>'reference'=current_setting('t.ref1') and a.authenticated_user_id='00000000-0000-0000-0000-000000002003'
 from audit_events a where a.action='wallet_cash_collected' and a.target_id=(select id from replenishment_requests where reference=current_setting('t.ref1'))),'Audit: real actor, Cafetería, gross/fee/net, reference');

-- ── Rounding (half-up on gross, integer centavos) ─────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((select concat_ws('/',r->>'gross_minor',r->>'fee_minor',r->>'net_minor') from (select pg_temp.collect(33333,'f4000000-0000-4000-8000-000000000021') r) x),'33333/1000/32333','RD$ 333.33: 999.99 centavos rounds half-up to 1,000');
select is((select concat_ws('/',r->>'gross_minor',r->>'fee_minor',r->>'net_minor') from (select pg_temp.collect(50,'f4000000-0000-4000-8000-000000000022') r) x),'50/2/48','RD$ 0.50: exactly .5 rounds up (fee 2)');
select is((select concat_ws('/',r->>'gross_minor',r->>'fee_minor',r->>'net_minor') from (select pg_temp.collect(49,'f4000000-0000-4000-8000-000000000023') r) x),'49/1/48','RD$ 0.49: 1.47 rounds down (fee 1)');
select is((select concat_ws('/',r->>'gross_minor',r->>'fee_minor',r->>'net_minor') from (select pg_temp.collect(1,'f4000000-0000-4000-8000-000000000024') r) x),'1/0/1','Minimum: fee 0, net 1, no fee entry');
reset role;
select is((select count(*) from replenishment_requests where method='cafeteria_cash' and gross_minor<>fee_minor+net_minor),0::bigint,'Persisted gross = fee + net on every cash request');
select is((select count(*) from replenishment_requests r where r.method='cafeteria_cash' and (select count(*) from financial_obligations o join financial_entries e on e.id=o.source_entry_id
 where e.replenishment_request_id=r.id and o.reason='cash_collection' and o.amount_minor=r.gross_minor)<>1),0::bigint,'Each cash request has exactly one GROSS cash_collection obligation');

-- ── Idempotency: double click / retry / stale resubmission ─────────────────────────────────────
select set_config('t.m1',pg_temp.money(),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((pg_temp.collect(200000,'f4000000-0000-4000-8000-000000000011')->>'reference'),current_setting('t.ref1'),'Same key + same payload returns the original reference');
select is((pg_temp.collect(200000,'f4000000-0000-4000-8000-000000000011')->>'replayed')::boolean,true,'…marked as a replay');
select is(pg_temp.attempt($$select pg_temp.collect(150000,'f4000000-0000-4000-8000-000000000011')$$),'23505:IDEMPOTENCY_CONFLICT','Same key with a different amount is refused');
select is(pg_temp.attempt($$select pg_temp.collect(200000,'f4000000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201','Otro pagador')$$),'23505:IDEMPOTENCY_CONFLICT','Same key with a different payer is refused');
reset role; select is(pg_temp.money(),current_setting('t.m1'),'Retries posted nothing: one request, one credit, one obligation, one audit');
-- 202611190002: the retry replays before authorization, so an original that posted is reported even after scope changed.
set local session_replication_role=replica; update school_cafeteria_shares set status='revoked' where cafeteria_id='00000000-0000-0000-0000-000000000111'; set local session_replication_role=origin;
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((select concat_ws('/',r->>'reference',r->>'replayed',r->>'net_minor') from (select pg_temp.collect(200000,'f4000000-0000-4000-8000-000000000011') r) x),
 current_setting('t.ref1')||'/true/194000','Retry after the School stopped sharing still returns the posted original (never «nothing recorded»)');
select is(pg_temp.attempt($$select pg_temp.collect(200000,'f4000000-0000-4000-8000-000000000012')$$),'42501:student_not_served_by_cafeteria','…while a new collection is refused');
reset role; set local session_replication_role=replica; update school_cafeteria_shares set status='active' where cafeteria_id='00000000-0000-0000-0000-000000000111'; set local session_replication_role=origin;
-- Another Cafetería Admin of the same Cafetería cannot replay or reuse someone else's key.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-0000000f4d02','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin4.test.otra@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-0000000f4e02','00000000-0000-0000-0000-0000000f4d02','Otra administradora FIN 4');
insert into cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-0000000f4e02','cafeteria_admin');
select pg_temp.as_user('00000000-0000-0000-0000-0000000f4d02');
select is(pg_temp.attempt($$select pg_temp.collect(200000,'f4000000-0000-4000-8000-000000000011')$$),'23505:IDEMPOTENCY_CONFLICT','Another operator presenting the same key gets a conflict, not the result');
reset role; select is(pg_temp.money(),current_setting('t.m1'),'Replays and conflicts posted nothing');

-- ── A later purchase costs exactly its price: no second fee ────────────────────────────────────
select set_config('t.b1',pg_temp.bal()::text,true); select set_config('t.fees',(select count(*)::text from financial_entries where entry_type='replenishment_fee_earned'),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.p1',pg_temp.sale('fin4-sale-00000000001',2)::text,true);
reset role;
select is(pg_temp.bal(),current_setting('t.b1')::bigint-10000,'Wallet purchase of RD$ 100.00 debits exactly 10000');
select is((select amount_minor from wallet_purchase_debits where purchase_id=current_setting('t.p1')::uuid),10000::bigint,'Purchase debit = price');
select is((select count(*)::text from financial_entries where entry_type='replenishment_fee_earned'),current_setting('t.fees'),'No fee on spending');

-- ── Atomicity: a failure at the last step (the obligation) leaves nothing behind ──────────────
create function pg_temp.fail_obligation() returns trigger language plpgsql as $$ begin raise exception 'fin4_forced_failure'; end $$;
create trigger fin4_forced_failure before insert on public.financial_obligations for each row execute function pg_temp.fail_obligation();
select set_config('t.m2',pg_temp.money(),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000031')$$),'P0001:fin4_forced_failure','Forced obligation failure aborts the collection');
reset role; select is(pg_temp.money(),current_setting('t.m2'),'Atomic: no request, credit, ledger, fee, obligation or audit survived');
drop trigger fin4_forced_failure on public.financial_obligations;

-- ── Frozen wallet ──────────────────────────────────────────────────────────────────────────────
update student_wallets set status='frozen' where id='00000000-0000-0000-0000-000000007001';
select set_config('t.m3',pg_temp.money(),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000041')$$),'23514:wallet_not_active','Frozen wallet cannot receive cash');
reset role; select is(pg_temp.money(),current_setting('t.m3'),'Frozen: nothing written');
update student_wallets set status='active' where id='00000000-0000-0000-0000-000000007001';

-- ── Scope and authority ────────────────────────────────────────────────────────────────────────
select set_config('t.m4',pg_temp.money(),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000051')$$),'42501:cafeteria_authority_required','Another Cafetería admin cannot collect at Cafetería 111');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000052','00000000-0000-0000-0000-000000000112')$$),'42501:student_not_served_by_cafeteria','…nor at their own Cafetería for a student it does not serve');
select is(pg_temp.attempt($$select cafeteria_cash_collections_read('00000000-0000-0000-0000-000000000111')$$),'42501:cafeteria_authority_required','…nor read Cafetería 111 history');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000053','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005202')$$),'42501:student_not_served_by_cafeteria','Student not shared with this Cafetería is refused');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000054')$$),'42501:cafeteria_authority_required','School Admin cannot collect cash');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000055')$$),'42501:cafeteria_authority_required','POS cashier cannot collect cash (not granted)');
reset role; select set_config('request.jwt.claim.sub','',true); set local role anon;
select is(pg_temp.attempt($$select cafeteria_wallet_collect_cash('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201',100000,null,'f4000000-0000-4000-8000-000000000056')$$),'42501:permission denied for function cafeteria_wallet_collect_cash','Anonymous cannot call the RPC');
reset role;
-- Capability withdrawn while authorized: refused (and re-checked after the student lock by the same predicate).
delete from pikas_private.role_capabilities where capability='cafeteria:wallets:collect_cash';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000057')$$),'42501:cash_collection_authority_required','Without the capability a Cafetería Admin cannot collect');
reset role; insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values('cafeteria','cafeteria_admin','cafeteria:wallets:collect_cash');
-- Platform customer-operations support never collects for a customer.
select pg_temp.as_user('00000000-0000-0000-0000-000000002003'); select set_config('pikas.customer_operations_account','00000000-0000-0000-0000-000000000001',true);
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000058')$$),'42501:cash_collection_authority_required','Platform customer-operations context is refused');
select set_config('pikas.customer_operations_account','',true);
reset role; select is(pg_temp.money(),current_setting('t.m4'),'Scope/authority refusals wrote nothing');

-- ── Lifecycle ──────────────────────────────────────────────────────────────────────────────────
select set_config('t.m5',pg_temp.money(),true);
set local session_replication_role=replica; update student_enrollments set status='withdrawn', ends_on=current_date where student_id='00000000-0000-0000-0000-000000005201' and status='active'; set local session_replication_role=origin;
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000061')$$),'23514:active_enrollment_required_for_replenishment','Withdrawn enrollment: refused');
reset role; set local session_replication_role=replica; update student_enrollments set status='active', ends_on=null where student_id='00000000-0000-0000-0000-000000005201' and status='withdrawn'; set local session_replication_role=origin;
update students set status='suspended' where id='00000000-0000-0000-0000-000000005201';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000062')$$),'42501:student_not_served_by_cafeteria','Suspended student: refused');
reset role; update students set status='active' where id='00000000-0000-0000-0000-000000005201';
set local session_replication_role=replica; update school_cafeteria_shares set status='revoked' where cafeteria_id='00000000-0000-0000-0000-000000000111'; set local session_replication_role=origin;
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000063')$$),'42501:student_not_served_by_cafeteria','School stopped sharing with the Cafetería: refused');
reset role; set local session_replication_role=replica; update school_cafeteria_shares set status='active' where cafeteria_id='00000000-0000-0000-0000-000000000111'; set local session_replication_role=origin;
update cafeterias set status='inactive' where id='00000000-0000-0000-0000-000000000111';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000064')$$),'42501:cafeteria_authority_required','Inactive Cafetería: refused');
reset role; update cafeterias set status='active' where id='00000000-0000-0000-0000-000000000111';
update accounts set status='suspended' where id='00000000-0000-0000-0000-000000000001';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000065')$$),'42501:cafeteria_authority_required','Suspended customer: refused');
reset role; update accounts set status='active' where id='00000000-0000-0000-0000-000000000001';
select is(pg_temp.money(),current_setting('t.m5'),'Lifecycle refusals wrote nothing');

-- ── Demo / sandbox: never real finance ─────────────────────────────────────────────────────────
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select platform_enter_sandbox_pov(gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe','cafeteria_admin');
select is(pg_temp.attempt($$select cafeteria_wallet_collect_cash('b9496342-5079-46ae-83b8-05c39bcbd7fe',(select id from students where account_id='03e71159-69e9-4387-9b3b-65799d49faf0' limit 1),200000,null,'f4000000-0000-4000-8000-000000000071')$$),'42501:demo_mode_active','Demo Cafetería Admin cannot collect cash');
select is(pg_temp.attempt($$select cafeteria_cash_collections_read('b9496342-5079-46ae-83b8-05c39bcbd7fe')$$),'42501:demo_mode_active','…nor read cash history');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000072')$$),'42501:demo_mode_active','An active Demo blocks real-customer collection too (UX 11)');
reset role;
select is((select count(*) from replenishment_requests where account_id='03e71159-69e9-4387-9b3b-65799d49faf0')+(select count(*) from financial_entries where account_id='03e71159-69e9-4387-9b3b-65799d49faf0')
 +(select count(*) from financial_obligations where account_id='03e71159-69e9-4387-9b3b-65799d49faf0'),0::bigint,'Sandbox: no request, entry or obligation');

-- ── Reads: Cafetería history, School support record, Platform finance ─────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.read',cafeteria_cash_collections_read('00000000-0000-0000-0000-000000000111')::text,true);
select ok((current_setting('t.read')::jsonb->>'enabled')::boolean and (current_setting('t.read')::jsonb->>'fee_bps')='300','Cafetería read: enabled, policy 300 bps');
select is((select x->>'gross_minor'||'/'||(x->>'fee_minor')||'/'||(x->>'net_minor')||'/'||(x->>'status')||'/'||(x->>'collected_by')
 from jsonb_array_elements(current_setting('t.read')::jsonb->'collections') x where x->>'reference'=current_setting('t.ref1')),
 '200000/6000/194000/posted/'||(select display_name from persons where auth_user_id='00000000-0000-0000-0000-000000002003'),'Cafetería history row: gross/fee/net, status, who received it');
select is((select count(*) from jsonb_array_elements(current_setting('t.read')::jsonb->'collections')),5::bigint,'History lists this Cafetería''s five collections');
select ok(current_setting('t.read') !~ '(obligation|clearing|settlement|party)','Cafetería read exposes no obligations or settlement figures');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select set_config('t.school',school_wallet_read('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201')::text,true);
select is((select concat_ws('/',m->>'method',m->>'gross_minor',m->>'fee_minor',m->>'net_minor',m->>'amount_minor',m->>'cafeteria',m->>'source')
 from jsonb_array_elements(current_setting('t.school')::jsonb->'movements') m where m->>'reference'=current_setting('t.ref1')),
 'cafeteria_cash/200000/6000/194000/194000/Synthetic cafeteria A1-C1/cafeteria_cash_collected','School support record: source, gross/fee/net, collecting Cafetería');
select ok(current_setting('t.school') !~ '(obligation|clearing|settlement|fee_bps)','School read carries no obligation, clearing or settlement data');
select is(pg_temp.attempt($$select cafeteria_financial_obligations_read('00000000-0000-0000-0000-000000000111')$$) like '42501:%',true,'School cannot read Cafetería obligations');
select is(pg_temp.attempt($$select pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000081')$$),'42501:cafeteria_authority_required','School has no cash button path');
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f4d01');
select ok((select bool_or(x->>'reference'=current_setting('t.ref1') and x->>'method'='cafeteria_cash' and x->>'cafeteria'='Synthetic cafeteria A1-C1' and x->>'status'='posted')
 from jsonb_array_elements(platform_finance_replenishments_read('history')->'requests') x),'Platform finance history lists the cash collection with its Cafetería');
select is((select count(*) from jsonb_array_elements(platform_finance_replenishments_read('pending')->'requests') x where x->>'method'='cafeteria_cash'),0::bigint,'The verification queue stays bank transfers');
select is((select concat_ws('/',d->>'method',d->>'cafeteria',d->>'gross_minor',d->>'fee_minor',d->>'net_minor') from (select platform_finance_replenishment_detail(current_setting('t.ref1')) d) x),
 'cafeteria_cash/Synthetic cafeteria A1-C1/200000/6000/194000','Platform finance detail explains a cash collection');

-- ── Full reversal (Platform finance, existing FIN 2/3 path) ───────────────────────────────────
reset role; select set_config('t.b2',pg_temp.bal()::text,true);
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f4d01');
select is((platform_finance_reverse_replenishment(current_setting('t.ref1'),'wrong_amount',null,'fin4-reversal-key-0001')->>'state'),'reversed','Finance reverses the cash collection');
reset role;
select is(pg_temp.bal(),current_setting('t.b2')::bigint-194000,'Reversal removes exactly NET from the wallet');
select is(pg_temp.entries(current_setting('t.ref1'),'replenishment_fee_earned')-coalesce((select sum(e.amount_minor)::bigint from financial_entries e join financial_entries o on o.id=e.reverses_entry_id
 join replenishment_requests r on r.id=o.replenishment_request_id where r.reference=current_setting('t.ref1') and e.entry_type='replenishment_fee_reversed'),0),0::bigint,'Fee fully reversed');
select is((pg_temp.obligation(current_setting('t.ref1'),'cash_collection')).amount_minor,200000::bigint,'Original obligation is kept (history)');
select is((select sum(o.amount_minor)::bigint from financial_obligations o where o.reason='cash_collection_reversal' and o.corrects_obligation_id=(pg_temp.obligation(current_setting('t.ref1'),'cash_collection')).id),
 200000::bigint,'…and corrected by a clearing → Cafetería cash_collection_reversal of GROSS');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((select x->>'status' from jsonb_array_elements(cafeteria_cash_collections_read('00000000-0000-0000-0000-000000000111')->'collections') x where x->>'reference'=current_setting('t.ref1')),'reversed','Cafetería history shows it reversed');
reset role;
select ok(exists(select 1 from audit_events a where a.action='wallet_replenishment_reversed' and a.actor_person_id='00000000-0000-0000-0000-0000000f4e01' and a.actor_role='platform_finance_operator'),'Reversal audited with the real finance operator');

-- ── Insufficient balance: FINANCIAL_RESOLUTION_REQUIRED, nothing changes ─────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.ref2',(pg_temp.collect(100000,'f4000000-0000-4000-8000-000000000091')->>'reference'),true);
reset role;
-- Bring the wallet below the collection's net (97000) with a tenant debit (a spend in the browser scenario).
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select school_wallet_adjust('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',-(pg_temp.bal()-96999),'authorized_debit','Gasto ficticio FIN 4','f4000000-0000-4000-8000-000000000092');
reset role; select is(pg_temp.bal(),96999::bigint,'Wallet now holds less than the net (97000)');
select set_config('t.m6',pg_temp.money(),true);
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f4d01');
select is(pg_temp.attempt($$select platform_finance_reverse_replenishment(current_setting('t.ref2'),'wrong_amount',null,'fin4-reversal-key-0002')$$),'23514:FINANCIAL_RESOLUTION_REQUIRED','Insufficient balance: FINANCIAL_RESOLUTION_REQUIRED');
reset role; select is(pg_temp.money(),current_setting('t.m6'),'No partial reversal, no negative balance, nothing written');

-- ── Invariants ─────────────────────────────────────────────────────────────────────────────────
select is((select count(*) from student_wallets w where w.current_balance_minor<>(select coalesce(sum(l.amount_minor),0) from wallet_ledger_entries l where l.wallet_id=w.id)),0::bigint,'Every wallet equals its ledger');
select is((select count(*) from replenishment_requests where method='cafeteria_cash' and state<>'posted'),0::bigint,'Cash requests are always posted');
select is((select count(*) from financial_entries where entry_type='replenishment_fee_earned' and replenishment_request_id is null),0::bigint,'Fees exist only on replenishment requests');

-- The School UI offers a positive «Corregir saldo» only while school_wallet_access reports replenish; that is exact only
-- if every role holding School adjustment authority also holds replenish (replenish then turns false only on activation).
select is((select count(*) from pikas_private.role_capabilities a where a.capability='school:wallets:administrative_adjust'
  and not exists(select 1 from pikas_private.role_capabilities r where r.role_code=a.role_code and r.scope_kind=a.scope_kind and r.capability='school:wallets:replenish')),0::bigint,
  'Every School adjustment role also holds replenish (UI credit signal)');
select * from finish();
rollback;
