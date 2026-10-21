-- Cafetería Hoy V1: the narrow read behind the Cafeteria Admin "Hoy" dashboard.
-- Additive only. No table, grant on a table, financial write path or frozen function changes.
-- Today's totals, tender mix, top products and reconciliation keep coming from the existing
-- cafeteria_report_read; this read adds ONLY what that contract cannot answer:
--  * gross sales by local hour for today and for the same weekday last week (today − 7);
--  * the same-time comparison: last week's gross up to today's current local time;
--  * the last sale and the first sale ever, for the live strip and the first-sale milestone.
-- Definitions are those of 5D.1: Ventas = committed purchases by purchases.business_date, gross,
-- in the cafeteria's catalog currency; refunds are not netted here (the summary reports them).
-- Hours and the cutoff use each purchase's business_timezone_snapshot, the same snapshot that
-- fixed its business_date, so an hour never disagrees with the day it was counted in.
begin;

create function public.cafeteria_today_read(p_cafeteria_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; scope record; now_local timestamp; today date; base_day date; cutoff time; currency text;
 result jsonb; last_sale jsonb; first_sale date;
begin
 perform pikas_private.begin_sandbox_admin_command('cafeteria_admin');
 -- Same authority as the 5D.1 sales summary: Cafeteria Admin purchase history. Supervisors,
 -- cashiers, school/account admins, platform-only actors and unapproved POVs are denied.
 ctx:=pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:purchases:read');
 select c.account_id,c.school_id,s.business_timezone into scope
 from public.cafeterias c join public.schools s on s.account_id=c.account_id and s.id=c.school_id where c.id=p_cafeteria_id;
 now_local:=pikas_private.report_clock() at time zone scope.business_timezone;
 today:=now_local::date; base_day:=today-7; cutoff:=now_local::time;
 select coalesce((select os.catalog_currency_code from public.cafeteria_operation_settings os where os.cafeteria_id=p_cafeteria_id),'DOP') into currency;
 -- One statement = one snapshot. The purchased_at window only lets purchases_cafeteria_time_idx
 -- bound the scan; business_date remains the authoritative day filter.
 with sales as (
  select p.business_date d,(p.purchased_at at time zone p.business_timezone_snapshot) t,p.total_minor::numeric total
  from public.purchases p
  where p.account_id=scope.account_id and p.school_id=scope.school_id and p.cafeteria_id=p_cafeteria_id
   and p.purchased_at>=((base_day-2)::timestamp at time zone 'UTC') and p.purchased_at<((today+3)::timestamp at time zone 'UTC')
   and p.business_date in (today,base_day) and p.currency_code=currency
 )
 select jsonb_build_object(
  'today_gross_minor',(select coalesce(sum(total),0) from sales where d=today)::text,
  'today_count',(select count(*) from sales where d=today),
  'baseline',jsonb_build_object(
   'day_count',(select count(*) from sales where d=base_day),
   'to_cutoff_gross_minor',(select coalesce(sum(total),0) from sales where d=base_day and t::time<=cutoff)::text,
   'to_cutoff_count',(select count(*) from sales where d=base_day and t::time<=cutoff)),
  'hours',(select jsonb_agg(jsonb_build_object('hour',h,
    'today_gross_minor',(select coalesce(sum(total),0) from sales where d=today and extract(hour from t)=h)::text,
    'today_count',(select count(*) from sales where d=today and extract(hour from t)=h),
    'baseline_gross_minor',(select coalesce(sum(total),0) from sales where d=base_day and extract(hour from t)=h)::text,
    'baseline_count',(select count(*) from sales where d=base_day and extract(hour from t)=h)) order by h)
   from generate_series(0,23) h))
 into result;
 -- Live context, any day: newest and oldest purchase of this cafeteria (index order, one row each).
 select jsonb_build_object('purchased_at',p.purchased_at,
   'purchased_local',to_char(p.purchased_at at time zone p.business_timezone_snapshot,'YYYY-MM-DD"T"HH24:MI'),
   'business_date',p.business_date,'register_name',rs.register_name_snapshot) into last_sale
 from public.purchases p join public.register_sessions rs on rs.id=p.register_session_id
 where p.account_id=scope.account_id and p.school_id=scope.school_id and p.cafeteria_id=p_cafeteria_id
 order by p.purchased_at desc,p.id desc limit 1;
 select p.business_date into first_sale from public.purchases p
 where p.account_id=scope.account_id and p.school_id=scope.school_id and p.cafeteria_id=p_cafeteria_id
 order by p.purchased_at,p.id limit 1;
 -- Revalidate authority after reading, as the report and operations reads do.
 perform pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:purchases:read');
 perform set_config('pikas.admin_pov_session','',true);
 return jsonb_build_object('cafeteria_id',p_cafeteria_id,'tenant_kind',ctx->>'tenant_kind',
  'today',today,'baseline_date',base_day,'as_of_local',to_char(now_local,'YYYY-MM-DD"T"HH24:MI'),
  'business_timezone',scope.business_timezone,'currency_code',currency,
  'data',result||jsonb_build_object('last_sale',last_sale,'first_sale_date',first_sale));
end $$;

revoke all on function public.cafeteria_today_read(uuid) from public,anon,authenticated,service_role;
grant execute on function public.cafeteria_today_read(uuid) to authenticated;
commit;
