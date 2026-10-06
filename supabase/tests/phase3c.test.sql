begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
-- Put this synthetic school's current local time near noon, avoiding accidental
-- midnight rollover during a short deterministic test transaction.
update public.schools set business_timezone='Etc/GMT'||case when extract(hour from clock_timestamp() at time zone 'UTC')>=12 then '+' else '-' end||abs(extract(hour from clock_timestamp() at time zone 'UTC')::integer-12)::text
 where id='00000000-0000-0000-0000-000000000011';

create function pg_temp.login(suffix text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000'||suffix,true); end $$;
create function pg_temp.sale(session_id uuid,key text,tender text default 'cash',customer uuid default null)
 returns uuid language plpgsql as $$
declare result jsonb;
begin
 result:=public.checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',session_id,
 'cafeteria_customer_id',customer,'expected_total_minor','5000',
 'items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',1,'expected_product_version',1,'expected_unit_price_minor','5000')),
 'tender',case when tender='cash' then jsonb_build_object('type','cash','cash_received_minor','10000') else jsonb_build_object('type',tender) end));
 return (result->>'purchase_id')::uuid;
end $$;
create function pg_temp.refund(purchase_key text,amount text,key text,approval uuid default null,
 reason text default 'error',notes text default null) returns jsonb language sql as $$
 select public.create_purchase_refund(current_setting('p3c.'||purchase_key)::uuid,amount,reason,notes,key,
 '00000000-0000-0000-0000-000000004601',case when purchase_key='cash' then current_setting('p3c.session')::uuid else null end,approval)
$$;
select has_table('public','refunds','refunds exists');
select ok((select relrowsecurity from pg_class where oid='public.refunds'::regclass),'refunds has RLS');
select ok(not has_table_privilege('anon','public.refunds','INSERT,UPDATE,DELETE,TRUNCATE'),'anon has no direct refunds writes');
select ok(not has_table_privilege('authenticated','public.refunds','INSERT,UPDATE,DELETE,TRUNCATE'),'authenticated has no direct refunds writes');
select ok(not has_table_privilege('service_role','public.refunds','INSERT,UPDATE,DELETE,TRUNCATE'),'service_role has no direct refunds writes');
select has_table('public','refund_cash_outflows','refund_cash_outflows exists');
select ok((select relrowsecurity from pg_class where oid='public.refund_cash_outflows'::regclass),'refund_cash_outflows has RLS');
select ok(not has_table_privilege('anon','public.refund_cash_outflows','INSERT,UPDATE,DELETE,TRUNCATE'),'anon has no direct refund_cash_outflows writes');
select ok(not has_table_privilege('authenticated','public.refund_cash_outflows','INSERT,UPDATE,DELETE,TRUNCATE'),'authenticated has no direct refund_cash_outflows writes');
select ok(not has_table_privilege('service_role','public.refund_cash_outflows','INSERT,UPDATE,DELETE,TRUNCATE'),'service_role has no direct refund_cash_outflows writes');
select has_table('public','wallet_refund_credits','wallet_refund_credits exists');
select ok((select relrowsecurity from pg_class where oid='public.wallet_refund_credits'::regclass),'wallet_refund_credits has RLS');
select ok(not has_table_privilege('anon','public.wallet_refund_credits','INSERT,UPDATE,DELETE,TRUNCATE'),'anon has no direct wallet_refund_credits writes');
select ok(not has_table_privilege('authenticated','public.wallet_refund_credits','INSERT,UPDATE,DELETE,TRUNCATE'),'authenticated has no direct wallet_refund_credits writes');
select ok(not has_table_privilege('service_role','public.wallet_refund_credits','INSERT,UPDATE,DELETE,TRUNCATE'),'service_role has no direct wallet_refund_credits writes');
select has_table('public','financial_approvals','financial_approvals exists');
select ok((select relrowsecurity from pg_class where oid='public.financial_approvals'::regclass),'financial_approvals has RLS');
select ok(not has_table_privilege('anon','public.financial_approvals','INSERT,UPDATE,DELETE,TRUNCATE'),'anon has no direct financial_approvals writes');
select ok(not has_table_privilege('authenticated','public.financial_approvals','INSERT,UPDATE,DELETE,TRUNCATE'),'authenticated has no direct financial_approvals writes');
select ok(not has_table_privilege('service_role','public.financial_approvals','INSERT,UPDATE,DELETE,TRUNCATE'),'service_role has no direct financial_approvals writes');
select has_table('public','cafeteria_refund_policies','cafeteria_refund_policies exists');
select ok((select relrowsecurity from pg_class where oid='public.cafeteria_refund_policies'::regclass),'cafeteria_refund_policies has RLS');
select ok(not has_table_privilege('anon','public.cafeteria_refund_policies','INSERT,UPDATE,DELETE,TRUNCATE'),'anon has no direct cafeteria_refund_policies writes');
select ok(not has_table_privilege('authenticated','public.cafeteria_refund_policies','INSERT,UPDATE,DELETE,TRUNCATE'),'authenticated has no direct cafeteria_refund_policies writes');
select ok(not has_table_privilege('service_role','public.cafeteria_refund_policies','INSERT,UPDATE,DELETE,TRUNCATE'),'service_role has no direct cafeteria_refund_policies writes');

select is((select count(*) from public.cafeteria_refund_policies),4::bigint,'Existing cafeterias automatically have policies');
select is((select count(*) from public.cafeteria_refund_policies where supervisor_override_enabled and daily_independent_refund_allowance_minor=0 and currency_code='DOP' and version=1),4::bigint,'Policies have locked safe defaults');
select is((select count(*) from public.refunds),0::bigint,'No fabricated refunds');
select ok(to_regclass('public.cafeteria_refund_counters') is null,'No cafeteria-wide refund counter');
select ok(to_regclass('public.refund_items') is null,'No item refund allocation');
select pg_temp.login('2002');
set local role authenticated;
select lives_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',20000,'phase3c-wallet-funding-0001','synthetic funding','local evidence',null)$$,'Synthetic wallet funding through frozen RPC');
reset role;
select pg_temp.login('2008');
set local role authenticated;
select set_config('p3c.session',(select session_id::text from public.open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',0,'phase3c-open-session-0001')),true);
select set_config('p3c.cash',pg_temp.sale(current_setting('p3c.session')::uuid,'phase3c-cash-purchase-0001')::text,true);
select set_config('p3c.wallet',pg_temp.sale(current_setting('p3c.session')::uuid,'phase3c-wallet-purchase-0001','student_wallet','00000000-0000-0000-0000-000000006901')::text,true);
select throws_ok($$select pg_temp.refund('cash','1000','phase3c-default-requires-0001')$$,'42501','REFUND_APPROVAL_REQUIRED','Default allowance zero requires approval');
reset role;
select is((select count(*) from public.refunds),0::bigint,'Approval-required writes no refund');
select pg_temp.login('2003');
set local role authenticated;
select is(public.configure_cafeteria_refund_policy('00000000-0000-0000-0000-000000000111',1,true,3000),2,'Admin versioned policy update');
select throws_ok($$select public.configure_cafeteria_refund_policy('00000000-0000-0000-0000-000000000111',1,false,0)$$,'40001','POLICY_VERSION_CONFLICT','Stale policy rejected');
select throws_ok($$select pg_temp.refund('cash','1000','phase3c-admin-no-refund-01')$$,'42501','PURCHASE_NOT_FOUND_OR_NOT_AUTHORIZED','Admin has no implied create');
reset role;
select pg_temp.login('2008');
set local role authenticated;
select set_config('p3c.first',pg_temp.refund('cash','1000','phase3c-independent-first-01')->>'refund_id',true);
select is(pg_temp.refund('cash','1000','phase3c-independent-first-01')->>'refund_id',current_setting('p3c.first'),'Exact idempotent replay');
select throws_ok($$select pg_temp.refund('cash','1001','phase3c-independent-first-01')$$,'23505','IDEMPOTENCY_CONFLICT','Changed amount conflicts');
select throws_ok($$select pg_temp.refund('cash','0','phase3c-zero-refund-key-01')$$,'22023','INVALID_REFUND_AMOUNT','Zero rejected');
select throws_ok($$select pg_temp.refund('cash','-1','phase3c-negative-refund-01')$$,'22023','INVALID_REFUND_AMOUNT','Negative rejected');
select throws_ok($$select pg_temp.refund('cash','100','phase3c-invalid-reason-01',null,'unknown')$$,'22023','INVALID_REFUND_REASON','Reason constrained');
select throws_ok($$select pg_temp.refund('cash','100','phase3c-other-no-notes-01',null,'other','  ')$$,'22023','INVALID_REFUND_NOTES','Other requires meaningful notes');
select throws_ok($$select pg_temp.refund('cash','100','phase3c-whitespace-notes-01',null,'other',E' \f\013 ')$$,'22023','INVALID_REFUND_NOTES','ASCII whitespace-only other notes are blank');
select throws_ok($$select pg_temp.refund('cash','100','phase3c-long-notes-key-01',null,'error',repeat('x',501))$$,'22023','INVALID_REFUND_NOTES','Notes bounded');
select throws_ok($$select pg_temp.refund('cash','5000','phase3c-over-remaining-01')$$,'23514','REFUND_EXCEEDS_REMAINING','Ceiling uses purchase total');
select throws_ok($$select public.configure_cafeteria_refund_policy('00000000-0000-0000-0000-000000000111',2,false,0)$$,'42501','REFUND_NOT_AUTHORIZED','Cashier cannot configure');
reset role;
select is((select refund_ordinal from public.refunds where id=current_setting('p3c.first')::uuid),1::bigint,'First purchase ordinal');
select is((select amount_minor from public.refund_cash_outflows where refund_id=current_setting('p3c.first')::uuid),1000::bigint,'Cash outflow exact amount');
select is((select total_minor from public.purchases where id=current_setting('p3c.cash')::uuid),5000::bigint,'Original sale unchanged');
select is((select current_balance_minor from public.student_wallets where id='00000000-0000-0000-0000-000000007001'),15000::bigint,'Cash refund does not touch wallet');
select pg_temp.login('2011');
set local role authenticated;
select set_config('p3c.approval',(public.create_purchase_refund_approval(current_setting('p3c.wallet')::uuid,'2000','other','  customer request  ',
 'phase3c-approval-issuance-01','00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000004603')->>'approval_id'),true);
select is(public.create_purchase_refund_approval(current_setting('p3c.wallet')::uuid,'2000','other','customer request',
 'phase3c-approval-issuance-01','00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000004603')->>'approval_id',current_setting('p3c.approval'),'Approval issuance retries normalize notes');
select throws_ok($$select public.create_purchase_refund_approval(current_setting('p3c.wallet')::uuid,'2001','other','customer request',
 'phase3c-approval-issuance-01','00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000004603')$$,'23505','IDEMPOTENCY_CONFLICT','Changed issuance proposal conflicts');
reset role;
select pg_temp.login('2008');
set local role authenticated;
select throws_ok($$select pg_temp.refund('wallet','2001','phase3c-wrong-approved-01',current_setting('p3c.approval')::uuid,'other','customer request')$$,'23514','APPROVAL_INVALID','Approval binds exact amount');
select set_config('p3c.wallet_refund',pg_temp.refund('wallet','2000','phase3c-DIFFERENT-transport-key',current_setting('p3c.approval')::uuid,'other','customer request')->>'refund_id',true);
select is(pg_temp.refund('wallet','2000','phase3c-DIFFERENT-transport-key',current_setting('p3c.approval')::uuid,'other','customer request')->>'refund_id',current_setting('p3c.wallet_refund'),'Approved refund replay');
select throws_ok($$select pg_temp.refund('wallet','2000','phase3c-approval-reuse-key-01',current_setting('p3c.approval')::uuid,'other','customer request')$$,'23514','APPROVAL_ALREADY_USED','Approval single use across transport keys');
reset role;

set constraints all immediate;
set constraints all deferred;
select is((select current_balance_minor from public.student_wallets where id='00000000-0000-0000-0000-000000007001'),17000::bigint,'Wallet credit appends current balance');
select is((select balance_version from public.student_wallets where id='00000000-0000-0000-0000-000000007001'),3::bigint,'Balance version advances once');
select is((select count(*) from public.wallet_refund_credits),1::bigint,'Exactly one typed credit');
select is((select amount_minor from public.wallet_ledger_entries where entry_type='refund'),2000::bigint,'Positive ledger matches refund');
select is((select sum(amount_minor)::bigint from public.student_daily_spend_events),3000::bigint,'Same-day usage restores exact value');
select is((select sum(amount_minor)::bigint from public.refunds where authorization_mode='independent'),1000::bigint,'Approved refund does not consume independent allowance');
select is((select notes from public.refunds where id=current_setting('p3c.wallet_refund')::uuid),'customer request','Notes outer whitespace normalized');
select is((select consumed_refund_id::text from public.financial_approvals where id=current_setting('p3c.approval')::uuid),current_setting('p3c.wallet_refund'),'Approval atomically linked');
select pg_temp.login('2002');
set local role authenticated;
select lives_ok($$select public.set_student_wallet_status('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000007001','frozen')$$,'Frozen wallet status through existing RPC');
reset role;
select pg_temp.login('2011');
set local role authenticated;
select lives_ok($$select public.create_purchase_refund(current_setting('p3c.wallet')::uuid,'1000','error',null,'phase3c-frozen-direct-key-01',
 '00000000-0000-0000-0000-000000004603')$$,'Supervisor direct refunds frozen wallet without session');
reset role;

set constraints all immediate;
set constraints all deferred;
select is((select status from public.student_wallets where id='00000000-0000-0000-0000-000000007001'),'frozen','Refund leaves wallet frozen');
select is((select current_balance_minor from public.student_wallets where id='00000000-0000-0000-0000-000000007001'),18000::bigint,'Frozen wallet received historical value');
select pg_temp.login('2008');
set local role authenticated;
select lives_ok($$select pg_temp.refund('wallet','2000','phase3c-DIFFERENT-transport-key',current_setting('p3c.approval')::uuid,'other','customer request')$$,'Replay survives wallet freeze');
select is((select count(*) from public.financial_approvals),1::bigint,'Requester sees own approval');
select is((select count(*) from public.refunds),2::bigint,'Cashier sees only own refunds');
reset role;
select pg_temp.login('2002');
set local role authenticated;
select is((select count(*) from public.refunds),0::bigint,'School Admin has no refund history');
select is((select count(*) from public.wallet_refund_credits),0::bigint,'School Admin has no refund child history');
select is((select count(*) from public.financial_approvals),0::bigint,'School Admin has no approvals');
select is((select count(*) from public.wallet_ledger_entries where entry_type='refund'),2::bigint,'Frozen wallet-read visibility retained');
reset role;
select ok(not exists(select 1 from public.audit_events where action like 'refund%' and after_metadata::text like '%customer request%'),'Audit does not duplicate notes');
select ok(not exists(select 1 from public.audit_events where action like 'refund%' and (after_metadata ? 'wallet_balance' or after_metadata ? 'amount_minor')),'Audit excludes balances and refund amounts');
select throws_ok($$update public.refunds set notes='changed' where id=current_setting('p3c.first')::uuid$$,'23514',null,'Notes immutable even privileged');
select throws_ok($$delete from public.refunds where id=current_setting('p3c.first')::uuid$$,'23514',null,'Refund deletion prohibited');
select throws_ok($$truncate public.refunds cascade$$,'23514',null,'Financial truncate prohibited');
select is((select sum(amount_minor)::bigint from public.wallet_ledger_entries),18000::bigint,'Ledger reconciles current wallet');

select ok(not exists(select 1 from pikas_private.role_capabilities where capability like '%refund%' and role_code in ('school_admin','account_admin','pos_operator','backoffice')),'No implied administrative or reserved authority');
select is((select count(*) from pikas_private.role_capabilities where role_code='pos_cashier' and capability like '%refund%'),2::bigint,'Cashier create and own-read only');
select is((select count(*) from pikas_private.role_capabilities where role_code='pos_supervisor' and capability like '%refund%'),5::bigint,'Supervisor explicit operational capability set');
select is((select count(*) from pikas_private.role_capabilities where role_code='cafeteria_admin' and capability like '%refund%'),2::bigint,'Admin read and configure only');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pikas_private' and p.proname like '%refund%' and p.proname<>'can_read_refund' and has_function_privilege('authenticated',p.oid,'EXECUTE')),'Private refund helpers are not callable');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pikas_private' and p.prosecdef and not ('search_path=""'=any(p.proconfig))),'Definers have empty search paths');
select ok(not exists(select 1 from pg_policies where schemaname='public' and cmd<>'SELECT'),'No write RLS policies added');
select ok(not exists(select 1 from information_schema.columns where table_name='financial_approvals' and column_name in ('refund_request_key','notes','permission_blob')),'Approval has semantic binding without transport key or plaintext notes');
select ok(not exists(select 1 from information_schema.columns where table_name='purchases' and column_name in ('refunded','status','remaining_refundable')),'Original purchase schema has no refund state');
select lives_ok($$insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name) values('00000000-0000-0000-0000-000000000116','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000211','REFUND-TEST','Synthetic refund policy test')$$,'Future cafeteria initializes policy');
select is((select count(*) from public.cafeteria_refund_policies where cafeteria_id='00000000-0000-0000-0000-000000000116' and version=1 and supervisor_override_enabled and daily_independent_refund_allowance_minor=0),1::bigint,'Future policy safe defaults');
update public.cafeteria_memberships set status='suspended' where id='00000000-0000-0000-0000-000000003205';
select pg_temp.login('2011');
set local role authenticated;
select throws_ok($$select public.configure_cafeteria_refund_policy('00000000-0000-0000-0000-000000000113',1,false,0)$$,'42501','REFUND_NOT_AUTHORIZED','Operational Supervisor alone cannot configure');
reset role;
-- The multi-cafeteria fixture is also an Admin at 113, so the preceding
-- permission test uses its operational role after temporarily removing Admin.
select pg_temp.login('2008');
set local role authenticated;
select throws_ok($$select public.create_purchase_refund(current_setting('p3c.wallet')::uuid,'1','error',null,'phase3c-wrong-membership-01','00000000-0000-0000-0000-000000004602')$$,'42501','REFUND_NOT_AUTHORIZED','Sibling cafeteria membership cannot authorize');
select throws_ok($$select pg_temp.refund('wallet','9223372036854775808','phase3c-amount-overflow-01')$$,'22003','REFUND_AMOUNT_OUT_OF_RANGE','Amount parsing cannot overflow');
select ok(not (public.get_purchase_refundability(current_setting('p3c.wallet')::uuid) ?| array['customer_name','items','wallet_id','family_id','wallet_balance']),'Refundability projection minimizes data');
reset role;
select pg_temp.login('2011');
set local role authenticated;
select set_config('p3c.pending',public.create_purchase_refund_approval(current_setting('p3c.cash')::uuid,'500','error',null,'phase3c-revoke-issuance-01','00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000004603',current_setting('p3c.session')::uuid)->>'approval_id',true);
select set_config('p3c.revoked_result',public.revoke_financial_approval(current_setting('p3c.pending')::uuid)::text,true);
select is(public.revoke_financial_approval(current_setting('p3c.pending')::uuid)::text,current_setting('p3c.revoked_result'),'Revocation retries are stable');
select throws_ok($$select public.revoke_financial_approval(current_setting('p3c.approval')::uuid)$$,'23514','APPROVAL_ALREADY_USED','Cannot revoke consumed approval');
reset role;
select pg_temp.login('2008');
set local role authenticated;
select throws_ok($$select pg_temp.refund('cash','500','phase3c-revoked-action-01',current_setting('p3c.pending')::uuid)$$,'23514','APPROVAL_INVALID','Revoked approval cannot authorize');
reset role;
-- Cash full refund and replay after closure/configuration change.
select pg_temp.login('2003');
set local role authenticated;
select is(public.configure_cafeteria_refund_policy('00000000-0000-0000-0000-000000000111',2,false,0),3,'Override OFF removes additional gate');
reset role;
select pg_temp.login('2008');
set local role authenticated;
select set_config('p3c.cash_full',pg_temp.refund('cash','4000','phase3c-full-cash-refund-01')->>'refund_id',true);
select throws_ok($$select pg_temp.refund('cash','1','phase3c-already-full-key-01')$$,'23514','NOT_REFUNDABLE','Fully refunded purchase rejects new refund');
select lives_ok($$select public.close_my_register_session(current_setting('p3c.session')::uuid,1,0,'phase3c-close-session-key-01')$$,'Actor closes current session');
select lives_ok($$select pg_temp.refund('cash','4000','phase3c-full-cash-refund-01')$$,'Replay survives session closure');
reset role;
select is((select sum(amount_minor)::bigint from public.refunds where purchase_id=current_setting('p3c.cash')::uuid),5000::bigint,'Full refund ceiling equals total, not cash received');
select is((select max(refund_ordinal) from public.refunds where purchase_id=current_setting('p3c.cash')::uuid),2::bigint,'Purchase-scoped ordinal increments');
select is((select sum(amount_minor)::bigint from public.refunds where authorization_mode='independent'),5000::bigint,'Override OFF independent usage remains counted');
select pg_temp.login('2003');
set local role authenticated;
select is(public.configure_cafeteria_refund_policy('00000000-0000-0000-0000-000000000111',3,true,0),4,'Override ON preserves previous usage');
reset role;
select pg_temp.login('2008');
set local role authenticated;
select lives_ok($$select pg_temp.refund('cash','4000','phase3c-full-cash-refund-01')$$,'Replay survives policy change');
reset role;
-- Lifecycle changes use frozen RPCs and preserve original destination.
select pg_temp.login('2002');
set local role authenticated;
select lives_ok($$select public.withdraw_student_enrollment('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005302',current_date)$$,'Synthetic student withdrawn through frozen RPC');
select lives_ok($$select public.deactivate_cafeteria_customer('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006901')$$,'Historical customer deactivated');
reset role;
update public.school_cafeteria_shares set status='revoked' where cafeteria_id='00000000-0000-0000-0000-000000000111';
select pg_temp.login('2011');
set local role authenticated;
select lives_ok($$select public.create_purchase_refund(current_setting('p3c.wallet')::uuid,'500','error',null,'phase3c-withdrawn-refund-01','00000000-0000-0000-0000-000000004603')$$,'Withdrawn student/inactive customer/revoked share still receives historical refund');
reset role;
select pg_temp.login('2002');
set local role authenticated;
select lives_ok($$select public.enroll_student('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',current_date,'00000000-0000-0000-0000-000000000211','Synthetic grade')$$,'Student re-enrolled at another campus');
reset role;
select pg_temp.login('2011');
set local role authenticated;
select lives_ok($$select public.create_purchase_refund(current_setting('p3c.wallet')::uuid,'500','error',null,'phase3c-reenrolled-refund-01','00000000-0000-0000-0000-000000004603')$$,'Re-enrollment/campus move preserves original wallet');
reset role;
select is((select count(distinct wallet_id) from public.wallet_refund_credits),1::bigint,'All credits retain original wallet');
select is((select count(*) from public.wallet_purchase_debits),1::bigint,'Original debit remains one immutable operation');
select is((select amount_minor from public.wallet_ledger_entries where entry_type='purchase'),-5000::bigint,'Original negative debit ledger unchanged');
select is((select amount_minor from public.student_daily_spend_events where event_type='purchase'),5000::bigint,'Original positive usage unchanged');
select is((select sum(amount_minor)::bigint from public.wallet_ledger_entries),(select current_balance_minor from public.student_wallets where id='00000000-0000-0000-0000-000000007001'),'Ledger reconciles after lifecycle refunds');
select pg_temp.login('2008');
set local role authenticated;
select throws_ok($$insert into public.refunds default values$$,'42501',null,'Direct refunds insert denied');
select throws_ok($$delete from public.refunds where false$$,'42501',null,'Direct refunds delete denied');
reset role;
select pg_temp.login('2008');
set local role authenticated;
select throws_ok($$insert into public.refund_cash_outflows default values$$,'42501',null,'Direct refund_cash_outflows insert denied');
select throws_ok($$delete from public.refund_cash_outflows where false$$,'42501',null,'Direct refund_cash_outflows delete denied');
reset role;
select pg_temp.login('2008');
set local role authenticated;
select throws_ok($$insert into public.wallet_refund_credits default values$$,'42501',null,'Direct wallet_refund_credits insert denied');
select throws_ok($$delete from public.wallet_refund_credits where false$$,'42501',null,'Direct wallet_refund_credits delete denied');
reset role;
select pg_temp.login('2008');
set local role authenticated;
select throws_ok($$insert into public.financial_approvals default values$$,'42501',null,'Direct financial_approvals insert denied');
select throws_ok($$delete from public.financial_approvals where false$$,'42501',null,'Direct financial_approvals delete denied');
reset role;
select pg_temp.login('2008');
set local role authenticated;
select throws_ok($$insert into public.cafeteria_refund_policies default values$$,'42501',null,'Direct cafeteria_refund_policies insert denied');
select throws_ok($$delete from public.cafeteria_refund_policies where false$$,'42501',null,'Direct cafeteria_refund_policies delete denied');
reset role;
select ok(has_function_privilege('authenticated','public.create_purchase_refund(uuid,text,text,text,text,uuid,uuid,uuid)','EXECUTE') and not has_function_privilege('anon','public.create_purchase_refund(uuid,text,text,text,text,uuid,uuid,uuid)','EXECUTE') and not has_function_privilege('service_role','public.create_purchase_refund(uuid,text,text,text,text,uuid,uuid,uuid)','EXECUTE'),'Narrow ACL: public.create_purchase_refund');
select ok(has_function_privilege('authenticated','public.create_purchase_refund_approval(uuid,text,text,text,text,uuid,uuid,uuid)','EXECUTE') and not has_function_privilege('anon','public.create_purchase_refund_approval(uuid,text,text,text,text,uuid,uuid,uuid)','EXECUTE') and not has_function_privilege('service_role','public.create_purchase_refund_approval(uuid,text,text,text,text,uuid,uuid,uuid)','EXECUTE'),'Narrow ACL: public.create_purchase_refund_approval');
select ok(has_function_privilege('authenticated','public.configure_cafeteria_refund_policy(uuid,integer,boolean,bigint)','EXECUTE') and not has_function_privilege('anon','public.configure_cafeteria_refund_policy(uuid,integer,boolean,bigint)','EXECUTE') and not has_function_privilege('service_role','public.configure_cafeteria_refund_policy(uuid,integer,boolean,bigint)','EXECUTE'),'Narrow ACL: public.configure_cafeteria_refund_policy');
select ok(has_function_privilege('authenticated','public.revoke_financial_approval(uuid)','EXECUTE') and not has_function_privilege('anon','public.revoke_financial_approval(uuid)','EXECUTE') and not has_function_privilege('service_role','public.revoke_financial_approval(uuid)','EXECUTE'),'Narrow ACL: public.revoke_financial_approval');
select ok(has_function_privilege('authenticated','public.get_purchase_refundability(uuid)','EXECUTE') and not has_function_privilege('anon','public.get_purchase_refundability(uuid)','EXECUTE') and not has_function_privilege('service_role','public.get_purchase_refundability(uuid)','EXECUTE'),'Narrow ACL: public.get_purchase_refundability');


-- Sibling approvals cannot fund the same proposal twice; fresh consent after a
-- matching commit can authorize another identical partial amount.
select pg_temp.login('2003');
set local role authenticated;
select lives_ok($$select public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000001003','pos_supervisor','active')$$,'Admin explicitly obtains a separate POS Supervisor membership');
reset role;
select set_config('p3c.second_supervisor',(select id::text from public.cafeteria_memberships where person_id='00000000-0000-0000-0000-000000001003' and cafeteria_id='00000000-0000-0000-0000-000000000111' and role_code='pos_supervisor'),true);
select pg_temp.login('2011');
set local role authenticated;
select set_config('p3c.sibling1',public.create_purchase_refund_approval(current_setting('p3c.wallet')::uuid,'100','error',null,'phase3c-sibling-issue-01','00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000004603')->>'approval_id',true);
reset role;
select pg_temp.login('2003');
set local role authenticated;
select set_config('p3c.sibling2',public.create_purchase_refund_approval(current_setting('p3c.wallet')::uuid,'100','error',null,'phase3c-sibling-issue-02','00000000-0000-0000-0000-000000004601',current_setting('p3c.second_supervisor')::uuid)->>'approval_id',true);
reset role;
select pg_temp.login('2008');
set local role authenticated;
select lives_ok($$select pg_temp.refund('wallet','100','phase3c-sibling-action-01',current_setting('p3c.sibling1')::uuid)$$,'First matching proposal commits');
select throws_ok($$select pg_temp.refund('wallet','100','phase3c-sibling-action-02',current_setting('p3c.sibling2')::uuid)$$,'23514','APPROVAL_INVALID','Sibling consent cannot fund the same proposal again');
reset role;
select ok((select consumed_refund_id is null from public.financial_approvals where id=current_setting('p3c.sibling2')::uuid),'Failed sibling approval remains unconsumed');
select pg_temp.login('2011');
set local role authenticated;
select is(public.create_purchase_refund_approval(current_setting('p3c.wallet')::uuid,'100','error',null,'phase3c-sibling-issue-01','00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000004603')->>'approval_id',current_setting('p3c.sibling1'),'Issuance replay retains original approval after matching refund');
select set_config('p3c.fresh',public.create_purchase_refund_approval(current_setting('p3c.wallet')::uuid,'100','error',null,'phase3c-fresh-issue-01','00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000004603')->>'approval_id',true);
reset role;
select pg_temp.login('2008');
set local role authenticated;
select lives_ok($$select pg_temp.refund('wallet','100','phase3c-fresh-action-01',current_setting('p3c.fresh')::uuid)$$,'Fresh consent after commit permits identical later partial refund');
reset role;
select ok((select prior_matching_refund_id is not null from public.financial_approvals where id=current_setting('p3c.fresh')::uuid),'Fresh consent binds committed financial history without transport key');
-- A customer Auth identity is optional and unlinking it preserves history.
insert into auth.users(id,aud,role,email) values('00000000-0000-0000-0000-000000099991','authenticated','authenticated','refund-customer@example.invalid');
update public.persons set auth_user_id='00000000-0000-0000-0000-000000099991' where id='00000000-0000-0000-0000-000000005101';
delete from auth.users where id='00000000-0000-0000-0000-000000099991';
select ok((select auth_user_id is null from public.persons where id='00000000-0000-0000-0000-000000005101'),'Auth deletion unlinks customer identity');
select pg_temp.login('2011');
set local role authenticated;
select lives_ok($$select public.create_purchase_refund(current_setting('p3c.wallet')::uuid,'1','error',null,'phase3c-unlinked-refund-01','00000000-0000-0000-0000-000000004603')$$,'Historical refund survives customer Auth deletion');
reset role;
-- Privileged malformed source writes still fail trigger/FK invariants.
select throws_ok($$update public.wallet_refund_credits set amount_minor=amount_minor+1$$,'23514','purchase_financial_history_is_immutable','Wallet refund sources are immutable');
select throws_ok($$update public.refund_cash_outflows set amount_minor=amount_minor+1$$,'23514','purchase_financial_history_is_immutable','Cash outflow sources are immutable');
-- Selected memberships do not merge capabilities from another role.
select pg_temp.login('2003');
set local role authenticated;
select lives_ok($$select public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000001008','pos_supervisor','active')$$,'Cashier person receives separate explicit Supervisor membership');
reset role;
select set_config('p3c.self_supervisor',(select id::text from public.cafeteria_memberships where person_id='00000000-0000-0000-0000-000000001008' and cafeteria_id='00000000-0000-0000-0000-000000000111' and role_code='pos_supervisor'),true);
select pg_temp.login('2008');
set local role authenticated;
select throws_ok($$select public.create_purchase_refund_approval(current_setting('p3c.wallet')::uuid,'1','error',null,'phase3c-self-issue-key-01','00000000-0000-0000-0000-000000004601',current_setting('p3c.self_supervisor')::uuid)$$,'42501','SELF_APPROVAL_NOT_ALLOWED','Different memberships cannot self approve same person');
select throws_ok($$select pg_temp.refund('wallet','1','phase3c-selected-cashier-01')$$,'42501','REFUND_APPROVAL_REQUIRED','Selected Cashier does not inherit same person Supervisor direct');
select lives_ok($$select public.create_purchase_refund(current_setting('p3c.wallet')::uuid,'1','error',null,'phase3c-selected-supervisor-01',current_setting('p3c.self_supervisor')::uuid)$$,'Explicit Supervisor membership can perform direct refund');
reset role;
select pg_temp.login('2001');
set local role authenticated;
select throws_ok($$select pg_temp.refund('wallet','1','phase3c-account-denied-01')$$,'42501','PURCHASE_NOT_FOUND_OR_NOT_AUTHORIZED','Account Admin has no implicit refund capability');
select is((select count(*) from public.refunds),0::bigint,'Account Admin cannot read refund root');
reset role;
select pg_temp.login('2012');
set local role authenticated;
select throws_ok($$select pg_temp.refund('wallet','1','phase3c-staff-denied-key-01')$$,'42501','PURCHASE_NOT_FOUND_OR_NOT_AUTHORIZED','Staff identity has no refund authority');
select is((select count(*) from public.refunds),0::bigint,'Staff cannot read refund root');
reset role;
-- Owner-only database clock fixture crosses a future New York DST repeat.
-- Production exposes no caller timestamp or timezone override.
select set_config('p3c.old_zone',(select business_timezone from public.schools where id='00000000-0000-0000-0000-000000000011'),true);
update public.schools set business_timezone='America/New_York' where id='00000000-0000-0000-0000-000000000011';
select set_config('p3c.dst_day',(select (make_date(extract(year from current_date)::integer+1,11,1)+(7-extract(dow from make_date(extract(year from current_date)::integer+1,11,1))::integer)%7)::text),true);
do $$begin execute format('create or replace function pikas_private.refund_clock() returns timestamptz language sql volatile set search_path='''' as %L',format('select %L::timestamptz',current_setting('p3c.dst_day')||' 05:30:00+00')); end $$;
select pg_temp.login('2011');
set local role authenticated;
select set_config('p3c.dst1',public.create_purchase_refund(current_setting('p3c.wallet')::uuid,'1','error',null,'phase3c-dst-repeat-action-01','00000000-0000-0000-0000-000000004603')->>'refund_id',true);
reset role;
do $$begin execute format('create or replace function pikas_private.refund_clock() returns timestamptz language sql volatile set search_path='''' as %L',format('select %L::timestamptz',current_setting('p3c.dst_day')||' 06:30:00+00')); end $$;
set local role authenticated;
select set_config('p3c.dst2',public.create_purchase_refund(current_setting('p3c.wallet')::uuid,'1','error',null,'phase3c-dst-repeat-action-02','00000000-0000-0000-0000-000000004603')->>'refund_id',true);
reset role;
select is((select count(distinct business_date) from public.refunds where id in(current_setting('p3c.dst1')::uuid,current_setting('p3c.dst2')::uuid)),1::bigint,'Repeated DST hour has one authoritative business date');
select is((select count(distinct occurred_at) from public.refunds where id in(current_setting('p3c.dst1')::uuid,current_setting('p3c.dst2')::uuid)),2::bigint,'Repeated DST hour retains distinct authoritative instants');
select is((select count(*) from public.student_daily_spend_events where refund_id in(current_setting('p3c.dst1')::uuid,current_setting('p3c.dst2')::uuid)),0::bigint,'Later-date refunds create no compensation on either day');
select ok((select bool_and(business_timezone_snapshot='America/New_York') from public.refunds where id in(current_setting('p3c.dst1')::uuid,current_setting('p3c.dst2')::uuid)),'Refunds store IANA timezone snapshot');
create or replace function pikas_private.refund_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()$$;
update public.schools set business_timezone=current_setting('p3c.old_zone') where id='00000000-0000-0000-0000-000000000011';

select pg_temp.login('2008');
set local role authenticated;
select set_config('p3c.zero_session',(select session_id::text from public.open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',0,'phase3c-zero-open-key-01')),true);
select set_config('p3c.zero_purchase',public.checkout_purchase(jsonb_build_object('request_key','phase3c-zero-checkout-key-01','register_session_id',current_setting('p3c.zero_session'),'cafeteria_customer_id',null,'expected_total_minor','0','items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008104','quantity',1,'expected_product_version',1,'expected_unit_price_minor','0')),'tender',jsonb_build_object('type','cash','cash_received_minor','0')))->>'purchase_id',true);
select throws_ok($$select public.create_purchase_refund(current_setting('p3c.zero_purchase')::uuid,'1','error',null,'phase3c-zero-total-action-01','00000000-0000-0000-0000-000000004601',current_setting('p3c.zero_session')::uuid)$$,'23514','NOT_REFUNDABLE','Zero-total purchase is never refundable');
reset role;
-- Changed ancestry and destinations are rejected by actual structural writes.
create function pg_temp.malformed_refund(kind text) returns void language plpgsql as $$
declare r public.refunds; c public.wallet_refund_credits; p public.purchases;
begin
 select * into r from public.refunds where request_key='phase3c-unlinked-refund-01';
 select * into c from public.wallet_refund_credits where refund_id=r.id;
 select * into p from public.purchases where id=r.purchase_id;
 r.id:=gen_random_uuid(); r.request_key:='phase3c-malformed-'||kind; r.amount_minor:=1;
 r.refund_ordinal:=(select max(refund_ordinal)+1 from public.refunds where purchase_id=r.purchase_id);
 r.remaining_after_minor:=(select p.total_minor-coalesce(sum(amount_minor),0)-1 from public.refunds where purchase_id=p.id);
 r.occurred_at:=clock_timestamp(); r.business_timezone_snapshot:=(select business_timezone from public.schools where id=r.school_id);
 r.business_date:=(r.occurred_at at time zone r.business_timezone_snapshot)::date;
 r.semantic_fingerprint:=pikas_private.refund_semantic(r.purchase_id,r.actor_membership_id,r.actor_person_id,r.amount_minor,r.currency_code,r.tender_type,r.reason,r.notes,r.register_session_id,r.cafeteria_id);
 r.payload_fingerprint:=pikas_private.refund_hash(jsonb_build_object('semantic',r.semantic_fingerprint,'approval_id',r.approval_id));
 select id into r.prior_matching_refund_id from public.refunds where purchase_id=r.purchase_id and semantic_fingerprint=r.semantic_fingerprint order by refund_ordinal desc limit 1;
 if kind='ancestry' then r.school_location_id:='00000000-0000-0000-0000-000000000213';
 elsif kind='ordinal' then r.refund_ordinal:=9223372036854775807;
 elsif kind='cash-substitution' then r.tender_type:='cash';
 elsif kind='ceiling' then r.amount_minor:=p.total_minor+1;
 end if;
 insert into public.refunds select r.*;
 c.id:=gen_random_uuid();c.refund_id:=r.id;c.amount_minor:=r.amount_minor;c.posted_at:=r.occurred_at;
 if kind='amount' then c.amount_minor:=2;
 elsif kind='currency' then c.currency_code:='USD';
 elsif kind='student' then c.student_id:='00000000-0000-0000-0000-000000005202';
 elsif kind='wallet' then c.wallet_id:='00000000-0000-0000-0000-000000099999';
 elsif kind='cash-child' then
 insert into public.refund_cash_outflows values(r.id,r.original_tender_id,current_setting('p3c.zero_session')::uuid,1,r.currency_code);
 end if;
 insert into public.wallet_refund_credits select c.*;
 set constraints all immediate;
end $$;
select throws_ok($$select pg_temp.malformed_refund('ancestry')$$,'23503',null,'Wrong campus ancestry rejected by composite FK');
select throws_ok($$select pg_temp.malformed_refund('ordinal')$$,'23514','REFUND_INTEGRITY_ERROR','Forged ordinal rejected below RPC');
select throws_ok($$select pg_temp.malformed_refund('cash-substitution')$$,'23514','REFUND_INTEGRITY_ERROR','Wallet cannot be substituted with cash tender');
select throws_ok($$select pg_temp.malformed_refund('amount')$$,'23514','REFUND_INTEGRITY_ERROR','Wallet credit must match exact refund amount');
select throws_ok($$select pg_temp.malformed_refund('currency')$$,'23503',null,'Wrong refund credit currency rejected');
select throws_ok($$select pg_temp.malformed_refund('student')$$,'23503',null,'Wrong refund credit student rejected');
select throws_ok($$select pg_temp.malformed_refund('wallet')$$,'23503',null,'Missing destination wallet cannot fallback');
select throws_ok($$select pg_temp.malformed_refund('cash-child')$$,'23503',null,'Wallet refund cannot have original cash child');

-- Isolated subtransaction simulates exhausted version; failed RPC rolls back
-- without leaving a changed wallet, source, or approval.
create function pg_temp.version_exhausted() returns void language plpgsql as $$
begin
 update public.student_wallets set balance_version=9223372036854775807 where id='00000000-0000-0000-0000-000000007001';
 perform public.create_purchase_refund(current_setting('p3c.wallet')::uuid,'1','error',null,'phase3c-version-exhausted-01','00000000-0000-0000-0000-000000004603');
end $$;
select pg_temp.login('2011');
select throws_ok($$select pg_temp.version_exhausted()$$,'22003','WALLET_VERSION_EXHAUSTED','Version exhaustion rejects before financial writes');
select ok((select balance_version<9223372036854775807 from public.student_wallets where id='00000000-0000-0000-0000-000000007001'),'Failed version probe rolls back its fixture');
-- Full bigint balance is funded through the frozen authority, never by bypassing
-- ledger guards; refund overflow must leave its approval and graph unchanged.
select pg_temp.login('2002');
set local role authenticated;
select lives_ok($$select public.set_student_wallet_status('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000007001','active')$$,'Authorized wallet unfreeze for overflow funding');
reset role;
select set_config('p3c.overflow_fund',(select (9223372036854775807-current_balance_minor)::text from public.student_wallets where id='00000000-0000-0000-0000-000000007001'),true);
set local role authenticated;
select lives_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',current_setting('p3c.overflow_fund')::bigint,'phase3c-overflow-fund-01','Synthetic boundary funding','Local synthetic evidence',null)$$,'Frozen replenishment funds bigint boundary with ledger proof');
reset role;
select pg_temp.login('2011');
set local role authenticated;
select set_config('p3c.overflow_ap',public.create_purchase_refund_approval(current_setting('p3c.wallet')::uuid,'1','error',null,'phase3c-overflow-issue-01','00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000004603')->>'approval_id',true);
reset role;
select set_config('p3c.refund_count',(select count(*)::text from public.refunds),true);
select pg_temp.login('2008');
set local role authenticated;
select throws_ok($$select pg_temp.refund('wallet','1','phase3c-overflow-action-01',current_setting('p3c.overflow_ap')::uuid)$$,'22003','WALLET_BALANCE_OVERFLOW','Overflow leaves approved action uncommitted');
reset role;
select is((select count(*)::text from public.refunds),current_setting('p3c.refund_count'),'Overflow creates no refund root');
select ok((select consumed_refund_id is null from public.financial_approvals where id=current_setting('p3c.overflow_ap')::uuid),'Overflow leaves approval unused');
select is((select current_balance_minor from public.student_wallets where id='00000000-0000-0000-0000-000000007001'),9223372036854775807::bigint,'Overflow leaves exact maximum balance');
select is((select sum(amount_minor::numeric) from public.wallet_ledger_entries),(select current_balance_minor::numeric from public.student_wallets where id='00000000-0000-0000-0000-000000007001'),'Numeric ledger sum reconciles at bigint maximum');

set constraints all immediate;
select * from finish();
rollback;
