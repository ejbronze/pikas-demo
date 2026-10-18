-- Phase 5D.2: top products by net units, added as kind 'top_products' of the 5D.1 reporting
-- function. Additive: the 5D.1 migration is not edited; this replaces the function with an
-- identical signature, authority, period/time semantics and sales_summary statement.
-- Read-only; no new table, index, capability or grant scope.
begin;

create or replace function public.cafeteria_report_read(p_cafeteria_id uuid,p_kind text,p_period text,
 p_from date default null,p_to date default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; scope record; today date; d_from date; d_to date; currency text; result jsonb;
begin
 perform pikas_private.begin_sandbox_admin_command('cafeteria_admin');
 -- Existing Cafeteria Admin purchase-history authority; supervisors, cashiers, school/account
 -- admins, platform-only actors and admin sandbox POVs are denied by the frozen guard.
 ctx:=pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:purchases:read');
 if p_kind is null or p_kind not in ('sales_summary','top_products') then raise exception using errcode='22023',message='invalid_report_kind'; end if;
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
 if p_kind='sales_summary' then
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
 else
 -- 5D.2 top products (D4): event-period units, one statement. Gross units by purchase
 -- business_date; refunded units only from authoritative refund_items by the refund's own
 -- business_date (never re-dated, never clamped). Amount-only (legacy) refunds have no item
 -- rows and are counted, not allocated. Ranking: net units desc, then product_id asc.
 with sold as (
  select i.product_id,i.quantity::bigint qty,p.purchased_at,i.id line_id,i.product_name_snapshot name from public.purchases p
  join public.purchase_items i on i.purchase_id=p.id
  where p.account_id=scope.account_id and p.school_id=scope.school_id and p.cafeteria_id=p_cafeteria_id
   and p.purchased_at>=((d_from-2)::timestamp at time zone 'UTC') and p.purchased_at<((d_to+3)::timestamp at time zone 'UTC')
   and p.business_date between d_from and d_to and p.currency_code=currency
 ), period_refunds as (
  select r.id from public.refunds r
  where r.cafeteria_id=p_cafeteria_id and r.business_date between d_from and d_to and r.currency_code=currency
 ), returned as (
  select i.product_id,ri.quantity::bigint qty,p.purchased_at,i.id line_id,i.product_name_snapshot name from period_refunds r
  join public.refund_items ri on ri.refund_id=r.id
  join public.purchase_items i on i.id=ri.purchase_item_id
  join public.purchases p on p.id=i.purchase_id
 ), activity as (
  select product_id,sum(qty) filter (where kind='sold') gross,sum(qty) filter (where kind='returned') refunded from (
   select product_id,qty,'sold' kind from sold union all select product_id,qty,'returned' from returned) u group by product_id
 ), ranked as (
  select a.product_id,coalesce(a.gross,0) gross,coalesce(a.refunded,0) refunded,coalesce(a.gross,0)-coalesce(a.refunded,0) net,
   -- G5: the product-name snapshot of the most recent purchase line contributing in the period.
   (select n.name from (select name,purchased_at,line_id from sold s where s.product_id=a.product_id
     union all select name,purchased_at,line_id from returned t where t.product_id=a.product_id) n
    order by n.purchased_at desc,n.line_id desc limit 1) product_name,
   row_number() over (order by coalesce(a.gross,0)-coalesce(a.refunded,0) desc,a.product_id) rank
  from activity a
 )
 select jsonb_build_object(
  'products',coalesce((select jsonb_agg(jsonb_build_object('rank',x.rank,'product_id',x.product_id,'product_name',x.product_name,
    'gross_units',x.gross,'refunded_units',x.refunded,'net_units',x.net) order by x.rank) from ranked x where x.rank<=10),'[]'::jsonb),
  'product_count',(select count(*) from ranked),
  'refunds_without_item_detail',(select count(*) from period_refunds r where not exists(select 1 from public.refund_items ri where ri.refund_id=r.id)))
 into result;
 end if;
 -- Revalidate authority after reading, as the Phase 5A operations read does.
 perform pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:purchases:read');
 perform set_config('pikas.admin_pov_session','',true);
 return jsonb_build_object('cafeteria_id',p_cafeteria_id,'tenant_kind',ctx->>'tenant_kind','kind',p_kind,
  'period',p_period,'from',d_from,'to',d_to,'today',today,'business_timezone',scope.business_timezone,
  'currency_code',currency,'data',result);
end $$;

revoke all on function public.cafeteria_report_read(uuid,text,text,date,date) from public,anon,authenticated,service_role;
grant execute on function public.cafeteria_report_read(uuid,text,text,date,date) to authenticated;
commit;
