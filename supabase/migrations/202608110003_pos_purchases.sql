-- Functional cafeteria purchases. All monetary values are DOP minor units.
create type public.purchase_status as enum ('completed','reversed');

create table public.purchases(
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  student_id uuid not null references public.students(id),
  wallet_id uuid not null references public.wallets(id),
  completed_by uuid not null references public.profiles(id),
  status public.purchase_status not null default 'completed',
  currency char(3) not null default 'DOP',
  total_minor bigint not null check(total_minor > 0),
  idempotency_key text not null unique,
  ledger_entry_id uuid unique references public.wallet_ledger_entries(id),
  created_at timestamptz not null default now()
);

create table public.purchase_items(
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id),
  menu_item_id uuid not null references public.menu_items(id),
  item_name text not null,
  quantity integer not null check(quantity between 1 and 20),
  unit_price_minor bigint not null check(unit_price_minor >= 0),
  line_total_minor bigint generated always as (quantity::bigint * unit_price_minor) stored
);

create index purchases_school_created_idx on public.purchases(school_id,created_at desc);
create index purchases_student_created_idx on public.purchases(student_id,created_at desc);
create index purchase_items_purchase_idx on public.purchase_items(purchase_id);

comment on table public.purchases is 'Immutable completed cafeteria sales. Reversals retain the original record and use compensating ledger entries.';
comment on column public.purchases.idempotency_key is 'Client-generated retry key, unique across completed checkout attempts.';
comment on table public.purchase_items is 'Authoritative point-in-time item names, quantities, and prices for a cafeteria sale.';

alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
create policy purchases_scoped_read on public.purchases for select using(public.can_access_student(student_id));
create policy purchase_items_scoped_read on public.purchase_items for select using(exists(select 1 from public.purchases p where p.id=purchase_id and public.can_access_student(p.student_id)));
-- There are intentionally no client INSERT, UPDATE, or DELETE policies. Checkout is RPC-only.

create or replace function public.prevent_completed_financial_mutation() returns trigger
language plpgsql set search_path=public as $$
begin
  if old.status in ('completed','reversed') then raise exception 'completed_financial_record_is_immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end$$;

create trigger immutable_completed_ledger before update or delete on public.wallet_ledger_entries
for each row execute function public.prevent_completed_financial_mutation();
create trigger immutable_completed_purchase before update or delete on public.purchases
for each row execute function public.prevent_completed_financial_mutation();

create or replace function public.complete_pos_purchase(
  p_student_code text,
  p_items jsonb,
  p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.profiles;
  v_student public.students;
  v_wallet public.wallets;
  v_controls public.student_controls;
  v_purchase_id uuid;
  v_existing uuid;
  v_balance bigint;
  v_spent_today bigint;
  v_total bigint := 0;
  v_line jsonb;
  v_item public.menu_items;
  v_quantity integer;
  v_line_total bigint;
  v_allergen text;
  v_ledger_id uuid;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then raise exception 'invalid_idempotency_key'; end if;
  select id into v_existing from public.purchases where idempotency_key=p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'empty_cart'; end if;

  select * into v_actor from public.profiles where id=auth.uid();
  if v_actor.id is null or v_actor.role<>'pos' then raise exception 'not_authorized'; end if;
  select * into v_student from public.students where student_code=upper(trim(p_student_code)) and status='active' and school_id=v_actor.school_id for update;
  if v_student.id is null then raise exception 'student_not_found'; end if;
  select * into v_wallet from public.wallets where student_id=v_student.id and status='active' for update;
  if v_wallet.id is null then raise exception 'wallet_inactive'; end if;
  select * into v_controls from public.student_controls where student_id=v_student.id;
  if v_controls.student_id is null then raise exception 'controls_missing'; end if;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_line->>'quantity')::integer;
    if v_quantity<1 or v_quantity>20 then raise exception 'invalid_quantity'; end if;
    select * into v_item from public.menu_items where id=(v_line->>'itemId')::uuid and school_id=v_actor.school_id;
    if v_item.id is null then raise exception 'item_not_found'; end if;
    if not v_item.available then raise exception 'item_unavailable'; end if;
    if exists(select 1 from public.blocked_products b where b.student_id=v_student.id and lower(b.product_name)=lower(v_item.name)) then raise exception 'blocked_product'; end if;
    select a.name into v_allergen from public.student_allergies sa join public.allergies a on a.id=sa.allergy_id where sa.student_id=v_student.id and a.id=any(v_item.allergen_ids) limit 1;
    if v_allergen is not null then raise exception 'allergy:%',v_allergen; end if;
    v_line_total := v_item.price_minor*v_quantity;
    v_total := v_total+v_line_total;
  end loop;

  select coalesce(balance_minor,0) into v_balance from public.wallet_balances where wallet_id=v_wallet.id;
  select coalesce(sum(amount_minor),0) into v_spent_today from public.wallet_ledger_entries where wallet_id=v_wallet.id and transaction_type='cafeteria_purchase' and direction='debit' and status='completed' and created_at>=date_trunc('day',now());
  if v_total>v_balance then raise exception 'insufficient_funds'; end if;
  if v_total>v_controls.per_transaction_limit_minor then raise exception 'per_transaction_limit'; end if;
  if v_spent_today+v_total>v_controls.daily_spending_limit_minor then raise exception 'daily_limit'; end if;

  v_purchase_id := gen_random_uuid();
  insert into public.wallet_ledger_entries(wallet_id,transaction_type,amount_minor,direction,status,description,category,external_reference,idempotency_key,created_by)
  values(v_wallet.id,'cafeteria_purchase',v_total,'debit','completed','Compra en cafetería','Cafetería',v_purchase_id::text,p_idempotency_key||':ledger',v_actor.id) returning id into v_ledger_id;
  insert into public.purchases(id,school_id,student_id,wallet_id,completed_by,total_minor,idempotency_key,ledger_entry_id)
  values(v_purchase_id,v_actor.school_id,v_student.id,v_wallet.id,v_actor.id,v_total,p_idempotency_key,v_ledger_id);
  for v_line in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_line->>'quantity')::integer;
    select * into v_item from public.menu_items where id=(v_line->>'itemId')::uuid;
    insert into public.purchase_items(purchase_id,menu_item_id,item_name,quantity,unit_price_minor) values(v_purchase_id,v_item.id,v_item.name,v_quantity,v_item.price_minor);
  end loop;
  return v_purchase_id;
exception when unique_violation then
  select id into v_existing from public.purchases where idempotency_key=p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  raise;
end$$;

revoke all on function public.complete_pos_purchase(text,jsonb,text) from public;
grant execute on function public.complete_pos_purchase(text,jsonb,text) to authenticated;
