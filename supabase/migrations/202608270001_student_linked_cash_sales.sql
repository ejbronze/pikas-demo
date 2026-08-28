-- Student-linked cash sales and future audited credit adjustments.
alter table public.purchases drop constraint if exists purchases_payment_scope;
alter table public.purchases add column if not exists balance_impact_minor bigint not null default 0;
alter table public.purchases add column if not exists cash_register_impact_minor bigint not null default 0;
alter table public.purchases add column if not exists cash_received_minor bigint;
alter table public.purchases add column if not exists change_provided_minor bigint;
alter table public.purchases add column if not exists cashier_id uuid references public.profiles(id);
alter table public.purchases add column if not exists pos_station_id text;
alter table public.purchases add column if not exists student_association text not null default 'required' check(student_association in ('required','student_linked','general_sale'));
update public.purchases set balance_impact_minor=-total_minor where payment_method='student_wallet';
update public.purchases set cash_register_impact_minor=total_minor, cash_received_minor=total_minor, change_provided_minor=0 where payment_method='cash';
update public.purchases set student_association='general_sale' where payment_method='cash' and student_id is null;
alter table public.purchases add constraint purchases_student_association check(
  (student_association in ('required','student_linked') and student_id is not null) or
  (student_association='general_sale' and payment_method='cash' and student_id is null and wallet_id is null)
);
alter table public.purchases add constraint purchases_payment_impacts check (
  (payment_method = 'student_wallet' and wallet_id is not null and balance_impact_minor = -total_minor and cash_register_impact_minor = 0 and cash_received_minor is null and change_provided_minor is null)
  or
  (payment_method = 'cash' and wallet_id is null and balance_impact_minor = 0 and cash_register_impact_minor = total_minor and cash_received_minor >= total_minor and change_provided_minor = cash_received_minor - total_minor)
);

create table public.cafeteria_operational_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  cash_credit_conversion_enabled boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.cafeteria_operational_settings enable row level security;
create policy cafeteria_settings_admin_read on public.cafeteria_operational_settings for select using (
  exists(select 1 from public.organization_memberships m where m.organization_id=organization_id and m.profile_id=auth.uid() and m.role='cafeteria_admin' and m.status='active')
);

create table public.student_credit_adjustments (
  id uuid primary key default gen_random_uuid(),
  cafeteria_organization_id uuid not null references public.organizations(id),
  student_id uuid not null references public.students(id),
  source_purchase_id uuid references public.purchases(id),
  amount_minor bigint not null check(amount_minor > 0),
  reason text not null check(length(trim(reason)) > 0),
  requested_by uuid not null references public.profiles(id),
  approved_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.student_credit_adjustments enable row level security;
create policy credit_adjustments_scoped_read on public.student_credit_adjustments for select using (
  public.can_access_student(student_id) or exists(
    select 1 from public.organization_memberships m where m.organization_id=cafeteria_organization_id and m.profile_id=auth.uid() and m.role='cafeteria_admin' and m.status='active'
  )
);

comment on column public.cafeteria_operational_settings.cash_credit_conversion_enabled is 'Disabled by default. Enabling only permits a separate authorized and audited credit adjustment; it never changes normal cash-sale behavior.';
comment on column public.purchases.student_id is 'Transaction owner for PIKAS-account and student-linked cash purchases; null only for general cash sales.';
