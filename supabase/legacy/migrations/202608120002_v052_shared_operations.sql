-- PIKAS v0.5.2 shared operational data. Development/preview only until reviewed.
alter table public.blocked_products add column if not exists menu_item_id uuid references public.menu_items(id);
create unique index if not exists blocked_products_student_menu_idx on public.blocked_products(student_id,menu_item_id) where menu_item_id is not null;

alter table public.purchases alter column student_id drop not null;
alter table public.purchases alter column wallet_id drop not null;
alter table public.purchases add column if not exists payment_method text not null default 'student_wallet' check(payment_method in ('student_wallet','cash'));
alter table public.purchases add constraint purchases_payment_scope check(
  (payment_method='cash' and student_id is null and wallet_id is null) or
  (payment_method='student_wallet' and student_id is not null and wallet_id is not null)
);

create table public.administrative_audit_events(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references public.profiles(id), action text not null, subject_type text not null,
  subject_id uuid, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.administrative_audit_events enable row level security;
create policy audit_organization_read on public.administrative_audit_events for select using(
  exists(select 1 from public.organization_memberships m where m.profile_id=auth.uid() and m.organization_id=organization_id and m.status='active')
);

drop policy if exists purchases_scoped_read on public.purchases;
create policy purchases_scoped_read on public.purchases for select using(
  (student_id is not null and public.can_access_student(student_id)) or
  exists(select 1 from public.organization_memberships m where m.profile_id=auth.uid() and m.role in ('cafeteria_admin','pos_operator') and m.status='active')
);

comment on column public.purchases.payment_method is 'Separates cash sales from student-wallet charges; cash never references a student or wallet.';
