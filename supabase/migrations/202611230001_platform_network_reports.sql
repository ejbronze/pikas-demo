-- PIKAS Reporting Consolidation: Platform network reads (local; not deployed).
--
-- Two bounded, read-only aggregates for Platform Reportes. No table, no stored snapshot, no new capability, no change to
-- any financial rule.
--   * platform_network_report — platform:customer:operations:read (the authority of the Inicio cockpit and
--     platform_customer_readiness). Per customer: lifecycle footprint (colegios, sedes, cafeterías, cajas by status) and
--     per cafetería the released readiness facts and period activity. Real customers only unless p_include_demo.
--   * platform_finance_report — platform:finance:read only. Financial activation, replenishment activity, open
--     obligations and settlement status. Real customers only (a sandbox never has financial activity).
-- Both refuse an active sandbox POV. Report dates are America/Santo_Domingo calendar dates from report_clock() (the
-- private, testable clock already used by Cafetería reports); purchases are classified by their recorded business_date.
begin;

-- Hoy / Últimos 7 días / Últimos 30 días / Personalizado (at most 92 days, never after today) — the 5D convention.
create function pikas_private.network_report_period(p_period text, p_from date, p_to date)
returns table(today date, d_from date, d_to date) language plpgsql stable set search_path = '' as $$
declare t date := (pikas_private.report_clock() at time zone 'America/Santo_Domingo')::date;
begin
  if p_period = 'today' then return query select t, t, t;
  elsif p_period = 'last_7_days' then return query select t, t - 6, t;
  elsif p_period = 'last_30_days' then return query select t, t - 29, t;
  elsif p_period = 'custom' then
    if p_from is null or p_to is null or p_from > p_to or p_to > t or p_to - p_from > 91 then
      raise exception using errcode = '22023', message = 'invalid_report_range'; end if;
    return query select t, p_from, p_to;
  else raise exception using errcode = '22023', message = 'invalid_report_period'; end if;
end $$;

create function public.platform_network_report(p_period text, p_from date default null, p_to date default null, p_include_demo boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare per record; result jsonb;
begin
  perform pikas_private.require_platform_capability('platform:customer:operations:read');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'customer_operations_authority_required'; end if;
  select * into per from pikas_private.network_report_period(p_period, p_from, p_to);
  with acct as (
    select a.* from public.accounts a where a.tenant_kind = 'customer' or (coalesce(p_include_demo, false) and a.tenant_kind = 'sandbox')
    order by a.tenant_kind, a.name, a.id limit 200
  ), pos as (
    select m.id membership_id, m.cafeteria_id from public.cafeteria_memberships m
    join public.persons p on p.id = m.person_id and p.status = 'active' and p.auth_user_id is not null
    where m.status = 'active' and m.role_code in ('pos_cashier','pos_supervisor') and m.account_id in (select id from acct)
  ), sales as (
    select pu.cafeteria_id, count(*) n, count(distinct pu.student_id) students from public.purchases pu
    where pu.account_id in (select id from acct) and pu.business_date between per.d_from and per.d_to
      and pu.purchased_at >= ((per.d_from - 2)::timestamp at time zone 'UTC') and pu.purchased_at < ((per.d_to + 3)::timestamp at time zone 'UTC')
    group by pu.cafeteria_id
  ), caf as (
    select c.id, c.account_id, c.name, s.name school, l.name location, c.status,
      (c.status = 'active' and l.status = 'active' and s.status = 'active') operating,
      (select count(*) from public.cafeteria_registers r where r.cafeteria_id = c.id and r.status = 'active') registers_active,
      (select count(*) from public.cafeteria_registers r where r.cafeteria_id = c.id and r.status <> 'active') registers_inactive,
      (select count(distinct r.id) from public.cafeteria_registers r join public.cafeteria_register_assignments ra on ra.register_id = r.id and ra.status = 'active'
        join pos on pos.membership_id = ra.cafeteria_membership_id where r.cafeteria_id = c.id and r.status = 'active') registers_staffed,
      (select count(*) from public.cafeteria_products pr where pr.cafeteria_id = c.id and pr.active and pr.available) products_available,
      coalesce((select os.scheduling_enabled from public.cafeteria_operation_settings os where os.cafeteria_id = c.id), false) scheduling_enabled,
      (select count(*) from public.cafeteria_service_shifts sh where sh.cafeteria_id = c.id and sh.enabled) shifts_enabled,
      -- UX 13B student-service state, the same rule as cafeteria_admin_read_core.
      (select case when sh.id is null then 'not_shared' when sh.status <> 'active' then 'sharing_revoked'
          when not exists (select 1 from public.school_cafeteria_share_categories sc where sc.share_id = sh.id and sc.enabled and sc.category = 'basic_identification') then 'identification_not_shared'
          when not exists (select 1 from public.students st where st.account_id = c.account_id and st.school_id = c.school_id and st.status = 'active') then 'no_students'
          when not exists (select 1 from public.cafeteria_customers cu join public.students st on st.id = cu.student_id and st.status = 'active' where cu.cafeteria_id = c.id and cu.status = 'active') then 'no_students_enabled'
          else 'ready' end
        from (select 1) one left join public.school_cafeteria_shares sh on sh.cafeteria_id = c.id and sh.school_id = c.school_id and sh.account_id = c.account_id) student_service,
      (select count(*) from public.cafeteria_customers cu join public.students st on st.id = cu.student_id and st.status = 'active' where cu.cafeteria_id = c.id and cu.status = 'active') enabled_students,
      coalesce(sa.n, 0) sales, coalesce(sa.students, 0) students_served,
      (select max(pu.purchased_at) from public.purchases pu where pu.account_id = c.account_id and pu.school_id = c.school_id and pu.cafeteria_id = c.id) last_sale_at
    from public.cafeterias c join public.schools s on s.id = c.school_id join public.school_locations l on l.id = c.school_location_id
    left join sales sa on sa.cafeteria_id = c.id
    where c.account_id in (select id from acct)
  )
  select jsonb_build_object('period', jsonb_build_object('period', p_period, 'from', per.d_from, 'to', per.d_to, 'today', per.today, 'timezone', 'America/Santo_Domingo'),
    'include_demo', coalesce(p_include_demo, false),
    'customers', coalesce(jsonb_agg(jsonb_build_object('account_id', a.id, 'name', a.name, 'code', a.code, 'status', a.status, 'demo', a.tenant_kind = 'sandbox', 'created_at', a.created_at,
      'schools', (select jsonb_build_object('active', count(*) filter (where s.status = 'active'), 'other', count(*) filter (where s.status <> 'active')) from public.schools s where s.account_id = a.id),
      'locations', (select jsonb_build_object('active', count(*) filter (where l.status = 'active'), 'inactive', count(*) filter (where l.status <> 'active')) from public.school_locations l where l.account_id = a.id),
      'cafeterias', coalesce((select jsonb_agg(jsonb_build_object('cafeteria_id', caf.id, 'name', caf.name, 'school', caf.school, 'location', caf.location, 'status', caf.status, 'operating', caf.operating,
          'registers_active', caf.registers_active, 'registers_inactive', caf.registers_inactive, 'registers_staffed', caf.registers_staffed, 'products_available', caf.products_available,
          'scheduling_enabled', caf.scheduling_enabled, 'shifts_enabled', caf.shifts_enabled,
          'operationally_ready', caf.operating and caf.registers_staffed > 0 and caf.products_available > 0 and (not caf.scheduling_enabled or caf.shifts_enabled > 0),
          'student_service', caf.student_service, 'enabled_students', caf.enabled_students, 'sales', caf.sales, 'students_served', caf.students_served, 'last_sale_at', caf.last_sale_at)
          order by caf.school, caf.location, caf.name, caf.id) from caf where caf.account_id = a.id), '[]'::jsonb))
      order by a.tenant_kind, a.name, a.id), '[]'::jsonb),
    'truncated', (select count(*) from public.accounts x where x.tenant_kind = 'customer' or (coalesce(p_include_demo, false) and x.tenant_kind = 'sandbox')) > 200)
  into result from acct a;
  return result;
end $$;

create function public.platform_finance_report(p_period text, p_from date default null, p_to date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare per record; now_value timestamptz := pikas_private.report_clock();
begin
  perform pikas_private.require_platform_capability('platform:finance:read');
  if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode = '42501', message = 'finance_authority_required'; end if;
  select * into per from pikas_private.network_report_period(p_period, p_from, p_to);
  return jsonb_build_object('period', jsonb_build_object('period', p_period, 'from', per.d_from, 'to', per.d_to, 'today', per.today, 'timezone', 'America/Santo_Domingo'),
    'activations', coalesce((select jsonb_agg(jsonb_build_object('customer', a.name, 'code', a.code, 'status', fa.status, 'activated_at', fa.activated_at, 'ended_at', fa.ended_at,
        'policy_version', p.version, 'fee_bps', p.replenishment_fee_bps) order by fa.status, a.name, fa.activated_at)
      from public.customer_financial_activations fa join public.accounts a on a.id = fa.account_id and a.tenant_kind = 'customer'
      join public.financial_fee_policies p on p.id = fa.policy_id), '[]'::jsonb),
    'replenishments', coalesce((select jsonb_agg(x.r order by x.m) from (
        select r.method m, jsonb_build_object('method', r.method, 'count', count(*), 'gross_minor', sum(r.gross_minor)::text, 'fee_minor', sum(r.fee_minor)::text, 'net_minor', sum(r.net_minor)::text) r
        from public.replenishment_requests r join public.accounts a on a.id = r.account_id and a.tenant_kind = 'customer'
        where r.posted_at is not null and (r.posted_at at time zone 'America/Santo_Domingo')::date between per.d_from and per.d_to group by r.method) x), '[]'::jsonb),
    'reversals', (select jsonb_build_object('count', count(*), 'net_minor', coalesce(sum(v.amount_minor), 0)::text)
        from public.wallet_replenishment_reversals v join public.replenishment_requests r on r.wallet_replenishment_id = v.replenishment_id
        join public.accounts a on a.id = v.account_id and a.tenant_kind = 'customer'
        where (v.reversed_at at time zone 'America/Santo_Domingo')::date between per.d_from and per.d_to),
    'settlements', (select jsonb_build_object(
        'due', count(*) filter (where s.status = 'due'), 'in_review', count(*) filter (where s.status = 'in_review'),
        'overdue', count(*) filter (where s.status <> 'settled' and s.due_on < per.today),
        'cafeterias_owe_minor', coalesce(sum(s.net_amount_minor) filter (where s.status <> 'settled' and s.net_direction = 'cafeteria_to_clearing'), 0)::text,
        'pikas_owes_minor', coalesce(sum(s.net_amount_minor) filter (where s.status <> 'settled' and s.net_direction = 'clearing_to_cafeteria'), 0)::text,
        'settled_in_period', count(*) filter (where s.status = 'settled' and (s.settled_at at time zone 'America/Santo_Domingo')::date between per.d_from and per.d_to))
      from public.settlements s join public.accounts a on a.id = s.account_id and a.tenant_kind = 'customer'),
    'ready_periods', (select count(*) from public.cafeterias c join public.accounts a on a.id = c.account_id and a.tenant_kind = 'customer'
        cross join lateral pikas_private.settlement_live_totals(c.id, now_value) t
        where exists (select 1 from public.financial_obligations o where o.cafeteria_id = c.id) and t.target_week is not null),
    'unsettled_obligations', (select jsonb_build_object(
        'cafeterias_owe_minor', coalesce(sum(o.amount_minor) filter (where d.kind = 'cafeteria'), 0)::text,
        'pikas_owes_minor', coalesce(sum(o.amount_minor) filter (where d.kind = 'clearing'), 0)::text, 'count', count(*))
      from public.financial_obligations o join public.financial_parties d on d.id = o.debtor_party_id
      where not exists (select 1 from public.settlement_lines l where l.obligation_id = o.id)));
end $$;

revoke all on function pikas_private.network_report_period(text,date,date) from public, anon, authenticated, service_role;
revoke all on function public.platform_network_report(text,date,date,boolean), public.platform_finance_report(text,date,date) from public, anon, service_role;
grant execute on function public.platform_network_report(text,date,date,boolean), public.platform_finance_report(text,date,date) to authenticated;
do $acl$
begin
  if exists (select 1 from pg_proc p where p.oid = 'pikas_private.network_report_period(text,date,date)'::regprocedure
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee <> p.proowner)))
    or exists (select 1 from pg_proc p where p.oid in ('public.platform_network_report(text,date,date,boolean)'::regprocedure, 'public.platform_finance_report(text,date,date)'::regprocedure)
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee in (0, 'anon'::regrole::oid, 'service_role'::regrole::oid))
        or not has_function_privilege('authenticated', p.oid, 'execute'))) then
    raise exception 'network_report_acl_mismatch'; end if;
end $acl$;

commit;
