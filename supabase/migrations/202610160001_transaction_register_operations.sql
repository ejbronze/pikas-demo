-- Phase 5A: authoritative operational history and immutable close reconciliation.
begin;

create index purchases_register_session_time_idx on public.purchases(register_session_id,purchased_at desc,id);

create function pikas_private.register_cash_summary(p_session_id uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('opening_minor',s.opening_cash_minor::text,
 'cash_sales_minor',x.sales::text,'cash_refunds_minor',x.refunds::text,
 'cash_settlements_minor',x.settlements::text,'purchase_count',x.purchase_count,
 'expected_minor',(s.opening_cash_minor::numeric+x.sales+x.settlements-x.refunds)::text)
 from public.register_sessions s cross join lateral (
 select coalesce((select sum(p.total_minor) from public.purchases p join public.purchase_tenders t on t.purchase_id=p.id
   where p.register_session_id=s.id and t.tender_type='cash'),0) sales,
 coalesce((select sum(r.amount_minor) from public.refund_cash_outflows r where r.register_session_id=s.id),0) refunds,
 coalesce((select sum(r.amount_minor) from public.staff_receivable_settlements r where r.register_session_id=s.id and r.method='cash'),0) settlements,
 (select count(*) from public.purchases p where p.register_session_id=s.id) purchase_count
 ) x where s.id=p_session_id;
$$;

create table pikas_private.register_close_reconciliations (
 session_id uuid primary key references public.register_sessions(id) on delete restrict,
 summary jsonb not null,
 difference_minor numeric(40,0) not null,
 captured_at timestamptz not null default clock_timestamp()
);
alter table pikas_private.register_close_reconciliations enable row level security;
revoke all on pikas_private.register_close_reconciliations from public,anon,authenticated,service_role;
create trigger register_close_reconciliation_immutable before update or delete on pikas_private.register_close_reconciliations
for each row execute function pikas_private.reject_pos_history_delete();
create trigger register_close_reconciliation_no_truncate before truncate on pikas_private.register_close_reconciliations
execute function pikas_private.reject_pos_history_delete();

create function pikas_private.capture_register_close_reconciliation() returns trigger
language plpgsql security definer set search_path='' as $$
declare summary jsonb;
begin
 -- All authoritative cash writers lock the session/register before committing.
 -- The close holds the session UPDATE lock; this query observes completed writers.
 if old.status='open' and new.status='closed' then
  summary:=pikas_private.register_cash_summary(new.id);
  insert into pikas_private.register_close_reconciliations(session_id,summary,difference_minor)
  values(new.id,summary,new.counted_cash_minor::numeric-(summary->>'expected_minor')::numeric);
 end if;
 return null;
end $$;
create trigger register_close_reconciliation_capture after update on public.register_sessions
for each row execute function pikas_private.capture_register_close_reconciliation();

create function pikas_private.require_financial_admin(p_cafeteria_id uuid,p_capability text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; school uuid;
begin
 ctx:=pikas_private.require_cafeteria_admin(p_cafeteria_id,true);
 select school_id into school from public.cafeterias where id=p_cafeteria_id;
 if not pikas_private.sandbox_admin_has_capability('cafeteria_admin',p_capability,
  (ctx->>'account_id')::uuid,school,p_cafeteria_id) then
  raise exception using errcode='42501',message='financial_admin_authority_required';
 end if;
 return ctx;
end $$;

create function pikas_private.operation_purchase(p_id uuid,p_detail boolean default false) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'receipt_number',p.purchase_number::text,'purchased_at',p.purchased_at,
 'register_id',p.register_id,'session_id',p.register_session_id,'register_name',s.register_name_snapshot,
 'operator_id',p.operator_person_id,'operator_name',o.display_name,
 'customer_name',coalesce(p.customer_display_name_snapshot,'No Usuario'),'customer_type',p.customer_type_snapshot,
 'tender',t.tender_type,'currency',p.currency_code,'total_minor',p.total_minor::text)
 || case when p_detail then jsonb_build_object(
 'cash_received_minor',ct.cash_received_minor::text,'change_minor',ct.change_due_minor::text,
 'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'quantity',i.quantity,
 'unit_price_minor',i.unit_price_minor::text,'line_total_minor',i.line_total_minor::text) order by i.line_number)
 from public.purchase_items i where i.purchase_id=p.id),'[]'::jsonb),
 'receipt',(select j.receipt_snapshot from public.receipt_print_jobs j where j.purchase_id=p.id and j.job_kind='original'))
 else '{}'::jsonb end
 from public.purchases p join public.purchase_tenders t on t.purchase_id=p.id
 join public.register_sessions s on s.id=p.register_session_id join public.persons o on o.id=p.operator_person_id
 left join public.purchase_cash_tenders ct on ct.tender_id=t.id where p.id=p_id;
$$;

create function pikas_private.operation_session(p_id uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'register_id',s.register_id,'register_name',s.register_name_snapshot,
 'register_code',s.register_code_snapshot,'operator_id',s.operator_person_id,'operator_name',o.display_name,
 'opened_at',s.opened_at,'status',s.status,'version',s.version,'currency',s.currency_code,
 'closed_at',s.closed_at,'closed_by',c.display_name,'close_type',s.close_type,'reason',s.close_reason_code,'note',s.close_note,
 'counted_minor',s.counted_cash_minor::text,'summary',coalesce(r.summary,pikas_private.register_cash_summary(s.id)),
 'difference_minor',case when s.status='closed' then coalesce(r.difference_minor,
 s.counted_cash_minor::numeric-(pikas_private.register_cash_summary(s.id)->>'expected_minor')::numeric)::text end,
 'close_snapshot',r.session_id is not null)
 from public.register_sessions s join public.persons o on o.id=s.operator_person_id
 left join public.persons c on c.id=s.closed_by_person_id
 left join pikas_private.register_close_reconciliations r on r.session_id=s.id where s.id=p_id;
$$;

create function public.cafeteria_operations_read(p_cafeteria_id uuid,p_kind text,p_offset integer default 0,
 p_target_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; rows jsonb;
begin
 perform pikas_private.begin_sandbox_admin_command('cafeteria_admin');
 ctx:=pikas_private.require_financial_admin(p_cafeteria_id,
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
 perform pikas_private.require_financial_admin(p_cafeteria_id,case when p_kind in ('transactions','transaction') then 'cafeteria:pos:purchases:read' else 'cafeteria:pos:sessions:read' end);
 perform set_config('pikas.admin_pov_session','',true);
 return jsonb_build_object('cafeteria_id',p_cafeteria_id,'tenant_kind',ctx->>'tenant_kind','data',rows);
end $$;

-- Keep the existing exceptional-close recovery boundary: a different active administrator,
-- an explicit reason, original owner/session identity and permanent single close.
create function public.cafeteria_operations_close(p_cafeteria_id uuid,p_session_id uuid,p_version integer,
 p_counted_minor bigint,p_reason text,p_note text,p_request_key uuid,p_expected_minor numeric) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; actor uuid; s public.register_sessions; result jsonb; fp text; prior pikas_private.cafeteria_admin_requests;
begin
 perform pikas_private.begin_sandbox_admin_command('cafeteria_admin');
 ctx:=pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:session:exceptional_close');
 actor:=(ctx->>'actor_id')::uuid;
 if p_request_key is null or p_expected_minor is null or p_expected_minor<>trunc(p_expected_minor) then raise exception using errcode='22023',message='invalid_close_request'; end if;
 fp:=encode(extensions.digest(jsonb_build_object('operation','register_close','cafeteria',p_cafeteria_id,'session',p_session_id,'version',p_version,'counted',p_counted_minor,'expected',p_expected_minor,'reason',p_reason,'note',p_note)::text,'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_key::text,20261013));
 select * into prior from pikas_private.cafeteria_admin_requests where request_id=p_request_key;
 if found then
  if prior.actor_person_id<>actor or prior.actor_auth_id<>auth.uid() or prior.cafeteria_id<>p_cafeteria_id or prior.fingerprint<>fp then raise exception using errcode='23505',message='request_key_reused'; end if;
  perform pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:session:exceptional_close');
  perform set_config('pikas.admin_pov_session','',true); return prior.response;
 end if;
 -- The financial sandbox capability is deliberately excluded by frozen Phase 4 POV policy.
 -- Consequently this delegates only to the established real-admin exceptional close RPC.
 select * into s from public.register_sessions where id=p_session_id and cafeteria_id=p_cafeteria_id;
 if not found then raise exception using errcode='42501',message='not_authorized'; end if;
 if actor<s.operator_person_id then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261005));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.operator_person_id::text,20261005));
 else
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.operator_person_id::text,20261005));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261005));
 end if;
 perform 1 from public.cafeteria_registers where id=s.register_id for update;
 select * into s from public.register_sessions where id=p_session_id for update;
 perform pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:session:exceptional_close');
 if (pikas_private.register_cash_summary(s.id)->>'expected_minor')::numeric<>p_expected_minor then raise exception using errcode='40001',message='stale_expected_cash'; end if;
 perform public.exceptionally_close_register_session(p_session_id,p_version,p_counted_minor,p_reason,p_note,p_request_key::text);
 perform pikas_private.require_financial_admin(p_cafeteria_id,'cafeteria:pos:session:exceptional_close');
 result:=jsonb_build_object('request_key',p_request_key,'session',pikas_private.operation_session(p_session_id));
 insert into pikas_private.cafeteria_admin_requests(request_id,actor_person_id,actor_auth_id,cafeteria_id,fingerprint,response) values(p_request_key,actor,auth.uid(),p_cafeteria_id,fp,result);
 perform set_config('pikas.admin_pov_session','',true);
 return result;
end $$;

revoke all on function pikas_private.register_cash_summary(uuid),pikas_private.capture_register_close_reconciliation(),
 pikas_private.require_financial_admin(uuid,text),pikas_private.operation_purchase(uuid,boolean),pikas_private.operation_session(uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.cafeteria_operations_read(uuid,text,integer,uuid),
 public.cafeteria_operations_close(uuid,uuid,integer,bigint,text,text,uuid,numeric) from public,anon,authenticated,service_role;
grant execute on function public.cafeteria_operations_read(uuid,text,integer,uuid),
 public.cafeteria_operations_close(uuid,uuid,integer,bigint,text,text,uuid,numeric) to authenticated;
commit;
