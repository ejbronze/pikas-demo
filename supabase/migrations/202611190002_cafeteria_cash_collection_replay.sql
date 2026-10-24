-- PIKAS FIN 4 follow-up (local; not deployed): cash-collection retries replay before authorization.
--
-- 202611190001 re-validated scope, sharing and lifecycle before reaching the idempotent replay. A retry of a request
-- that HAD posted could then be refused (for example after the School stopped sharing the student), and the operator
-- would be told nothing was recorded. Now a retry with the same request key by the same operator, for the identical
-- payload, returns the original authoritative result first; a different payload or another person's key is
-- IDEMPOTENCY_CONFLICT. New collections keep every 202611190001 check unchanged. No financial semantics change.
begin;

create or replace function public.cafeteria_wallet_collect_cash(p_cafeteria_id uuid, p_student_id uuid, p_gross_minor bigint, p_payer_name text, p_request_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ctx jsonb; c public.cafeterias; acct public.accounts; customer uuid; actor uuid; replay boolean; result jsonb; r public.replenishment_requests; caller uuid;
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
  -- Replay first: a retry of a request this operator already posted returns that request's authoritative result, even if
  -- scope, sharing or wallet state changed since. A refusal therefore always means the original never posted.
  select * into c from public.cafeterias where id = p_cafeteria_id;
  if not found then raise exception using errcode = '42501', message = 'cafeteria_authority_required'; end if;
  caller := pikas_private.current_person_id();
  select * into r from public.replenishment_requests where account_id = c.account_id and request_key = p_request_key::text;
  if found then
    if caller is null or r.submitted_by <> caller or r.method <> 'cafeteria_cash' or r.collecting_cafeteria_id <> c.id or r.student_id <> p_student_id
      or r.gross_minor <> p_gross_minor or coalesce(r.payer_name, '') <> coalesce(nullif(btrim(p_payer_name), ''), '') then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('request_key', p_request_key, 'reference', r.reference, 'state', r.state, 'cafeteria_id', c.id, 'student_id', r.student_id,
      'student_name', (select display_name from public.students where id = r.student_id),
      'gross_minor', r.gross_minor::text, 'fee_minor', r.fee_minor::text, 'net_minor', r.net_minor::text, 'fee_bps', r.fee_bps,
      'balance_after_minor', (select l.balance_after_minor::text from public.wallet_ledger_entries l where l.replenishment_id = r.wallet_replenishment_id),
      'collected_at', r.posted_at, 'collected_by', (select display_name from public.persons where id = r.submitted_by), 'payer_name', r.payer_name, 'replayed', true);
  end if;
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

revoke all on function public.cafeteria_wallet_collect_cash(uuid,uuid,bigint,text,uuid) from public, anon, service_role;
grant execute on function public.cafeteria_wallet_collect_cash(uuid,uuid,bigint,text,uuid) to authenticated;
do $acl$ begin
  if has_function_privilege('anon','public.cafeteria_wallet_collect_cash(uuid,uuid,bigint,text,uuid)','execute')
    or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid='public.cafeteria_wallet_collect_cash(uuid,uuid,bigint,text,uuid)'::regprocedure and a.grantee=0)
    or not has_function_privilege('authenticated','public.cafeteria_wallet_collect_cash(uuid,uuid,bigint,text,uuid)','execute') then
    raise exception 'fin4_acl_mismatch';
  end if;
end $acl$;

commit;
