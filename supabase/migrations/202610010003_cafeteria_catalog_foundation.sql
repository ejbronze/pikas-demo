-- Phase 4A: cafeteria catalog foundation only. No menus, shifts, POS, or purchases.
begin;

insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values
  ('cafeteria','cafeteria_admin','cafeteria:catalog:read'),
  ('cafeteria','cafeteria_admin','cafeteria:catalog:manage');

create function pikas_private.valid_catalog_texts(values_to_check text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(cardinality(values_to_check),0)<=30 and not exists(
    select 1 from unnest(coalesce(values_to_check,'{}'::text[])) item
    where item is null or length(btrim(item)) not between 1 and 80
  )
$$;

create table public.cafeteria_operation_settings (
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid primary key,
  catalog_currency_code text not null references public.supported_currencies(currency_code) on delete restrict,
  scheduling_enabled boolean not null default false,
  version integer not null default 1 check (version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,cafeteria_id) references public.cafeterias(account_id,school_id,id) on delete restrict,
  unique (account_id,school_id,cafeteria_id)
);

create table public.cafeteria_product_categories (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  name_key text generated always as (lower(btrim(name))) stored,
  display_order integer not null default 0,
  status text not null default 'active' check (status in ('active','archived')),
  version integer not null default 1 check (version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,cafeteria_id) references public.cafeterias(account_id,school_id,id) on delete restrict,
  unique (account_id,school_id,cafeteria_id,id),
  unique (cafeteria_id,name_key)
);
create index cafeteria_categories_order_idx on public.cafeteria_product_categories(account_id,school_id,cafeteria_id,status,display_order,name_key,id);

create table public.cafeteria_products (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  category_id uuid,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description)<=500),
  price_minor bigint not null check (price_minor>=0),
  active boolean not null default true,
  available boolean not null default true,
  ingredients text[] not null default '{}'::text[] check (pikas_private.valid_catalog_texts(ingredients)),
  allergens text[] not null default '{}'::text[] check (pikas_private.valid_catalog_texts(allergens)),
  version integer not null default 1 check (version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,cafeteria_id) references public.cafeterias(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id)
    references public.cafeteria_operation_settings(account_id,school_id,cafeteria_id) on delete restrict,
  foreign key (account_id,school_id,cafeteria_id,category_id)
    references public.cafeteria_product_categories(account_id,school_id,cafeteria_id,id) on delete restrict,
  unique (account_id,school_id,cafeteria_id,id)
);
create index cafeteria_products_catalog_idx on public.cafeteria_products(account_id,school_id,cafeteria_id,active,available,category_id,name,id);

insert into public.cafeteria_operation_settings(account_id,school_id,cafeteria_id,catalog_currency_code,scheduling_enabled)
select c.account_id,c.school_id,c.id,'DOP',false
from public.cafeterias c
where exists(select 1 from public.supported_currencies d where d.currency_code='DOP' and d.status='enabled')
on conflict(cafeteria_id) do nothing;

create function pikas_private.guard_catalog_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name='cafeteria_operation_settings'
    and (to_jsonb(old)->'catalog_currency_code') is distinct from (to_jsonb(new)->'catalog_currency_code') then
    raise exception using errcode='23514',message='catalog_currency_is_immutable';
  end if;
  if (to_jsonb(old)->'id') is distinct from (to_jsonb(new)->'id')
    or (to_jsonb(old)->'account_id') is distinct from (to_jsonb(new)->'account_id')
    or (to_jsonb(old)->'school_id') is distinct from (to_jsonb(new)->'school_id')
    or (to_jsonb(old)->'cafeteria_id') is distinct from (to_jsonb(new)->'cafeteria_id')
    or (to_jsonb(old)->'created_at') is distinct from (to_jsonb(new)->'created_at') then
    raise exception using errcode='23514',message='catalog_identity_or_tenant_scope_is_immutable';
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;

create function pikas_private.audit_catalog_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  n jsonb:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  r jsonb; actor uuid; actor_role_value text; a uuid; s uuid; c uuid; target_id_value uuid;
begin
  r:=case when tg_op='DELETE' then b else n end;
  a:=nullif(r->>'account_id','')::uuid;
  s:=nullif(r->>'school_id','')::uuid;
  c:=nullif(r->>'cafeteria_id','')::uuid;
  target_id_value:=coalesce(nullif(r->>'id','')::uuid,c);
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
    jsonb_strip_nulls(jsonb_build_object('name',b->'name','name_key',b->'name_key','category_id',b->'category_id',
      'catalog_currency_code',b->'catalog_currency_code','scheduling_enabled',b->'scheduling_enabled',
      'price_minor',b->'price_minor','active',b->'active','available',b->'available','status',b->'status','version',b->'version')),
    jsonb_strip_nulls(jsonb_build_object('name',n->'name','name_key',n->'name_key','category_id',n->'category_id',
      'catalog_currency_code',n->'catalog_currency_code','scheduling_enabled',n->'scheduling_enabled',
      'price_minor',n->'price_minor','active',n->'active','available',n->'available','status',n->'status','version',n->'version')));
  return coalesce(new,old);
end $$;

create function pikas_private.initialize_cafeteria_catalog_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.supported_currencies c where c.currency_code='DOP' and c.status='enabled') then
    raise exception using errcode='23514',message='DOP_must_be_enabled_for_new_cafeteria_catalog';
  end if;
  insert into public.cafeteria_operation_settings(account_id,school_id,cafeteria_id,catalog_currency_code,scheduling_enabled)
  values(new.account_id,new.school_id,new.id,'DOP',false)
  on conflict(cafeteria_id) do nothing;
  return new;
end $$;

create trigger cafeteria_catalog_settings_init after insert on public.cafeterias
for each row execute function pikas_private.initialize_cafeteria_catalog_settings();

do $$
declare t text;
begin
  foreach t in array array['cafeteria_operation_settings','cafeteria_product_categories','cafeteria_products'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger catalog_guard before update on public.%I for each row execute function pikas_private.guard_catalog_identity()',t);
    execute format('create trigger catalog_audit after insert or update on public.%I for each row execute function pikas_private.audit_catalog_change()',t);
  end loop;
end $$;

grant select on public.cafeteria_operation_settings,public.cafeteria_product_categories,public.cafeteria_products to authenticated;
create policy cafeteria_settings_read on public.cafeteria_operation_settings for select to authenticated
using (pikas_private.has_capability('cafeteria:catalog:read',account_id,school_id,cafeteria_id));
create policy cafeteria_category_read on public.cafeteria_product_categories for select to authenticated
using (pikas_private.has_capability('cafeteria:catalog:read',account_id,school_id,cafeteria_id));
create policy cafeteria_product_read on public.cafeteria_products for select to authenticated
using (pikas_private.has_capability('cafeteria:catalog:read',account_id,school_id,cafeteria_id));

create function public.update_cafeteria_catalog_settings(p_cafeteria_id uuid,p_scheduling_enabled boolean,p_expected_version integer)
returns table(version integer,scheduling_enabled boolean,catalog_currency_code text)
language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid;
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c
    where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.has_capability('cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  update public.cafeteria_operation_settings x set scheduling_enabled=p_scheduling_enabled,version=x.version+1
    where x.cafeteria_id=p_cafeteria_id and x.account_id=a and x.school_id=s and x.version=p_expected_version;
  if not found then raise exception using errcode='40001',message='stale_catalog_settings_version'; end if;
  return query select x.version,x.scheduling_enabled,x.catalog_currency_code
    from public.cafeteria_operation_settings x where x.cafeteria_id=p_cafeteria_id;
end $$;

create function public.create_cafeteria_product_category(p_cafeteria_id uuid,p_category_id uuid,
  p_name text,p_display_order integer default 0)
returns table(category_id uuid,category_version integer)
language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; normalized_name text; existing public.cafeteria_product_categories%rowtype;
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.has_capability('cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  normalized_name:=nullif(btrim(p_name),'');
  if normalized_name is null or length(normalized_name)>80 or p_display_order is null then
    raise exception using errcode='22023',message='invalid_product_category';
  end if;
  insert into public.cafeteria_product_categories(id,account_id,school_id,cafeteria_id,name,display_order)
  values(p_category_id,a,s,p_cafeteria_id,normalized_name,p_display_order)
  on conflict(id) do nothing returning id,version into category_id,category_version;
  if found then return next; return; end if;
  select c.* into existing from public.cafeteria_product_categories c
    where c.id=p_category_id and c.account_id=a and c.school_id=s and c.cafeteria_id=p_cafeteria_id;
  if not found or existing.name<>normalized_name or existing.display_order<>p_display_order or existing.status<>'active' then
    raise exception using errcode='23505',message='category_request_id_reused_with_different_payload';
  end if;
  return query select existing.id,existing.version;
end $$;

create function public.update_cafeteria_product_category(p_cafeteria_id uuid,p_category_id uuid,
  p_expected_version integer,p_name text,p_display_order integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; normalized_name text; current_version integer; updated_version integer;
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.has_capability('cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  normalized_name:=nullif(btrim(p_name),'');
  if normalized_name is null or length(normalized_name)>80 or p_display_order is null then
    raise exception using errcode='22023',message='invalid_product_category';
  end if;
  select c.version into current_version from public.cafeteria_product_categories c
    where c.id=p_category_id and c.account_id=a and c.school_id=s and c.cafeteria_id=p_cafeteria_id for update;
  if not found then raise exception using errcode='23503',message='category_not_found_in_cafeteria'; end if;
  if p_expected_version is null or current_version<>p_expected_version then
    raise exception using errcode='40001',message='stale_product_category_version';
  end if;
  update public.cafeteria_product_categories c set name=normalized_name,display_order=p_display_order,version=c.version+1
    where c.id=p_category_id returning c.version into updated_version;
  return updated_version;
end $$;

create function public.set_cafeteria_product_category_status(p_cafeteria_id uuid,p_category_id uuid,
  p_expected_version integer,p_status text)
returns integer language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; current_version integer; updated_version integer;
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.has_capability('cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_status not in ('active','archived') then raise exception using errcode='22023',message='invalid_category_status'; end if;
  select c.version into current_version from public.cafeteria_product_categories c
    where c.id=p_category_id and c.account_id=a and c.school_id=s and c.cafeteria_id=p_cafeteria_id for update;
  if not found then raise exception using errcode='23503',message='category_not_found_in_cafeteria'; end if;
  if p_expected_version is null or current_version<>p_expected_version then
    raise exception using errcode='40001',message='stale_product_category_version';
  end if;
  update public.cafeteria_product_categories c set status=p_status,version=c.version+1
    where c.id=p_category_id returning c.version into updated_version;
  return updated_version;
end $$;

create function public.create_cafeteria_product(p_cafeteria_id uuid,p_product_id uuid,p_name text,
  p_description text,p_category_id uuid,p_price_minor bigint,p_active boolean,p_available boolean,
  p_ingredients text[] default '{}'::text[],p_allergens text[] default '{}'::text[])
returns table(product_id uuid,product_version integer)
language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; normalized_name text; normalized_description text;
  clean_ingredients text[]; clean_allergens text[]; existing public.cafeteria_products%rowtype;
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.has_capability('cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  normalized_name:=nullif(btrim(p_name),''); normalized_description:=coalesce(btrim(p_description),'');
  if normalized_name is null or length(normalized_name)>120 or length(normalized_description)>500
      or p_price_minor is null or p_price_minor<0 or p_active is null or p_available is null then
    raise exception using errcode='22023',message='invalid_cafeteria_product';
  end if;
  clean_ingredients:=array(select btrim(x) from unnest(coalesce(p_ingredients,'{}'::text[])) with ordinality as u(x,n) order by n);
  clean_allergens:=array(select btrim(x) from unnest(coalesce(p_allergens,'{}'::text[])) with ordinality as u(x,n) order by n);
  if not pikas_private.valid_catalog_texts(clean_ingredients) or not pikas_private.valid_catalog_texts(clean_allergens) then
    raise exception using errcode='22023',message='invalid_food_metadata';
  end if;
  if not exists(select 1 from public.cafeteria_operation_settings x join public.supported_currencies c
      on c.currency_code=x.catalog_currency_code and c.status='enabled'
      where x.account_id=a and x.school_id=s and x.cafeteria_id=p_cafeteria_id) then
    raise exception using errcode='23514',message='enabled_catalog_currency_required';
  end if;
  if p_category_id is not null and not exists(select 1 from public.cafeteria_product_categories c
      where c.id=p_category_id and c.account_id=a and c.school_id=s and c.cafeteria_id=p_cafeteria_id and c.status='active') then
    raise exception using errcode='23503',message='category_not_active_in_cafeteria';
  end if;
  insert into public.cafeteria_products(id,account_id,school_id,cafeteria_id,category_id,name,description,
    price_minor,active,available,ingredients,allergens)
  values(p_product_id,a,s,p_cafeteria_id,p_category_id,normalized_name,normalized_description,
    p_price_minor,p_active,p_available,clean_ingredients,clean_allergens)
  on conflict(id) do nothing returning id,version into product_id,product_version;
  if found then return next; return; end if;
  select p.* into existing from public.cafeteria_products p
    where p.id=p_product_id and p.account_id=a and p.school_id=s and p.cafeteria_id=p_cafeteria_id;
  if not found or existing.category_id is distinct from p_category_id or existing.name<>normalized_name
      or existing.description<>normalized_description or existing.price_minor<>p_price_minor
      or existing.active<>p_active or existing.available<>p_available
      or existing.ingredients<>clean_ingredients or existing.allergens<>clean_allergens then
    raise exception using errcode='23505',message='product_request_id_reused_with_different_payload';
  end if;
  return query select existing.id,existing.version;
end $$;

create function public.update_cafeteria_product(p_cafeteria_id uuid,p_product_id uuid,p_expected_version integer,
  p_name text,p_description text,p_category_id uuid,p_price_minor bigint,p_active boolean,p_available boolean,
  p_ingredients text[] default '{}'::text[],p_allergens text[] default '{}'::text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare a uuid; s uuid; normalized_name text; normalized_description text;
  clean_ingredients text[]; clean_allergens text[]; current_product public.cafeteria_products%rowtype; updated_version integer;
begin
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.has_capability('cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  normalized_name:=nullif(btrim(p_name),''); normalized_description:=coalesce(btrim(p_description),'');
  if normalized_name is null or length(normalized_name)>120 or length(normalized_description)>500
      or p_price_minor is null or p_price_minor<0 or p_active is null or p_available is null then
    raise exception using errcode='22023',message='invalid_cafeteria_product';
  end if;
  clean_ingredients:=array(select btrim(x) from unnest(coalesce(p_ingredients,'{}'::text[])) with ordinality as u(x,n) order by n);
  clean_allergens:=array(select btrim(x) from unnest(coalesce(p_allergens,'{}'::text[])) with ordinality as u(x,n) order by n);
  if not pikas_private.valid_catalog_texts(clean_ingredients) or not pikas_private.valid_catalog_texts(clean_allergens) then
    raise exception using errcode='22023',message='invalid_food_metadata';
  end if;
  select p.* into current_product from public.cafeteria_products p
    where p.id=p_product_id and p.account_id=a and p.school_id=s and p.cafeteria_id=p_cafeteria_id for update;
  if not found then raise exception using errcode='23503',message='product_not_found_in_cafeteria'; end if;
  if p_expected_version is null or current_product.version<>p_expected_version then
    raise exception using errcode='40001',message='stale_product_version';
  end if;
  if not exists(select 1 from public.cafeteria_operation_settings x join public.supported_currencies c
      on c.currency_code=x.catalog_currency_code and c.status='enabled'
      where x.account_id=a and x.school_id=s and x.cafeteria_id=p_cafeteria_id) then
    raise exception using errcode='23514',message='enabled_catalog_currency_required';
  end if;
  if p_category_id is not null and not exists(select 1 from public.cafeteria_product_categories c
      where c.id=p_category_id and c.account_id=a and c.school_id=s and c.cafeteria_id=p_cafeteria_id
        and (c.status='active' or p_category_id=current_product.category_id)) then
    raise exception using errcode='23503',message='category_not_active_in_cafeteria';
  end if;
  update public.cafeteria_products p set category_id=p_category_id,name=normalized_name,description=normalized_description,
    price_minor=p_price_minor,active=p_active,available=p_available,ingredients=clean_ingredients,
    allergens=clean_allergens,version=p.version+1 where p.id=p_product_id returning p.version into updated_version;
  return updated_version;
end $$;

revoke all on function pikas_private.valid_catalog_texts(text[]) from public,anon,authenticated,service_role;
revoke all on function pikas_private.guard_catalog_identity() from public,anon,authenticated,service_role;
revoke all on function pikas_private.audit_catalog_change() from public,anon,authenticated,service_role;
revoke all on function pikas_private.initialize_cafeteria_catalog_settings() from public,anon,authenticated,service_role;
revoke all on function public.update_cafeteria_catalog_settings(uuid,boolean,integer) from public,anon,service_role;
revoke all on function public.create_cafeteria_product_category(uuid,uuid,text,integer) from public,anon,service_role;
revoke all on function public.update_cafeteria_product_category(uuid,uuid,integer,text,integer) from public,anon,service_role;
revoke all on function public.set_cafeteria_product_category_status(uuid,uuid,integer,text) from public,anon,service_role;
revoke all on function public.create_cafeteria_product(uuid,uuid,text,text,uuid,bigint,boolean,boolean,text[],text[]) from public,anon,service_role;
revoke all on function public.update_cafeteria_product(uuid,uuid,integer,text,text,uuid,bigint,boolean,boolean,text[],text[]) from public,anon,service_role;
grant execute on function public.update_cafeteria_catalog_settings(uuid,boolean,integer),
  public.create_cafeteria_product_category(uuid,uuid,text,integer),
  public.update_cafeteria_product_category(uuid,uuid,integer,text,integer),
  public.set_cafeteria_product_category_status(uuid,uuid,integer,text),
  public.create_cafeteria_product(uuid,uuid,text,text,uuid,bigint,boolean,boolean,text[],text[]),
  public.update_cafeteria_product(uuid,uuid,integer,text,text,uuid,bigint,boolean,boolean,text[],text[]) to authenticated;

comment on table public.cafeteria_operation_settings is 'One row per cafeteria. Currency is inherited by catalog products and immutable in Phase 4A; scheduling flag is configuration only.';
comment on table public.cafeteria_product_categories is 'Cafeteria-scoped normalized labels; archived categories remain referenced by historical catalog configuration.';
comment on table public.cafeteria_products is 'Cafeteria-owned product identity. Active and available are distinct; price is DOP minor units through cafeteria settings.';

commit;
