-- 0.6 financial foundation. LOCAL REVIEW ONLY: no financial RPC is enabled by this migration.
-- Existing rows retain unknown organization/location until explicitly reconciled from source records.
alter table public.purchases add column if not exists cafeteria_organization_id uuid references public.organizations(id);
alter table public.purchases add column if not exists location_id uuid references public.cafeteria_locations(id);
alter table public.student_controls add column if not exists daily_limit_enabled boolean not null default true;
alter table public.cafeteria_operational_settings
  add column show_shift_sales boolean not null default true,
  add column show_transaction_count boolean not null default true,
  add column show_shift_start boolean not null default true,
  add column show_register boolean not null default true,
  add column allow_cashier_refunds boolean not null default false,
  add column allow_partial_refunds boolean not null default false,
  add column require_refund_reason boolean not null default true,
  add column require_refund_approval boolean not null default true,
  add column allow_parent_refund_requests boolean not null default false;

create table public.financial_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check(event_type in ('replenishment','refund','correction','void')),
  cafeteria_organization_id uuid not null references public.organizations(id),
  location_id uuid not null references public.cafeteria_locations(id),
  register_id text not null,
  student_id uuid references public.students(id),
  original_purchase_id uuid references public.purchases(id),
  amount_minor bigint not null check(amount_minor >= 0),
  wallet_impact_minor bigint not null,
  cash_impact_minor bigint not null,
  balance_before_minor bigint check(balance_before_minor >= 0),
  balance_after_minor bigint check(balance_after_minor >= 0),
  destination text not null check(destination in ('wallet','cash','none')),
  reason text not null,
  initiated_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  idempotency_key text not null unique check(length(idempotency_key) >= 8),
  created_at timestamptz not null default now(),
  check ((event_type='refund' and original_purchase_id is not null and amount_minor>0) or (event_type<>'refund' and original_purchase_id is null)),
  check (balance_after_minor is null or balance_after_minor=balance_before_minor+wallet_impact_minor),
  check (event_type<>'void' or (amount_minor=0 and wallet_impact_minor=0 and cash_impact_minor=0 and destination='none')),
  check (event_type<>'replenishment' or (student_id is not null and amount_minor>0 and wallet_impact_minor=amount_minor and cash_impact_minor in (0,amount_minor) and destination='wallet')),
  check (event_type<>'refund' or (destination='wallet' and wallet_impact_minor=amount_minor and cash_impact_minor=0 and student_id is not null) or (destination='cash' and wallet_impact_minor=0 and cash_impact_minor=-amount_minor))
);
create index financial_events_original_idx on public.financial_events(original_purchase_id);
create index financial_events_scope_idx on public.financial_events(cafeteria_organization_id,location_id,created_at);
create function public.reject_financial_event_mutation() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'financial_events_are_append_only'; end $$;
create trigger financial_events_immutable before update or delete on public.financial_events for each row execute function public.reject_financial_event_mutation();
alter table public.financial_events enable row level security;

-- Explicitly distinguish family/student access from operational organization/location access.
create function public.can_read_pos_finance(target_student uuid, target_org uuid, target_location uuid)
returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from students s where s.id=target_student and
  (s.profile_id=auth.uid() or exists(select 1 from family_members fm where fm.family_id=s.family_id and fm.profile_id=auth.uid())))
  or exists(select 1 from organization_memberships m where m.profile_id=auth.uid() and m.status='active'
    and m.organization_id=target_org and m.role in ('cafeteria_admin','pos_operator')
    and (m.location_id=target_location or (m.location_id is null and m.role='cafeteria_admin')))
$$;
revoke all on function public.can_read_pos_finance(uuid,uuid,uuid) from public;
grant execute on function public.can_read_pos_finance(uuid,uuid,uuid) to authenticated;
drop policy if exists purchases_scoped_read on public.purchases;
create policy purchases_scoped_read on public.purchases for select to authenticated using(public.can_read_pos_finance(student_id,cafeteria_organization_id,location_id));
drop policy if exists purchase_items_scoped_read on public.purchase_items;
create policy purchase_items_scoped_read on public.purchase_items for select to authenticated using(exists(select 1 from public.purchases p where p.id=purchase_id));
create policy financial_events_read on public.financial_events for select to authenticated using(public.can_read_pos_finance(student_id,cafeteria_organization_id,location_id));
-- No direct client writes. RPCs must lock wallet/student/original purchase, authorize first,
-- recompute same-business-day net spend and cumulative refunds, then atomically write ledger + event.
revoke insert,update,delete on public.financial_events from anon,authenticated;

create table public.parent_refund_requests (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id),
  requested_by uuid not null references public.profiles(id),
  status text not null default 'requested' check(status in ('requested','under_review','approved','refunded','declined')),
  financial_event_id uuid references public.financial_events(id),
  created_at timestamptz not null default now(),
  check((status='refunded')=(financial_event_id is not null))
);
alter table public.parent_refund_requests enable row level security;
-- Prepared but disabled: no client policies or mutations, and approval alone never moves funds.
revoke all on public.parent_refund_requests from anon,authenticated;
comment on table public.financial_events is '0.6 foundation only. New events compensate completed purchases. Production writer RPC, concurrency and RLS verification required before enabling.';
