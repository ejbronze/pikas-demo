-- Phase 5C.1 owner corrections (additive over 202610180001):
-- 1. All refunds a cashier initiates count toward that day's totals, including approved overrides;
--    the count/amount limits only bound autonomous cashier authority.
-- 2. A cash refund may drive the current register's expected cash negative. For a cashier this
--    requires Cafeteria Admin/POS Supervisor override, recorded as `cash_shortfall`.
begin;
alter table public.refunds drop constraint refunds_override_reasons_check;
alter table public.refunds add constraint refunds_override_reasons_check
 check(override_reasons <@ array['sale_age','count_limit','amount_limit','cash_shortfall']::text[]);

-- Prices requested lines without the remaining-quantity check, so an exact retry of a refund that
-- exhausted a line still finds and returns the original refund (quote_refund_items stays authoritative).
create function pikas_private.price_refund_items(p public.purchases,p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare lines jsonb; amount numeric;
begin
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then
 raise exception using errcode='22023',message='INVALID_REFUND_ITEMS'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e)<>'object'
 or (select count(*) from jsonb_object_keys(e))<>2 or not (e ? 'purchase_item_id' and e ? 'quantity')
 or jsonb_typeof(e->'quantity')<>'number' or (e->>'purchase_item_id') !~ '^[0-9a-f-]{36}$'
 or (e->>'quantity') !~ '^[1-9][0-9]{0,5}$') then
 raise exception using errcode='22023',message='INVALID_REFUND_ITEMS'; end if;
 if (select count(distinct e->>'purchase_item_id') from jsonb_array_elements(p_items) e)<>jsonb_array_length(p_items) then
 raise exception using errcode='22023',message='INVALID_REFUND_ITEMS'; end if;
 select jsonb_agg(jsonb_build_object('purchase_item_id',i.id,'quantity',(e->>'quantity')::integer,
 'amount_minor',(i.unit_price_minor::numeric*(e->>'quantity')::integer)::text) order by i.id),
 sum(i.unit_price_minor::numeric*(e->>'quantity')::integer)
 into lines,amount
 from jsonb_array_elements(p_items) e join public.purchase_items i on i.id=(e->>'purchase_item_id')::uuid and i.purchase_id=p.id;
 if lines is null or jsonb_array_length(lines)<>jsonb_array_length(p_items) then
 raise exception using errcode='22023',message='INVALID_REFUND_ITEMS'; end if;
 if amount<=0 then raise exception using errcode='23514',message='NOT_REFUNDABLE'; end if;
 if amount>9223372036854775807 then raise exception using errcode='22003',message='REFUND_AMOUNT_OUT_OF_RANGE'; end if;
 return jsonb_build_object('lines',lines,'amount_minor',amount::bigint::text,
 'fingerprint',pikas_private.refund_hash(coalesce((select jsonb_agg(jsonb_build_object('purchase_item_id',l->>'purchase_item_id','quantity',l->'quantity'))
 from jsonb_array_elements(lines) l),'[]'::jsonb)));
end $$;
revoke all on function pikas_private.price_refund_items(public.purchases,jsonb) from public,anon,authenticated,service_role;

-- Unchanged from 202610180001 except cashier usage (all initiated refunds), cash shortfall override and
-- pre-lock pricing via price_refund_items for exact-retry lookup.
create or replace function public.create_purchase_item_refund(p_register_session_id uuid,p_purchase_id uuid,p_items jsonb,
 p_reason text,p_notes text,p_request_key text,p_approval_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.purchases; t public.purchase_tenders; r public.refunds; existing public.refunds; rs public.register_sessions;
 actor uuid; member uuid; role_value text; scope record; clean_notes text; quote jsonb; amount_value bigint; semantic text; fingerprint text;
 refund_session uuid; policy public.cafeteria_refund_policies; approval public.financial_approvals; approver_role text;
 wt public.purchase_wallet_tenders; wallet public.student_wallets; credit uuid; occurred timestamptz; day_value date; age bigint;
 used_amount numeric; used_count bigint; refunded numeric; ordinal numeric; mode_value text; reasons text[]:='{}'::text[]; shortfall boolean:=false;
 new_balance bigint; new_version bigint; setting_currency text; prior_id uuid;
begin
 perform pikas_private.require_refund_isolation(); actor:=pikas_private.current_person_id();
 if actor is null then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 clean_notes:=pikas_private.normalize_refund_notes(p_notes);
 perform pikas_private.validate_refund_input(1,p_reason,clean_notes,p_request_key);
 select * into p from public.purchases where id=p_purchase_id;
 if not found or not pikas_private.has_capability('cafeteria:pos:refund:create',p.account_id,p.school_id,p.cafeteria_id) then
 raise exception using errcode='42501',message='PURCHASE_NOT_FOUND_OR_NOT_AUTHORIZED'; end if;
 select * into scope from pikas_private.lock_active_cafeteria_scope(p.cafeteria_id);
 if not found then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p.account_id::text||':'||actor::text||':'||p_request_key,20261007));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261005));
 select * into rs from public.register_sessions where id=p_register_session_id;
 if not found or rs.operator_person_id<>actor or rs.cafeteria_id<>p.cafeteria_id then
 raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 member:=rs.operator_membership_id;
 role_value:=pikas_private.lock_refund_member(member,actor,p,'cafeteria:pos:refund:create');
 if pikas_private.current_person_id() is distinct from actor then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 select * into t from public.purchase_tenders where purchase_id=p.id;
 if t.tender_type not in ('cash','student_wallet') then raise exception using errcode='23514',message='NOT_REFUNDABLE'; end if;
 refund_session:=case when t.tender_type='cash' then rs.id end;
 quote:=pikas_private.price_refund_items(p,p_items); amount_value:=(quote->>'amount_minor')::bigint;
 semantic:=pikas_private.refund_semantic(p.id,member,actor,amount_value,p.currency_code,t.tender_type,p_reason,clean_notes,refund_session,p.cafeteria_id);
 fingerprint:=pikas_private.refund_hash(jsonb_build_object('semantic',semantic,'approval_id',p_approval_id));
 select * into existing from public.refunds where account_id=p.account_id and actor_person_id=actor and request_key=p_request_key;
 if found then
 if existing.payload_fingerprint<>fingerprint or existing.items_fingerprint is distinct from quote->>'fingerprint' then
 raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT'; end if;
 return pikas_private.itemized_refund_result(existing);
 end if;
 -- Current open register (also for PIKAS Cash, which records no session or cash).
 rs:=pikas_private.lock_refund_cash_session(rs.id,member,actor,p);
 select catalog_currency_code into setting_currency from public.cafeteria_operation_settings where cafeteria_id=p.cafeteria_id for share;
 if setting_currency is distinct from p.currency_code then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 select * into policy from public.cafeteria_refund_policies where cafeteria_id=p.cafeteria_id for share;
 if not found or policy.currency_code<>p.currency_code then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 perform 1 from public.supported_currencies where currency_code=p.currency_code and status='enabled' for share;
 if not found then raise exception using errcode='23514',message='CURRENCY_DISABLED'; end if;
 select * into p from public.purchases where id=p.id for no key update;
 if exists(select 1 from public.refunds x where x.purchase_id=p.id and x.items_fingerprint is null) then
 raise exception using errcode='23514',message='REFUND_ITEMS_UNAVAILABLE'; end if;
 -- Authoritative remaining quantity under the purchase lock.
 quote:=pikas_private.quote_refund_items(p,p_items);
 if p_approval_id is not null then
 select * into approval from public.financial_approvals where id=p_approval_id;
 if not found or approval.semantic_fingerprint<>semantic or approval.items_fingerprint is distinct from quote->>'fingerprint' then
 raise exception using errcode='23514',message='APPROVAL_INVALID'; end if;
 if approval.approver_person_id=actor then raise exception using errcode='42501',message='SELF_APPROVAL_NOT_ALLOWED'; end if;
 begin approver_role:=pikas_private.lock_refund_approver(approval.approver_membership_id,approval.approver_person_id,p);
 exception when insufficient_privilege then raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end;
 select * into approval from public.financial_approvals where id=p_approval_id for update;
 end if;
 if p.student_id is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p.student_id::text,0)); end if;
 if t.tender_type='student_wallet' then
 select * into wt from public.purchase_wallet_tenders where tender_id=t.id;
 select * into wallet from public.student_wallets where id=wt.wallet_id for update;
 if not found or wallet.student_id<>p.student_id or wallet.currency_code<>p.currency_code then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 if wallet.current_balance_minor::numeric+amount_value>9223372036854775807 then raise exception using errcode='22003',message='WALLET_BALANCE_OVERFLOW'; end if;
 new_balance:=wallet.current_balance_minor+amount_value; new_version:=wallet.balance_version+1;
 elsif (pikas_private.register_cash_summary(rs.id)->>'expected_minor')::numeric<amount_value then
 -- Expected cash is an accounting value: it may go negative, but a cashier needs an override for it.
 shortfall:=true;
 end if;
 occurred:=pikas_private.refund_clock(); day_value:=(occurred at time zone scope.business_timezone)::date;
 age:=greatest(0,floor(extract(epoch from occurred-p.purchased_at)))::bigint;
 select r0.id into prior_id from public.refunds r0 where r0.purchase_id=p.id and r0.semantic_fingerprint=semantic order by r0.refund_ordinal desc limit 1;
 select coalesce(sum(amount_minor::numeric),0),coalesce(max(refund_ordinal)::numeric,0)+1 into refunded,ordinal from public.refunds where purchase_id=p.id;
 if refunded+amount_value>p.total_minor then raise exception using errcode='23514',message='REFUND_EXCEEDS_REMAINING'; end if;
 if role_value='pos_cashier' then
 -- Actor advisory lock serializes this cashier's usage. Every refund the cashier initiated today counts,
 -- including approved ones: the limits bound autonomous authority, not the day's actual activity.
 select count(*),coalesce(sum(amount_minor::numeric),0) into used_count,used_amount from public.refunds where cafeteria_id=p.cafeteria_id
 and actor_person_id=actor and business_date=day_value and currency_code=p.currency_code and actor_role_code='pos_cashier';
 if age>300 then reasons:=array_append(reasons,'sale_age'); end if;
 if used_count>=policy.cashier_daily_refund_count_limit then reasons:=array_append(reasons,'count_limit'); end if;
 if used_amount+amount_value>policy.daily_independent_refund_allowance_minor then reasons:=array_append(reasons,'amount_limit'); end if;
 if shortfall then reasons:=array_append(reasons,'cash_shortfall'); end if;
 end if;
 if p_approval_id is not null then
 if approval.consumed_refund_id is not null then raise exception using errcode='23514',message='APPROVAL_ALREADY_USED'; end if;
 if approval.prior_matching_refund_id is distinct from prior_id or approval.revoked_at is not null then raise exception using errcode='23514',message='APPROVAL_INVALID'; end if;
 if approval.expires_at<=occurred then raise exception using errcode='23514',message='APPROVAL_EXPIRED'; end if;
 mode_value:='supervisor_approved';
 elsif cardinality(reasons)>0 then
 raise exception using errcode='42501',message='REFUND_APPROVAL_REQUIRED',detail=array_to_string(reasons,',');
 elsif role_value='pos_supervisor' then mode_value:='supervisor_direct';
 else mode_value:='independent';
 end if;
 insert into public.refunds(account_id,school_id,school_location_id,cafeteria_id,purchase_id,refund_ordinal,original_tender_id,
 tender_type,currency_code,amount_minor,actor_person_id,actor_membership_id,actor_role_code,register_id,register_session_id,
 occurred_at,business_timezone_snapshot,business_date,reason,notes,authorization_mode,policy_version,supervisor_override_enabled,
 independent_allowance_minor,approval_id,approver_person_id,request_key,payload_fingerprint,semantic_fingerprint,prior_matching_refund_id,
 remaining_after_minor,sale_age_seconds,override_reasons,approver_role_code,items_fingerprint)
 values(p.account_id,p.school_id,p.school_location_id,p.cafeteria_id,p.id,ordinal::bigint,t.id,t.tender_type,p.currency_code,
 amount_value,actor,member,role_value,case when t.tender_type='cash' then rs.register_id end,refund_session,occurred,scope.business_timezone,
 day_value,p_reason,clean_notes,mode_value,policy.version,policy.supervisor_override_enabled,policy.daily_independent_refund_allowance_minor,
 p_approval_id,approval.approver_person_id,p_request_key,fingerprint,semantic,prior_id,(p.total_minor-refunded-amount_value)::bigint,
 age,reasons,approver_role,quote->>'fingerprint') returning * into r;
 insert into public.refund_items(refund_id,purchase_id,purchase_item_id,quantity,amount_minor)
 select r.id,p.id,(l->>'purchase_item_id')::uuid,(l->>'quantity')::integer,(l->>'amount_minor')::bigint from jsonb_array_elements(quote->'lines') l;
 if t.tender_type='cash' then
 insert into public.refund_cash_outflows values(r.id,t.id,rs.id,amount_value,p.currency_code);
 else
 update public.student_wallets set current_balance_minor=new_balance,balance_version=new_version where id=wallet.id;
 insert into public.wallet_refund_credits(refund_id,account_id,school_id,cafeteria_id,purchase_id,original_tender_id,original_purchase_debit_id,
 student_id,wallet_id,currency_code,amount_minor,actor_person_id,posted_at)
 values(r.id,p.account_id,p.school_id,p.cafeteria_id,p.id,t.id,wt.wallet_purchase_debit_id,p.student_id,wallet.id,p.currency_code,amount_value,actor,occurred)
 returning id into credit;
 insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,balance_after_minor,
 balance_version_after,refund_credit_id,occurred_at) values(p.account_id,p.school_id,wallet.id,p.currency_code,'refund',amount_value,new_balance,new_version,credit,occurred);
 end if;
 if p.student_id is not null and day_value=p.business_date then
 insert into public.student_daily_spend_events(account_id,school_id,cafeteria_id,student_id,business_date,currency_code,purchase_id,
 amount_minor,event_type,occurred_at,refund_id) values(p.account_id,p.school_id,p.cafeteria_id,p.student_id,day_value,p.currency_code,p.id,
 -amount_value,'refund_compensation',occurred,r.id);
 end if;
 if p_approval_id is not null then
 update public.financial_approvals set consumed_refund_id=r.id,consumed_at=occurred where id=approval.id;
 perform pikas_private.record_wallet_audit(actor,auth.uid(),role_value,'cafeteria',p.account_id,p.school_id,p.cafeteria_id,
 'refund_approval_consumed','financial_approvals',approval.id,jsonb_build_object('refund_id',r.id));
 end if;
 perform pikas_private.record_wallet_audit(actor,auth.uid(),role_value,'cafeteria',p.account_id,p.school_id,p.cafeteria_id,
 'refund_committed','refunds',r.id,jsonb_build_object('authorization_mode',mode_value,'approval_id',p_approval_id,
 'approver_person_id',approval.approver_person_id,'approver_role',approver_role,'override_reasons',to_jsonb(reasons),'sale_age_seconds',age,'cash_shortfall',shortfall));
 return pikas_private.itemized_refund_result(r);
end $$;

-- Unchanged from 202610180001 except the operator's daily usage counts all cashier-initiated refunds.
create or replace function public.get_purchase_item_refundability(p_register_session_id uuid,p_purchase_number bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare rs public.register_sessions; p public.purchases; t public.purchase_tenders; actor uuid; role_value text; scope record;
 policy public.cafeteria_refund_policies; day_value date; used_count bigint; used_amount numeric; refunded numeric;
begin
 perform pikas_private.require_refund_isolation(); actor:=pikas_private.current_person_id();
 select * into rs from public.register_sessions where id=p_register_session_id;
 if actor is null or not found or rs.operator_person_id<>actor or rs.status<>'open' then
 raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 select * into p from public.purchases where cafeteria_id=rs.cafeteria_id and purchase_number=p_purchase_number;
 if not found then raise exception using errcode='23503',message='PURCHASE_NOT_FOUND'; end if;
 if not pikas_private.has_capability('cafeteria:pos:refund:create',p.account_id,p.school_id,p.cafeteria_id) then
 raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 role_value:=pikas_private.lock_refund_member(rs.operator_membership_id,actor,p,'cafeteria:pos:refund:create');
 select * into scope from pikas_private.lock_active_cafeteria_scope(p.cafeteria_id);
 select * into t from public.purchase_tenders where purchase_id=p.id;
 select * into policy from public.cafeteria_refund_policies where cafeteria_id=p.cafeteria_id;
 day_value:=(clock_timestamp() at time zone scope.business_timezone)::date;
 select count(*),coalesce(sum(amount_minor::numeric),0) into used_count,used_amount from public.refunds where cafeteria_id=p.cafeteria_id
 and actor_person_id=actor and business_date=day_value and currency_code=p.currency_code and actor_role_code='pos_cashier';
 select coalesce(sum(amount_minor::numeric),0) into refunded from public.refunds where purchase_id=p.id;
 return jsonb_build_object('purchase_id',p.id,'purchase_number',p.purchase_number::text,'purchased_at',p.purchased_at,
 'sale_age_seconds',greatest(0,floor(extract(epoch from clock_timestamp()-p.purchased_at)))::bigint::text,
 'customer_name',coalesce(p.customer_display_name_snapshot,'No Usuario'),'tender_type',t.tender_type,'currency_code',p.currency_code,
 'total_minor',p.total_minor::text,'refunded_minor',refunded::bigint::text,'remaining_minor',(p.total_minor-refunded)::bigint::text,
 'itemizable',t.tender_type in ('cash','student_wallet') and not exists(select 1 from public.refunds x where x.purchase_id=p.id and x.items_fingerprint is null),
 'items',(select coalesce(jsonb_agg(jsonb_build_object('purchase_item_id',i.id,'name',i.product_name_snapshot,'unit_price_minor',i.unit_price_minor::text,
 'quantity',i.quantity,'refunded_quantity',coalesce(q.refunded,0)) order by i.line_number),'[]'::jsonb)
 from public.purchase_items i left join lateral (select sum(ri.quantity)::integer refunded from public.refund_items ri where ri.purchase_item_id=i.id) q on true
 where i.purchase_id=p.id),
 'refunds',(select coalesce(jsonb_agg(jsonb_build_object('refund_ordinal',x.refund_ordinal::text,'amount_minor',x.amount_minor::text,
 'occurred_at',x.occurred_at,'reason',x.reason,'authorization_mode',x.authorization_mode) order by x.refund_ordinal),'[]'::jsonb)
 from public.refunds x where x.purchase_id=p.id),
 'actor_role',role_value,'window_seconds',300,'cashier_count_limit',policy.cashier_daily_refund_count_limit,
 'cashier_amount_limit_minor',policy.daily_independent_refund_allowance_minor::text,
 'cashier_used_count',used_count,'cashier_used_amount_minor',used_amount::bigint::text);
end $$;
commit;
