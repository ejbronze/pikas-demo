-- Phase 3D: school-scoped staff receivables and staff-credit purchases.
begin;

insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values
 ('school','school_admin','school:staff_receivables:read'),
 ('school','school_admin','school:staff_receivables:manage'),
 ('cafeteria','pos_supervisor','cafeteria:pos:staff_credit:purchase'),
 ('cafeteria','pos_supervisor','cafeteria:pos:staff_receivables:read'),
 ('cafeteria','pos_supervisor','cafeteria:pos:staff_receivables:settle'),
 ('cafeteria','cafeteria_admin','cafeteria:pos:staff_receivables:read'),
 ('cafeteria','cafeteria_admin','cafeteria:pos:staff_receivables:settle');

create table public.staff_receivable_accounts (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null,
 school_id uuid not null,
 staff_affiliation_id uuid not null,
 currency_code text not null default 'DOP' check(currency_code='DOP')
  references public.supported_currencies(currency_code) on delete restrict,
 current_balance_minor bigint not null default 0 check(current_balance_minor>=0),
 balance_version bigint not null default 0 check(balance_version>=0),
 credit_enabled boolean not null default false,
 credit_limit_minor bigint check(credit_limit_minor is null or credit_limit_minor>=0),
 config_version integer not null default 1 check(config_version>0),
 config_actor_person_id uuid references public.persons(id) on delete restrict,
 config_request_key text check(config_request_key is null or length(config_request_key) between 16 and 128),
 config_payload_fingerprint text check(config_payload_fingerprint is null or config_payload_fingerprint ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(account_id,school_id,staff_affiliation_id)
  references public.school_staff_affiliations(account_id,school_id,id) on delete restrict,
 unique(school_id,staff_affiliation_id,currency_code),
 unique(account_id,school_id,id),
 unique(account_id,school_id,id,currency_code),
 unique(account_id,school_id,staff_affiliation_id,id,currency_code)
);
create unique index staff_receivable_config_idempotency_uq
 on public.staff_receivable_accounts(account_id,config_actor_person_id,config_request_key)
 where config_request_key is not null;
create index staff_receivable_accounts_school_balance_idx
 on public.staff_receivable_accounts(account_id,school_id,credit_enabled,current_balance_minor);

create table public.purchase_staff_credit_tenders (
 tender_id uuid primary key,
 account_id uuid not null,
 school_id uuid not null,
 school_location_id uuid not null,
 cafeteria_id uuid not null,
 purchase_id uuid not null,
 receivable_account_id uuid not null,
 currency_code text not null check(currency_code='DOP'),
 tender_type text not null default 'staff_credit' check(tender_type='staff_credit'),
 amount_minor bigint not null check(amount_minor>0),
 posted_at timestamptz not null,
 foreign key(account_id,school_id,school_location_id,cafeteria_id,purchase_id)
  references public.purchases(account_id,school_id,school_location_id,cafeteria_id,id) on delete restrict,
 foreign key(account_id,school_id,cafeteria_id,tender_id,purchase_id,currency_code,tender_type)
  references public.purchase_tenders(account_id,school_id,cafeteria_id,id,purchase_id,currency_code,tender_type) on delete restrict,
 foreign key(account_id,school_id,receivable_account_id,currency_code)
  references public.staff_receivable_accounts(account_id,school_id,id,currency_code) on delete restrict,
 unique(tender_id),
 unique(account_id,school_id,cafeteria_id,purchase_id,receivable_account_id,currency_code,amount_minor)
);

create table public.staff_receivable_settlements (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null,
 school_id uuid not null,
 receivable_account_id uuid not null,
 amount_minor bigint not null check(amount_minor>0),
 method text not null check(method in ('cash','bank_transfer','other')),
 actor_person_id uuid not null references public.persons(id) on delete restrict,
 actor_membership_id uuid not null,
 actor_role_code text not null check(actor_role_code in ('pos_supervisor','cafeteria_admin')),
 currency_code text not null default 'DOP' check(currency_code='DOP'),
 occurred_at timestamptz not null,
 cafeteria_id uuid not null,
 school_location_id uuid not null,
 register_id uuid,
 register_session_id uuid,
 reference text check(reference is null or length(btrim(reference)) between 1 and 160),
 note text check(note is null or length(btrim(note)) between 1 and 500),
 request_key text not null check(length(request_key) between 16 and 128),
 payload_fingerprint text not null check(payload_fingerprint ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 foreign key(account_id,school_id,receivable_account_id,currency_code)
  references public.staff_receivable_accounts(account_id,school_id,id,currency_code) on delete restrict,
 foreign key(account_id,school_id,cafeteria_id)
  references public.cafeterias(account_id,school_id,id) on delete restrict,
 foreign key(account_id,school_id,school_location_id,cafeteria_id,register_id)
  references public.cafeteria_registers(account_id,school_id,school_location_id,cafeteria_id,id) on delete restrict,
 foreign key(account_id,school_id,school_location_id,cafeteria_id,register_id,register_session_id,
  actor_person_id,actor_membership_id,actor_role_code,currency_code)
  references public.register_sessions(account_id,school_id,school_location_id,cafeteria_id,register_id,id,
   operator_person_id,operator_membership_id,operator_role_code,currency_code) on delete restrict,
 unique(account_id,actor_person_id,request_key),
 unique(account_id,school_id,receivable_account_id,id),
 unique(account_id,school_id,school_location_id,cafeteria_id,receivable_account_id,id),
 check((method='cash' and register_id is not null and register_session_id is not null
  and actor_role_code='pos_supervisor')
  or (method<>'cash' and register_id is null and register_session_id is null))
);
create index staff_receivable_settlements_account_time_idx
 on public.staff_receivable_settlements(account_id,school_id,receivable_account_id,occurred_at desc,id);
create index staff_receivable_settlements_session_idx
 on public.staff_receivable_settlements(register_session_id,occurred_at) where method='cash';

alter table public.refunds add constraint refunds_staff_receivable_source_key
 unique(account_id,school_id,school_location_id,cafeteria_id,id,purchase_id,currency_code);

create table public.staff_receivable_entries (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null,
 school_id uuid not null,
 school_location_id uuid not null,
 receivable_account_id uuid not null,
 currency_code text not null check(currency_code='DOP'),
 entry_type text not null check(entry_type in ('purchase_charge','settlement','purchase_refund')),
 amount_minor bigint not null check(amount_minor<>0),
 balance_after_minor bigint not null check(balance_after_minor>=0),
 balance_version_after bigint not null check(balance_version_after>0),
 purchase_id uuid,
 settlement_id uuid,
 refund_id uuid,
 occurred_at timestamptz not null,
 cafeteria_id uuid not null,
 created_at timestamptz not null default now(),
 foreign key(account_id,school_id,receivable_account_id,currency_code)
  references public.staff_receivable_accounts(account_id,school_id,id,currency_code) on delete restrict,
 foreign key(account_id,school_id,cafeteria_id)
  references public.cafeterias(account_id,school_id,id) on delete restrict,
 foreign key(account_id,school_id,school_location_id,cafeteria_id,purchase_id)
  references public.purchases(account_id,school_id,school_location_id,cafeteria_id,id) on delete restrict,
 foreign key(account_id,school_id,receivable_account_id,settlement_id)
  references public.staff_receivable_settlements(account_id,school_id,receivable_account_id,id) on delete restrict,
 foreign key(account_id,school_id,school_location_id,cafeteria_id,receivable_account_id,settlement_id)
  references public.staff_receivable_settlements(account_id,school_id,school_location_id,cafeteria_id,receivable_account_id,id) on delete restrict,
 foreign key(account_id,school_id,school_location_id,cafeteria_id,refund_id,purchase_id,currency_code)
  references public.refunds(account_id,school_id,school_location_id,cafeteria_id,id,purchase_id,currency_code) on delete restrict,
 unique(receivable_account_id,balance_version_after),
 unique(settlement_id),
 unique(refund_id),
 check((entry_type='purchase_charge' and amount_minor>0 and purchase_id is not null
   and settlement_id is null and refund_id is null)
  or (entry_type='settlement' and amount_minor<0 and purchase_id is null
   and settlement_id is not null and refund_id is null)
  or (entry_type='purchase_refund' and amount_minor<0 and purchase_id is not null
   and settlement_id is null and refund_id is not null))
);
create unique index staff_receivable_charge_source_uq
 on public.staff_receivable_entries(receivable_account_id,purchase_id)
 where entry_type='purchase_charge';
create unique index staff_receivable_refund_source_uq
 on public.staff_receivable_entries(receivable_account_id,refund_id)
 where entry_type='purchase_refund';
create index staff_receivable_entries_account_time_idx
 on public.staff_receivable_entries(account_id,school_id,receivable_account_id,occurred_at desc,id);

alter table public.purchase_tenders drop constraint purchase_tenders_tender_type_check;
alter table public.purchase_tenders add constraint purchase_tenders_tender_type_check
 check(tender_type in ('cash','student_wallet','staff_credit'));
alter table public.financial_approvals drop constraint financial_approvals_tender_type_check;
alter table public.financial_approvals add constraint financial_approvals_tender_type_check
 check(tender_type in ('cash','student_wallet','staff_credit'));
alter table public.refunds drop constraint refunds_tender_type_check;
alter table public.refunds add constraint refunds_tender_type_check
 check(tender_type in ('cash','student_wallet','staff_credit'));
do $$
declare c record;
begin
 for c in select conname from pg_catalog.pg_constraint where conrelid='public.financial_approvals'::regclass
   and contype='c' and pg_catalog.pg_get_constraintdef(oid) like '%register_session_id%'
   and pg_catalog.pg_get_constraintdef(oid) like '%tender_type%' loop
  execute format('alter table public.financial_approvals drop constraint %I',c.conname);
 end loop;
 for c in select conname from pg_catalog.pg_constraint where conrelid='public.refunds'::regclass
   and contype='c' and pg_catalog.pg_get_constraintdef(oid) like '%register_id%'
   and pg_catalog.pg_get_constraintdef(oid) like '%tender_type%' loop
  execute format('alter table public.refunds drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.financial_approvals add constraint financial_approvals_tender_session_check
 check((tender_type='cash' and register_session_id is not null)
  or (tender_type in ('student_wallet','staff_credit') and register_session_id is null));
alter table public.refunds add constraint refunds_tender_session_check
 check((tender_type='cash' and register_id is not null and register_session_id is not null)
  or (tender_type in ('student_wallet','staff_credit') and register_id is null and register_session_id is null));

create function pikas_private.guard_staff_receivable_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  raise exception using errcode='23514',message='STAFF_RECEIVABLE_HISTORY_IMMUTABLE';
 end if;
 if tg_op='UPDATE' then
  if row(new.account_id,new.school_id,new.staff_affiliation_id,new.currency_code,new.created_at)
   is distinct from row(old.account_id,old.school_id,old.staff_affiliation_id,old.currency_code,old.created_at)
   or ((new.current_balance_minor is distinct from old.current_balance_minor
     or new.balance_version is distinct from old.balance_version) and pg_catalog.pg_trigger_depth()<2) then
   raise exception using errcode='23514',message='STAFF_RECEIVABLE_BALANCE_REQUIRES_POSTING';
  end if;
  if new.config_version<>old.config_version and new.config_version<>old.config_version+1 then
   raise exception using errcode='23514',message='INVALID_CONFIG_VERSION';
  end if;
  new.updated_at:=clock_timestamp();
 end if;
 return new;
end $$;

create function pikas_private.reject_staff_receivable_history_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception using errcode='23514',message='STAFF_RECEIVABLE_HISTORY_IMMUTABLE';
end $$;

create function pikas_private.guard_staff_receivable_entry() returns trigger
language plpgsql security definer set search_path='' as $$
declare account_row public.staff_receivable_accounts%rowtype;
begin
 if tg_op<>'INSERT' then
  raise exception using errcode='23514',message='STAFF_RECEIVABLE_HISTORY_IMMUTABLE';
 end if;
 select * into account_row from public.staff_receivable_accounts
  where id=new.receivable_account_id for update;
 if not found then raise exception using errcode='23503',message='STAFF_RECEIVABLE_ACCOUNT_MISSING'; end if;
 if new.account_id<>account_row.account_id or new.school_id<>account_row.school_id
  or new.currency_code<>account_row.currency_code
  or new.balance_version_after<>account_row.balance_version+1
  or new.balance_after_minor::numeric<>account_row.current_balance_minor::numeric+new.amount_minor::numeric
  or new.balance_after_minor<0 then
  raise exception using errcode='23514',message='STAFF_RECEIVABLE_BALANCE_MISMATCH';
 end if;
 update public.staff_receivable_accounts set current_balance_minor=new.balance_after_minor,
  balance_version=new.balance_version_after,updated_at=new.occurred_at where id=account_row.id;
 return new;
end $$;

create function pikas_private.post_staff_credit_charge() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.staff_receivable_accounts%rowtype; balance_after bigint;
begin
 select * into a from public.staff_receivable_accounts
  where id=new.receivable_account_id for update;
 if not found or not a.credit_enabled then
  raise exception using errcode='23514',message='STAFF_CREDIT_DISABLED';
 end if;
 if a.balance_version=9223372036854775807 then
  raise exception using errcode='22003',message='STAFF_RECEIVABLE_VERSION_EXHAUSTED';
 end if;
 if a.current_balance_minor::numeric+new.amount_minor::numeric>9223372036854775807::numeric then
  raise exception using errcode='22003',message='STAFF_RECEIVABLE_BALANCE_OVERFLOW';
 end if;
 balance_after:=a.current_balance_minor+new.amount_minor;
 if a.credit_limit_minor is not null and balance_after>a.credit_limit_minor then
  raise exception using errcode='23514',message='STAFF_CREDIT_LIMIT_EXCEEDED';
 end if;
 insert into public.staff_receivable_entries(account_id,school_id,school_location_id,receivable_account_id,currency_code,
  entry_type,amount_minor,balance_after_minor,balance_version_after,purchase_id,occurred_at,cafeteria_id)
 values(new.account_id,new.school_id,new.school_location_id,new.receivable_account_id,new.currency_code,'purchase_charge',
  new.amount_minor,balance_after,a.balance_version+1,new.purchase_id,new.posted_at,new.cafeteria_id);
 perform pikas_private.create_original_receipt_print_job(new.tender_id);
 return new;
end $$;
create trigger purchase_staff_credit_post after insert on public.purchase_staff_credit_tenders
 for each row execute function pikas_private.post_staff_credit_charge();

create trigger staff_receivable_accounts_guard before update or delete
 on public.staff_receivable_accounts for each row execute function pikas_private.guard_staff_receivable_account();
create trigger staff_receivable_entries_guard before insert or update or delete
 on public.staff_receivable_entries for each row execute function pikas_private.guard_staff_receivable_entry();

-- Additive replacement copied verbatim from frozen Phase 3B before narrow tender extensions.
create or replace function public.checkout_purchase(p_request jsonb)
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
  receivable public.staff_receivable_accounts%rowtype; receivable_balance_after bigint;
  staff_credit_tender_id uuid;
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
  elsif request_tender_type='staff_credit' then
    if (select count(*) from jsonb_object_keys(tender_json))<>1 then raise exception using errcode='22023',message='INVALID_STAFF_CREDIT_TENDER'; end if;
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

  if request_tender_type in ('student_wallet','staff_credit') and request_customer_id is null then
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
      if request_tender_type='staff_credit' then
        perform 1 from public.staff_campus_affiliations sca
         where sca.account_id=account_uuid and sca.school_id=school_uuid
          and sca.staff_affiliation_id=staff_uuid and sca.school_location_id=campus_uuid
          and sca.status='active' for share;
        if not found then raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE'; end if;
        perform 1 from pikas_private.role_capabilities rc
        join public.cafeteria_memberships m on m.scope_kind=rc.scope_kind and m.role_code=rc.role_code
        where m.id=session_row.operator_membership_id and m.person_id=actor
         and m.account_id=account_uuid and m.school_id=school_uuid and m.cafeteria_id=cafeteria_uuid
         and rc.capability='cafeteria:pos:staff_credit:purchase';
        if not found then raise exception using errcode='42501',message='STAFF_CREDIT_NOT_AUTHORIZED'; end if;
        select a.* into receivable from public.staff_receivable_accounts a
         where a.account_id=account_uuid and a.school_id=school_uuid
          and a.staff_affiliation_id=staff_uuid and a.currency_code=setting_currency for update;
        if not found or not receivable.credit_enabled then
         raise exception using errcode='23514',message='STAFF_CREDIT_DISABLED';
        end if;
      end if;
    else
      raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE';
    end if;
  end if;
  if request_tender_type='student_wallet' and student_uuid is null then
    raise exception using errcode='23514',message='CUSTOMER_INELIGIBLE';
  end if;
  if request_tender_type='staff_credit' and (staff_uuid is null or customer_type<>'staff') then
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
  if request_tender_type='staff_credit' and total_minor=0 then
    raise exception using errcode='22023',message='ZERO_TOTAL_STAFF_CREDIT_NOT_ALLOWED';
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
  elsif request_tender_type='staff_credit' then
    if receivable.id is null then
      raise exception using errcode='23514',message='STAFF_CREDIT_DISABLED';
    end if;
    if receivable.balance_version=9223372036854775807 then
      raise exception using errcode='22003',message='STAFF_RECEIVABLE_VERSION_EXHAUSTED';
    end if;
    if receivable.current_balance_minor::numeric+total_minor::numeric>9223372036854775807::numeric then
      raise exception using errcode='22003',message='STAFF_RECEIVABLE_BALANCE_OVERFLOW';
    end if;
    receivable_balance_after:=receivable.current_balance_minor+total_minor;
    if receivable.credit_limit_minor is not null
     and receivable_balance_after>receivable.credit_limit_minor then
      raise exception using errcode='23514',message='STAFF_CREDIT_LIMIT_EXCEEDED';
    end if;
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
  elsif request_tender_type='student_wallet' then
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
  else
    insert into public.purchase_tenders(account_id,school_id,cafeteria_id,purchase_id,currency_code,tender_type)
    values(account_uuid,school_uuid,cafeteria_uuid,purchase_uuid,setting_currency,'staff_credit')
    returning id into staff_credit_tender_id;
    insert into public.purchase_staff_credit_tenders(tender_id,account_id,school_id,school_location_id,
      cafeteria_id,purchase_id,receivable_account_id,currency_code,tender_type,amount_minor,posted_at)
    values(staff_credit_tender_id,account_uuid,school_uuid,campus_uuid,cafeteria_uuid,purchase_uuid,
      receivable.id,setting_currency,'staff_credit',total_minor,purchased_time);
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

-- Extend the frozen Phase 5B snapshot builder for the additive staff-credit tender.
create or replace function pikas_private.create_original_receipt_print_job(p_tender_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.purchases%rowtype; t public.purchase_tenders%rowtype; rs public.register_sessions%rowtype;
 cash public.purchase_cash_tenders%rowtype;
 item_count bigint; item_total numeric;
 snap jsonb; new_job uuid;
begin
 select t0.* into t from public.purchase_tenders t0 where t0.id=p_tender_id;
 if not found then return null; end if;
 select p0.* into p from public.purchases p0 where p0.id=t.purchase_id;
 if not found then return null; end if;
 select count(*),coalesce(sum(i.line_total_minor::numeric),0) into item_count,item_total
  from public.purchase_items i where i.purchase_id=p.id;
 if item_count=0 or item_total<>p.total_minor::numeric then return null; end if;
 if t.tender_type='cash' then
  select ct.* into cash from public.purchase_cash_tenders ct where ct.tender_id=t.id;
  if not found or exists(select 1 from public.purchase_wallet_tenders wt where wt.tender_id=t.id) then
   return null;
  end if;
 elsif t.tender_type='student_wallet' then
  if not exists(select 1 from public.purchase_wallet_tenders wt where wt.tender_id=t.id)
    or exists(select 1 from public.purchase_cash_tenders ct where ct.tender_id=t.id) then
   return null;
  end if;
 elsif t.tender_type='staff_credit' then
  perform 1 from public.purchase_staff_credit_tenders ct where ct.tender_id=t.id;
  if not found or exists(select 1 from public.purchase_cash_tenders ct where ct.tender_id=t.id)
    or exists(select 1 from public.purchase_wallet_tenders wt where wt.tender_id=t.id) then
   return null;
  end if;
 else
  return null;
 end if;
 select rs0.* into rs from public.register_sessions rs0 where rs0.id=p.register_session_id;
 if not found then return null; end if;
 select jsonb_build_object(
  'purchase_number',p.purchase_number::text,
  'purchased_at',p.purchased_at,
  'business_date',p.business_date,
  'business_timezone',p.business_timezone_snapshot,
  'currency_code',p.currency_code,
  'total_minor',p.total_minor::text,
  'school_name',s.name,
  'campus_name',sl.name,
  'cafeteria_name',c.name,
  'register_code',rs.register_code_snapshot,
  'register_name',rs.register_name_snapshot,
  'items',(select jsonb_agg(jsonb_build_object(
    'name',i.product_name_snapshot,'quantity',i.quantity,
    'unit_price_minor',i.unit_price_minor::text,'line_total_minor',i.line_total_minor::text)
    order by i.line_number) from public.purchase_items i where i.purchase_id=p.id),
  'tender',case when t.tender_type='cash' then jsonb_build_object(
    'type','cash','cash_received_minor',cash.cash_received_minor::text,'change_due_minor',cash.change_due_minor::text)
   when t.tender_type='staff_credit' then jsonb_build_object('type','staff_credit','label','Staff Credit')
   else jsonb_build_object('type','student_wallet') end
 ) into snap
 from public.schools s
 join public.school_locations sl on sl.account_id=s.account_id and sl.school_id=s.id and sl.id=p.school_location_id
 join public.cafeterias c on c.account_id=p.account_id and c.school_id=p.school_id
   and c.school_location_id=p.school_location_id and c.id=p.cafeteria_id
 where s.account_id=p.account_id and s.id=p.school_id;
 if snap is null or jsonb_typeof(snap->'items')<>'array' or jsonb_array_length(snap->'items')<1 then
  return null;
 end if;
 insert into public.receipt_print_jobs(account_id,school_id,school_location_id,cafeteria_id,purchase_id,
  job_kind,requested_by_person_id,requested_at,template_version,receipt_snapshot)
 values(p.account_id,p.school_id,p.school_location_id,p.cafeteria_id,p.id,'original',
  p.operator_person_id,p.purchased_at,1,snap) returning id into new_job;
 return new_job;
end $$;

-- Preserve frozen purchase completeness and recognize the third tender path.
create or replace function pikas_private.assert_purchase_complete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare purchase_key uuid; purchase_row public.purchases%rowtype; item_count bigint; item_total numeric;
  tender_count bigint; cash_count bigint; wallet_count bigint; staff_count bigint;
  debit_count bigint; ledger_count bigint; daily_count bigint; charge_count bigint;
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
  select count(*) into staff_count from public.purchase_tenders t
    join public.purchase_staff_credit_tenders st on st.tender_id=t.id where t.purchase_id=purchase_key;
  if (select t.tender_type from public.purchase_tenders t where t.purchase_id=purchase_key)='cash' then
    if cash_count<>1 or wallet_count<>0 or exists(
        select 1 from public.wallet_purchase_debits d where d.purchase_id=purchase_key) then raise exception using errcode='23514',message='cash_purchase_requires_only_cash_tender'; end if;
    if not exists(select 1 from public.purchase_tenders t join public.purchase_cash_tenders ct on ct.tender_id=t.id
        where t.purchase_id=purchase_key and ct.cash_received_minor>=purchase_row.total_minor
          and ct.change_due_minor::numeric=ct.cash_received_minor::numeric-purchase_row.total_minor::numeric) then
      raise exception using errcode='23514',message='cash_tender_amount_or_change_mismatch';
    end if;
  elsif (select t.tender_type from public.purchase_tenders t where t.purchase_id=purchase_key)='student_wallet' then
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
  else
    if staff_count<>1 or cash_count<>0 or wallet_count<>0
      or exists(select 1 from public.wallet_purchase_debits d where d.purchase_id=purchase_key)
      or purchase_row.total_minor=0 or purchase_row.customer_type_snapshot<>'staff'
      or purchase_row.staff_affiliation_id is null then
      raise exception using errcode='23514',message='staff_credit_purchase_requires_single_staff_tender';
    end if;
    select count(*) into charge_count
      from public.purchase_staff_credit_tenders st
      join public.staff_receivable_accounts a on a.id=st.receivable_account_id
      join public.staff_receivable_entries e on e.receivable_account_id=a.id
       and e.entry_type='purchase_charge' and e.purchase_id=purchase_key
      where st.purchase_id=purchase_key and st.account_id=purchase_row.account_id
       and st.school_id=purchase_row.school_id and st.cafeteria_id=purchase_row.cafeteria_id
       and st.amount_minor=purchase_row.total_minor and a.staff_affiliation_id=purchase_row.staff_affiliation_id
       and e.amount_minor=st.amount_minor and e.account_id=st.account_id and e.school_id=st.school_id;
    if charge_count<>1 then
      raise exception using errcode='23514',message='staff_credit_purchase_requires_matching_charge';
    end if;
    if not exists(select 1 from public.receipt_print_jobs j
      where j.purchase_id=purchase_key and j.job_kind='original' and j.source_job_id is null) then
      raise exception using errcode='23514',message='staff_credit_purchase_requires_original_receipt_job';
    end if;
  end if;
  return null;
end $$;
create constraint trigger purchase_staff_credit_tenders_complete after insert on public.purchase_staff_credit_tenders
  deferrable initially deferred for each row execute function pikas_private.assert_purchase_complete();

create function pikas_private.reject_staff_receivable_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception using errcode='23514',message='STAFF_RECEIVABLE_HISTORY_IMMUTABLE';
end $$;

create trigger staff_credit_tenders_immutable before update or delete on public.purchase_staff_credit_tenders
 for each row execute function pikas_private.reject_staff_receivable_mutation();
create trigger staff_receivable_settlements_immutable before update or delete on public.staff_receivable_settlements
 for each row execute function pikas_private.reject_staff_receivable_mutation();
create trigger staff_receivable_entries_immutable before update or delete on public.staff_receivable_entries
 for each row execute function pikas_private.reject_staff_receivable_mutation();
create trigger staff_credit_tenders_no_truncate before truncate on public.purchase_staff_credit_tenders
 for each statement execute function pikas_private.reject_staff_receivable_mutation();
create trigger staff_receivable_settlements_no_truncate before truncate on public.staff_receivable_settlements
 for each statement execute function pikas_private.reject_staff_receivable_mutation();
create trigger staff_receivable_entries_no_truncate before truncate on public.staff_receivable_entries
 for each statement execute function pikas_private.reject_staff_receivable_mutation();
create trigger staff_receivable_accounts_no_truncate before truncate on public.staff_receivable_accounts
 for each statement execute function pikas_private.reject_staff_receivable_mutation();

alter table public.staff_receivable_accounts enable row level security;
alter table public.staff_receivable_accounts force row level security;
alter table public.purchase_staff_credit_tenders enable row level security;
alter table public.purchase_staff_credit_tenders force row level security;
alter table public.staff_receivable_settlements enable row level security;
alter table public.staff_receivable_settlements force row level security;
alter table public.staff_receivable_entries enable row level security;
alter table public.staff_receivable_entries force row level security;

create policy staff_receivable_accounts_read on public.staff_receivable_accounts for select to authenticated
 using (pikas_private.has_capability('school:staff_receivables:read',account_id,school_id)
  or exists(select 1 from public.cafeterias c where c.account_id=staff_receivable_accounts.account_id
   and c.school_id=staff_receivable_accounts.school_id
   and pikas_private.has_capability('cafeteria:pos:staff_receivables:read',
    staff_receivable_accounts.account_id,staff_receivable_accounts.school_id,c.id)));
create policy purchase_staff_credit_tenders_read on public.purchase_staff_credit_tenders for select to authenticated
 using (pikas_private.has_capability('school:staff_receivables:read',account_id,school_id)
  or pikas_private.has_capability('cafeteria:pos:staff_receivables:read',account_id,school_id,cafeteria_id));
create policy staff_receivable_settlements_read on public.staff_receivable_settlements for select to authenticated
 using (pikas_private.has_capability('school:staff_receivables:read',account_id,school_id)
  or pikas_private.has_capability('cafeteria:pos:staff_receivables:read',account_id,school_id,cafeteria_id));
create policy staff_receivable_entries_read on public.staff_receivable_entries for select to authenticated
 using (pikas_private.has_capability('school:staff_receivables:read',account_id,school_id)
  or pikas_private.has_capability('cafeteria:pos:staff_receivables:read',account_id,school_id,cafeteria_id));

revoke all on public.staff_receivable_accounts,public.purchase_staff_credit_tenders,
 public.staff_receivable_settlements,public.staff_receivable_entries
 from public,anon,authenticated,service_role;

create function public.configure_staff_receivable_account(
 p_account_id uuid,p_school_id uuid,p_staff_affiliation_id uuid,p_expected_config_version integer,
 p_credit_enabled boolean,p_credit_limit_minor text,p_request_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; a public.staff_receivable_accounts%rowtype;
 limit_value bigint; fingerprint text; action_value text;
begin
 actor:=pikas_private.current_person_id();
 if actor is null or not pikas_private.has_capability('school:staff_receivables:manage',p_account_id,p_school_id) then
  raise exception using errcode='42501',message='STAFF_RECEIVABLE_NOT_AUTHORIZED';
 end if;
 if p_expected_config_version is null or p_expected_config_version<0 or p_credit_enabled is null
  or p_request_key is null or length(p_request_key) not between 16 and 128 then
  raise exception using errcode='22023',message='INVALID_STAFF_RECEIVABLE_CONFIGURATION';
 end if;
 if p_credit_limit_minor is not null then
  if p_credit_limit_minor !~ '^(0|[1-9][0-9]{0,18})$'
   or p_credit_limit_minor::numeric>9223372036854775807::numeric then
   raise exception using errcode='22023',message='INVALID_STAFF_CREDIT_LIMIT';
  end if;
  limit_value:=p_credit_limit_minor::bigint;
 end if;
 fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('school_id',p_school_id,
  'staff_affiliation_id',p_staff_affiliation_id,'credit_enabled',p_credit_enabled,
  'credit_limit_minor',p_credit_limit_minor)::text,'UTF8'),'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id::text||':'
  ||p_school_id::text||':'||p_staff_affiliation_id::text,20261008));
 perform 1 from public.school_staff_affiliations sf
  join public.persons person on person.id=sf.person_id and person.status='active'
  where sf.id=p_staff_affiliation_id and sf.account_id=p_account_id and sf.school_id=p_school_id
   and sf.status='active' for share of sf,person;
 if not found then raise exception using errcode='23514',message='STAFF_AFFILIATION_INACTIVE'; end if;
 select * into a from public.staff_receivable_accounts
  where account_id=p_account_id and school_id=p_school_id
   and staff_affiliation_id=p_staff_affiliation_id and currency_code='DOP' for update;
 if found then
  if a.config_actor_person_id=actor and a.config_request_key=p_request_key then
   if a.config_payload_fingerprint<>fingerprint then
    raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT';
   end if;
   return jsonb_build_object('account_id',a.id,'config_version',a.config_version,
    'credit_enabled',a.credit_enabled,'credit_limit_minor',a.credit_limit_minor::text,
    'current_balance_minor',a.current_balance_minor::text,'balance_version',a.balance_version);
  end if;
  if p_expected_config_version<>a.config_version then
   raise exception using errcode='40001',message='STAFF_RECEIVABLE_CONFIGURATION_STALE';
  end if;
  action_value:=case when a.credit_enabled is distinct from p_credit_enabled
     then case when p_credit_enabled then 'staff_credit_enabled' else 'staff_credit_disabled' end
     when a.credit_limit_minor is distinct from limit_value then 'staff_credit_limit_changed'
     else 'staff_receivable_configuration_updated' end;
  update public.staff_receivable_accounts set credit_enabled=p_credit_enabled,
   credit_limit_minor=limit_value,config_version=config_version+1,config_actor_person_id=actor,
   config_request_key=p_request_key,config_payload_fingerprint=fingerprint
   where id=a.id returning * into a;
 else
  if p_expected_config_version<>0 then
   raise exception using errcode='40001',message='STAFF_RECEIVABLE_CONFIGURATION_STALE';
  end if;
  insert into public.staff_receivable_accounts(account_id,school_id,staff_affiliation_id,currency_code,
   credit_enabled,credit_limit_minor,config_version,config_actor_person_id,config_request_key,config_payload_fingerprint)
  values(p_account_id,p_school_id,p_staff_affiliation_id,'DOP',p_credit_enabled,limit_value,1,actor,
   p_request_key,fingerprint) returning * into a;
  action_value:='staff_receivable_configured';
 end if;
 perform pikas_private.record_wallet_audit(actor,auth.uid(),'school_admin','school',p_account_id,p_school_id,null,
  action_value,'staff_receivable_accounts',a.id,jsonb_build_object('config_version',a.config_version,
   'credit_enabled',a.credit_enabled,'credit_limit_minor',a.credit_limit_minor::text));
 return jsonb_build_object('account_id',a.id,'config_version',a.config_version,
  'credit_enabled',a.credit_enabled,'credit_limit_minor',a.credit_limit_minor::text,
  'current_balance_minor',a.current_balance_minor::text,'balance_version',a.balance_version);
end $$;

create function public.settle_staff_receivable(
 p_receivable_account_id uuid,p_amount_minor text,p_method text,p_cafeteria_id uuid,
 p_operational_membership_id uuid,p_register_session_id uuid,p_reference text,p_note text,p_request_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; a public.staff_receivable_accounts%rowtype; member public.cafeteria_memberships%rowtype;
 scope record; rs public.register_sessions%rowtype;
 amount_value bigint; fingerprint text; settlement public.staff_receivable_settlements%rowtype;
 occurred timestamptz; new_balance bigint; new_version bigint; entry_id uuid;
begin
 actor:=pikas_private.current_person_id();
 if actor is null then raise exception using errcode='42501',message='STAFF_SETTLEMENT_NOT_AUTHORIZED'; end if;
 if p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]{0,18}$'
  or p_amount_minor::numeric>9223372036854775807::numeric
  or p_method not in ('cash','bank_transfer','other')
  or p_request_key is null or length(p_request_key) not between 16 and 128
  or (p_reference is not null and length(btrim(p_reference)) not between 1 and 160)
  or (p_note is not null and length(btrim(p_note)) not between 1 and 500) then
  raise exception using errcode='22023',message='INVALID_STAFF_SETTLEMENT';
 end if;
 amount_value:=p_amount_minor::bigint;
 select * into a from public.staff_receivable_accounts where id=p_receivable_account_id;
 if not found or not pikas_private.has_capability('cafeteria:pos:staff_receivables:settle',
  a.account_id,a.school_id,p_cafeteria_id) then
  raise exception using errcode='42501',message='STAFF_SETTLEMENT_NOT_AUTHORIZED';
 end if;
 select * into scope from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id);
 if not found or scope.account_id<>a.account_id or scope.school_id<>a.school_id then
  raise exception using errcode='42501',message='STAFF_SETTLEMENT_NOT_AUTHORIZED';
 end if;
 select * into member from public.cafeteria_memberships m where m.id=p_operational_membership_id
  and m.account_id=a.account_id and m.school_id=a.school_id and m.cafeteria_id=p_cafeteria_id
  and m.person_id=actor and m.status='active' for share;
 if not found or member.role_code not in ('pos_supervisor','cafeteria_admin') then
  raise exception using errcode='42501',message='STAFF_SETTLEMENT_NOT_AUTHORIZED';
 end if;
 if p_method='cash' then
  if member.role_code<>'pos_supervisor' or p_register_session_id is null then
   raise exception using errcode='42501',message='CASH_SETTLEMENT_REQUIRES_ASSIGNED_SUPERVISOR';
  end if;
  select * into rs from public.register_sessions where id=p_register_session_id
   and account_id=a.account_id and school_id=a.school_id and cafeteria_id=p_cafeteria_id
   and operator_person_id=actor and operator_membership_id=p_operational_membership_id
   and operator_role_code='pos_supervisor' and status='open' for update;
  if not found then raise exception using errcode='42501',message='CASH_SETTLEMENT_SESSION_INVALID'; end if;
  perform 1 from public.cafeteria_register_assignments
   where id=rs.assignment_id and account_id=rs.account_id and school_id=rs.school_id
    and cafeteria_id=rs.cafeteria_id and register_id=rs.register_id
    and cafeteria_membership_id=p_operational_membership_id and operator_person_id=actor
    and status='active' for share;
  if not found then raise exception using errcode='42501',message='CASH_SETTLEMENT_ASSIGNMENT_INVALID'; end if;
 elsif p_register_session_id is not null then
  raise exception using errcode='22023',message='NONCASH_SETTLEMENT_HAS_NO_REGISTER_SESSION';
 end if;
 fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('receivable_account_id',a.id,
  'amount_minor',p_amount_minor,'method',p_method,'cafeteria_id',p_cafeteria_id,
  'membership_id',p_operational_membership_id,'register_session_id',p_register_session_id,
  'reference',p_reference,'note',p_note)::text,'UTF8'),'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a.account_id::text||':'
  ||actor::text||':'||p_request_key,20261009));
 select * into settlement from public.staff_receivable_settlements
  where account_id=a.account_id and actor_person_id=actor and request_key=p_request_key;
 if found then
  if settlement.payload_fingerprint<>fingerprint then
   raise exception using errcode='23505',message='IDEMPOTENCY_CONFLICT';
  end if;
  select e.id,e.balance_after_minor,e.balance_version_after into entry_id,new_balance,new_version
   from public.staff_receivable_entries e where e.settlement_id=settlement.id;
  return jsonb_build_object('settlement_id',settlement.id,'amount_minor',settlement.amount_minor::text,
   'balance_after_minor',new_balance::text,'balance_version',new_version);
 end if;
 select * into a from public.staff_receivable_accounts where id=a.id for update;
 if a.current_balance_minor<amount_value then
  raise exception using errcode='23514',message='SETTLEMENT_EXCEEDS_AMOUNT_DUE';
 end if;
 if a.balance_version=9223372036854775807 then
  raise exception using errcode='22003',message='STAFF_RECEIVABLE_VERSION_EXHAUSTED';
 end if;
 occurred:=clock_timestamp();
 insert into public.staff_receivable_settlements(account_id,school_id,receivable_account_id,amount_minor,
  method,actor_person_id,actor_membership_id,actor_role_code,currency_code,occurred_at,cafeteria_id,
  school_location_id,register_id,register_session_id,reference,note,request_key,payload_fingerprint)
 values(a.account_id,a.school_id,a.id,amount_value,p_method,actor,p_operational_membership_id,member.role_code,
  a.currency_code,occurred,p_cafeteria_id,scope.school_location_id,
  case when p_method='cash' then rs.register_id else null end,
  p_register_session_id,p_reference,p_note,p_request_key,fingerprint)
 returning * into settlement;
 insert into public.staff_receivable_entries(account_id,school_id,school_location_id,receivable_account_id,currency_code,
  entry_type,amount_minor,balance_after_minor,balance_version_after,settlement_id,occurred_at,cafeteria_id)
 values(a.account_id,a.school_id,scope.school_location_id,a.id,a.currency_code,'settlement',-amount_value,
  a.current_balance_minor-amount_value,a.balance_version+1,settlement.id,occurred,p_cafeteria_id)
 returning id into entry_id;
 select e.balance_after_minor,e.balance_version_after into new_balance,new_version
  from public.staff_receivable_entries e where e.id=entry_id;
 return jsonb_build_object('settlement_id',settlement.id,'amount_minor',amount_value::text,
  'balance_after_minor',new_balance::text,'balance_version',new_version);
end $$;

create function public.get_staff_receivable_account(p_receivable_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid; a public.staff_receivable_accounts%rowtype; staff_name text;
begin
 actor:=pikas_private.current_person_id();
 select * into a from public.staff_receivable_accounts where id=p_receivable_account_id;
 if not found or actor is null or not (
  pikas_private.has_capability('school:staff_receivables:read',a.account_id,a.school_id)
  or   exists(select 1 from public.cafeterias c where c.account_id=a.account_id and c.school_id=a.school_id
   and pikas_private.has_capability('cafeteria:pos:staff_receivables:read',a.account_id,a.school_id,c.id))) then
  raise exception using errcode='42501',message='STAFF_RECEIVABLE_NOT_AUTHORIZED';
 end if;
 select p.display_name into staff_name from public.school_staff_affiliations sf
  join public.persons p on p.id=sf.person_id where sf.id=a.staff_affiliation_id
   and sf.account_id=a.account_id and sf.school_id=a.school_id;
 return jsonb_build_object('account_id',a.id,'staff_affiliation_id',a.staff_affiliation_id,
  'staff_display_name',staff_name,'currency_code',a.currency_code,'credit_enabled',a.credit_enabled,
  'credit_limit_minor',a.credit_limit_minor::text,'current_balance_minor',a.current_balance_minor::text,
  'balance_version',a.balance_version,'config_version',a.config_version,
  'recent_entries',(select coalesce(jsonb_agg(jsonb_build_object('entry_id',e.id,
   'entry_type',e.entry_type,'amount_minor',e.amount_minor::text,'balance_after_minor',e.balance_after_minor::text,
   'balance_version',e.balance_version_after,'occurred_at',e.occurred_at,'cafeteria_id',e.cafeteria_id,
   'purchase_number',p.purchase_number::text) order by e.balance_version_after desc),'[]'::jsonb)
   from (select * from public.staff_receivable_entries e where e.receivable_account_id=a.id
    order by e.balance_version_after desc limit 50) e
    left join public.purchases p on p.id=e.purchase_id));
end $$;

create function public.get_staff_credit_pos_projection(p_cafeteria_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid; cc public.cafeteria_customers%rowtype; staff public.school_staff_affiliations%rowtype;
 a public.staff_receivable_accounts%rowtype; actor_membership uuid;
begin
 actor:=pikas_private.current_person_id();
 select * into cc from public.cafeteria_customers where id=p_cafeteria_customer_id;
 if not found or cc.staff_affiliation_id is null or actor is null
  or not pikas_private.has_capability('cafeteria:pos:purchase:create',cc.account_id,cc.school_id,cc.cafeteria_id) then
  raise exception using errcode='42501',message='STAFF_CREDIT_NOT_AUTHORIZED';
 end if;
 select m.id into actor_membership from public.cafeteria_memberships m
  where m.account_id=cc.account_id and m.school_id=cc.school_id and m.cafeteria_id=cc.cafeteria_id
   and m.person_id=actor and m.status='active' and m.role_code='pos_supervisor'
  and exists(select 1 from pikas_private.role_capabilities rc where rc.scope_kind=m.scope_kind
   and rc.role_code=m.role_code and rc.capability='cafeteria:pos:staff_credit:purchase');
 if actor_membership is null then raise exception using errcode='42501',message='STAFF_CREDIT_NOT_AUTHORIZED'; end if;
 select * into staff from public.school_staff_affiliations sf
  where sf.id=cc.staff_affiliation_id and sf.account_id=cc.account_id
   and sf.school_id=cc.school_id and sf.status='active';
 select * into a from public.staff_receivable_accounts ar
  where ar.account_id=cc.account_id and ar.school_id=cc.school_id
   and ar.staff_affiliation_id=cc.staff_affiliation_id and ar.currency_code='DOP';
 return jsonb_build_object('customer_id',cc.id,'staff_display_name',
  (select p.display_name from public.persons p where p.id=staff.person_id),
  'eligible',cc.status='active' and staff.status='active' and a.id is not null and a.credit_enabled
   and exists(select 1 from public.persons p where p.id=staff.person_id and p.status='active')
   and exists(select 1 from public.staff_campus_affiliations sca
    join public.cafeterias cafe on cafe.id=cc.cafeteria_id
    where sca.account_id=cc.account_id and sca.school_id=cc.school_id
     and sca.staff_affiliation_id=cc.staff_affiliation_id
     and sca.school_location_id=cafe.school_location_id and sca.status='active'),
  'credit_enabled',coalesce(a.credit_enabled,false),'credit_limit_minor',a.credit_limit_minor::text,
  'current_balance_minor',coalesce(a.current_balance_minor,0)::text,
  'available_credit_minor',case when a.credit_limit_minor is null then null
   else greatest(a.credit_limit_minor-a.current_balance_minor,0)::text end);
end $$;

do $$
declare t text;
begin
 foreach t in array array['staff_receivable_accounts','purchase_staff_credit_tenders',
  'staff_receivable_settlements','staff_receivable_entries'] loop
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

revoke all on function pikas_private.guard_staff_receivable_account() from public,anon,authenticated,service_role;
revoke all on function pikas_private.reject_staff_receivable_history_mutation() from public,anon,authenticated,service_role;
revoke all on function pikas_private.guard_staff_receivable_entry() from public,anon,authenticated,service_role;
revoke all on function pikas_private.post_staff_credit_charge() from public,anon,authenticated,service_role;
revoke all on function pikas_private.reject_staff_receivable_mutation() from public,anon,authenticated,service_role;
revoke all on function pikas_private.create_original_receipt_print_job(uuid) from public,anon,authenticated,service_role;
revoke all on function pikas_private.assert_purchase_complete() from public,anon,authenticated,service_role;
grant execute on function public.configure_staff_receivable_account(uuid,uuid,uuid,integer,boolean,text,text) to authenticated;
grant execute on function public.settle_staff_receivable(uuid,text,text,uuid,uuid,uuid,text,text,text) to authenticated;
grant execute on function public.get_staff_receivable_account(uuid) to authenticated;
grant execute on function public.get_staff_credit_pos_projection(uuid) to authenticated;
revoke all on function public.configure_staff_receivable_account(uuid,uuid,uuid,integer,boolean,text,text) from public,anon,service_role;
revoke all on function public.settle_staff_receivable(uuid,text,text,uuid,uuid,uuid,text,text,text) from public,anon,service_role;
revoke all on function public.get_staff_receivable_account(uuid) from public,anon,service_role;
revoke all on function public.get_staff_credit_pos_projection(uuid) from public,anon,service_role;

-- Preserve the frozen Phase 3C refund RPC and add staff-credit receivable postings.
create or replace function public.create_purchase_refund(p_purchase_id uuid,p_amount_minor text,p_reason text,p_notes text,
 p_request_key text,p_operational_membership_id uuid,p_register_session_id uuid default null,p_approval_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.purchases; t public.purchase_tenders; r public.refunds; existing public.refunds;
 actor uuid; amount_value bigint; clean_notes text; semantic text; fingerprint text; role_value text; scope record;
 rs public.register_sessions; policy public.cafeteria_refund_policies; approval public.financial_approvals;
 wt public.purchase_wallet_tenders; wallet public.student_wallets; credit uuid;
 staff_tender public.purchase_staff_credit_tenders; receivable public.staff_receivable_accounts%rowtype;
 occurred timestamptz; day_value date;
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
 if (t.tender_type='cash' and p_register_session_id is null)
  or (t.tender_type in ('student_wallet','staff_credit') and p_register_session_id is not null) then
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
 elsif t.tender_type='staff_credit' then
 select * into staff_tender from public.purchase_staff_credit_tenders st where st.tender_id=t.id;
 if not found or staff_tender.purchase_id<>p.id or staff_tender.amount_minor<>p.total_minor
  or staff_tender.currency_code<>p.currency_code then
  raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR';
 end if;
 select * into receivable from public.staff_receivable_accounts a
  where a.id=staff_tender.receivable_account_id and a.account_id=p.account_id
   and a.school_id=p.school_id and a.staff_affiliation_id=p.staff_affiliation_id
   and a.currency_code=p.currency_code for update;
 if not found then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 if receivable.current_balance_minor<amount_value then
  raise exception using errcode='23514',message='STAFF_CREDIT_REFUND_EXCEEDS_AMOUNT_DUE';
 end if;
 if receivable.balance_version=9223372036854775807 then
  raise exception using errcode='22003',message='STAFF_RECEIVABLE_VERSION_EXHAUSTED';
 end if;
 new_balance:=receivable.current_balance_minor-amount_value;
 new_version:=receivable.balance_version+1;
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
 elsif t.tender_type='student_wallet' then
 update public.student_wallets set current_balance_minor=new_balance,balance_version=new_version where id=wallet.id;
 insert into public.wallet_refund_credits(refund_id,account_id,school_id,cafeteria_id,purchase_id,original_tender_id,original_purchase_debit_id,
 student_id,wallet_id,currency_code,amount_minor,actor_person_id,posted_at)
 values(r.id,p.account_id,p.school_id,p.cafeteria_id,p.id,t.id,wt.wallet_purchase_debit_id,p.student_id,wallet.id,p.currency_code,amount_value,actor,occurred)
 returning id into credit;
 insert into public.wallet_ledger_entries(account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,balance_after_minor,
 balance_version_after,refund_credit_id,occurred_at) values(p.account_id,p.school_id,wallet.id,p.currency_code,'refund',amount_value,new_balance,new_version,credit,occurred);
 else
 insert into public.staff_receivable_entries(account_id,school_id,school_location_id,receivable_account_id,
  currency_code,entry_type,amount_minor,balance_after_minor,balance_version_after,purchase_id,refund_id,
  occurred_at,cafeteria_id)
 values(p.account_id,p.school_id,p.school_location_id,receivable.id,receivable.currency_code,'purchase_refund',
  -amount_value,new_balance,new_version,p.id,r.id,occurred,p.cafeteria_id);
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


-- Extend deferred refund completeness with a receivable posting, preserving existing checks.
create or replace function pikas_private.assert_refund_complete() returns trigger
language plpgsql security definer set search_path='' as $$
declare rid uuid; r public.refunds; p public.purchases; a public.financial_approvals;
 cash_count bigint; wallet_count bigint; staff_count bigint; spend_count bigint;
begin
 if tg_table_name='refunds' then rid:=new.id; else rid:=new.refund_id; end if;
 select * into r from public.refunds where id=rid;
 if not found then raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 select * into p from public.purchases where id=r.purchase_id;
 select count(*) into cash_count from public.refund_cash_outflows where refund_id=rid;
 select count(*) into wallet_count from public.wallet_refund_credits where refund_id=rid;
 select count(*) into staff_count from public.staff_receivable_entries
  where refund_id=rid and entry_type='purchase_refund';
 if r.tender_type='cash' then
 if cash_count<>1 or wallet_count<>0 or not exists(select 1 from public.refund_cash_outflows c
 where c.refund_id=rid and c.original_cash_tender_id=r.original_tender_id and c.register_session_id=r.register_session_id
 and c.amount_minor=r.amount_minor and c.currency_code=r.currency_code) then
 raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 elsif r.tender_type='student_wallet' then
 if wallet_count<>1 or cash_count<>0 or not exists(select 1 from public.wallet_refund_credits c
 join public.purchase_wallet_tenders t on t.tender_id=c.original_tender_id
 where c.refund_id=rid and c.original_tender_id=r.original_tender_id and c.purchase_id=r.purchase_id
 and c.original_purchase_debit_id=t.wallet_purchase_debit_id and c.wallet_id=t.wallet_id
 and c.student_id=t.student_id and c.student_id=p.student_id and c.currency_code=r.currency_code
 and c.amount_minor=r.amount_minor and c.actor_person_id=r.actor_person_id and c.posted_at=r.occurred_at) then
 raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR'; end if;
 else
 if staff_count<>1 or cash_count<>0 or wallet_count<>0 or not exists(
  select 1 from public.staff_receivable_entries e
  join public.purchase_staff_credit_tenders st on st.purchase_id=e.purchase_id
   and st.receivable_account_id=e.receivable_account_id
  where e.refund_id=rid and e.purchase_id=r.purchase_id and e.account_id=r.account_id
   and e.school_id=r.school_id and e.school_location_id=r.school_location_id
   and e.cafeteria_id=r.cafeteria_id and e.currency_code=r.currency_code
   and e.amount_minor=-r.amount_minor and e.entry_type='purchase_refund'
   and st.tender_id=r.original_tender_id and st.amount_minor=p.total_minor) then
  raise exception using errcode='23514',message='REFUND_INTEGRITY_ERROR';
 end if;
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
create constraint trigger staff_receivable_refunds_complete after insert on public.staff_receivable_entries
 deferrable initially deferred for each row when(new.entry_type='purchase_refund')
 execute function pikas_private.assert_refund_complete();

commit;
