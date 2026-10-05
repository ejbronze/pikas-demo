-- Phase 3B: authoritative purchases, one tender, wallet debits, and daily spending.
begin;

insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values
  ('cafeteria','pos_cashier','cafeteria:pos:purchase:create'),
  ('cafeteria','pos_supervisor','cafeteria:pos:purchase:create'),
  ('cafeteria','pos_cashier','cafeteria:pos:purchases:read_own'),
  ('cafeteria','pos_supervisor','cafeteria:pos:purchases:read'),
  ('cafeteria','cafeteria_admin','cafeteria:pos:purchases:read'),
  ('school','school_admin','school:spending_controls:manage');

alter table public.cafeterias add constraint cafeterias_purchase_tenant_key
  unique(account_id,school_id,school_location_id,id);
alter table public.cafeteria_customers add constraint cafeteria_customers_purchase_type_key
  unique(account_id,school_id,cafeteria_id,id,student_id,staff_affiliation_id);
alter table public.student_wallets add constraint student_wallets_purchase_identity_key
  unique(account_id,school_id,student_id,id,currency_code);
alter table public.register_sessions add constraint register_sessions_purchase_scope_key
  unique(account_id,school_id,school_location_id,cafeteria_id,register_id,id,
    operator_person_id,operator_membership_id,operator_role_code,currency_code);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  school_location_id uuid not null,
  cafeteria_id uuid not null,
  purchase_number bigint not null check (purchase_number>0),
  register_id uuid not null,
  register_session_id uuid not null,
  operator_person_id uuid not null references public.persons(id) on delete restrict,
  operator_membership_id uuid not null,
  operator_role_code text not null check (operator_role_code in ('pos_cashier','pos_supervisor')),
  cafeteria_customer_id uuid,
  customer_type_snapshot text check (customer_type_snapshot is null or customer_type_snapshot in ('student','staff')),
  customer_display_name_snapshot text check (customer_display_name_snapshot is null or length(btrim(customer_display_name_snapshot)) between 1 and 200),
  student_id uuid,
  staff_affiliation_id uuid,
  business_timezone_snapshot text not null,
  business_date date not null,
  purchased_at timestamptz not null,
  currency_code text not null references public.supported_currencies(currency_code) on delete restrict,
  total_minor bigint not null check (total_minor>=0),
  service_shift_id uuid,
  service_shift_name_snapshot text,
  menu_id uuid,
  menu_name_snapshot text,
  request_key text not null check (length(request_key) between 16 and 128),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (account_id,school_id,school_location_id,cafeteria_id)
    references public.cafeterias(account_id,school_id,school_location_id,id) on delete restrict,
  foreign key (account_id,school_id,school_location_id,cafeteria_id,register_id)
    references public.cafeteria_registers(account_id,school_id,school_location_id,cafeteria_id,id) on delete restrict,
  foreign key (account_id,school_id,school_location_id,cafeteria_id,register_id,register_session_id,
    operator_person_id,operator_membership_id,operator_role_code,currency_code)
    references public.register_sessions(account_id,school_id,school_location_id,cafeteria_id,register_id,id,
      operator_person_id,operator_membership_id,operator_role_code,currency_code) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,operator_membership_id,operator_person_id,operator_role_code)
    references public.cafeteria_memberships(account_id,school_id,cafeteria_id,id,person_id,role_code) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,cafeteria_customer_id)
    references public.cafeteria_customers(account_id,school_id,cafeteria_id,id) on delete restrict,
  foreign key (account_id,school_id,student_id) references public.students(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,staff_affiliation_id)
    references public.school_staff_affiliations(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,service_shift_id)
    references public.cafeteria_service_shifts(account_id,school_id,cafeteria_id,id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,menu_id)
    references public.cafeteria_menus(account_id,school_id,cafeteria_id,id) on delete restrict,
  unique (account_id,request_key),
  unique (cafeteria_id,purchase_number),
  unique (account_id,school_id,school_location_id,cafeteria_id,id),
  unique (account_id,school_id,cafeteria_id,id,currency_code),
  unique (account_id,school_id,cafeteria_id,id,student_id,currency_code),
  unique (account_id,school_id,cafeteria_id,id,operator_person_id),
  check (business_date=(purchased_at at time zone business_timezone_snapshot)::date),
  check ((cafeteria_customer_id is null and customer_type_snapshot is null
      and customer_display_name_snapshot is null and student_id is null and staff_affiliation_id is null)
    or (cafeteria_customer_id is not null and customer_type_snapshot is not distinct from 'student'
      and customer_display_name_snapshot is not null and student_id is not null and staff_affiliation_id is null)
    or (cafeteria_customer_id is not null and customer_type_snapshot is not distinct from 'staff'
      and customer_display_name_snapshot is not null and student_id is null and staff_affiliation_id is not null)),
  check ((service_shift_id is null and menu_id is null and service_shift_name_snapshot is null and menu_name_snapshot is null)
    or (service_shift_id is not null and menu_id is not null
      and service_shift_name_snapshot is not null and menu_name_snapshot is not null
      and length(btrim(service_shift_name_snapshot)) between 1 and 120
      and length(btrim(menu_name_snapshot)) between 1 and 120))
);
create index purchases_operator_time_idx on public.purchases(account_id,school_id,cafeteria_id,operator_person_id,purchased_at desc,id);
create index purchases_customer_time_idx on public.purchases(account_id,school_id,student_id,purchased_at desc,id) where student_id is not null;
create index purchases_cafeteria_time_idx on public.purchases(account_id,school_id,cafeteria_id,purchased_at desc,id);
create index purchases_business_date_idx on public.purchases(account_id,school_id,student_id,business_date,currency_code) where student_id is not null;

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  school_location_id uuid not null,
  cafeteria_id uuid not null,
  purchase_id uuid not null,
  line_number smallint not null check (line_number>0),
  product_id uuid not null,
  product_name_snapshot text not null check (length(btrim(product_name_snapshot)) between 1 and 120),
  product_version_snapshot integer not null check (product_version_snapshot>0),
  unit_price_minor bigint not null check (unit_price_minor>=0),
  quantity integer not null check (quantity between 1 and 20),
  line_total_minor bigint not null check (line_total_minor>=0),
  created_at timestamptz not null default now(),
  foreign key (account_id,school_id,school_location_id,cafeteria_id,purchase_id)
    references public.purchases(account_id,school_id,school_location_id,cafeteria_id,id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,product_id)
    references public.cafeteria_products(account_id,school_id,cafeteria_id,id) on delete restrict,
  unique (purchase_id,line_number),
  unique (purchase_id,product_id),
  check (line_total_minor::numeric=unit_price_minor::numeric*quantity::numeric)
);
create index purchase_items_product_idx on public.purchase_items(account_id,school_id,cafeteria_id,product_id,purchase_id);

create table public.purchase_tenders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  purchase_id uuid not null unique,
  currency_code text not null,
  tender_type text not null check (tender_type in ('cash','student_wallet')),
  created_at timestamptz not null default now(),
  foreign key (account_id,school_id,cafeteria_id,purchase_id,currency_code)
    references public.purchases(account_id,school_id,cafeteria_id,id,currency_code) on delete restrict,
  unique (account_id,school_id,cafeteria_id,id,purchase_id,currency_code,tender_type)
);

create table public.purchase_cash_tenders (
  tender_id uuid primary key references public.purchase_tenders(id) on delete restrict,
  cash_received_minor bigint not null check (cash_received_minor>=0),
  change_due_minor bigint not null check (change_due_minor>=0),
  created_at timestamptz not null default now()
);

create table public.wallet_purchase_debits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  student_id uuid not null,
  wallet_id uuid not null,
  currency_code text not null,
  purchase_id uuid not null unique,
  amount_minor bigint not null check (amount_minor>0),
  actor_person_id uuid not null references public.persons(id) on delete restrict,
  posted_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (account_id,school_id,student_id,wallet_id,currency_code)
    references public.student_wallets(account_id,school_id,student_id,id,currency_code) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,purchase_id,student_id,currency_code)
    references public.purchases(account_id,school_id,cafeteria_id,id,student_id,currency_code) on delete restrict,
  unique (account_id,school_id,wallet_id,currency_code,id)
);
create index wallet_purchase_debits_wallet_time_idx on public.wallet_purchase_debits(account_id,school_id,wallet_id,posted_at,id);

create table public.purchase_wallet_tenders (
  tender_id uuid primary key references public.purchase_tenders(id) on delete restrict,
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  purchase_id uuid not null,
  student_id uuid not null,
  wallet_id uuid not null,
  currency_code text not null,
  tender_type text generated always as ('student_wallet'::text) stored,
  wallet_purchase_debit_id uuid not null unique,
  created_at timestamptz not null default now(),
  foreign key (account_id,school_id,cafeteria_id,tender_id,purchase_id,currency_code,tender_type)
    references public.purchase_tenders(account_id,school_id,cafeteria_id,id,purchase_id,currency_code,tender_type) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,purchase_id,student_id,currency_code)
    references public.purchases(account_id,school_id,cafeteria_id,id,student_id,currency_code) on delete restrict,
  foreign key (account_id,school_id,student_id,wallet_id,currency_code)
    references public.student_wallets(account_id,school_id,student_id,id,currency_code) on delete restrict,
  foreign key (account_id,school_id,wallet_id,currency_code,wallet_purchase_debit_id)
    references public.wallet_purchase_debits(account_id,school_id,wallet_id,currency_code,id) on delete restrict
);

create table public.student_spending_controls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  student_id uuid not null,
  currency_code text not null references public.supported_currencies(currency_code) on delete restrict,
  daily_limit_enabled boolean not null default true,
  daily_limit_minor bigint not null check (daily_limit_minor>=0),
  per_transaction_limit_enabled boolean not null default false,
  per_transaction_limit_minor bigint not null default 0 check (per_transaction_limit_minor>=0),
  version integer not null default 1 check (version>0),
  updated_by_person_id uuid not null references public.persons(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,student_id) references public.students(account_id,school_id,id) on delete restrict,
  unique (student_id,currency_code),
  unique (account_id,school_id,student_id,currency_code,id)
);
create index student_spending_controls_school_idx on public.student_spending_controls(account_id,school_id,student_id,currency_code);

create table public.student_daily_spend_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  student_id uuid not null,
  business_date date not null,
  currency_code text not null references public.supported_currencies(currency_code) on delete restrict,
  purchase_id uuid not null,
  amount_minor bigint not null check (amount_minor<>0),
  event_type text not null default 'purchase' check (event_type='purchase'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (account_id,school_id,student_id) references public.students(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,purchase_id,student_id,currency_code)
    references public.purchases(account_id,school_id,cafeteria_id,id,student_id,currency_code) on delete restrict,
  check (amount_minor>0)
);
create index student_daily_spend_lookup_idx on public.student_daily_spend_events(account_id,school_id,student_id,business_date,currency_code);
create unique index student_daily_spend_one_purchase_event on public.student_daily_spend_events(purchase_id)
  where event_type='purchase';
create function pikas_private.guard_student_daily_spend_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare source_purchase public.purchases%rowtype;
begin
  select p.* into source_purchase from public.purchases p where p.id=new.purchase_id
    and p.account_id=new.account_id and p.school_id=new.school_id and p.cafeteria_id=new.cafeteria_id
    and p.student_id=new.student_id and p.currency_code=new.currency_code;
  if not found or new.business_date<>source_purchase.business_date then
    raise exception using errcode='23514',message='daily_spend_event_must_match_original_purchase';
  end if;
  if new.event_type='purchase' and new.amount_minor<>source_purchase.total_minor then
    raise exception using errcode='23514',message='purchase_spend_event_must_match_purchase_total';
  end if;
  return new;
end $$;
create trigger student_daily_spend_event_guard before insert on public.student_daily_spend_events
for each row execute function pikas_private.guard_student_daily_spend_event();

create table public.cafeteria_purchase_counters (
  account_id uuid not null,
  school_id uuid not null,
  school_location_id uuid not null,
  cafeteria_id uuid primary key,
  last_purchase_number bigint not null default 0 check (last_purchase_number>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,school_location_id,cafeteria_id)
    references public.cafeterias(account_id,school_id,school_location_id,id) on delete restrict,
  unique (account_id,school_id,school_location_id,cafeteria_id)
);

alter table public.wallet_ledger_entries add column purchase_debit_id uuid;
alter table public.wallet_ledger_entries drop constraint wallet_ledger_entries_check;
alter table public.wallet_ledger_entries drop constraint wallet_ledger_entries_entry_type_check;
alter table public.wallet_ledger_entries add constraint wallet_ledger_entries_typed_source_check
  check ((entry_type='replenishment' and amount_minor>0 and replenishment_id is not null and adjustment_id is null and purchase_debit_id is null)
      or (entry_type='adjustment' and amount_minor<>0 and adjustment_id is not null and replenishment_id is null and purchase_debit_id is null)
      or (entry_type='purchase' and amount_minor<0 and purchase_debit_id is not null and replenishment_id is null and adjustment_id is null));
alter table public.wallet_ledger_entries add constraint wallet_ledger_purchase_debit_fk
  foreign key (account_id,school_id,wallet_id,currency_code,purchase_debit_id)
  references public.wallet_purchase_debits(account_id,school_id,wallet_id,currency_code,id) on delete restrict;
create unique index wallet_ledger_purchase_debit_unique on public.wallet_ledger_entries(purchase_debit_id);

create function pikas_private.ensure_purchase_counter() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.cafeteria_purchase_counters(account_id,school_id,school_location_id,cafeteria_id)
  values(new.account_id,new.school_id,new.school_location_id,new.id) on conflict(cafeteria_id) do nothing;
  return new;
end $$;
create trigger cafeteria_purchase_counter_init after insert on public.cafeterias
for each row execute function pikas_private.ensure_purchase_counter();
insert into public.cafeteria_purchase_counters(account_id,school_id,school_location_id,cafeteria_id)
select account_id,school_id,school_location_id,id from public.cafeterias
on conflict(cafeteria_id) do nothing;

create function pikas_private.lock_purchase_schedule_writer() returns trigger
language plpgsql set search_path = '' as $$
declare target_cafeteria uuid;
begin
  target_cafeteria:=case when tg_op='DELETE' then old.cafeteria_id else new.cafeteria_id end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_cafeteria::text,20261004));
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger phase3b_menu_write_lock before insert or update or delete on public.cafeteria_menus
for each row execute function pikas_private.lock_purchase_schedule_writer();
create trigger phase3b_menu_products_write_lock before insert or update or delete on public.cafeteria_menu_products
for each row execute function pikas_private.lock_purchase_schedule_writer();
create trigger phase3b_service_shifts_write_lock before insert or update or delete on public.cafeteria_service_shifts
for each row execute function pikas_private.lock_purchase_schedule_writer();
create trigger phase3b_service_shift_days_write_lock before insert or update or delete on public.cafeteria_service_shift_days
for each row execute function pikas_private.lock_purchase_schedule_writer();

create function public.set_student_spending_control(p_student_id uuid,p_currency_code text,p_expected_version integer,
  p_daily_limit_enabled boolean,p_daily_limit_minor bigint,p_per_transaction_limit_enabled boolean,
  p_per_transaction_limit_minor bigint)
returns table(control_id uuid,version integer)
language plpgsql security definer set search_path = '' as $$
declare actor uuid; a uuid; s uuid; control public.student_spending_controls%rowtype; new_version integer;
begin
  actor:=pikas_private.current_person_id();
  if actor is null then raise exception using errcode='42501',message='not_authorized'; end if;
  select st.account_id,st.school_id into a,s from public.students st where st.id=p_student_id;
  if not found or not pikas_private.has_capability('school:spending_controls:manage',a,s) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_currency_code is null or p_daily_limit_enabled is null or p_daily_limit_minor is null
      or p_daily_limit_minor<0 or p_per_transaction_limit_enabled is null
      or p_per_transaction_limit_minor is null or p_per_transaction_limit_minor<0 then
    raise exception using errcode='22023',message='invalid_spending_control';
  end if;
  if not exists(select 1 from public.supported_currencies cu where cu.currency_code=p_currency_code and cu.status='enabled') then
    raise exception using errcode='22023',message='unsupported_spending_currency';
  end if;
  perform 1 from public.students st where st.id=p_student_id and st.account_id=a and st.school_id=s
    and st.status='active' for share;
  if not found then raise exception using errcode='23514',message='active_student_required_for_spending_control'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_student_id::text,0));
  select sc.* into control from public.student_spending_controls sc
    where sc.student_id=p_student_id and sc.currency_code=p_currency_code for update;
  if not found then
    if p_expected_version is distinct from 0 then raise exception using errcode='40001',message='stale_spending_control_version'; end if;
    insert into public.student_spending_controls as inserted(account_id,school_id,student_id,currency_code,
      daily_limit_enabled,daily_limit_minor,per_transaction_limit_enabled,per_transaction_limit_minor,updated_by_person_id)
    values(a,s,p_student_id,p_currency_code,p_daily_limit_enabled,p_daily_limit_minor,
      p_per_transaction_limit_enabled,p_per_transaction_limit_minor,actor)
    returning inserted.id,inserted.version into control_id,new_version;
    perform pikas_private.record_purchase_audit(actor,auth.uid(),'school_admin',a,s,null,
      'spending_control_created','student_spending_controls',control_id);
    return query select control_id,new_version; return;
  end if;
  if p_expected_version is null or control.version<>p_expected_version then
    raise exception using errcode='40001',message='stale_spending_control_version';
  end if;
  update public.student_spending_controls sc set daily_limit_enabled=p_daily_limit_enabled,
    daily_limit_minor=p_daily_limit_minor,per_transaction_limit_enabled=p_per_transaction_limit_enabled,
    per_transaction_limit_minor=p_per_transaction_limit_minor,updated_by_person_id=actor,version=sc.version+1
    where sc.id=control.id returning sc.id,sc.version into control_id,new_version;
  perform pikas_private.record_purchase_audit(actor,auth.uid(),'school_admin',a,s,null,
    'spending_control_updated','student_spending_controls',control_id);
  return query select control_id,new_version;
end $$;

create function pikas_private.assert_purchase_complete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare purchase_key uuid; purchase_row public.purchases%rowtype; item_count bigint; item_total numeric;
  tender_count bigint; cash_count bigint; wallet_count bigint; debit_count bigint; ledger_count bigint; daily_count bigint;
begin
  if tg_table_name='purchases' then purchase_key:=(to_jsonb(new)->>'id')::uuid;
  elsif tg_table_name='purchase_cash_tenders' then
    select t.purchase_id into purchase_key from public.purchase_tenders t
      where t.id=(to_jsonb(new)->>'tender_id')::uuid;
  else purchase_key:=nullif(to_jsonb(new)->>'purchase_id','')::uuid; end if;
  select p.* into purchase_row from public.purchases p where p.id=purchase_key;
  if not found then return null; end if;
  select count(*),coalesce(sum(i.line_total_minor::numeric),0) into item_count,item_total
    from public.purchase_items i where i.purchase_id=purchase_key;
  if item_count<1 or item_count>30 or item_total<>purchase_row.total_minor::numeric
      or (select max(i.line_number) from public.purchase_items i where i.purchase_id=purchase_key)<>item_count then
    raise exception using errcode='23514',message='purchase_requires_nonempty_items_and_matching_total';
  end if;
  if purchase_row.student_id is not null and purchase_row.total_minor>0 then
    select count(*) into daily_count from public.student_daily_spend_events d
      where d.purchase_id=purchase_key and d.student_id=purchase_row.student_id
        and d.event_type='purchase' and d.business_date=purchase_row.business_date and d.currency_code=purchase_row.currency_code
        and d.amount_minor=purchase_row.total_minor;
    if daily_count<>1 then raise exception using errcode='23514',message='student_purchase_requires_exact_daily_usage'; end if;
  elsif exists(select 1 from public.student_daily_spend_events d where d.purchase_id=purchase_key) then
    raise exception using errcode='23514',message='ineligible_purchase_has_daily_usage';
  end if;
  if purchase_row.cafeteria_customer_id is not null and
      ((purchase_row.customer_type_snapshot is not distinct from 'student' and not exists(select 1 from public.cafeteria_customers cc
          where cc.id=purchase_row.cafeteria_customer_id and cc.account_id=purchase_row.account_id
            and cc.school_id=purchase_row.school_id and cc.cafeteria_id=purchase_row.cafeteria_id
            and cc.student_id=purchase_row.student_id and cc.staff_affiliation_id is null))
        or (purchase_row.customer_type_snapshot is not distinct from 'staff' and not exists(select 1 from public.cafeteria_customers cc
          where cc.id=purchase_row.cafeteria_customer_id and cc.account_id=purchase_row.account_id
            and cc.school_id=purchase_row.school_id and cc.cafeteria_id=purchase_row.cafeteria_id
            and cc.staff_affiliation_id=purchase_row.staff_affiliation_id and cc.student_id is null))) then
    raise exception using errcode='23514',message='purchase_customer_type_link_mismatch';
  end if;
  select count(*) into tender_count from public.purchase_tenders t where t.purchase_id=purchase_key;
  if tender_count<>1 then raise exception using errcode='23514',message='purchase_requires_exactly_one_tender'; end if;
  select count(*) into cash_count from public.purchase_tenders t join public.purchase_cash_tenders ct on ct.tender_id=t.id
    where t.purchase_id=purchase_key;
  select count(*) into wallet_count from public.purchase_tenders t join public.purchase_wallet_tenders wt on wt.tender_id=t.id
    where t.purchase_id=purchase_key;
  if (select t.tender_type from public.purchase_tenders t where t.purchase_id=purchase_key)='cash' then
    if cash_count<>1 or wallet_count<>0 or exists(
        select 1 from public.wallet_purchase_debits d where d.purchase_id=purchase_key) then raise exception using errcode='23514',message='cash_purchase_requires_only_cash_tender'; end if;
    if not exists(select 1 from public.purchase_tenders t join public.purchase_cash_tenders ct on ct.tender_id=t.id
        where t.purchase_id=purchase_key and ct.cash_received_minor>=purchase_row.total_minor
          and ct.change_due_minor::numeric=ct.cash_received_minor::numeric-purchase_row.total_minor::numeric) then
      raise exception using errcode='23514',message='cash_tender_amount_or_change_mismatch';
    end if;
  else
    if wallet_count<>1 or cash_count<>0 or purchase_row.total_minor=0 then
      raise exception using errcode='23514',message='wallet_purchase_requires_positive_single_wallet_tender';
    end if;
    select count(*) into debit_count from public.purchase_wallet_tenders wt
      join public.wallet_purchase_debits d on d.id=wt.wallet_purchase_debit_id
      where wt.purchase_id=purchase_key and d.purchase_id=purchase_key and d.student_id=purchase_row.student_id
        and d.currency_code=purchase_row.currency_code and d.amount_minor=purchase_row.total_minor
        and d.actor_person_id=purchase_row.operator_person_id;
    select count(*) into ledger_count from public.purchase_wallet_tenders wt
      join public.wallet_ledger_entries l on l.purchase_debit_id=wt.wallet_purchase_debit_id
      where wt.purchase_id=purchase_key and l.amount_minor=-purchase_row.total_minor and l.entry_type='purchase';
    if debit_count<>1 or ledger_count<>1 then raise exception using errcode='23514',message='wallet_tender_debit_or_ledger_mismatch'; end if;
  end if;
  return null;
end $$;
create constraint trigger purchases_complete after insert on public.purchases
  deferrable initially deferred for each row execute function pikas_private.assert_purchase_complete();
create constraint trigger purchase_items_complete after insert on public.purchase_items
  deferrable initially deferred for each row execute function pikas_private.assert_purchase_complete();
create constraint trigger purchase_tenders_complete after insert on public.purchase_tenders
  deferrable initially deferred for each row execute function pikas_private.assert_purchase_complete();
create constraint trigger purchase_cash_tenders_complete after insert on public.purchase_cash_tenders
  deferrable initially deferred for each row execute function pikas_private.assert_purchase_complete();
create constraint trigger purchase_wallet_tenders_complete after insert on public.purchase_wallet_tenders
  deferrable initially deferred for each row execute function pikas_private.assert_purchase_complete();
create constraint trigger wallet_purchase_debits_complete after insert on public.wallet_purchase_debits
  deferrable initially deferred for each row execute function pikas_private.assert_purchase_complete();
create constraint trigger student_daily_spend_complete after insert on public.student_daily_spend_events
  deferrable initially deferred for each row execute function pikas_private.assert_purchase_complete();

create function pikas_private.can_read_purchase(p_account uuid,p_school uuid,p_cafeteria uuid,p_operator uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select pikas_private.has_capability('cafeteria:pos:purchases:read',p_account,p_school,p_cafeteria)
    or (p_operator=pikas_private.current_person_id()
      and pikas_private.has_capability('cafeteria:pos:purchases:read_own',p_account,p_school,p_cafeteria))
$$;

do $$
declare t text;
begin
  foreach t in array array['purchases','purchase_items','purchase_tenders','purchase_cash_tenders',
    'purchase_wallet_tenders','wallet_purchase_debits','student_spending_controls',
    'student_daily_spend_events','cafeteria_purchase_counters'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

grant select on public.purchases,public.purchase_items,public.purchase_tenders,
  public.purchase_cash_tenders,public.purchase_wallet_tenders,public.student_spending_controls to authenticated;
create policy purchases_read on public.purchases for select to authenticated
using (pikas_private.can_read_purchase(account_id,school_id,cafeteria_id,operator_person_id));
create policy purchase_items_read on public.purchase_items for select to authenticated
using (exists(select 1 from public.purchases p where p.id=purchase_id
  and pikas_private.can_read_purchase(p.account_id,p.school_id,p.cafeteria_id,p.operator_person_id)));
create policy purchase_tenders_read on public.purchase_tenders for select to authenticated
using (exists(select 1 from public.purchases p where p.id=purchase_id
  and pikas_private.can_read_purchase(p.account_id,p.school_id,p.cafeteria_id,p.operator_person_id)));
create policy purchase_cash_tenders_read on public.purchase_cash_tenders for select to authenticated
using (exists(select 1 from public.purchase_tenders t join public.purchases p on p.id=t.purchase_id
  where t.id=tender_id and pikas_private.can_read_purchase(p.account_id,p.school_id,p.cafeteria_id,p.operator_person_id)));
create policy purchase_wallet_tenders_read on public.purchase_wallet_tenders for select to authenticated
using (exists(select 1 from public.purchases p where p.id=purchase_id
  and pikas_private.can_read_purchase(p.account_id,p.school_id,p.cafeteria_id,p.operator_person_id)));
create policy spending_controls_school_read on public.student_spending_controls for select to authenticated
using (pikas_private.has_capability('school:spending_controls:manage',account_id,school_id));

create function pikas_private.reject_purchase_history_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception using errcode='23514',message='purchase_financial_history_is_immutable'; end $$;
do $$
declare t text;
begin
  foreach t in array array['purchases','purchase_items','purchase_tenders','purchase_cash_tenders',
    'purchase_wallet_tenders','wallet_purchase_debits','student_daily_spend_events'] loop
    execute format('create trigger %I_immutable before update or delete on public.%I for each row execute function pikas_private.reject_purchase_history_mutation()',t,t);
    execute format('create trigger %I_no_truncate before truncate on public.%I for each statement execute function pikas_private.reject_purchase_history_mutation()',t,t);
  end loop;
  execute 'create trigger wallet_ledger_purchase_no_truncate before truncate on public.wallet_ledger_entries for each statement execute function pikas_private.reject_purchase_history_mutation()';
end $$;

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
  else
    select count(*) into matching_entries from public.wallet_ledger_entries l where l.purchase_debit_id=new.id;
    expected_amount:=new.amount_minor; expected_ledger_amount:=-new.amount_minor; expected_type:='purchase';
    select l.amount_minor,l.entry_type,l.wallet_id,l.balance_version_after,l.balance_after_minor
      into actual_amount,actual_type,entry_wallet,entry_version,entry_balance
      from public.wallet_ledger_entries l where l.purchase_debit_id=new.id;
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
create constraint trigger wallet_purchase_debit_requires_ledger
after insert on public.wallet_purchase_debits deferrable initially deferred
for each row execute function pikas_private.assert_wallet_operation_ledger();

create function pikas_private.guard_spending_control() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.id is distinct from new.id or old.account_id is distinct from new.account_id
      or old.school_id is distinct from new.school_id or old.student_id is distinct from new.student_id
      or old.currency_code is distinct from new.currency_code or old.created_at is distinct from new.created_at
      or new.version<>old.version+1 then
    raise exception using errcode='23514',message='spending_control_identity_or_version_invalid';
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
create trigger spending_control_guard before update on public.student_spending_controls
for each row execute function pikas_private.guard_spending_control();
create trigger spending_control_no_delete before delete on public.student_spending_controls
for each row execute function pikas_private.reject_purchase_history_mutation();
create trigger spending_control_no_truncate before truncate on public.student_spending_controls
for each statement execute function pikas_private.reject_purchase_history_mutation();
create trigger purchase_counter_no_delete before delete on public.cafeteria_purchase_counters
for each row execute function pikas_private.reject_purchase_history_mutation();
create trigger purchase_counter_no_truncate before truncate on public.cafeteria_purchase_counters
for each statement execute function pikas_private.reject_purchase_history_mutation();

create function pikas_private.record_purchase_audit(p_actor uuid,p_auth uuid,p_role text,p_account uuid,
  p_school uuid,p_cafeteria uuid,p_action text,p_target_type text,p_target uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,
    account_id,school_id,cafeteria_id,action,target_type,target_id,outcome,after_metadata)
  values(p_actor,p_auth,p_role,case when p_cafeteria is null then 'school' else 'cafeteria' end,
    p_account,p_school,p_cafeteria,p_action,p_target_type,p_target,'succeeded','{}'::jsonb);
end $$;

create function public.checkout_purchase(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid; v_request_key text; request_session_id uuid; request_customer_id uuid;
  request_tender_type text; request_cash_received bigint; expected_total bigint; expected_total_text text;
  items_json jsonb; tender_json jsonb; item_json jsonb; item_map jsonb:='{}'::jsonb;
  item_key text; item_value jsonb; product_uuid uuid; line_quantity integer; merged_quantity numeric;
  expected_version integer; expected_price numeric; canonical_items jsonb; snapshot_items jsonb:='[]'::jsonb;
  line record; line_number integer:=0; line_total numeric; total_numeric numeric:=0; total_minor bigint;
  account_uuid uuid; school_uuid uuid; campus_uuid uuid; cafeteria_uuid uuid; register_uuid uuid;
  session_row public.register_sessions%rowtype; scope_row record;
  existing_purchase public.purchases%rowtype; current_customer public.cafeteria_customers%rowtype;
  student_uuid uuid; staff_uuid uuid; student_name text; staff_name text; customer_type text;
  control_row public.student_spending_controls%rowtype; spent_today numeric:=0;
  wallet_row public.student_wallets%rowtype; wallet_balance_after bigint; wallet_version_after bigint;
  setting_currency text; scheduling_on boolean; purchased_time timestamptz;
  service_row record; service_shift_uuid uuid; service_shift_name text; menu_uuid uuid; menu_name text;
  product_row public.cafeteria_products%rowtype; purchase_uuid uuid; number_value bigint;
  fingerprint text; result_json jsonb; item_count integer; change_minor bigint;
begin
  actor:=pikas_private.current_person_id();
  if actor is null then raise exception using errcode='42501',message='OPERATOR_NOT_AUTHORIZED'; end if;
  if p_request is null or jsonb_typeof(p_request)<>'object'
      or not (p_request ?& array['request_key','register_session_id','cafeteria_customer_id','items','tender'])
      or exists(select 1 from jsonb_object_keys(p_request) as k(key)
        where key not in ('request_key','register_session_id','cafeteria_customer_id','items','tender','expected_total_minor')) then
    raise exception using errcode='22023',message='INVALID_CHECKOUT_REQUEST';
  end if;
  if jsonb_typeof(p_request->'request_key')<>'string' or p_request->>'request_key' is null or length(p_request->>'request_key') not between 16 and 128 then
    raise exception using errcode='22023',message='INVALID_REQUEST_KEY';
  end if;
  v_request_key:=p_request->>'request_key';
  if jsonb_typeof(p_request->'register_session_id')<>'string'
      or (p_request->>'register_session_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='INVALID_REGISTER_SESSION_ID';
  end if;
  request_session_id:=(p_request->>'register_session_id')::uuid;
  if p_request->'cafeteria_customer_id'<>'null'::jsonb then
    if jsonb_typeof(p_request->'cafeteria_customer_id')<>'string'
        or (p_request->>'cafeteria_customer_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode='22023',message='INVALID_CAFETERIA_CUSTOMER_ID';
    end if;
    request_customer_id:=(p_request->>'cafeteria_customer_id')::uuid;
  end if;
  items_json:=p_request->'items';
  if jsonb_typeof(items_json)<>'array' or jsonb_array_length(items_json) not between 1 and 30 then
    raise exception using errcode='22023',message='INVALID_PURCHASE_ITEMS';
  end if;
  tender_json:=p_request->'tender';
  if jsonb_typeof(tender_json)<>'object' or jsonb_typeof(tender_json->'type')<>'string' then
    raise exception using errcode='22023',message='INVALID_TENDER';
  end if;
  request_tender_type:=tender_json->>'type';
  if request_tender_type='cash' then
    if (select count(*) from jsonb_object_keys(tender_json))<>2 or not (tender_json ? 'cash_received_minor')
        or jsonb_typeof(tender_json->'cash_received_minor')<>'string'
        or (tender_json->>'cash_received_minor') !~ '^(0|[1-9][0-9]{0,18})$' then
      raise exception using errcode='22023',message='INVALID_CASH_TENDER';
    end if;
    if (tender_json->>'cash_received_minor')::numeric>9223372036854775807::numeric then
      raise exception using errcode='22003',message='AMOUNT_OVERFLOW';
    end if;
    request_cash_received:=(tender_json->>'cash_received_minor')::bigint;
  elsif request_tender_type='student_wallet' then
    if (select count(*) from jsonb_object_keys(tender_json))<>1 then raise exception using errcode='22023',message='INVALID_WALLET_TENDER'; end if;
  else
    raise exception using errcode='22023',message='UNSUPPORTED_TENDER_TYPE';
  end if;
  if p_request ? 'expected_total_minor' then
    if jsonb_typeof(p_request->'expected_total_minor')<>'string'
        or (p_request->>'expected_total_minor') !~ '^(0|[1-9][0-9]{0,18})$'
        or (p_request->>'expected_total_minor')::numeric>9223372036854775807::numeric then
      raise exception using errcode='22023',message='INVALID_EXPECTED_TOTAL';
    end if;
    expected_total_text:=p_request->>'expected_total_minor';
    expected_total:=expected_total_text::bigint;
  end if;

  for item_json in select value from jsonb_array_elements(items_json) as x(value) loop
    if jsonb_typeof(item_json)<>'object' or (select count(*) from jsonb_object_keys(item_json))<>4
        or not (item_json ?& array['product_id','quantity','expected_product_version','expected_unit_price_minor'])
        or exists(select 1 from jsonb_object_keys(item_json) as k(key)
          where key not in ('product_id','quantity','expected_product_version','expected_unit_price_minor')) then
      raise exception using errcode='22023',message='INVALID_PURCHASE_ITEM_SHAPE';
    end if;
    if jsonb_typeof(item_json->'product_id')<>'string'
        or (item_json->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(item_json->'quantity')<>'number'
        or (item_json->>'quantity') !~ '^[0-9]+$'
        or jsonb_typeof(item_json->'expected_product_version')<>'number'
        or (item_json->>'expected_product_version') !~ '^[0-9]+$'
        or jsonb_typeof(item_json->'expected_unit_price_minor')<>'string'
        or (item_json->>'expected_unit_price_minor') !~ '^(0|[1-9][0-9]{0,18})$' then
      raise exception using errcode='22023',message='INVALID_PURCHASE_ITEM_VALUE';
    end if;
    product_uuid:=(item_json->>'product_id')::uuid;
    line_quantity:=(item_json->>'quantity')::integer;
    expected_version:=(item_json->>'expected_product_version')::integer;
    expected_price:=(item_json->>'expected_unit_price_minor')::numeric;
    if line_quantity<1 or line_quantity>20 or expected_version<1
        or expected_price>9223372036854775807::numeric then
      raise exception using errcode='22023',message='INVALID_PURCHASE_ITEM_VALUE';
    end if;
    item_key:=product_uuid::text;
    if item_map ? item_key then
      item_value:=item_map->item_key;
      if (item_value->>'version')::integer<>expected_version
          or (item_value->>'price')::numeric<>expected_price then
        raise exception using errcode='22023',message='DUPLICATE_PRODUCT_EVIDENCE_CONFLICT';
      end if;
      merged_quantity:=(item_value->>'quantity')::numeric+line_quantity::numeric;
      if merged_quantity>20 then raise exception using errcode='22023',message='INVALID_QUANTITY'; end if;
      item_map:=jsonb_set(item_map,array[item_key],jsonb_build_object('quantity',merged_quantity::integer,
        'version',expected_version,'price',expected_price::text),false);
    else
      item_map:=jsonb_set(item_map,array[item_key],jsonb_build_object('quantity',line_quantity,
        'version',expected_version,'price',expected_price::text),true);
    end if;
  end loop;
  select count(*)::integer into item_count from jsonb_object_keys(item_map);
  if item_count<1 or item_count>30 then raise exception using errcode='22023',message='INVALID_PURCHASE_ITEMS'; end if;
  select jsonb_agg(jsonb_build_object('product_id',e.key,'quantity',(e.value->>'quantity')::integer,
    'expected_product_version',(e.value->>'version')::integer,
    'expected_unit_price_minor',e.value->>'price') order by e.key)
    into canonical_items from jsonb_each(item_map) as e(key,value);

  select rs.* into session_row from public.register_sessions rs where rs.id=request_session_id;
  if not found then raise exception using errcode='42501',message='SESSION_NOT_FOUND'; end if;
  account_uuid:=session_row.account_id; school_uuid:=session_row.school_id; campus_uuid:=session_row.school_location_id;
  cafeteria_uuid:=session_row.cafeteria_id; register_uuid:=session_row.register_id;
  if session_row.operator_person_id<>actor then raise exception using errcode='42501',message='OPERATOR_NOT_AUTHORIZED'; end if;
  select * into scope_row from pikas_private.lock_active_cafeteria_scope(cafeteria_uuid);
  if not found or scope_row.account_id<>account_uuid or scope_row.school_id<>school_uuid
      or scope_row.school_location_id<>campus_uuid then
    raise exception using errcode='42501',message='INACTIVE_TENANT_SCOPE';
  end if;
  if not pikas_private.has_capability('cafeteria:pos:purchase:create',account_uuid,school_uuid,cafeteria_uuid) then
    raise exception using errcode='42501',message='OPERATOR_NOT_AUTHORIZED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(account_uuid::text||':'||v_request_key,20261006));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261005));
  perform 1 from public.cafeteria_memberships m
    join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
    where m.id=session_row.operator_membership_id and m.account_id=account_uuid and m.school_id=school_uuid
      and m.cafeteria_id=cafeteria_uuid and m.person_id=actor and m.status='active'
      and m.role_code=session_row.operator_role_code and rc.capability='cafeteria:pos:purchase:create'
    for share of m;
  if not found then raise exception using errcode='42501',message='OPERATOR_NOT_AUTHORIZED'; end if;

  select p.* into existing_purchase from public.purchases p
    where p.account_id=account_uuid and p.request_key=v_request_key;
  if found then
    if existing_purchase.operator_person_id<>actor
        or not pikas_private.has_capability('cafeteria:pos:purchase:create',existing_purchase.account_id,
          existing_purchase.school_id,existing_purchase.cafeteria_id) then
      raise exception using errcode='42501',message='OPERATOR_NOT_AUTHORIZED';
    end if;
    if existing_purchase.payload_fingerprint<>encode(extensions.digest(convert_to(jsonb_build_object(
      'account_id',account_uuid,'operator_person_id',actor,'operator_membership_id',session_row.operator_membership_id,
        'register_session_id',request_session_id,'cafeteria_customer_id',request_customer_id,
        'tender_type',request_tender_type,'cash_received_minor',request_cash_received::text,
        'expected_total_minor',expected_total_text,'items',canonical_items)::text,'UTF8'),'sha256'),'hex') then
      raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT';
    end if;
    return (select jsonb_build_object('purchase_id',p.id,'purchase_number',p.purchase_number::text,
      'purchased_at',p.purchased_at,'business_date',p.business_date,'business_timezone',p.business_timezone_snapshot,
      'currency_code',p.currency_code,'total_minor',p.total_minor::text,'register_id',p.register_id,
      'register_session_id',p.register_session_id,'cafeteria_customer_id',p.cafeteria_customer_id,
      'customer_type',p.customer_type_snapshot,'customer_name',p.customer_display_name_snapshot,
      'service_shift_id',p.service_shift_id,'service_shift_name',p.service_shift_name_snapshot,
      'menu_id',p.menu_id,'menu_name',p.menu_name_snapshot,
      'tender_type',t.tender_type,'cash_received_minor',ct.cash_received_minor::text,
      'change_due_minor',ct.change_due_minor::text,'wallet_balance_after_minor',wl.balance_after_minor::text,
      'items',(select jsonb_agg(jsonb_build_object('product_id',i.product_id,'name',i.product_name_snapshot,
        'product_version',i.product_version_snapshot,'unit_price_minor',i.unit_price_minor::text,
        'quantity',i.quantity,'line_total_minor',i.line_total_minor::text) order by i.line_number)
        from public.purchase_items i where i.purchase_id=p.id))
      from public.purchases p join public.purchase_tenders t on t.purchase_id=p.id
      left join public.purchase_cash_tenders ct on ct.tender_id=t.id
      left join public.purchase_wallet_tenders wt on wt.tender_id=t.id
      left join public.wallet_ledger_entries wl on wl.purchase_debit_id=wt.wallet_purchase_debit_id
      where p.id=existing_purchase.id);
  end if;

  if not exists(select 1 from public.cafeteria_registers r where r.id=register_uuid
      and r.account_id=account_uuid and r.school_id=school_uuid and r.school_location_id=campus_uuid
      and r.cafeteria_id=cafeteria_uuid and r.status='active' for share) then
    raise exception using errcode='23514',message='REGISTER_INACTIVE';
  end if;
  if not exists(select 1 from public.cafeteria_register_assignments ra
      where ra.id=session_row.assignment_id and ra.account_id=account_uuid and ra.school_id=school_uuid
        and ra.school_location_id=campus_uuid and ra.cafeteria_id=cafeteria_uuid
        and ra.register_id=register_uuid and ra.operator_person_id=actor and ra.cafeteria_membership_id=session_row.operator_membership_id
        and ra.status='active' for share) then
    raise exception using errcode='42501',message='ASSIGNMENT_INACTIVE';
  end if;
  perform 1 from public.cafeteria_memberships m
    join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
    where m.id=session_row.operator_membership_id and m.person_id=actor and m.status='active'
      and m.account_id=account_uuid and m.school_id=school_uuid and m.cafeteria_id=cafeteria_uuid
      and rc.capability='cafeteria:pos:purchase:create' for share of m;
  if not found then raise exception using errcode='42501',message='OPERATOR_NOT_AUTHORIZED'; end if;
  select rs.* into session_row from public.register_sessions rs where rs.id=request_session_id for share;
  if not found or session_row.status<>'open' or session_row.operator_person_id<>actor
      or session_row.register_id<>register_uuid or session_row.cafeteria_id<>cafeteria_uuid then
    raise exception using errcode='23514',message='SESSION_CLOSED';
  end if;
  select os.catalog_currency_code,os.scheduling_enabled into setting_currency,scheduling_on
    from public.cafeteria_operation_settings os where os.account_id=account_uuid
      and os.school_id=school_uuid and os.cafeteria_id=cafeteria_uuid for share;
  if not found or setting_currency<>session_row.currency_code then
    raise exception using errcode='23514',message='SESSION_CURRENCY_MISMATCH';
  end if;
  if scheduling_on then
    -- Frozen 4B shift RPCs lock this advisory key before shift rows. Its menu/product triggers take it after row locks;
    -- checkout therefore reads their committed MVCC versions under the shared fence without waiting on those rows.
    perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(cafeteria_uuid::text,20261004));
  end if;
  perform 1 from public.supported_currencies cu where cu.currency_code=setting_currency and cu.status='enabled' for share;
  if not found then raise exception using errcode='23514',message='CURRENCY_DISABLED'; end if;

  if request_tender_type='student_wallet' and request_customer_id is null then
    raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE';
  end if;
  if request_customer_id is not null then
    select cc.* into current_customer from public.cafeteria_customers cc
      where cc.id=request_customer_id and cc.account_id=account_uuid and cc.school_id=school_uuid
        and cc.cafeteria_id=cafeteria_uuid and cc.status='active' for share;
    if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
    perform 1 from public.school_cafeteria_shares sh
      join public.school_cafeteria_share_categories cat on cat.share_id=sh.id
      where sh.account_id=account_uuid and sh.school_id=school_uuid and sh.cafeteria_id=cafeteria_uuid
        and sh.status='active' and cat.category='basic_identification' and cat.enabled
      for share of sh,cat;
    if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
    if current_customer.student_id is not null then
      customer_type:='student'; student_uuid:=current_customer.student_id;
      select st.display_name into student_name from public.students st
        join public.persons person on person.id=st.person_id and person.status='active'
        where st.id=student_uuid and st.account_id=account_uuid and st.school_id=school_uuid and st.status='active'
        for share of st,person;
      if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
    elsif current_customer.staff_affiliation_id is not null then
      customer_type:='staff'; staff_uuid:=current_customer.staff_affiliation_id;
      if request_tender_type='student_wallet' then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
      select person.display_name into staff_name from public.school_staff_affiliations sf
        join public.persons person on person.id=sf.person_id and person.status='active'
        where sf.id=staff_uuid and sf.account_id=account_uuid and sf.school_id=school_uuid and sf.status='active'
        for share of sf,person;
      if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
    else
      raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE';
    end if;
  end if;
  if request_tender_type='student_wallet' and student_uuid is null then
    raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE';
  end if;
  if student_uuid is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(student_uuid::text,0));
    perform 1 from public.student_enrollments en
      where en.account_id=account_uuid and en.school_id=school_uuid and en.student_id=student_uuid
        and en.status='active' for share;
    if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
    select sc.* into control_row from public.student_spending_controls sc
      where sc.account_id=account_uuid and sc.school_id=school_uuid and sc.student_id=student_uuid
        and sc.currency_code=setting_currency for share;
    if request_tender_type='student_wallet' then
      select w.* into wallet_row from public.student_wallets w where w.account_id=account_uuid
        and w.school_id=school_uuid and w.student_id=student_uuid and w.currency_code=setting_currency for update;
      if not found or wallet_row.status<>'active' then raise exception using errcode='23514',message='WALLET_FROZEN'; end if;
    end if;
  end if;

  for line in select e.key from jsonb_each(item_map) as e(key) order by e.key loop
    perform 1 from public.cafeteria_products p where p.id=line.key::uuid
      and p.account_id=account_uuid and p.school_id=school_uuid and p.cafeteria_id=cafeteria_uuid for share;
    if not found then raise exception using errcode='23503',message='PRODUCT_UNAVAILABLE'; end if;
  end loop;
  perform 1 from public.cafeteria_purchase_counters c where c.cafeteria_id=cafeteria_uuid
    and c.account_id=account_uuid and c.school_id=school_uuid and c.school_location_id=campus_uuid for update;
  if not found then raise exception using errcode='23514',message='PURCHASE_COUNTER_MISSING'; end if;

  purchased_time:=clock_timestamp();
  select * into service_row from pikas_private.resolve_cafeteria_service_at(cafeteria_uuid,purchased_time);
  if not found then raise exception using errcode='23514',message='NO_ACTIVE_SERVICE'; end if;
  if not scheduling_on then
    if service_row.status<>'manual' then raise exception using errcode='23514',message='NO_ACTIVE_SERVICE'; end if;
  elsif service_row.status<>'active' then
    raise exception using errcode='23514',message='NO_ACTIVE_SERVICE';
  end if;
  if scheduling_on then
    service_shift_uuid:=service_row.service_shift_id; service_shift_name:=service_row.service_shift_name;
    menu_uuid:=service_row.menu_id; menu_name:=service_row.menu_name;
  end if;

  for line in select e.key,e.value from jsonb_each(item_map) as e(key,value) order by e.key loop
    product_uuid:=line.key::uuid;
    expected_version:=(line.value->>'version')::integer;
    expected_price:=(line.value->>'price')::numeric;
    line_quantity:=(line.value->>'quantity')::integer;
    select p.* into product_row from public.cafeteria_products p where p.id=product_uuid
      and p.account_id=account_uuid and p.school_id=school_uuid and p.cafeteria_id=cafeteria_uuid for share;
    if not found then raise exception using errcode='23503',message='PRODUCT_UNAVAILABLE'; end if;
    if product_row.version<>expected_version or product_row.price_minor::numeric<>expected_price then
      raise exception using errcode='40001',message='PRODUCT_STALE';
    end if;
    if not product_row.active or not product_row.available then
      raise exception using errcode='23514',message='PRODUCT_UNAVAILABLE';
    end if;
    if scheduling_on and not exists(select 1 from public.cafeteria_menu_products mp
        where mp.account_id=account_uuid and mp.school_id=school_uuid and mp.cafeteria_id=cafeteria_uuid
          and mp.menu_id=menu_uuid and mp.product_id=product_uuid and mp.active) then
      raise exception using errcode='23514',message='PRODUCT_UNAVAILABLE';
    end if;
    line_total:=product_row.price_minor::numeric*line_quantity::numeric;
    if line_total>9223372036854775807::numeric or total_numeric+line_total>9223372036854775807::numeric then
      raise exception using errcode='22003',message='AMOUNT_OVERFLOW';
    end if;
    total_numeric:=total_numeric+line_total;
    line_number:=line_number+1;
    snapshot_items:=snapshot_items||jsonb_build_array(jsonb_build_object('product_id',product_uuid,
      'line_number',line_number,'name',product_row.name,'version',product_row.version,
      'unit_price_minor',product_row.price_minor::text,'quantity',line_quantity,'line_total_minor',line_total::text));
  end loop;
  total_minor:=total_numeric::bigint;
  if expected_total is not null and expected_total<>total_minor then
    raise exception using errcode='40001',message='TOTAL_STALE';
  end if;
  if request_tender_type='student_wallet' and total_minor=0 then
    raise exception using errcode='22023',message='ZERO_TOTAL_WALLET_NOT_ALLOWED';
  end if;
  if request_tender_type='cash' and request_cash_received<total_minor then
    raise exception using errcode='22023',message='CASH_INSUFFICIENT';
  end if;

  if student_uuid is not null then
    select sc.* into control_row from public.student_spending_controls sc
      where sc.account_id=account_uuid and sc.school_id=school_uuid and sc.student_id=student_uuid
        and sc.currency_code=setting_currency for share;
    if found then
      if control_row.per_transaction_limit_enabled and total_minor>control_row.per_transaction_limit_minor then
        raise exception using errcode='23514',message='TRANSACTION_LIMIT_EXCEEDED';
      end if;
      if control_row.daily_limit_enabled and total_minor>0 then
        select coalesce(sum(d.amount_minor::numeric),0) into spent_today from public.student_daily_spend_events d
          where d.account_id=account_uuid and d.school_id=school_uuid and d.student_id=student_uuid
            and d.business_date=service_row.business_date and d.currency_code=setting_currency;
        if spent_today+total_minor::numeric>control_row.daily_limit_minor::numeric then
          raise exception using errcode='23514',message='DAILY_LIMIT_EXCEEDED';
        end if;
      end if;
    end if;
  end if;

  if request_tender_type='student_wallet' then
    select w.* into wallet_row from public.student_wallets w where w.account_id=account_uuid
      and w.school_id=school_uuid and w.student_id=student_uuid and w.currency_code=setting_currency for update;
    if not found or wallet_row.status<>'active' then raise exception using errcode='23514',message='WALLET_FROZEN'; end if;
    if wallet_row.current_balance_minor<total_minor then raise exception using errcode='23514',message='INSUFFICIENT_BALANCE'; end if;
    if wallet_row.balance_version=9223372036854775807 then raise exception using errcode='22003',message='AMOUNT_OVERFLOW'; end if;
    wallet_balance_after:=wallet_row.current_balance_minor-total_minor;
    wallet_version_after:=wallet_row.balance_version+1;
  end if;

  if cafeteria_uuid is null then raise exception using errcode='23514',message='PURCHASE_COUNTER_MISSING'; end if;
  update public.cafeteria_purchase_counters c set last_purchase_number=c.last_purchase_number+1,
      updated_at=clock_timestamp()
    where c.cafeteria_id=cafeteria_uuid and c.account_id=account_uuid and c.school_id=school_uuid
      and c.school_location_id=campus_uuid and c.last_purchase_number<9223372036854775807
    returning c.last_purchase_number into number_value;
  if not found then raise exception using errcode='22003',message='PURCHASE_NUMBER_EXHAUSTED'; end if;

  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('account_id',account_uuid,
    'operator_person_id',actor,'operator_membership_id',session_row.operator_membership_id,
    'register_session_id',request_session_id,'cafeteria_customer_id',request_customer_id,
    'tender_type',request_tender_type,'cash_received_minor',request_cash_received::text,
    'expected_total_minor',expected_total_text,'items',canonical_items)::text,'UTF8'),'sha256'),'hex');
  insert into public.purchases(account_id,school_id,school_location_id,cafeteria_id,purchase_number,
    register_id,register_session_id,operator_person_id,operator_membership_id,operator_role_code,
    cafeteria_customer_id,customer_type_snapshot,customer_display_name_snapshot,student_id,staff_affiliation_id,
    business_timezone_snapshot,business_date,purchased_at,currency_code,total_minor,
    service_shift_id,service_shift_name_snapshot,menu_id,menu_name_snapshot,request_key,payload_fingerprint)
  values(account_uuid,school_uuid,campus_uuid,cafeteria_uuid,number_value,register_uuid,request_session_id,
    actor,session_row.operator_membership_id,session_row.operator_role_code,request_customer_id,customer_type,
    case when customer_type='student' then student_name when customer_type='staff' then staff_name else null end,
    student_uuid,staff_uuid,scope_row.business_timezone,service_row.business_date,purchased_time,setting_currency,
    total_minor,service_shift_uuid,service_shift_name,menu_uuid,menu_name,v_request_key,fingerprint)
  returning id into purchase_uuid;

  for line in select value from jsonb_array_elements(snapshot_items) as x(value) loop
    insert into public.purchase_items(account_id,school_id,school_location_id,cafeteria_id,purchase_id,
      line_number,product_id,product_name_snapshot,product_version_snapshot,unit_price_minor,quantity,line_total_minor)
    values(account_uuid,school_uuid,campus_uuid,cafeteria_uuid,purchase_uuid,(line.value->>'line_number')::smallint,
      (line.value->>'product_id')::uuid,line.value->>'name',(line.value->>'version')::integer,
      (line.value->>'unit_price_minor')::bigint,(line.value->>'quantity')::integer,(line.value->>'line_total_minor')::bigint);
  end loop;

  if request_tender_type='cash' then
    change_minor:=(request_cash_received::numeric-total_minor::numeric)::bigint;
    insert into public.purchase_tenders(account_id,school_id,cafeteria_id,purchase_id,currency_code,tender_type)
    values(account_uuid,school_uuid,cafeteria_uuid,purchase_uuid,setting_currency,'cash') returning id into product_uuid;
    insert into public.purchase_cash_tenders(tender_id,cash_received_minor,change_due_minor)
    values(product_uuid,request_cash_received,change_minor);
  else
    insert into public.wallet_purchase_debits(account_id,school_id,cafeteria_id,student_id,wallet_id,
      currency_code,purchase_id,amount_minor,actor_person_id,posted_at)
    values(account_uuid,school_uuid,cafeteria_uuid,student_uuid,wallet_row.id,setting_currency,purchase_uuid,
      total_minor,actor,purchased_time) returning id into product_uuid;
    update public.student_wallets set current_balance_minor=wallet_balance_after,
      balance_version=wallet_version_after where id=wallet_row.id;
    insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,
      balance_after_minor,balance_version_after,purchase_debit_id,occurred_at)
    values(account_uuid,school_uuid,wallet_row.id,setting_currency,'purchase',-total_minor,
      wallet_balance_after,wallet_version_after,product_uuid,purchased_time);
    insert into public.purchase_tenders(account_id,school_id,cafeteria_id,purchase_id,currency_code,tender_type)
    values(account_uuid,school_uuid,cafeteria_uuid,purchase_uuid,setting_currency,'student_wallet') returning id into register_uuid;
    insert into public.purchase_wallet_tenders(tender_id,account_id,school_id,cafeteria_id,purchase_id,
      student_id,wallet_id,currency_code,wallet_purchase_debit_id)
    values(register_uuid,account_uuid,school_uuid,cafeteria_uuid,purchase_uuid,student_uuid,wallet_row.id,
      setting_currency,product_uuid);
  end if;
  if student_uuid is not null and total_minor>0 then
    insert into public.student_daily_spend_events(account_id,school_id,cafeteria_id,student_id,business_date,
      currency_code,purchase_id,amount_minor,occurred_at)
    values(account_uuid,school_uuid,cafeteria_uuid,student_uuid,service_row.business_date,
      setting_currency,purchase_uuid,total_minor,purchased_time);
  end if;
  perform pikas_private.record_purchase_audit(actor,auth.uid(),session_row.operator_role_code,
    account_uuid,school_uuid,cafeteria_uuid,'purchase_committed','purchases',purchase_uuid);
  select jsonb_build_object('purchase_id',p.id,'purchase_number',p.purchase_number::text,
    'purchased_at',p.purchased_at,'business_date',p.business_date,'business_timezone',p.business_timezone_snapshot,
    'currency_code',p.currency_code,'total_minor',p.total_minor::text,'register_id',p.register_id,
    'register_session_id',p.register_session_id,'cafeteria_customer_id',p.cafeteria_customer_id,
    'customer_type',p.customer_type_snapshot,'customer_name',p.customer_display_name_snapshot,
    'service_shift_id',p.service_shift_id,'service_shift_name',p.service_shift_name_snapshot,
    'menu_id',p.menu_id,'menu_name',p.menu_name_snapshot,'tender_type',t.tender_type,
    'cash_received_minor',ct.cash_received_minor::text,'change_due_minor',ct.change_due_minor::text,
    'wallet_balance_after_minor',case when wt.wallet_id is null then null else wl.balance_after_minor::text end,
    'items',(select jsonb_agg(jsonb_build_object('product_id',i.product_id,'name',i.product_name_snapshot,
      'product_version',i.product_version_snapshot,'unit_price_minor',i.unit_price_minor::text,
      'quantity',i.quantity,'line_total_minor',i.line_total_minor::text) order by i.line_number)
      from public.purchase_items i where i.purchase_id=p.id)) into result_json
  from public.purchases p join public.purchase_tenders t on t.purchase_id=p.id
  left join public.purchase_cash_tenders ct on ct.tender_id=t.id
  left join public.purchase_wallet_tenders wt on wt.tender_id=t.id
  left join public.wallet_ledger_entries wl on wl.purchase_debit_id=wt.wallet_purchase_debit_id
  where p.id=purchase_uuid;
  return result_json;
end $$;

revoke all on function pikas_private.guard_student_daily_spend_event() from public,anon,authenticated,service_role;
revoke all on function pikas_private.ensure_purchase_counter() from public,anon,authenticated,service_role;
revoke all on function pikas_private.lock_purchase_schedule_writer() from public,anon,authenticated,service_role;
revoke all on function pikas_private.guard_spending_control() from public,anon,authenticated,service_role;
revoke all on function pikas_private.record_purchase_audit(uuid,uuid,text,uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function pikas_private.assert_purchase_complete() from public,anon,authenticated,service_role;
revoke all on function pikas_private.reject_purchase_history_mutation() from public,anon,authenticated,service_role;
revoke all on function pikas_private.can_read_purchase(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function pikas_private.can_read_purchase(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.set_student_spending_control(uuid,text,integer,boolean,bigint,boolean,bigint) from public,anon,service_role;
revoke all on function public.checkout_purchase(jsonb) from public,anon,service_role;
grant execute on function public.set_student_spending_control(uuid,text,integer,boolean,bigint,boolean,bigint),
  public.checkout_purchase(jsonb) to authenticated;

commit;