-- Phase 5C.1 controlled item refunds (202610180001). Fictional local fixtures only.
-- 2008 cashier (membership 4601, register 9401/assignment 9501); 2011 POS supervisor (assignment 9503)
-- and Cafeteria Admin of 111; 2003 Cafeteria Admin 111; 2004 Cafeteria Admin 112; 2002 School Admin.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.sale(key text,qty integer,tender text) returns uuid language sql as $$
 select (checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',current_setting('t.sid'),
 'cafeteria_customer_id','00000000-0000-0000-0000-000000006901','items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',qty,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor',(5000*qty)::text,
 'tender',case when tender='cash' then jsonb_build_object('type','cash','cash_received_minor',(5000*qty)::text) else jsonb_build_object('type','student_wallet') end))->>'purchase_id')::uuid$$;
create function pg_temp.items(p uuid,qty integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('purchase_item_id',(select id from purchase_items where purchase_id=p),'quantity',qty))$$;
create function pg_temp.refund(sid text,p uuid,qty integer,key text,approval uuid default null,reason text default 'wrong_product',notes text default null) returns jsonb language sql as $$
 select create_purchase_item_refund(sid::uuid,p,pg_temp.items(p,qty),reason,notes,key,approval)$$;
create function pg_temp.attempt(sid text,p uuid,qty integer,key text) returns text language plpgsql as $$
declare m text; d text; begin perform pg_temp.refund(sid,p,qty,key); return 'ok';
exception when others then get stacked diagnostics m=message_text,d=pg_exception_detail; return m||':'||coalesce(d,''); end$$;
create function pg_temp.approve(sid text,p uuid,qty integer,key text,reason text default 'wrong_product') returns uuid language sql as $$
 select (issue_purchase_item_refund_approval(sid::uuid,p,pg_temp.items(p,qty),reason,null,key)->>'approval_id')::uuid$$;
create function pg_temp.expected(sid text) returns text language sql security definer as $$select pikas_private.register_cash_summary(sid::uuid)->>'expected_minor'$$;

-- Policy shape and limits
select ok(exists(select 1 from pikas_private.role_capabilities where role_code='cafeteria_admin' and capability='cafeteria:pos:refund:approve'),'Cafeteria Admin may authorize refunds');
select is((select count(*) from pikas_private.role_capabilities where role_code='pos_cashier' and capability in ('cafeteria:pos:refund:approve','cafeteria:pos:refund:direct','cafeteria:refund_limits:configure')),0::bigint,'Cashier has no approval, direct or limit authority');
select ok(not has_function_privilege('anon','create_purchase_item_refund(uuid,uuid,jsonb,text,text,text,uuid)','execute') and not has_function_privilege('service_role','create_purchase_item_refund(uuid,uuid,jsonb,text,text,text,uuid)','execute'),'No anonymous or service refund bypass');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',100000,'5c100000-0000-4000-8000-000000000001','Fondos locales','Verificado');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select throws_ok($$select configure_cashier_refund_limits('00000000-0000-0000-0000-000000000111',1,5,1)$$,'42501',null,'Cashier cannot configure limits');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(configure_cashier_refund_limits('00000000-0000-0000-0000-000000000111',1,2,20000)->>'count_limit','2','Cafeteria Admin configures count + amount limits');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',10000,'5c1-open-cashier-0001')),true);
select set_config('t.p1',pg_temp.sale('5c1-sale-cash-p1-0001',3,'cash')::text,true);
select is(pg_temp.expected(current_setting('t.sid')),'25000','Opening + cash sale');

-- Reason rules
select throws_ok($$select pg_temp.refund(current_setting('t.sid'),current_setting('t.p1')::uuid,1,'5c1-bad-reason-000001',null,'')$$,'22023',null,'Reason required');
select throws_ok($$select pg_temp.refund(current_setting('t.sid'),current_setting('t.p1')::uuid,1,'5c1-other-blank-00001',null,'other',' ')$$,'22023','INVALID_REFUND_NOTES','"Otro" requires explanation');

-- Cashier inside window and limits: partial cash refunds
select is(pg_temp.refund(current_setting('t.sid'),current_setting('t.p1')::uuid,1,'5c1-cash-partial-0001',null,'quality_issue')->>'authorization_mode','independent','Cashier partial cash refund within 5 minutes and limits');
select is(pg_temp.refund(current_setting('t.sid'),current_setting('t.p1')::uuid,1,'5c1-cash-partial-0001',null,'quality_issue')->>'refund_ordinal','1','Exact retry returns the original refund');
select throws_ok($$select pg_temp.refund(current_setting('t.sid'),current_setting('t.p1')::uuid,2,'5c1-cash-partial-0001',null,'quality_issue')$$,'23505',null,'Changed payload under same key rejected');
select is(pg_temp.expected(current_setting('t.sid')),'20000','Cash refund reduces current register expected cash');
select is(pg_temp.refund(current_setting('t.sid'),current_setting('t.p1')::uuid,1,'5c1-cash-partial-0002',null,'other','Cliente pidió otro')->>'remaining_after_minor','5000','Second partial refund of same purchase');
select is(pg_temp.attempt(current_setting('t.sid'),current_setting('t.p1')::uuid,2,'5c1-cash-over-000001'),'REFUND_EXCEEDS_REMAINING:','Over-refund of remaining quantity rejected');
select is(pg_temp.attempt(current_setting('t.sid'),current_setting('t.p1')::uuid,1,'5c1-cash-count-000001'),'REFUND_APPROVAL_REQUIRED:count_limit','Count limit reached requires override');

-- Override on the same device: cashier initiates, Cafeteria Admin authorizes
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select throws_ok($$select pg_temp.approve(current_setting('t.sid'),current_setting('t.p1')::uuid,1,'5c1-approve-unscoped-1')$$,'42501',null,'Unscoped (other cafeteria) approver rejected');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select throws_ok($$select pg_temp.approve(current_setting('t.sid'),current_setting('t.p1')::uuid,1,'5c1-approve-self-00001')$$,'42501',null,'Cashier cannot authorize');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.a1',pg_temp.approve(current_setting('t.sid'),current_setting('t.p1')::uuid,1,'5c1-approve-admin-0001')::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select throws_ok($$select pg_temp.refund(current_setting('t.sid'),current_setting('t.p1')::uuid,1,'5c1-cash-other-reason',current_setting('t.a1')::uuid,'duplicate')$$,'23514','APPROVAL_INVALID','Approval binds reason/items');
select set_config('t.r3',pg_temp.refund(current_setting('t.sid'),current_setting('t.p1')::uuid,1,'5c1-cash-approved-001',current_setting('t.a1')::uuid)::text,true);
select is(current_setting('t.r3')::jsonb->>'authorization_mode','supervisor_approved','Override refund committed');
select is(current_setting('t.r3')::jsonb->>'remaining_after_minor','0','Purchase fully refunded through three events');
reset role;
select is((select array[(select auth_user_id::text from persons where id=actor_person_id),(select auth_user_id::text from persons where id=approver_person_id),approver_role_code,array_to_string(override_reasons,',')]
 from refunds where request_key='5c1-cash-approved-001'),array['00000000-0000-0000-0000-000000002008','00000000-0000-0000-0000-000000002003','cafeteria_admin','count_limit'],'Initiator, approver and override reason recorded');
select is((select count(*) from refunds where purchase_id=current_setting('t.p1')::uuid),3::bigint,'Three refund events reference one purchase');
select throws_ok($$update refund_items set quantity=1$$,'23514',null,'Refund items immutable');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select is(pg_temp.attempt(current_setting('t.sid'),current_setting('t.p1')::uuid,1,'5c1-cash-after-full-1'),'REFUND_EXCEEDS_REMAINING:','Fully refunded purchase cannot be refunded again');
-- Correction 1: approved refunds are part of the cashier's actual daily activity.
select is((select (x->>'cashier_used_count')||'/'||(x->>'cashier_used_amount_minor') from (select get_purchase_item_refundability(current_setting('t.sid')::uuid,(select purchase_number from purchases where id=current_setting('t.p1')::uuid)) x) q),'3/15000','Overridden refund counts toward daily count and amount');
select set_config('t.pt',pg_temp.sale('5c1-sale-cash-pt-0001',1,'cash')::text,true);
select is(pg_temp.attempt(current_setting('t.sid'),current_setting('t.pt')::uuid,1,'5c1-cash-after-limit-1'),'REFUND_APPROVAL_REQUIRED:count_limit','Threshold reached keeps requiring override');

-- Amount limit crossing; POS Supervisor authority to configure and approve
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select is(configure_cashier_refund_limits('00000000-0000-0000-0000-000000000111',2,10,12000)->>'amount_limit_minor','12000','POS Supervisor configures limits');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.p2',pg_temp.sale('5c1-sale-cash-p2-0001',2,'cash')::text,true);
select is(pg_temp.attempt(current_setting('t.sid'),current_setting('t.p2')::uuid,1,'5c1-amount-cross-0001'),'REFUND_APPROVAL_REQUIRED:amount_limit','Refund crossing amount limit requires override');
-- 2011 also holds Cafeteria Admin; suspend it so this approval is authorized purely as POS Supervisor.
reset role; update cafeteria_memberships set status='suspended' where person_id=(select id from persons where auth_user_id='00000000-0000-0000-0000-000000002011') and cafeteria_id='00000000-0000-0000-0000-000000000111' and role_code='cafeteria_admin';
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.a2',pg_temp.approve(current_setting('t.sid'),current_setting('t.p2')::uuid,1,'5c1-approve-super-0001')::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select is(pg_temp.refund(current_setting('t.sid'),current_setting('t.p2')::uuid,1,'5c1-amount-approved-01',current_setting('t.a2')::uuid)->>'approver_role','pos_supervisor','POS Supervisor authorizes override');
select throws_ok($$select pg_temp.refund(current_setting('t.sid'),current_setting('t.p2')::uuid,1,'5c1-amount-reuse-00001',current_setting('t.a2')::uuid)$$,'23514',null,'Approval is single-use');
select is((select (x->>'cashier_used_count')||'/'||(x->>'cashier_used_amount_minor') from (select get_purchase_item_refundability(current_setting('t.sid')::uuid,(select purchase_number from purchases where id=current_setting('t.p1')::uuid)) x) q),'4/20000','Approved threshold-crossing refund contributes to totals');

-- PIKAS Cash refunds
reset role; select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select configure_cashier_refund_limits('00000000-0000-0000-0000-000000000111',3,50,1000000);
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.cash_before',pg_temp.expected(current_setting('t.sid')),true);
select set_config('t.p3',pg_temp.sale('5c1-sale-wallet-p3-01',1,'wallet')::text,true);
reset role; select set_config('t.bal',(select current_balance_minor::text from student_wallets where id='00000000-0000-0000-0000-000000007001'),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select is(pg_temp.refund(current_setting('t.sid'),current_setting('t.p3')::uuid,1,'5c1-wallet-full-00001')->>'tender_type','student_wallet','Full wallet refund stays PIKAS Cash');
reset role;
select is((select current_balance_minor from student_wallets where id='00000000-0000-0000-0000-000000007001'),current_setting('t.bal')::bigint+5000,'Wallet credited');
select is((select entry_type from wallet_ledger_entries where wallet_id='00000000-0000-0000-0000-000000007001' order by balance_version_after desc limit 1),'refund','Linked refund ledger entry');
select is((select register_session_id from refunds where request_key='5c1-wallet-full-00001'),null,'Wallet refund records no register cash');
select is(pg_temp.expected(current_setting('t.sid')),current_setting('t.cash_before'),'Wallet refund leaves expected register cash unchanged');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.p4',pg_temp.sale('5c1-sale-wallet-p4-01',2,'wallet')::text,true);
select is(pg_temp.refund(current_setting('t.sid'),current_setting('t.p4')::uuid,1,'5c1-wallet-partial-001')->>'remaining_after_minor','5000','Partial wallet refund');
reset role;
select is((select current_balance_minor::numeric from student_wallets where id='00000000-0000-0000-0000-000000007001'),(select sum(amount_minor::numeric) from wallet_ledger_entries where wallet_id='00000000-0000-0000-0000-000000007001'),'Wallet balance equals ledger sum');

-- Five-minute window (DB clock seam, rolled back with the test)
create or replace function pikas_private.refund_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()+interval '6 minutes'$$;
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select is(pg_temp.attempt(current_setting('t.sid'),current_setting('t.p4')::uuid,1,'5c1-wallet-late-00001'),'REFUND_APPROVAL_REQUIRED:sale_age','After 5 minutes cashier requires override');
reset role;
create or replace function pikas_private.refund_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()$$;
select is((select sale_age_seconds<=300 and override_reasons='{}' from refunds where request_key='5c1-wallet-partial-001'),true,'Sale age captured for analytics');

-- Authority boundaries
select pg_temp.as_user('00000000-0000-0000-0000-000000002006');
select throws_ok($$select pg_temp.refund(current_setting('t.sid'),current_setting('t.p4')::uuid,1,'5c1-cross-account-001')$$,'42501',null,'Cross-account actor denied');
select throws_ok($$select get_purchase_item_refundability(current_setting('t.sid')::uuid,1)$$,'42501',null,'Cannot read another operator session');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select throws_ok($$select pg_temp.refund(current_setting('t.sid'),current_setting('t.p4')::uuid,1,'5c1-admin-direct-0001')$$,'42501',null,'Cafeteria Admin cannot impersonate the operator session');
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select throws_ok($$select pg_temp.refund(current_setting('t.sid'),current_setting('t.p4')::uuid,1,'5c1-platform-000001')$$,'42501',null,'Platform/sandbox operator has no refund authority');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select throws_ok($$select pg_temp.refund(current_setting('t.sid'),'5c100000-0000-4000-8000-0000000000ff',1,'5c1-missing-purchase')$$,'42501',null,'Unknown/foreign purchase denied');
select is((get_purchase_item_refundability(current_setting('t.sid')::uuid,(select purchase_number from purchases where id=current_setting('t.p1')::uuid))->'items'->0->>'refunded_quantity'),'3','Cumulative refund state visible to operator');
select set_config('t.p6',pg_temp.sale('5c1-sale-cash-p6-0001',3,'cash')::text,true);

-- Historical closed register is never rewritten; the supervisor's current register pays out
reset role; select set_config('t.version',(select version::text from register_sessions where id=current_setting('t.sid')::uuid),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select close_my_register_session(current_setting('t.sid')::uuid,current_setting('t.version')::integer,(pg_temp.expected(current_setting('t.sid')))::bigint,'5c1-close-cashier-0001');
reset role; select set_config('t.closed_expected',pg_temp.expected(current_setting('t.sid')),true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.sid2',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009503',10000,'5c1-open-super-000001')),true);
select is(pg_temp.refund(current_setting('t.sid2'),current_setting('t.p2')::uuid,1,'5c1-super-direct-0001')->>'authorization_mode','supervisor_direct','POS Supervisor refunds directly');
reset role;
select is(pg_temp.expected(current_setting('t.sid')),current_setting('t.closed_expected'),'Closed historical register unchanged');
select is(pg_temp.expected(current_setting('t.sid2')),'5000','Current register pays the cash refund');
select is((select register_session_id::text from refunds where request_key='5c1-super-direct-0001'),current_setting('t.sid2'),'Refund links purchase from closed session to current session');

-- Correction 2: expected cash may go negative; a cashier needs override, a supervisor acts directly.
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select is(pg_temp.refund(current_setting('t.sid2'),current_setting('t.p6')::uuid,2,'5c1-super-shortfall-01')->>'authorization_mode','supervisor_direct','Supervisor shortfall refund needs no self-approval');
reset role;
select is(pg_temp.expected(current_setting('t.sid2')),'-5000','Supervisor shortfall drives expected cash negative');
select is((select after_metadata->>'cash_shortfall' from audit_events where action='refund_committed' and target_id=(select id from refunds where request_key='5c1-super-shortfall-01')),'true','Supervisor shortfall audited');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.sid3',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009402','00000000-0000-0000-0000-000000009502',0,'5c1-open-cashier-0002')),true);
select is(pg_temp.attempt(current_setting('t.sid3'),current_setting('t.p6')::uuid,1,'5c1-cash-shortfall-01'),'REFUND_APPROVAL_REQUIRED:cash_shortfall','Cashier refund that would make expected cash negative requires override');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.a3',pg_temp.approve(current_setting('t.sid3'),current_setting('t.p6')::uuid,1,'5c1-approve-shortfall1')::text,true);
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select is(pg_temp.refund(current_setting('t.sid3'),current_setting('t.p6')::uuid,1,'5c1-cash-shortfall-01',current_setting('t.a3')::uuid)->>'override_reasons','["cash_shortfall"]','Authorized shortfall refund succeeds');
select is(pg_temp.refund(current_setting('t.sid3'),current_setting('t.p6')::uuid,1,'5c1-cash-shortfall-01',current_setting('t.a3')::uuid)->>'refund_ordinal','2','Exact retry of shortfall refund is idempotent');
reset role;
select is(pg_temp.expected(current_setting('t.sid3')),'-5000','Expected cash becomes the correct negative value');
select is((select array[(select auth_user_id::text from persons where id=actor_person_id),(select auth_user_id::text from persons where id=approver_person_id),array_to_string(override_reasons,',')]
 from refunds where request_key='5c1-cash-shortfall-01'),array['00000000-0000-0000-0000-000000002008','00000000-0000-0000-0000-000000002003','cash_shortfall'],'Shortfall initiator, approver and trigger recorded');
select is((select count(*) from refunds where request_key='5c1-cash-shortfall-01'),1::bigint,'One shortfall refund row');
select is(pg_temp.expected(current_setting('t.sid')),current_setting('t.closed_expected'),'Historical register still unchanged');
set constraints all immediate;
select * from finish();
rollback;
