-- Phase 5D.5 School PIKAS Cash report (plan §12). Additive and read-only: one new report read over
-- the school's own wallet ledger. No table, column, index, capability, grant scope or frozen function
-- changes; 5D.1–5D.4 reads are untouched.
--
-- Authority: require_school_admin(..,'school:wallets:read') — School Admin of the school, or Account
-- Admin of its account through the existing Beta wallet policy — revalidated after reading. The
-- sandbox admin POV is denied exactly as school_wallet_access already reports it (no financial read).
-- Cafeteria Admin, POS roles and Platform Admin hold no school wallet capability and are denied.
--
-- Semantics (plan §12, D10):
--  * Current balance is point-in-time: Σ student_wallets.current_balance_minor of the school's DOP
--    wallets, never derived from period movements.
--  * Period movements come from wallet_ledger_entries by entry type, on the business date of the
--    event itself (ledger occurred_at in schools.business_timezone; gap G1), never re-dated.
--  * Only purchases and purchase refunds carry cafeteria attribution (wallet_purchase_debits /
--    wallet_refund_credits). The breakdown is PIKAS Cash activity only: no other tender, no sales
--    total, no all-tender count, no register data.
begin;

create function public.school_wallet_report(p_school_id uuid,p_period text,p_from date default null,p_to date default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; tz text; today date; d_from date; d_to date; w_from timestamptz; w_to timestamptz; acct uuid; current_value jsonb; movements jsonb; places jsonb;
begin
 if exists(select 1 from pikas_private.sandbox_validated_pov()) then
  raise exception using errcode='42501',message='wallet_report_authority_required'; end if;
 ctx:=pikas_private.require_school_admin(p_school_id,'school:wallets:read');
 acct:=(ctx->>'account_id')::uuid;
 select s.business_timezone into tz from public.schools s where s.id=p_school_id and s.account_id=acct;
 today:=(pikas_private.report_clock() at time zone tz)::date;
 -- Periods exactly as the Phase 5D reports (server "today", custom ≤ 92 days, no future end).
 if p_period='custom' then d_from:=p_from; d_to:=p_to;
  if d_from is null or d_to is null or d_from>d_to or d_to>today then
   raise exception using errcode='22023',message='invalid_report_range'; end if;
  if d_to-d_from+1>92 then raise exception using errcode='22023',message='report_range_too_long'; end if;
 elsif p_from is not null or p_to is not null then raise exception using errcode='22023',message='invalid_report_period';
 elsif p_period='today' then d_from:=today; d_to:=today;
 elsif p_period='last_7_days' then d_from:=today-6; d_to:=today;
 elsif p_period='last_30_days' then d_from:=today-29; d_to:=today;
 else raise exception using errcode='22023',message='invalid_report_period'; end if;
 -- Local business-day boundaries: occurred_at in [w_from, w_to) ⇔ its business date is in [from, to].
 w_from:=d_from::timestamp at time zone tz; w_to:=(d_to+1)::timestamp at time zone tz;

 select jsonb_build_object('total_balance_minor',coalesce(sum(w.current_balance_minor::numeric),0)::text,
   'wallet_count',count(*),'active_wallet_count',count(*) filter (where w.status='active'),'frozen_wallet_count',count(*) filter (where w.status='frozen'),
   'negative_wallet_count',count(*) filter (where w.current_balance_minor<0),
   'negative_balance_minor',coalesce(sum(w.current_balance_minor::numeric) filter (where w.current_balance_minor<0),0)::text)
 into current_value from public.student_wallets w where w.account_id=acct and w.school_id=p_school_id and w.currency_code='DOP';

 -- One statement for all period movements, so the totals are mutually consistent.
 with entries as (
  select l.entry_type,l.amount_minor::numeric amount,l.wallet_id,a.actor_role,d.cafeteria_id debit_cafeteria,f.cafeteria_id credit_cafeteria
  from public.wallet_ledger_entries l
  left join public.wallet_adjustments a on a.id=l.adjustment_id
  left join public.wallet_purchase_debits d on d.id=l.purchase_debit_id
  left join public.wallet_refund_credits f on f.id=l.refund_credit_id
  where l.account_id=acct and l.school_id=p_school_id and l.currency_code='DOP' and l.occurred_at>=w_from and l.occurred_at<w_to
 ), by_cafeteria as (
  select coalesce(debit_cafeteria,credit_cafeteria) cafeteria_id,
   coalesce(sum(-amount) filter (where entry_type='purchase'),0) spent,count(*) filter (where entry_type='purchase') spent_count,
   coalesce(sum(amount) filter (where entry_type='refund'),0) refunded,count(*) filter (where entry_type='refund') refund_count
  from entries where entry_type in ('purchase','refund') group by 1
 )
 select jsonb_build_object(
   'replenishments',jsonb_build_object('amount_minor',coalesce(sum(amount) filter (where entry_type='replenishment'),0)::text,'count',count(*) filter (where entry_type='replenishment')),
   'reversals',jsonb_build_object('amount_minor',coalesce(sum(-amount) filter (where entry_type='replenishment_reversal'),0)::text,'count',count(*) filter (where entry_type='replenishment_reversal')),
   'net_replenished_minor',coalesce(sum(amount) filter (where entry_type in ('replenishment','replenishment_reversal')),0)::text,
   'purchases',jsonb_build_object('amount_minor',coalesce(sum(-amount) filter (where entry_type='purchase'),0)::text,'count',count(*) filter (where entry_type='purchase')),
   'refunds',jsonb_build_object('amount_minor',coalesce(sum(amount) filter (where entry_type='refund'),0)::text,'count',count(*) filter (where entry_type='refund')),
   'adjustment_credits',jsonb_build_object('amount_minor',coalesce(sum(amount) filter (where entry_type='adjustment' and actor_role is not null and amount>0),0)::text,'count',count(*) filter (where entry_type='adjustment' and actor_role is not null and amount>0)),
   'adjustment_debits',jsonb_build_object('amount_minor',coalesce(sum(-amount) filter (where entry_type='adjustment' and actor_role is not null and amount<0),0)::text,'count',count(*) filter (where entry_type='adjustment' and actor_role is not null and amount<0)),
   'historical_adjustments',jsonb_build_object('net_minor',coalesce(sum(amount) filter (where entry_type='adjustment' and actor_role is null),0)::text,'count',count(*) filter (where entry_type='adjustment' and actor_role is null)),
   'net_movement_minor',coalesce(sum(amount),0)::text,
   'entry_count',count(*),'wallets_with_movement',count(distinct wallet_id)),
  coalesce((select jsonb_agg(jsonb_build_object('cafeteria_id',b.cafeteria_id,'name',c.name,'spent_minor',b.spent::text,'purchase_count',b.spent_count,
    'refunded_minor',b.refunded::text,'refund_count',b.refund_count) order by b.spent desc,c.name,b.cafeteria_id)
   from by_cafeteria b join public.cafeterias c on c.id=b.cafeteria_id),'[]'::jsonb)
 into movements,places from entries;

 -- Revalidate authority after reading, as the other financial reads do.
 if exists(select 1 from pikas_private.sandbox_validated_pov()) then
  raise exception using errcode='42501',message='wallet_report_authority_required'; end if;
 perform pikas_private.require_school_admin(p_school_id,'school:wallets:read');
 return jsonb_build_object('school_id',p_school_id,'tenant_kind',ctx->>'tenant_kind','business_timezone',tz,'currency_code','DOP',
  'period',p_period,'from',d_from,'to',d_to,'today',today,'as_of',pikas_private.report_clock(),
  'current',current_value,'movements',movements,'cafeterias',places);
end $$;

revoke all on function public.school_wallet_report(uuid,text,date,date) from public,anon,authenticated,service_role;
grant execute on function public.school_wallet_report(uuid,text,date,date) to authenticated;
commit;
