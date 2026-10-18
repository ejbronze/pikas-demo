-- Phase 5D.1: read-only Cafeteria Admin sales summary (reporting foundation).
-- Additive only. No financial write path, table, grant on a table or frozen function changes.
-- Sales = committed purchases by purchases.business_date; Reembolsos = refund events by
-- refunds.business_date (owner decision D3); register cash and PIKAS Cash ledger are not read.
begin;

-- Clock seam (same pattern as pikas_private.refund_clock) so tests can move "Hoy".
create function pikas_private.report_clock() returns timestamptz
language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()$$;

create function public.cafeteria_report_read(p_cafeteria_id uuid,p_kind text,p_period text,
 p_from date default null,p_to date default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; scope record; today date; d_from date; d_to date; currency text; result jsonb;
begin
 perform pikas_private.begin_sandbox_admin_command('cafeteria_admin');
 -- Existing Cafeteria Admin purchase-history authority; supervisors, cashiers, school/account
 -- admins, platform-only actors and admin sandbox POVs are denied by the frozen guard.
 ctx:=pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:purchases:read');
 if p_kind is distinct from 'sales_summary' then raise exception using errcode='22023',message='invalid_report_kind'; end if;
 select c.account_id,c.school_id,s.business_timezone into scope
 from public.cafeterias c join public.schools s on s.account_id=c.account_id and s.id=c.school_id where c.id=p_cafeteria_id;
 -- Business dates are those of the cafeteria's school (schools.business_timezone), the same
 -- authority checkout/refunds snapshot into business_date.
 today:=(pikas_private.report_clock() at time zone scope.business_timezone)::date;
 if p_period='custom' then d_from:=p_from; d_to:=p_to;
  if d_from is null or d_to is null or d_from>d_to or d_to>today then
   raise exception using errcode='22023',message='invalid_report_range'; end if;
  if d_to-d_from+1>92 then raise exception using errcode='22023',message='report_range_too_long'; end if;
 elsif p_from is not null or p_to is not null then raise exception using errcode='22023',message='invalid_report_period';
 elsif p_period='today' then d_from:=today; d_to:=today;
 elsif p_period='last_7_days' then d_from:=today-6; d_to:=today;
 elsif p_period='last_30_days' then d_from:=today-29; d_to:=today;
 else raise exception using errcode='22023',message='invalid_report_period'; end if;
 select coalesce((select os.catalog_currency_code from public.cafeteria_operation_settings os where os.cafeteria_id=p_cafeteria_id),'DOP') into currency;
 -- One statement = one snapshot: gross, refunds and net are mutually consistent.
 -- The purchased_at window (±2 days) only lets the existing purchases_cafeteria_time_idx bound
 -- the scan (any IANA offset is < 1 day); business_date remains the authoritative filter.
 with sales as (
  select t.tender_type,p.total_minor::numeric total from public.purchases p
  join public.purchase_tenders t on t.purchase_id=p.id
  where p.account_id=scope.account_id and p.school_id=scope.school_id and p.cafeteria_id=p_cafeteria_id
   and p.purchased_at>=((d_from-2)::timestamp at time zone 'UTC') and p.purchased_at<((d_to+3)::timestamp at time zone 'UTC')
   and p.business_date between d_from and d_to and p.currency_code=currency
 ), refunded as (
  select r.tender_type,r.amount_minor::numeric amount from public.refunds r
  where r.cafeteria_id=p_cafeteria_id and r.business_date between d_from and d_to and r.currency_code=currency
 ), totals as (
  select (select coalesce(sum(total),0) from sales) gross,(select count(*) from sales) n,
   (select coalesce(sum(amount),0) from refunded) refunds,(select count(*) from refunded) refund_n
 )
 select jsonb_build_object(
  'gross_sales_minor',x.gross::text,'refunds_minor',x.refunds::text,'net_sales_minor',(x.gross-x.refunds)::text,
  'transaction_count',x.n,'refund_count',x.refund_n,
  'average_ticket_minor',case when x.n=0 then null else round(x.gross/x.n)::text end,
  'refunds_by_tender',jsonb_build_object(
   'cash',(select coalesce(sum(amount),0) from refunded where tender_type='cash')::text,
   'student_wallet',(select coalesce(sum(amount),0) from refunded where tender_type='student_wallet')::text),
  'tenders',(select jsonb_agg(jsonb_build_object('tender',k.tender,
    'transaction_count',(select count(*) from sales s where s.tender_type=k.tender),
    'gross_sales_minor',(select coalesce(sum(total),0) from sales s where s.tender_type=k.tender)::text) order by k.ord)
   from (values (1,'cash'),(2,'student_wallet'),(3,'staff_credit')) k(ord,tender)))
 into result from totals x;
 -- Revalidate authority after reading, as the Phase 5A operations read does.
 perform pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:purchases:read');
 perform set_config('pikas.admin_pov_session','',true);
 return jsonb_build_object('cafeteria_id',p_cafeteria_id,'tenant_kind',ctx->>'tenant_kind','kind',p_kind,
  'period',p_period,'from',d_from,'to',d_to,'today',today,'business_timezone',scope.business_timezone,
  'currency_code',currency,'data',result);
end $$;

revoke all on function pikas_private.report_clock() from public,anon,authenticated,service_role;
revoke all on function public.cafeteria_report_read(uuid,text,text,date,date) from public,anon,authenticated,service_role;
grant execute on function public.cafeteria_report_read(uuid,text,text,date,date) to authenticated;
commit;
