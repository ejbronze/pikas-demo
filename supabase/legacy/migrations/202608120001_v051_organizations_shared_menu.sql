-- PIKAS v0.5.1 development foundation. Apply only to a development/preview project.
alter type public.user_role add value if not exists 'school_admin';
alter type public.user_role add value if not exists 'cafeteria_admin';
alter type public.user_role add value if not exists 'pos_operator';

create type public.organization_type as enum ('school','cafeteria');
create table public.organizations(
  id uuid primary key default gen_random_uuid(), type organization_type not null,
  name text not null, school_id uuid references public.schools(id), status record_status not null default 'active', created_at timestamptz not null default now()
);
create table public.cafeteria_locations(
  id uuid primary key default gen_random_uuid(), cafeteria_id uuid not null references public.organizations(id),
  name text not null, status record_status not null default 'active', unique(cafeteria_id,name)
);
create table public.organization_memberships(
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id), location_id uuid references public.cafeteria_locations(id),
  role text not null check(role in ('school_admin','cafeteria_admin','pos_operator','parent','student')), status record_status not null default 'active', unique(profile_id,organization_id,role)
);
create table public.partnerships(
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.organizations(id),
  cafeteria_id uuid not null references public.organizations(id), location_id uuid references public.cafeteria_locations(id),
  status text not null check(status in ('pending','active','suspended','rejected','revoked')),
  unique(school_id,cafeteria_id,location_id)
);

alter table public.menu_items add column if not exists cafeteria_id uuid references public.organizations(id);
alter table public.menu_items add column if not exists location_id uuid references public.cafeteria_locations(id);
alter table public.menu_items add column if not exists ingredients text[] not null default '{}';
alter table public.menu_items add column if not exists allergens text[] not null default '{}';
alter table public.menu_items add column if not exists dietary_tags text[] not null default '{}';

alter table public.organizations enable row level security;
alter table public.cafeteria_locations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.partnerships enable row level security;
create policy memberships_self_read on public.organization_memberships for select using(profile_id=auth.uid());
create policy organizations_member_read on public.organizations for select using(exists(select 1 from public.organization_memberships m where m.organization_id=id and m.profile_id=auth.uid() and m.status='active'));
create policy locations_member_read on public.cafeteria_locations for select using(exists(select 1 from public.organization_memberships m where m.organization_id=cafeteria_id and m.profile_id=auth.uid() and m.status='active'));
create policy partnerships_member_read on public.partnerships for select using(exists(select 1 from public.organization_memberships m where m.profile_id=auth.uid() and m.organization_id in (school_id,cafeteria_id) and m.status='active'));

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select using(id=auth.uid());
drop policy if exists menu_school_read on public.menu_items;
create policy menu_shared_read on public.menu_items for select to authenticated using(
  school_id=(select school_id from public.profiles where id=auth.uid()) or
  exists(select 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id where m.profile_id=auth.uid() and m.status='active' and (m.organization_id=cafeteria_id or (m.role='school_admin' and o.school_id=menu_items.school_id)))
);
create policy menu_cafeteria_write on public.menu_items for update to authenticated using(
  exists(select 1 from public.organization_memberships m where m.profile_id=auth.uid() and m.organization_id=cafeteria_id and m.role='cafeteria_admin' and m.status='active')
) with check(
  exists(select 1 from public.organization_memberships m where m.profile_id=auth.uid() and m.organization_id=cafeteria_id and m.role='cafeteria_admin' and m.status='active')
);
create policy menu_cafeteria_insert on public.menu_items for insert to authenticated with check(
  exists(select 1 from public.organization_memberships m where m.profile_id=auth.uid() and m.organization_id=cafeteria_id and m.role='cafeteria_admin' and m.status='active')
);

create or replace function public.current_role() returns user_role language sql stable security definer set search_path=public as $$select role from profiles where id=auth.uid()$$;
create or replace function public.can_access_student(target uuid) returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from students s left join family_members fm on fm.family_id=s.family_id where s.id=target and (
  s.profile_id=auth.uid() or fm.profile_id=auth.uid() or
  (public.current_role()::text='school_admin' and s.school_id=(select school_id from profiles where id=auth.uid())) or
  (public.current_role()::text='pos_operator' and s.school_id=(select school_id from profiles where id=auth.uid()))
))$$;
