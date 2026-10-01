-- Phase 2: school-owned people relationships and cafeteria customer projection.
-- No financial, POS, catalog, or application integration schema is introduced.
begin;

insert into pikas_private.role_capabilities(scope_kind,role_code,capability) values
  ('school','school_admin','school:students:read'),
  ('school','school_admin','school:students:manage'),
  ('school','school_admin','school:families:read'),
  ('school','school_admin','school:families:manage'),
  ('school','school_admin','school:guardians:read'),
  ('school','school_admin','school:guardians:manage'),
  ('school','school_admin','school:contacts:read'),
  ('school','school_admin','school:contacts:manage'),
  ('school','school_admin','school:staff:read'),
  ('school','school_admin','school:staff:manage'),
  ('school','school_admin','school:restrictions:read'),
  ('school','school_admin','school:restrictions:manage'),
  ('school','school_admin','school:sharing:read'),
  ('school','school_admin','school:sharing:manage'),
  ('school','school_admin','school:customers:read'),
  ('school','school_admin','school:customers:manage'),
  ('cafeteria','cafeteria_admin','cafeteria:customer:lookup'),
  ('cafeteria','pos_operator','cafeteria:customer:lookup');

create table public.students (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  person_id uuid not null references public.persons(id) on delete restrict,
  student_code text not null check (length(btrim(student_code)) between 1 and 64),
  code_key text generated always as (lower(btrim(student_code))) stored,
  first_name text not null check (length(btrim(first_name)) between 1 and 100),
  last_name text not null check (length(btrim(last_name)) between 1 and 100),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  status text not null default 'active' check (status in ('active','suspended','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id) references public.schools(account_id,id) on delete restrict,
  unique (school_id,code_key),
  unique (school_id,person_id),
  unique (account_id,school_id,id)
);
create index students_school_status_idx on public.students(account_id,school_id,status);

create table public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  student_id uuid not null,
  starts_on date not null,
  ends_on date,
  status text not null default 'active' check (status in ('active','withdrawn','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,student_id) references public.students(account_id,school_id,id) on delete restrict,
  unique (account_id,school_id,id),
  check (ends_on is null or ends_on > starts_on),
  check ((status='active' and ends_on is null) or (status<>'active' and ends_on is not null))
);
create unique index student_one_current_enrollment on public.student_enrollments(student_id) where status='active';
create index student_enrollments_scope_idx on public.student_enrollments(account_id,school_id,student_id,starts_on desc);

create table public.student_campus_placements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  enrollment_id uuid not null,
  school_location_id uuid,
  grade_label text check (grade_label is null or length(btrim(grade_label)) between 1 and 80),
  class_label text check (class_label is null or length(btrim(class_label)) between 1 and 80),
  homeroom_label text check (homeroom_label is null or length(btrim(homeroom_label)) between 1 and 80),
  starts_on date not null,
  ends_on date,
  status text not null default 'active' check (status in ('active','ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,enrollment_id) references public.student_enrollments(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,school_location_id) references public.school_locations(account_id,school_id,id) on delete restrict,
  unique (account_id,school_id,id),
  check (ends_on is null or ends_on > starts_on),
  check ((status='active' and ends_on is null) or (status='ended' and ends_on is not null))
);
create unique index enrollment_one_current_placement on public.student_campus_placements(enrollment_id) where status='active';
create index student_placements_history_idx on public.student_campus_placements(account_id,school_id,enrollment_id,starts_on desc);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  family_code text not null check (length(btrim(family_code)) between 1 and 64),
  code_key text generated always as (lower(btrim(family_code))) stored,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id) references public.schools(account_id,id) on delete restrict,
  unique (school_id,code_key),
  unique (account_id,school_id,id)
);

create table public.family_student_relationships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  family_id uuid not null,
  student_id uuid not null,
  relationship_label text not null default 'household' check (length(btrim(relationship_label)) between 1 and 40),
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('active','ended')),
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,family_id) references public.families(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,student_id) references public.students(account_id,school_id,id) on delete restrict,
  unique (account_id,school_id,id),
  check (ends_on is null or ends_on > starts_on),
  check ((status='active' and ends_on is null) or (status='ended' and ends_on is not null))
);
create unique index family_student_one_active_link on public.family_student_relationships(family_id,student_id) where status='active';
create unique index student_one_active_primary_family on public.family_student_relationships(student_id) where status='active' and is_primary;

create table public.family_guardians (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  family_id uuid not null,
  person_id uuid not null references public.persons(id) on delete restrict,
  relationship_type text not null check (relationship_type in ('mother','father','guardian','other')),
  status text not null default 'active' check (status in ('active','ended')),
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,family_id) references public.families(account_id,school_id,id) on delete restrict,
  unique (account_id,school_id,id),
  check (ends_on is null or ends_on > starts_on),
  check ((status='active' and ends_on is null) or (status='ended' and ends_on is not null))
);
create unique index family_guardian_one_active_link on public.family_guardians(family_id,person_id) where status='active';

create table public.student_guardians (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  student_id uuid not null,
  person_id uuid not null references public.persons(id) on delete restrict,
  relationship_type text not null check (relationship_type in ('mother','father','guardian','other')),
  status text not null default 'active' check (status in ('active','ended')),
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,student_id) references public.students(account_id,school_id,id) on delete restrict,
  unique (account_id,school_id,id),
  check (ends_on is null or ends_on > starts_on),
  check ((status='active' and ends_on is null) or (status='ended' and ends_on is not null))
);
create unique index student_guardian_one_active_link on public.student_guardians(student_id,person_id) where status='active';

create table public.school_person_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  person_id uuid not null references public.persons(id) on delete restrict,
  contact_type text not null check (contact_type in ('email','phone')),
  contact_value text not null check (length(btrim(contact_value)) between 3 and 254),
  value_key text generated always as (case when contact_type='email' then lower(btrim(contact_value)) else regexp_replace(btrim(contact_value),'[[:space:]]','','g') end) stored,
  is_verified boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id) references public.schools(account_id,id) on delete restrict,
  unique (school_id,person_id,contact_type,value_key),
  unique (account_id,school_id,id)
);

create table public.school_staff_affiliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  person_id uuid not null references public.persons(id) on delete restrict,
  staff_category text not null check (staff_category in ('teacher','administrative_staff','other_employee')),
  employee_code text check (employee_code is null or length(btrim(employee_code)) between 1 and 64),
  employee_code_key text generated always as (case when employee_code is null then null else lower(btrim(employee_code)) end) stored,
  status text not null default 'active' check (status in ('active','inactive')),
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id) references public.schools(account_id,id) on delete restrict,
  unique (account_id,school_id,id),
  check (ends_on is null or ends_on > starts_on),
  check ((status='active' and ends_on is null) or (status='inactive' and ends_on is not null))
);
create unique index staff_one_active_school_affiliation on public.school_staff_affiliations(school_id,person_id) where status='active';
create unique index staff_code_unique_per_school on public.school_staff_affiliations(school_id,employee_code_key) where employee_code_key is not null;

create table public.staff_campus_affiliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  staff_affiliation_id uuid not null,
  school_location_id uuid not null,
  status text not null default 'active' check (status in ('active','ended')),
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,staff_affiliation_id) references public.school_staff_affiliations(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,school_location_id) references public.school_locations(account_id,school_id,id) on delete restrict,
  unique (account_id,school_id,id),
  check (ends_on is null or ends_on > starts_on),
  check ((status='active' and ends_on is null) or (status='ended' and ends_on is not null))
);
create unique index staff_campus_one_active_link on public.staff_campus_affiliations(staff_affiliation_id,school_location_id) where status='active';

create table public.student_dietary_restrictions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  student_id uuid not null,
  restriction_type text not null check (restriction_type in ('allergen','dietary','avoidance')),
  restriction_code text not null check (length(btrim(restriction_code)) between 1 and 64),
  code_key text generated always as (lower(btrim(restriction_code))) stored,
  display_label text not null check (length(btrim(display_label)) between 1 and 100),
  status text not null default 'active' check (status in ('active','inactive')),
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,student_id) references public.students(account_id,school_id,id) on delete restrict,
  unique (account_id,school_id,id),
  check (ends_on is null or ends_on > starts_on),
  check ((status='active' and ends_on is null) or (status='inactive' and ends_on is not null))
);
create unique index student_restriction_one_active_code on public.student_dietary_restrictions(student_id,restriction_type,code_key) where status='active';

create table public.school_cafeteria_shares (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,cafeteria_id) references public.cafeterias(account_id,school_id,id) on delete restrict,
  unique (cafeteria_id),
  unique (account_id,school_id,cafeteria_id,id)
);

create table public.school_cafeteria_share_categories (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  share_id uuid not null,
  category text not null check (category in ('basic_identification','student_code','placement','dietary_restrictions')),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,cafeteria_id,share_id) references public.school_cafeteria_shares(account_id,school_id,cafeteria_id,id) on delete restrict,
  unique (share_id,category),
  unique (account_id,school_id,cafeteria_id,id)
);

create table public.cafeteria_customers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  school_id uuid not null,
  cafeteria_id uuid not null,
  student_id uuid,
  staff_affiliation_id uuid,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id,school_id,cafeteria_id) references public.cafeterias(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,student_id) references public.students(account_id,school_id,id) on delete restrict,
  foreign key (account_id,school_id,staff_affiliation_id) references public.school_staff_affiliations(account_id,school_id,id) on delete restrict,
  unique (account_id,school_id,cafeteria_id,id),
  check ((student_id is not null)::integer + (staff_affiliation_id is not null)::integer = 1)
);
create unique index cafeteria_customer_one_active_student on public.cafeteria_customers(cafeteria_id,student_id) where status='active' and student_id is not null;
create unique index cafeteria_customer_one_active_staff on public.cafeteria_customers(cafeteria_id,staff_affiliation_id) where status='active' and staff_affiliation_id is not null;

create function pikas_private.guard_phase2_identity() returns trigger
language plpgsql set search_path = '' as $$
declare key text;
begin
  foreach key in array array['id','account_id','school_id','person_id','student_id','family_id',
    'enrollment_id','staff_affiliation_id','school_location_id','cafeteria_id','share_id','created_at','starts_on'] loop
    if to_jsonb(old)->key is distinct from to_jsonb(new)->key then
      raise exception using errcode='23514',message='immutable_phase2_identity_or_scope';
    end if;
  end loop;
  new.updated_at := clock_timestamp();
  return new;
end $$;

create function pikas_private.guard_student_enrollment_period() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.student_id::text,0));
  if new.status='active' and new.starts_on>current_date then
    raise exception using errcode='23514',message='active_enrollment_cannot_start_in_future';
  end if;
  if new.status='active' and not exists(select 1 from public.students s where s.id=new.student_id and s.status='active') then
    raise exception using errcode='23514',message='active_enrollment_requires_active_student';
  end if;
  if exists(select 1 from public.student_enrollments e where e.student_id=new.student_id and e.id<>new.id
    and daterange(e.starts_on,e.ends_on,'[)') && daterange(new.starts_on,new.ends_on,'[)')) then
    raise exception using errcode='23P01',message='student_enrollment_period_overlap';
  end if;
  if new.status<>'active' and exists(select 1 from public.student_campus_placements p
      where p.enrollment_id=new.id and p.status='active') then
    raise exception using errcode='23514',message='end_active_placement_before_enrollment';
  end if;
  if exists(select 1 from public.student_campus_placements p where p.enrollment_id=new.id
      and (p.starts_on<new.starts_on or (new.ends_on is not null and (p.ends_on is null or p.ends_on>new.ends_on)))) then
    raise exception using errcode='23514',message='placement_outside_enrollment_period';
  end if;
  return new;
end $$;

create function pikas_private.guard_student_lifecycle() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status='inactive' and old.status is distinct from new.status then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.id::text,0));
    if exists(select 1 from public.student_enrollments e where e.student_id=new.id and e.status='active') then
      raise exception using errcode='23514',message='withdraw_active_enrollment_before_deactivation';
    end if;
  end if;
  return new;
end $$;

create function pikas_private.guard_student_placement_period() returns trigger
language plpgsql set search_path = '' as $$
declare enrollment_start date; enrollment_end date; enrollment_status text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.enrollment_id::text,1));
  select e.starts_on,e.ends_on,e.status into enrollment_start,enrollment_end,enrollment_status
    from public.student_enrollments e where e.id=new.enrollment_id;
  if new.starts_on<enrollment_start or (enrollment_end is not null and (new.ends_on is null or new.ends_on>enrollment_end)) then
    raise exception using errcode='23514',message='placement_outside_enrollment_period';
  end if;
  if new.status='active' and new.starts_on>current_date then
    raise exception using errcode='23514',message='active_placement_cannot_start_in_future';
  end if;
  if new.status='active' and enrollment_status is distinct from 'active' then
    raise exception using errcode='23514',message='active_placement_requires_active_enrollment';
  end if;
  if new.status='active' and new.school_location_id is not null and not exists(select 1 from public.school_locations l
      where l.id=new.school_location_id and l.account_id=new.account_id and l.school_id=new.school_id and l.status='active') then
    raise exception using errcode='23514',message='active_placement_requires_active_campus';
  end if;
  if exists(select 1 from public.student_campus_placements p where p.enrollment_id=new.enrollment_id and p.id<>new.id
    and daterange(p.starts_on,p.ends_on,'[)') && daterange(new.starts_on,new.ends_on,'[)')) then
    raise exception using errcode='23P01',message='student_placement_period_overlap';
  end if;
  return new;
end $$;

create function pikas_private.audit_phase2_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  n jsonb := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  r jsonb; a uuid; s uuid; c uuid; actor uuid; actor_role_value text; actor_scope text;
begin
  r := case when tg_op='DELETE' then b else n end;
  a := nullif(r->>'account_id','')::uuid;
  s := nullif(r->>'school_id','')::uuid;
  c := nullif(r->>'cafeteria_id','')::uuid;
  if tg_table_name='school_cafeteria_share_categories' then
    select sc.cafeteria_id into c from public.school_cafeteria_shares sc where sc.id=(r->>'share_id')::uuid;
  end if;
  actor := pikas_private.current_person_id();
  actor_role_value := null;
  actor_scope := 'system';
  if actor is not null and s is not null and exists(select 1 from public.school_memberships m
      where m.account_id=a and m.school_id=s and m.person_id=actor and m.status='active' and m.role_code='school_admin') then
    actor_role_value := 'school_admin'; actor_scope := 'school';
  elsif actor is not null and c is not null and exists(select 1 from public.cafeteria_memberships m
      where m.account_id=a and m.school_id=s and m.cafeteria_id=c and m.person_id=actor and m.status='active') then
    select role_code into actor_role_value from public.cafeteria_memberships m
      where m.account_id=a and m.school_id=s and m.cafeteria_id=c and m.person_id=actor and m.status='active' limit 1;
    actor_scope := 'cafeteria';
  end if;
  if actor_scope='school' then c := null; end if;
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,
    account_id,school_id,cafeteria_id,action,target_type,target_id,outcome,before_metadata,after_metadata)
  values(actor,auth.uid(),coalesce(actor_role_value,'database_maintenance'),actor_scope,a,s,c,
    lower(tg_op),tg_table_name,(r->>'id')::uuid,'succeeded',
    jsonb_strip_nulls(jsonb_build_object('status',b->'status','is_primary',b->'is_primary','enabled',b->'enabled')),
    jsonb_strip_nulls(jsonb_build_object('status',n->'status','is_primary',n->'is_primary','enabled',n->'enabled')));
  return coalesce(new,old);
end $$;

create function pikas_private.can_read_school_person(target_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.students x where x.person_id=target_person and pikas_private.has_capability('school:students:read',x.account_id,x.school_id)
    union all select 1 from public.family_guardians x where x.person_id=target_person and pikas_private.has_capability('school:guardians:read',x.account_id,x.school_id)
    union all select 1 from public.student_guardians x where x.person_id=target_person and pikas_private.has_capability('school:guardians:read',x.account_id,x.school_id)
    union all select 1 from public.school_staff_affiliations x where x.person_id=target_person and pikas_private.has_capability('school:staff:read',x.account_id,x.school_id)
    union all select 1 from public.school_person_contacts x where x.person_id=target_person and pikas_private.has_capability('school:contacts:read',x.account_id,x.school_id)
  )
$$;

do $$
declare t text;
begin
  foreach t in array array['students','student_enrollments','student_campus_placements','families',
    'family_student_relationships','family_guardians','student_guardians','school_person_contacts',
    'school_staff_affiliations','staff_campus_affiliations','student_dietary_restrictions',
    'school_cafeteria_shares','school_cafeteria_share_categories','cafeteria_customers'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
    execute format('create trigger phase2_guard before update on public.%I for each row execute function pikas_private.guard_phase2_identity()',t);
    execute format('create trigger phase2_audit after insert or update on public.%I for each row execute function pikas_private.audit_phase2_change()',t);
  end loop;
end $$;
create trigger student_enrollment_period before insert or update on public.student_enrollments
for each row execute function pikas_private.guard_student_enrollment_period();
create trigger student_lifecycle before update on public.students
for each row execute function pikas_private.guard_student_lifecycle();
create trigger student_placement_period before insert or update on public.student_campus_placements
for each row execute function pikas_private.guard_student_placement_period();

grant select on public.students,public.student_enrollments,public.student_campus_placements,
  public.families,public.family_student_relationships,public.family_guardians,public.student_guardians,
  public.school_person_contacts,public.school_staff_affiliations,public.staff_campus_affiliations,
  public.student_dietary_restrictions,public.school_cafeteria_shares,public.school_cafeteria_share_categories,
  public.cafeteria_customers to authenticated;
grant execute on function pikas_private.can_read_school_person(uuid) to authenticated;

create policy person_school_read on public.persons for select to authenticated
using (id=(select pikas_private.current_person_id()) or pikas_private.can_read_school_person(id));

create policy students_school_read on public.students for select to authenticated
using (pikas_private.has_capability('school:students:read',account_id,school_id));
create policy enrollments_school_read on public.student_enrollments for select to authenticated
using (pikas_private.has_capability('school:students:read',account_id,school_id));
create policy placements_school_read on public.student_campus_placements for select to authenticated
using (pikas_private.has_capability('school:students:read',account_id,school_id));
create policy families_school_read on public.families for select to authenticated
using (pikas_private.has_capability('school:families:read',account_id,school_id));
create policy family_student_school_read on public.family_student_relationships for select to authenticated
using (pikas_private.has_capability('school:families:read',account_id,school_id));
create policy family_guardian_school_read on public.family_guardians for select to authenticated
using (pikas_private.has_capability('school:guardians:read',account_id,school_id));
create policy student_guardian_school_read on public.student_guardians for select to authenticated
using (pikas_private.has_capability('school:guardians:read',account_id,school_id));
create policy contacts_school_read on public.school_person_contacts for select to authenticated
using (pikas_private.has_capability('school:contacts:read',account_id,school_id));
create policy staff_school_read on public.school_staff_affiliations for select to authenticated
using (pikas_private.has_capability('school:staff:read',account_id,school_id));
create policy staff_campus_school_read on public.staff_campus_affiliations for select to authenticated
using (pikas_private.has_capability('school:staff:read',account_id,school_id));
create policy restrictions_school_read on public.student_dietary_restrictions for select to authenticated
using (pikas_private.has_capability('school:restrictions:read',account_id,school_id));
create policy shares_school_read on public.school_cafeteria_shares for select to authenticated
using (pikas_private.has_capability('school:sharing:read',account_id,school_id));
create policy share_categories_school_read on public.school_cafeteria_share_categories for select to authenticated
using (pikas_private.has_capability('school:sharing:read',account_id,school_id));
create policy customers_school_read on public.cafeteria_customers for select to authenticated
using (pikas_private.has_capability('school:customers:read',account_id,school_id));

create function public.create_student(p_account_id uuid,p_school_id uuid,p_person_id uuid,
  p_student_code text,p_first_name text,p_last_name text,p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not pikas_private.has_capability('school:students:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if not exists(select 1 from public.persons where id=p_person_id and status='active') then
    raise exception using errcode='23514',message='student_requires_active_person';
  end if;
  insert into public.students(account_id,school_id,person_id,student_code,first_name,last_name,display_name)
  values(p_account_id,p_school_id,p_person_id,p_student_code,p_first_name,p_last_name,p_display_name)
  returning id into new_id;
  return new_id;
end $$;

create function public.create_school_person(p_account_id uuid,p_school_id uuid,p_display_name text,p_relationship_kind text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_person_id uuid; required_capability text;
begin
  required_capability := case p_relationship_kind
    when 'student' then 'school:students:manage'
    when 'guardian' then 'school:guardians:manage'
    when 'staff' then 'school:staff:manage'
    else null end;
  if required_capability is null then raise exception using errcode='22023',message='invalid_person_relationship_kind'; end if;
  if not pikas_private.has_capability(required_capability,p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  insert into public.persons(display_name) values(p_display_name) returning id into new_person_id;
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,
    account_id,school_id,action,target_type,target_id,outcome,after_metadata)
  values(pikas_private.current_person_id(),auth.uid(),'school_admin','school',p_account_id,p_school_id,
    'create','persons',new_person_id,'succeeded',jsonb_build_object('relationship_kind',p_relationship_kind));
  return new_person_id;
end $$;

create function public.set_student_status(p_account_id uuid,p_school_id uuid,p_student_id uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not pikas_private.has_capability('school:students:manage',p_account_id,p_school_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  if p_status not in ('active','suspended','inactive') then raise exception using errcode='22023',message='invalid_student_status'; end if;
  if p_status='inactive' and exists(select 1 from public.student_enrollments e
      where e.student_id=p_student_id and e.status='active') then
    raise exception using errcode='23514',message='withdraw_active_enrollment_before_deactivation';
  end if;
  update public.students set status=p_status
    where id=p_student_id and account_id=p_account_id and school_id=p_school_id;
  if not found then raise exception using errcode='23503',message='student_not_found_in_school'; end if;
end $$;

create function public.create_family(p_account_id uuid,p_school_id uuid,p_family_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not pikas_private.has_capability('school:families:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  insert into public.families(account_id,school_id,family_code) values(p_account_id,p_school_id,p_family_code) returning id into new_id;
  return new_id;
end $$;

create function public.link_student_family(p_account_id uuid,p_school_id uuid,p_student_id uuid,
  p_family_id uuid,p_is_primary boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; existing_primary boolean;
begin
  if not pikas_private.has_capability('school:families:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_student_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family_id::text,3));
  if not exists(select 1 from public.students s join public.families f
      on f.account_id=s.account_id and f.school_id=s.school_id
      where s.id=p_student_id and f.id=p_family_id and s.account_id=p_account_id and s.school_id=p_school_id
        and s.status='active' and f.status='active') then
    raise exception using errcode='23514',message='family_link_requires_active_student_and_family';
  end if;
  select r.id,r.is_primary into new_id,existing_primary from public.family_student_relationships r
    where r.account_id=p_account_id and r.school_id=p_school_id and r.student_id=p_student_id
      and r.family_id=p_family_id and r.status='active' for update;
  if found then
    if p_is_primary and not existing_primary then
      update public.family_student_relationships set is_primary=false
        where student_id=p_student_id and status='active' and is_primary;
      update public.family_student_relationships set is_primary=true where id=new_id;
    end if;
    return new_id;
  end if;
  if p_is_primary then
    update public.family_student_relationships set is_primary=false
      where student_id=p_student_id and status='active' and is_primary;
  end if;
  insert into public.family_student_relationships(account_id,school_id,student_id,family_id,is_primary)
  values(p_account_id,p_school_id,p_student_id,p_family_id,p_is_primary) returning id into new_id;
  return new_id;
end $$;

create function public.enroll_student(p_account_id uuid,p_school_id uuid,p_student_id uuid,
  p_starts_on date,p_school_location_id uuid default null,p_grade_label text default null,
  p_class_label text default null,p_homeroom_label text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare enrollment_id uuid; current_enrollment_id uuid; current_placement_id uuid;
begin
  if not pikas_private.has_capability('school:students:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_student_id::text,0));
  select e.id into current_enrollment_id from public.student_enrollments e
    where e.account_id=p_account_id and e.school_id=p_school_id and e.student_id=p_student_id and e.status='active' for update;
  if found then
    select p.id into current_placement_id from public.student_campus_placements p
      where p.enrollment_id=current_enrollment_id and p.status='active' and p.starts_on=p_starts_on
        and p.school_location_id is not distinct from p_school_location_id
        and p.grade_label is not distinct from p_grade_label
        and p.class_label is not distinct from p_class_label
        and p.homeroom_label is not distinct from p_homeroom_label;
    if current_placement_id is not null then return current_enrollment_id; end if;
    raise exception using errcode='23505',message='student_already_has_current_enrollment';
  end if;
  insert into public.student_enrollments(account_id,school_id,student_id,starts_on)
  values(p_account_id,p_school_id,p_student_id,p_starts_on) returning id into enrollment_id;
  insert into public.student_campus_placements(account_id,school_id,enrollment_id,school_location_id,
    grade_label,class_label,homeroom_label,starts_on)
  values(p_account_id,p_school_id,enrollment_id,p_school_location_id,p_grade_label,p_class_label,p_homeroom_label,p_starts_on);
  return enrollment_id;
end $$;

create function public.transfer_student_campus(p_account_id uuid,p_school_id uuid,p_enrollment_id uuid,
  p_effective_on date,p_school_location_id uuid,p_grade_label text default null,
  p_class_label text default null,p_homeroom_label text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare placement_id uuid; current_placement_id uuid;
begin
  if not pikas_private.has_capability('school:students:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_effective_on>current_date then raise exception using errcode='22023',message='transfer_effective_date_cannot_be_future'; end if;
  if not exists(select 1 from public.student_enrollments e where e.id=p_enrollment_id
      and e.account_id=p_account_id and e.school_id=p_school_id and e.status='active') then
    raise exception using errcode='23503',message='active_enrollment_not_found_in_school';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_enrollment_id::text,1));
  select p.id into current_placement_id from public.student_campus_placements p
    where p.account_id=p_account_id and p.school_id=p_school_id and p.enrollment_id=p_enrollment_id
      and p.status='active' and p.starts_on=p_effective_on and p.school_location_id=p_school_location_id
      and p.grade_label is not distinct from p_grade_label
      and p.class_label is not distinct from p_class_label
      and p.homeroom_label is not distinct from p_homeroom_label;
  if current_placement_id is not null then return current_placement_id; end if;
  update public.student_campus_placements set status='ended',ends_on=p_effective_on
    where account_id=p_account_id and school_id=p_school_id and enrollment_id=p_enrollment_id
      and status='active' and starts_on<p_effective_on;
  if not found then raise exception using errcode='23514',message='transfer_requires_current_placement_and_later_date'; end if;
  insert into public.student_campus_placements(account_id,school_id,enrollment_id,school_location_id,
    grade_label,class_label,homeroom_label,starts_on)
  values(p_account_id,p_school_id,p_enrollment_id,p_school_location_id,p_grade_label,p_class_label,p_homeroom_label,p_effective_on)
  returning id into placement_id;
  return placement_id;
end $$;

create function public.withdraw_student_enrollment(p_account_id uuid,p_school_id uuid,p_enrollment_id uuid,p_ends_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare enrollment_student_id uuid; enrollment_status text; enrollment_end date;
begin
  if not pikas_private.has_capability('school:students:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_ends_on>current_date then raise exception using errcode='22023',message='withdrawal_effective_date_cannot_be_future'; end if;
  select e.student_id into enrollment_student_id from public.student_enrollments e
    where e.id=p_enrollment_id and e.account_id=p_account_id and e.school_id=p_school_id;
  if not found then raise exception using errcode='23503',message='enrollment_not_found_in_school'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(enrollment_student_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_enrollment_id::text,1));
  select e.status,e.ends_on into enrollment_status,enrollment_end from public.student_enrollments e
    where e.id=p_enrollment_id and e.account_id=p_account_id and e.school_id=p_school_id for update;
  if enrollment_status='withdrawn' and enrollment_end=p_ends_on
      and not exists(select 1 from public.student_campus_placements p where p.enrollment_id=p_enrollment_id and p.status='active') then
    return;
  end if;
  update public.student_campus_placements set status='ended',ends_on=p_ends_on
    where account_id=p_account_id and school_id=p_school_id and enrollment_id=p_enrollment_id
      and status='active' and starts_on<p_ends_on;
  update public.student_enrollments set status='withdrawn',ends_on=p_ends_on
    where id=p_enrollment_id and account_id=p_account_id and school_id=p_school_id and status='active' and starts_on<p_ends_on;
  if not found then raise exception using errcode='23514',message='withdrawal_requires_current_enrollment_and_later_date'; end if;
end $$;

create function public.add_student_guardian(p_account_id uuid,p_school_id uuid,p_student_id uuid,
  p_person_id uuid,p_relationship_type text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not pikas_private.has_capability('school:guardians:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if not exists(select 1 from public.students s join public.persons p on p.id=s.person_id
      join public.persons guardian on guardian.id=p_person_id
      where s.id=p_student_id and s.account_id=p_account_id and s.school_id=p_school_id
        and s.status='active' and p.status='active' and guardian.status='active') then
    raise exception using errcode='23514',message='guardian_link_requires_active_student_and_people';
  end if;
  insert into public.student_guardians(account_id,school_id,student_id,person_id,relationship_type)
  values(p_account_id,p_school_id,p_student_id,p_person_id,p_relationship_type) returning id into new_id;
  return new_id;
end $$;

create function public.add_family_guardian(p_account_id uuid,p_school_id uuid,p_family_id uuid,
  p_person_id uuid,p_relationship_type text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not pikas_private.has_capability('school:guardians:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if not exists(select 1 from public.families f join public.persons guardian on guardian.id=p_person_id
      where f.id=p_family_id and f.account_id=p_account_id and f.school_id=p_school_id
        and f.status='active' and guardian.status='active') then
    raise exception using errcode='23514',message='guardian_link_requires_active_family_and_person';
  end if;
  insert into public.family_guardians(account_id,school_id,family_id,person_id,relationship_type)
  values(p_account_id,p_school_id,p_family_id,p_person_id,p_relationship_type) returning id into new_id;
  return new_id;
end $$;

create function public.add_school_person_contact(p_account_id uuid,p_school_id uuid,p_person_id uuid,
  p_contact_type text,p_contact_value text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not pikas_private.has_capability('school:contacts:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if not exists(select 1 from public.persons p where p.id=p_person_id and p.status='active') then
    raise exception using errcode='23514',message='contact_requires_active_person';
  end if;
  insert into public.school_person_contacts(account_id,school_id,person_id,contact_type,contact_value)
  values(p_account_id,p_school_id,p_person_id,p_contact_type,p_contact_value) returning id into new_id;
  return new_id;
end $$;

create function public.create_school_staff_affiliation(p_account_id uuid,p_school_id uuid,p_person_id uuid,
  p_staff_category text,p_employee_code text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not pikas_private.has_capability('school:staff:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if not exists(select 1 from public.persons p where p.id=p_person_id and p.status='active') then
    raise exception using errcode='23514',message='staff_requires_active_person';
  end if;
  insert into public.school_staff_affiliations(account_id,school_id,person_id,staff_category,employee_code)
  values(p_account_id,p_school_id,p_person_id,p_staff_category,p_employee_code) returning id into new_id;
  return new_id;
end $$;

create function public.add_staff_campus_affiliation(p_account_id uuid,p_school_id uuid,
  p_staff_affiliation_id uuid,p_school_location_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not pikas_private.has_capability('school:staff:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if not exists(select 1 from public.school_staff_affiliations s join public.school_locations l
      on l.account_id=s.account_id and l.school_id=s.school_id
      where s.id=p_staff_affiliation_id and s.account_id=p_account_id and s.school_id=p_school_id
        and s.status='active' and l.id=p_school_location_id and l.status='active') then
    raise exception using errcode='23514',message='campus_affiliation_requires_active_staff_and_campus';
  end if;
  insert into public.staff_campus_affiliations(account_id,school_id,staff_affiliation_id,school_location_id)
  values(p_account_id,p_school_id,p_staff_affiliation_id,p_school_location_id) returning id into new_id;
  return new_id;
end $$;

create function public.add_student_restriction(p_account_id uuid,p_school_id uuid,p_student_id uuid,
  p_restriction_type text,p_restriction_code text,p_display_label text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not pikas_private.has_capability('school:restrictions:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if not exists(select 1 from public.students s join public.persons p on p.id=s.person_id
      where s.id=p_student_id and s.account_id=p_account_id and s.school_id=p_school_id and s.status='active' and p.status='active') then
    raise exception using errcode='23514',message='restriction_requires_active_student_and_person';
  end if;
  insert into public.student_dietary_restrictions(account_id,school_id,student_id,restriction_type,restriction_code,display_label)
  values(p_account_id,p_school_id,p_student_id,p_restriction_type,p_restriction_code,p_display_label) returning id into new_id;
  return new_id;
end $$;

create function public.set_school_cafeteria_sharing(p_account_id uuid,p_school_id uuid,p_cafeteria_id uuid,
  p_status text,p_enabled_categories text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare result_share_id uuid; category_value text;
begin
  if not pikas_private.has_capability('school:sharing:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if not pikas_private.scope_active(p_account_id,p_school_id,p_cafeteria_id) then
    raise exception using errcode='42501',message='cafeteria_not_in_authorized_school';
  end if;
  if p_status not in ('active','revoked') or exists(select 1 from unnest(coalesce(p_enabled_categories,'{}'::text[])) x
      where x not in ('basic_identification','student_code','placement','dietary_restrictions')) then
    raise exception using errcode='22023',message='invalid_sharing_configuration';
  end if;
  if p_status='active' and not ('basic_identification'=any(coalesce(p_enabled_categories,'{}'::text[]))) then
    raise exception using errcode='23514',message='active_sharing_requires_basic_identification';
  end if;
  insert into public.school_cafeteria_shares(account_id,school_id,cafeteria_id,status)
  values(p_account_id,p_school_id,p_cafeteria_id,p_status)
  on conflict(cafeteria_id) do update set status=excluded.status returning id into result_share_id;
  foreach category_value in array array['basic_identification','student_code','placement','dietary_restrictions'] loop
    insert into public.school_cafeteria_share_categories(account_id,school_id,cafeteria_id,share_id,category,enabled)
    values(p_account_id,p_school_id,p_cafeteria_id,result_share_id,category_value,
      category_value=any(coalesce(p_enabled_categories,'{}'::text[])))
    on conflict on constraint school_cafeteria_share_categories_share_id_category_key do update set enabled=excluded.enabled;
  end loop;
  return result_share_id;
end $$;

create function public.create_cafeteria_customer(p_account_id uuid,p_school_id uuid,p_cafeteria_id uuid,
  p_student_id uuid default null,p_staff_affiliation_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not pikas_private.has_capability('school:customers:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if not exists(select 1 from public.school_cafeteria_shares s join public.school_cafeteria_share_categories c
      on c.share_id=s.id and c.category='basic_identification' and c.enabled
      where s.account_id=p_account_id and s.school_id=p_school_id and s.cafeteria_id=p_cafeteria_id and s.status='active') then
    raise exception using errcode='42501',message='customer_sharing_not_enabled';
  end if;
  if p_student_id is not null and not exists(select 1 from public.students s join public.student_enrollments e
      on e.account_id=s.account_id and e.school_id=s.school_id and e.student_id=s.id and e.status='active'
      join public.persons p on p.id=s.person_id and p.status='active'
      where s.id=p_student_id and s.account_id=p_account_id and s.school_id=p_school_id and s.status='active') then
    raise exception using errcode='23514',message='student_customer_requires_active_enrollment';
  end if;
  if p_staff_affiliation_id is not null and not exists(select 1 from public.school_staff_affiliations s
      join public.persons p on p.id=s.person_id and p.status='active'
      where s.id=p_staff_affiliation_id and s.account_id=p_account_id and s.school_id=p_school_id and s.status='active') then
    raise exception using errcode='23514',message='staff_customer_requires_active_affiliation';
  end if;
  insert into public.cafeteria_customers(account_id,school_id,cafeteria_id,student_id,staff_affiliation_id)
  values(p_account_id,p_school_id,p_cafeteria_id,p_student_id,p_staff_affiliation_id) returning id into new_id;
  return new_id;
end $$;

create function public.end_family_student_relationship(p_account_id uuid,p_school_id uuid,p_relationship_id uuid,p_ends_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not pikas_private.has_capability('school:families:manage',p_account_id,p_school_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  update public.family_student_relationships set status='ended',ends_on=p_ends_on
    where id=p_relationship_id and account_id=p_account_id and school_id=p_school_id and status='active' and starts_on<p_ends_on;
  if not found then raise exception using errcode='23514',message='active_family_student_relationship_not_found'; end if;
end $$;

create function public.end_family_guardian_relationship(p_account_id uuid,p_school_id uuid,p_relationship_id uuid,p_ends_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not pikas_private.has_capability('school:guardians:manage',p_account_id,p_school_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  update public.family_guardians set status='ended',ends_on=p_ends_on
    where id=p_relationship_id and account_id=p_account_id and school_id=p_school_id and status='active' and starts_on<p_ends_on;
  if not found then raise exception using errcode='23514',message='active_family_guardian_relationship_not_found'; end if;
end $$;

create function public.end_student_guardian_relationship(p_account_id uuid,p_school_id uuid,p_relationship_id uuid,p_ends_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not pikas_private.has_capability('school:guardians:manage',p_account_id,p_school_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  update public.student_guardians set status='ended',ends_on=p_ends_on
    where id=p_relationship_id and account_id=p_account_id and school_id=p_school_id and status='active' and starts_on<p_ends_on;
  if not found then raise exception using errcode='23514',message='active_student_guardian_relationship_not_found'; end if;
end $$;

create function public.deactivate_school_person_contact(p_account_id uuid,p_school_id uuid,p_contact_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not pikas_private.has_capability('school:contacts:manage',p_account_id,p_school_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  update public.school_person_contacts set status='inactive'
    where id=p_contact_id and account_id=p_account_id and school_id=p_school_id and status='active';
  if not found then raise exception using errcode='23514',message='active_contact_not_found'; end if;
end $$;

create function public.deactivate_school_staff_affiliation(p_account_id uuid,p_school_id uuid,p_staff_id uuid,p_ends_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not pikas_private.has_capability('school:staff:manage',p_account_id,p_school_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  if exists(select 1 from public.staff_campus_affiliations c where c.staff_affiliation_id=p_staff_id and c.status='active' and c.starts_on>=p_ends_on) then
    raise exception using errcode='23514',message='staff_end_date_precedes_campus_affiliation';
  end if;
  update public.staff_campus_affiliations set status='ended',ends_on=p_ends_on
    where staff_affiliation_id=p_staff_id and status='active';
  update public.school_staff_affiliations set status='inactive',ends_on=p_ends_on
    where id=p_staff_id and account_id=p_account_id and school_id=p_school_id and status='active' and starts_on<p_ends_on;
  if not found then raise exception using errcode='23514',message='active_staff_affiliation_not_found'; end if;
end $$;

create function public.deactivate_student_restriction(p_account_id uuid,p_school_id uuid,p_restriction_id uuid,p_ends_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not pikas_private.has_capability('school:restrictions:manage',p_account_id,p_school_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  update public.student_dietary_restrictions set status='inactive',ends_on=p_ends_on
    where id=p_restriction_id and account_id=p_account_id and school_id=p_school_id and status='active' and starts_on<p_ends_on;
  if not found then raise exception using errcode='23514',message='active_restriction_not_found'; end if;
end $$;

create function public.deactivate_cafeteria_customer(p_account_id uuid,p_school_id uuid,p_customer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not pikas_private.has_capability('school:customers:manage',p_account_id,p_school_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  update public.cafeteria_customers set status='inactive'
    where id=p_customer_id and account_id=p_account_id and school_id=p_school_id and status='active';
  if not found then raise exception using errcode='23514',message='active_cafeteria_customer_not_found'; end if;
end $$;

create function public.deactivate_family(p_account_id uuid,p_school_id uuid,p_family_id uuid,p_ends_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not pikas_private.has_capability('school:families:manage',p_account_id,p_school_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family_id::text,3));
  if exists(select 1 from public.family_student_relationships r where r.family_id=p_family_id and r.status='active' and r.starts_on>=p_ends_on)
    or exists(select 1 from public.family_guardians r where r.family_id=p_family_id and r.status='active' and r.starts_on>=p_ends_on) then
    raise exception using errcode='23514',message='family_end_date_precedes_active_relationship';
  end if;
  update public.family_student_relationships set status='ended',ends_on=p_ends_on where family_id=p_family_id and status='active';
  update public.family_guardians set status='ended',ends_on=p_ends_on where family_id=p_family_id and status='active';
  update public.families set status='inactive' where id=p_family_id and account_id=p_account_id and school_id=p_school_id and status='active';
  if not found then raise exception using errcode='23514',message='active_family_not_found'; end if;
end $$;

create function public.cafeteria_customer_projection(p_cafeteria_id uuid,p_query text)
returns table(customer_id uuid,customer_type text,display_name text,student_code text,
  grade_label text,class_label text,restrictions jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare a uuid; s uuid; allowed_categories text[];
begin
  if p_query is null or length(btrim(p_query)) not between 2 and 80
      or position('%' in p_query)>0 or position('_' in p_query)>0 or position(pg_catalog.chr(92) in p_query)>0 then return; end if;
  select c.account_id,c.school_id into a,s from public.cafeterias c
    join public.school_locations l on l.account_id=c.account_id and l.school_id=c.school_id and l.id=c.school_location_id
    where c.id=p_cafeteria_id and c.status='active' and l.status='active';
  if a is null or not pikas_private.has_capability('cafeteria:customer:lookup',a,s,p_cafeteria_id) then return; end if;
  select array_agg(c.category) into allowed_categories
    from public.school_cafeteria_shares sh join public.school_cafeteria_share_categories c on c.share_id=sh.id
    where sh.account_id=a and sh.school_id=s and sh.cafeteria_id=p_cafeteria_id and sh.status='active' and c.enabled;
  if not ('basic_identification'=any(coalesce(allowed_categories,'{}'::text[]))) then return; end if;
  return query
    select cc.id,'student'::text,st.display_name,
      case when 'student_code'=any(allowed_categories) then st.student_code else null end,
      case when 'placement'=any(allowed_categories) then pl.grade_label else null end,
      case when 'placement'=any(allowed_categories) then pl.class_label else null end,
      case when 'dietary_restrictions'=any(allowed_categories) then coalesce((select jsonb_agg(jsonb_build_object('type',r.restriction_type,'code',r.restriction_code,'label',r.display_label) order by r.restriction_type,r.code_key)
        from public.student_dietary_restrictions r where r.student_id=st.id and r.status='active'),'[]'::jsonb) else '[]'::jsonb end
    from public.cafeteria_customers cc join public.students st on st.account_id=cc.account_id and st.school_id=cc.school_id and st.id=cc.student_id
    join public.persons sp on sp.id=st.person_id and sp.status='active'
    join public.student_enrollments en on en.account_id=st.account_id and en.school_id=st.school_id and en.student_id=st.id and en.status='active'
    left join public.student_campus_placements pl on pl.account_id=en.account_id and pl.school_id=en.school_id and pl.enrollment_id=en.id and pl.status='active'
    where cc.account_id=a and cc.school_id=s and cc.cafeteria_id=p_cafeteria_id and cc.status='active'
      and st.status='active' and (lower(st.display_name) like '%'||lower(btrim(p_query))||'%' or
        ('student_code'=any(allowed_categories) and lower(st.student_code) like '%'||lower(btrim(p_query))||'%'))
    union all
    select cc.id,'staff'::text,p.display_name,null::text,null::text,null::text,'[]'::jsonb
    from public.cafeteria_customers cc join public.school_staff_affiliations sf
      on sf.account_id=cc.account_id and sf.school_id=cc.school_id and sf.id=cc.staff_affiliation_id
    join public.persons p on p.id=sf.person_id and p.status='active'
    where cc.account_id=a and cc.school_id=s and cc.cafeteria_id=p_cafeteria_id and cc.status='active'
      and sf.status='active' and lower(p.display_name) like '%'||lower(btrim(p_query))||'%'
    limit 20;
end $$;

revoke all on function public.create_student(uuid,uuid,uuid,text,text,text,text) from public,anon,service_role;
revoke all on function public.create_school_person(uuid,uuid,text,text) from public,anon,service_role;
revoke all on function public.set_student_status(uuid,uuid,uuid,text) from public,anon,service_role;
revoke all on function public.create_family(uuid,uuid,text) from public,anon,service_role;
revoke all on function public.link_student_family(uuid,uuid,uuid,uuid,boolean) from public,anon,service_role;
revoke all on function public.enroll_student(uuid,uuid,uuid,date,uuid,text,text,text) from public,anon,service_role;
revoke all on function public.transfer_student_campus(uuid,uuid,uuid,date,uuid,text,text,text) from public,anon,service_role;
revoke all on function public.withdraw_student_enrollment(uuid,uuid,uuid,date) from public,anon,service_role;
revoke all on function public.add_student_guardian(uuid,uuid,uuid,uuid,text) from public,anon,service_role;
revoke all on function public.add_family_guardian(uuid,uuid,uuid,uuid,text) from public,anon,service_role;
revoke all on function public.add_school_person_contact(uuid,uuid,uuid,text,text) from public,anon,service_role;
revoke all on function public.create_school_staff_affiliation(uuid,uuid,uuid,text,text) from public,anon,service_role;
revoke all on function public.add_staff_campus_affiliation(uuid,uuid,uuid,uuid) from public,anon,service_role;
revoke all on function public.add_student_restriction(uuid,uuid,uuid,text,text,text) from public,anon,service_role;
revoke all on function public.set_school_cafeteria_sharing(uuid,uuid,uuid,text,text[]) from public,anon,service_role;
revoke all on function public.create_cafeteria_customer(uuid,uuid,uuid,uuid,uuid) from public,anon,service_role;
revoke all on function public.end_family_student_relationship(uuid,uuid,uuid,date) from public,anon,service_role;
revoke all on function public.end_family_guardian_relationship(uuid,uuid,uuid,date) from public,anon,service_role;
revoke all on function public.end_student_guardian_relationship(uuid,uuid,uuid,date) from public,anon,service_role;
revoke all on function public.deactivate_school_person_contact(uuid,uuid,uuid) from public,anon,service_role;
revoke all on function public.deactivate_school_staff_affiliation(uuid,uuid,uuid,date) from public,anon,service_role;
revoke all on function public.deactivate_student_restriction(uuid,uuid,uuid,date) from public,anon,service_role;
revoke all on function public.deactivate_cafeteria_customer(uuid,uuid,uuid) from public,anon,service_role;
revoke all on function public.deactivate_family(uuid,uuid,uuid,date) from public,anon,service_role;
revoke all on function public.cafeteria_customer_projection(uuid,text) from public,anon,service_role;
grant execute on function public.create_student(uuid,uuid,uuid,text,text,text,text),
  public.create_school_person(uuid,uuid,text,text),
  public.set_student_status(uuid,uuid,uuid,text),
  public.create_family(uuid,uuid,text),public.link_student_family(uuid,uuid,uuid,uuid,boolean),
  public.enroll_student(uuid,uuid,uuid,date,uuid,text,text,text),
  public.transfer_student_campus(uuid,uuid,uuid,date,uuid,text,text,text),
  public.withdraw_student_enrollment(uuid,uuid,uuid,date),public.add_student_guardian(uuid,uuid,uuid,uuid,text),
  public.add_family_guardian(uuid,uuid,uuid,uuid,text),public.add_school_person_contact(uuid,uuid,uuid,text,text),
  public.create_school_staff_affiliation(uuid,uuid,uuid,text,text),public.add_staff_campus_affiliation(uuid,uuid,uuid,uuid),
  public.add_student_restriction(uuid,uuid,uuid,text,text,text),
  public.set_school_cafeteria_sharing(uuid,uuid,uuid,text,text[]),
  public.create_cafeteria_customer(uuid,uuid,uuid,uuid,uuid),
  public.end_family_student_relationship(uuid,uuid,uuid,date),
  public.end_family_guardian_relationship(uuid,uuid,uuid,date),
  public.end_student_guardian_relationship(uuid,uuid,uuid,date),
  public.deactivate_school_person_contact(uuid,uuid,uuid),
  public.deactivate_school_staff_affiliation(uuid,uuid,uuid,date),
  public.deactivate_student_restriction(uuid,uuid,uuid,date),
  public.deactivate_cafeteria_customer(uuid,uuid,uuid),
  public.deactivate_family(uuid,uuid,uuid,date),
  public.cafeteria_customer_projection(uuid,text) to authenticated;

comment on table public.students is 'School-scoped student identity; enrollment and financial accounts are separate domains.';
comment on table public.families is 'School-scoped household grouping; not a wallet or financial account.';
comment on table public.school_staff_affiliations is 'School employment relationship; grants no PIKAS authorization.';
comment on table public.cafeteria_customers is 'Cafeteria-scoped identity link to an eligible student or staff affiliation; no copied profile or balance.';
comment on function public.cafeteria_customer_projection(uuid,text) is 'Narrow caller-authorized customer projection. Categories are returned only when explicitly enabled for the exact cafeteria.';

commit;