-- PIKAS FIN 3: finance operations reads and School-safe attribution (local only).
--
-- CENTRAL CLEARING REQUIRES LEGAL/ACCOUNTING APPROVAL BEFORE REAL-MONEY ACTIVATION.
-- Read-only additions: no new financial semantics, no capability, no grant, no activation.
--   * platform_finance_replenishments_read: bank-transfer queue and recent decisions (platform:finance:read).
--   * platform_finance_replenishment_detail: one request explained for review (platform:finance:read).
--   * school_wallet_read: PIKAS finance actions appear as PIKAS; the operator's name and the
--     internal role stay in Platform audit and finance reads only.
-- Mutations stay the FIN 2 wrappers (decide: replenishments:verify; reverse: replenishments:reverse).
begin;

-- Operational state of a bank-transfer request: pending, posted, rejected, or reversed (posted then
-- reversed). Derived from FIN 2 truth; nothing is stored.
create function pikas_private.finance_request_status(r public.replenishment_requests) returns text language sql stable security definer set search_path = '' as $$
  select case when r.state = 'submitted' then 'pending' when r.state = 'rejected' then 'rejected'
    when exists (select 1 from public.wallet_replenishment_reversals v where v.replenishment_id = r.wallet_replenishment_id) then 'reversed' else 'posted' end
$$;

-- Queue (pending, oldest first) or history (decided, newest first). Bank transfers only (FIN 3).
-- Pilot-sized: at most 50 rows; `truncated` says more exist. No internal identifiers.
create function public.platform_finance_replenishments_read(p_view text, p_status text default null, p_query text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
        'submitted_at',r.submitted_at,'decided_at',r.decided_at,'reversed_at',v.reversed_at,
        'decided_by',dp.display_name,'reversed_by',vp.display_name) row
    from public.replenishment_requests r
    join public.accounts a on a.id = r.account_id
    join public.schools s on s.id = r.school_id
    join public.students st on st.id = r.student_id
    left join public.wallet_replenishment_reversals v on v.replenishment_id = r.wallet_replenishment_id
    left join public.persons dp on dp.id = r.decided_by
    left join public.persons vp on vp.id = v.actor_person_id
    where r.method = 'bank_transfer'
      and (case when p_view = 'pending' then r.state = 'submitted' else r.state <> 'submitted' end)
      and (p_status is null or pikas_private.finance_request_status(r) = p_status)
      and (q is null or r.reference ilike '%'||q||'%' or a.name ilike '%'||q||'%' or st.display_name ilike '%'||q||'%' or st.student_code ilike '%'||q||'%')
    order by 1 limit 51) x;
  return jsonb_build_object('view',p_view,'status',p_status,'query',q,
    'requests',case when jsonb_array_length(rows) > 50 then rows - 50 else rows end,'truncated',jsonb_array_length(rows) > 50);
end $$;

-- One bank-transfer request for review: identity, amounts, manual evidence, decisions, reversal and,
-- while a reversal is possible, the wallet context the operator needs. No internal identifiers.
create function public.platform_finance_replenishment_detail(p_reference text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.replenishment_requests; v public.wallet_replenishment_reversals; w public.student_wallets; status text;
begin
  perform pikas_private.require_platform_capability('platform:finance:read');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  if p_reference is null or p_reference !~ '^REC-[0-9]{8}$' then raise exception using errcode = '22023', message = 'INVALID_REFERENCE'; end if;
  select * into r from public.replenishment_requests where reference = p_reference and method = 'bank_transfer';
  if not found then raise exception using errcode = 'P0002', message = 'REPLENISHMENT_REQUEST_NOT_FOUND'; end if;
  select * into v from public.wallet_replenishment_reversals where replenishment_id = r.wallet_replenishment_id;
  select * into w from public.student_wallets where id = r.wallet_id;
  status := pikas_private.finance_request_status(r);
  return jsonb_build_object('reference',r.reference,'status',status,'method',r.method,
    'customer',(select name from public.accounts where id = r.account_id),
    'customer_activated',pikas_private.financial_activation(r.account_id) is not null,
    'school',(select name from public.schools where id = r.school_id),
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
end $$;

revoke all on function pikas_private.finance_request_status(public.replenishment_requests) from public, anon, authenticated, service_role;
revoke all on function public.platform_finance_replenishments_read(text,text,text), public.platform_finance_replenishment_detail(text) from public, anon, service_role;
grant execute on function public.platform_finance_replenishments_read(text,text,text), public.platform_finance_replenishment_detail(text) to authenticated;

-- ── School wallet history: unchanged from 202610200001 except PIKAS finance attribution ───────
create or replace function public.school_wallet_read(p_school_id uuid,p_student_id uuid,p_before bigint default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
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
 'cafeteria',coalesce(c.name,adjc.name),'adjustment_reason',a.reason_code,'actor_role',case when a.actor_source='platform_finance' then 'pikas' else a.actor_role end,'balance_before_minor',a.balance_before_minor::text,'reversal_id',coalesce(rv.id,rr.id),'reversed_replenishment_id',rv.replenishment_id,
 'reversal_reason',coalesce(rv.reason,rr.reason),'reversal_note',rv.note,'reversed_at',rr.reversed_at,
 'original_reference',orig.reference,'original_note',orig.verification_note,'original_amount_minor',orig.amount_minor::text,'items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'quantity',i.quantity,
 'line_total_minor',i.line_total_minor::text) order by i.line_number),'[]'::jsonb) from public.purchase_items i where i.purchase_id=p.id)) row
 from public.wallet_ledger_entries l
 left join public.wallet_replenishments r on r.id=l.replenishment_id
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
end $$;

commit;
