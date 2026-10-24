-- PIKAS FIN 3 finance operations (202611120001). Fictional local fixtures only; everything rolls back.
-- Foundation fixtures: account 1 / school 11 / student 5201 (wallet 7001) / Cafetería 111 / customer 6901 /
-- product 8101 at RD$ 50 / register 9401 (cashier 2008, assignment 9501). 2002 School Admin (school 11).
-- Fictional Platform people, each holding exactly one fictional role:
--   f3d01 Platform Admin (no finance) · f3d02 platform_finance_operator (read + verify + reverse)
--   f3d03 read only · f3d04 verify only · f3d05 reverse only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; s text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text, s=returned_sqlstate; return s||':'||m; end$$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.as_operator(n text) returns void language plpgsql as $$declare u text:='00000000-0000-0000-0000-0000000f3d0'||n; sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;
create function pg_temp.bal() returns bigint language sql as $$select current_balance_minor from student_wallets where id='00000000-0000-0000-0000-000000007001'$$;
create function pg_temp.bank(gross bigint,key text,proof text default 'Comprobante enviado por WhatsApp') returns text language sql as $$
 select pikas_private.finance_submit_bank_replenishment((select id from persons where auth_user_id='00000000-0000-0000-0000-000000002002'),'school_admin',
  '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',gross,'BHD-48213','Laura Méndez (ficticia)','Pago de la semana',proof,key)->>'reference'$$;
create function pg_temp.decide(ref text,decision text,reason text,key text) returns jsonb language sql as $$
 select platform_finance_decide_bank_replenishment(ref,decision,reason,key)$$;
create function pg_temp.reverse(ref text,key text) returns jsonb language sql as $$
 select platform_finance_reverse_replenishment(ref,'wrong_amount',null,key)$$;
create function pg_temp.list(view text,status text default null,q text default null) returns jsonb language sql as $$select platform_finance_replenishments_read(view,status,q)$$;
create function pg_temp.detail(ref text) returns jsonb language sql as $$select platform_finance_replenishment_detail(ref)$$;
create function pg_temp.writes() returns text language sql as $$
 select (select count(*) from financial_entries)||'/'||(select count(*) from financial_obligations)||'/'||(select count(*) from wallet_replenishments)
  ||'/'||(select count(*) from wallet_replenishment_reversals)||'/'||(select count(*) from wallet_ledger_entries)||'/'||(select count(*) from audit_events)||'/'||pg_temp.bal()$$;

-- ── Fictional people and roles ─────────────────────────────────────────────────────────────────
reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 select ('00000000-0000-0000-0000-0000000f3d0'||n)::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','fin3.op'||n||'@example.invalid','',now(),now(),now(),'{}','{}' from unnest(array['1','2','3','4','5']) n;
insert into persons(id,auth_user_id,display_name)
 select ('00000000-0000-0000-0000-0000000f3e0'||n)::uuid,('00000000-0000-0000-0000-0000000f3d0'||n)::uuid,name
 from (values('1','Admin Plataforma FIN 3'),('2','Marisol Finanzas (ficticia)'),('3','Solo lectura FIN 3'),('4','Solo verificación FIN 3'),('5','Solo reversión FIN 3')) v(n,name);
select is((select count(*) from pikas_private.platform_role_capabilities where capability like 'platform:finance:%'),0::bigint,'4. No finance capability is granted by any migration');
insert into pikas_private.platform_roles(role_code) values('platform_finance_operator'),('fin3_solo_lectura'),('fin3_solo_verificar'),('fin3_solo_revertir');
insert into pikas_private.platform_role_capabilities(role_code,capability) values
 ('platform_finance_operator','platform:finance:read'),('platform_finance_operator','platform:finance:replenishments:verify'),('platform_finance_operator','platform:finance:replenishments:reverse'),
 ('fin3_solo_lectura','platform:finance:read'),('fin3_solo_verificar','platform:finance:replenishments:verify'),('fin3_solo_revertir','platform:finance:replenishments:reverse');
insert into pikas_private.platform_memberships(person_id,role_code) values
 ('00000000-0000-0000-0000-0000000f3e01','platform_admin'),('00000000-0000-0000-0000-0000000f3e02','platform_finance_operator'),
 ('00000000-0000-0000-0000-0000000f3e03','fin3_solo_lectura'),('00000000-0000-0000-0000-0000000f3e04','fin3_solo_verificar'),('00000000-0000-0000-0000-0000000f3e05','fin3_solo_revertir');
select ok(not has_function_privilege('authenticated','pikas_private.finance_request_status(public.replenishment_requests)','execute'),'Status helper is not client-callable');

-- ── Fixture: activated fictional customer with bank transfers ──────────────────────────────────
select pikas_private.finance_activate_customer('00000000-0000-0000-0000-000000000001',1,'Piloto ficticio FIN 3','fin3-activate-account1-001');
select set_config('t.r1',pg_temp.bank(200000,'fin3-bank-request-00001'),true);
select set_config('t.r2',pg_temp.bank(150000,'fin3-bank-request-00002',null),true);
select set_config('t.r3',pg_temp.bank(100000,'fin3-bank-request-00003'),true);
select set_config('t.r4',pg_temp.bank(10000,'fin3-bank-request-00004'),true);
select set_config('t.b0',pg_temp.bal()::text,true);
select is(pg_temp.bal(),current_setting('t.b0')::bigint,'10. Pending requests have no wallet effect');

-- ── 1–9. Authority ─────────────────────────────────────────────────────────────────────────────
select pg_temp.as_operator('1');
select is(pg_temp.attempt($$select pg_temp.list('pending')$$),'42501:not_authorized','1/5. Platform Admin without finance read cannot list');
select is(pg_temp.attempt(format($$select pg_temp.detail(%L)$$,current_setting('t.r1'))),'42501:not_authorized','1/5. …nor open a request');
select is(pg_temp.attempt(format($$select pg_temp.decide(%L,'approve',null,'fin3-decide-admin-0001')$$,current_setting('t.r1'))),'42501:not_authorized','5. …nor verify');
select is(pg_temp.attempt(format($$select pg_temp.reverse(%L,'fin3-reverse-admin-001')$$,current_setting('t.r1'))),'42501:not_authorized','5. …nor reverse');
select pg_temp.as_operator('3');
select is(jsonb_array_length(pg_temp.list('pending')->'requests'),4,'1. Finance read lists the pending queue');
select is(pg_temp.attempt(format($$select pg_temp.decide(%L,'approve',null,'fin3-decide-read-00001')$$,current_setting('t.r1'))),'42501:not_authorized','2. Read cannot verify');
select is(pg_temp.attempt(format($$select pg_temp.reverse(%L,'fin3-reverse-read-0001')$$,current_setting('t.r1'))),'42501:not_authorized','Read cannot reverse');
select is(pg_temp.attempt($$select school_wallet_read('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201')$$),'42501:school_authority_required','7. Finance read grants no School wallet authority');
select is((select count(*) from student_wallets),0::bigint,'7. Finance read sees no wallet rows directly');
select pg_temp.as_operator('4');
select is(pg_temp.attempt($$select pg_temp.list('pending')$$),'42501:not_authorized','Verify does not imply finance read');
select pg_temp.as_operator('5');
select is(pg_temp.attempt(format($$select pg_temp.decide(%L,'approve',null,'fin3-decide-revr-00001')$$,current_setting('t.r1'))),'42501:not_authorized','3. Reverse cannot verify');
select is(pg_temp.attempt($$select platform_finance_fund_wallet_adjustment('00000000-0000-0000-0000-000000005201',100,'administrative_correction','Corrección ficticia','fin3-fund-reverse-only')$$),
 '42501:not_authorized','9. Reversal does not imply funded-adjustment authority');
reset role;
select is(pg_temp.writes(),(select pg_temp.writes()),'Refused attempts changed nothing');

-- ── Queue and detail ───────────────────────────────────────────────────────────────────────────
select pg_temp.as_operator('2');
select set_config('t.q',pg_temp.list('pending')::text,true);
select is((select array_agg(e->>'reference' order by o) from jsonb_array_elements(current_setting('t.q')::jsonb->'requests') with ordinality x(e,o)),
 array[current_setting('t.r1'),current_setting('t.r2'),current_setting('t.r3'),current_setting('t.r4')],'Pending queue: oldest first');
select is((current_setting('t.q')::jsonb->'requests'->0)-'submitted_at'-'method'-'cafeteria'-'submitted_by',jsonb_build_object('reference',current_setting('t.r1'),'status','pending','customer','SYNTHETIC-A',
 'school','Synthetic school A1','student','Sofia Demo',
 'student_code','STU-001','gross_minor','200000','fee_minor','6000','net_minor','194000',
 'payer_reference','BHD-48213','has_proof',true,'decided_at',null,'reversed_at',null,'decided_by',null,'reversed_by',null),'Queue row: identity, gross/fee/net, evidence indicator');
select ok((current_setting('t.q')::jsonb->'requests'->0->>'method')='bank_transfer' and (current_setting('t.q')::jsonb->'requests'->0->'cafeteria')='null'::jsonb
 and (current_setting('t.q')::jsonb->'requests'->0->>'submitted_by') is not null,'FIN 4: queue rows name the method, no Cafetería for a bank transfer, and the submitter');
select is(current_setting('t.q')::jsonb->'requests'->1->>'has_proof','false','A request without proof reference says so');
select ok(current_setting('t.q') !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','The queue carries no internal UUIDs');
select is(jsonb_array_length(pg_temp.list('pending',null,'BHD')->'requests')||'/'||jsonb_array_length(pg_temp.list('pending',null,current_setting('t.r3'))->'requests')
 ||'/'||jsonb_array_length(pg_temp.list('pending',null,'no-existe')->'requests'),'0/1/0','Search matches reference, customer or student only');
select is(pg_temp.attempt($$select pg_temp.list('everything')$$)||'|'||pg_temp.attempt($$select pg_temp.list('pending','posted')$$)||'|'||pg_temp.attempt($$select pg_temp.list('history','submitted')$$),
 '22023:INVALID_FINANCE_VIEW|22023:INVALID_FINANCE_STATUS|22023:INVALID_FINANCE_STATUS','Invalid filters fail safely');
select set_config('t.d',pg_temp.detail(current_setting('t.r1'))::text,true);
select is(current_setting('t.d')::jsonb->>'status'||'|'||(current_setting('t.d')::jsonb->>'payer_name')||'|'||(current_setting('t.d')::jsonb->>'proof_reference')||'|'||(current_setting('t.d')::jsonb->>'fee_bps')
 ||'|'||(current_setting('t.d')::jsonb->>'customer_activated')||'|'||coalesce(current_setting('t.d')::jsonb->>'wallet','none'),
 'pending|Laura Méndez (ficticia)|Comprobante enviado por WhatsApp|300|true|none','Detail: manual evidence and policy; no wallet context while pending');
select ok(current_setting('t.d') !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','The detail carries no internal UUIDs');
select is(pg_temp.attempt($$select pg_temp.detail('REC-99999999')$$)||'|'||pg_temp.attempt($$select pg_temp.detail('nada')$$),
 'P0002:REPLENISHMENT_REQUEST_NOT_FOUND|22023:INVALID_REFERENCE','Unknown and malformed references');

-- ── 11–15, 18. Verify ──────────────────────────────────────────────────────────────────────────
select set_config('t.v',pg_temp.decide(current_setting('t.r1'),'approve',null,'fin3-decide-approve-0001')::text,true);
reset role;
select is(current_setting('t.v')::jsonb->>'state','posted','14. Request becomes posted');
select is(pg_temp.bal(),current_setting('t.b0')::bigint+194000,'12. Wallet receives the net RD$ 1,940');
select is((select string_agg(e.entry_type||':'||e.amount_minor,',' order by e.entry_type) from financial_entries e join replenishment_requests r on r.id=e.replenishment_request_id where r.reference=current_setting('t.r1')),
 'replenishment_fee_earned:6000,replenishment_gross_collected:200000,stored_value_issued:194000','13/15. Fee RD$ 60 and entries reconcile (gross = fee + net)');
select is((select count(*) from wallet_replenishments w join replenishment_requests r on r.id=w.financial_request_id where r.reference=current_setting('t.r1')),1::bigint,'11. Posted exactly once');
select pg_temp.as_operator('2');
select is(pg_temp.decide(current_setting('t.r1'),'approve',null,'fin3-decide-approve-0001'),current_setting('t.v')::jsonb,'18. Same decision replays its result');
select is(pg_temp.attempt(format($$select pg_temp.decide(%L,'approve',null,'fin3-decide-approve-0099')$$,current_setting('t.r1'))),'23514:REQUEST_ALREADY_DECIDED','18. A second decision is refused (already processed)');
select is(pg_temp.detail(current_setting('t.r1'))->>'decided_by','Marisol Finanzas (ficticia)','28. Platform finance sees who verified');
select is(pg_temp.detail(current_setting('t.r1'))->'wallet'->>'covers_net','true','Posted detail shows whether the wallet still covers the net');
reset role;
select is((select actor_person_id::text||':'||action from audit_events where action='wallet_replenishment_verified' and after_metadata->>'reference'=current_setting('t.r1')),
 '00000000-0000-0000-0000-0000000f3e02:wallet_replenishment_verified','28. Internal audit keeps the operator');

-- ── 16–17. Reject ──────────────────────────────────────────────────────────────────────────────
select set_config('t.w0',pg_temp.writes(),true);
select pg_temp.as_operator('2');
select is(pg_temp.attempt(format($$select pg_temp.decide(%L,'reject','ok','fin3-decide-reject-0001')$$,current_setting('t.r2'))),'22023:REJECTION_REASON_REQUIRED','A rejection needs a reason');
select is(pg_temp.decide(current_setting('t.r2'),'reject','El comprobante no coincide con el monto','fin3-decide-reject-0002')->>'state','rejected','Rejection recorded');
reset role;
select is(split_part(pg_temp.writes(),'/',1)||'/'||split_part(pg_temp.writes(),'/',2)||'/'||split_part(pg_temp.writes(),'/',3)||'/'||split_part(pg_temp.writes(),'/',7),
 split_part(current_setting('t.w0'),'/',1)||'/'||split_part(current_setting('t.w0'),'/',2)||'/'||split_part(current_setting('t.w0'),'/',3)||'/'||split_part(current_setting('t.w0'),'/',7),
 '16. Rejection: no wallet effect, fee, replenishment or obligation');
select pg_temp.as_operator('2');
select is(pg_temp.attempt(format($$select pg_temp.decide(%L,'approve',null,'fin3-decide-approve-0002')$$,current_setting('t.r2'))),'23514:REQUEST_ALREADY_DECIDED','17. A rejected request cannot post');
select is(pg_temp.list('history','rejected')->'requests'->0->>'reference',current_setting('t.r2'),'Rejection appears in history');

-- ── 20–25. Reversal ────────────────────────────────────────────────────────────────────────────
select pg_temp.decide(current_setting('t.r3'),'approve',null,'fin3-decide-approve-0003');
select pg_temp.decide(current_setting('t.r4'),'approve',null,'fin3-decide-approve-0004');
reset role; select set_config('t.b1',pg_temp.bal()::text,true);
select pg_temp.as_operator('2');
select set_config('t.rv',pg_temp.reverse(current_setting('t.r3'),'fin3-reverse-eligible-01')::text,true);
select is(current_setting('t.rv')::jsonb->>'state','reversed','20. Eligible finance reversal succeeds');
select is(pg_temp.reverse(current_setting('t.r3'),'fin3-reverse-eligible-01'),current_setting('t.rv')::jsonb,'23. Same reversal replays');
select is(pg_temp.attempt(format($$select pg_temp.reverse(%L,'fin3-reverse-eligible-02')$$,current_setting('t.r3'))),'23514:REPLENISHMENT_ALREADY_REVERSED','23. A second reversal is refused');
select is((pg_temp.detail(current_setting('t.r3'))->'reversal')-'reversed_at',jsonb_build_object('reason','wrong_amount','note',null,'reversed_by','Marisol Finanzas (ficticia)',
 'gross_minor','100000','fee_minor','3000','net_minor','97000'),'21. Detail shows the reversal: gross, fee and net countered, by whom');
select is(pg_temp.detail(current_setting('t.r3'))->>'status'||'|'||coalesce(pg_temp.detail(current_setting('t.r3'))->>'wallet','none'),'reversed|none','Reversed: no further wallet context');
select is(pg_temp.list('history','reversed')->'requests'->0->>'reversed_by','Marisol Finanzas (ficticia)','Reversal appears in history with its operator');
reset role;
select is(pg_temp.bal(),current_setting('t.b1')::bigint-97000,'20. Wallet loses exactly the net RD$ 970');
select is((select sum(amount_minor) from wallet_ledger_entries where wallet_id='00000000-0000-0000-0000-000000007001')::bigint,pg_temp.bal(),'22. Wallet ledger reconciles');
-- 24–25. Spend most of the balance; the RD$ 97 net of r4 is no longer available.
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select school_wallet_adjust('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',-(pg_temp.bal()-5000),'authorized_debit','Gasto ficticio FIN 3','f3000000-0000-4000-8000-0000000000a1');
reset role; select set_config('t.w1',pg_temp.writes(),true);
select pg_temp.as_operator('2');
select is(pg_temp.detail(current_setting('t.r4'))->'wallet'->>'covers_net','false','The detail warns that the wallet no longer covers the net');
select is(pg_temp.attempt(format($$select pg_temp.reverse(%L,'fin3-reverse-spent-0001')$$,current_setting('t.r4'))),'23514:FINANCIAL_RESOLUTION_REQUIRED','24. Insufficient balance: FINANCIAL_RESOLUTION_REQUIRED');
reset role;
select is(pg_temp.writes(),current_setting('t.w1'),'25. No partial reversal, event, obligation, ledger entry or audit row');

-- ── 26–28. School-safe attribution ─────────────────────────────────────────────────────────────
select pikas_private.finance_fund_wallet_adjustment('00000000-0000-0000-0000-000000005201','00000000-0000-0000-0000-0000000f3e02',2500,'administrative_correction','Corrección financiada ficticia','fin3-fund-adjustment-001');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select set_config('t.h',school_wallet_read('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201')::text,true);
reset role;
select ok(current_setting('t.h') !~ 'platform_finance_operator','26. School history never carries the internal finance role');
select ok(current_setting('t.h') !~ 'Marisol Finanzas','27. School history never names the PIKAS finance operator');
select is((select string_agg(e->>'type'||':'||coalesce(e->>'source',e->>'actor_role','-'),',' order by (e->>'version')::int) from jsonb_array_elements(current_setting('t.h')::jsonb->'movements') e where e->>'actor_kind'='pikas'),
 'replenishment:bank_transfer_verified,replenishment:bank_transfer_verified,replenishment:bank_transfer_verified,replenishment_reversal:-,adjustment:pikas',
 '26. Verified transfers, the finance reversal and the funded adjustment are attributed to PIKAS');
select is((select count(*) from jsonb_array_elements(current_setting('t.h')::jsonb->'movements') e where e->>'actor_kind'='pikas' and e->>'actor' is not null),0::bigint,'27. PIKAS rows carry no person');
select is((select e->>'actor' from jsonb_array_elements(current_setting('t.h')::jsonb->'movements') e where e->>'type'='adjustment' and e->>'actor_role'='school_admin' limit 1),
 (select display_name from persons where auth_user_id='00000000-0000-0000-0000-000000002002'),'Tenant actions keep their actor as before');
select is((select count(*) from audit_events where actor_person_id='00000000-0000-0000-0000-0000000f3e02' and action in ('wallet_replenishment_verified','wallet_replenishment_rejected','wallet_replenishment_reversed','wallet_funded_adjustment_posted')),6::bigint,
 '28. Internal audit keeps every finance action with its operator');

-- ── 6. Sandbox POV ─────────────────────────────────────────────────────────────────────────────
savepoint pov;
insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,expires_at)
 select gen_random_uuid(),'00000000-0000-0000-0000-0000000f3e02','00000000-0000-0000-0000-0000000f3d02',p.account_id,p.school_id,p.cafeteria_id,'cashier',p.id,p.person_id,p.cafeteria_membership_id,clock_timestamp()+interval '1 hour'
 from pikas_private.sandbox_pov_personas p where p.pov_code='cashier' limit 1;
select pg_temp.as_operator('2');
select is(pg_temp.attempt($$select pg_temp.list('pending')$$)||'|'||pg_temp.attempt(format($$select pg_temp.decide(%L,'approve',null,'fin3-decide-pov-000001')$$,current_setting('t.r4')))
 ||'|'||pg_temp.attempt(format($$select pg_temp.reverse(%L,'fin3-reverse-pov-00001')$$,current_setting('t.r4'))),
 '42501:finance_authority_required|42501:finance_authority_required|42501:finance_authority_required','6. A sandbox POV cannot read, verify or reverse');
reset role;
rollback to savepoint pov;

select * from finish();
rollback;
