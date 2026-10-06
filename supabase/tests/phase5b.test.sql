begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

update public.schools set business_timezone='Etc/GMT'||case
 when extract(hour from clock_timestamp() at time zone 'UTC')>=12 then '+'
 else '-' end||abs(extract(hour from clock_timestamp() at time zone 'UTC')::integer-12)::text
 where id='00000000-0000-0000-0000-000000000011';

create function pg_temp.login(suffix text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000'||suffix,true);
end $$;
create function pg_temp.sale(session_id uuid,key text,tender text default 'cash',customer uuid default null)
 returns uuid language plpgsql as $$
declare result jsonb;
begin
 result:=public.checkout_purchase(jsonb_build_object('request_key',key,'register_session_id',session_id,
  'cafeteria_customer_id',customer,'expected_total_minor','5000',
  'items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
   'quantity',1,'expected_product_version',1,'expected_unit_price_minor','5000')),
  'tender',case when tender='cash' then jsonb_build_object('type','cash','cash_received_minor','10000')
   else jsonb_build_object('type',tender) end));
 return (result->>'purchase_id')::uuid;
end $$;

select has_table('public','receipt_print_jobs','Durable receipt jobs exist');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
 where oid='public.receipt_print_jobs'::regclass),'Receipt jobs enforce RLS');
select ok(not has_table_privilege('anon','public.receipt_print_jobs','INSERT,UPDATE,DELETE,TRUNCATE')
 and not has_table_privilege('authenticated','public.receipt_print_jobs','INSERT,UPDATE,DELETE,TRUNCATE')
 and not has_table_privilege('service_role','public.receipt_print_jobs','INSERT,UPDATE,DELETE,TRUNCATE'),
 'No client or service role has direct receipt-job writes');
select is((select count(*) from public.receipt_print_jobs),0::bigint,'No fabricated receipt jobs');

select pg_temp.login('2002');
set local role authenticated;
select lives_ok($$select public.post_manual_wallet_replenishment(
 '00000000-0000-0000-0000-000000007001',10000,'phase5b-wallet-funding-0001',
 'synthetic funding','local receipt test',null)$$,'Fund wallet for terminal receipt test');
reset role;

select pg_temp.login('2008');
set local role authenticated;
select set_config('p5b.session',(select session_id::text from public.open_register_session(
 '00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',
 0,'phase5b-open-register-0001')),true);
select set_config('p5b.cash',pg_temp.sale(current_setting('p5b.session')::uuid,
 'phase5b-cash-purchase-0001')::text,true);
select is((select count(*) from public.receipt_print_jobs j join public.purchases p on p.id=j.purchase_id
 where p.id=current_setting('p5b.cash')::uuid and j.job_kind='original' and j.state='pending'
  and j.requested_by_person_id='00000000-0000-0000-0000-000000001008'
  and j.receipt_snapshot->>'total_minor'='5000' and j.receipt_snapshot->>'currency_code'='DOP'
  and j.receipt_snapshot->'items'->0->>'name'='Agua mineral'
  and j.receipt_snapshot->'tender'->>'cash_received_minor'='10000'),1::bigint,
 'Cash checkout atomically creates a PII-minimized receipt snapshot');
select is((select j.receipt_snapshot->>'purchase_number' from public.receipt_print_jobs j
 join public.purchases p on p.id=j.purchase_id where p.id=current_setting('p5b.cash')::uuid),
 (select purchase_number::text from public.purchases where id=current_setting('p5b.cash')::uuid),
 'Receipt snapshot preserves authoritative purchase number');
select is(pikas_private.current_person_id(),'00000000-0000-0000-0000-000000001008'::uuid,
 'Cashier identity is derived from the authenticated session');
select ok(pikas_private.is_pos_operator_membership('00000000-0000-0000-0000-000000004601',
 '00000000-0000-0000-0000-000000001008','00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111',
 'cafeteria:pos:receipts:claim'),'Cashier has exact receipt-claim capability');
select ok(exists(select 1 from public.cafeteria_registers r
 join public.cafeteria_register_assignments a on a.register_id=r.id
 where r.id='00000000-0000-0000-0000-000000009401' and r.status='active'
 and a.cafeteria_membership_id='00000000-0000-0000-0000-000000004601'
 and a.operator_person_id='00000000-0000-0000-0000-000000001008' and a.status='active'),
 'Cashier has an active exact register assignment');
reset role;
select lives_ok($$select pikas_private.assert_receipt_operator(
 '00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000001008',
 '00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000211',
 '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000001008',false)$$,
 'Private authorization predicate accepts fixture cashier and register');
set local role authenticated;
select set_config('p5b.claim',public.claim_purchase_receipt_print_job(
 '00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000004601',
 current_setting('p5b.cash')::uuid)::text,true);
select is(current_setting('p5b.claim')::jsonb->>'job_kind','original','Claim returns original receipt');
select ok(current_setting('p5b.claim')::jsonb->>'claim_token' is not null
 and current_setting('p5b.claim')::jsonb->'receipt_snapshot'->>'total_minor'='5000',
 'Claim returns an opaque token and the immutable snapshot');
select is(public.report_receipt_print_job((current_setting('p5b.claim')::jsonb->>'job_id')::uuid,
 (current_setting('p5b.claim')::jsonb->>'claim_token')::uuid,'submitted')->>'state',
 'submitted','Bridge acceptance is recorded as submitted');
select throws_ok($$select public.report_receipt_print_job(
 (current_setting('p5b.claim')::jsonb->>'job_id')::uuid,
 (current_setting('p5b.claim')::jsonb->>'claim_token')::uuid,'submitted',null)$$,
 '40001','CLAIM_NOT_CURRENT','A claim token cannot report twice');

select set_config('p5b.reprint',public.request_purchase_receipt_reprint(
 current_setting('p5b.cash')::uuid,'00000000-0000-0000-0000-000000009401',
 '00000000-0000-0000-0000-000000004601','phase5b-reprint-request-0001','customer_requested')::text,true);
select is(current_setting('p5b.reprint')::jsonb->>'replayed','false','First intentional reprint creates a job');
select is((select count(*) from public.receipt_print_jobs where source_job_id=
 (current_setting('p5b.reprint')::jsonb->>'job_id')::uuid),0::bigint,
 'Reprint references original rather than owning a duplicate snapshot');
select is(public.request_purchase_receipt_reprint(current_setting('p5b.cash')::uuid,
 '00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000004601',
 'phase5b-reprint-request-0001','customer_requested')->>'job_id',
 current_setting('p5b.reprint')::jsonb->>'job_id','Identical reprint key replays idempotently');
select throws_ok($$select public.request_purchase_receipt_reprint(
 current_setting('p5b.cash')::uuid,'00000000-0000-0000-0000-000000009401',
 '00000000-0000-0000-0000-000000004601','phase5b-reprint-request-0001','damaged')$$,
 '23505','IDEMPOTENCY_KEY_REUSED','Changed reprint payload conflicts');
reset role;
select pg_temp.login('2011');
set local role authenticated;
select set_config('p5b.reprint_claim',public.claim_purchase_receipt_print_job(
 '00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000004603',
 current_setting('p5b.cash')::uuid)::text,true);
select is(current_setting('p5b.reprint_claim')::jsonb->>'job_kind','reprint',
 'Explicit reprint can be claimed independently');
select is(public.report_receipt_print_job(
 (current_setting('p5b.reprint_claim')::jsonb->>'job_id')::uuid,
 (current_setting('p5b.reprint_claim')::jsonb->>'claim_token')::uuid,'submitted')->>'state',
 'submitted','A separately authorized Supervisor reports a cashier-created reprint');
reset role;
select pg_temp.login('2008');
set local role authenticated;

select set_config('p5b.wallet',pg_temp.sale(current_setting('p5b.session')::uuid,
 'phase5b-wallet-purchase-0001','student_wallet',
 '00000000-0000-0000-0000-000000006901')::text,true);
select is((select count(*) from public.receipt_print_jobs j join public.purchases p on p.id=j.purchase_id
 where p.id=current_setting('p5b.wallet')::uuid and j.job_kind='original'
  and j.receipt_snapshot->'tender'->>'type'='student_wallet'),1::bigint,
 'Wallet checkout atomically creates an original receipt snapshot');
select set_config('p5b.wallet_claim',public.claim_purchase_receipt_print_job(
 '00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000004601',
 current_setting('p5b.wallet')::uuid)::text,true);
select is(public.report_receipt_print_job(
 (current_setting('p5b.wallet_claim')::jsonb->>'job_id')::uuid,
 (current_setting('p5b.wallet_claim')::jsonb->>'claim_token')::uuid,
 'failed','PRINTER_UNAVAILABLE')->>'state',
 'failed','Definitive failure clears the active claim');
select is(public.retry_receipt_print_job(
 (current_setting('p5b.wallet_claim')::jsonb->>'job_id')::uuid,
 '00000000-0000-0000-0000-000000004601')->>'state',
 'pending','Failed job retries without changing its snapshot');
select set_config('p5b.retry_claim',public.claim_purchase_receipt_print_job(
 '00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000004601',
 current_setting('p5b.wallet')::uuid)::text,true);
select is((current_setting('p5b.retry_claim')::jsonb->>'claim_token') is not null,true,
 'Retried job receives a fresh claim token');
select is(public.report_receipt_print_job(
 (current_setting('p5b.retry_claim')::jsonb->>'job_id')::uuid,
 (current_setting('p5b.retry_claim')::jsonb->>'claim_token')::uuid,
 'uncertain','SUBMISSION_TIMEOUT')->>'state',
 'uncertain','Ambiguous bridge result enters uncertain state');
select throws_ok($$select public.retry_receipt_print_job(
 (current_setting('p5b.retry_claim')::jsonb->>'job_id')::uuid,
 '00000000-0000-0000-0000-000000004601',false)$$,
 '22023','DUPLICATE_OUTPUT_ACKNOWLEDGEMENT_REQUIRED',
 'Uncertain retry requires explicit duplicate-output acknowledgement');
select is(public.retry_receipt_print_job(
 (current_setting('p5b.retry_claim')::jsonb->>'job_id')::uuid,
 '00000000-0000-0000-0000-000000004601',true)->>'state',
 'pending','Acknowledged uncertain retry returns to pending');
reset role;

select * from finish();
rollback;
