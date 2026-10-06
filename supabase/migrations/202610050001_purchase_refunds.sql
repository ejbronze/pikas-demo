-- Phase 3C: immutable amount-based refunds and action-specific approvals.
begin;
insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values
 ('cafeteria','pos_cashier','cafeteria:pos:refund:create'),
 ('cafeteria','pos_cashier','cafeteria:pos:refunds:read_own'),
 ('cafeteria','pos_supervisor','cafeteria:pos:refund:create'),
 ('cafeteria','pos_supervisor','cafeteria:pos:refunds:read_own'),
 ('cafeteria','pos_supervisor','cafeteria:pos:refunds:read'),
 ('cafeteria','pos_supervisor','cafeteria:pos:refund:approve'),
 ('cafeteria','pos_supervisor','cafeteria:pos:refund:direct'),
 ('cafeteria','cafeteria_admin','cafeteria:pos:refunds:read'),
 ('cafeteria','cafeteria_admin','cafeteria:refund_policy:configure');

create table public.cafeteria_refund_policies (
 cafeteria_id uuid primary key,
 account_id uuid not null,
 school_id uuid not null,
 currency_code text not null references public.supported_currencies(currency_code) on delete restrict,
 supervisor_override_enabled boolean not null default true,
 daily_independent_refund_allowance_minor bigint not null default 0 check(daily_independent_refund_allowance_minor>=0),
 version integer not null default 1 check(version>0),
 updated_by_person_id uuid references public.persons(id) on delete restrict,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(account_id,school_id,cafeteria_id)
 references public.cafeterias(account_id,school_id,id) on delete restrict
);
create function pikas_private.initialize_refund_policy() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.cafeteria_refund_policies(account_id,school_id,cafeteria_id,currency_code)
 values(new.account_id,new.school_id,new.cafeteria_id,new.catalog_currency_code) on conflict(cafeteria_id) do nothing;
 return new;
end $$;
create trigger refund_policy_init after insert on public.cafeteria_operation_settings
 for each row execute function pikas_private.initialize_refund_policy();
insert into public.cafeteria_refund_policies(account_id,school_id,cafeteria_id,currency_code)
 select account_id,school_id,cafeteria_id,catalog_currency_code from public.cafeteria_operation_settings;

create table public.financial_approvals (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null,
 school_id uuid not null,
 cafeteria_id uuid not null,
 action_type text not null default 'purchase_refund' check(action_type='purchase_refund'),
 purchase_id uuid not null,
 currency_code text not null,
 tender_type text not null check(tender_type in ('cash','student_wallet')),
 requester_person_id uuid not null references public.persons(id) on delete restrict,
 requester_membership_id uuid not null,
 approver_person_id uuid not null references public.persons(id) on delete restrict,
 approver_membership_id uuid not null,
 amount_minor bigint not null check(amount_minor>0),
 reason text not null check(reason in ('error','wrong_product','unavailable','duplicate','customer_requested','other')),
 notes_hash text not null check(notes_hash ~ '^[0-9a-f]{64}$'),
 register_session_id uuid references public.register_sessions(id) on delete restrict,
 semantic_fingerprint text not null check(semantic_fingerprint ~ '^[0-9a-f]{64}$'),
 prior_matching_refund_id uuid,
 issuance_request_key text not null check(length(issuance_request_key) between 16 and 128),
 issued_at timestamptz not null,
 expires_at timestamptz not null,
 consumed_refund_id uuid unique,
 consumed_at timestamptz,
 revoked_at timestamptz,
 revoked_by_person_id uuid references public.persons(id) on delete restrict,
 foreign key(account_id,school_id,cafeteria_id,purchase_id,currency_code)
 references public.purchases(account_id,school_id,cafeteria_id,id,currency_code) on delete restrict,
 foreign key(account_id,school_id,cafeteria_id,requester_membership_id,requester_person_id)
 references public.cafeteria_memberships(account_id,school_id,cafeteria_id,id,person_id) on delete restrict,
 foreign key(account_id,school_id,cafeteria_id,approver_membership_id,approver_person_id)
 references public.cafeteria_memberships(account_id,school_id,cafeteria_id,id,person_id) on delete restrict,
 unique(account_id,approver_person_id,issuance_request_key),
 check(requester_person_id<>approver_person_id),
 check(expires_at=issued_at+interval '10 minutes'),
 check((tender_type='cash' and register_session_id is not null) or
       (tender_type='student_wallet' and register_session_id is null)),
 check((consumed_refund_id is null and consumed_at is null) or
       (consumed_refund_id is not null and consumed_at is not null and consumed_at>=issued_at and consumed_at<expires_at)),
 check((revoked_at is null and revoked_by_person_id is null) or
       (revoked_at is not null and revoked_by_person_id=approver_person_id and revoked_at>=issued_at)),
 check(consumed_refund_id is null or revoked_at is null)
);

create table public.refunds (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null,
 school_id uuid not null,
 school_location_id uuid not null,
 cafeteria_id uuid not null,
 purchase_id uuid not null,
 refund_ordinal bigint not null check(refund_ordinal>0),
 original_tender_id uuid not null,
 tender_type text not null check(tender_type in ('cash','student_wallet')),
 currency_code text not null,
 amount_minor bigint not null check(amount_minor>0),
 actor_person_id uuid not null references public.persons(id) on delete restrict,
 actor_membership_id uuid not null,
 actor_role_code text not null check(actor_role_code in ('pos_cashier','pos_supervisor')),
 register_id uuid,
 register_session_id uuid,
 occurred_at timestamptz not null,
 business_timezone_snapshot text not null,
 business_date date not null,
 reason text not null check(reason in ('error','wrong_product','unavailable','duplicate','customer_requested','other')),
 notes text check(notes is null or (length(notes) between 1 and 500 and notes=btrim(notes,E' \t\n\r\f\013'))),
 authorization_mode text not null check(authorization_mode in ('independent','supervisor_approved','supervisor_direct')),
 policy_version integer not null check(policy_version>0),
 supervisor_override_enabled boolean not null,
 independent_allowance_minor bigint not null check(independent_allowance_minor>=0),
 approval_id uuid unique references public.financial_approvals(id) on delete restrict,
 approver_person_id uuid references public.persons(id) on delete restrict,
 request_key text not null check(length(request_key) between 16 and 128),
 payload_fingerprint text not null check(payload_fingerprint ~ '^[0-9a-f]{64}$'),
 semantic_fingerprint text not null check(semantic_fingerprint ~ '^[0-9a-f]{64}$'),
 prior_matching_refund_id uuid,
 remaining_after_minor bigint not null check(remaining_after_minor>=0),
 foreign key(account_id,school_id,school_location_id,cafeteria_id,purchase_id)
 references public.purchases(account_id,school_id,school_location_id,cafeteria_id,id) on delete restrict,
 foreign key(account_id,school_id,cafeteria_id,original_tender_id,purchase_id,currency_code,tender_type)
 references public.purchase_tenders(account_id,school_id,cafeteria_id,id,purchase_id,currency_code,tender_type) on delete restrict,
 foreign key(account_id,school_id,cafeteria_id,actor_membership_id,actor_person_id,actor_role_code)
 references public.cafeteria_memberships(account_id,school_id,cafeteria_id,id,person_id,role_code) on delete restrict,
 foreign key(account_id,school_id,school_location_id,cafeteria_id,register_id,register_session_id,
 actor_person_id,actor_membership_id,actor_role_code,currency_code)
 references public.register_sessions(account_id,school_id,school_location_id,cafeteria_id,register_id,id,
 operator_person_id,operator_membership_id,operator_role_code,currency_code) on delete restrict,
 unique(purchase_id,refund_ordinal),
 unique(id,purchase_id,semantic_fingerprint),
 foreign key(prior_matching_refund_id,purchase_id,semantic_fingerprint)
 references public.refunds(id,purchase_id,semantic_fingerprint) on delete restrict,
 unique(account_id,actor_person_id,request_key),
 unique(account_id,school_id,cafeteria_id,id,currency_code),
 check(business_date=(occurred_at at time zone business_timezone_snapshot)::date),
 check(reason<>'other' or (notes is not null and length(notes)>=3)),
 check((tender_type='cash' and register_id is not null and register_session_id is not null) or
       (tender_type='student_wallet' and register_id is null and register_session_id is null)),
 check((authorization_mode='supervisor_approved' and approval_id is not null and approver_person_id is not null
        and approver_person_id<>actor_person_id) or
       (authorization_mode in ('independent','supervisor_direct') and approval_id is null and approver_person_id is null)),
 check(authorization_mode<>'independent' or actor_role_code='pos_cashier'),
 check(authorization_mode<>'supervisor_direct' or actor_role_code='pos_supervisor')
);
alter table public.financial_approvals add constraint approval_consumed_refund_fk
 foreign key(consumed_refund_id) references public.refunds(id) on delete restrict deferrable initially deferred;
alter table public.financial_approvals add constraint approval_prior_matching_refund_fk
 foreign key(prior_matching_refund_id,purchase_id,semantic_fingerprint)
 references public.refunds(id,purchase_id,semantic_fingerprint) on delete restrict;
create index refunds_independent_usage on public.refunds(cafeteria_id,actor_person_id,business_date,currency_code)
 include(amount_minor) where authorization_mode='independent';
create index refunds_business_date on public.refunds(cafeteria_id,business_date,refund_ordinal);

create table public.refund_cash_outflows (
 refund_id uuid primary key references public.refunds(id) on delete restrict,
 original_cash_tender_id uuid not null references public.purchase_cash_tenders(tender_id) on delete restrict,
 register_session_id uuid not null references public.register_sessions(id) on delete restrict,
 amount_minor bigint not null check(amount_minor>0),
 currency_code text not null references public.supported_currencies(currency_code) on delete restrict
);
create table public.wallet_refund_credits (
 id uuid primary key default gen_random_uuid(),
 refund_id uuid not null unique,
 account_id uuid not null,
 school_id uuid not null,
 cafeteria_id uuid not null,
 purchase_id uuid not null references public.purchases(id) on delete restrict,
 original_tender_id uuid not null references public.purchase_wallet_tenders(tender_id) on delete restrict,
 original_purchase_debit_id uuid not null references public.wallet_purchase_debits(id) on delete restrict,
 student_id uuid not null,
 wallet_id uuid not null,
 currency_code text not null,
 amount_minor bigint not null check(amount_minor>0),
 actor_person_id uuid not null references public.persons(id) on delete restrict,
 posted_at timestamptz not null,
 foreign key(account_id,school_id,cafeteria_id,refund_id,currency_code)
 references public.refunds(account_id,school_id,cafeteria_id,id,currency_code) on delete restrict,
 foreign key(account_id,school_id,student_id,wallet_id,currency_code)
 references public.student_wallets(account_id,school_id,student_id,id,currency_code) on delete restrict,
 unique(account_id,school_id,wallet_id,currency_code,id)
);
alter table public.wallet_ledger_entries add column refund_credit_id uuid;
alter table public.wallet_ledger_entries drop constraint wallet_ledger_entries_typed_source_check;
alter table public.wallet_ledger_entries add constraint wallet_ledger_entries_typed_source_check check(
 (entry_type='replenishment' and amount_minor>0 and replenishment_id is not null and adjustment_id is null and purchase_debit_id is null and refund_credit_id is null) or
 (entry_type='adjustment' and amount_minor<>0 and adjustment_id is not null and replenishment_id is null and purchase_debit_id is null and refund_credit_id is null) or
 (entry_type='purchase' and amount_minor<0 and purchase_debit_id is not null and replenishment_id is null and adjustment_id is null and refund_credit_id is null) or
 (entry_type='refund' and amount_minor>0 and refund_credit_id is not null and replenishment_id is null and adjustment_id is null and purchase_debit_id is null));
alter table public.wallet_ledger_entries add constraint wallet_ledger_refund_credit_fk
 foreign key(account_id,school_id,wallet_id,currency_code,refund_credit_id)
 references public.wallet_refund_credits(account_id,school_id,wallet_id,currency_code,id) on delete restrict;
create unique index wallet_ledger_refund_credit_unique on public.wallet_ledger_entries(refund_credit_id);
alter table public.student_daily_spend_events add column refund_id uuid references public.refunds(id) on delete restrict;
alter table public.student_daily_spend_events drop constraint student_daily_spend_events_event_type_check;
alter table public.student_daily_spend_events drop constraint student_daily_spend_events_amount_minor_check1;
alter table public.student_daily_spend_events add constraint daily_spend_typed_source check(
 (event_type='purchase' and amount_minor>0 and refund_id is null) or
 (event_type='refund_compensation' and amount_minor<0 and refund_id is not null));
create unique index daily_spend_one_refund on public.student_daily_spend_events(refund_id);

create or replace function pikas_private.assert_wallet_operation_ledger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare matching_entries bigint; expected_amount bigint; expected_ledger_amount bigint; expected_type text;
  actual_amount bigint; actual_type text; entry_wallet uuid; entry_version bigint;
  entry_balance bigint; previous_balance bigint; wallet_balance bigint; wallet_version bigint;
begin
  if tg_table_name='wallet_replenishments' then
    select count(*) into matching_entries from public.wallet_ledger_entries l where l.replenishment_id=new.id;
    expected_amount:=new.amount_minor; expected_ledger_amount:=new.amount_minor; expected_type:='replenishment';
    select l.amount_minor,l.entry_type,l.wallet_id,l.balance_version_after,l.balance_after_minor
      into actual_amount,actual_type,entry_wallet,entry_version,entry_balance
      from public.wallet_ledger_entries l where l.replenishment_id=new.id;
  elsif tg_table_name='wallet_adjustments' then
    select count(*) into matching_entries from public.wallet_ledger_entries l where l.adjustment_id=new.id;
    expected_amount:=new.amount_minor; expected_ledger_amount:=new.amount_minor; expected_type:='adjustment';
    select l.amount_minor,l.entry_type,l.wallet_id,l.balance_version_after,l.balance_after_minor
      into actual_amount,actual_type,entry_wallet,entry_version,entry_balance
      from public.wallet_ledger_entries l where l.adjustment_id=new.id;
  elsif tg_table_name='wallet_purchase_debits' then
    select count(*) into matching_entries from public.wallet_ledger_entries l where l.purchase_debit_id=new.id;
    expected_amount:=new.amount_minor; expected_ledger_amount:=-new.amount_minor; expected_type:='purchase';
    select l.amount_minor,l.entry_type,l.wallet_id,l.balance_version_after,l.balance_after_minor
      into actual_amount,actual_type,entry_wallet,entry_version,entry_balance
      from public.wallet_ledger_entries l where l.purchase_debit_id=new.id;
  elsif tg_table_name='wallet_refund_credits' then
    select count(*) into matching_entries from public.wallet_ledger_entries l where l.refund_credit_id=new.id;
    expected_amount:=new.amount_minor; expected_ledger_amount:=new.amount_minor; expected_type:='refund';
    select l.amount_minor,l.entry_type,l.wallet_id,l.balance_version_after,l.balance_after_minor
      into actual_amount,actual_type,entry_wallet,entry_version,entry_balance
      from public.wallet_ledger_entries l where l.refund_credit_id=new.id;
  else raise exception using errcode='23514',message='unknown_wallet_source';
  end if;
  if matching_entries<>1 then
    raise exception using errcode='23514',message='posted_wallet_operation_requires_exactly_one_ledger_entry';
  end if;
  if actual_type<>expected_type or actual_amount<>expected_ledger_amount then
    raise exception using errcode='23514',message='wallet_ledger_entry_does_not_match_source_operation';
  end if;
  if entry_version=1 then previous_balance:=0;
  else
    select l.balance_after_minor into previous_balance from public.wallet_ledger_entries l
      where l.wallet_id=entry_wallet and l.balance_version_after=entry_version-1;
    if not found then raise exception using errcode='23514',message='wallet_ledger_balance_version_gap'; end if;
  end if;
  if (actual_amount>0 and previous_balance>9223372036854775807-actual_amount)
      or (actual_amount<0 and actual_amount < -previous_balance) then
    raise exception using errcode='23514',message='wallet_ledger_resulting_balance_out_of_range';
  end if;
  if entry_balance<>previous_balance+actual_amount then
    raise exception using errcode='23514',message='wallet_ledger_resulting_balance_mismatch';
  end if;
  select w.current_balance_minor,w.balance_version into wallet_balance,wallet_version
    from public.student_wallets w where w.id=entry_wallet;
  if wallet_version<>entry_version or wallet_balance<>entry_balance then
    select l.balance_after_minor,l.balance_version_after into entry_balance,entry_version
      from public.wallet_ledger_entries l where l.wallet_id=entry_wallet order by l.balance_version_after desc limit 1;
    select w.current_balance_minor,w.balance_version into wallet_balance,wallet_version
      from public.student_wallets w where w.id=entry_wallet;
    if wallet_version is distinct from entry_version or wallet_balance is distinct from entry_balance then
      raise exception using errcode='23514',message='wallet_balance_does_not_match_latest_ledger_entry';
    end if;
  end if;
  return null;
end $$;

create constraint trigger wallet_refund_credit_requires_ledger after insert on public.wallet_refund_credits
 deferrable initially deferred for each row execute function pikas_private.assert_wallet_operation_ledger();

create function pikas_private.require_refund_isolation() returns void
language plpgsql set search_path='' as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then
 raise exception using errcode='25000',message='UNSUPPORTED_TRANSACTION_ISOLATION'; end if;
end $$;
create function pikas_private.refund_hash(value jsonb) returns text
language sql immutable set search_path='' as $$
 select encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex')
$$;
create function pikas_private.normalize_refund_notes(value text) returns text
language sql immutable set search_path='' as $$ select nullif(btrim(value,E' \t\n\r\f\013'),'') $$;
create function pikas_private.refund_semantic(purchase_id uuid,membership_id uuid,person_id uuid,
 amount bigint,currency text,tender text,reason text,notes text,session_id uuid,cafeteria_id uuid) returns text
language sql immutable set search_path='' as $$
 select pikas_private.refund_hash(jsonb_build_object('purchase_id',purchase_id,'membership_id',membership_id,
 'person_id',person_id,'amount_minor',amount::text,'currency',currency,'tender',tender,'reason',reason,
 'notes_hash',pikas_private.refund_hash(coalesce(to_jsonb(notes),'null'::jsonb)),'session_id',session_id,'cafeteria_id',cafeteria_id))
$$;
create function pikas_private.validate_refund_input(amount bigint,reason text,notes text,key text) returns void
language plpgsql set search_path='' as $$
begin
 if amount is null or amount<=0 then raise exception using errcode='22023',message='INVALID_REFUND_AMOUNT'; end if;
 if reason is null or reason not in ('error','wrong_product','unavailable','duplicate','customer_requested','other') then
 raise exception using errcode='22023',message='INVALID_REFUND_REASON'; end if;
 if length(notes)>500 or (reason='other' and (notes is null or length(notes)<3)) then
 raise exception using errcode='22023',message='INVALID_REFUND_NOTES'; end if;
 if key is null or length(key) not between 16 and 128 then
 raise exception using errcode='22023',message='INVALID_REQUEST_KEY'; end if;
end $$;

-- Exact identity/membership protection, shared with current authority writers.
create function pikas_private.lock_refund_member(member_id uuid,p_person_id uuid,purchase public.purchases,cap text)
 returns text language plpgsql security definer set search_path='' as $$
declare role_value text;
begin
 perform 1 from public.persons p where p.id=p_person_id and p.status='active' and p.auth_user_id is not null for share;
 if not found then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 select m.role_code into role_value from public.cafeteria_memberships m
 join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
 where m.id=member_id and m.person_id=p_person_id and m.account_id=purchase.account_id
 and m.school_id=purchase.school_id and m.cafeteria_id=purchase.cafeteria_id and m.status='active'
 and m.role_code in ('pos_cashier','pos_supervisor') and rc.capability=cap for share of m;
 if not found then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 return role_value;
end $$;
create function pikas_private.lock_refund_cash_session(session_id uuid,member_id uuid,actor uuid,purchase public.purchases)
 returns public.register_sessions language plpgsql security definer set search_path='' as $$
declare rs public.register_sessions;
begin
 select * into rs from public.register_sessions s where s.id=session_id;
 if not found or rs.operator_person_id<>actor or rs.operator_membership_id<>member_id
 or rs.cafeteria_id<>purchase.cafeteria_id or rs.currency_code<>purchase.currency_code then
 raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 perform 1 from public.cafeteria_registers r where r.id=rs.register_id and r.status='active' for share;
 if not found then raise exception using errcode='23514',message='REGISTER_INACTIVE'; end if;
 perform 1 from public.cafeteria_register_assignments a where a.id=rs.assignment_id and a.status='active' for share;
 if not found then raise exception using errcode='42501',message='ASSIGNMENT_INACTIVE'; end if;
 select * into rs from public.register_sessions s where s.id=session_id for share;
 if rs.status<>'open' then raise exception using errcode='23514',message='SESSION_CLOSED'; end if;
 return rs;
end $$;

create or replace function pikas_private.guard_student_daily_spend_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.purchases; r public.refunds;
begin
 select * into p from public.purchases where id=new.purchase_id;
 if not found or new.account_id<>p.account_id or new.school_id<>p.school_id or new.cafeteria_id<>p.cafeteria_id
 or new.student_id is distinct from p.student_id or new.currency_code<>p.currency_code or new.business_date<>p.business_date then
 raise exception using errcode='23514',message='daily_spend_event_must_match_original_purchase'; end if;
 if new.event_type='purchase' then
 if new.amount_minor<>p.total_minor then raise exception using errcode='23514',message='purchase_spend_event_must_match_purchase_total'; end if;
 else
 select * into r from public.refunds where id=new.refund_id;
 if not found or r.purchase_id<>p.id or r.business_date<>p.business_date or new.amount_minor<>-r.amount_minor
 or new.occurred_at<>r.occurred_at then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 end if;
 return new;
end $$;

create function pikas_private.guard_refund_insert() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.purchases; used numeric; ordinal numeric; prior_id uuid; semantic_value text;
begin
 perform pikas_private.require_refund_isolation();
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.actor_person_id::text,20261005));
 select * into p from public.purchases where id=new.purchase_id for no key update;
 if not found then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 semantic_value:=pikas_private.refund_semantic(new.purchase_id,new.actor_membership_id,new.actor_person_id,new.amount_minor,
 new.currency_code,new.tender_type,new.reason,new.notes,new.register_session_id,new.cafeteria_id);
 if semantic_value is distinct from new.semantic_fingerprint or new.payload_fingerprint is distinct from
 pikas_private.refund_hash(jsonb_build_object('semantic',semantic_value,'approval_id',new.approval_id)) then
 raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 select r.id into prior_id from public.refunds r where r.purchase_id=p.id and r.semantic_fingerprint=semantic_value order by r.refund_ordinal desc limit 1;
 if prior_id is distinct from new.prior_matching_refund_id then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 select coalesce(sum(amount_minor::numeric),0),coalesce(max(refund_ordinal)::numeric,0)+1
 into used,ordinal from public.refunds where purchase_id=p.id;
 if p.total_minor=0 or used=p.total_minor then raise exception using errcode='23514',message='NOT_REFUNDABLE'; end if;
 if used+new.amount_minor::numeric>p.total_minor then raise exception using errcode='23514',message='REFUND_EXCEEDS_REMAINING'; end if;
 if ordinal>9223372036854775807 then raise exception using errcode='22003',message='REFUND_ORDINAL_EXHAUSTED'; end if;
 if new.refund_ordinal<>ordinal or new.remaining_after_minor::numeric<>p.total_minor-used-new.amount_minor then
 raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 return new;
end $$;
create trigger refunds_insert_guard before insert on public.refunds for each row execute function pikas_private.guard_refund_insert();

create function pikas_private.assert_refund_complete() returns trigger
language plpgsql security definer set search_path='' as $$
declare rid uuid; r public.refunds; p public.purchases; a public.financial_approvals; cash_count bigint; wallet_count bigint; spend_count bigint;
begin
 if tg_table_name='refunds' then rid:=new.id; else rid:=new.refund_id; end if;
 select * into r from public.refunds where id=rid;
 if not found then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 select * into p from public.purchases where id=r.purchase_id;
 select count(*) into cash_count from public.refund_cash_outflows where refund_id=rid;
 select count(*) into wallet_count from public.wallet_refund_credits where refund_id=rid;
 if r.tender_type='cash' then
 if cash_count<>1 or wallet_count<>0 or not exists(select 1 from public.refund_cash_outflows c
 where c.refund_id=rid and c.original_cash_tender_id=r.original_tender_id and c.register_session_id=r.register_session_id
 and c.amount_minor=r.amount_minor and c.currency_code=r.currency_code) then
 raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 else
 if wallet_count<>1 or cash_count<>0 or not exists(select 1 from public.wallet_refund_credits c
 join public.purchase_wallet_tenders t on t.tender_id=c.original_tender_id
 where c.refund_id=rid and c.original_tender_id=r.original_tender_id and c.purchase_id=r.purchase_id
 and c.original_purchase_debit_id=t.wallet_purchase_debit_id and c.wallet_id=t.wallet_id
 and c.student_id=t.student_id and c.student_id=p.student_id and c.currency_code=r.currency_code
 and c.amount_minor=r.amount_minor and c.actor_person_id=r.actor_person_id and c.posted_at=r.occurred_at) then
 raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 end if;
 select count(*) into spend_count from public.student_daily_spend_events where refund_id=rid;
 if p.student_id is not null and r.business_date=p.business_date then
 if spend_count<>1 then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 elsif spend_count<>0 then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 if r.authorization_mode='supervisor_approved' then
 select * into a from public.financial_approvals where id=r.approval_id;
 if not found or a.consumed_refund_id is distinct from rid or a.consumed_at is distinct from r.occurred_at
 or a.semantic_fingerprint<>r.semantic_fingerprint or a.prior_matching_refund_id is distinct from r.prior_matching_refund_id or a.requester_person_id<>r.actor_person_id
 or a.requester_membership_id<>r.actor_membership_id or a.approver_person_id<>r.approver_person_id
 or a.revoked_at is not null or a.purchase_id<>r.purchase_id or a.cafeteria_id<>r.cafeteria_id
 or a.amount_minor<>r.amount_minor or a.currency_code<>r.currency_code or a.tender_type<>r.tender_type or a.reason<>r.reason
 or a.notes_hash<>pikas_private.refund_hash(coalesce(to_jsonb(r.notes),'null'::jsonb))
 or a.register_session_id is distinct from r.register_session_id then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 end if;
 return null;
end $$;
do $$ declare t text; begin
 foreach t in array array['refunds','refund_cash_outflows','wallet_refund_credits'] loop
 execute format('create constraint trigger %I_complete after insert on public.%I deferrable initially deferred for each row execute function pikas_private.assert_refund_complete()',t,t);
 execute format('create trigger %I_immutable before update or delete on public.%I for each row execute function pikas_private.reject_purchase_history_mutation()',t,t);
 end loop;
end $$;
create constraint trigger refund_spend_complete after insert on public.student_daily_spend_events
 deferrable initially deferred for each row when(new.refund_id is not null) execute function pikas_private.assert_refund_complete();

create function pikas_private.guard_financial_approval_transition() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception using errcode='23514',message='approval_history_is_immutable'; end if;
 if (to_jsonb(old)-array['consumed_refund_id','consumed_at','revoked_at','revoked_by_person_id'])
 is distinct from (to_jsonb(new)-array['consumed_refund_id','consumed_at','revoked_at','revoked_by_person_id'])
 or old.consumed_refund_id is not null or old.revoked_at is not null
 or not ((new.consumed_refund_id is not null and new.revoked_at is null) or (new.revoked_at is not null and new.consumed_refund_id is null)) then
 raise exception using errcode='23514',message='invalid_approval_transition'; end if;
 return new;
end $$;
create trigger financial_approval_transition before update or delete on public.financial_approvals
 for each row execute function pikas_private.guard_financial_approval_transition();
create function pikas_private.guard_refund_policy_transition() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or (to_jsonb(old)-array['version','supervisor_override_enabled','daily_independent_refund_allowance_minor','updated_by_person_id','updated_at'])
 is distinct from (to_jsonb(new)-array['version','supervisor_override_enabled','daily_independent_refund_allowance_minor','updated_by_person_id','updated_at'])
 or new.version<>old.version+1 or new.updated_by_person_id is null then
 raise exception using errcode='23514',message='invalid_refund_policy_transition'; end if;
 new.updated_at:=clock_timestamp(); return new;
end $$;
create trigger refund_policy_transition before update or delete on public.cafeteria_refund_policies
 for each row execute function pikas_private.guard_refund_policy_transition();

-- Private DB clock seam. Production always reads PostgreSQL time; no caller override.
create function pikas_private.refund_clock() returns timestamptz
language sql volatile set search_path='' as $$ select pg_catalog.clock_timestamp() $$;
revoke all on function pikas_private.refund_clock() from public,anon,authenticated,service_role;

create function public.configure_cafeteria_refund_policy(p_cafeteria_id uuid,p_expected_version integer,
 p_supervisor_override_enabled boolean,p_daily_independent_refund_allowance_minor bigint) returns integer
language plpgsql security definer set search_path='' as $$
declare scope record; actor uuid; policy public.cafeteria_refund_policies;
begin
 perform pikas_private.require_refund_isolation(); actor:=pikas_private.current_person_id();
 select * into scope from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id);
 if actor is null or not found or not pikas_private.has_capability('cafeteria:refund_policy:configure',scope.account_id,scope.school_id,p_cafeteria_id) then
 raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 if p_supervisor_override_enabled is null or p_daily_independent_refund_allowance_minor is null or p_daily_independent_refund_allowance_minor<0 then
 raise exception using errcode='22023',message='INVALID_REFUND_POLICY'; end if;
 perform 1 from public.persons x where x.id=actor and x.auth_user_id=auth.uid() and x.status='active' for share;
 if not found then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 perform 1 from public.cafeteria_memberships m join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
 where m.person_id=actor and m.account_id=scope.account_id and m.school_id=scope.school_id and m.cafeteria_id=p_cafeteria_id
 and m.role_code='cafeteria_admin' and m.status='active' and rc.capability='cafeteria:refund_policy:configure' for share of m;
 if not found then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 select * into policy from public.cafeteria_refund_policies where cafeteria_id=p_cafeteria_id for update;
 if p_expected_version is null or policy.version<>p_expected_version then
 raise exception using errcode='40001',message='POLICY_VERSION_CONFLICT'; end if;
 if policy.version=2147483647 then raise exception using errcode='22003',message='POLICY_VERSION_EXHAUSTED'; end if;
 update public.cafeteria_refund_policies set version=version+1,supervisor_override_enabled=p_supervisor_override_enabled,
 daily_independent_refund_allowance_minor=p_daily_independent_refund_allowance_minor,updated_by_person_id=actor where cafeteria_id=p_cafeteria_id;
 perform pikas_private.record_wallet_audit(actor,auth.uid(),'cafeteria_admin','cafeteria',scope.account_id,scope.school_id,p_cafeteria_id,
 'refund_policy_changed','cafeteria_refund_policies',p_cafeteria_id,jsonb_build_object('version',policy.version+1,'prior_version',policy.version,
 'supervisor_override_enabled',p_supervisor_override_enabled,'prior_supervisor_override_enabled',policy.supervisor_override_enabled,
 'daily_independent_refund_allowance_minor',p_daily_independent_refund_allowance_minor::text,
 'prior_daily_independent_refund_allowance_minor',policy.daily_independent_refund_allowance_minor::text));
 return policy.version+1;
end $$;

create function public.create_purchase_refund_approval(p_purchase_id uuid,p_amount_minor text,p_reason text,
 p_notes text,p_issuance_request_key text,p_requester_membership_id uuid,p_approver_membership_id uuid,
 p_register_session_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.purchases; t public.purchase_tenders; a public.financial_approvals; actor uuid; requester uuid;
 amount_value bigint; clean_notes text; semantic text; issued timestamptz; role_value text; prior_id uuid;
begin
 perform pikas_private.require_refund_isolation(); actor:=pikas_private.current_person_id();
 if actor is null then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 if p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]*$' then raise exception using errcode='22023',message='INVALID_REFUND_AMOUNT'; end if;
 if length(p_amount_minor)>19 or p_amount_minor::numeric>9223372036854775807 then raise exception using errcode='22003',message='REFUND_AMOUNT_OUT_OF_RANGE'; end if;
 amount_value:=p_amount_minor::bigint; clean_notes:=pikas_private.normalize_refund_notes(p_notes);
 perform pikas_private.validate_refund_input(amount_value,p_reason,clean_notes,p_issuance_request_key);
 select * into p from public.purchases where id=p_purchase_id;
 if not found or not pikas_private.has_capability('cafeteria:pos:refund:approve',p.account_id,p.school_id,p.cafeteria_id) then
 raise exception using errcode='42501',message='PURCHASE_NOT_FOUND_OR_NOT_AUTHORIZED'; end if;
 perform 1 from pikas_private.lock_active_cafeteria_scope(p.cafeteria_id);
 if not found then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p.account_id::text||':'||actor::text||':'||p_issuance_request_key,20261008));
 role_value:=pikas_private.lock_refund_member(p_approver_membership_id,actor,p,'cafeteria:pos:refund:approve');
 if pikas_private.current_person_id() is distinct from actor then raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end if;
 if role_value<>'pos_supervisor' then raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end if;
 select person_id into requester from public.cafeteria_memberships where id=p_requester_membership_id;
 if requester=actor then raise exception using errcode='42501',message='SELF_APPROVAL_NOT_ALLOWED'; end if;
 perform pikas_private.lock_refund_member(p_requester_membership_id,requester,p,'cafeteria:pos:refund:create');
 select * into t from public.purchase_tenders where purchase_id=p.id;
 if (t.tender_type='cash' and p_register_session_id is null) or (t.tender_type='student_wallet' and p_register_session_id is not null) then
 raise exception using errcode='22023',message='APPROVAL_INVALID'; end if;
 semantic:=pikas_private.refund_semantic(p.id,p_requester_membership_id,requester,amount_value,p.currency_code,t.tender_type,p_reason,clean_notes,p_register_session_id,p.cafeteria_id);
 select * into a from public.financial_approvals where account_id=p.account_id and approver_person_id=actor and issuance_request_key=p_issuance_request_key;
 if found then
 if a.semantic_fingerprint<>semantic or a.approver_membership_id<>p_approver_membership_id then
 raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT'; end if;
 else
 if p.total_minor=0 then raise exception using errcode='23514',message='NOT_REFUNDABLE'; end if;
 if amount_value>p.total_minor then raise exception using errcode='23514',message='REFUND_EXCEEDS_REMAINING'; end if;
 -- Issuance reserves no money. Cash session proposal is validated without financial/owner locks;
 -- execution repeats authoritative locked validation.
 if t.tender_type='cash' and not exists(select 1 from public.register_sessions s where s.id=p_register_session_id
 and s.operator_person_id=requester and s.operator_membership_id=p_requester_membership_id and s.cafeteria_id=p.cafeteria_id
 and s.currency_code=p.currency_code and s.status='open') then raise exception using errcode='23514',message='SESSION_CLOSED'; end if;
 select r.id into prior_id from public.refunds r where r.purchase_id=p.id and r.semantic_fingerprint=semantic order by r.refund_ordinal desc limit 1;
 issued:=pikas_private.refund_clock();
 insert into public.financial_approvals(account_id,school_id,cafeteria_id,purchase_id,currency_code,tender_type,
 requester_person_id,requester_membership_id,approver_person_id,approver_membership_id,amount_minor,reason,notes_hash,
 register_session_id,semantic_fingerprint,prior_matching_refund_id,issuance_request_key,issued_at,expires_at)
 values(p.account_id,p.school_id,p.cafeteria_id,p.id,p.currency_code,t.tender_type,requester,p_requester_membership_id,
 actor,p_approver_membership_id,amount_value,p_reason,pikas_private.refund_hash(coalesce(to_jsonb(clean_notes),'null'::jsonb)),
 p_register_session_id,semantic,prior_id,p_issuance_request_key,issued,issued+interval '10 minutes') returning * into a;
 perform pikas_private.record_wallet_audit(actor,auth.uid(),role_value,'cafeteria',p.account_id,p.school_id,p.cafeteria_id,
 'refund_approval_issued','financial_approvals',a.id,'{}');
 end if;
 return jsonb_build_object('approval_id',a.id,'purchase_id',a.purchase_id,'amount_minor',a.amount_minor::text,
 'issued_at',a.issued_at,'expires_at',a.expires_at,'requester_membership_id',a.requester_membership_id);
end $$;

create function public.revoke_financial_approval(p_approval_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; a public.financial_approvals; p public.purchases;
begin
 perform pikas_private.require_refund_isolation(); actor:=pikas_private.current_person_id();
 select * into a from public.financial_approvals where id=p_approval_id;
 if actor is null or not found or a.approver_person_id<>actor then raise exception using errcode='42501',message='APPROVAL_INVALID'; end if;
 select * into p from public.purchases where id=a.purchase_id;
 perform 1 from pikas_private.lock_active_cafeteria_scope(a.cafeteria_id);
 if not found then raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end if;
 perform pikas_private.lock_refund_member(a.approver_membership_id,actor,p,'cafeteria:pos:refund:approve');
 if pikas_private.current_person_id() is distinct from actor then raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end if;
 select * into a from public.financial_approvals where id=p_approval_id for update;
 if a.consumed_refund_id is not null then raise exception using errcode='23514',message='APPROVAL_ALREADY_USED'; end if;
 if a.revoked_at is null then
 if a.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='APPROVAL_EXPIRED'; end if;
 update public.financial_approvals set revoked_at=clock_timestamp(),revoked_by_person_id=actor where id=a.id returning * into a;
 perform pikas_private.record_wallet_audit(actor,auth.uid(),'pos_supervisor','cafeteria',a.account_id,a.school_id,a.cafeteria_id,
 'refund_approval_revoked','financial_approvals',a.id,'{}');
 end if;
 return jsonb_build_object('approval_id',a.id,'revoked_at',a.revoked_at);
end $$;

create function pikas_private.refund_result(r public.refunds) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('refund_id',r.id,'purchase_id',r.purchase_id,'refund_ordinal',r.refund_ordinal::text,
 'amount_minor',r.amount_minor::text,'currency_code',r.currency_code,'tender_type',r.tender_type,
 'occurred_at',r.occurred_at,'business_date',r.business_date,'business_timezone',r.business_timezone_snapshot,
 'purchase_number',(select p.purchase_number::text from public.purchases p where p.id=r.purchase_id),
 'approval_used',r.approval_id is not null,'reason',r.reason,'notes',r.notes,'authorization_mode',r.authorization_mode,'approval_id',r.approval_id,
 'remaining_after_minor',r.remaining_after_minor::text)
$$;

create function public.create_purchase_refund(p_purchase_id uuid,p_amount_minor text,p_reason text,p_notes text,
 p_request_key text,p_operational_membership_id uuid,p_register_session_id uuid default null,p_approval_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.purchases; t public.purchase_tenders; r public.refunds; existing public.refunds;
 actor uuid; amount_value bigint; clean_notes text; semantic text; fingerprint text; role_value text; scope record;
 rs public.register_sessions; policy public.cafeteria_refund_policies; approval public.financial_approvals;
 wt public.purchase_wallet_tenders; wallet public.student_wallets; credit uuid; occurred timestamptz; day_value date;
 used numeric; refunded numeric; ordinal numeric; mode_value text; new_balance bigint; new_version bigint; setting_currency text; prior_id uuid;
begin
 perform pikas_private.require_refund_isolation(); actor:=pikas_private.current_person_id();
 if actor is null then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 if p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]*$' then raise exception using errcode='22023',message='INVALID_REFUND_AMOUNT'; end if;
 if length(p_amount_minor)>19 or p_amount_minor::numeric>9223372036854775807 then raise exception using errcode='22003',message='REFUND_AMOUNT_OUT_OF_RANGE'; end if;
 amount_value:=p_amount_minor::bigint; clean_notes:=pikas_private.normalize_refund_notes(p_notes);
 perform pikas_private.validate_refund_input(amount_value,p_reason,clean_notes,p_request_key);
 select * into p from public.purchases where id=p_purchase_id;
 if not found or not pikas_private.has_capability('cafeteria:pos:refund:create',p.account_id,p.school_id,p.cafeteria_id) then
 raise exception using errcode='42501',message='PURCHASE_NOT_FOUND_OR_NOT_AUTHORIZED'; end if;
 select * into scope from pikas_private.lock_active_cafeteria_scope(p.cafeteria_id);
 if not found then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p.account_id::text||':'||actor::text||':'||p_request_key,20261007));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261005));
 role_value:=pikas_private.lock_refund_member(p_operational_membership_id,actor,p,'cafeteria:pos:refund:create');
 if pikas_private.current_person_id() is distinct from actor then raise exception using errcode='42501',message='REFUND_NOT_AUTHORIZED'; end if;
 select * into t from public.purchase_tenders where purchase_id=p.id;
 if (t.tender_type='cash' and p_register_session_id is null) or (t.tender_type='student_wallet' and p_register_session_id is not null) then
 raise exception using errcode='22023',message='INVALID_REFUND_SESSION'; end if;
 semantic:=pikas_private.refund_semantic(p.id,p_operational_membership_id,actor,amount_value,p.currency_code,t.tender_type,p_reason,clean_notes,p_register_session_id,p.cafeteria_id);
 fingerprint:=pikas_private.refund_hash(jsonb_build_object('semantic',semantic,'approval_id',p_approval_id));
 select * into existing from public.refunds where account_id=p.account_id and actor_person_id=actor and request_key=p_request_key;
 if found then
 perform pikas_private.lock_refund_member(existing.actor_membership_id,actor,p,'cafeteria:pos:refund:create');
 if existing.payload_fingerprint<>fingerprint then raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT'; end if;
 return pikas_private.refund_result(existing);
 end if;
 if t.tender_type='cash' then rs:=pikas_private.lock_refund_cash_session(p_register_session_id,p_operational_membership_id,actor,p); end if;
 select catalog_currency_code into setting_currency from public.cafeteria_operation_settings where cafeteria_id=p.cafeteria_id for share;
 if setting_currency is distinct from p.currency_code then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 select * into policy from public.cafeteria_refund_policies where cafeteria_id=p.cafeteria_id for share;
 if not found or policy.currency_code<>p.currency_code then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 perform 1 from public.supported_currencies where currency_code=p.currency_code and status='enabled' for share;
 if not found then raise exception using errcode='23514',message='CURRENCY_DISABLED'; end if;
 select * into p from public.purchases where id=p.id for no key update;
 if p_approval_id is not null then
 -- No approver owner advisory: compatible with sorted exceptional-close owner locks.
 select * into approval from public.financial_approvals where id=p_approval_id;
 if not found or approval.semantic_fingerprint<>semantic then raise exception using errcode='23514',message='APPROVAL_INVALID'; end if;
 if approval.approver_person_id=actor then raise exception using errcode='42501',message='SELF_APPROVAL_NOT_ALLOWED'; end if;
 begin
 if pikas_private.lock_refund_member(approval.approver_membership_id,approval.approver_person_id,p,'cafeteria:pos:refund:approve')<>'pos_supervisor' then
 raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end if;
 exception when insufficient_privilege then raise exception using errcode='42501',message='APPROVER_NOT_AUTHORIZED'; end;
 select * into approval from public.financial_approvals where id=p_approval_id for update;
 end if;
 if p.student_id is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p.student_id::text,0)); end if;
 if t.tender_type='student_wallet' then
 select * into wt from public.purchase_wallet_tenders where tender_id=t.id;
 select * into wallet from public.student_wallets where id=wt.wallet_id for update;
 if not found or wallet.student_id<>p.student_id or wallet.currency_code<>p.currency_code then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 if wallet.current_balance_minor::numeric+amount_value>9223372036854775807 then raise exception using errcode='22003',message='WALLET_BALANCE_OVERFLOW'; end if;
 if wallet.balance_version=9223372036854775807 then raise exception using errcode='22003',message='WALLET_VERSION_EXHAUSTED'; end if;
 new_balance:=wallet.current_balance_minor+amount_value; new_version:=wallet.balance_version+1;
 end if;
 occurred:=pikas_private.refund_clock(); day_value:=(occurred at time zone scope.business_timezone)::date;
 select r0.id into prior_id from public.refunds r0 where r0.purchase_id=p.id and r0.semantic_fingerprint=semantic order by r0.refund_ordinal desc limit 1;
 select coalesce(sum(amount_minor::numeric),0),coalesce(max(refund_ordinal)::numeric,0)+1 into refunded,ordinal from public.refunds where purchase_id=p.id;
 if p.total_minor=0 or refunded=p.total_minor then raise exception using errcode='23514',message='NOT_REFUNDABLE'; end if;
 if refunded+amount_value>p.total_minor then raise exception using errcode='23514',message='REFUND_EXCEEDS_REMAINING'; end if;
 if ordinal>9223372036854775807 then raise exception using errcode='22003',message='REFUND_ORDINAL_EXHAUSTED'; end if;
 if p_approval_id is not null then
 if approval.consumed_refund_id is not null then raise exception using errcode='23514',message='APPROVAL_ALREADY_USED'; end if;
 if approval.prior_matching_refund_id is distinct from prior_id then raise exception using errcode='23514',message='APPROVAL_INVALID'; end if;
 if approval.revoked_at is not null then raise exception using errcode='23514',message='APPROVAL_INVALID'; end if;
 if approval.expires_at<=occurred then raise exception using errcode='23514',message='APPROVAL_EXPIRED'; end if;
 mode_value:='supervisor_approved';
 elsif role_value='pos_supervisor' and exists(select 1 from pikas_private.role_capabilities
 where scope_kind='cafeteria' and role_code=role_value and capability='cafeteria:pos:refund:direct') then mode_value:='supervisor_direct';
 elsif role_value='pos_supervisor' then
 raise exception using errcode='42501',message='REFUND_APPROVAL_REQUIRED';
 else
 mode_value:='independent';
 select coalesce(sum(amount_minor::numeric),0) into used from public.refunds where cafeteria_id=p.cafeteria_id
 and actor_person_id=actor and business_date=day_value and currency_code=p.currency_code and authorization_mode='independent';
 if policy.supervisor_override_enabled and used+amount_value>policy.daily_independent_refund_allowance_minor then
 raise exception using errcode='42501',message='REFUND_APPROVAL_REQUIRED'; end if;
 end if;
 insert into public.refunds(account_id,school_id,school_location_id,cafeteria_id,purchase_id,refund_ordinal,original_tender_id,
 tender_type,currency_code,amount_minor,actor_person_id,actor_membership_id,actor_role_code,register_id,register_session_id,
 occurred_at,business_timezone_snapshot,business_date,reason,notes,authorization_mode,policy_version,supervisor_override_enabled,
 independent_allowance_minor,approval_id,approver_person_id,request_key,payload_fingerprint,semantic_fingerprint,prior_matching_refund_id,remaining_after_minor)
 values(p.account_id,p.school_id,p.school_location_id,p.cafeteria_id,p.id,ordinal::bigint,t.id,t.tender_type,p.currency_code,
 amount_value,actor,p_operational_membership_id,role_value,rs.register_id,p_register_session_id,occurred,scope.business_timezone,
 day_value,p_reason,clean_notes,mode_value,policy.version,policy.supervisor_override_enabled,policy.daily_independent_refund_allowance_minor,
 p_approval_id,approval.approver_person_id,p_request_key,fingerprint,semantic,prior_id,(p.total_minor-refunded-amount_value)::bigint) returning * into r;
 if t.tender_type='cash' then
 insert into public.refund_cash_outflows values(r.id,t.id,p_register_session_id,amount_value,p.currency_code);
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
 'refund_committed','refunds',r.id,jsonb_build_object('authorization_mode',mode_value,'approval_id',p_approval_id));
 return pikas_private.refund_result(r);
end $$;

create function pikas_private.assert_approval_consumption() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.consumed_refund_id is not null and not exists(select 1 from public.refunds r where r.id=new.consumed_refund_id
 and r.approval_id=new.id and r.semantic_fingerprint=new.semantic_fingerprint and r.prior_matching_refund_id is not distinct from new.prior_matching_refund_id and r.occurred_at=new.consumed_at
 and r.authorization_mode='supervisor_approved' and r.actor_person_id=new.requester_person_id
 and r.actor_membership_id=new.requester_membership_id and r.approver_person_id=new.approver_person_id) then
 raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 return null;
end $$;
create constraint trigger financial_approval_consumption_complete after insert or update on public.financial_approvals
 deferrable initially deferred for each row execute function pikas_private.assert_approval_consumption();
revoke all on function pikas_private.assert_approval_consumption() from public,anon,authenticated,service_role;

create function pikas_private.can_read_refund(a uuid,s uuid,c uuid,actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select pikas_private.has_capability('cafeteria:pos:refunds:read',a,s,c) or
 (actor=pikas_private.current_person_id() and pikas_private.has_capability('cafeteria:pos:refunds:read_own',a,s,c))
$$;
do $$ declare t text; begin
 foreach t in array array['refunds','refund_cash_outflows','wallet_refund_credits','financial_approvals','cafeteria_refund_policies'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create trigger %I_no_truncate before truncate on public.%I for each statement execute function pikas_private.reject_purchase_history_mutation()',t,t);
 end loop;
end $$;
create policy refunds_read on public.refunds for select to authenticated using
 (pikas_private.can_read_refund(account_id,school_id,cafeteria_id,actor_person_id));
create policy refund_cash_read on public.refund_cash_outflows for select to authenticated using
 (exists(select 1 from public.refunds r where r.id=refund_id and pikas_private.can_read_refund(r.account_id,r.school_id,r.cafeteria_id,r.actor_person_id)));
create policy wallet_refund_read on public.wallet_refund_credits for select to authenticated using
 (exists(select 1 from public.refunds r where r.id=refund_id and pikas_private.can_read_refund(r.account_id,r.school_id,r.cafeteria_id,r.actor_person_id)));
create policy financial_approval_read on public.financial_approvals for select to authenticated using
 ((approver_person_id=pikas_private.current_person_id() and pikas_private.is_pos_operator_membership(approver_membership_id,approver_person_id,
 account_id,school_id,cafeteria_id,'cafeteria:pos:refund:approve')) or
 (requester_person_id=pikas_private.current_person_id() and pikas_private.is_pos_operator_membership(requester_membership_id,requester_person_id,
 account_id,school_id,cafeteria_id,'cafeteria:pos:refund:create')));
create policy refund_policy_read on public.cafeteria_refund_policies for select to authenticated using
 (pikas_private.has_capability('cafeteria:refund_policy:configure',account_id,school_id,cafeteria_id) or
 pikas_private.has_capability('cafeteria:pos:refund:create',account_id,school_id,cafeteria_id) or
 pikas_private.has_capability('cafeteria:pos:refunds:read',account_id,school_id,cafeteria_id));

create function public.get_purchase_refundability(p_purchase_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.purchases; t public.purchase_tenders; total_refunded numeric;
begin
 select * into p from public.purchases where id=p_purchase_id;
 if not found or not pikas_private.has_capability('cafeteria:pos:refund:create',p.account_id,p.school_id,p.cafeteria_id) then
 raise exception using errcode='42501',message='PURCHASE_NOT_FOUND_OR_NOT_AUTHORIZED'; end if;
 select * into t from public.purchase_tenders where purchase_id=p.id;
 select coalesce(sum(amount_minor::numeric),0) into total_refunded from public.refunds where purchase_id=p.id;
 return jsonb_build_object('purchase_id',p.id,'purchase_number',p.purchase_number::text,'total_minor',p.total_minor::text,
 'currency_code',p.currency_code,'tender_type',t.tender_type,'business_date',p.business_date,
 'remaining_refundable_minor',(p.total_minor-total_refunded)::text);
end $$;

-- Explicit ACLs for every newly introduced function; no private mutation surface.
revoke all on function public.configure_cafeteria_refund_policy(uuid,integer,boolean,bigint),
 public.create_purchase_refund_approval(uuid,text,text,text,text,uuid,uuid,uuid),
 public.revoke_financial_approval(uuid),public.create_purchase_refund(uuid,text,text,text,text,uuid,uuid,uuid),
 public.get_purchase_refundability(uuid) from public,anon,authenticated,service_role;
grant execute on function public.configure_cafeteria_refund_policy(uuid,integer,boolean,bigint),
 public.create_purchase_refund_approval(uuid,text,text,text,text,uuid,uuid,uuid),
 public.revoke_financial_approval(uuid),public.create_purchase_refund(uuid,text,text,text,text,uuid,uuid,uuid),
 public.get_purchase_refundability(uuid) to authenticated;
revoke all on function pikas_private.initialize_refund_policy(),pikas_private.require_refund_isolation(),
 pikas_private.refund_hash(jsonb),pikas_private.normalize_refund_notes(text),
 pikas_private.refund_semantic(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid),
 pikas_private.validate_refund_input(bigint,text,text,text),
 pikas_private.lock_refund_member(uuid,uuid,public.purchases,text),
 pikas_private.lock_refund_cash_session(uuid,uuid,uuid,public.purchases),
 pikas_private.guard_refund_insert(),pikas_private.assert_refund_complete(),
 pikas_private.guard_financial_approval_transition(),pikas_private.guard_refund_policy_transition(),
 pikas_private.refund_result(public.refunds),pikas_private.can_read_refund(uuid,uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function pikas_private.can_read_refund(uuid,uuid,uuid,uuid) to authenticated;
commit;
