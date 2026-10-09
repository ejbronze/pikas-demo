begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
-- Keep the synthetic school clock near noon so a short transaction cannot straddle a business-date rollover.
update public.schools set business_timezone='Etc/GMT'||case when extract(hour from clock_timestamp() at time zone 'UTC')>=12 then '+' else '-' end||abs(extract(hour from clock_timestamp() at time zone 'UTC')::integer-12)::text
 where id='00000000-0000-0000-0000-000000000011';

create function pg_temp.login(suffix text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000'||suffix,true); end $$;
create function pg_temp.sale(session_id uuid,key text,tender text,customer uuid default null)
 returns jsonb language plpgsql as $$
begin
 return public.checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',session_id,
 'cafeteria_customer_id',customer,'expected_total_minor','5000',
 'items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',1,'expected_product_version',1,'expected_unit_price_minor','5000')),
 'tender',case when tender='cash' then jsonb_build_object('type','cash','cash_received_minor','10000') else jsonb_build_object('type',tender) end));
end $$;
create function pg_temp.ctx(customer uuid default '00000000-0000-0000-0000-000000006901') returns jsonb language sql as $$
 select public.get_pos_customer_purchase_context('00000000-0000-0000-0000-000000000111',customer) $$;

-- Fixtures: platform operators, sandbox persona (no Auth identity) and its cashier membership/assignment.
insert into auth.users(id,aud,role,email,confirmed_at) values
 ('00000000-0000-0000-0000-000000002201','authenticated','authenticated','sandbox-op-1@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002202','authenticated','authenticated','platform-admin-only@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002203','authenticated','authenticated','sandbox-op-expired@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002204','authenticated','authenticated','sandbox-op-revoked@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002205','authenticated','authenticated','future-persona-auth@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002206','authenticated','authenticated','dual-role-1@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002207','authenticated','authenticated','dual-role-2@example.invalid',now());
insert into public.persons(id,auth_user_id,display_name,status) values
 ('00000000-0000-0000-0000-000000001201','00000000-0000-0000-0000-000000002201','Sandbox operator 1','active'),
 ('00000000-0000-0000-0000-000000001202','00000000-0000-0000-0000-000000002202','Platform admin only','active'),
 ('00000000-0000-0000-0000-000000001203','00000000-0000-0000-0000-000000002203','Sandbox operator expired','active'),
 ('00000000-0000-0000-0000-000000001204','00000000-0000-0000-0000-000000002204','Sandbox operator revoked','active'),
 ('00000000-0000-0000-0000-000000001205','00000000-0000-0000-0000-000000002206','Dual role operator 1','active'),
 ('00000000-0000-0000-0000-000000001206','00000000-0000-0000-0000-000000002207','Dual role operator 2','active'),
 ('00000000-0000-0000-0000-000000001210',null,'Sandbox cashier persona','active'),
 ('00000000-0000-0000-0000-000000001211',null,'Sandbox other cafeteria persona','active');
insert into pikas_private.platform_memberships(person_id,role_code,status) values
 ('00000000-0000-0000-0000-000000001201','platform_sandbox_operator','active'),
 ('00000000-0000-0000-0000-000000001202','platform_admin','active'),
 ('00000000-0000-0000-0000-000000001203','platform_sandbox_operator','active'),
 ('00000000-0000-0000-0000-000000001204','platform_sandbox_operator','active'),
 ('00000000-0000-0000-0000-000000001205','platform_admin','active'),
 ('00000000-0000-0000-0000-000000001205','platform_sandbox_operator','active'),
 ('00000000-0000-0000-0000-000000001206','platform_admin','active'),
 ('00000000-0000-0000-0000-000000001206','platform_sandbox_operator','active');
insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values
 ('00000000-0000-0000-0000-000000004610','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000001210','pos_cashier'),
 ('00000000-0000-0000-0000-000000004611','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113','00000000-0000-0000-0000-000000001211','pos_cashier');
insert into public.cafeteria_register_assignments(id,account_id,school_id,school_location_id,cafeteria_id,cafeteria_membership_id,operator_person_id,register_id,status)
values ('00000000-0000-0000-0000-000000009510','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000004610','00000000-0000-0000-0000-000000001210','00000000-0000-0000-0000-000000009401','active');

-- A. Classification / structure / grants.
select is((select tenant_kind from public.accounts where id='00000000-0000-0000-0000-000000000002'),'customer','Accounts default to customer');
select throws_ok($$update public.accounts set tenant_kind='sandbox' where id='00000000-0000-0000-0000-000000000002'$$,'23514','account_tenant_kind_is_immutable','Classification cannot be changed after creation');
select ok(not has_column_privilege('authenticated','public.accounts','tenant_kind','UPDATE') and not has_table_privilege('authenticated','public.accounts','UPDATE'),'Tenants cannot write classification');
select throws_ok($$insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','cashier','00000000-0000-0000-0000-000000001210','00000000-0000-0000-0000-000000004610')$$,
 '23514','sandbox_pov_persona_requires_sandbox_account','Persona cannot be registered in a customer tenant');
-- Test-only owner reclassification; production classification is a separate reviewed owner operation.
alter table public.accounts disable trigger accounts_tenant_kind_immutable;
update public.accounts set tenant_kind='sandbox' where id='00000000-0000-0000-0000-000000000001';
alter table public.accounts enable trigger accounts_tenant_kind_immutable;
select throws_ok($$update public.accounts set tenant_kind='customer' where id='00000000-0000-0000-0000-000000000001'$$,'23514','account_tenant_kind_is_immutable','Sandbox cannot revert to customer');
select throws_ok($$insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','cashier','00000000-0000-0000-0000-000000001008','00000000-0000-0000-0000-000000004601')$$,
 '23514','sandbox_pov_persona_must_not_have_auth_identity','Persona must not have an Auth identity');
select throws_ok($$insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','cashier','00000000-0000-0000-0000-000000001211','00000000-0000-0000-0000-000000004611')$$,
 '23514','sandbox_pov_persona_membership_mismatch','Cross-cafeteria persona membership is rejected');
select throws_ok($$insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','cashier','00000000-0000-0000-0000-000000001210','00000000-0000-0000-0000-000000003203')$$,
 '23514','sandbox_pov_persona_membership_mismatch','Persona without its own correct POS membership is rejected');
select throws_ok($$insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','cafeteria_admin','00000000-0000-0000-0000-000000001210','00000000-0000-0000-0000-000000004610')$$,
 '23514',null,'Only the cashier POV is in the allow-list');
insert into pikas_private.sandbox_pov_personas(id,account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id)
values ('00000000-0000-0000-0000-000000008810','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','cashier','00000000-0000-0000-0000-000000001210','00000000-0000-0000-0000-000000004610');

select is((select count(*) from pikas_private.platform_capabilities),6::bigint,'Exactly one platform capability was added');
select is((select count(*) from pikas_private.platform_role_capabilities where role_code='platform_admin'),5::bigint,'platform_admin capabilities are unchanged');
select ok(not exists(select 1 from pikas_private.platform_role_capabilities where role_code='platform_admin' and capability='platform:sandbox:pov:enter'),'platform_admin does not hold the sandbox capability');
select is((select array_agg(capability) from pikas_private.platform_role_capabilities where role_code='platform_sandbox_operator'),array['platform:sandbox:pov:enter'],'Sandbox operator role holds only the POV capability');
select ok(not has_table_privilege('authenticated','pikas_private.sandbox_pov_sessions','SELECT,INSERT,UPDATE,DELETE')
 and not has_table_privilege('authenticated','pikas_private.sandbox_pov_personas','SELECT,INSERT,UPDATE,DELETE')
 and not has_table_privilege('authenticated','pikas_private.sandbox_pov_operation_links','SELECT,INSERT,UPDATE,DELETE')
 and not has_table_privilege('service_role','pikas_private.sandbox_pov_sessions','SELECT,INSERT,UPDATE,DELETE'),'POV tables are not client-accessible');
select ok(not has_function_privilege('authenticated','pikas_private.pos_actor_person_id()','EXECUTE')
 and not has_function_privilege('authenticated','pikas_private.sandbox_pov_context()','EXECUTE')
 and not has_function_privilege('authenticated','pikas_private.pos_has_capability(text,uuid,uuid,uuid)','EXECUTE'),'Private POS actor helpers are not client-executable');
select ok(has_function_privilege('authenticated','public.platform_enter_sandbox_pov(uuid,uuid,uuid,text)','EXECUTE')
 and has_function_privilege('authenticated','public.platform_exit_sandbox_pov(uuid)','EXECUTE')
 and has_function_privilege('authenticated','public.get_pos_customer_purchase_context(uuid,uuid)','EXECUTE')
 and not has_function_privilege('anon','public.platform_enter_sandbox_pov(uuid,uuid,uuid,text)','EXECUTE')
 and not has_function_privilege('anon','public.get_pos_customer_purchase_context(uuid,uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.platform_enter_sandbox_pov(uuid,uuid,uuid,text)','EXECUTE'),'Public contracts are authenticated-only');

-- B/D. Enter authorization.
select pg_temp.login('2202');
set local role authenticated;
select throws_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')$$,'42501','not_authorized','platform_admin alone cannot enter a sandbox POV');
reset role;
select pg_temp.login('2008');
set local role authenticated;
select throws_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')$$,'42501','not_authorized','A tenant cashier cannot enter a sandbox POV');
reset role;
select pg_temp.login('2201');
set local role authenticated;
select throws_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000121','cashier')$$,'42501','sandbox_pov_not_available','Customer tenant cannot enter sandbox POV');
select throws_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000a004','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000111','cashier')$$,'42501','sandbox_pov_not_available','Cross-account cafeteria is rejected');
select throws_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000a005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000112','cashier')$$,'42501','sandbox_pov_not_available','Cafeteria without a registered persona is rejected');
select throws_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000a006','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000113','cashier')$$,'42501','sandbox_pov_not_available','Other cafeteria persona without a registry row is rejected');
select throws_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000a007','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cafeteria_admin')$$,'22023','invalid_sandbox_pov_request','Only the cashier POV is accepted');
reset role;
select is((select count(*) from pikas_private.sandbox_pov_sessions),0::bigint,'Rejected attempts create no sessions');

-- Fallback behavior without POV.
select is(pikas_private.pos_actor_person_id(),'00000000-0000-0000-0000-000000001201'::uuid,'Without a POV the POS actor is the authenticated person');
select pg_temp.login('2008');
select is(pikas_private.pos_actor_person_id(),pikas_private.current_person_id(),'Normal tenant POS actor is unchanged');

-- Funding for purchase-context scenarios (frozen RPC).
select pg_temp.login('2002');
set local role authenticated;
select lives_ok($$select public.post_manual_wallet_replenishment('00000000-0000-0000-0000-000000007001',20000,'phase6b-wallet-funding-0001','synthetic funding','local evidence',null)$$,'Synthetic wallet funding');
reset role;

-- Enter.
select pg_temp.login('2201');
set local role authenticated;
select set_config('p6b.session',(public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')->>'session_id'),true);
select is(public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')->>'session_id',current_setting('p6b.session'),'Enter is idempotent for the same request');
select throws_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000113','cashier')$$,'23505','platform_request_conflict','Changed payload on a reused request conflicts');
reset role;
select is((select count(*) from pikas_private.sandbox_pov_sessions where status='active'),1::bigint,'One active session');
select is((select persona_person_id from pikas_private.sandbox_pov_sessions where id=current_setting('p6b.session')::uuid),'00000000-0000-0000-0000-000000001210'::uuid,'Server selected the persona');
select is((select count(*) from pikas_private.platform_audit_events where reason_code='sandbox_pov_entered' and actor_person_id='00000000-0000-0000-0000-000000001201' and target_person_id='00000000-0000-0000-0000-000000001210' and metadata->>'session_id'=current_setting('p6b.session')),1::bigint,'Enter is audited with operator, persona and session');

-- E. Actor resolution while in POV.
select is(pikas_private.current_person_id(),'00000000-0000-0000-0000-000000001201'::uuid,'current_person_id still resolves the real authenticated person');
select is(pikas_private.pos_actor_person_id(),'00000000-0000-0000-0000-000000001210'::uuid,'POS actor resolves to the sandbox persona');
select ok(not pikas_private.has_capability('cafeteria:pos:purchase:create','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111'),'Generic tenant authorization does not see the persona');
select ok(pikas_private.pos_has_capability('cafeteria:pos:purchase:create','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111'),'POS authorization uses the persona membership in the POV cafeteria');
select ok(not pikas_private.pos_has_capability('cafeteria:pos:purchase:create','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113'),'POV does not authorize another cafeteria');
select ok(not pikas_private.pos_has_capability('school:wallets:read','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',null),'POV grants no broad wallet capability');
select ok(not pikas_private.pos_has_capability('cafeteria:pos:session:close_exceptional','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111'),'POV does not grant supervisor capabilities');

-- Pre-sale context, POS flow under POV.
set local role authenticated;
select is((select count(*) from public.student_wallets),0::bigint,'The real operator in POV cannot broadly read wallets');
select is((select count(*) from public.list_my_operable_registers()),1::bigint,'Persona assignment is listed through the POS wrapper');
select throws_ok($$select public.get_pos_customer_purchase_context('00000000-0000-0000-0000-000000000113','00000000-0000-0000-0000-000000006901')$$,'42501','not_authorized','Cross-cafeteria purchase context is rejected in POV');
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000112')$$,'42501','not_authorized','Cross-cafeteria catalog is rejected in POV');
select isnt(public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111'),null,'POV can read the POS catalog');
select set_config('p6b.reg',(select session_id::text from public.open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009510',0,'phase6b-open-session-001')),true);
select is(pg_temp.ctx()->>'available_today_minor','20000','No daily limit: available equals wallet balance');
select is(pg_temp.ctx()->'daily_limit'->>'enabled','false','No spending control means no daily limit');
select is(pg_temp.ctx()->'wallet'->>'balance_minor','20000','Wallet balance reported');
select is(pg_temp.ctx()->>'spent_today_minor','0','Nothing spent today');
select isnt(pg_temp.ctx()->>'business_date',null,'Authoritative business date is returned');
select is(pg_temp.ctx(
 '00000000-0000-0000-0000-000000006902')->>'customer_type','staff','Staff customer context');
select is(pg_temp.ctx('00000000-0000-0000-0000-000000006902')->'wallet','null'::jsonb,'Staff customer has no wallet context');
select set_config('p6b.wallet',(pg_temp.sale(current_setting('p6b.reg')::uuid,'phase6b-wallet-sale-0001','student_wallet','00000000-0000-0000-0000-000000006901'))::text,true);
select set_config('p6b.cash',(pg_temp.sale(current_setting('p6b.reg')::uuid,'phase6b-cash-sale-00001','cash'))::text,true);
select is(pg_temp.ctx()->>'available_today_minor','15000','Balance after purchase');
select is(pg_temp.ctx()->>'spent_today_minor','5000','Spent today includes the purchase');
reset role;

-- Attribution.
select is((select operator_person_id from public.purchases where id=(current_setting('p6b.wallet')::jsonb->>'purchase_id')::uuid),'00000000-0000-0000-0000-000000001210'::uuid,'Sandbox purchase is attributed to the persona');
select is((select count(*) from pikas_private.sandbox_pov_operation_links l join pikas_private.sandbox_pov_sessions s on s.id=l.pov_session_id
 where s.id=current_setting('p6b.session')::uuid and s.initiator_person_id='00000000-0000-0000-0000-000000001201'
   and s.initiator_auth_user_id='00000000-0000-0000-0000-000000002201' and l.target_type='purchase'),2::bigint,'Both purchases link to the real initiating operator');
select is((select count(*) from pikas_private.sandbox_pov_operation_links l where l.target_type='register_session' and l.target_id=current_setting('p6b.reg')::uuid and l.pov_session_id=current_setting('p6b.session')::uuid),1::bigint,'Register session links to the POV session');
select ok((select count(*) from public.audit_events where sandbox_pov_session_id=current_setting('p6b.session')::uuid
  and actor_person_id='00000000-0000-0000-0000-000000001210' and authenticated_user_id='00000000-0000-0000-0000-000000002201')>=3,'Tenant audit rows carry persona actor, real Auth id and POV session');
select ok(position('00000000-0000-0000-0000-000000001201' in current_setting('p6b.wallet'))=0
  and position('00000000-0000-0000-0000-000000002201' in current_setting('p6b.wallet'))=0,'Checkout response does not expose the real operator');
select is((select count(*) from public.audit_events where sandbox_pov_session_id is not null and actor_person_id<>'00000000-0000-0000-0000-000000001210'),0::bigint,'Only persona-attributed audit rows are stamped');

-- Limits (owner-managed fixtures, same data the frozen limit RPCs maintain).
insert into public.student_spending_controls(account_id,school_id,student_id,currency_code,daily_limit_enabled,daily_limit_minor,per_transaction_limit_enabled,per_transaction_limit_minor,updated_by_person_id)
values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201','DOP',true,30000,true,6000,'00000000-0000-0000-0000-000000001008');
select pg_temp.login('2201');
set local role authenticated;
select is(pg_temp.ctx()->>'available_today_minor','15000','Balance lower than remaining limit: balance wins');
select is(pg_temp.ctx()->'per_transaction_limit'->>'limit_minor','6000','Per-transaction limit state is reported');
reset role;
update public.student_spending_controls set version=version+1, daily_limit_minor=12000 where student_id='00000000-0000-0000-0000-000000005201';
set local role authenticated;
select is(pg_temp.ctx()->>'available_today_minor','7000','Remaining limit lower than balance: limit wins');
select is(pg_temp.ctx()->'daily_limit'->>'limit_minor','12000','Daily limit is reported');
reset role;
update public.student_spending_controls set version=version+1, daily_limit_minor=6000 where student_id='00000000-0000-0000-0000-000000005201';
set local role authenticated;
-- The previous read (7000 available) is stale now; checkout must still enforce the authoritative limit.
select throws_ok($$select pg_temp.sale(current_setting('p6b.reg')::uuid,'phase6b-stale-sale-0001','student_wallet','00000000-0000-0000-0000-000000006901')$$,'23514','DAILY_LIMIT_EXCEEDED','Checkout stays authoritative after a stale context read');
reset role;

-- Refund (frozen supervisor path) is reflected in spent-today.
select pg_temp.login('2011');
set local role authenticated;
select lives_ok($$select public.create_purchase_refund((current_setting('p6b.wallet')::jsonb->>'purchase_id')::uuid,'2000','error',null,'phase6b-refund-key-0001','00000000-0000-0000-0000-000000004603')$$,'Supervisor refunds part of the persona sale');
reset role;
select pg_temp.login('2201');
set local role authenticated;
select is(pg_temp.ctx()->>'spent_today_minor','3000','Refund reduces spent today');
select is(pg_temp.ctx()->>'available_today_minor','3000','Refund restores limit headroom');
select is(pg_temp.ctx()->'wallet'->>'balance_minor','17000','Refund restores wallet balance');
select lives_ok($$select public.close_my_register_session(current_setting('p6b.reg')::uuid,1,0,'phase6b-close-session-001')$$,'Persona closes its register session through the POS contract');
reset role;

-- Exit, revoke and fail-closed behavior.
select pg_temp.login('2201');
set local role authenticated;
select is(public.platform_exit_sandbox_pov('00000000-0000-0000-0000-00000000b002')->>'status','exited','Exit succeeds');
select is(public.platform_exit_sandbox_pov('00000000-0000-0000-0000-00000000b002')->>'session_id',current_setting('p6b.session'),'Exit is idempotent');
select throws_ok($$select public.platform_exit_sandbox_pov('00000000-0000-0000-0000-00000000b003')$$,'23514','sandbox_pov_not_active','Exit without a session is rejected');
select throws_ok($$select pg_temp.ctx()$$,'42501','not_authorized','After exit the operator has no POS authority');
reset role;
select is(pikas_private.pos_actor_person_id(),'00000000-0000-0000-0000-000000001201'::uuid,'Exited POV falls back to the real person');
select is((select count(*) from pikas_private.platform_audit_events where reason_code='sandbox_pov_exited' and metadata->>'session_id'=current_setting('p6b.session')),1::bigint,'Exit is audited');
select throws_ok($$update pikas_private.sandbox_pov_sessions set status='active',ended_at=null,end_reason=null$$,'23514','sandbox_pov_session_cannot_be_reactivated','Exited sessions cannot be reactivated');

insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,started_at,expires_at)
values('00000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000001203','00000000-0000-0000-0000-000000002203','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','cashier','00000000-0000-0000-0000-000000008810','00000000-0000-0000-0000-000000001210','00000000-0000-0000-0000-000000004610',now()-interval '5 hours',now()-interval '1 hour');
select pg_temp.login('2203');
select is(pikas_private.pos_actor_person_id(),'00000000-0000-0000-0000-000000001203'::uuid,'Expired POV session fails closed to the real person');

-- Platform role composition: independent roles, union of explicitly granted capabilities only.
select throws_ok($$insert into pikas_private.platform_memberships(person_id,role_code,status) values('00000000-0000-0000-0000-000000001205','platform_admin','active')$$,'23505',null,'A duplicate live membership for the same role is rejected');
select pg_temp.login('2202');
set local role authenticated;
select is(jsonb_array_length(public.platform_get_context()->'capabilities'),5,'platform_admin alone keeps exactly five capabilities');
reset role;
select ok(not pikas_private.platform_has_capability('platform:sandbox:pov:enter'),'platform_admin alone lacks sandbox POV capability');
set local role authenticated;
select throws_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000b101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')$$,'42501','not_authorized','platform_admin alone cannot enter sandbox POV');
reset role;
select pg_temp.login('2201');
set local role authenticated;
select is(public.platform_get_context()->'capabilities','["platform:sandbox:pov:enter"]'::jsonb,'Sandbox operator alone holds only the sandbox capability');
reset role;
select ok(not (pikas_private.platform_has_capability('platform:tenant:provision') or pikas_private.platform_has_capability('platform:identity:link')
  or pikas_private.platform_has_capability('platform:customer_admin:provision') or pikas_private.platform_has_capability('platform:tenant:lifecycle:read')
  or pikas_private.platform_has_capability('platform:audit:read')),'Sandbox operator alone has no admin capability');
set local role authenticated;
select throws_ok($$select public.platform_provision_tenant('00000000-0000-0000-0000-00000000b102','SBX-NEG','Neg','SBX-S','Neg S','America/Santo_Domingo','SBX-L','Neg L','SBX-C','Neg C')$$,'42501','not_authorized','Sandbox operator alone cannot provision tenants');
reset role;
select pg_temp.login('2206');
set local role authenticated;
select is(jsonb_array_length(public.platform_get_context()->'capabilities'),6,'Dual-role Person holds the union of six explicit capabilities');
select is(public.platform_get_context()->>'role','platform_admin','Dual-role context keeps platform_admin as primary role');
select is(public.platform_get_context()->'roles','["platform_admin","platform_sandbox_operator"]'::jsonb,'Dual-role context lists both roles');
reset role;
select ok(pikas_private.platform_has_capability('platform:tenant:provision') and pikas_private.platform_has_capability('platform:sandbox:pov:enter'),'Capability resolves through ANY active membership');
set local role authenticated;
select lives_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000b103','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')$$,'Dual-role Person can enter sandbox POV');
reset role;
update pikas_private.platform_memberships set status='inactive' where person_id='00000000-0000-0000-0000-000000001205' and role_code='platform_sandbox_operator';
select pg_temp.login('2206');
set local role authenticated;
reset role;
select ok(pikas_private.platform_has_capability('platform:tenant:provision') and not pikas_private.platform_has_capability('platform:sandbox:pov:enter'),'Revoking sandbox role removes sandbox authority only');
set local role authenticated;
select throws_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000b104','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')$$,'42501',null,'Revoked sandbox role cannot enter POV');
select is(jsonb_array_length(public.platform_get_context()->'capabilities'),5,'Context shrinks to the five admin capabilities');
reset role;
select pg_temp.login('2207');
update pikas_private.platform_memberships set status='inactive' where person_id='00000000-0000-0000-0000-000000001206' and role_code='platform_admin';
set local role authenticated;
reset role;
select ok(not pikas_private.platform_has_capability('platform:tenant:provision') and pikas_private.platform_has_capability('platform:sandbox:pov:enter'),'Revoking platform_admin keeps sandbox authority');
set local role authenticated;
select lives_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000b105','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')$$,'Sandbox role alone still enters POV after admin revocation');
select is(public.platform_get_context()->>'role','platform_sandbox_operator','Context role falls back to the remaining role');
reset role;
select pg_temp.login('2204');
set local role authenticated;
select lives_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000b004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')$$,'Second operator enters');
reset role;
select is(pikas_private.pos_actor_person_id(),'00000000-0000-0000-0000-000000001210'::uuid,'Second operator resolves to the persona');
update pikas_private.platform_memberships set status='inactive' where person_id='00000000-0000-0000-0000-000000001204';
select is(pikas_private.pos_actor_person_id(),'00000000-0000-0000-0000-000000001204'::uuid,'Revoked platform authority invalidates the POV');

select pg_temp.login('2201');
set local role authenticated;
select lives_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000b005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')$$,'Operator re-enters');
reset role;
update public.persons set auth_user_id='00000000-0000-0000-0000-000000002205' where id='00000000-0000-0000-0000-000000001210';
select is(pikas_private.pos_actor_person_id(),'00000000-0000-0000-0000-000000001201'::uuid,'A persona that gained an Auth identity is rejected');
update public.persons set auth_user_id=null where id='00000000-0000-0000-0000-000000001210';
select is(pikas_private.pos_actor_person_id(),'00000000-0000-0000-0000-000000001210'::uuid,'Valid persona resolves again');
update public.cafeteria_memberships set status='inactive' where id='00000000-0000-0000-0000-000000004610';
select is(pikas_private.pos_actor_person_id(),'00000000-0000-0000-0000-000000001201'::uuid,'Persona without an active POS membership is rejected');

-- Normal POS behavior is unchanged.
select pg_temp.login('2008');
set local role authenticated;
select is(pg_temp.ctx()->>'customer_type','student','Normal cashier can read purchase context in own cafeteria');
select is((select count(*) from public.student_wallets),0::bigint,'Normal cashier cannot broadly read wallets');
select throws_ok($$select public.get_pos_customer_purchase_context('00000000-0000-0000-0000-000000000113','00000000-0000-0000-0000-000000006901')$$,'42501','not_authorized','Normal cashier cross-cafeteria purchase context is rejected');
reset role;
select * from finish();
rollback;
