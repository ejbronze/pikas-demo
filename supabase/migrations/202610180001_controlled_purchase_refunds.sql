-- Phase 5C.1: item-level controlled refunds over the Phase 3C immutable refund foundation.
-- Additive: existing amount-based refund RPCs, rows and integrity triggers are unchanged.
begin;
insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values
 ('cafeteria','cafeteria_admin','cafeteria:pos:refund:approve'),
 ('cafeteria','cafeteria_admin','cafeteria:refund_limits:configure'),
 ('cafeteria','pos_supervisor','cafeteria:refund_limits:configure')
on conflict do nothing;

-- Owner reason list: quality_issue and wrong_quantity join the existing reasons.
alter table public.refunds drop constraint refunds_reason_check;
alter table public.refunds add constraint refunds_reason_check check(reason in
 ('error','wrong_product','unavailable','duplicate','customer_requested','other','quality_issue','wrong_quantity'));
alter table public.financial_approvals drop constraint financial_approvals_reason_check;
alter table public.financial_approvals add constraint financial_approvals_reason_check check(reason in
 ('error','wrong_product','unavailable','duplicate','customer_requested','other','quality_issue','wrong_quantity'));
create or replace function pikas_private.validate_refund_input(amount bigint,reason text,notes text,key text) returns void
language plpgsql set search_path='' as $$
begin
 if amount is null or amount<=0 then raise exception using errcode='22023',message='INVALID_REFUND_AMOUNT'; end if;
 if reason is null or reason not in ('error','wrong_product','unavailable','duplicate','customer_requested','other','quality_issue','wrong_quantity') then
 raise exception using errcode='22023',message='INVALID_REFUND_REASON'; end if;
 if length(notes)>500 or (reason='other' and (notes is null or length(notes)<3)) then
 raise exception using errcode='22023',message='INVALID_REFUND_NOTES'; end if;
 if key is null or length(key) not between 16 and 128 then
 raise exception using errcode='22023',message='INVALID_REQUEST_KEY'; end if;
end $$;

-- Cashier daily limits: existing amount allowance plus a new event-count limit (0 = always override).
alter table public.cafeteria_refund_policies add column cashier_daily_refund_count_limit integer not null default 0
 check(cashier_daily_refund_count_limit between 0 and 10000);
create or replace function pikas_private.guard_refund_policy_transition() returns trigger
language plpgsql set search_path='' as $$
declare mutable text[]:=array['version','supervisor_override_enabled','daily_independent_refund_allowance_minor',
 'cashier_daily_refund_count_limit','updated_by_person_id','updated_at'];
begin
 if tg_op='DELETE' or (to_jsonb(old)-mutable) is distinct from (to_jsonb(new)-mutable)
 or new.version<>old.version+1 or new.updated_by_person_id is null then
 raise exception using errcode='23514',message='invalid_refund_policy_transition'; end if;
 new.updated_at:=clock_timestamp(); return new;
end $$;

-- Analytics/audit snapshot for item-level refunds (null on legacy amount-based rows).
alter table public.refunds
 add column sale_age_seconds bigint check(sale_age_seconds>=0),
 add column override_reasons text[] check(override_reasons <@ array['sale_age','count_limit','amount_limit']::text[]),
 add column approver_role_code text check(approver_role_code in ('pos_supervisor','cafeteria_admin')),
 add column items_fingerprint text check(items_fingerprint ~ '^[0-9a-f]{64}$');
alter table public.refunds add constraint refunds_itemized_snapshot check(items_fingerprint is null or
 (sale_age_seconds is not null and override_reasons is not null
  and (approval_id is null)=(approver_role_code is null)
  and (cardinality(override_reasons)=0 or authorization_mode='supervisor_approved')));
alter table public.financial_approvals add column items_fingerprint text check(items_fingerprint ~ '^[0-9a-f]{64}$');

create table public.refund_items (
 refund_id uuid not null references public.refunds(id) on delete restrict,
 purchase_id uuid not null references public.purchases(id) on delete restrict,
 purchase_item_id uuid not null references public.purchase_items(id) on delete restrict,
 quantity integer not null check(quantity>0),
 amount_minor bigint not null check(amount_minor>0),
 primary key(refund_id,purchase_item_id)
);
create index refund_items_purchase_item on public.refund_items(purchase_item_id);
alter table public.refund_items enable row level security;
revoke all on public.refund_items from public,anon,authenticated,service_role;
create trigger refund_items_immutable before update or delete on public.refund_items
 for each row execute function pikas_private.reject_purchase_history_mutation();

-- Prices the requested lines from immutable purchase snapshots; remaining quantity is evaluated
-- against committed item refunds (callers hold the purchase row lock when it is authoritative).
create function pikas_private.quote_refund_items(p public.purchases,p_items jsonb) returns jsonb
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
 if exists(select 1 from jsonb_array_elements(lines) l join public.purchase_items i on i.id=(l->>'purchase_item_id')::uuid
 where (l->>'quantity')::integer > i.quantity-coalesce((select sum(ri.quantity) from public.refund_items ri where ri.purchase_item_id=i.id),0)) then
 raise exception using errcode='23514',message='REFUND_EXCEEDS_REMAINING'; end if;
 if amount<=0 then raise exception using errcode='23514',message='NOT_REFUNDABLE'; end if;
 if amount>9223372036854775807 then raise exception using errcode='22003',message='REFUND_AMOUNT_OUT_OF_RANGE'; end if;
 return jsonb_build_object('lines',lines,'amount_minor',amount::bigint::text,
 'fingerprint',pikas_private.refund_hash(coalesce((select jsonb_agg(jsonb_build_object('purchase_item_id',l->>'purchase_item_id','quantity',l->'quantity'))
 from jsonb_array_elements(lines) l),'[]'::jsonb)));
end $$;

-- Approver authority: POS Supervisor or Cafeteria Admin of the purchase cafeteria.
create function pikas_private.lock_refund_approver(member_id uuid,p_person_id uuid,purchase public.purchases)
 returns text language plpgsql security definer set search_path='' as $$
declare role_value text;
begin
 perform 1 from public.persons p where p.id=p_person_id and p.status='active' and p.auth_user_id is not null for share;
 if not found then raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end if;
 select m.role_code into role_value from public.cafeteria_memberships m
 join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
 where m.id=member_id and m.person_id=p_person_id and m.account_id=purchase.account_id
 and m.school_id=purchase.school_id and m.cafeteria_id=purchase.cafeteria_id and m.status='active'
 and m.role_code in ('pos_supervisor','cafeteria_admin') and rc.capability='cafeteria:pos:refund:approve' for share of m;
 if not found then raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end if;
 return role_value;
end $$;

-- Integrity: itemized refunds carry exactly their priced lines and never exceed purchased quantity.
create function pikas_private.assert_refund_items_complete() returns trigger
language plpgsql security definer set search_path='' as $$
declare rid uuid; r public.refunds; total numeric; fp text;
begin
 if tg_table_name='refunds' then rid:=new.id; else rid:=new.refund_id; end if;
 select * into r from public.refunds where id=rid;
 if not found then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 if r.items_fingerprint is null then
 if exists(select 1 from public.refund_items where refund_id=rid) then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 return null; end if;
 select sum(ri.amount_minor::numeric),pikas_private.refund_hash(jsonb_agg(jsonb_build_object('purchase_item_id',ri.purchase_item_id::text,'quantity',ri.quantity) order by ri.purchase_item_id))
 into total,fp from public.refund_items ri where ri.refund_id=rid;
 if total is distinct from r.amount_minor::numeric or fp is distinct from r.items_fingerprint
 or exists(select 1 from public.refund_items ri join public.purchase_items i on i.id=ri.purchase_item_id
 where ri.refund_id=rid and (ri.purchase_id<>r.purchase_id or i.purchase_id<>r.purchase_id
 or ri.amount_minor::numeric<>i.unit_price_minor::numeric*ri.quantity
 or (select sum(x.quantity) from public.refund_items x where x.purchase_item_id=i.id)>i.quantity)) then
 raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 return null;
end $$;
create constraint trigger refunds_items_complete after insert on public.refunds deferrable initially deferred
 for each row execute function pikas_private.assert_refund_items_complete();
create constraint trigger refund_items_complete after insert on public.refund_items deferrable initially deferred
 for each row execute function pikas_private.assert_refund_items_complete();

create function pikas_private.itemized_refund_result(r public.refunds) returns jsonb
language sql stable set search_path='' as $$
 select pikas_private.refund_result(r)||jsonb_build_object('sale_age_seconds',r.sale_age_seconds::text,
 'override_required',cardinality(r.override_reasons)>0,'override_reasons',to_jsonb(r.override_reasons),
 'approver_role',r.approver_role_code,'register_session_id',r.register_session_id,
 'items',(select coalesce(jsonb_agg(jsonb_build_object('purchase_item_id',ri.purchase_item_id,'name',i.product_name_snapshot,
 'quantity',ri.quantity,'amount_minor',ri.amount_minor::text) order by i.line_number),'[]'::jsonb)
 from public.refund_items ri join public.purchase_items i on i.id=ri.purchase_item_id where ri.refund_id=r.id))
$$;

-- Same-device override: called as the approver. The cashier remains the requester/initiator.
create function public.issue_purchase_item_refund_approval(p_register_session_id uuid,p_purchase_id uuid,p_items jsonb,
 p_reason text,p_notes text,p_issuance_request_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.purchases; t public.purchase_tenders; a public.financial_approvals; rs public.register_sessions;
 actor uuid; approver_member uuid; role_value text; clean_notes text; quote jsonb; amount_value bigint; semantic text; prior_id uuid; issued timestamptz;
begin
 perform pikas_private.require_refund_isolation(); actor:=pikas_private.current_person_id();
 if actor is null then raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end if;
 clean_notes:=pikas_private.normalize_refund_notes(p_notes);
 perform pikas_private.validate_refund_input(1,p_reason,clean_notes,p_issuance_request_key);
 select * into p from public.purchases where id=p_purchase_id;
 if not found or not pikas_private.has_capability('cafeteria:pos:refund:approve',p.account_id,p.school_id,p.cafeteria_id) then
 raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end if;
 perform 1 from pikas_private.lock_active_cafeteria_scope(p.cafeteria_id);
 if not found then raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p.account_id::text||':'||actor::text||':'||p_issuance_request_key,20261008));
 select m.id into approver_member from public.cafeteria_memberships m join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
 where m.person_id=actor and m.cafeteria_id=p.cafeteria_id and m.status='active' and m.role_code in ('pos_supervisor','cafeteria_admin')
 and rc.capability='cafeteria:pos:refund:approve' order by (m.role_code='cafeteria_admin') desc,m.id limit 1;
 role_value:=pikas_private.lock_refund_approver(approver_member,actor,p);
 if pikas_private.current_person_id() is distinct from actor then raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end if;
 select * into rs from public.register_sessions where id=p_register_session_id and cafeteria_id=p.cafeteria_id;
 if not found or rs.status<>'open' then raise exception using errcode='23514',message='SESSION_CLOSED'; end if;
 if rs.operator_person_id=actor then raise exception using errcode='42501',message='SELF_APPROVAL_NOT_ALLOWED'; end if;
 perform pikas_private.lock_refund_member(rs.operator_membership_id,rs.operator_person_id,p,'cafeteria:pos:refund:create');
 select * into t from public.purchase_tenders where purchase_id=p.id;
 if t.tender_type not in ('cash','student_wallet') then raise exception using errcode='23514',message='NOT_REFUNDABLE'; end if;
 quote:=pikas_private.quote_refund_items(p,p_items); amount_value:=(quote->>'amount_minor')::bigint;
 semantic:=pikas_private.refund_semantic(p.id,rs.operator_membership_id,rs.operator_person_id,amount_value,p.currency_code,t.tender_type,
 p_reason,clean_notes,case when t.tender_type='cash' then rs.id end,p.cafeteria_id);
 select * into a from public.financial_approvals where account_id=p.account_id and approver_person_id=actor and issuance_request_key=p_issuance_request_key;
 if found then
 if a.semantic_fingerprint<>semantic or a.items_fingerprint is distinct from quote->>'fingerprint' or a.approver_membership_id<>approver_member then
 raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT'; end if;
 else
 select r.id into prior_id from public.refunds r where r.purchase_id=p.id and r.semantic_fingerprint=semantic order by r.refund_ordinal desc limit 1;
 issued:=pikas_private.refund_clock();
 insert into public.financial_approvals(account_id,school_id,cafeteria_id,purchase_id,currency_code,tender_type,
 requester_person_id,requester_membership_id,approver_person_id,approver_membership_id,amount_minor,reason,notes_hash,
 register_session_id,semantic_fingerprint,prior_matching_refund_id,issuance_request_key,issued_at,expires_at,items_fingerprint)
 values(p.account_id,p.school_id,p.cafeteria_id,p.id,p.currency_code,t.tender_type,rs.operator_person_id,rs.operator_membership_id,
 actor,approver_member,amount_value,p_reason,pikas_private.refund_hash(coalesce(to_jsonb(clean_notes),'null'::jsonb)),
 case when t.tender_type='cash' then rs.id end,semantic,prior_id,p_issuance_request_key,issued,issued+interval '10 minutes',quote->>'fingerprint') returning * into a;
 perform pikas_private.record_wallet_audit(actor,auth.uid(),role_value,'cafeteria',p.account_id,p.school_id,p.cafeteria_id,
 'refund_approval_issued','financial_approvals',a.id,jsonb_build_object('requester_person_id',rs.operator_person_id,'approver_role',role_value));
 end if;
 return jsonb_build_object('approval_id',a.id,'purchase_id',a.purchase_id,'amount_minor',a.amount_minor::text,
 'approver_role',role_value,'issued_at',a.issued_at,'expires_at',a.expires_at);
end $$;

-- Authoritative item refund from the actor's current open POS session.
create function public.create_purchase_item_refund(p_register_session_id uuid,p_purchase_id uuid,p_items jsonb,
 p_reason text,p_notes text,p_request_key text,p_approval_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.purchases; t public.purchase_tenders; r public.refunds; existing public.refunds; rs public.register_sessions;
 actor uuid; member uuid; role_value text; scope record; clean_notes text; quote jsonb; amount_value bigint; semantic text; fingerprint text;
 refund_session uuid; policy public.cafeteria_refund_policies; approval public.financial_approvals; approver_role text;
 wt public.purchase_wallet_tenders; wallet public.student_wallets; credit uuid; occurred timestamptz; day_value date; age bigint;
 used_amount numeric; used_count bigint; refunded numeric; ordinal numeric; mode_value text; reasons text[]:='{}'::text[];
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
 quote:=pikas_private.quote_refund_items(p,p_items); amount_value:=(quote->>'amount_minor')::bigint;
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
 raise exception using errcode='23514',message='CASH_INSUFFICIENT';
 end if;
 occurred:=pikas_private.refund_clock(); day_value:=(occurred at time zone scope.business_timezone)::date;
 age:=greatest(0,floor(extract(epoch from occurred-p.purchased_at)))::bigint;
 select r0.id into prior_id from public.refunds r0 where r0.purchase_id=p.id and r0.semantic_fingerprint=semantic order by r0.refund_ordinal desc limit 1;
 select coalesce(sum(amount_minor::numeric),0),coalesce(max(refund_ordinal)::numeric,0)+1 into refunded,ordinal from public.refunds where purchase_id=p.id;
 if refunded+amount_value>p.total_minor then raise exception using errcode='23514',message='REFUND_EXCEEDS_REMAINING'; end if;
 if role_value='pos_cashier' then
 -- Actor advisory lock serializes this cashier's usage; overridden refunds do not consume allowance.
 select count(*),coalesce(sum(amount_minor::numeric),0) into used_count,used_amount from public.refunds where cafeteria_id=p.cafeteria_id
 and actor_person_id=actor and business_date=day_value and currency_code=p.currency_code and authorization_mode='independent';
 if age>300 then reasons:=array_append(reasons,'sale_age'); end if;
 if used_count>=policy.cashier_daily_refund_count_limit then reasons:=array_append(reasons,'count_limit'); end if;
 if used_amount+amount_value>policy.daily_independent_refund_allowance_minor then reasons:=array_append(reasons,'amount_limit'); end if;
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
 'approver_person_id',approval.approver_person_id,'approver_role',approver_role,'override_reasons',to_jsonb(reasons),'sale_age_seconds',age));
 return pikas_private.itemized_refund_result(r);
end $$;

-- POS read for the operator's current open session: purchase lines, cumulative refunds and own daily usage.
create function public.get_purchase_item_refundability(p_register_session_id uuid,p_purchase_number bigint) returns jsonb
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
 and actor_person_id=actor and business_date=day_value and currency_code=p.currency_code and authorization_mode='independent';
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

-- Cashier limits: Cafeteria Admin or POS Supervisor of the cafeteria.
create function public.configure_cashier_refund_limits(p_cafeteria_id uuid,p_expected_version integer,
 p_count_limit integer,p_amount_limit_minor bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scope record; actor uuid; role_value text; policy public.cafeteria_refund_policies;
begin
 perform pikas_private.require_refund_isolation(); actor:=pikas_private.current_person_id();
 select * into scope from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id);
 if actor is null or not found or not pikas_private.has_capability('cafeteria:refund_limits:configure',scope.account_id,scope.school_id,p_cafeteria_id) then
 raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 if p_count_limit is null or p_count_limit not between 0 and 10000 or p_amount_limit_minor is null or p_amount_limit_minor<0 then
 raise exception using errcode='22023',message='INVALID_REFUND_POLICY'; end if;
 perform 1 from public.persons x where x.id=actor and x.auth_user_id=auth.uid() and x.status='active' for share;
 if not found then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 select m.role_code into role_value from public.cafeteria_memberships m join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
 where m.person_id=actor and m.account_id=scope.account_id and m.school_id=scope.school_id and m.cafeteria_id=p_cafeteria_id
 and m.role_code in ('cafeteria_admin','pos_supervisor') and m.status='active' and rc.capability='cafeteria:refund_limits:configure'
 order by (m.role_code='cafeteria_admin') desc,m.id limit 1 for share of m;
 if not found then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 select * into policy from public.cafeteria_refund_policies where cafeteria_id=p_cafeteria_id for update;
 if p_expected_version is null or policy.version<>p_expected_version then raise exception using errcode='40001',message='POLICY_VERSION_CONFLICT'; end if;
 if policy.version=2147483647 then raise exception using errcode='22003',message='POLICY_VERSION_EXHAUSTED'; end if;
 update public.cafeteria_refund_policies set version=version+1,cashier_daily_refund_count_limit=p_count_limit,
 daily_independent_refund_allowance_minor=p_amount_limit_minor,updated_by_person_id=actor where cafeteria_id=p_cafeteria_id;
 perform pikas_private.record_wallet_audit(actor,auth.uid(),role_value,'cafeteria',scope.account_id,scope.school_id,p_cafeteria_id,
 'cashier_refund_limits_changed','cafeteria_refund_policies',p_cafeteria_id,jsonb_build_object('version',policy.version+1,
 'count_limit',p_count_limit,'prior_count_limit',policy.cashier_daily_refund_count_limit,
 'amount_limit_minor',p_amount_limit_minor::text,'prior_amount_limit_minor',policy.daily_independent_refund_allowance_minor::text));
 return jsonb_build_object('cafeteria_id',p_cafeteria_id,'version',policy.version+1,'count_limit',p_count_limit,'amount_limit_minor',p_amount_limit_minor::text);
end $$;

create function public.get_cashier_refund_limits(p_cafeteria_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.cafeterias; policy public.cafeteria_refund_policies;
begin
 select * into c from public.cafeterias where id=p_cafeteria_id;
 if not found or not pikas_private.has_capability('cafeteria:refund_limits:configure',c.account_id,c.school_id,c.id) then
 raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 select * into policy from public.cafeteria_refund_policies where cafeteria_id=c.id;
 return jsonb_build_object('cafeteria_id',c.id,'version',policy.version,'count_limit',policy.cashier_daily_refund_count_limit,
 'amount_limit_minor',policy.daily_independent_refund_allowance_minor::text,'window_seconds',300);
end $$;

-- Register the new POS refund RPCs under the existing POS application-session timeout.
create or replace function pikas_private.application_session_pre_request()
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_path text := coalesce(current_setting('request.path',true),'');
begin
  -- Service/anonymous flows retain their existing RLS and RPC authority; no customer bypass is added.
  if coalesce(auth.jwt()->>'role','') <> 'authenticated' then return; end if;
  -- Propagated from the per-tab transport binding. Old tabs cannot write under replacement cookies.
  perform pikas_private.application_session_id(nullif(
    coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-pikas-session-id','')::uuid);
  if v_path = any(array[
    '/rpc/pikas_session_start','/rpc/pikas_session_status','/rpc/pikas_session_activity','/rpc/pikas_session_end',
    '/rpc/activation_preview','/rpc/activation_consume','/rpc/activation_password_status','/rpc/activation_claim_password'
  ]) then return; end if;
  perform pikas_private.application_session_assert(v_path = any(array[
    '/rpc/get_pos_access_context','/rpc/list_my_operable_registers','/rpc/get_my_open_register_session',
    '/rpc/get_pos_register_session','/rpc/open_register_session','/rpc/close_my_register_session',
    '/rpc/checkout_purchase','/rpc/get_pos_customer_purchase_context','/rpc/cafeteria_customer_projection',
    '/rpc/get_cafeteria_saleable_catalog','/rpc/exceptionally_close_register_session',
    '/rpc/create_purchase_refund','/rpc/create_purchase_refund_approval','/rpc/get_purchase_refundability',
    '/rpc/revoke_financial_approval','/rpc/claim_purchase_receipt_print_job','/rpc/report_receipt_print_job',
    '/rpc/retry_receipt_print_job','/rpc/request_purchase_receipt_reprint',
    '/rpc/get_staff_credit_pos_projection','/rpc/settle_staff_receivable',
    '/rpc/create_purchase_item_refund','/rpc/issue_purchase_item_refund_approval','/rpc/get_purchase_item_refundability'
  ]));
end $$;

revoke all on function pikas_private.quote_refund_items(public.purchases,jsonb),pikas_private.lock_refund_approver(uuid,uuid,public.purchases),
 pikas_private.assert_refund_items_complete(),pikas_private.itemized_refund_result(public.refunds) from public,anon,authenticated,service_role;
revoke all on function public.issue_purchase_item_refund_approval(uuid,uuid,jsonb,text,text,text),
 public.create_purchase_item_refund(uuid,uuid,jsonb,text,text,text,uuid),public.get_purchase_item_refundability(uuid,bigint),
 public.configure_cashier_refund_limits(uuid,integer,integer,bigint),public.get_cashier_refund_limits(uuid) from public,anon,service_role;
grant execute on function public.issue_purchase_item_refund_approval(uuid,uuid,jsonb,text,text,text),
 public.create_purchase_item_refund(uuid,uuid,jsonb,text,text,text,uuid),public.get_purchase_item_refundability(uuid,bigint),
 public.configure_cashier_refund_limits(uuid,integer,integer,bigint),public.get_cashier_refund_limits(uuid) to authenticated;
commit;
