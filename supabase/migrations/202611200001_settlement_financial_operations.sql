-- PIKAS Settlement & Financial Operations (local; not deployed).
--
-- Settlement records and reconciles obligations. It does not independently move money through a bank.
--
-- FIN 2 already records every obligation with its settlement week (Monday–Sunday, America/Santo_Domingo, due the
-- following Tuesday), in both directions:
--   Cafetería → clearing: cash_collection (gross), wallet_refund_correction, legacy_purchase_refund
--   clearing → Cafetería: wallet_purchase_fulfillment (the wallet-funded amount), cash_collection_reversal
-- This migration adds no obligation and changes none. It adds:
--   * settlements: one authoritative, immutable snapshot per Cafetería and settlement week (gross both ways, net
--     direction and amount), created by finalization once the week has ended;
--   * settlement_lines: which obligations a settlement includes (each obligation at most once, ever);
--   * settlement_events: finalization, payment/payout confirmation and review transitions (append-only);
--   * Platform finance operations under the catalogued platform:finance:settlement:manage (granted to no role);
--   * reads for Platform finance (platform:finance:read) and for the Cafetería's own settlements
--     (cafeteria:finance:obligations:read, now granted to cafeteria_admin).
-- Open and ready periods are derived from unattached obligations; only finalization writes. Late activity (an
-- obligation committed after its week was finalized) is never added to the finalized settlement: it is carried into
-- the next settlement and marked late. Net zero settles at finalization without a payment. No fee is recalculated.
-- Sandbox customers are refused; customers without an active financial activation are refused.
begin;

-- ── Calendar helpers (the named timezone is the contract) ──────────────────────────────────────
create function pikas_private.settlement_period_start(p_week date) returns timestamptz language sql immutable set search_path = '' as $$
  select (p_week::timestamp) at time zone 'America/Santo_Domingo'
$$;
create function pikas_private.settlement_period_end(p_week date) returns timestamptz language sql immutable set search_path = '' as $$
  select ((p_week + 7)::timestamp) at time zone 'America/Santo_Domingo'
$$;

-- ── Settlements ────────────────────────────────────────────────────────────────────────────────
create sequence public.settlement_reference_seq;
create table public.settlements(
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^LIQ-[0-9]{8}$'),
  account_id uuid not null references public.accounts(id),
  school_id uuid not null references public.schools(id),
  cafeteria_id uuid not null references public.cafeterias(id),
  cafeteria_party_id uuid not null references public.financial_parties(id),
  currency_code text not null references public.supported_currencies(currency_code),
  week_start date not null check (extract(isodow from week_start) = 1),
  period_starts_at timestamptz not null,
  period_ends_at timestamptz not null,
  due_on date not null,
  cafeteria_owes_minor bigint not null check (cafeteria_owes_minor >= 0),
  clearing_owes_minor bigint not null check (clearing_owes_minor >= 0),
  net_direction text not null check (net_direction in ('cafeteria_to_clearing','clearing_to_cafeteria','none')),
  net_amount_minor bigint not null check (net_amount_minor >= 0),
  line_count integer not null check (line_count > 0),
  late_line_count integer not null check (late_line_count >= 0 and late_line_count <= line_count),
  status text not null check (status in ('due','in_review','settled')),
  finalized_at timestamptz not null,
  finalized_by uuid not null references public.persons(id),
  settled_at timestamptz,
  unique (cafeteria_id, currency_code, week_start),
  check (due_on = week_start + 8),
  check (period_ends_at > period_starts_at),
  check (net_amount_minor = abs(cafeteria_owes_minor - clearing_owes_minor)),
  check (net_direction = case when cafeteria_owes_minor > clearing_owes_minor then 'cafeteria_to_clearing'
    when clearing_owes_minor > cafeteria_owes_minor then 'clearing_to_cafeteria' else 'none' end),
  check ((status = 'settled') = (settled_at is not null)),
  check (net_direction <> 'none' or status = 'settled')
);
create table public.settlement_lines(
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id),
  account_id uuid not null references public.accounts(id),
  cafeteria_id uuid not null references public.cafeterias(id),
  obligation_id uuid not null unique references public.financial_obligations(id),
  reason text not null,
  direction text not null check (direction in ('cafeteria_to_clearing','clearing_to_cafeteria')),
  amount_minor bigint not null check (amount_minor > 0),
  obligation_week_start date not null,
  late boolean not null
);
create index settlement_lines_settlement on public.settlement_lines(settlement_id);
create index financial_obligations_settlement_week on public.financial_obligations(cafeteria_id, settlement_week_start);
create table public.settlement_events(
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id),
  account_id uuid not null references public.accounts(id),
  cafeteria_id uuid not null references public.cafeterias(id),
  kind text not null check (kind in ('finalized','payment_confirmed','payment_mismatch','review_opened','review_resolved')),
  from_status text check (from_status in ('due','in_review')),
  to_status text not null check (to_status in ('due','in_review','settled')),
  direction text not null check (direction in ('cafeteria_to_clearing','clearing_to_cafeteria','none')),
  amount_minor bigint check (amount_minor > 0),
  payment_reference text check (length(payment_reference) between 3 and 120),
  paid_on date,
  reason text check (reason in ('cash_total_differs','wallet_sales_differ','refund_missing','payment_differs','cafeteria_dispute','other')),
  note text check (length(note) between 1 and 500),
  actor_person_id uuid not null references public.persons(id),
  request_key text not null unique check (length(request_key) between 16 and 200),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default clock_timestamp(),
  check ((kind in ('payment_confirmed','payment_mismatch')) = (amount_minor is not null and payment_reference is not null and paid_on is not null)),
  check (kind <> 'review_opened' or reason is not null),
  check (kind <> 'review_resolved' or note is not null)
);
create unique index settlement_events_one_finalization on public.settlement_events(settlement_id) where kind = 'finalized';
create unique index settlement_events_one_payment on public.settlement_events(settlement_id) where kind = 'payment_confirmed';
create index settlement_events_settlement on public.settlement_events(settlement_id, occurred_at);

-- Snapshot columns never change; status moves only along the approved lifecycle.
create function pikas_private.guard_settlement_update() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception using errcode = '23514', message = 'wallet_financial_history_is_immutable'; end if;
  if (new.id, new.reference, new.account_id, new.school_id, new.cafeteria_id, new.cafeteria_party_id, new.currency_code, new.week_start,
      new.period_starts_at, new.period_ends_at, new.due_on, new.cafeteria_owes_minor, new.clearing_owes_minor, new.net_direction,
      new.net_amount_minor, new.line_count, new.late_line_count, new.finalized_at, new.finalized_by)
     is distinct from (old.id, old.reference, old.account_id, old.school_id, old.cafeteria_id, old.cafeteria_party_id, old.currency_code, old.week_start,
      old.period_starts_at, old.period_ends_at, old.due_on, old.cafeteria_owes_minor, old.clearing_owes_minor, old.net_direction,
      old.net_amount_minor, old.line_count, old.late_line_count, old.finalized_at, old.finalized_by) then
    raise exception using errcode = '23514', message = 'wallet_financial_history_is_immutable';
  end if;
  if old.status = 'settled' or (old.status, new.status) not in (('due','in_review'),('in_review','due'),('due','settled'),('in_review','settled')) then
    raise exception using errcode = '23514', message = 'SETTLEMENT_STATUS_CONFLICT';
  end if;
  return new;
end $$;
create trigger settlements_guard before update or delete on public.settlements for each row execute function pikas_private.guard_settlement_update();
create trigger settlements_no_truncate before truncate on public.settlements for each statement execute function pikas_private.reject_wallet_history_mutation();
create trigger settlement_lines_immutable before update or delete on public.settlement_lines for each row execute function pikas_private.reject_wallet_history_mutation();
create trigger settlement_lines_no_truncate before truncate on public.settlement_lines for each statement execute function pikas_private.reject_wallet_history_mutation();
create trigger settlement_events_immutable before update or delete on public.settlement_events for each row execute function pikas_private.reject_wallet_history_mutation();
create trigger settlement_events_no_truncate before truncate on public.settlement_events for each statement execute function pikas_private.reject_wallet_history_mutation();

-- A line must be exactly its obligation: same Cafetería, reason, direction and amount, from this week or earlier.
create function pikas_private.guard_settlement_line() returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.financial_obligations; s public.settlements; debtor text;
begin
  select * into o from public.financial_obligations where id = new.obligation_id;
  select * into s from public.settlements where id = new.settlement_id;
  select kind into debtor from public.financial_parties where id = o.debtor_party_id;
  if o.cafeteria_id <> s.cafeteria_id or o.account_id <> s.account_id or o.currency_code <> s.currency_code or new.cafeteria_id <> s.cafeteria_id
    or new.account_id <> s.account_id or new.reason <> o.reason or new.amount_minor <> o.amount_minor or new.obligation_week_start <> o.settlement_week_start
    or o.settlement_week_start > s.week_start or new.late <> (o.settlement_week_start < s.week_start)
    or new.direction <> (case when debtor = 'cafeteria' then 'cafeteria_to_clearing' else 'clearing_to_cafeteria' end) then
    raise exception using errcode = '23514', message = 'SETTLEMENT_LINE_MISMATCH';
  end if;
  return new;
end $$;
create trigger settlement_line_guard before insert on public.settlement_lines for each row execute function pikas_private.guard_settlement_line();

alter table public.settlements enable row level security; alter table public.settlements force row level security;
alter table public.settlement_lines enable row level security; alter table public.settlement_lines force row level security;
alter table public.settlement_events enable row level security; alter table public.settlement_events force row level security;
revoke all on public.settlements, public.settlement_lines, public.settlement_events from public, anon, authenticated, service_role;
revoke all on sequence public.settlement_reference_seq from public, anon, authenticated, service_role;

-- ── Which settlement week an unattached obligation belongs to ──────────────────────────────────
-- Candidates are ended weeks without a settlement for the Cafetería: each week that still has unattached obligations,
-- and the last ended week (for late obligations whose own week is already finalized). An obligation goes to the
-- earliest candidate on or after its own week; none means it waits for the open week to end.
create function pikas_private.settlement_targets(p_cafeteria_id uuid, p_now timestamptz)
returns table(obligation_id uuid, target_week date) language sql stable security definer set search_path = '' as $$
  with open_obligations as (
    select o.id, o.settlement_week_start w from public.financial_obligations o
    where o.cafeteria_id = p_cafeteria_id and not exists (select 1 from public.settlement_lines l where l.obligation_id = o.id)),
  last_ended as (select pikas_private.settlement_week_start(p_now) - 7 as w),
  candidates as (
    select w from (select distinct w from open_obligations union select w from last_ended) c
    where pikas_private.settlement_period_end(c.w) <= p_now
      and not exists (select 1 from public.settlements s where s.cafeteria_id = p_cafeteria_id and s.week_start = c.w))
  select oo.id, (select min(c.w) from candidates c where c.w >= oo.w) from open_obligations oo
$$;

-- Live totals of the obligations a target week would include (preview, ready periods and the open week).
create function pikas_private.settlement_live_totals(p_cafeteria_id uuid, p_now timestamptz)
returns table(target_week date, cafeteria_owes_minor bigint, clearing_owes_minor bigint, line_count integer, late_line_count integer)
language sql stable security definer set search_path = '' as $$
  select t.target_week, coalesce(sum(o.amount_minor) filter (where d.kind = 'cafeteria'),0)::bigint, coalesce(sum(o.amount_minor) filter (where d.kind = 'clearing'),0)::bigint,
    count(*)::integer, count(*) filter (where t.target_week is not null and o.settlement_week_start < t.target_week)::integer
  from pikas_private.settlement_targets(p_cafeteria_id, p_now) t join public.financial_obligations o on o.id = t.obligation_id
  join public.financial_parties d on d.id = o.debtor_party_id group by t.target_week
$$;

create function pikas_private.settlement_result(s public.settlements, p_replayed boolean) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('reference',s.reference,'status',s.status,'cafeteria',c.name,'customer',a.name,'week_start',s.week_start,'week_end',s.week_start + 6,
    'due_on',s.due_on,'cafeteria_owes_minor',s.cafeteria_owes_minor::text,'clearing_owes_minor',s.clearing_owes_minor::text,'net_direction',s.net_direction,
    'net_amount_minor',s.net_amount_minor::text,'line_count',s.line_count,'late_line_count',s.late_line_count,'finalized_at',s.finalized_at,'settled_at',s.settled_at,
    'replayed',p_replayed)
  from public.cafeterias c, public.accounts a where c.id = s.cafeteria_id and a.id = s.account_id
$$;

-- ── Finalization (internal; the clock is a parameter so the calendar is testable) ──────────────
create function pikas_private.settlement_finalize(p_cafeteria_id uuid, p_week date, p_actor uuid, p_request_key text, p_now timestamptz)
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
  if pikas_private.financial_activation(c.account_id) is null then raise exception using errcode = '23514', message = 'FINANCIAL_POLICY_NOT_ACTIVE'; end if;
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

-- Finalize every ended period of every activated customer Cafetería, oldest first. Idempotent: a repeat finds the
-- settlements already there. This is the scheduling boundary: today a finance operator triggers it; a scheduler can
-- later call the same function without changing settlement semantics.
create function pikas_private.settlement_run(p_actor uuid, p_request_key text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caf uuid; wk date; done jsonb := '[]'::jsonb; r jsonb;
begin
  if p_request_key is null or length(p_request_key) not between 16 and 128 then raise exception using errcode = '22023', message = 'invalid_request_key'; end if;
  for caf in select distinct o.cafeteria_id from public.financial_obligations o join public.accounts a on a.id = o.account_id
      where a.tenant_kind = 'customer' and pikas_private.financial_activation(o.account_id) is not null
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

-- ── Payment confirmation and review (internal) ─────────────────────────────────────────────────
create function pikas_private.settlement_transition(p_reference text, p_actor uuid, p_kind text, p_amount_minor bigint, p_payment_reference text,
  p_paid_on date, p_reason text, p_note text, p_request_key text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.settlements; ev public.settlement_events; fp text; clean_ref text; clean_note text; target text; kind text := p_kind;
begin
  if p_request_key is null or length(p_request_key) not between 16 and 128 then raise exception using errcode = '22023', message = 'invalid_request_key'; end if;
  clean_ref := nullif(btrim(p_payment_reference),''); clean_note := nullif(btrim(p_note),'');
  if length(clean_note) > 500 then raise exception using errcode = '22023', message = 'INVALID_SETTLEMENT_NOTE'; end if;
  if p_kind = 'payment' then
    if p_amount_minor is null or p_amount_minor <= 0 then raise exception using errcode = '22023', message = 'INVALID_PAYMENT_AMOUNT'; end if;
    if clean_ref is null or length(clean_ref) not between 3 and 120 then raise exception using errcode = '22023', message = 'INVALID_PAYMENT_REFERENCE'; end if;
    if p_paid_on is null or p_paid_on > (p_now at time zone 'America/Santo_Domingo')::date then raise exception using errcode = '22023', message = 'INVALID_PAYMENT_DATE'; end if;
  elsif p_kind = 'review_opened' then
    if p_reason is null or p_reason not in ('cash_total_differs','wallet_sales_differ','refund_missing','payment_differs','cafeteria_dispute','other') then
      raise exception using errcode = '22023', message = 'INVALID_REVIEW_REASON'; end if;
    if p_reason = 'other' and (clean_note is null or length(clean_note) < 3) then raise exception using errcode = '22023', message = 'INVALID_SETTLEMENT_NOTE'; end if;
  elsif p_kind = 'review_resolved' then
    if clean_note is null or length(clean_note) < 3 then raise exception using errcode = '22023', message = 'INVALID_SETTLEMENT_NOTE'; end if;
  else raise exception using errcode = '22023', message = 'INVALID_SETTLEMENT_ACTION'; end if;
  select * into s from public.settlements where reference = p_reference;
  if not found then raise exception using errcode = '23503', message = 'SETTLEMENT_NOT_FOUND'; end if;
  select * into s from public.settlements where id = s.id for update;
  if pikas_private.require_platform_capability('platform:finance:settlement:manage') is distinct from p_actor then
    raise exception using errcode = '42501', message = 'not_authorized'; end if;
  fp := encode(extensions.digest(convert_to(jsonb_build_object('op',p_kind,'settlement',s.id,'actor',p_actor,'amount',p_amount_minor,'payment_reference',clean_ref,
    'paid_on',p_paid_on,'reason',p_reason,'note',clean_note)::text,'UTF8'),'sha256'),'hex');
  select * into ev from public.settlement_events where request_key = p_request_key;
  if found then
    if ev.payload_fingerprint <> fp or ev.settlement_id <> s.id then raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT'; end if;
    return pikas_private.settlement_result(s, true) || jsonb_build_object('event', ev.kind);
  end if;
  if s.status = 'settled' then raise exception using errcode = '23514', message = 'SETTLEMENT_ALREADY_SETTLED'; end if;
  if p_kind = 'payment' then
    -- One settlement amount, one confirmed payment. Any other amount is recorded and sent to review, never settled partially.
    if p_amount_minor = s.net_amount_minor then kind := 'payment_confirmed'; target := 'settled'; else kind := 'payment_mismatch'; target := 'in_review'; end if;
  elsif p_kind = 'review_opened' then
    if s.status <> 'due' then raise exception using errcode = '23514', message = 'SETTLEMENT_STATUS_CONFLICT'; end if; target := 'in_review';
  else
    if s.status <> 'in_review' then raise exception using errcode = '23514', message = 'SETTLEMENT_STATUS_CONFLICT'; end if; target := 'due';
  end if;
  insert into public.settlement_events(settlement_id,account_id,cafeteria_id,kind,from_status,to_status,direction,amount_minor,payment_reference,paid_on,reason,note,
    actor_person_id,request_key,payload_fingerprint)
  values (s.id, s.account_id, s.cafeteria_id, kind, s.status, target, s.net_direction, case when p_kind = 'payment' then p_amount_minor end,
    case when p_kind = 'payment' then clean_ref end, case when p_kind = 'payment' then p_paid_on end, case when p_kind = 'review_opened' then p_reason end,
    clean_note, p_actor, p_request_key, fp) returning * into ev;
  if target <> s.status then
    update public.settlements set status = target, settled_at = case when target = 'settled' then clock_timestamp() end where id = s.id returning * into s;
  end if;
  perform pikas_private.record_wallet_audit(p_actor, auth.uid(), 'platform_finance_operator', 'platform', s.account_id, s.school_id, s.cafeteria_id,
    'settlement_' || kind, 'settlements', s.id, jsonb_build_object('reference',s.reference,'from_status',ev.from_status,'to_status',ev.to_status,
      'net_direction',s.net_direction,'net_amount_minor',s.net_amount_minor::text,'amount_minor',ev.amount_minor::text,'payment_reference',ev.payment_reference,
      'paid_on',ev.paid_on,'reason',ev.reason));
  return pikas_private.settlement_result(s, false) || jsonb_build_object('event', ev.kind);
end $$;

-- ── Line descriptions shared by the Platform and Cafetería reads (no internal identifiers) ──────
create function pikas_private.settlement_line_detail(p_obligation_id uuid, p_late boolean, p_settlement_week date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('reason',o.reason,'direction',case when d.kind = 'cafeteria' then 'cafeteria_to_clearing' else 'clearing_to_cafeteria' end,
    'amount_minor',o.amount_minor::text,'occurred_at',e.occurred_at,'week_start',o.settlement_week_start,'late',coalesce(p_late, false),
    'replenishment_reference',coalesce(rq.reference, rvq.reference),'student',coalesce(st.display_name, pst.display_name, rst.display_name, rvst.display_name),
    'receipt_number',coalesce(pp.purchase_number, rp.purchase_number)::text,'refund_ordinal',rf.refund_ordinal)
  from public.financial_obligations o join public.financial_entries e on e.id = o.source_entry_id join public.financial_parties d on d.id = o.debtor_party_id
  left join public.replenishment_requests rq on rq.id = e.replenishment_request_id and e.wallet_replenishment_reversal_id is null
  left join public.students st on st.id = rq.student_id
  left join public.wallet_replenishment_reversals rv on rv.id = e.wallet_replenishment_reversal_id
  left join public.replenishment_requests rvq on rvq.id = e.replenishment_request_id and e.wallet_replenishment_reversal_id is not null
  left join public.students rvst on rvst.id = rv.student_id
  left join public.wallet_purchase_debits pd on pd.id = e.wallet_purchase_debit_id left join public.purchases pp on pp.id = pd.purchase_id
  left join public.students pst on pst.id = pd.student_id
  left join public.wallet_refund_credits rc on rc.id = e.wallet_refund_credit_id left join public.refunds rf on rf.id = rc.refund_id
  left join public.purchases rp on rp.id = rc.purchase_id left join public.students rst on rst.id = rc.student_id
  where o.id = p_obligation_id
$$;

create function pikas_private.settlement_events_json(p_settlement_id uuid, p_with_actor boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind',ev.kind,'from_status',ev.from_status,'to_status',ev.to_status,'amount_minor',ev.amount_minor::text,
    'payment_reference',ev.payment_reference,'paid_on',ev.paid_on,'reason',ev.reason,'note',ev.note,'occurred_at',ev.occurred_at,
    'actor',case when p_with_actor then p.display_name end) order by ev.occurred_at, ev.id),'[]'::jsonb)
  from public.settlement_events ev join public.persons p on p.id = ev.actor_person_id where ev.settlement_id = p_settlement_id
$$;

-- ── Public wrappers: Platform finance ─────────────────────────────────────────────────────────
create function public.platform_finance_settlement_finalize(p_cafeteria_id uuid, p_week_start date, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  actor := pikas_private.require_platform_capability('platform:finance:settlement:manage');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  return pikas_private.settlement_finalize(p_cafeteria_id, p_week_start, actor, p_request_key, clock_timestamp());
end $$;

create function public.platform_finance_settlement_run(p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  actor := pikas_private.require_platform_capability('platform:finance:settlement:manage');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  return pikas_private.settlement_run(actor, p_request_key, clock_timestamp());
end $$;

create function public.platform_finance_settlement_confirm_payment(p_reference text, p_amount_minor bigint, p_payment_reference text, p_paid_on date,
  p_note text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  actor := pikas_private.require_platform_capability('platform:finance:settlement:manage');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  return pikas_private.settlement_transition(p_reference, actor, 'payment', p_amount_minor, p_payment_reference, p_paid_on, null, p_note, p_request_key, clock_timestamp());
end $$;

create function public.platform_finance_settlement_review(p_reference text, p_action text, p_reason text, p_note text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  actor := pikas_private.require_platform_capability('platform:finance:settlement:manage');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  if p_action not in ('open','resolve') then raise exception using errcode = '22023', message = 'INVALID_SETTLEMENT_ACTION'; end if;
  return pikas_private.settlement_transition(p_reference, actor, case when p_action = 'open' then 'review_opened' else 'review_resolved' end,
    null, null, null, p_reason, p_note, p_request_key, clock_timestamp());
end $$;

-- Queue (ready periods and settlements needing action) or history (all finalized settlements), at most 50.
create function public.platform_finance_settlements_read(p_view text, p_query text)
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
  -- Ready periods: ended weeks with unattached obligations and no settlement yet (activated customers only).
  select coalesce(jsonb_agg(jsonb_build_object('cafeteria_id',c.id,'cafeteria',c.name,'customer',a.name,'school',sc.name,'week_start',t.target_week,
      'week_end',t.target_week + 6,'due_on',t.target_week + 8,'cafeteria_owes_minor',t.cafeteria_owes_minor::text,'clearing_owes_minor',t.clearing_owes_minor::text,
      'net_direction',case when t.cafeteria_owes_minor > t.clearing_owes_minor then 'cafeteria_to_clearing' when t.clearing_owes_minor > t.cafeteria_owes_minor then 'clearing_to_cafeteria' else 'none' end,
      'net_amount_minor',abs(t.cafeteria_owes_minor - t.clearing_owes_minor)::text,'line_count',t.line_count,'late_line_count',t.late_line_count)
      order by t.target_week, c.name),'[]'::jsonb)
    into ready
    from public.cafeterias c join public.accounts a on a.id = c.account_id join public.schools sc on sc.id = c.school_id
    cross join lateral pikas_private.settlement_live_totals(c.id, now_value) t
    where p_view = 'action' and a.tenant_kind = 'customer' and pikas_private.financial_activation(a.id) is not null and t.target_week is not null
      and (q is null or c.name ilike '%' || q || '%' or a.name ilike '%' || q || '%');
  return jsonb_build_object('view',p_view,'query',q,'ready',ready,'settlements',rows,'truncated',total > 50);
end $$;

create function public.platform_finance_settlement_detail(p_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.settlements;
begin
  perform pikas_private.require_platform_capability('platform:finance:read');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  if p_reference is null or p_reference !~ '^LIQ-[0-9]{8}$' then raise exception using errcode = '22023', message = 'INVALID_REFERENCE'; end if;
  select * into s from public.settlements where reference = p_reference;
  if not found then raise exception using errcode = '23503', message = 'SETTLEMENT_NOT_FOUND'; end if;
  return (pikas_private.settlement_result(s, false) - 'replayed') || jsonb_build_object('school',(select name from public.schools where id = s.school_id),
    'finalized_by',(select display_name from public.persons where id = s.finalized_by),
    'overdue',s.status = 'due' and s.due_on < (clock_timestamp() at time zone 'America/Santo_Domingo')::date,
    'lines',coalesce((select jsonb_agg(pikas_private.settlement_line_detail(l.obligation_id, l.late, s.week_start) order by l.direction, l.reason, l.obligation_week_start, l.id)
      from public.settlement_lines l where l.settlement_id = s.id),'[]'::jsonb),
    'events',pikas_private.settlement_events_json(s.id, true));
end $$;

-- A ready period before finalization: the exact obligations finalization would include right now.
create function public.platform_finance_settlement_preview(p_cafeteria_id uuid, p_week_start date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cafeterias; now_value timestamptz := clock_timestamp(); t record;
begin
  perform pikas_private.require_platform_capability('platform:finance:read');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  select * into c from public.cafeterias where id = p_cafeteria_id;
  if not found then raise exception using errcode = '23503', message = 'SETTLEMENT_NOT_FOUND'; end if;
  select * into t from pikas_private.settlement_live_totals(c.id, now_value) x where x.target_week = p_week_start;
  if not found then raise exception using errcode = '23503', message = 'SETTLEMENT_NOT_FOUND'; end if;
  return jsonb_build_object('status','ready','cafeteria_id',c.id,'cafeteria',c.name,'customer',(select name from public.accounts where id = c.account_id),
    'school',(select name from public.schools where id = c.school_id),'week_start',p_week_start,'week_end',p_week_start + 6,'due_on',p_week_start + 8,
    'cafeteria_owes_minor',t.cafeteria_owes_minor::text,'clearing_owes_minor',t.clearing_owes_minor::text,
    'net_direction',case when t.cafeteria_owes_minor > t.clearing_owes_minor then 'cafeteria_to_clearing' when t.clearing_owes_minor > t.cafeteria_owes_minor then 'clearing_to_cafeteria' else 'none' end,
    'net_amount_minor',abs(t.cafeteria_owes_minor - t.clearing_owes_minor)::text,'line_count',t.line_count,'late_line_count',t.late_line_count,
    'lines',coalesce((select jsonb_agg(pikas_private.settlement_line_detail(x.obligation_id, o.settlement_week_start < p_week_start, p_week_start)
        order by o.settlement_week_start, o.created_at) from pikas_private.settlement_targets(c.id, now_value) x join public.financial_obligations o on o.id = x.obligation_id
      where x.target_week = p_week_start),'[]'::jsonb));
end $$;

-- ── Public wrappers: the Cafetería's own settlements (read only) ───────────────────────────────
create function pikas_private.require_cafeteria_settlement_read(p_cafeteria_id uuid) returns public.cafeterias
language plpgsql security definer set search_path = '' as $$
declare c public.cafeterias;
begin
  if nullif(current_setting('pikas.customer_operations_account', true), '') is not null then
    raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  if exists (select 1 from pikas_private.sandbox_validated_pov()) then raise exception using errcode = '42501', message = 'demo_mode_active'; end if;
  perform pikas_private.require_cafeteria_admin(p_cafeteria_id);
  select * into c from public.cafeterias where id = p_cafeteria_id;
  if not found or not pikas_private.has_capability('cafeteria:finance:obligations:read', c.account_id, c.school_id, c.id) then
    raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  return c;
end $$;

create function public.cafeteria_settlements_read(p_cafeteria_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cafeterias; acct public.accounts; now_value timestamptz := clock_timestamp(); enabled boolean;
begin
  c := pikas_private.require_cafeteria_settlement_read(p_cafeteria_id);
  select * into acct from public.accounts where id = c.account_id;
  enabled := acct.tenant_kind = 'customer' and pikas_private.financial_activation(acct.id) is not null;
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

create function public.cafeteria_settlement_detail(p_cafeteria_id uuid, p_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cafeterias; s public.settlements;
begin
  c := pikas_private.require_cafeteria_settlement_read(p_cafeteria_id);
  if p_reference is null or p_reference !~ '^LIQ-[0-9]{8}$' then raise exception using errcode = '22023', message = 'INVALID_REFERENCE'; end if;
  select * into s from public.settlements where reference = p_reference and cafeteria_id = c.id;
  if not found then raise exception using errcode = '23503', message = 'SETTLEMENT_NOT_FOUND'; end if;
  -- Payment and review history without the PIKAS operator's identity.
  return (pikas_private.settlement_result(s, false) - 'replayed' - 'customer') ||
    jsonb_build_object('lines',coalesce((select jsonb_agg(pikas_private.settlement_line_detail(l.obligation_id, l.late, s.week_start) order by l.direction, l.reason, l.obligation_week_start, l.id)
      from public.settlement_lines l where l.settlement_id = s.id),'[]'::jsonb),'events',pikas_private.settlement_events_json(s.id, false));
end $$;

-- ── Grants ─────────────────────────────────────────────────────────────────────────────────────
-- The Cafetería reads its own settlements. No tenant role manages settlement state; no Platform role is granted
-- platform:finance:settlement:manage here.
insert into pikas_private.role_capabilities(scope_kind, role_code, capability) values ('cafeteria','cafeteria_admin','cafeteria:finance:obligations:read')
  on conflict do nothing;

revoke all on function pikas_private.settlement_period_start(date), pikas_private.settlement_period_end(date), pikas_private.guard_settlement_update(),
  pikas_private.guard_settlement_line(), pikas_private.settlement_targets(uuid,timestamptz), pikas_private.settlement_live_totals(uuid,timestamptz),
  pikas_private.settlement_result(public.settlements,boolean), pikas_private.settlement_finalize(uuid,date,uuid,text,timestamptz),
  pikas_private.settlement_run(uuid,text,timestamptz), pikas_private.settlement_transition(text,uuid,text,bigint,text,date,text,text,text,timestamptz),
  pikas_private.settlement_line_detail(uuid,boolean,date), pikas_private.settlement_events_json(uuid,boolean),
  pikas_private.require_cafeteria_settlement_read(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.platform_finance_settlement_finalize(uuid,date,text), public.platform_finance_settlement_run(text),
  public.platform_finance_settlement_confirm_payment(text,bigint,text,date,text,text), public.platform_finance_settlement_review(text,text,text,text,text),
  public.platform_finance_settlements_read(text,text), public.platform_finance_settlement_detail(text), public.platform_finance_settlement_preview(uuid,date),
  public.cafeteria_settlements_read(uuid), public.cafeteria_settlement_detail(uuid,text)
  from public, anon, service_role;
grant execute on function public.platform_finance_settlement_finalize(uuid,date,text), public.platform_finance_settlement_run(text),
  public.platform_finance_settlement_confirm_payment(text,bigint,text,date,text,text), public.platform_finance_settlement_review(text,text,text,text,text),
  public.platform_finance_settlements_read(text,text), public.platform_finance_settlement_detail(text), public.platform_finance_settlement_preview(uuid,date),
  public.cafeteria_settlements_read(uuid), public.cafeteria_settlement_detail(uuid,text)
  to authenticated;

-- Fail closed: no PUBLIC or anon EXECUTE on any function this migration created, private helpers reachable by no client
-- role, and no table privilege for client roles.
do $acl$
declare bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p
  where (p.pronamespace = 'pikas_private'::regnamespace and p.proname in ('settlement_period_start','settlement_period_end','guard_settlement_update',
      'guard_settlement_line','settlement_targets','settlement_live_totals','settlement_result','settlement_finalize','settlement_run','settlement_transition',
      'settlement_line_detail','settlement_events_json','require_cafeteria_settlement_read')
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee <> p.proowner)))
    or (p.pronamespace = 'public'::regnamespace and p.proname in ('platform_finance_settlement_finalize','platform_finance_settlement_run',
      'platform_finance_settlement_confirm_payment','platform_finance_settlement_review','platform_finance_settlements_read','platform_finance_settlement_detail',
      'platform_finance_settlement_preview','cafeteria_settlements_read','cafeteria_settlement_detail')
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee in (0, 'anon'::regrole::oid, 'service_role'::regrole::oid))
        or not has_function_privilege('authenticated', p.oid, 'execute')));
  if bad is not null then raise exception 'settlement_acl_mismatch: %', bad; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('settlements','settlement_lines','settlement_events')
      and grantee in ('PUBLIC','anon','authenticated','service_role')) then raise exception 'settlement_table_grant_mismatch'; end if;
  if exists (select 1 from pikas_private.platform_role_capabilities where capability = 'platform:finance:settlement:manage') then
    raise exception 'settlement_manage_must_not_be_granted'; end if;
end $acl$;

commit;
