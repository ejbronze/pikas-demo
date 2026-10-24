-- PIKAS Settlement: activation ending never strands obligations (local; not deployed).
--
-- Financial activation governs NEW financial activity: cash collection, bank-transfer posting and every other FIN 2 event
-- still require an active policy, unchanged. It does not govern settling obligations that already exist. 202611200001
-- refused to finalize (and hid ready periods, and turned the Cafetería view off) once a customer's activation ended,
-- which stranded money validly owed while it was active. Every obligation was created under an active policy (FIN 2
-- writes none otherwise), so settlement eligibility is the obligation itself:
--   * pikas_private.settlement_finalize: no current-activation check (sandbox customers stay refused);
--   * pikas_private.settlement_run: every customer Cafetería with unattached obligations;
--   * platform_finance_settlements_read: ready periods regardless of current activation;
--   * cafeteria_settlements_read: enabled while activated or while the Cafetería has historical obligations.
-- Customer/Cafetería lifecycle never gated Platform settlement and still does not; tenant access is unchanged (the
-- Cafetería read keeps require_cafeteria_admin). Finalized snapshots are untouched. Same signatures, same ACLs.
begin;

create or replace function pikas_private.settlement_finalize(p_cafeteria_id uuid, p_week date, p_actor uuid, p_request_key text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cafeterias; acct public.accounts; s public.settlements; owes_c bigint; owes_k bigint; lines integer; late integer; cur text; fp text; picked uuid[]; currencies integer;
begin
  if p_request_key is null or length(p_request_key) not between 16 and 200 then raise exception using errcode = '22023', message = 'invalid_request_key'; end if;
  if p_week is null or extract(isodow from p_week) <> 1 then raise exception using errcode = '22023', message = 'INVALID_SETTLEMENT_WEEK'; end if;
  select * into c from public.cafeterias where id = p_cafeteria_id;
  if not found then raise exception using errcode = '23503', message = 'cafeteria_not_found'; end if;
  select * into acct from public.accounts where id = c.account_id;
  if acct.tenant_kind <> 'customer' then raise exception using errcode = '42501', message = 'SETTLEMENT_SANDBOX_REFUSED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('settlement:' || p_cafeteria_id::text, 0));
  -- Authority after the wait: the caller must still hold settlement authority and be the actor.
  if pikas_private.require_platform_capability('platform:finance:settlement:manage') is distinct from p_actor then
    raise exception using errcode = '42501', message = 'not_authorized'; end if;
  select * into s from public.settlements where cafeteria_id = p_cafeteria_id and week_start = p_week;
  if found then return pikas_private.settlement_result(s, true); end if;
  -- No current-activation check: every obligation was created under an active policy (FIN 2 records none otherwise), so an
  -- ended activation, a suspended or closed customer or an inactive Cafetería never strands money already owed.
  if pikas_private.settlement_period_end(p_week) > p_now then raise exception using errcode = '23514', message = 'PERIOD_NOT_ENDED'; end if;
  if exists (select 1 from public.financial_obligations o where o.cafeteria_id = p_cafeteria_id and o.settlement_week_start < p_week
      and not exists (select 1 from public.settlement_lines l where l.obligation_id = o.id)
      and not exists (select 1 from public.settlements x where x.cafeteria_id = p_cafeteria_id and x.week_start = o.settlement_week_start)) then
    raise exception using errcode = '23514', message = 'EARLIER_PERIOD_PENDING'; end if;
  -- One snapshot of the unattached obligations (new ones committing meanwhile are carried to a later settlement).
  select array_agg(o.id) into picked from public.financial_obligations o
    where o.cafeteria_id = p_cafeteria_id and o.settlement_week_start <= p_week and not exists (select 1 from public.settlement_lines l where l.obligation_id = o.id);
  select count(*), count(*) filter (where o.settlement_week_start < p_week), coalesce(sum(o.amount_minor) filter (where d.kind = 'cafeteria'),0),
    coalesce(sum(o.amount_minor) filter (where d.kind = 'clearing'),0), min(o.currency_code), count(distinct o.currency_code)
    into lines, late, owes_c, owes_k, cur, currencies
    from public.financial_obligations o join public.financial_parties d on d.id = o.debtor_party_id where o.id = any(coalesce(picked, '{}'));
  if lines = 0 then raise exception using errcode = '23514', message = 'NOTHING_TO_SETTLE'; end if;
  if currencies > 1 then raise exception using errcode = '23514', message = 'SETTLEMENT_CURRENCY_MISMATCH'; end if;
  insert into public.settlements(reference,account_id,school_id,cafeteria_id,cafeteria_party_id,currency_code,week_start,period_starts_at,period_ends_at,due_on,
    cafeteria_owes_minor,clearing_owes_minor,net_direction,net_amount_minor,line_count,late_line_count,status,finalized_at,finalized_by,settled_at)
  values ('LIQ-' || lpad(nextval('public.settlement_reference_seq')::text, 8, '0'), c.account_id, c.school_id, c.id, pikas_private.cafeteria_party(c.id), cur, p_week,
    pikas_private.settlement_period_start(p_week), pikas_private.settlement_period_end(p_week), p_week + 8, owes_c, owes_k,
    case when owes_c > owes_k then 'cafeteria_to_clearing' when owes_k > owes_c then 'clearing_to_cafeteria' else 'none' end, abs(owes_c - owes_k), lines, late,
    case when owes_c = owes_k then 'settled' else 'due' end, clock_timestamp(), p_actor, case when owes_c = owes_k then clock_timestamp() end) returning * into s;
  insert into public.settlement_lines(settlement_id,account_id,cafeteria_id,obligation_id,reason,direction,amount_minor,obligation_week_start,late)
    select s.id, s.account_id, s.cafeteria_id, o.id, o.reason, case when d.kind = 'cafeteria' then 'cafeteria_to_clearing' else 'clearing_to_cafeteria' end,
      o.amount_minor, o.settlement_week_start, o.settlement_week_start < p_week
    from public.financial_obligations o join public.financial_parties d on d.id = o.debtor_party_id where o.id = any(picked);
  fp := encode(extensions.digest(convert_to(jsonb_build_object('op','finalize','cafeteria',p_cafeteria_id,'week',p_week)::text,'UTF8'),'sha256'),'hex');
  insert into public.settlement_events(settlement_id,account_id,cafeteria_id,kind,from_status,to_status,direction,actor_person_id,request_key,payload_fingerprint)
    values (s.id, s.account_id, s.cafeteria_id, 'finalized', null, s.status, s.net_direction, p_actor, p_request_key, fp);
  perform pikas_private.record_wallet_audit(p_actor, auth.uid(), 'platform_finance_operator', 'platform', s.account_id, s.school_id, s.cafeteria_id,
    'settlement_finalized', 'settlements', s.id, jsonb_build_object('reference',s.reference,'week_start',s.week_start,'from_status',null,'to_status',s.status,
      'cafeteria_owes_minor',s.cafeteria_owes_minor::text,'clearing_owes_minor',s.clearing_owes_minor::text,'net_direction',s.net_direction,
      'net_amount_minor',s.net_amount_minor::text,'line_count',s.line_count,'late_line_count',s.late_line_count));
  return pikas_private.settlement_result(s, false);
end $$;

create or replace function pikas_private.settlement_run(p_actor uuid, p_request_key text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caf uuid; wk date; done jsonb := '[]'::jsonb; r jsonb;
begin
  if p_request_key is null or length(p_request_key) not between 16 and 128 then raise exception using errcode = '22023', message = 'invalid_request_key'; end if;
  for caf in select distinct o.cafeteria_id from public.financial_obligations o join public.accounts a on a.id = o.account_id
      where a.tenant_kind = 'customer'
        and not exists (select 1 from public.settlement_lines l where l.obligation_id = o.id) order by 1 loop
    loop
      select min(t.target_week) into wk from pikas_private.settlement_targets(caf, p_now) t where t.target_week is not null;
      exit when wk is null;
      r := pikas_private.settlement_finalize(caf, wk, p_actor, p_request_key || ':' || caf::text || ':' || wk::text, p_now);
      done := done || jsonb_build_array(r);
      exit when (r->>'replayed')::boolean;
    end loop;
  end loop;
  return jsonb_build_object('finalized', done, 'count', jsonb_array_length(done));
end $$;

create or replace function public.platform_finance_settlements_read(p_view text, p_query text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q text := nullif(btrim(p_query),''); now_value timestamptz := clock_timestamp(); rows jsonb; ready jsonb; total integer;
begin
  perform pikas_private.require_platform_capability('platform:finance:read');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  if p_view is null or p_view not in ('action','history') then raise exception using errcode = '22023', message = 'INVALID_FINANCE_VIEW'; end if;
  if length(q) > 80 then raise exception using errcode = '22023', message = 'INVALID_FINANCE_QUERY'; end if;
  with matching as (
    select s, s.week_start w, s.reference ref, sc.name school_name from public.settlements s join public.cafeterias c on c.id = s.cafeteria_id
    join public.accounts a on a.id = s.account_id join public.schools sc on sc.id = s.school_id
    where (p_view = 'history' or s.status <> 'settled')
      and (q is null or s.reference ilike '%' || q || '%' or c.name ilike '%' || q || '%' or a.name ilike '%' || q || '%')),
  page as (select * from matching order by case when p_view = 'action' then w end asc, case when p_view = 'history' then w end desc, ref limit 50)
  select (select count(*) from matching), coalesce(jsonb_agg((pikas_private.settlement_result(p.s, false) - 'replayed')
      || jsonb_build_object('school',p.school_name,'overdue',(p.s).status = 'due' and (p.s).due_on < (now_value at time zone 'America/Santo_Domingo')::date)
      order by case when p_view = 'action' then p.w end asc, case when p_view = 'history' then p.w end desc, p.ref),'[]'::jsonb)
    into total, rows from page p;
  -- Ready periods: ended weeks with unattached obligations and no settlement yet, whether or not the customer is still activated.
  select coalesce(jsonb_agg(jsonb_build_object('cafeteria_id',c.id,'cafeteria',c.name,'customer',a.name,'school',sc.name,'week_start',t.target_week,
      'week_end',t.target_week + 6,'due_on',t.target_week + 8,'cafeteria_owes_minor',t.cafeteria_owes_minor::text,'clearing_owes_minor',t.clearing_owes_minor::text,
      'net_direction',case when t.cafeteria_owes_minor > t.clearing_owes_minor then 'cafeteria_to_clearing' when t.clearing_owes_minor > t.cafeteria_owes_minor then 'clearing_to_cafeteria' else 'none' end,
      'net_amount_minor',abs(t.cafeteria_owes_minor - t.clearing_owes_minor)::text,'line_count',t.line_count,'late_line_count',t.late_line_count)
      order by t.target_week, c.name),'[]'::jsonb)
    into ready
    from public.cafeterias c join public.accounts a on a.id = c.account_id join public.schools sc on sc.id = c.school_id
    cross join lateral pikas_private.settlement_live_totals(c.id, now_value) t
    where p_view = 'action' and a.tenant_kind = 'customer' and exists (select 1 from public.financial_obligations o where o.cafeteria_id = c.id) and t.target_week is not null
      and (q is null or c.name ilike '%' || q || '%' or a.name ilike '%' || q || '%');
  return jsonb_build_object('view',p_view,'query',q,'ready',ready,'settlements',rows,'truncated',total > 50);
end $$;

create or replace function public.cafeteria_settlements_read(p_cafeteria_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cafeterias; acct public.accounts; now_value timestamptz := clock_timestamp(); enabled boolean;
begin
  c := pikas_private.require_cafeteria_settlement_read(p_cafeteria_id);
  select * into acct from public.accounts where id = c.account_id;
  -- Visible while activated and afterwards for as long as the Cafetería has historical obligations or settlements.
  enabled := acct.tenant_kind = 'customer' and (pikas_private.financial_activation(acct.id) is not null
    or exists (select 1 from public.financial_obligations o where o.cafeteria_id = c.id));
  return jsonb_build_object('cafeteria_id',c.id,'enabled',enabled,
    'current',(select jsonb_build_object('week_start',pikas_private.settlement_week_start(now_value),'week_end',pikas_private.settlement_week_start(now_value) + 6,
        'due_on',pikas_private.settlement_week_start(now_value) + 8,'cafeteria_owes_minor',coalesce(t.cafeteria_owes_minor,0)::text,
        'clearing_owes_minor',coalesce(t.clearing_owes_minor,0)::text,'line_count',coalesce(t.line_count,0))
      from (select 1) one left join pikas_private.settlement_live_totals(c.id, now_value) t on t.target_week is null),
    'pending',coalesce((select jsonb_agg(jsonb_build_object('week_start',t.target_week,'week_end',t.target_week + 6,'due_on',t.target_week + 8,
        'cafeteria_owes_minor',t.cafeteria_owes_minor::text,'clearing_owes_minor',t.clearing_owes_minor::text,'line_count',t.line_count) order by t.target_week)
      from pikas_private.settlement_live_totals(c.id, now_value) t where t.target_week is not null),'[]'::jsonb),
    'settlements',coalesce((select jsonb_agg(x.r order by x.w desc) from (select s.week_start w, (pikas_private.settlement_result(s, false) - 'replayed' - 'customer' - 'cafeteria') r
      from public.settlements s where s.cafeteria_id = c.id order by s.week_start desc limit 26) x),'[]'::jsonb));
end $$;

revoke all on function pikas_private.settlement_finalize(uuid,date,uuid,text,timestamptz), pikas_private.settlement_run(uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.platform_finance_settlements_read(text,text), public.cafeteria_settlements_read(uuid) from public, anon, service_role;
grant execute on function public.platform_finance_settlements_read(text,text), public.cafeteria_settlements_read(uuid) to authenticated;
do $acl$
begin
  if exists (select 1 from pg_proc p where p.oid in ('pikas_private.settlement_finalize(uuid,date,uuid,text,timestamptz)'::regprocedure, 'pikas_private.settlement_run(uuid,text,timestamptz)'::regprocedure)
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee <> p.proowner)))
    or exists (select 1 from pg_proc p where p.oid in ('public.platform_finance_settlements_read(text,text)'::regprocedure, 'public.cafeteria_settlements_read(uuid)'::regprocedure)
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee in (0, 'anon'::regrole::oid, 'service_role'::regrole::oid))
        or not has_function_privilege('authenticated', p.oid, 'execute')))
    or exists (select 1 from pikas_private.platform_role_capabilities where capability = 'platform:finance:settlement:manage') then
    raise exception 'settlement_activation_end_acl_mismatch'; end if;
end $acl$;

commit;
