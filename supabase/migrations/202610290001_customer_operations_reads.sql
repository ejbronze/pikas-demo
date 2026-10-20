-- Backoffice Customer Management M1: Platform customer-operations READS (cafeteria first).
--
-- A PIKAS employee with the new narrow capability platform:customer:operations:read may inspect an
-- explicitly selected customer's cafeteria operational data for support. The employee stays the
-- real actor (platform_person_id): no tenant membership, no persona, no Sandbox POV, no
-- impersonation, no tenant guard is loosened. The customer is CONTEXT, validated server-side on
-- every call (cafeteria must belong to the supplied account; customer tenants only).
--
-- The existing tenant read bodies are moved VERBATIM into private *_core functions; their guard
-- calls go through pikas_private.cafeteria_read_scope, which runs EXACTLY the original tenant guard
-- when no support account is supplied. The public tenant RPCs keep their signatures and simply
-- call the core with a null support account, so tenant behavior is unchanged. Platform wrappers
-- pass the explicit account. Only reads are exposed: no catalog/register/staff/financial command,
-- POS, wallet, refund, credential or lifecycle function accepts this authority.
-- Lifecycle: support reads work for active, suspended and closed customers (tenant rules unchanged).
begin;

insert into pikas_private.platform_capabilities(capability) values ('platform:customer:operations:read');
insert into pikas_private.platform_role_capabilities(role_code,capability) values ('platform_admin','platform:customer:operations:read');

-- Support scope for ONE cafeteria of ONE customer. Real Platform actor; any lifecycle state.
create function pikas_private.require_customer_operations_read(p_account_id uuid,p_cafeteria_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; ctx jsonb;
begin
 actor:=pikas_private.require_platform_capability('platform:customer:operations:read');
 if pikas_private.sandbox_pov_active_attempt() then raise exception using errcode='42501',message='customer_operations_authority_required'; end if;
 select jsonb_build_object('actor_id',actor,'membership_id',null,'cafeteria_id',c.id,'cafeteria_name',c.name,'cafeteria_status',c.status,
   'account_id',a.id,'account_name',a.name,'account_status',a.status,'school_name',s.name,'location_name',l.name,'tenant_kind',a.tenant_kind,
   'capabilities','[]'::jsonb,'support',true) into ctx
 from public.cafeterias c join public.accounts a on a.id=c.account_id join public.schools s on s.id=c.school_id and s.account_id=c.account_id
 join public.school_locations l on l.id=c.school_location_id
 where c.id=p_cafeteria_id and c.account_id=p_account_id and a.tenant_kind='customer';
 if ctx is null then raise exception using errcode='42501',message='customer_operations_scope_required'; end if;
 return ctx;
end $$;

-- Tenant path (null support account) runs exactly the original guard; support path the support guard.
create function pikas_private.cafeteria_read_scope(p_support_account uuid,p_cafeteria_id uuid,p_capability text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 if p_support_account is null then
  if p_capability is null then return pikas_private.require_cafeteria_admin(p_cafeteria_id); end if;
  return pikas_private.require_financial_admin(p_cafeteria_id,p_capability);
 end if;
 return pikas_private.require_customer_operations_read(p_support_account,p_cafeteria_id);
end $$;

-- cafeteria_admin_read: original body (verbatim except the guard indirection).
create function pikas_private.cafeteria_admin_read_core(p_support_account uuid, p_cafeteria_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare ctx jsonb;
begin
 ctx:=pikas_private.cafeteria_read_scope(p_support_account,p_cafeteria_id,null);
 return jsonb_build_object('scope',ctx,
 'settings',(select jsonb_build_object('currency',catalog_currency_code,'scheduling_enabled',scheduling_enabled,'version',version) from public.cafeteria_operation_settings where cafeteria_id=p_cafeteria_id),
 'categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'display_order',display_order,'version',version) order by display_order,name,id) from public.cafeteria_product_categories where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'unit',unit,'category_id',category_id,'price_minor',price_minor,'active',active,'available',available,'ingredients',ingredients,'allergens',allergens,'version',version) order by name,id) from public.cafeteria_products where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'menus',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'active',status='active','version',version,'product_ids',coalesce((select jsonb_agg(mp.product_id order by mp.display_order,mp.product_id) from public.cafeteria_menu_products mp where mp.menu_id=m.id and mp.active),'[]'::jsonb)) order by display_order,name,id) from public.cafeteria_menus m where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'shifts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'menu_id',menu_id,'name',name,'start_time',to_char(start_time,'HH24:MI'),'end_time',to_char(end_time,'HH24:MI'),'enabled',enabled,'version',version,'weekdays',coalesce((select jsonb_agg(weekday_iso order by weekday_iso) from public.cafeteria_service_shift_days where service_shift_id=sh.id),'[]'::jsonb)) order by start_time,id) from public.cafeteria_service_shifts sh where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'registers',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'code',r.register_code,'name',r.display_name,'status',r.status,'version',r.version,'has_history',exists(select 1 from public.register_sessions rs where rs.register_id=r.id),'open',exists(select 1 from public.register_sessions rs where rs.register_id=r.id and rs.status='open')) order by r.register_code,r.id) from public.cafeteria_registers r where r.cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'staff',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',p.display_name,'role',m.role_code,'status',m.status,'open',exists(select 1 from public.register_sessions rs where rs.cafeteria_id=p_cafeteria_id and rs.operator_person_id=p.id and rs.status='open')) order by p.display_name,m.id) from public.cafeteria_memberships m join public.persons p on p.id=m.person_id where m.cafeteria_id=p_cafeteria_id and m.role_code in ('pos_cashier','pos_supervisor')),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'membership_id',cafeteria_membership_id,'register_id',register_id,'status',status,'version',version) order by id) from public.cafeteria_register_assignments where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',intended_email,'role',role_code,'status',case when status='pending' and expires_at<=clock_timestamp() then 'expired' else status end,'expires_at',expires_at) order by created_at,id) from public.invitations where cafeteria_id=p_cafeteria_id and scope_kind='cafeteria' and role_code in ('pos_cashier','pos_supervisor')),'[]'::jsonb),
 'service',(select to_jsonb(svc) from pikas_private.resolve_cafeteria_service_at(p_cafeteria_id,clock_timestamp()) svc));
end $function$;

-- cafeteria_operations_read: original body (verbatim except the guard indirection).
create function pikas_private.cafeteria_operations_read_core(p_support_account uuid, p_cafeteria_id uuid, p_kind text, p_offset integer DEFAULT 0, p_target_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare ctx jsonb; rows jsonb;
begin
 if p_support_account is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 ctx:=pikas_private.cafeteria_read_scope(p_support_account,p_cafeteria_id,
 case when p_kind in ('transactions','transaction') then 'cafeteria:pos:purchases:read' else 'cafeteria:pos:sessions:read' end);
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception using errcode='22023',message='invalid_page'; end if;
 if p_kind='transactions' then
  select coalesce(jsonb_agg(pikas_private.operation_purchase(x.id) order by x.purchased_at desc,x.id),'[]'::jsonb) into rows
  from (select id,purchased_at from public.purchases where cafeteria_id=p_cafeteria_id order by purchased_at desc,id limit 26 offset p_offset) x;
 elsif p_kind='sessions' then
  select coalesce(jsonb_agg(pikas_private.operation_session(x.id) order by x.opened_at desc,x.id),'[]'::jsonb) into rows
  from (select id,opened_at from public.register_sessions where cafeteria_id=p_cafeteria_id order by opened_at desc,id limit 26 offset p_offset) x;
 elsif p_kind='transaction' then
  if not exists(select 1 from public.purchases where id=p_target_id and cafeteria_id=p_cafeteria_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  rows:=pikas_private.operation_purchase(p_target_id,true);
 elsif p_kind='session' then
  if not exists(select 1 from public.register_sessions where id=p_target_id and cafeteria_id=p_cafeteria_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  rows:=pikas_private.operation_session(p_target_id);
  rows:=rows||jsonb_build_object('purchases',coalesce((select jsonb_agg(pikas_private.operation_purchase(x.id) order by x.purchased_at desc,x.id)
    from (select id,purchased_at from public.purchases where register_session_id=p_target_id order by purchased_at desc,id limit 26 offset p_offset) x),'[]'::jsonb),
    'cash_movements',coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at,x.id) from (
      select r.id,r.occurred_at,'refund'::text kind,(-r.amount_minor::numeric)::text amount_minor from public.refunds r where r.register_session_id=p_target_id and r.tender_type='cash'
      union all select r.id,r.occurred_at,'settlement',r.amount_minor::text from public.staff_receivable_settlements r where r.register_session_id=p_target_id and r.method='cash'
    ) x),'[]'::jsonb));
 else raise exception using errcode='22023',message='invalid_history_kind'; end if;
 perform pikas_private.cafeteria_read_scope(p_support_account,p_cafeteria_id,case when p_kind in ('transactions','transaction') then 'cafeteria:pos:purchases:read' else 'cafeteria:pos:sessions:read' end);
 perform set_config('pikas.admin_pov_session','',true);
 return jsonb_build_object('cafeteria_id',p_cafeteria_id,'tenant_kind',ctx->>'tenant_kind','data',rows);
end $function$;

-- cafeteria_transactions_read: original body (verbatim except the guard indirection).
create function pikas_private.cafeteria_transactions_read_core(p_support_account uuid, p_cafeteria_id uuid, p_period text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_tender text DEFAULT NULL::text, p_refund_status text DEFAULT NULL::text, p_receipt bigint DEFAULT NULL::bigint, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare ctx jsonb; scope record; today date; d_from date; d_to date; total bigint; rows jsonb; page constant integer:=25;
begin
 if p_support_account is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 ctx:=pikas_private.cafeteria_read_scope(p_support_account,p_cafeteria_id,'cafeteria:pos:purchases:read');
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
 perform pikas_private.cafeteria_read_scope(p_support_account,p_cafeteria_id,'cafeteria:pos:purchases:read');
 perform set_config('pikas.admin_pov_session','',true);
 return jsonb_build_object('cafeteria_id',p_cafeteria_id,'tenant_kind',ctx->>'tenant_kind',
  'business_timezone',scope.business_timezone,'today',today,'period',p_period,'from',d_from,'to',d_to,
  'tender',p_tender,'refund_status',p_refund_status,'receipt',p_receipt::text,
  'offset',p_offset,'page_size',page,'total_count',total,'has_more',jsonb_array_length(rows)>page,
  'data',(select coalesce(jsonb_agg(e order by n),'[]'::jsonb) from jsonb_array_elements(rows) with ordinality a(e,n) where n<=page));
end $function$;

-- cafeteria_transaction_detail: original body (verbatim except the guard indirection).
create function pikas_private.cafeteria_transaction_detail_core(p_support_account uuid, p_cafeteria_id uuid, p_purchase_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare ctx jsonb; p public.purchases; refunded numeric; result jsonb;
begin
 if p_support_account is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 ctx:=pikas_private.cafeteria_read_scope(p_support_account,p_cafeteria_id,'cafeteria:pos:purchases:read');
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
 perform pikas_private.cafeteria_read_scope(p_support_account,p_cafeteria_id,'cafeteria:pos:purchases:read');
 perform set_config('pikas.admin_pov_session','',true);
 return jsonb_build_object('cafeteria_id',p_cafeteria_id,'tenant_kind',ctx->>'tenant_kind','data',result);
end $function$;

-- cafeteria_report_read: original body (verbatim except the guard indirection).
create function pikas_private.cafeteria_report_read_core(p_support_account uuid, p_cafeteria_id uuid, p_kind text, p_period text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare ctx jsonb; scope record; today date; d_from date; d_to date; currency text; result jsonb;
 cap text:=case when p_kind='reconciliation' then 'cafeteria:pos:sessions:read' else 'cafeteria:pos:purchases:read' end;
begin
 if p_support_account is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 -- Existing Cafeteria Admin authority, as the Phase 5A operations read: purchase history for
 -- sales/products, session history (Caja) for reconciliation. Supervisors, cashiers,
 -- school/account admins, platform-only actors and admin sandbox POVs are denied by the frozen guard.
 ctx:=pikas_private.cafeteria_read_scope(p_support_account,p_cafeteria_id,cap);
 if p_kind is null or p_kind not in ('sales_summary','top_products','reconciliation') then raise exception using errcode='22023',message='invalid_report_kind'; end if;
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
 elsif p_kind='top_products' then
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
 else
 -- 5D.3 reconciliation. Never recomputes a closed session: expected, its components and
 -- difference_minor (= counted − expected) are the immutable Phase 5A close capture in
 -- pikas_private.register_close_reconciliations; counted is register_sessions.counted_cash_minor.
 -- Period membership: the close business date, (closed_at at time zone
 -- business_timezone_snapshot)::date, the same convention 5A uses for opened_business_date.
 -- A close without a capture (pre-5A) is reported as such, never derived from current data.
 -- Open sessions are current state, not period records: the live 5A register_cash_summary
 -- (the admin Caja read), with no counted cash, difference or status.
 with closed as (
  select s.id,s.register_id,s.register_name_snapshot,s.register_code_snapshot,s.opened_at,s.closed_at,
   s.business_timezone_snapshot tz,s.counted_cash_minor,s.close_type,o.display_name operator_name,
   c.display_name closed_by_name,r.summary,r.difference_minor,r.session_id is not null captured
  from public.register_sessions s
  join public.persons o on o.id=s.operator_person_id
  join public.persons c on c.id=s.closed_by_person_id
  left join pikas_private.register_close_reconciliations r on r.session_id=s.id
  where s.account_id=scope.account_id and s.school_id=scope.school_id and s.cafeteria_id=p_cafeteria_id
   and s.status='closed' and s.currency_code=currency
   -- Index bound only (closed_at >= opened_at; any IANA offset is < 1 day).
   and s.opened_at<((d_to+3)::timestamp at time zone 'UTC')
   and s.closed_at>=((d_from-2)::timestamp at time zone 'UTC') and s.closed_at<((d_to+3)::timestamp at time zone 'UTC')
   and (s.closed_at at time zone s.business_timezone_snapshot)::date between d_from and d_to
 ), classified as (
  select x.*,case when not x.captured then 'uncaptured' when x.difference_minor=0 then 'balanced'
   when x.difference_minor>0 then 'overage' else 'shortage' end status,
   row_number() over (order by x.closed_at desc,x.id) n
  from closed x
 ), live as (
  select s.id,s.register_id,s.register_name_snapshot,s.register_code_snapshot,s.opened_at,s.business_timezone_snapshot tz,
   o.display_name operator_name,pikas_private.register_cash_summary(s.id) summary
  from public.register_sessions s join public.persons o on o.id=s.operator_person_id
  where s.account_id=scope.account_id and s.school_id=scope.school_id and s.cafeteria_id=p_cafeteria_id
   and s.status='open' and s.currency_code=currency
 )
 select jsonb_build_object(
  -- Counts only: shortages and overages are never netted against each other.
  'summary',(select jsonb_build_object('closed_count',count(*),
    'balanced_count',count(*) filter (where status='balanced'),'shortage_count',count(*) filter (where status='shortage'),
    'overage_count',count(*) filter (where status='overage'),'uncaptured_count',count(*) filter (where status='uncaptured')) from classified),
  'closed_sessions',coalesce((select jsonb_agg(jsonb_build_object('session_id',x.id,'register_id',x.register_id,
    'register_name',x.register_name_snapshot,'register_code',x.register_code_snapshot,'operator_name',x.operator_name,
    'closed_by_name',x.closed_by_name,'close_type',x.close_type,'opened_at',x.opened_at,'closed_at',x.closed_at,
    'opened_local',to_char(x.opened_at at time zone x.tz,'YYYY-MM-DD"T"HH24:MI'),
    'closed_local',to_char(x.closed_at at time zone x.tz,'YYYY-MM-DD"T"HH24:MI'),
    'closed_business_date',(x.closed_at at time zone x.tz)::date,'captured',x.captured,'status',x.status,
    'opening_minor',x.summary->>'opening_minor','cash_sales_minor',x.summary->>'cash_sales_minor',
    'cash_settlements_minor',x.summary->>'cash_settlements_minor','cash_refunds_minor',x.summary->>'cash_refunds_minor',
    'expected_minor',x.summary->>'expected_minor','counted_minor',x.counted_cash_minor::text,
    'difference_minor',x.difference_minor::text) order by x.n) from classified x where x.n<=50),'[]'::jsonb),
  'open_sessions',coalesce((select jsonb_agg(jsonb_build_object('session_id',x.id,'register_id',x.register_id,
    'register_name',x.register_name_snapshot,'register_code',x.register_code_snapshot,'operator_name',x.operator_name,
    'opened_at',x.opened_at,'opened_local',to_char(x.opened_at at time zone x.tz,'YYYY-MM-DD"T"HH24:MI'),
    'opening_minor',x.summary->>'opening_minor','cash_sales_minor',x.summary->>'cash_sales_minor',
    'cash_settlements_minor',x.summary->>'cash_settlements_minor','cash_refunds_minor',x.summary->>'cash_refunds_minor',
    'expected_minor',x.summary->>'expected_minor') order by x.opened_at,x.id) from live x),'[]'::jsonb))
 into result;
 end if;
 -- Revalidate authority after reading, as the Phase 5A operations read does.
 perform pikas_private.cafeteria_read_scope(p_support_account,p_cafeteria_id,cap);
 perform set_config('pikas.admin_pov_session','',true);
 return jsonb_build_object('cafeteria_id',p_cafeteria_id,'tenant_kind',ctx->>'tenant_kind','kind',p_kind,
  'period',p_period,'from',d_from,'to',d_to,'today',today,'business_timezone',scope.business_timezone,
  'currency_code',currency,'data',result);
end $function$;

-- Tenant RPCs: same signatures, grants and authority; they now delegate to the core.
create or replace function public.cafeteria_admin_read(p_cafeteria_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 return pikas_private.cafeteria_admin_read_core(null, p_cafeteria_id);
end $function$;

create or replace function public.cafeteria_operations_read(p_cafeteria_id uuid, p_kind text, p_offset integer DEFAULT 0, p_target_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 return pikas_private.cafeteria_operations_read_core(null, p_cafeteria_id, p_kind, p_offset, p_target_id);
end $function$;

create or replace function public.cafeteria_transactions_read(p_cafeteria_id uuid, p_period text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_tender text DEFAULT NULL::text, p_refund_status text DEFAULT NULL::text, p_receipt bigint DEFAULT NULL::bigint, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 return pikas_private.cafeteria_transactions_read_core(null, p_cafeteria_id, p_period, p_from, p_to, p_tender, p_refund_status, p_receipt, p_offset);
end $function$;

create or replace function public.cafeteria_transaction_detail(p_cafeteria_id uuid, p_purchase_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 return pikas_private.cafeteria_transaction_detail_core(null, p_cafeteria_id, p_purchase_id);
end $function$;

create or replace function public.cafeteria_report_read(p_cafeteria_id uuid, p_kind text, p_period text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 return pikas_private.cafeteria_report_read_core(null, p_cafeteria_id, p_kind, p_period, p_from, p_to);
end $function$;

-- Customer hierarchy for the support workspace (selection only; derived server-side).
create function public.platform_customer_operations_overview(p_account_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 perform pikas_private.require_platform_capability('platform:customer:operations:read');
 if pikas_private.sandbox_pov_active_attempt() then raise exception using errcode='42501',message='customer_operations_authority_required'; end if;
 select jsonb_build_object('account',jsonb_build_object('id',a.id,'name',a.name,'code',a.code,'status',a.status),
  'schools',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'status',s.status,
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'status',l.status,
      'cafeterias',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'code',c.code,'status',c.status) order by c.name,c.id)
        from public.cafeterias c where c.school_location_id=l.id and c.account_id=a.id),'[]'::jsonb)) order by l.name,l.id)
      from public.school_locations l where l.school_id=s.id and l.account_id=a.id),'[]'::jsonb)) order by s.name,s.id)
    from public.schools s where s.account_id=a.id),'[]'::jsonb)) into result
 from public.accounts a where a.id=p_account_id and a.tenant_kind='customer';
 if result is null then raise exception using errcode='42501',message='customer_operations_scope_required'; end if;
 return result;
end $$;

-- Platform support wrappers (reads only).
create function public.platform_support_cafeteria_read(p_account_id uuid, p_cafeteria_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 if p_account_id is null then raise exception using errcode='42501',message='customer_operations_scope_required'; end if;
 return pikas_private.cafeteria_admin_read_core(p_account_id, p_cafeteria_id);
end $function$;

create function public.platform_support_cafeteria_operations_read(p_account_id uuid, p_cafeteria_id uuid, p_kind text, p_offset integer DEFAULT 0, p_target_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 if p_account_id is null then raise exception using errcode='42501',message='customer_operations_scope_required'; end if;
 return pikas_private.cafeteria_operations_read_core(p_account_id, p_cafeteria_id, p_kind, p_offset, p_target_id);
end $function$;

create function public.platform_support_cafeteria_transactions_read(p_account_id uuid, p_cafeteria_id uuid, p_period text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_tender text DEFAULT NULL::text, p_refund_status text DEFAULT NULL::text, p_receipt bigint DEFAULT NULL::bigint, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 if p_account_id is null then raise exception using errcode='42501',message='customer_operations_scope_required'; end if;
 return pikas_private.cafeteria_transactions_read_core(p_account_id, p_cafeteria_id, p_period, p_from, p_to, p_tender, p_refund_status, p_receipt, p_offset);
end $function$;

create function public.platform_support_cafeteria_transaction_detail(p_account_id uuid, p_cafeteria_id uuid, p_purchase_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 if p_account_id is null then raise exception using errcode='42501',message='customer_operations_scope_required'; end if;
 return pikas_private.cafeteria_transaction_detail_core(p_account_id, p_cafeteria_id, p_purchase_id);
end $function$;

create function public.platform_support_cafeteria_report_read(p_account_id uuid, p_cafeteria_id uuid, p_kind text, p_period text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 if p_account_id is null then raise exception using errcode='42501',message='customer_operations_scope_required'; end if;
 return pikas_private.cafeteria_report_read_core(p_account_id, p_cafeteria_id, p_kind, p_period, p_from, p_to);
end $function$;

revoke all on function pikas_private.require_customer_operations_read(uuid,uuid), pikas_private.cafeteria_read_scope(uuid,uuid,text),
 pikas_private.cafeteria_admin_read_core(uuid, uuid),
 pikas_private.cafeteria_operations_read_core(uuid, uuid, text, integer, uuid),
 pikas_private.cafeteria_transactions_read_core(uuid, uuid, text, date, date, text, text, bigint, integer),
 pikas_private.cafeteria_transaction_detail_core(uuid, uuid, uuid),
 pikas_private.cafeteria_report_read_core(uuid, uuid, text, text, date, date)
 from public,anon,authenticated,service_role;
revoke all on function public.platform_customer_operations_overview(uuid),
 public.platform_support_cafeteria_read(uuid, uuid),
 public.platform_support_cafeteria_operations_read(uuid, uuid, text, integer, uuid),
 public.platform_support_cafeteria_transactions_read(uuid, uuid, text, date, date, text, text, bigint, integer),
 public.platform_support_cafeteria_transaction_detail(uuid, uuid, uuid),
 public.platform_support_cafeteria_report_read(uuid, uuid, text, text, date, date)
 from public,anon,authenticated,service_role;
grant execute on function public.platform_customer_operations_overview(uuid),
 public.platform_support_cafeteria_read(uuid, uuid),
 public.platform_support_cafeteria_operations_read(uuid, uuid, text, integer, uuid),
 public.platform_support_cafeteria_transactions_read(uuid, uuid, text, date, date, text, text, bigint, integer),
 public.platform_support_cafeteria_transaction_detail(uuid, uuid, uuid),
 public.platform_support_cafeteria_report_read(uuid, uuid, text, text, date, date)
 to authenticated;

commit;
