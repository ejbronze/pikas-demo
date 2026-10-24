-- PIKAS FIN 4: Cafetería cash collection (local; not deployed).
--
-- CENTRAL CLEARING REQUIRES LEGAL/ACCOUNTING APPROVAL BEFORE REAL-MONEY ACTIVATION. Nothing here activates a
-- customer: cash collection only works for a customer whose fee-era finance was activated by the internal,
-- backend-only activation; every other customer is refused with FINANCIAL_POLICY_NOT_ACTIVE.
--
-- The FIN 2 engine already defines the economics and is reused unchanged:
--   pikas_private.finance_post_cash_replenishment → finance_create_request (activation + policy snapshot, gross,
--   half-up fee, net, REC- reference, idempotent by request key) → finance_post_request (wallet + ledger credit of
--   NET, replenishment_gross_collected / replenishment_fee_earned / stored_value_issued entries, and the
--   Cafetería → clearing `cash_collection` obligation for GROSS) in one transaction, checked at commit by the
--   deferred completeness trigger. FIN 4 creates obligations; it does not settle them.
--
-- This migration adds only:
--   * capability cafeteria:wallets:collect_cash → cafeteria_admin (the narrow replacement of the retired
--     cafeteria:wallets:replenish; POS roles, School and Platform do not receive it);
--   * public.cafeteria_wallet_collect_cash: the authorized Cafetería wrapper (scope, capability, lifecycle, Demo and
--     Platform-support refusal, per-student lock with re-validation, School-owned sharing/eligibility, audit);
--   * public.cafeteria_cash_collections_read: the Cafetería's operational history of cash it collected;
--   * Platform finance reads list and explain Cafetería cash collections too (history and detail), so finance can
--     support and reverse them with the existing FIN 2/3 reversal;
--   * school_wallet_read returns gross / fee / net and the collecting Cafetería for fee-era replenishments.
-- No table, column, constraint or financial semantics change. No settlement, batching or netting.
begin;

insert into pikas_private.role_capabilities(scope_kind,role_code,capability)
values ('cafeteria','cafeteria_admin','cafeteria:wallets:collect_cash') on conflict do nothing;

-- ── Cash collection (Cafetería) ─────────────────────────────────────────────────────────────────
-- The operator physically received GROSS cash for a student's PIKAS Cash. The wallet receives NET; PIKAS earns
-- the fee; the Cafetería owes clearing GROSS. A retry with the same request key returns the original result.
create function public.cafeteria_wallet_collect_cash(p_cafeteria_id uuid, p_student_id uuid, p_gross_minor bigint, p_payer_name text, p_request_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ctx jsonb; c public.cafeterias; acct public.accounts; customer uuid; actor uuid; replay boolean; result jsonb; r public.replenishment_requests;
begin
  -- Platform customer-operations support never collects money for a customer.
  if nullif(current_setting('pikas.customer_operations_account', true), '') is not null then
    raise exception using errcode = '42501', message = 'cash_collection_authority_required'; end if;
  -- A Demo never creates real finance (UX 11).
  perform pikas_private.require_no_current_demo();
  if exists (select 1 from pikas_private.sandbox_validated_pov()) then raise exception using errcode = '42501', message = 'demo_mode_active'; end if;
  if p_request_key is null then raise exception using errcode = '22023', message = 'invalid_request_key'; end if;
  if p_gross_minor is null or p_gross_minor < 1 then raise exception using errcode = '22023', message = 'INVALID_GROSS_AMOUNT'; end if;
  if p_payer_name is not null and length(btrim(p_payer_name)) > 160 then raise exception using errcode = '22023', message = 'INVALID_PAYER_NAME'; end if;
  ctx := pikas_private.require_cafeteria_admin(p_cafeteria_id);
  select * into strict c from public.cafeterias where id = p_cafeteria_id;
  select * into strict acct from public.accounts where id = c.account_id;
  if acct.tenant_kind <> 'customer' then raise exception using errcode = '42501', message = 'demo_mode_active'; end if;
  if not pikas_private.has_capability('cafeteria:wallets:collect_cash', c.account_id, c.school_id, c.id) then
    raise exception using errcode = '42501', message = 'cash_collection_authority_required'; end if;
  -- Same per-student lock as every money path; authority is re-validated after the wait. Calls for one student are
  -- serialized here, so the replay test below is exact (a retry never writes a second audit row).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_student_id::text, 0));
  replay := exists (select 1 from public.replenishment_requests where account_id = c.account_id and request_key = p_request_key::text);
  ctx := pikas_private.require_cafeteria_admin(p_cafeteria_id, true);
  if not pikas_private.has_capability('cafeteria:wallets:collect_cash', c.account_id, c.school_id, c.id) then
    raise exception using errcode = '42501', message = 'cash_collection_authority_required'; end if;
  actor := (ctx->>'actor_id')::uuid;
  -- The School decides who this Cafetería serves: active share with basic identification, active link, active student.
  select cc.id into customer from public.cafeteria_customers cc
    join public.school_cafeteria_shares sh on sh.account_id = cc.account_id and sh.school_id = cc.school_id and sh.cafeteria_id = cc.cafeteria_id and sh.status = 'active'
    join public.school_cafeteria_share_categories cat on cat.share_id = sh.id and cat.category = 'basic_identification' and cat.enabled
    join public.students s on s.id = cc.student_id and s.account_id = cc.account_id and s.school_id = cc.school_id and s.status = 'active'
    where cc.cafeteria_id = c.id and cc.account_id = c.account_id and cc.school_id = c.school_id and cc.student_id = p_student_id and cc.status = 'active'
    for share of cc, sh, cat;
  if customer is null then raise exception using errcode = '42501', message = 'student_not_served_by_cafeteria'; end if;
  result := pikas_private.finance_post_cash_replenishment(actor, c.id, customer, p_gross_minor, p_payer_name, p_request_key::text);
  select * into strict r from public.replenishment_requests where account_id = c.account_id and request_key = p_request_key::text;
  if r.student_id <> p_student_id or r.collecting_cafeteria_id <> c.id then raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT'; end if;
  if not replay then
    perform pikas_private.record_wallet_audit(actor, auth.uid(), 'cafeteria_admin', 'cafeteria', c.account_id, c.school_id, c.id,
      'wallet_cash_collected', 'replenishment_requests', r.id,
      jsonb_build_object('reference', r.reference, 'student_id', r.student_id, 'gross_minor', r.gross_minor::text, 'fee_minor', r.fee_minor::text,
        'net_minor', r.net_minor::text, 'fee_bps', r.fee_bps, 'policy_version', (select version from public.financial_fee_policies where id = r.policy_id),
        'source', 'cafeteria_cash_collected'));
  end if;
  return jsonb_build_object('request_key', p_request_key, 'reference', r.reference, 'state', r.state, 'cafeteria_id', c.id, 'student_id', r.student_id,
    'student_name', (select display_name from public.students where id = r.student_id),
    'gross_minor', r.gross_minor::text, 'fee_minor', r.fee_minor::text, 'net_minor', r.net_minor::text, 'fee_bps', r.fee_bps,
    'balance_after_minor', result->>'balance_after_minor', 'collected_at', r.posted_at,
    'collected_by', (select display_name from public.persons where id = r.submitted_by), 'payer_name', r.payer_name, 'replayed', replay);
end $$;

-- Operational history of the cash this Cafetería collected (newest first, 25 per page) and whether collection is
-- enabled for its customer. No obligations, settlement figures or PIKAS economics beyond each record's own fee.
create function public.cafeteria_cash_collections_read(p_cafeteria_id uuid, p_before text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ctx jsonb; c public.cafeterias; acct public.accounts; act uuid; pol public.financial_fee_policies; rows jsonb;
begin
  if nullif(current_setting('pikas.customer_operations_account', true), '') is not null then
    raise exception using errcode = '42501', message = 'cash_collection_authority_required'; end if;
  if exists (select 1 from pikas_private.sandbox_validated_pov()) then raise exception using errcode = '42501', message = 'demo_mode_active'; end if;
  if p_before is not null and p_before !~ '^REC-[0-9]{8}$' then raise exception using errcode = '22023', message = 'invalid_cursor'; end if;
  ctx := pikas_private.require_cafeteria_admin(p_cafeteria_id);
  select * into strict c from public.cafeterias where id = p_cafeteria_id;
  select * into strict acct from public.accounts where id = c.account_id;
  if not pikas_private.has_capability('cafeteria:wallets:collect_cash', c.account_id, c.school_id, c.id) then
    raise exception using errcode = '42501', message = 'cash_collection_authority_required'; end if;
  act := case when acct.tenant_kind = 'customer' then pikas_private.financial_activation(c.account_id) end;
  select p.* into pol from public.customer_financial_activations a join public.financial_fee_policies p on p.id = a.policy_id where a.id = act;
  select coalesce(jsonb_agg(x.row order by x.reference desc), '[]'::jsonb) into rows from (
    select r.reference, jsonb_build_object('reference', r.reference, 'status', pikas_private.finance_request_status(r),
      'student_id', r.student_id, 'student_name', st.display_name, 'student_code', st.student_code,
      'gross_minor', r.gross_minor::text, 'fee_minor', r.fee_minor::text, 'net_minor', r.net_minor::text, 'fee_bps', r.fee_bps,
      'collected_at', r.posted_at, 'collected_by', sp.display_name, 'payer_name', r.payer_name, 'reversed_at', v.reversed_at) row
    from public.replenishment_requests r
    join public.students st on st.id = r.student_id
    left join public.persons sp on sp.id = r.submitted_by
    left join public.wallet_replenishment_reversals v on v.replenishment_id = r.wallet_replenishment_id
    where r.collecting_cafeteria_id = c.id and r.method = 'cafeteria_cash' and r.state = 'posted' and (p_before is null or r.reference < p_before)
    order by r.reference desc limit 26) x;
  return jsonb_build_object('cafeteria_id', c.id, 'enabled', act is not null, 'fee_bps', pol.replenishment_fee_bps, 'policy_version', pol.version,
    'currency', pol.currency_code, 'collections', case when jsonb_array_length(rows) > 25 then rows - 25 else rows end,
    'next_before', case when jsonb_array_length(rows) > 25 then rows->24->>'reference' end);
end $$;

revoke all on function public.cafeteria_wallet_collect_cash(uuid,uuid,bigint,text,uuid), public.cafeteria_cash_collections_read(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.cafeteria_wallet_collect_cash(uuid,uuid,bigint,text,uuid), public.cafeteria_cash_collections_read(uuid,text) to authenticated;

-- ── Platform finance reads (FIN 3), widened to Cafetería cash collections ─────────────────────
CREATE OR REPLACE FUNCTION public.platform_finance_replenishments_read(p_view text, p_status text DEFAULT NULL::text, p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q text := nullif(btrim(p_query),''); rows jsonb;
begin
  perform pikas_private.require_platform_capability('platform:finance:read');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  if p_view is null or p_view not in ('pending','history') then raise exception using errcode = '22023', message = 'INVALID_FINANCE_VIEW'; end if;
  if p_status is not null and (p_view <> 'history' or p_status not in ('posted','rejected','reversed')) then raise exception using errcode = '22023', message = 'INVALID_FINANCE_STATUS'; end if;
  if q is not null and length(q) > 80 then raise exception using errcode = '22023', message = 'INVALID_FINANCE_QUERY'; end if;
  select coalesce(jsonb_agg(x.row order by x.ord), '[]'::jsonb) into rows from (
    select row_number() over (order by case when p_view = 'pending' then extract(epoch from r.submitted_at) else -extract(epoch from coalesce(v.reversed_at, r.decided_at, r.submitted_at)) end, r.reference) ord,
      jsonb_build_object('reference',r.reference,'status',pikas_private.finance_request_status(r),
        'customer',a.name,'school',s.name,'student',st.display_name,'student_code',st.student_code,
        'gross_minor',r.gross_minor::text,'fee_minor',r.fee_minor::text,'net_minor',r.net_minor::text,
        'payer_reference',r.payer_reference,'has_proof',r.external_proof_reference is not null,
        'method',r.method,'cafeteria',cc.name,'submitted_by',sp.display_name,
        'submitted_at',r.submitted_at,'decided_at',r.decided_at,'reversed_at',v.reversed_at,
        'decided_by',dp.display_name,'reversed_by',vp.display_name) row
    from public.replenishment_requests r
    join public.accounts a on a.id = r.account_id
    join public.schools s on s.id = r.school_id
    join public.students st on st.id = r.student_id
    left join public.wallet_replenishment_reversals v on v.replenishment_id = r.wallet_replenishment_id
    left join public.persons dp on dp.id = r.decided_by
    left join public.persons vp on vp.id = v.actor_person_id
    left join public.cafeterias cc on cc.id = r.collecting_cafeteria_id
    left join public.persons sp on sp.id = r.submitted_by
    -- FIN 4: the queue stays bank transfers (cash never waits); history also lists Cafetería cash collections.
    where (case when p_view = 'pending' then r.method = 'bank_transfer' and r.state = 'submitted' else r.state <> 'submitted' end)
      and (p_status is null or pikas_private.finance_request_status(r) = p_status)
      and (q is null or r.reference ilike '%'||q||'%' or a.name ilike '%'||q||'%' or st.display_name ilike '%'||q||'%' or st.student_code ilike '%'||q||'%' or cc.name ilike '%'||q||'%')
    order by 1 limit 51) x;
  return jsonb_build_object('view',p_view,'status',p_status,'query',q,
    'requests',case when jsonb_array_length(rows) > 50 then rows - 50 else rows end,'truncated',jsonb_array_length(rows) > 50);
end $function$;

CREATE OR REPLACE FUNCTION public.platform_finance_replenishment_detail(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.replenishment_requests; v public.wallet_replenishment_reversals; w public.student_wallets; status text;
begin
  perform pikas_private.require_platform_capability('platform:finance:read');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  if p_reference is null or p_reference !~ '^REC-[0-9]{8}$' then raise exception using errcode = '22023', message = 'INVALID_REFERENCE'; end if;
  select * into r from public.replenishment_requests where reference = p_reference;
  if not found then raise exception using errcode = 'P0002', message = 'REPLENISHMENT_REQUEST_NOT_FOUND'; end if;
  select * into v from public.wallet_replenishment_reversals where replenishment_id = r.wallet_replenishment_id;
  select * into w from public.student_wallets where id = r.wallet_id;
  status := pikas_private.finance_request_status(r);
  return jsonb_build_object('reference',r.reference,'status',status,'method',r.method,
    'customer',(select name from public.accounts where id = r.account_id),
    'customer_activated',pikas_private.financial_activation(r.account_id) is not null,
    'school',(select name from public.schools where id = r.school_id),
    'cafeteria',(select name from public.cafeterias where id = r.collecting_cafeteria_id),
    'student',(select display_name from public.students where id = r.student_id),
    'student_code',(select student_code from public.students where id = r.student_id),
    'currency',r.currency_code,'policy_version',(select version from public.financial_fee_policies where id = r.policy_id),'fee_bps',r.fee_bps,
    'gross_minor',r.gross_minor::text,'fee_minor',r.fee_minor::text,'net_minor',r.net_minor::text,
    'payer_reference',r.payer_reference,'payer_name',r.payer_name,'payer_note',r.payer_note,'proof_reference',r.external_proof_reference,
    'submitted_at',r.submitted_at,'submitted_by',(select display_name from public.persons where id = r.submitted_by),'submitted_role',r.submitted_role,
    'decided_at',r.decided_at,'decided_by',(select display_name from public.persons where id = r.decided_by),'rejection_reason',r.rejection_reason,'posted_at',r.posted_at,
    'reversal',case when v.id is null then null else jsonb_build_object('reversed_at',v.reversed_at,'reason',v.reason,'note',v.note,
      'reversed_by',(select display_name from public.persons where id = v.actor_person_id),
      'gross_minor',(select coalesce(sum(amount_minor),0)::text from public.financial_entries where wallet_replenishment_reversal_id = v.id and entry_type = 'replenishment_gross_reversed'),
      'fee_minor',(select coalesce(sum(amount_minor),0)::text from public.financial_entries where wallet_replenishment_reversal_id = v.id and entry_type = 'replenishment_fee_reversed'),
      'net_minor',v.amount_minor::text) end,
    'wallet',case when status = 'posted' and w.id is not null then jsonb_build_object('status',w.status,'balance_minor',w.current_balance_minor::text,
      'covers_net',w.current_balance_minor >= r.net_minor) end);
end $function$;

-- ── School wallet history: unchanged except the FIN 4 replenishment support fields ─────────────
CREATE OR REPLACE FUNCTION public.school_wallet_read(p_school_id uuid, p_student_id uuid, p_before bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx jsonb; w public.student_wallets%rowtype; movements jsonb;
begin
 ctx:=pikas_private.require_school_admin(p_school_id,'school:wallets:read');
 if p_before is not null and p_before<1 then raise exception using errcode='22023',message='invalid_cursor'; end if;
 if not exists(select 1 from public.students s where s.id=p_student_id and s.school_id=p_school_id and s.account_id=(ctx->>'account_id')::uuid) then
  raise exception using errcode='42501',message='wallet_authority_required'; end if;
 select * into w from public.student_wallets where school_id=p_school_id and student_id=p_student_id and currency_code='DOP' for share;
 ctx:=pikas_private.require_school_admin(p_school_id,'school:wallets:read');
 if w.id is null then return jsonb_build_object('school_id',p_school_id,'student_id',p_student_id,'student_name',(select display_name from public.students where id=p_student_id),'wallet',null,'movements','[]'::jsonb,'next_before',null); end if;
 select coalesce(jsonb_agg(row order by version desc),'[]'::jsonb) into movements from (
 select l.balance_version_after version,jsonb_build_object('id',l.id,'type',l.entry_type,'amount_minor',l.amount_minor::text,
 'balance_after_minor',l.balance_after_minor::text,'version',l.balance_version_after::text,'occurred_at',l.occurred_at,
 'source',r.source,'reference',coalesce(r.reference,a.reference),'note',coalesce(r.verification_note,a.explanatory_note),
 'actor',case when finance.pikas then null else person.display_name end,'actor_kind',case when finance.pikas then 'pikas' end,'replenishment_id',r.id,'purchase_id',p.id,'receipt_number',p.purchase_number::text,
 'cafeteria',coalesce(c.name,adjc.name,repc.name),'method',rq.method,'gross_minor',rq.gross_minor::text,'fee_minor',rq.fee_minor::text,'net_minor',rq.net_minor::text,'adjustment_reason',a.reason_code,'actor_role',case when a.actor_source='platform_finance' then 'pikas' else a.actor_role end,'balance_before_minor',a.balance_before_minor::text,'reversal_id',coalesce(rv.id,rr.id),'reversed_replenishment_id',rv.replenishment_id,
 'reversal_reason',coalesce(rv.reason,rr.reason),'reversal_note',rv.note,'reversed_at',rr.reversed_at,
 'original_reference',orig.reference,'original_note',orig.verification_note,'original_amount_minor',orig.amount_minor::text,'items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'quantity',i.quantity,
 'line_total_minor',i.line_total_minor::text) order by i.line_number),'[]'::jsonb) from public.purchase_items i where i.purchase_id=p.id)) row
 from public.wallet_ledger_entries l
 left join public.wallet_replenishments r on r.id=l.replenishment_id
 -- FIN 4: fee-era replenishments carry their gross / fee / net snapshot and collecting Cafetería (support record only).
 left join public.replenishment_requests rq on rq.id=r.financial_request_id
 left join public.cafeterias repc on repc.id=r.cafeteria_id
 left join public.wallet_replenishment_reversals rr on rr.replenishment_id=r.id
 left join public.wallet_replenishment_reversals rv on rv.id=l.replenishment_reversal_id
 left join public.wallet_replenishments orig on orig.id=rv.replenishment_id
 left join public.wallet_adjustments a on a.id=l.adjustment_id
 left join public.cafeterias adjc on adjc.id=a.cafeteria_id
 left join public.wallet_purchase_debits d on d.id=l.purchase_debit_id
 left join public.wallet_refund_credits f on f.id=l.refund_credit_id
 left join public.purchases p on p.id=coalesce(d.purchase_id,f.purchase_id)
 left join public.cafeterias c on c.id=p.cafeteria_id
 left join public.persons person on person.id=coalesce(r.verified_by,a.actor_person_id,d.actor_person_id,f.actor_person_id,rv.actor_person_id)
 -- FIN 3: PIKAS finance actions are shown as PIKAS; the operator stays in internal audit only.
 cross join lateral (select coalesce(r.source='bank_transfer_verified' or rv.actor_role='platform_finance_operator' or a.actor_source='platform_finance',false) pikas) finance
 where l.wallet_id=w.id and (p_before is null or l.balance_version_after<p_before)
 order by l.balance_version_after desc limit 26) entries;
 return jsonb_build_object('school_id',p_school_id,'student_id',p_student_id,'student_name',(select display_name from public.students where id=p_student_id),
 'wallet',jsonb_build_object('id',w.id,'status',w.status,'currency','DOP','balance_minor',w.current_balance_minor::text,'version',w.balance_version::text),
 'movements',case when jsonb_array_length(movements)>25 then movements-25 else movements end,
 'next_before',case when jsonb_array_length(movements)>25 then movements->24->>'version' else null end);
end $function$;

-- Explicit ACLs (no PUBLIC EXECUTE; see 202611180001). create or replace keeps the existing grants of the reads.
revoke all on function public.platform_finance_replenishments_read(text,text,text), public.platform_finance_replenishment_detail(text),
  public.school_wallet_read(uuid,uuid,bigint) from public, anon, service_role;
grant execute on function public.platform_finance_replenishments_read(text,text,text), public.platform_finance_replenishment_detail(text),
  public.school_wallet_read(uuid,uuid,bigint) to authenticated;

do $acl$
declare f regprocedure;
begin
  foreach f in array array['public.cafeteria_wallet_collect_cash(uuid,uuid,bigint,text,uuid)','public.cafeteria_cash_collections_read(uuid,text)',
    'public.platform_finance_replenishments_read(text,text,text)','public.platform_finance_replenishment_detail(text)','public.school_wallet_read(uuid,uuid,bigint)']::regprocedure[] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute') or not has_function_privilege('authenticated', f, 'execute')
      or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0) or (select proacl is null from pg_proc where oid = f) then
      raise exception 'fin4_acl_mismatch %', f;
    end if;
  end loop;
  if (select count(*) from pikas_private.role_capabilities where capability = 'cafeteria:wallets:collect_cash') <> 1
    or not exists (select 1 from pikas_private.role_capabilities where capability = 'cafeteria:wallets:collect_cash' and scope_kind = 'cafeteria' and role_code = 'cafeteria_admin')
    or exists (select 1 from pikas_private.role_capabilities where capability = 'cafeteria:wallets:replenish') then
    raise exception 'fin4_capability_mismatch';
  end if;
end
$acl$;

commit;
