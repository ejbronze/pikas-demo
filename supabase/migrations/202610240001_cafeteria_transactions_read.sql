-- Phase 5D.4 Transacciones lookup. Additive and read-only: two new reads for Cafeteria Admin
-- transaction discovery. No table, column, index, capability, grant scope or frozen function changes;
-- the Phase 5A cafeteria_operations_read contract is untouched.
--
-- Authority: exactly the Phase 5A purchase-history authority (begin_sandbox_admin_command +
-- require_financial_admin(..,'cafeteria:pos:purchases:read'), revalidated after reading). Cashiers,
-- supervisors without an admin membership, school/account/platform-only actors and the sandbox admin
-- POV stay denied by the frozen guard.
--
-- Refund state is observed, never written: refunded = Σ refunds.amount_minor of the purchase
-- (every Phase 5C refund row, itemized or historical amount-only); none / partial / full against
-- purchases.total_minor. Item quantities come only from refund_items, so an amount-only refund is
-- reported as unallocated and never assigned to an item.
begin;

-- Transaction-level refund state from authoritative refund rows (one per purchase, via the
-- existing unique(purchase_id,refund_ordinal) index).
create function pikas_private.transaction_refund_state(p_refunded numeric,p_total bigint) returns text
language sql immutable set search_path='' as $$
 select case when p_refunded<=0 then 'none' when p_refunded>=p_total then 'full' else 'partial' end
$$;

create function public.cafeteria_transactions_read(p_cafeteria_id uuid,p_period text default null,
 p_from date default null,p_to date default null,p_tender text default null,p_refund_status text default null,
 p_receipt bigint default null,p_offset integer default 0) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; scope record; today date; d_from date; d_to date; total bigint; rows jsonb; page constant integer:=25;
begin
 perform pikas_private.begin_sandbox_admin_command('cafeteria_admin');
 ctx:=pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:purchases:read');
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception using errcode='22023',message='invalid_page'; end if;
 if p_tender is not null and p_tender not in ('cash','student_wallet','staff_credit') then
  raise exception using errcode='22023',message='invalid_tender'; end if;
 if p_refund_status is not null and p_refund_status not in ('none','partial','full') then
  raise exception using errcode='22023',message='invalid_refund_status'; end if;
 select c.account_id,c.school_id,s.business_timezone into scope
 from public.cafeterias c join public.schools s on s.account_id=c.account_id and s.id=c.school_id where c.id=p_cafeteria_id;
 today:=(pikas_private.report_clock() at time zone scope.business_timezone)::date;
 if p_receipt is not null then
  -- Exact receipt lookup across the cafeteria's history; it is not combined with other filters.
  if p_receipt<=0 or p_period is not null or p_from is not null or p_to is not null or p_tender is not null or p_refund_status is not null then
   raise exception using errcode='22023',message='invalid_receipt_search'; end if;
 -- Periods exactly as the Phase 5D reports (school business dates, server "today", custom ≤ 92 days).
 elsif p_period='custom' then d_from:=p_from; d_to:=p_to;
  if d_from is null or d_to is null or d_from>d_to or d_to>today then
   raise exception using errcode='22023',message='invalid_report_range'; end if;
  if d_to-d_from+1>92 then raise exception using errcode='22023',message='report_range_too_long'; end if;
 elsif p_from is not null or p_to is not null then raise exception using errcode='22023',message='invalid_report_period';
 elsif p_period='today' then d_from:=today; d_to:=today;
 elsif p_period='last_7_days' then d_from:=today-6; d_to:=today;
 elsif p_period='last_30_days' then d_from:=today-29; d_to:=today;
 else raise exception using errcode='22023',message='invalid_report_period'; end if;
 -- One statement = one snapshot: the count and the page come from the same filtered set.
 -- Candidates come from exactly one index-backed branch: the exact receipt
 -- (unique cafeteria_id,purchase_number) or the period window. The purchased_at window (±2 days) only
 -- lets purchases_cafeteria_time_idx bound the scan; business_date remains the authoritative filter.
 with candidates as (
  select p.id from public.purchases p
  where p_receipt is not null and p.cafeteria_id=p_cafeteria_id and p.purchase_number=p_receipt
  union all
  select p.id from public.purchases p
  where p_receipt is null and p.account_id=scope.account_id and p.school_id=scope.school_id and p.cafeteria_id=p_cafeteria_id
   and p.purchased_at>=((d_from-2)::timestamp at time zone 'UTC') and p.purchased_at<((d_to+3)::timestamp at time zone 'UTC')
   and p.business_date between d_from and d_to
 ), matched as (
  select p.id,p.purchased_at,p.business_date,p.total_minor,coalesce(rf.refunded,0) refunded,
   pikas_private.transaction_refund_state(coalesce(rf.refunded,0),p.total_minor) status
  from candidates c join public.purchases p on p.id=c.id
  join public.purchase_tenders t on t.purchase_id=p.id
  left join lateral (select sum(r.amount_minor::numeric) refunded from public.refunds r where r.purchase_id=p.id) rf on true
  where p_tender is null or t.tender_type=p_tender
 ), filtered as (
  select * from matched where p_refund_status is null or status=p_refund_status
 ), paged as (
  select * from filtered order by purchased_at desc,id limit page+1 offset p_offset
 )
 select (select count(*) from filtered),
  coalesce((select jsonb_agg(pikas_private.operation_purchase(x.id)||jsonb_build_object('business_date',x.business_date,
   'refunded_minor',x.refunded::bigint::text,'remaining_minor',(x.total_minor-x.refunded)::bigint::text,'refund_status',x.status)
   order by x.purchased_at desc,x.id) from paged x),'[]'::jsonb)
 into total,rows;
 -- Revalidate authority after reading, as the Phase 5A operations read does.
 perform pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:purchases:read');
 perform set_config('pikas.admin_pov_session','',true);
 return jsonb_build_object('cafeteria_id',p_cafeteria_id,'tenant_kind',ctx->>'tenant_kind',
  'business_timezone',scope.business_timezone,'today',today,'period',p_period,'from',d_from,'to',d_to,
  'tender',p_tender,'refund_status',p_refund_status,'receipt',p_receipt::text,
  'offset',p_offset,'page_size',page,'total_count',total,'has_more',jsonb_array_length(rows)>page,
  'data',(select coalesce(jsonb_agg(e order by n),'[]'::jsonb) from jsonb_array_elements(rows) with ordinality a(e,n) where n<=page));
end $$;

create function public.cafeteria_transaction_detail(p_cafeteria_id uuid,p_purchase_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; p public.purchases; refunded numeric; result jsonb;
begin
 perform pikas_private.begin_sandbox_admin_command('cafeteria_admin');
 ctx:=pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:purchases:read');
 select * into p from public.purchases where id=p_purchase_id and cafeteria_id=p_cafeteria_id;
 if not found then raise exception using errcode='42501',message='not_authorized'; end if;
 select coalesce(sum(amount_minor::numeric),0) into refunded from public.refunds where purchase_id=p.id;
 select (pikas_private.operation_purchase(p.id,true)-'items')||jsonb_build_object(
  'business_date',p.business_date,
  'refunded_minor',refunded::bigint::text,'remaining_minor',(p.total_minor-refunded)::bigint::text,
  'refund_status',pikas_private.transaction_refund_state(refunded,p.total_minor),
  -- Original lines with only item-attributed refunds (refund_items); never derived from amounts.
  'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'quantity',i.quantity,
    'unit_price_minor',i.unit_price_minor::text,'line_total_minor',i.line_total_minor::text,
    'refunded_quantity',coalesce(q.quantity,0),'refunded_minor',coalesce(q.amount,0)::bigint::text) order by i.line_number)
   from public.purchase_items i left join lateral (select sum(ri.quantity)::integer quantity,sum(ri.amount_minor::numeric) amount
    from public.refund_items ri where ri.purchase_item_id=i.id) q on true where i.purchase_id=p.id),'[]'::jsonb),
  -- Refund events in order. unallocated_minor is the part of a refund without item lines
  -- (historical amount-only refunds): reported as such, never assigned to items.
  'refunds',coalesce((select jsonb_agg(jsonb_build_object('ordinal',r.refund_ordinal::text,'occurred_at',r.occurred_at,
    'business_date',r.business_date,'amount_minor',r.amount_minor::text,'tender',r.tender_type,'reason',r.reason,'notes',r.notes,
    'authorization_mode',r.authorization_mode,'actor_name',a.display_name,'actor_role',r.actor_role_code,'approver_name',ap.display_name,
    'register_name',s.register_name_snapshot,'remaining_after_minor',r.remaining_after_minor::text,
    'itemized',ri.lines is not null,'unallocated_minor',(r.amount_minor-coalesce(ri.amount,0))::bigint::text,
    'items',coalesce(ri.lines,'[]'::jsonb)) order by r.refund_ordinal)
   from public.refunds r join public.persons a on a.id=r.actor_person_id
   left join public.persons ap on ap.id=r.approver_person_id
   left join public.register_sessions s on s.id=r.register_session_id
   left join lateral (select jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'quantity',x.quantity,'amount_minor',x.amount_minor::text) order by i.line_number) lines,
     sum(x.amount_minor::numeric) amount
    from public.refund_items x join public.purchase_items i on i.id=x.purchase_item_id where x.refund_id=r.id) ri on true
   where r.purchase_id=p.id),'[]'::jsonb),
  'unallocated_refund_minor',(select coalesce(sum(r.amount_minor::numeric-coalesce((select sum(x.amount_minor::numeric) from public.refund_items x where x.refund_id=r.id),0)),0)::bigint::text
   from public.refunds r where r.purchase_id=p.id))
 into result;
 perform pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:purchases:read');
 perform set_config('pikas.admin_pov_session','',true);
 return jsonb_build_object('cafeteria_id',p_cafeteria_id,'tenant_kind',ctx->>'tenant_kind','data',result);
end $$;

revoke all on function pikas_private.transaction_refund_state(numeric,bigint) from public,anon,authenticated,service_role;
revoke all on function public.cafeteria_transactions_read(uuid,text,date,date,text,text,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function public.cafeteria_transactions_read(uuid,text,date,date,text,text,bigint,integer) to authenticated;
revoke all on function public.cafeteria_transaction_detail(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.cafeteria_transaction_detail(uuid,uuid) to authenticated;
commit;
