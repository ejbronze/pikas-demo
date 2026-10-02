-- Phase 4B: cafeteria menus, service schedules, and authoritative saleability.
begin;

create table public.cafeteria_menus (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  name_key text generated always as (lower(btrim(name))) stored,
  description text not null default '' check (length(description)<=500),
  display_order integer not null default 0,
  status text not null default 'active' check (status in ('active','archived')),
  version integer not null default 1 check (version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,cafeteria_id)
    references public.cafeterias(account_id,school_id,id) on delete restrict,
  unique (account_id,school_id,cafeteria_id,id),
  unique (cafeteria_id,name_key)
);
create index cafeteria_menus_order_idx
  on public.cafeteria_menus(account_id,school_id,cafeteria_id,status,display_order,name_key,id);

create table public.cafeteria_menu_products (
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  menu_id uuid not null,
  product_id uuid not null,
  display_order integer not null default 0,
  active boolean not null default true,
  version integer not null default 1 check (version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cafeteria_id,menu_id,product_id),
  foreign key (account_id,school_id,cafeteria_id)
    references public.cafeterias(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,menu_id)
    references public.cafeteria_menus(account_id,school_id,cafeteria_id,id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,product_id)
    references public.cafeteria_products(account_id,school_id,cafeteria_id,id) on delete restrict
);
create index cafeteria_menu_products_order_idx
  on public.cafeteria_menu_products(account_id,school_id,cafeteria_id,menu_id,active,display_order,product_id);
create index cafeteria_menu_products_product_idx
  on public.cafeteria_menu_products(account_id,school_id,cafeteria_id,product_id,active,menu_id);

create table public.cafeteria_service_shifts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  menu_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  start_time time without time zone not null,
  end_time time without time zone not null,
  enabled boolean not null default true,
  version integer not null default 1 check (version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time<end_time),
  foreign key (account_id,school_id,cafeteria_id)
    references public.cafeterias(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,menu_id)
    references public.cafeteria_menus(account_id,school_id,cafeteria_id,id) on delete restrict,
  unique (account_id,school_id,cafeteria_id,id)
);
create index cafeteria_service_shifts_window_idx
  on public.cafeteria_service_shifts(account_id,school_id,cafeteria_id,enabled,start_time,end_time,id);

create table public.cafeteria_service_shift_days (
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  service_shift_id uuid not null,
  weekday_iso smallint not null check (weekday_iso between 1 and 7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (service_shift_id,weekday_iso),
  foreign key (account_id,school_id,cafeteria_id)
    references public.cafeterias(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,service_shift_id)
    references public.cafeteria_service_shifts(account_id,school_id,cafeteria_id,id) on delete restrict
);
create index cafeteria_service_shift_days_weekday_idx
  on public.cafeteria_service_shift_days(account_id,school_id,cafeteria_id,weekday_iso,service_shift_id);

do $$
declare t text;
begin
  foreach t in array array['cafeteria_menus','cafeteria_menu_products','cafeteria_service_shifts','cafeteria_service_shift_days'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

grant select on public.cafeteria_menus,public.cafeteria_menu_products,
  public.cafeteria_service_shifts,public.cafeteria_service_shift_days to authenticated;
create policy cafeteria_menus_read on public.cafeteria_menus for select to authenticated
using (pikas_private.has_capability('cafeteria:catalog:read',account_id,school_id,cafeteria_id));
create policy cafeteria_menu_products_read on public.cafeteria_menu_products for select to authenticated
using (pikas_private.has_capability('cafeteria:catalog:read',account_id,school_id,cafeteria_id));
create policy cafeteria_service_shifts_read on public.cafeteria_service_shifts for select to authenticated
using (pikas_private.has_capability('cafeteria:catalog:read',account_id,school_id,cafeteria_id));
create policy cafeteria_service_shift_days_read on public.cafeteria_service_shift_days for select to authenticated
using (pikas_private.has_capability('cafeteria:catalog:read',account_id,school_id,cafeteria_id));

create function pikas_private.normalize_service_weekdays(p_weekdays integer[]) returns smallint[]
language plpgsql immutable set search_path = '' as $$
declare normalized smallint[];
begin
  if p_weekdays is null or cardinality(p_weekdays) not between 1 and 7
      or exists(select 1 from unnest(p_weekdays) as d(value) where d.value is null or d.value not between 1 and 7)
      or (select count(*) from unnest(p_weekdays))<>(select count(distinct d.value) from unnest(p_weekdays) as d(value)) then
    raise exception using errcode='22023',message='invalid_iso_weekdays';
  end if;
  select array_agg(d.value::smallint order by d.value) into normalized
    from unnest(p_weekdays) as d(value);
  return normalized;
end $$;

create function pikas_private.guard_cafeteria_schedule_identity() returns trigger
language plpgsql set search_path = '' as $$
declare key text; immutable_keys text[];
begin
  immutable_keys:=array['account_id','school_id','cafeteria_id','created_at'];
  if tg_table_name='cafeteria_menu_products' then
    immutable_keys:=immutable_keys||array['menu_id','product_id'];
  elsif tg_table_name='cafeteria_service_shift_days' then
    immutable_keys:=immutable_keys||array['service_shift_id','weekday_iso'];
  else
    immutable_keys:=immutable_keys||array['id'];
  end if;
  foreach key in array immutable_keys loop
    if (to_jsonb(old)->key) is distinct from (to_jsonb(new)->key) then
      raise exception using errcode='23514',message='schedule_identity_or_tenant_scope_is_immutable';
    end if;
  end loop;
  new.updated_at:=clock_timestamp();
  return new;
end $$;

create function pikas_private.audit_cafeteria_schedule_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  before_row jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  after_row jsonb:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  row_data jsonb; actor uuid; actor_role_value text; a uuid; s uuid; c uuid; target_id_value uuid;
begin
  row_data:=case when tg_op='DELETE' then before_row else after_row end;
  a:=nullif(row_data->>'account_id','')::uuid;
  s:=nullif(row_data->>'school_id','')::uuid;
  c:=nullif(row_data->>'cafeteria_id','')::uuid;
  target_id_value:=coalesce(nullif(row_data->>'id','')::uuid,
    nullif(row_data->>'service_shift_id','')::uuid,nullif(row_data->>'menu_id','')::uuid,c);
  actor:=pikas_private.current_person_id();
  if actor is not null and exists(select 1 from public.cafeteria_memberships m
      where m.account_id=a and m.school_id=s and m.cafeteria_id=c and m.person_id=actor
        and m.status='active' and m.role_code='cafeteria_admin') then
    actor_role_value:='cafeteria_admin';
  else
    actor_role_value:='database_maintenance';
  end if;
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,
    account_id,school_id,cafeteria_id,action,target_type,target_id,outcome,before_metadata,after_metadata)
  values(actor,auth.uid(),actor_role_value,case when actor_role_value='cafeteria_admin' then 'cafeteria' else 'system' end,
    a,s,c,lower(tg_op),tg_table_name,target_id_value,'succeeded',
    jsonb_strip_nulls(jsonb_build_object('name',before_row->'name','name_key',before_row->'name_key',
      'display_order',before_row->'display_order','status',before_row->'status','active',before_row->'active',
      'menu_id',before_row->'menu_id','product_id',before_row->'product_id','weekday_iso',before_row->'weekday_iso',
      'start_time',before_row->'start_time','end_time',before_row->'end_time','enabled',before_row->'enabled',
      'version',before_row->'version')),
    jsonb_strip_nulls(jsonb_build_object('name',after_row->'name','name_key',after_row->'name_key',
      'display_order',after_row->'display_order','status',after_row->'status','active',after_row->'active',
      'menu_id',after_row->'menu_id','product_id',after_row->'product_id','weekday_iso',after_row->'weekday_iso',
      'start_time',after_row->'start_time','end_time',after_row->'end_time','enabled',after_row->'enabled',
      'version',after_row->'version')));
  return coalesce(new,old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['cafeteria_menus','cafeteria_menu_products','cafeteria_service_shifts','cafeteria_service_shift_days'] loop
    execute format('create trigger schedule_identity_guard before update on public.%I for each row execute function pikas_private.guard_cafeteria_schedule_identity()',t);
    execute format('create trigger schedule_audit after insert or update or delete on public.%I for each row execute function pikas_private.audit_cafeteria_schedule_change()',t);
  end loop;
end $$;

create function pikas_private.assert_service_shift_no_overlap(
  p_cafeteria_id uuid,p_shift_id uuid,p_start_time time without time zone,
  p_end_time time without time zone,p_enabled boolean,p_weekdays smallint[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_enabled and exists(
    select 1 from public.cafeteria_service_shifts s
    join public.cafeteria_service_shift_days d on d.account_id=s.account_id and d.school_id=s.school_id
      and d.cafeteria_id=s.cafeteria_id and d.service_shift_id=s.id
    where s.cafeteria_id=p_cafeteria_id and s.id is distinct from p_shift_id and s.enabled
      and d.weekday_iso=any(p_weekdays) and p_start_time<s.end_time and s.start_time<p_end_time
  ) then
    raise exception using errcode='23P01',message='enabled_service_shifts_overlap';
  end if;
end $$;

create function public.create_cafeteria_menu(
  p_cafeteria_id uuid,p_menu_id uuid,p_name text,p_description text,p_display_order integer default 0)
returns table(menu_id uuid,menu_version integer)
language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; clean_name text; clean_description text; existing public.cafeteria_menus%rowtype;
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.has_capability('cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  clean_name:=nullif(btrim(p_name),''); clean_description:=coalesce(btrim(p_description),'');
  if clean_name is null or length(clean_name)>120 or length(clean_description)>500 or p_display_order is null or p_menu_id is null then
    raise exception using errcode='22023',message='invalid_cafeteria_menu';
  end if;
  insert into public.cafeteria_menus(id,account_id,school_id,cafeteria_id,name,description,display_order)
  values(p_menu_id,a,s,p_cafeteria_id,clean_name,clean_description,p_display_order)
  on conflict(id) do nothing returning id,version into menu_id,menu_version;
  if found then return next; return; end if;
  select m.* into existing from public.cafeteria_menus m
    where m.id=p_menu_id and m.account_id=a and m.school_id=s and m.cafeteria_id=p_cafeteria_id;
  if not found or existing.name<>clean_name or existing.description<>clean_description
      or existing.display_order<>p_display_order or existing.status<>'active' then
    raise exception using errcode='23505',message='menu_request_id_reused_with_different_payload';
  end if;
  return query select existing.id,existing.version;
end $$;

create function public.update_cafeteria_menu(
  p_cafeteria_id uuid,p_menu_id uuid,p_expected_version integer,
  p_name text,p_description text,p_display_order integer,p_status text)
returns integer language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; clean_name text; clean_description text; current_version integer; updated_version integer;
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.has_capability('cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  clean_name:=nullif(btrim(p_name),''); clean_description:=coalesce(btrim(p_description),'');
  if clean_name is null or length(clean_name)>120 or length(clean_description)>500 or p_display_order is null
      or p_status is null or p_status not in ('active','archived') then
    raise exception using errcode='22023',message='invalid_cafeteria_menu';
  end if;
  select m.version into current_version from public.cafeteria_menus m
    where m.id=p_menu_id and m.account_id=a and m.school_id=s and m.cafeteria_id=p_cafeteria_id for update;
  if not found then raise exception using errcode='23503',message='menu_not_found_in_cafeteria'; end if;
  if p_expected_version is null or current_version<>p_expected_version then
    raise exception using errcode='40001',message='stale_cafeteria_menu_version';
  end if;
  update public.cafeteria_menus m set name=clean_name,description=clean_description,
    display_order=p_display_order,status=p_status,version=m.version+1 where m.id=p_menu_id returning m.version into updated_version;
  return updated_version;
end $$;

create function public.create_cafeteria_menu_product(
  p_cafeteria_id uuid,p_menu_id uuid,p_product_id uuid,p_display_order integer default 0)
returns table(menu_id uuid,product_id uuid,assignment_version integer)
language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; existing public.cafeteria_menu_products%rowtype;
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.has_capability('cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_menu_id is null or p_product_id is null or p_display_order is null then
    raise exception using errcode='22023',message='invalid_menu_product_assignment';
  end if;
  if not exists(select 1 from public.cafeteria_menus m where m.id=p_menu_id and m.account_id=a and m.school_id=s and m.cafeteria_id=p_cafeteria_id)
      or not exists(select 1 from public.cafeteria_products p where p.id=p_product_id and p.account_id=a and p.school_id=s and p.cafeteria_id=p_cafeteria_id) then
    raise exception using errcode='23503',message='menu_and_product_must_belong_to_cafeteria';
  end if;
  insert into public.cafeteria_menu_products as inserted(account_id,school_id,cafeteria_id,menu_id,product_id,display_order)
  values(a,s,p_cafeteria_id,p_menu_id,p_product_id,p_display_order)
  on conflict on constraint cafeteria_menu_products_pkey do nothing
  returning inserted.menu_id,inserted.product_id,inserted.version into menu_id,product_id,assignment_version;
  if found then return next; return; end if;
  select mp.* into existing from public.cafeteria_menu_products mp
    where mp.account_id=a and mp.school_id=s and mp.cafeteria_id=p_cafeteria_id
      and mp.menu_id=p_menu_id and mp.product_id=p_product_id;
  if not found or existing.display_order<>p_display_order or not existing.active then
    raise exception using errcode='23505',message='menu_product_request_reused_with_different_payload';
  end if;
  return query select existing.menu_id,existing.product_id,existing.version;
end $$;

create function public.update_cafeteria_menu_product(
  p_cafeteria_id uuid,p_menu_id uuid,p_product_id uuid,p_expected_version integer,
  p_display_order integer,p_active boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; current_version integer; updated_version integer;
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.has_capability('cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_display_order is null or p_active is null then raise exception using errcode='22023',message='invalid_menu_product_assignment'; end if;
  select mp.version into current_version from public.cafeteria_menu_products mp
    where mp.account_id=a and mp.school_id=s and mp.cafeteria_id=p_cafeteria_id
      and mp.menu_id=p_menu_id and mp.product_id=p_product_id for update;
  if not found then raise exception using errcode='23503',message='menu_product_assignment_not_found'; end if;
  if p_expected_version is null or current_version<>p_expected_version then
    raise exception using errcode='40001',message='stale_menu_product_assignment_version';
  end if;
  update public.cafeteria_menu_products mp set display_order=p_display_order,active=p_active,version=mp.version+1
    where mp.cafeteria_id=p_cafeteria_id and mp.menu_id=p_menu_id and mp.product_id=p_product_id
    returning mp.version into updated_version;
  return updated_version;
end $$;

create function public.create_cafeteria_service_shift(
  p_cafeteria_id uuid,p_shift_id uuid,p_menu_id uuid,p_name text,
  p_start_time time without time zone,p_end_time time without time zone,p_enabled boolean,p_weekdays integer[])
returns table(service_shift_id uuid,shift_version integer)
language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; clean_name text; days smallint[]; existing public.cafeteria_service_shifts%rowtype; old_days smallint[];
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.has_capability('cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  clean_name:=nullif(btrim(p_name),''); days:=pikas_private.normalize_service_weekdays(p_weekdays);
  if p_shift_id is null or p_menu_id is null or clean_name is null or length(clean_name)>120
      or p_start_time is null or p_end_time is null or p_start_time>=p_end_time or p_enabled is null then
    raise exception using errcode='22023',message='invalid_same_day_service_shift';
  end if;
  if not exists(select 1 from public.cafeteria_menus m where m.id=p_menu_id and m.account_id=a
      and m.school_id=s and m.cafeteria_id=p_cafeteria_id and (m.status='active' or not p_enabled)) then
    raise exception using errcode='23503',message='enabled_shift_requires_active_cafeteria_menu';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cafeteria_id::text,20261004));
  if p_enabled then perform pikas_private.assert_service_shift_no_overlap(p_cafeteria_id,p_shift_id,p_start_time,p_end_time,true,days); end if;
  insert into public.cafeteria_service_shifts(id,account_id,school_id,cafeteria_id,menu_id,name,start_time,end_time,enabled)
  values(p_shift_id,a,s,p_cafeteria_id,p_menu_id,clean_name,p_start_time,p_end_time,p_enabled)
  on conflict(id) do nothing returning id,version into service_shift_id,shift_version;
  if found then
    insert into public.cafeteria_service_shift_days(account_id,school_id,cafeteria_id,service_shift_id,weekday_iso)
      select a,s,p_cafeteria_id,p_shift_id,d from unnest(days) as d;
    return next; return;
  end if;
  select sh.* into existing from public.cafeteria_service_shifts sh
    where sh.id=p_shift_id and sh.account_id=a and sh.school_id=s and sh.cafeteria_id=p_cafeteria_id;
  if not found then raise exception using errcode='23505',message='service_shift_request_id_reused_in_other_scope'; end if;
  select coalesce(array_agg(d.weekday_iso order by d.weekday_iso),'{}'::smallint[]) into old_days
    from public.cafeteria_service_shift_days d where d.service_shift_id=p_shift_id;
  if existing.menu_id<>p_menu_id or existing.name<>clean_name or existing.start_time<>p_start_time
      or existing.end_time<>p_end_time or existing.enabled<>p_enabled or old_days<>days then
    raise exception using errcode='23505',message='service_shift_request_id_reused_with_different_payload';
  end if;
  return query select existing.id,existing.version;
end $$;

create function public.update_cafeteria_service_shift(
  p_cafeteria_id uuid,p_shift_id uuid,p_expected_version integer,p_menu_id uuid,p_name text,
  p_start_time time without time zone,p_end_time time without time zone,p_enabled boolean,p_weekdays integer[])
returns integer language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; clean_name text; days smallint[]; current_shift public.cafeteria_service_shifts%rowtype; updated_version integer;
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.has_capability('cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  clean_name:=nullif(btrim(p_name),''); days:=pikas_private.normalize_service_weekdays(p_weekdays);
  if p_menu_id is null or clean_name is null or length(clean_name)>120
      or p_start_time is null or p_end_time is null or p_start_time>=p_end_time or p_enabled is null then
    raise exception using errcode='22023',message='invalid_same_day_service_shift';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cafeteria_id::text,20261004));
  select sh.* into current_shift from public.cafeteria_service_shifts sh
    where sh.id=p_shift_id and sh.account_id=a and sh.school_id=s and sh.cafeteria_id=p_cafeteria_id for update;
  if not found then raise exception using errcode='23503',message='service_shift_not_found_in_cafeteria'; end if;
  if p_expected_version is null or current_shift.version<>p_expected_version then
    raise exception using errcode='40001',message='stale_service_shift_version';
  end if;
  if not exists(select 1 from public.cafeteria_menus m where m.id=p_menu_id and m.account_id=a
      and m.school_id=s and m.cafeteria_id=p_cafeteria_id and (m.status='active' or not p_enabled)) then
    raise exception using errcode='23503',message='enabled_shift_requires_active_cafeteria_menu';
  end if;
  if p_enabled then perform pikas_private.assert_service_shift_no_overlap(p_cafeteria_id,p_shift_id,p_start_time,p_end_time,true,days); end if;
  update public.cafeteria_service_shifts sh set menu_id=p_menu_id,name=clean_name,start_time=p_start_time,
    end_time=p_end_time,enabled=p_enabled,version=sh.version+1
    where sh.id=p_shift_id returning sh.version into updated_version;
  delete from public.cafeteria_service_shift_days d where d.service_shift_id=p_shift_id;
  insert into public.cafeteria_service_shift_days(account_id,school_id,cafeteria_id,service_shift_id,weekday_iso)
    select a,s,p_cafeteria_id,p_shift_id,d from unnest(days) as d;
  return updated_version;
end $$;

create function pikas_private.resolve_cafeteria_service_at(p_cafeteria_id uuid,p_as_of timestamptz)
returns table(status text,scheduling_enabled boolean,business_date date,local_time time without time zone,
  business_timezone text,service_shift_id uuid,service_shift_name text,menu_id uuid,menu_name text)
language plpgsql stable security definer set search_path = '' as $$
declare zone text; mode_enabled boolean; local_now timestamp without time zone; local_weekday smallint; match_count bigint;
begin
  if p_cafeteria_id is null or p_as_of is null then return; end if;
  select sc.business_timezone,os.scheduling_enabled into zone,mode_enabled
  from public.cafeterias ca
  join public.accounts ac on ac.id=ca.account_id and ac.status='active'
  join public.schools sc on sc.id=ca.school_id and sc.account_id=ca.account_id and sc.status='active'
  join public.school_locations sl on sl.id=ca.school_location_id and sl.account_id=ca.account_id
    and sl.school_id=ca.school_id and sl.status='active'
  join public.cafeteria_operation_settings os on os.account_id=ca.account_id
    and os.school_id=ca.school_id and os.cafeteria_id=ca.id
  join public.supported_currencies cu on cu.currency_code=os.catalog_currency_code and cu.status='enabled'
  where ca.id=p_cafeteria_id and ca.status='active';
  if not found then return; end if;
  local_now:=p_as_of at time zone zone;
  business_date:=local_now::date;
  local_time:=local_now::time;
  business_timezone:=zone;
  scheduling_enabled:=mode_enabled;
  if not mode_enabled then
    status:='manual'; return next; return;
  end if;
  local_weekday:=extract(isodow from local_now)::smallint;
  select count(*) into match_count
  from public.cafeteria_service_shifts sh
  join public.cafeteria_service_shift_days d on d.account_id=sh.account_id and d.school_id=sh.school_id
    and d.cafeteria_id=sh.cafeteria_id and d.service_shift_id=sh.id
  join public.cafeteria_menus m on m.account_id=sh.account_id and m.school_id=sh.school_id
    and m.cafeteria_id=sh.cafeteria_id and m.id=sh.menu_id and m.status='active'
  where sh.cafeteria_id=p_cafeteria_id and sh.enabled and d.weekday_iso=local_weekday
    and sh.start_time<=local_time and local_time<sh.end_time;
  if match_count=0 then
    status:='no_active_service'; return next; return;
  elsif match_count<>1 then
    status:='invalid_configuration'; return next; return;
  end if;
  select sh.id,sh.name,m.id,m.name into service_shift_id,service_shift_name,menu_id,menu_name
  from public.cafeteria_service_shifts sh
  join public.cafeteria_service_shift_days d on d.account_id=sh.account_id and d.school_id=sh.school_id
    and d.cafeteria_id=sh.cafeteria_id and d.service_shift_id=sh.id
  join public.cafeteria_menus m on m.account_id=sh.account_id and m.school_id=sh.school_id
    and m.cafeteria_id=sh.cafeteria_id and m.id=sh.menu_id and m.status='active'
  where sh.cafeteria_id=p_cafeteria_id and sh.enabled and d.weekday_iso=local_weekday
    and sh.start_time<=local_time and local_time<sh.end_time;
  status:='active'; return next;
end $$;

create function pikas_private.saleable_catalog_at(p_cafeteria_id uuid,p_as_of timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a uuid; s uuid; currency text; mode_enabled boolean; ctx record; context_found boolean;
  result_status text; local_business_date date; zone text; shift_id uuid; shift_name text; active_menu_id uuid; active_menu_name text;
  items jsonb:='[]'::jsonb;
begin
  if p_as_of is null then return jsonb_build_object('cafeteria_id',p_cafeteria_id,'status','invalid_configuration','products','[]'::jsonb); end if;
  select ca.account_id,ca.school_id into a,s from public.cafeterias ca where ca.id=p_cafeteria_id;
  select os.catalog_currency_code,os.scheduling_enabled into currency,mode_enabled
    from public.cafeteria_operation_settings os where os.cafeteria_id=p_cafeteria_id;
  select * into ctx from pikas_private.resolve_cafeteria_service_at(p_cafeteria_id,p_as_of);
  context_found:=found;
  if context_found then
    result_status:=ctx.status; local_business_date:=ctx.business_date; zone:=ctx.business_timezone;
    shift_id:=ctx.service_shift_id; shift_name:=ctx.service_shift_name; active_menu_id:=ctx.menu_id; active_menu_name:=ctx.menu_name;
  else
    result_status:='invalid_configuration';
  end if;
  if result_status in ('manual','active') and currency is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'product_id',p.id,'name',p.name,'description',p.description,'category_id',p.category_id,
      'category_name',cat.name,'price_minor',p.price_minor,'currency_code',currency,'version',p.version)
      order by coalesce(cat.display_order,0),cat.name_key,p.name,p.id),'[]'::jsonb) into items
    from public.cafeteria_products p
    left join public.cafeteria_product_categories cat on cat.account_id=p.account_id
      and cat.school_id=p.school_id and cat.cafeteria_id=p.cafeteria_id and cat.id=p.category_id
    where p.account_id=a and p.school_id=s and p.cafeteria_id=p_cafeteria_id and p.active and p.available
      and exists(select 1 from public.supported_currencies cu where cu.currency_code=currency and cu.status='enabled')
      and (result_status='manual' or exists(select 1 from public.cafeteria_menu_products mp
        where mp.account_id=a and mp.school_id=s and mp.cafeteria_id=p_cafeteria_id
          and mp.menu_id=active_menu_id and mp.product_id=p.id and mp.active));
  end if;
  return jsonb_build_object('cafeteria_id',p_cafeteria_id,'status',result_status,
    'scheduling_enabled',coalesce(mode_enabled,false),'business_date',local_business_date,
    'business_timezone',zone,'currency_code',currency,
    'service_shift',case when shift_id is null then null else jsonb_build_object('id',shift_id,'name',shift_name) end,
    'menu',case when active_menu_id is null then null else jsonb_build_object('id',active_menu_id,'name',active_menu_name) end,
    'products',items);
end $$;

create function public.get_cafeteria_saleable_catalog(p_cafeteria_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a uuid; s uuid;
begin
  select ca.account_id,ca.school_id into a,s from public.cafeterias ca where ca.id=p_cafeteria_id;
  if not found or not pikas_private.has_capability('cafeteria:catalog:read',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  return pikas_private.saleable_catalog_at(p_cafeteria_id,pg_catalog.now());
end $$;

revoke all on function pikas_private.normalize_service_weekdays(integer[]) from public,anon,authenticated,service_role;
revoke all on function pikas_private.guard_cafeteria_schedule_identity() from public,anon,authenticated,service_role;
revoke all on function pikas_private.audit_cafeteria_schedule_change() from public,anon,authenticated,service_role;
revoke all on function pikas_private.assert_service_shift_no_overlap(uuid,uuid,time without time zone,time without time zone,boolean,smallint[]) from public,anon,authenticated,service_role;
revoke all on function pikas_private.resolve_cafeteria_service_at(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function pikas_private.saleable_catalog_at(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.create_cafeteria_menu(uuid,uuid,text,text,integer) from public,anon,service_role;
revoke all on function public.update_cafeteria_menu(uuid,uuid,integer,text,text,integer,text) from public,anon,service_role;
revoke all on function public.create_cafeteria_menu_product(uuid,uuid,uuid,integer) from public,anon,service_role;
revoke all on function public.update_cafeteria_menu_product(uuid,uuid,uuid,integer,integer,boolean) from public,anon,service_role;
revoke all on function public.create_cafeteria_service_shift(uuid,uuid,uuid,text,time without time zone,time without time zone,boolean,integer[]) from public,anon,service_role;
revoke all on function public.update_cafeteria_service_shift(uuid,uuid,integer,uuid,text,time without time zone,time without time zone,boolean,integer[]) from public,anon,service_role;
revoke all on function public.get_cafeteria_saleable_catalog(uuid) from public,anon,service_role;
grant execute on function public.create_cafeteria_menu(uuid,uuid,text,text,integer),
  public.update_cafeteria_menu(uuid,uuid,integer,text,text,integer,text),
  public.create_cafeteria_menu_product(uuid,uuid,uuid,integer),
  public.update_cafeteria_menu_product(uuid,uuid,uuid,integer,integer,boolean),
  public.create_cafeteria_service_shift(uuid,uuid,uuid,text,time without time zone,time without time zone,boolean,integer[]),
  public.update_cafeteria_service_shift(uuid,uuid,integer,uuid,text,time without time zone,time without time zone,boolean,integer[]),
  public.get_cafeteria_saleable_catalog(uuid) to authenticated;

comment on table public.cafeteria_menus is 'Cafeteria-owned stable menu identity; prices and availability remain authoritative on cafeteria_products.';
comment on table public.cafeteria_menu_products is 'Cafeteria-scoped product/menu assignment with presentation order only; no price or availability override.';
comment on table public.cafeteria_service_shifts is 'Same-day local wall-clock service windows interpreted in the parent school business_timezone.';
comment on table public.cafeteria_service_shift_days is 'ISO weekdays: Monday=1 through Sunday=7. Enabled overlapping windows are serialized and rejected.';

commit;