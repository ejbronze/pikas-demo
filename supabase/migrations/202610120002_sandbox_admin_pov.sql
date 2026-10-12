-- Step 4D.6: explicit sandbox school/cafeteria experiences; real identity and global RBAC unchanged.
begin;
alter table pikas_private.sandbox_pov_personas drop constraint sandbox_pov_personas_pov_code_check;
alter table pikas_private.sandbox_pov_personas add check(pov_code in ('cashier','school_admin','cafeteria_admin'));
alter table pikas_private.sandbox_pov_personas alter column cafeteria_membership_id drop not null;
alter table pikas_private.sandbox_pov_personas add column school_membership_id uuid references public.school_memberships(id) on delete restrict;
alter table pikas_private.sandbox_pov_personas add check((pov_code='school_admin' and school_membership_id is not null and cafeteria_membership_id is null) or (pov_code<>'school_admin' and cafeteria_membership_id is not null and school_membership_id is null));
alter table pikas_private.sandbox_pov_sessions drop constraint sandbox_pov_sessions_pov_code_check;
alter table pikas_private.sandbox_pov_sessions add check(pov_code in ('cashier','school_admin','cafeteria_admin'));
alter table pikas_private.sandbox_pov_sessions alter column persona_membership_id drop not null;
alter table pikas_private.sandbox_pov_sessions add column persona_school_membership_id uuid references public.school_memberships(id) on delete restrict;
alter table pikas_private.sandbox_pov_sessions add check((pov_code='school_admin' and persona_school_membership_id is not null and persona_membership_id is null) or (pov_code<>'school_admin' and persona_membership_id is not null and persona_school_membership_id is null));
alter table pikas_private.school_admin_requests add column sandbox_pov_session_id uuid references pikas_private.sandbox_pov_sessions(id) on delete restrict;
alter table pikas_private.cafeteria_admin_requests add column sandbox_pov_session_id uuid references pikas_private.sandbox_pov_sessions(id) on delete restrict;

CREATE OR REPLACE FUNCTION pikas_private.guard_sandbox_pov_persona()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op='DELETE' then
    raise exception using errcode='23514',message='sandbox_pov_persona_must_be_deactivated_not_deleted';
  end if;
  if tg_op='UPDATE' then
    if old.id is distinct from new.id or old.account_id is distinct from new.account_id
      or old.school_id is distinct from new.school_id or old.cafeteria_id is distinct from new.cafeteria_id
      or old.pov_code is distinct from new.pov_code or old.person_id is distinct from new.person_id
      or old.cafeteria_membership_id is distinct from new.cafeteria_membership_id
      or old.school_membership_id is distinct from new.school_membership_id
      or old.created_at is distinct from new.created_at then
      raise exception using errcode='23514',message='sandbox_pov_persona_identity_is_immutable';
    end if;
    if old.status='inactive' and new.status<>'inactive' then
      raise exception using errcode='23514',message='sandbox_pov_persona_cannot_be_reactivated';
    end if;
    new.updated_at:=clock_timestamp();
    return new;
  end if;
  if not exists(select 1 from public.accounts a where a.id=new.account_id and a.tenant_kind='sandbox') then
    raise exception using errcode='23514',message='sandbox_pov_persona_requires_sandbox_account';
  end if;
  if not exists(select 1 from public.persons p where p.id=new.person_id and p.status='active' and p.auth_user_id is null) then
    raise exception using errcode='23514',message='sandbox_pov_persona_must_not_have_auth_identity';
  end if;
  if new.pov_code='school_admin' then
    if not exists(select 1 from public.school_memberships m where m.id=new.school_membership_id
      and m.person_id=new.person_id and m.account_id=new.account_id and m.school_id=new.school_id
      and m.role_code='school_admin' and m.status='active') then
      raise exception using errcode='23514',message='sandbox_pov_persona_membership_mismatch';
    end if;
  elsif not exists(select 1 from public.cafeteria_memberships m
    where m.id=new.cafeteria_membership_id and m.person_id=new.person_id and m.account_id=new.account_id
      and m.school_id=new.school_id and m.cafeteria_id=new.cafeteria_id and m.status='active'
      and m.role_code=case new.pov_code when 'cashier' then 'pos_cashier' else 'cafeteria_admin' end) then
    raise exception using errcode='23514',message='sandbox_pov_persona_membership_mismatch';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION pikas_private.guard_sandbox_pov_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op='DELETE' then
    raise exception using errcode='23514',message='sandbox_pov_session_is_append_only';
  end if;
  if old.id is distinct from new.id or old.request_id is distinct from new.request_id
    or old.initiator_person_id is distinct from new.initiator_person_id
    or old.initiator_auth_user_id is distinct from new.initiator_auth_user_id
    or old.account_id is distinct from new.account_id or old.school_id is distinct from new.school_id
    or old.cafeteria_id is distinct from new.cafeteria_id or old.pov_code is distinct from new.pov_code
    or old.persona_id is distinct from new.persona_id or old.persona_person_id is distinct from new.persona_person_id
    or old.persona_membership_id is distinct from new.persona_membership_id
    or old.persona_school_membership_id is distinct from new.persona_school_membership_id
    or old.started_at is distinct from new.started_at or old.expires_at is distinct from new.expires_at then
    raise exception using errcode='23514',message='sandbox_pov_session_identity_is_immutable';
  end if;
  if old.status='exited' and (new.status<>'exited' or old.ended_at is distinct from new.ended_at
    or old.end_reason is distinct from new.end_reason) then
    raise exception using errcode='23514',message='sandbox_pov_session_cannot_be_reactivated';
  end if;
  return new;
end $function$;

-- A valid persona has exactly the registered, active membership in its exact scope.
create function pikas_private.sandbox_persona_valid(p_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from pikas_private.sandbox_pov_personas pr
 join public.persons p on p.id=pr.person_id and p.status='active' and p.auth_user_id is null
 join public.accounts a on a.id=pr.account_id and a.status='active' and a.tenant_kind='sandbox'
 where pr.id=p_id and pr.status='active' and pikas_private.scope_active(pr.account_id,pr.school_id,pr.cafeteria_id)
 and case when pr.pov_code='school_admin' then exists(select 1 from public.school_memberships m
   where m.id=pr.school_membership_id and m.person_id=p.id and m.account_id=pr.account_id and m.school_id=pr.school_id
     and m.role_code='school_admin' and m.status='active')
 else exists(select 1 from public.cafeteria_memberships m where m.id=pr.cafeteria_membership_id
   and m.person_id=p.id and m.account_id=pr.account_id and m.school_id=pr.school_id and m.cafeteria_id=pr.cafeteria_id
   and m.role_code=case pr.pov_code when 'cashier' then 'pos_cashier' when 'cafeteria_admin' then 'cafeteria_admin' end and m.status='active') end)
$$;
create function pikas_private.sandbox_pov_active_attempt() returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from pikas_private.sandbox_pov_sessions s where s.initiator_auth_user_id=auth.uid() and s.status='active')
$$;
create function pikas_private.sandbox_validated_pov()
returns table(pov_session_id uuid,initiator_person_id uuid,account_id uuid,school_id uuid,cafeteria_id uuid,
 pov_code text,persona_id uuid,persona_person_id uuid,persona_membership_id uuid,expires_at timestamptz)
language sql volatile security definer set search_path='' as $$
 select s.id,s.initiator_person_id,s.account_id,s.school_id,s.cafeteria_id,s.pov_code,s.persona_id,s.persona_person_id,
 coalesce(s.persona_membership_id,s.persona_school_membership_id),s.expires_at
 from pikas_private.sandbox_pov_sessions s join public.persons ip on ip.id=s.initiator_person_id
 join pikas_private.sandbox_pov_personas pr on pr.id=s.persona_id and pr.account_id=s.account_id
 and pr.school_id=s.school_id and pr.cafeteria_id=s.cafeteria_id and pr.pov_code=s.pov_code and pr.person_id=s.persona_person_id
 and pr.cafeteria_membership_id is not distinct from s.persona_membership_id
 and pr.school_membership_id is not distinct from s.persona_school_membership_id
 where s.status='active' and s.expires_at>clock_timestamp() and ip.status='active' and ip.auth_user_id=auth.uid()
 and s.initiator_auth_user_id=auth.uid() and pikas_private.sandbox_persona_valid(pr.id)
 and exists(select 1 from pikas_private.platform_memberships pm
 join pikas_private.platform_roles r on r.role_code=pm.role_code and r.status='active'
 join pikas_private.platform_role_capabilities rc on rc.role_code=r.role_code and rc.capability='platform:sandbox:pov:enter'
 where pm.person_id=ip.id and pm.status='active')
$$;
-- Every existing POS consumer still receives only cashier context. Invalid/wrong-type active
-- sessions raise, even if the real operator happens to have historical customer memberships.
create or replace function pikas_private.sandbox_pov_context()
returns table(pov_session_id uuid,initiator_person_id uuid,account_id uuid,school_id uuid,cafeteria_id uuid,
 pov_code text,persona_id uuid,persona_person_id uuid,persona_membership_id uuid,expires_at timestamptz)
language plpgsql volatile security definer set search_path='' as $$
begin
 if pikas_private.sandbox_pov_active_attempt() and not exists(select 1 from pikas_private.sandbox_validated_pov() x where x.pov_code='cashier') then
  raise exception using errcode='42501',message='cashier_sandbox_pov_required';
 end if;
 return query select * from pikas_private.sandbox_validated_pov() x where x.pov_code='cashier';
end $$;
create function pikas_private.sandbox_admin_actor(p_code text) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare x record;
begin
 if not pikas_private.sandbox_pov_active_attempt() then return pikas_private.current_person_id(); end if;
 select * into x from pikas_private.sandbox_validated_pov() v where v.pov_code=p_code;
 if not found then raise exception using errcode='42501',message='sandbox_admin_authority_required'; end if;
 return x.persona_person_id;
end $$;
create function pikas_private.sandbox_admin_has_capability(p_code text,cap text,a uuid,s uuid default null,c uuid default null) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare x record;
begin
 if not pikas_private.sandbox_pov_active_attempt() then return pikas_private.has_capability(cap,a,s,c); end if;
 select * into x from pikas_private.sandbox_validated_pov() v where v.pov_code=p_code;
 if not found then return false; end if;
 if x.account_id is distinct from a or x.school_id is distinct from s or (p_code='cafeteria_admin' and x.cafeteria_id is distinct from c)
 or (p_code='school_admin' and c is not null and x.cafeteria_id is distinct from c) then return false; end if;
 if p_code='school_admin' and cap<>all(array['school:read','school:students:read','school:students:manage','school:administrators:manage','school:sharing:read','school:sharing:manage','school:customers:read','school:customers:manage']) then return false; end if;
 if p_code='cafeteria_admin' and cap<>all(array['cafeteria:catalog:read','cafeteria:catalog:manage','cafeteria:pos:memberships:manage','cafeteria:registers:manage','cafeteria:register_assignments:manage']) then return false; end if;
 return exists(select 1 from pikas_private.role_capabilities rc where rc.scope_kind=case p_code when 'school_admin' then 'school' else 'cafeteria' end and rc.role_code=p_code and rc.capability=cap);
end $$;
-- Command provenance is captured before ANY request/data lock. Later checks cannot recapture
-- a replacement session, even when it has the same persona. GUCs are not authority: checks
-- always resolve auth.uid(), capability and the private registry again.
create function pikas_private.begin_sandbox_admin_command(p_code text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare x record;
begin
 perform pikas_private.sandbox_admin_actor(p_code);
 select * into x from pikas_private.sandbox_validated_pov() v where v.pov_code=p_code;
 perform set_config('pikas.admin_pov_session',coalesce(x.pov_session_id::text,''),true);
 perform set_config('pikas.admin_pov_type',p_code,true);
end $$;
create function pikas_private.revalidate_sandbox_admin_command() returns void
language plpgsql volatile security definer set search_path='' as $$
declare expected text:=nullif(current_setting('pikas.admin_pov_session',true),'');
begin
 if expected is not null and not exists(select 1 from pikas_private.sandbox_validated_pov() x
   where x.pov_session_id::text=expected and x.pov_code=current_setting('pikas.admin_pov_type',true)) then
  raise exception using errcode='42501',message='sandbox_admin_authority_changed';
 end if;
end $$;
create function pikas_private.check_sandbox_admin_write() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 perform pikas_private.revalidate_sandbox_admin_command();
 return null;
end $$;
-- AFTER STATEMENT catches waits inside row/FK/catalog/business triggers, rolling back the
-- entire command if its captured authority disappears or expires during the wait.
do $$ declare t text; begin
 foreach t in array array['persons','students','student_enrollments','student_campus_placements','school_cafeteria_shares','school_cafeteria_share_categories','cafeteria_customers','school_memberships','cafeteria_memberships','invitations','cafeteria_product_categories','cafeteria_products','cafeteria_menus','cafeteria_menu_products','cafeteria_service_shifts','cafeteria_service_shift_days','cafeteria_operation_settings','cafeteria_registers','cafeteria_register_assignments'] loop
 execute format('create trigger sandbox_admin_write_recheck after insert or update or delete on public.%I for each statement execute function pikas_private.check_sandbox_admin_write()',t);
 end loop;
end $$;

CREATE OR REPLACE FUNCTION pikas_private.require_school_admin(p_school_id uuid, p_capability text, p_lock boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; a uuid; membership uuid; role_value text; kind text; school_name text; account_name text;
begin
 actor:=pikas_private.sandbox_admin_actor('school_admin');
 select s.account_id,s.name,ac.name,ac.tenant_kind into a,school_name,account_name,kind
 from public.schools s join public.accounts ac on ac.id=s.account_id where s.id=p_school_id;
 if actor is null or a is null then raise exception using errcode='42501',message='school_authority_required'; end if;
 if p_lock and pikas_private.sandbox_pov_active_attempt() then
  perform 1 from public.persons where id=pikas_private.current_person_id() for share;
  perform 1 from pikas_private.platform_memberships where person_id=pikas_private.current_person_id() and status='active' order by id for share;
  perform 1 from pikas_private.sandbox_pov_personas where person_id=actor order by id for share;
 end if;
 if p_lock then
   -- Stabilize real identity, scope and membership before legacy RPCs can wait on locks.
   perform 1 from public.persons where id=actor for share;
   perform 1 from public.accounts where id=a for share;
   perform 1 from public.schools where id=p_school_id and account_id=a for share;
   perform 1 from public.account_memberships where account_id=a and person_id=actor and role_code='account_admin' order by id for share;
   perform 1 from public.school_memberships where account_id=a and school_id=p_school_id and person_id=actor and role_code='school_admin' order by id for share;
 end if;
 perform pikas_private.revalidate_sandbox_admin_command();
 if actor is distinct from pikas_private.sandbox_admin_actor('school_admin') or not pikas_private.scope_active(a,p_school_id) then
   raise exception using errcode='42501',message='school_authority_required';
 end if;
 select m.id,'account_admin' into membership,role_value from public.account_memberships m
 where m.account_id=a and m.person_id=actor and m.role_code='account_admin' and m.status='active';
 if not found then
   select m.id,'school_admin' into membership,role_value from public.school_memberships m
   where m.account_id=a and m.school_id=p_school_id and m.person_id=actor and m.role_code='school_admin' and m.status='active';
 end if;
 if membership is null or not pikas_private.sandbox_admin_has_capability('school_admin',p_capability,a,p_school_id) then
   raise exception using errcode='42501',message='school_authority_required';
 end if;
 return jsonb_build_object('actor_id',actor,'membership_id',membership,'role',role_value,'account_id',a,
   'school_id',p_school_id,'account_name',account_name,'school_name',school_name,'tenant_kind',kind);
end $function$;

CREATE OR REPLACE FUNCTION pikas_private.tenant_school_admin_context()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when p.id is null then null else jsonb_build_object('person_id',p.id,'display_name',p.display_name,
 'schools',coalesce((select jsonb_agg(jsonb_build_object('school_id',s.id,'school_name',s.name,
   'account_id',a.id,'account_name',a.name,'tenant_kind',a.tenant_kind) order by a.name,s.name,s.id)
 from public.schools s join public.accounts a on a.id=s.account_id
 where a.status='active' and s.status='active' and (
 exists(select 1 from public.account_memberships m where m.account_id=a.id and m.person_id=p.id and m.role_code='account_admin' and m.status='active') or
 exists(select 1 from public.school_memberships m where m.account_id=a.id and m.school_id=s.id and m.person_id=p.id and m.role_code='school_admin' and m.status='active'))),'[]'::jsonb)) end
 from (select pikas_private.current_person_id() id) x left join public.persons p on p.id=x.id
$function$;

create or replace function public.get_school_admin_context() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare x record; result jsonb; scope jsonb;
begin
 if not pikas_private.sandbox_pov_active_attempt() then return pikas_private.tenant_school_admin_context(); end if;
 perform pikas_private.sandbox_admin_actor('school_admin');
 select * into x from pikas_private.sandbox_validated_pov() v where v.pov_code='school_admin';
 scope:=pikas_private.require_school_admin(x.school_id,'school:read');
 result:=jsonb_build_object('person_id',x.persona_person_id,'display_name',(select display_name from public.persons where id=x.persona_person_id),
 'schools',jsonb_build_array(scope- 'actor_id'-'membership_id'-'role'-'capabilities'),
 'pov',jsonb_build_object('session_id',x.pov_session_id,'pov_code',x.pov_code,'operator_person_id',x.initiator_person_id,
 'operator_name',(select display_name from public.persons where id=x.initiator_person_id),'expires_at',x.expires_at));
 return result;
end $$;

CREATE OR REPLACE FUNCTION public.school_admin_command(p_school_id uuid, p_request_id uuid, p_operation text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx jsonb; a uuid; actor uuid; cap text; allowed text[]; fingerprint text; prior pikas_private.school_admin_requests%rowtype;
 result jsonb; student public.students%rowtype; target uuid; enrollment uuid; person uuid; auth_id uuid;
 invite public.invitations%rowtype; member public.school_memberships%rowtype; eligible_count integer;
 categories text[]; status_value text; target_type_value text:='school_administration';
begin
 perform pikas_private.begin_sandbox_admin_command('school_admin');
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception using errcode='22023',message='invalid_school_command'; end if;
 cap:=case when p_operation like 'student_%' then 'school:students:manage'
   when p_operation like 'admin_%' then 'school:administrators:manage'
   when p_operation='sharing_set' then 'school:sharing:manage'
   when p_operation='customer_set' then 'school:customers:manage' end;
 allowed:=case p_operation
   when 'student_create' then array['first_name','last_name','student_code','location_id','starts_on','grade','class','homeroom']
   when 'student_update' then array['student_id','first_name','last_name','student_code']
   when 'student_status' then array['student_id','status']
   when 'student_enroll' then array['student_id','location_id','starts_on','grade','class','homeroom']
   when 'student_transfer' then array['student_id','location_id','starts_on','grade','class','homeroom']
   when 'student_withdraw' then array['student_id','ends_on']
   when 'admin_prepare' then array['email']
   when 'admin_complete' then array['invitation_id','display_name']
   when 'admin_status' then array['membership_id','status']
   when 'sharing_set' then array['cafeteria_id','status','categories']
   when 'customer_set' then array['cafeteria_id','student_id','enabled'] end;
 if cap is null or allowed is null or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(allowed))) then
   raise exception using errcode='22023',message='invalid_school_command'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,20261010));
 ctx:=pikas_private.require_school_admin(p_school_id,cap,true); a:=(ctx->>'account_id')::uuid; actor:=(ctx->>'actor_id')::uuid;
 fingerprint:=pikas_private.platform_request_fingerprint(jsonb_build_object('school',p_school_id,'operation',p_operation,'payload',p_payload));
 select * into prior from pikas_private.school_admin_requests where request_id=p_request_id;
 if found then
   if prior.actor_person_id<>actor or prior.actor_auth_id<>auth.uid() or prior.school_id<>p_school_id or prior.fingerprint<>fingerprint then
     raise exception using errcode='23505',message='school_request_conflict'; end if;
   perform set_config('pikas.admin_pov_session','',true); return prior.response;
 end if;
 if p_operation like 'student_%' and p_operation<>'student_create' or p_operation='customer_set' then
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_payload->>'student_id',0));
   select * into student from public.students where id=(p_payload->>'student_id')::uuid and account_id=a and school_id=p_school_id for update;
   if not found then raise exception using errcode='42501',message='student_outside_school'; end if;
   target:=student.id; person:=student.person_id;
   -- Acquire the same student/enrollment advisory locks before mutation and keep authority locked.
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(student.id::text,0));
 end if;
 if p_operation in ('student_create','student_enroll','student_transfer') then
   if (p_payload->>'location_id')::uuid is not null then
     perform 1 from public.school_locations where id=(p_payload->>'location_id')::uuid and account_id=a and school_id=p_school_id and status='active' for share;
     if not found then raise exception using errcode='42501',message='location_outside_school'; end if;
   end if;
 end if;
 if p_operation in ('sharing_set','customer_set') then
   target:=(p_payload->>'cafeteria_id')::uuid;
   perform 1 from public.cafeterias where id=target and account_id=a and school_id=p_school_id for update;
   if not found then raise exception using errcode='42501',message='cafeteria_outside_school'; end if;
   -- Stabilize the cafeteria's parent campus across eligibility/relationship lock waits.
   perform 1 from public.school_locations l join public.cafeterias c on c.school_location_id=l.id
     where c.id=target and l.account_id=a and l.school_id=p_school_id for share of l;
 end if;
 perform pikas_private.require_school_admin(p_school_id,cap,true);
 if p_operation='student_create' then
   person:=public.create_school_person(a,p_school_id,btrim((p_payload->>'first_name')||' '||(p_payload->>'last_name')),'student');
   target:=public.create_student(a,p_school_id,person,p_payload->>'student_code',p_payload->>'first_name',p_payload->>'last_name',btrim((p_payload->>'first_name')||' '||(p_payload->>'last_name')));
   enrollment:=public.enroll_student(a,p_school_id,target,(p_payload->>'starts_on')::date,(p_payload->>'location_id')::uuid,p_payload->>'grade',p_payload->>'class',p_payload->>'homeroom');
   result:=jsonb_build_object('student_id',target,'enrollment_id',enrollment);
 elsif p_operation='student_update' then
   update public.students set first_name=btrim(p_payload->>'first_name'),last_name=btrim(p_payload->>'last_name'),display_name=btrim((p_payload->>'first_name')||' '||(p_payload->>'last_name')),student_code=btrim(p_payload->>'student_code') where id=student.id;
   result:=jsonb_build_object('student_id',student.id);
 elsif p_operation='student_status' then
   if p_payload->>'status' is null then raise exception using errcode='22023',message='status_required'; end if;
   perform public.set_student_status(a,p_school_id,student.id,p_payload->>'status'); result:=jsonb_build_object('student_id',student.id);
 elsif p_operation='student_enroll' then
   enrollment:=public.enroll_student(a,p_school_id,student.id,(p_payload->>'starts_on')::date,(p_payload->>'location_id')::uuid,p_payload->>'grade',p_payload->>'class',p_payload->>'homeroom');
   result:=jsonb_build_object('enrollment_id',enrollment);
 elsif p_operation in ('student_transfer','student_withdraw') then
   select id into enrollment from public.student_enrollments where student_id=student.id and status='active' for update;
   if not found then raise exception using errcode='23514',message='active_enrollment_required'; end if;
   if p_operation='student_transfer' then
     target:=public.transfer_student_campus(a,p_school_id,enrollment,(p_payload->>'starts_on')::date,(p_payload->>'location_id')::uuid,p_payload->>'grade',p_payload->>'class',p_payload->>'homeroom');
   else perform public.withdraw_student_enrollment(a,p_school_id,enrollment,(p_payload->>'ends_on')::date); target:=enrollment; end if;
   result:=jsonb_build_object('enrollment_id',enrollment);
 elsif p_operation='sharing_set' then
   if p_payload->>'status' is null or jsonb_typeof(p_payload->'categories') is distinct from 'array' then raise exception using errcode='22023',message='invalid_sharing'; end if;
   if p_payload->>'status'='active' and not pikas_private.scope_active(a,p_school_id,target) then raise exception using errcode='42501',message='active_cafeteria_required'; end if;
   select coalesce(array_agg(value),'{}'::text[]) into categories from jsonb_array_elements_text(p_payload->'categories');
   target:=public.set_school_cafeteria_sharing(a,p_school_id,target,p_payload->>'status',categories); result:=jsonb_build_object('share_id',target);
 elsif p_operation='customer_set' then
   if p_payload->'enabled' is null or jsonb_typeof(p_payload->'enabled')<>'boolean' then raise exception using errcode='22023',message='enabled_required'; end if;
   perform 1 from public.school_cafeteria_shares where cafeteria_id=target for update;
   if (p_payload->>'enabled')::boolean then
     perform 1 from public.persons where id=student.person_id and status='active' for share;
     if not found or not pikas_private.scope_active(a,p_school_id,(p_payload->>'cafeteria_id')::uuid) then raise exception using errcode='23514',message='active_student_and_sharing_required'; end if;
     select id into target from public.cafeteria_customers where cafeteria_id=(p_payload->>'cafeteria_id')::uuid and student_id=student.id order by (status='active') desc,created_at desc,id limit 1 for update;
     if target is null then target:=public.create_cafeteria_customer(a,p_school_id,(p_payload->>'cafeteria_id')::uuid,student.id,null);
     else
       -- Existing inactive eligibility can only be re-enabled with current active enrollment/sharing.
       if student.status<>'active' or not exists(select 1 from public.student_enrollments where student_id=student.id and status='active') or not exists(select 1 from public.school_cafeteria_shares sh join public.school_cafeteria_share_categories sc on sc.share_id=sh.id and sc.category='basic_identification' and sc.enabled where sh.cafeteria_id=(p_payload->>'cafeteria_id')::uuid and sh.status='active') then raise exception using errcode='23514',message='active_student_and_sharing_required'; end if;
       update public.cafeteria_customers set status='active' where id=target;
     end if;
   else
     select id into target from public.cafeteria_customers where cafeteria_id=target and student_id=student.id and status='active' order by id limit 1 for update;
     if target is null then raise exception using errcode='23503',message='customer_not_found'; end if;
     perform public.deactivate_cafeteria_customer(a,p_school_id,target);
   end if;
   result:=jsonb_build_object('customer_id',target);
 elsif p_operation='admin_prepare' then
   if length(btrim(p_payload->>'email')) not between 3 and 254 or position('@' in btrim(p_payload->>'email'))<2 or p_payload->>'email' is null then raise exception using errcode='22023',message='invalid_admin_email'; end if;
   -- Serialize pending intentions per school/email, including different request keys.
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_school_id::text||lower(btrim(p_payload->>'email')),20261011));
   select id into target from public.invitations where account_id=a and school_id=p_school_id and role_code='school_admin' and email_key=lower(btrim(p_payload->>'email')) and status='pending' and expires_at>clock_timestamp() order by id limit 1 for update;
   if target is null then
     insert into public.invitations(account_id,school_id,scope_kind,role_code,intended_email,token_hash,invited_by,expires_at)
     values(a,p_school_id,'school','school_admin',btrim(p_payload->>'email'),encode(extensions.digest(gen_random_uuid()::text||gen_random_uuid()::text,'sha256'),'hex'),actor,clock_timestamp()+interval '7 days') returning id into target;
   end if;
   result:=jsonb_build_object('invitation_id',target,'status','pending'); target_type_value:='invitations';
 elsif p_operation='admin_complete' then
   select * into invite from public.invitations where id=(p_payload->>'invitation_id')::uuid and account_id=a and school_id=p_school_id and scope_kind='school' and role_code='school_admin' for update;
   if not found or invite.status<>'pending' or invite.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_school_invitation_required'; end if;
   select count(*) into eligible_count from auth.users u where lower(btrim(u.email))=invite.email_key;
   if eligible_count<>1 then raise exception using errcode='23514',message='confirmed_identity_pending'; end if;
   begin
     select u.id into strict auth_id from auth.users u where lower(btrim(u.email))=invite.email_key and u.confirmed_at is not null
      and (not(to_jsonb(u)?'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
      and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
      and to_jsonb(u)->>'deleted_at' is null and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false for share;
   exception when no_data_found or too_many_rows then raise exception using errcode='23514',message='confirmed_identity_pending'; end;
   select id into person from public.persons where auth_user_id=auth_id for update;
   if auth_id=auth.uid() or exists(select 1 from pikas_private.platform_memberships where person_id=person)
    or exists(select 1 from public.account_memberships where person_id=person and account_id<>a)
    or exists(select 1 from public.school_memberships where person_id=person and account_id<>a)
    or exists(select 1 from public.cafeteria_memberships where person_id=person and account_id<>a) then raise exception using errcode='42501',message='tenant_identity_required'; end if;
   if person is not null and not exists(select 1 from public.persons where id=person and status='active' and auth_user_id=auth_id) then raise exception using errcode='23514',message='active_person_required'; end if;
   if nullif(btrim(p_payload->>'display_name'),'') is null or length(btrim(p_payload->>'display_name'))>200 then raise exception using errcode='22023',message='display_name_required'; end if;
   perform pikas_private.require_school_admin(p_school_id,cap,true);
   if invite.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_school_invitation_required'; end if;
   if person is null then insert into public.persons(auth_user_id,display_name) values(auth_id,btrim(p_payload->>'display_name')) returning id into person; end if;
   select * into member from public.school_memberships where account_id=a and school_id=p_school_id and person_id=person and role_code='school_admin' for update;
   if found and member.status<>'active' then raise exception using errcode='23505',message='existing_membership_not_active'; end if;
   perform pikas_private.require_school_admin(p_school_id,cap,true);
   if invite.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_school_invitation_required'; end if;
   if member.id is null then insert into public.school_memberships(account_id,school_id,person_id,role_code) values(a,p_school_id,person,'school_admin') returning id into target; else target:=member.id; end if;
   update public.invitations set status='accepted',accepted_person_id=person,accepted_at=clock_timestamp() where id=invite.id;
   result:=jsonb_build_object('membership_id',target,'status','accepted'); target_type_value:='school_memberships';
 elsif p_operation='admin_status' then
   select * into member from public.school_memberships where id=(p_payload->>'membership_id')::uuid and account_id=a and school_id=p_school_id and role_code='school_admin' for update;
   if not found or member.person_id=actor then raise exception using errcode='42501',message='manageable_school_membership_required'; end if;
   status_value:=p_payload->>'status';
   if status_value is null or status_value not in ('active','suspended') then raise exception using errcode='22023',message='invalid_membership_status'; end if;
   perform 1 from public.persons p join auth.users u on u.id=p.auth_user_id where p.id=member.person_id and p.status='active' and u.confirmed_at is not null
     and (not(to_jsonb(u)?'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
     and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
     and to_jsonb(u)->>'deleted_at' is null and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false for share of p,u;
   if status_value='active' and not found then raise exception using errcode='23514',message='active_authenticated_person_required'; end if;
   if status_value='active' and exists(select 1 from pikas_private.platform_memberships where person_id=member.person_id) then raise exception using errcode='42501',message='tenant_identity_required'; end if;
   perform pikas_private.require_school_admin(p_school_id,cap,true);
   update public.school_memberships set status=status_value where id=member.id;
   target:=member.id; result:=jsonb_build_object('membership_id',target); target_type_value:='school_memberships';
 end if;
 perform pikas_private.revalidate_sandbox_admin_command();
 insert into pikas_private.school_admin_requests(request_id,actor_person_id,actor_auth_id,account_id,school_id,fingerprint,response,sandbox_pov_session_id)
 values(p_request_id,actor,auth.uid(),a,p_school_id,fingerprint,result,nullif(current_setting('pikas.admin_pov_session',true),'')::uuid);
 insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,school_id,action,target_type,target_id,request_id,outcome,after_metadata)
 values(actor,auth.uid(),ctx->>'role',case when ctx->>'role'='account_admin' then 'account' else 'school' end,a,p_school_id,'school_admin_'||p_operation,target_type_value,coalesce(target,p_school_id),p_request_id,'succeeded',jsonb_build_object('operation',p_operation));
 perform set_config('pikas.admin_pov_session','',true); return result;
end $function$;

CREATE OR REPLACE FUNCTION pikas_private.require_cafeteria_admin(p_cafeteria_id uuid, p_lock boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; member_id uuid; c public.cafeterias%rowtype; ctx jsonb;
begin
 actor:=pikas_private.sandbox_admin_actor('cafeteria_admin');
 select * into c from public.cafeterias where id=p_cafeteria_id;
 if actor is null or c.id is null then raise exception using errcode='42501',message='cafeteria_authority_required'; end if;
 if p_lock and pikas_private.sandbox_pov_active_attempt() then
  perform 1 from public.persons where id=pikas_private.current_person_id() for share;
  perform 1 from pikas_private.platform_memberships where person_id=pikas_private.current_person_id() and status='active' order by id for share;
  perform 1 from pikas_private.sandbox_pov_personas where person_id=actor order by id for share;
 end if;
 if p_lock then
  perform 1 from public.persons where id=actor for share;
  perform 1 from public.accounts where id=c.account_id for share;
  perform 1 from public.schools where id=c.school_id for share;
  perform 1 from public.school_locations where id=c.school_location_id for share;
  perform 1 from public.cafeterias where id=c.id for share;
  perform 1 from public.cafeteria_memberships where person_id=actor and cafeteria_id=c.id and role_code='cafeteria_admin' order by id for share;
 end if;
 perform pikas_private.revalidate_sandbox_admin_command();
 if actor is distinct from pikas_private.sandbox_admin_actor('cafeteria_admin') or not pikas_private.scope_active(c.account_id,c.school_id,c.id) then
  raise exception using errcode='42501',message='cafeteria_authority_required';
 end if;
 select m.id into member_id from public.cafeteria_memberships m join public.school_locations l on l.id=c.school_location_id
 where m.person_id=actor and m.account_id=c.account_id and m.school_id=c.school_id and m.cafeteria_id=c.id
 and m.role_code='cafeteria_admin' and m.status='active' and l.status='active';
 if member_id is null then raise exception using errcode='42501',message='cafeteria_authority_required'; end if;
 select jsonb_build_object('actor_id',actor,'membership_id',member_id,'cafeteria_id',c.id,'cafeteria_name',c.name,
 'account_id',c.account_id,'account_name',a.name,'school_name',s.name,'location_name',l.name,'tenant_kind',a.tenant_kind,
 'capabilities',(select jsonb_agg(rc.capability order by rc.capability) from pikas_private.role_capabilities rc where rc.scope_kind='cafeteria' and rc.role_code='cafeteria_admin')) into ctx
 from public.accounts a join public.schools s on s.account_id=a.id join public.school_locations l on l.school_id=s.id
 where a.id=c.account_id and s.id=c.school_id and l.id=c.school_location_id;
 return ctx;
end $function$;

CREATE OR REPLACE FUNCTION pikas_private.tenant_cafeteria_admin_context()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when p.id is null then null else jsonb_build_object('person_id',p.id,'display_name',p.display_name,
 'cafeterias',coalesce((select jsonb_agg(jsonb_build_object('cafeteria_id',c.id,'cafeteria_name',c.name,'account_name',a.name,
 'school_name',s.name,'location_name',l.name,'tenant_kind',a.tenant_kind) order by a.name,c.name,c.id)
 from public.cafeteria_memberships m join public.cafeterias c on c.id=m.cafeteria_id
 join public.accounts a on a.id=c.account_id join public.schools s on s.id=c.school_id
 join public.school_locations l on l.id=c.school_location_id
 where m.person_id=p.id and m.role_code='cafeteria_admin' and m.status='active' and c.status='active'
 and a.status='active' and s.status='active' and l.status='active'),'[]'::jsonb)) end
 from (select pikas_private.current_person_id() id) x left join public.persons p on p.id=x.id
$function$;

create or replace function public.get_cafeteria_admin_context() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare x record; result jsonb; scope jsonb;
begin
 if not pikas_private.sandbox_pov_active_attempt() then return pikas_private.tenant_cafeteria_admin_context(); end if;
 perform pikas_private.sandbox_admin_actor('cafeteria_admin');
 select * into x from pikas_private.sandbox_validated_pov() v where v.pov_code='cafeteria_admin';
 scope:=pikas_private.require_cafeteria_admin(x.cafeteria_id);
 result:=jsonb_build_object('person_id',x.persona_person_id,'display_name',(select display_name from public.persons where id=x.persona_person_id),
 'cafeterias',jsonb_build_array(scope- 'actor_id'-'membership_id'-'role'-'capabilities'-'account_id'),
 'pov',jsonb_build_object('session_id',x.pov_session_id,'pov_code',x.pov_code,'operator_person_id',x.initiator_person_id,
 'operator_name',(select display_name from public.persons where id=x.initiator_person_id),'expires_at',x.expires_at));
 return result;
end $$;

CREATE OR REPLACE FUNCTION public.cafeteria_admin_command(p_cafeteria_id uuid, p_request_id uuid, p_operation text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx jsonb; actor uuid; a uuid; s uuid; fp text; prior pikas_private.cafeteria_admin_requests%rowtype;
 allowed text[]; target uuid; category uuid; v integer; result jsonb; product uuid; link public.cafeteria_menu_products%rowtype;
 invite public.invitations%rowtype; member public.cafeteria_memberships%rowtype; auth_id uuid; person uuid; count_value integer;
 reg public.cafeteria_registers%rowtype; assignment public.cafeteria_register_assignments%rowtype;
begin
 perform pikas_private.begin_sandbox_admin_command('cafeteria_admin');
 ctx:=pikas_private.require_cafeteria_admin(p_cafeteria_id,true); actor:=(ctx->>'actor_id')::uuid; a:=(ctx->>'account_id')::uuid;
 select school_id into s from public.cafeterias where id=p_cafeteria_id;
 if p_request_id is null or p_operation is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception using errcode='22023',message='invalid_cafeteria_command'; end if;
 allowed:=case p_operation
 when 'product_save' then array['id','version','name','description','category','price_minor','active','available','ingredients','allergens']
 when 'category_save' then array['id','version','name','display_order','status']
 when 'menu_save' then array['id','version','name','description','active','product_ids']
 when 'shift_save' then array['id','version','menu_id','name','start_time','end_time','enabled','weekdays']
 when 'settings_save' then array['version','scheduling_enabled']
 when 'staff_prepare' then array['email','role']
 when 'staff_complete' then array['invitation_id','display_name']
 when 'staff_status' then array['membership_id','status']
 when 'register_save' then array['id','version','code','name','status']
 when 'assignment_save' then array['membership_id','register_id','status','version'] end;
 if allowed is null or not (p_payload ?& allowed) or exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(allowed)) then raise exception using errcode='22023',message='unsupported_command_fields'; end if;
 if not pikas_private.sandbox_admin_has_capability('cafeteria_admin',case when p_operation like 'staff_%' then 'cafeteria:pos:memberships:manage' when p_operation='assignment_save' then 'cafeteria:register_assignments:manage' when p_operation='register_save' then 'cafeteria:registers:manage' else 'cafeteria:catalog:manage' end,a,s,p_cafeteria_id) then raise exception using errcode='42501',message='cafeteria_authority_required'; end if;
 fp:=encode(extensions.digest(jsonb_build_object('cafeteria',p_cafeteria_id,'operation',p_operation,'payload',p_payload)::text,'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,20261013));
 select * into prior from pikas_private.cafeteria_admin_requests where request_id=p_request_id;
 if found then
  if prior.actor_person_id<>actor or prior.actor_auth_id<>auth.uid() or prior.cafeteria_id<>p_cafeteria_id or prior.fingerprint<>fp then raise exception using errcode='23505',message='request_key_reused'; end if;
  perform pikas_private.require_cafeteria_admin(p_cafeteria_id,true); perform set_config('pikas.admin_pov_session','',true); return prior.response;
 end if;
 -- Serialize whole menu edits and category name resolution across administrator commands.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cafeteria_id::text,20261013));
 if p_operation='product_save' and (coalesce(p_payload->>'price_minor','') !~ '^[0-9]+$' or (p_payload->>'price_minor')::numeric>9007199254740991) then raise exception using errcode='22023',message='invalid_minor_unit_price'; end if;
 target:=(p_payload->>'id')::uuid; v:=(p_payload->>'version')::integer;
 if p_operation='product_save' then
  select id into category from public.cafeteria_product_categories where cafeteria_id=p_cafeteria_id and name_key=lower(btrim(p_payload->>'category')) and status='active' for share;
  if category is null then
   category:=gen_random_uuid(); perform public.create_cafeteria_product_category(p_cafeteria_id,category,p_payload->>'category',0);
  end if;
  if v is null then perform public.create_cafeteria_product(p_cafeteria_id,target,p_payload->>'name',p_payload->>'description',category,(p_payload->>'price_minor')::bigint,(p_payload->>'active')::boolean,(p_payload->>'available')::boolean,array(select jsonb_array_elements_text(p_payload->'ingredients')),array(select jsonb_array_elements_text(p_payload->'allergens')));
  else perform public.update_cafeteria_product(p_cafeteria_id,target,v,p_payload->>'name',p_payload->>'description',category,(p_payload->>'price_minor')::bigint,(p_payload->>'active')::boolean,(p_payload->>'available')::boolean,array(select jsonb_array_elements_text(p_payload->'ingredients')),array(select jsonb_array_elements_text(p_payload->'allergens'))); end if;
 elsif p_operation='category_save' then
  if v is null then perform public.create_cafeteria_product_category(p_cafeteria_id,target,p_payload->>'name',(p_payload->>'display_order')::integer); v:=1;
  else v:=public.update_cafeteria_product_category(p_cafeteria_id,target,v,p_payload->>'name',(p_payload->>'display_order')::integer); end if;
  if (select status from public.cafeteria_product_categories where id=target and cafeteria_id=p_cafeteria_id) is distinct from p_payload->>'status' then perform public.set_cafeteria_product_category_status(p_cafeteria_id,target,v,p_payload->>'status'); end if;
 elsif p_operation='menu_save' then
  if jsonb_typeof(p_payload->'product_ids') is distinct from 'array' then raise exception using errcode='22023',message='menu_products_required'; end if;
  -- The parent row lock also serializes legacy menu-product RPCs through their FK checks.
  if v is null then perform public.create_cafeteria_menu(p_cafeteria_id,target,p_payload->>'name',p_payload->>'description',0); v:=1; end if;
  perform public.update_cafeteria_menu(p_cafeteria_id,target,v,p_payload->>'name',p_payload->>'description',0,case when (p_payload->>'active')::boolean then 'active' else 'archived' end);
  for product in select distinct x::uuid from jsonb_array_elements_text(p_payload->'product_ids') x loop
   select * into link from public.cafeteria_menu_products where cafeteria_id=p_cafeteria_id and menu_id=target and product_id=product;
   if found then perform public.update_cafeteria_menu_product(p_cafeteria_id,target,product,link.version,link.display_order,true);
   else perform public.create_cafeteria_menu_product(p_cafeteria_id,target,product,0); end if;
  end loop;
  for link in select * from public.cafeteria_menu_products where cafeteria_id=p_cafeteria_id and menu_id=target and active and not (p_payload->'product_ids' ? product_id::text) loop
   perform public.update_cafeteria_menu_product(p_cafeteria_id,target,link.product_id,link.version,link.display_order,false);
  end loop;
 elsif p_operation='shift_save' then
  if v is null then perform public.create_cafeteria_service_shift(p_cafeteria_id,target,(p_payload->>'menu_id')::uuid,p_payload->>'name',(p_payload->>'start_time')::time,(p_payload->>'end_time')::time,(p_payload->>'enabled')::boolean,array(select x::integer from jsonb_array_elements_text(p_payload->'weekdays') x));
  else perform public.update_cafeteria_service_shift(p_cafeteria_id,target,v,(p_payload->>'menu_id')::uuid,p_payload->>'name',(p_payload->>'start_time')::time,(p_payload->>'end_time')::time,(p_payload->>'enabled')::boolean,array(select x::integer from jsonb_array_elements_text(p_payload->'weekdays') x)); end if;
 elsif p_operation='settings_save' then
  perform public.update_cafeteria_catalog_settings(p_cafeteria_id,(p_payload->>'scheduling_enabled')::boolean,v);
 elsif p_operation='register_save' then
  if v is null then
   if p_payload->>'status' is distinct from 'active' then raise exception using errcode='22023',message='new_register_must_be_active'; end if;
   perform public.create_cafeteria_register(p_cafeteria_id,target,p_payload->>'code',p_payload->>'name');
  else
   select * into reg from public.cafeteria_registers where id=target and cafeteria_id=p_cafeteria_id for update;
   if not found then raise exception using errcode='42501',message='register_outside_cafeteria'; end if;
   if exists(select 1 from public.register_sessions where register_id=target and status='open') then raise exception using errcode='23514',message='open_register_configuration_locked'; end if;
   perform public.update_cafeteria_register(p_cafeteria_id,target,v,p_payload->>'code',p_payload->>'name',p_payload->>'status');
  end if;
 elsif p_operation='staff_prepare' then
  if p_payload->>'role' is null or p_payload->>'role' not in ('pos_cashier','pos_supervisor') then raise exception using errcode='22023',message='pos_role_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cafeteria_id::text||lower(btrim(p_payload->>'email')),20261014));
  select id into target from public.invitations where cafeteria_id=p_cafeteria_id and scope_kind='cafeteria' and role_code=p_payload->>'role' and email_key=lower(btrim(p_payload->>'email')) and status='pending' and expires_at>clock_timestamp() order by id limit 1 for update;
  if target is null then insert into public.invitations(account_id,school_id,cafeteria_id,scope_kind,role_code,intended_email,token_hash,invited_by,expires_at)
   values(a,s,p_cafeteria_id,'cafeteria',p_payload->>'role',btrim(p_payload->>'email'),encode(extensions.digest(gen_random_uuid()::text||gen_random_uuid()::text,'sha256'),'hex'),actor,clock_timestamp()+interval '7 days') returning id into target; end if;
 elsif p_operation='staff_complete' then
  select * into invite from public.invitations where id=(p_payload->>'invitation_id')::uuid and account_id=a and school_id=s and cafeteria_id=p_cafeteria_id and scope_kind='cafeteria' and role_code in ('pos_cashier','pos_supervisor') for update;
  if not found or invite.status<>'pending' or invite.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_staff_invitation_required'; end if;
  select count(*) into count_value from auth.users where lower(btrim(email))=invite.email_key;
  if count_value<>1 then raise exception using errcode='23514',message='confirmed_identity_pending'; end if;
  begin
   select u.id into strict auth_id from auth.users u where lower(btrim(u.email))=invite.email_key and u.confirmed_at is not null
   and (not(to_jsonb(u)?'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
   and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
   and to_jsonb(u)->>'deleted_at' is null and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false for share;
  exception when no_data_found or too_many_rows then raise exception using errcode='23514',message='confirmed_identity_pending'; end;
  -- Serialize Person creation across connected cafeterias; unique Auth linkage also fails closed against legacy onboarding races.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth_id::text,20261014));
  select id into person from public.persons where auth_user_id=auth_id for update;
  if auth_id=auth.uid() or exists(select 1 from pikas_private.platform_memberships where person_id=person)
   or exists(select 1 from public.account_memberships where person_id=person and account_id<>a)
   or exists(select 1 from public.school_memberships where person_id=person and account_id<>a)
   or exists(select 1 from public.cafeteria_memberships where person_id=person and account_id<>a) then raise exception using errcode='42501',message='tenant_identity_required'; end if;
  if person is not null and not exists(select 1 from public.persons where id=person and status='active') then raise exception using errcode='23514',message='active_person_required'; end if;
  if nullif(btrim(p_payload->>'display_name'),'') is null or length(btrim(p_payload->>'display_name'))>200 then raise exception using errcode='22023',message='display_name_required'; end if;
  if invite.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_staff_invitation_required'; end if;
  if person is null then insert into public.persons(auth_user_id,display_name) values(auth_id,btrim(p_payload->>'display_name')) returning id into person; end if;
  select * into member from public.cafeteria_memberships where cafeteria_id=p_cafeteria_id and person_id=person and role_code=invite.role_code for update;
  if found and member.status<>'active' then raise exception using errcode='23505',message='existing_membership_not_active'; end if;
  select membership_id into target from public.set_cafeteria_pos_membership(p_cafeteria_id,person,invite.role_code,'active');
  update public.invitations set status='accepted',accepted_person_id=person,accepted_at=clock_timestamp() where id=invite.id;
 elsif p_operation in ('staff_status','assignment_save') then
  select * into member from public.cafeteria_memberships where id=(p_payload->>'membership_id')::uuid and cafeteria_id=p_cafeteria_id and role_code in ('pos_cashier','pos_supervisor');
  if not found then raise exception using errcode='42501',message='pos_membership_outside_cafeteria'; end if;
  -- Match the existing session/operator lock order before touching registers/assignments.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member.person_id::text,20261005));
  if p_payload->>'status'='active' then perform pikas_private.lock_cafeteria_pos_identity(member.person_id); end if;
  if p_operation='staff_status' then
   perform 1 from public.persons where id=member.person_id and status='active' for share;
   if not found then raise exception using errcode='23514',message='active_person_required'; end if;
   perform 1 from public.cafeteria_memberships where id=member.id for update;
   select membership_id into target from public.set_cafeteria_pos_membership(p_cafeteria_id,member.person_id,member.role_code,p_payload->>'status');
  else
   select * into reg from public.cafeteria_registers where id=(p_payload->>'register_id')::uuid and cafeteria_id=p_cafeteria_id for update;
   if not found then raise exception using errcode='42501',message='register_outside_cafeteria'; end if;
   perform 1 from public.cafeteria_memberships where id=member.id and status='active' for share;
   if (not found or reg.status<>'active') and p_payload->>'status'='active' then raise exception using errcode='23514',message='active_pos_membership_and_register_required'; end if;
   select * into assignment from public.cafeteria_register_assignments where cafeteria_id=p_cafeteria_id and cafeteria_membership_id=member.id and register_id=reg.id for update;
   if not found then
    if p_payload->>'status' is distinct from 'active' then raise exception using errcode='23503',message='assignment_required'; end if;
    select assignment_id into target from public.create_cafeteria_register_assignment(p_cafeteria_id,p_request_id,member.id,reg.id);
   else
    if v is null then raise exception using errcode='40001',message='assignment_version_required'; end if;
    perform public.update_cafeteria_register_assignment(p_cafeteria_id,assignment.id,v,p_payload->>'status'); target:=assignment.id;
   end if;
  end if;
 end if;
 perform pikas_private.require_cafeteria_admin(p_cafeteria_id,true);
 result:=jsonb_build_object('request_id',p_request_id,'operation',p_operation,'target_id',target);
 perform pikas_private.revalidate_sandbox_admin_command();
 insert into pikas_private.cafeteria_admin_requests(request_id,actor_person_id,actor_auth_id,cafeteria_id,fingerprint,response,sandbox_pov_session_id) values(p_request_id,actor,auth.uid(),p_cafeteria_id,fp,result,nullif(current_setting('pikas.admin_pov_session',true),'')::uuid);
 insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,school_id,cafeteria_id,action,target_type,target_id,request_id,outcome,after_metadata)
 values(actor,auth.uid(),'cafeteria_admin','cafeteria',a,s,p_cafeteria_id,'cafeteria_admin_'||p_operation,'cafeterias',p_cafeteria_id,p_request_id,'succeeded',jsonb_build_object('operation',p_operation));
 perform set_config('pikas.admin_pov_session','',true); return result;
end $function$;

CREATE OR REPLACE FUNCTION public.create_school_person(p_account_id uuid, p_school_id uuid, p_display_name text, p_relationship_kind text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare new_person_id uuid; required_capability text;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('school_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  required_capability := case p_relationship_kind
    when 'student' then 'school:students:manage'
    when 'guardian' then 'school:guardians:manage'
    when 'staff' then 'school:staff:manage'
    else null end;
  if required_capability is null then raise exception using errcode='22023',message='invalid_person_relationship_kind'; end if;
  if not pikas_private.sandbox_admin_has_capability('school_admin',required_capability,p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  insert into public.persons(display_name) values(p_display_name) returning id into new_person_id;
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,
    account_id,school_id,action,target_type,target_id,outcome,after_metadata)
  values(pikas_private.sandbox_admin_actor('school_admin'),auth.uid(),'school_admin','school',p_account_id,p_school_id,
    'create','persons',new_person_id,'succeeded',jsonb_build_object('relationship_kind',p_relationship_kind));
  return new_person_id;
end $function$;

CREATE OR REPLACE FUNCTION public.create_student(p_account_id uuid, p_school_id uuid, p_person_id uuid, p_student_code text, p_first_name text, p_last_name text, p_display_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare new_id uuid;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('school_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  if not pikas_private.sandbox_admin_has_capability('school_admin','school:students:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if not exists(select 1 from public.persons where id=p_person_id and status='active') then
    raise exception using errcode='23514',message='student_requires_active_person';
  end if;
  insert into public.students(account_id,school_id,person_id,student_code,first_name,last_name,display_name)
  values(p_account_id,p_school_id,p_person_id,p_student_code,p_first_name,p_last_name,p_display_name)
  returning id into new_id;
  return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.set_student_status(p_account_id uuid, p_school_id uuid, p_student_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('school_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  if not pikas_private.sandbox_admin_has_capability('school_admin','school:students:manage',p_account_id,p_school_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  if p_status not in ('active','suspended','inactive') then raise exception using errcode='22023',message='invalid_student_status'; end if;
  if p_status='inactive' and exists(select 1 from public.student_enrollments e
      where e.student_id=p_student_id and e.status='active') then
    raise exception using errcode='23514',message='withdraw_active_enrollment_before_deactivation';
  end if;
  update public.students set status=p_status
    where id=p_student_id and account_id=p_account_id and school_id=p_school_id;
  if not found then raise exception using errcode='23503',message='student_not_found_in_school'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.enroll_student(p_account_id uuid, p_school_id uuid, p_student_id uuid, p_starts_on date, p_school_location_id uuid DEFAULT NULL::uuid, p_grade_label text DEFAULT NULL::text, p_class_label text DEFAULT NULL::text, p_homeroom_label text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare enrollment_id uuid; current_enrollment_id uuid; current_placement_id uuid;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('school_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  if not pikas_private.sandbox_admin_has_capability('school_admin','school:students:manage',p_account_id,p_school_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.transfer_student_campus(p_account_id uuid, p_school_id uuid, p_enrollment_id uuid, p_effective_on date, p_school_location_id uuid, p_grade_label text DEFAULT NULL::text, p_class_label text DEFAULT NULL::text, p_homeroom_label text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare placement_id uuid; current_placement_id uuid;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('school_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  if not pikas_private.sandbox_admin_has_capability('school_admin','school:students:manage',p_account_id,p_school_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.withdraw_student_enrollment(p_account_id uuid, p_school_id uuid, p_enrollment_id uuid, p_ends_on date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare enrollment_student_id uuid; enrollment_status text; enrollment_end date;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('school_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  if not pikas_private.sandbox_admin_has_capability('school_admin','school:students:manage',p_account_id,p_school_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.set_school_cafeteria_sharing(p_account_id uuid, p_school_id uuid, p_cafeteria_id uuid, p_status text, p_enabled_categories text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result_share_id uuid; category_value text;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('school_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  if not pikas_private.sandbox_admin_has_capability('school_admin','school:sharing:manage',p_account_id,p_school_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.create_cafeteria_customer(p_account_id uuid, p_school_id uuid, p_cafeteria_id uuid, p_student_id uuid DEFAULT NULL::uuid, p_staff_affiliation_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare new_id uuid;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('school_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  if not pikas_private.sandbox_admin_has_capability('school_admin','school:customers:manage',p_account_id,p_school_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.deactivate_cafeteria_customer(p_account_id uuid, p_school_id uuid, p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('school_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  if not pikas_private.sandbox_admin_has_capability('school_admin','school:customers:manage',p_account_id,p_school_id) then raise exception using errcode='42501',message='not_authorized'; end if;
  update public.cafeteria_customers set status='inactive'
    where id=p_customer_id and account_id=p_account_id and school_id=p_school_id and status='active';
  if not found then raise exception using errcode='23514',message='active_cafeteria_customer_not_found'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.create_cafeteria_product_category(p_cafeteria_id uuid, p_category_id uuid, p_name text, p_display_order integer DEFAULT 0)
 RETURNS TABLE(category_id uuid, category_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; normalized_name text; existing public.cafeteria_product_categories%rowtype;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:catalog:manage',a,s,p_cafeteria_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.update_cafeteria_product_category(p_cafeteria_id uuid, p_category_id uuid, p_expected_version integer, p_name text, p_display_order integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; normalized_name text; current_version integer; updated_version integer;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:catalog:manage',a,s,p_cafeteria_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.set_cafeteria_product_category_status(p_cafeteria_id uuid, p_category_id uuid, p_expected_version integer, p_status text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; current_version integer; updated_version integer;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:catalog:manage',a,s,p_cafeteria_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.create_cafeteria_product(p_cafeteria_id uuid, p_product_id uuid, p_name text, p_description text, p_category_id uuid, p_price_minor bigint, p_active boolean, p_available boolean, p_ingredients text[] DEFAULT '{}'::text[], p_allergens text[] DEFAULT '{}'::text[])
 RETURNS TABLE(product_id uuid, product_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; normalized_name text; normalized_description text;
  clean_ingredients text[]; clean_allergens text[]; existing public.cafeteria_products%rowtype;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:catalog:manage',a,s,p_cafeteria_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.update_cafeteria_product(p_cafeteria_id uuid, p_product_id uuid, p_expected_version integer, p_name text, p_description text, p_category_id uuid, p_price_minor bigint, p_active boolean, p_available boolean, p_ingredients text[] DEFAULT '{}'::text[], p_allergens text[] DEFAULT '{}'::text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; normalized_name text; normalized_description text;
  clean_ingredients text[]; clean_allergens text[]; current_product public.cafeteria_products%rowtype; updated_version integer;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:catalog:manage',a,s,p_cafeteria_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.create_cafeteria_menu(p_cafeteria_id uuid, p_menu_id uuid, p_name text, p_description text, p_display_order integer DEFAULT 0)
 RETURNS TABLE(menu_id uuid, menu_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; clean_name text; clean_description text; existing public.cafeteria_menus%rowtype;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:catalog:manage',a,s,p_cafeteria_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.update_cafeteria_menu(p_cafeteria_id uuid, p_menu_id uuid, p_expected_version integer, p_name text, p_description text, p_display_order integer, p_status text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; clean_name text; clean_description text; current_version integer; updated_version integer;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:catalog:manage',a,s,p_cafeteria_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.create_cafeteria_menu_product(p_cafeteria_id uuid, p_menu_id uuid, p_product_id uuid, p_display_order integer DEFAULT 0)
 RETURNS TABLE(menu_id uuid, product_id uuid, assignment_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; existing public.cafeteria_menu_products%rowtype;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:catalog:manage',a,s,p_cafeteria_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.update_cafeteria_menu_product(p_cafeteria_id uuid, p_menu_id uuid, p_product_id uuid, p_expected_version integer, p_display_order integer, p_active boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; current_version integer; updated_version integer;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:catalog:manage',a,s,p_cafeteria_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.create_cafeteria_service_shift(p_cafeteria_id uuid, p_shift_id uuid, p_menu_id uuid, p_name text, p_start_time time without time zone, p_end_time time without time zone, p_enabled boolean, p_weekdays integer[])
 RETURNS TABLE(service_shift_id uuid, shift_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; clean_name text; days smallint[]; existing public.cafeteria_service_shifts%rowtype; old_days smallint[];
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:catalog:manage',a,s,p_cafeteria_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.update_cafeteria_service_shift(p_cafeteria_id uuid, p_shift_id uuid, p_expected_version integer, p_menu_id uuid, p_name text, p_start_time time without time zone, p_end_time time without time zone, p_enabled boolean, p_weekdays integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; clean_name text; days smallint[]; current_shift public.cafeteria_service_shifts%rowtype; updated_version integer;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  select c.account_id,c.school_id into a,s from public.cafeterias c where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:catalog:manage',a,s,p_cafeteria_id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.update_cafeteria_catalog_settings(p_cafeteria_id uuid, p_scheduling_enabled boolean, p_expected_version integer)
 RETURNS TABLE(version integer, scheduling_enabled boolean, catalog_currency_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  select c.account_id,c.school_id into a,s from public.cafeterias c
    where c.id=p_cafeteria_id and c.status='active';
  if not found or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:catalog:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  update public.cafeteria_operation_settings x set scheduling_enabled=p_scheduling_enabled,version=x.version+1
    where x.cafeteria_id=p_cafeteria_id and x.account_id=a and x.school_id=s and x.version=p_expected_version;
  if not found then raise exception using errcode='40001',message='stale_catalog_settings_version'; end if;
  return query select x.version,x.scheduling_enabled,x.catalog_currency_code
    from public.cafeteria_operation_settings x where x.cafeteria_id=p_cafeteria_id;
end $function$;

CREATE OR REPLACE FUNCTION public.create_cafeteria_register(p_cafeteria_id uuid, p_register_id uuid, p_register_code text, p_display_name text)
 RETURNS TABLE(register_id uuid, register_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; l uuid; actor uuid; code text; label text; existing public.cafeteria_registers%rowtype;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  actor:=pikas_private.sandbox_admin_actor('cafeteria_admin');
  select x.account_id,x.school_id,x.school_location_id into a,s,l
    from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id) x;
  if actor is null or a is null or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:registers:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  code:=nullif(btrim(p_register_code),''); label:=nullif(btrim(p_display_name),'');
  if p_register_id is null or code is null or length(code)>32 or label is null or length(label)>120 then
    raise exception using errcode='22023',message='invalid_cafeteria_register';
  end if;
  insert into public.cafeteria_registers(id,account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
  values(p_register_id,a,s,l,p_cafeteria_id,code,label)
  on conflict(id) do nothing returning id,version into register_id,register_version;
  if found then
    perform pikas_private.record_pos_operational_audit(actor,auth.uid(),'cafeteria_admin',a,s,p_cafeteria_id,
      'register_created','cafeteria_registers',register_id,'{}'::jsonb,
      jsonb_build_object('register_code',code,'display_name',label,'status','active'));
    return next; return;
  end if;
  select r.* into existing from public.cafeteria_registers r
    where r.id=p_register_id and r.account_id=a and r.school_id=s and r.cafeteria_id=p_cafeteria_id;
  if not found or existing.register_code<>code or existing.display_name<>label or existing.status<>'active' then
    raise exception using errcode='23505',message='register_request_id_reused_with_different_payload';
  end if;
  return query select existing.id,existing.version;
end $function$;

CREATE OR REPLACE FUNCTION public.update_cafeteria_register(p_cafeteria_id uuid, p_register_id uuid, p_expected_version integer, p_register_code text, p_display_name text, p_status text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; actor uuid; code text; label text; current_register public.cafeteria_registers%rowtype; updated_version integer;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  actor:=pikas_private.sandbox_admin_actor('cafeteria_admin');
  select x.account_id,x.school_id into a,s from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id) x;
  if actor is null or a is null or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:registers:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  code:=nullif(btrim(p_register_code),''); label:=nullif(btrim(p_display_name),'');
  if code is null or length(code)>32 or label is null or length(label)>120
      or p_status is null or p_status not in ('active','inactive') then
    raise exception using errcode='22023',message='invalid_cafeteria_register';
  end if;
  select r.* into current_register from public.cafeteria_registers r
    where r.id=p_register_id and r.account_id=a and r.school_id=s and r.cafeteria_id=p_cafeteria_id for update;
  if not found then raise exception using errcode='23503',message='register_not_found_in_cafeteria'; end if;
  if p_expected_version is null or current_register.version<>p_expected_version then
    raise exception using errcode='40001',message='stale_cafeteria_register_version';
  end if;
  if current_register.register_code<>code and exists(select 1 from public.register_sessions rs where rs.register_id=p_register_id) then
    raise exception using errcode='23514',message='register_code_immutable_after_session_history';
  end if;
  update public.cafeteria_registers r set register_code=code,display_name=label,status=p_status,version=r.version+1
    where r.id=p_register_id returning r.version into updated_version;
  perform pikas_private.record_pos_operational_audit(actor,auth.uid(),'cafeteria_admin',a,s,p_cafeteria_id,
    case when current_register.status<>p_status then 'register_status_changed' else 'register_updated' end,
    'cafeteria_registers',p_register_id,
    jsonb_build_object('register_code',current_register.register_code,'display_name',current_register.display_name,'status',current_register.status),
    jsonb_build_object('register_code',code,'display_name',label,'status',p_status));
  return updated_version;
end $function$;

CREATE OR REPLACE FUNCTION public.update_cafeteria_register_assignment(p_cafeteria_id uuid, p_assignment_id uuid, p_expected_version integer, p_status text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid; s uuid; actor uuid; target_person uuid; register_id_value uuid;
  current_assignment public.cafeteria_register_assignments%rowtype; member_status text; role_value text; register_status text; updated_version integer;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('cafeteria_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  actor:=pikas_private.sandbox_admin_actor('cafeteria_admin');
  select x.account_id,x.school_id into a,s from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id) x;
  if actor is null or a is null or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:register_assignments:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_status is null or p_status not in ('active','inactive') then raise exception using errcode='22023',message='invalid_assignment_status'; end if;
  select ra.operator_person_id,ra.register_id into target_person,register_id_value
    from public.cafeteria_register_assignments ra where ra.id=p_assignment_id
      and ra.account_id=a and ra.school_id=s and ra.cafeteria_id=p_cafeteria_id;
  if not found then raise exception using errcode='23503',message='register_assignment_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_person::text,20261005));
  perform 1 from public.cafeteria_registers r where r.id=register_id_value for update;
  select ra.* into current_assignment from public.cafeteria_register_assignments ra
    where ra.id=p_assignment_id and ra.account_id=a and ra.school_id=s and ra.cafeteria_id=p_cafeteria_id for update;
  if not found then raise exception using errcode='23503',message='register_assignment_not_found'; end if;
  if p_expected_version is null or current_assignment.version<>p_expected_version then
    raise exception using errcode='40001',message='stale_register_assignment_version';
  end if;
  if p_status='active' then
    select m.status,m.role_code into member_status,role_value from public.cafeteria_memberships m
      where m.id=current_assignment.cafeteria_membership_id and m.person_id=current_assignment.operator_person_id;
    select r.status into register_status from public.cafeteria_registers r where r.id=register_id_value;
    if member_status<>'active'
        or register_status<>'active' or not exists(select 1 from pikas_private.role_capabilities rc
          where rc.scope_kind='cafeteria' and rc.role_code=role_value and rc.capability='cafeteria:pos:session:open') then
      raise exception using errcode='23514',message='active_pos_membership_and_register_required';
    end if;
  end if;
  if current_assignment.status=p_status then return current_assignment.version; end if;
  update public.cafeteria_register_assignments ra set status=p_status,version=ra.version+1
    where ra.id=p_assignment_id returning ra.version into updated_version;
  perform pikas_private.record_pos_operational_audit(actor,auth.uid(),'cafeteria_admin',a,s,p_cafeteria_id,
    case when p_status='active' then 'register_assignment_activated' else 'register_assignment_deactivated' end,
    'cafeteria_register_assignments',p_assignment_id,
    jsonb_build_object('status',current_assignment.status),jsonb_build_object('status',p_status));
  return updated_version;
end $function$;

CREATE OR REPLACE FUNCTION public.platform_enter_sandbox_pov(p_request_id uuid, p_account_id uuid, p_cafeteria_id uuid, p_pov_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid; auth_actor uuid; payload jsonb; fingerprint text; replay jsonb; result jsonb;
  school_uuid uuid; persona pikas_private.sandbox_pov_personas%rowtype; persona_name text;
  session_uuid uuid:=gen_random_uuid(); started timestamptz; expiry timestamptz;
begin
  actor:=pikas_private.require_platform_capability('platform:sandbox:pov:enter');
  auth_actor:=auth.uid();
  if p_account_id is null or p_cafeteria_id is null or (p_pov_code is null or p_pov_code not in ('cashier','school_admin','cafeteria_admin')) then
    raise exception using errcode='22023',message='invalid_sandbox_pov_request';
  end if;
  payload:=jsonb_build_object('account_id',p_account_id,'cafeteria_id',p_cafeteria_id,'pov_code',p_pov_code);
  fingerprint:=pikas_private.platform_request_fingerprint(payload);
  replay:=pikas_private.platform_replay_request(p_request_id,'sandbox_pov_enter',fingerprint,actor);
  if replay is not null then return replay; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261009));

  select ca.school_id into school_uuid from public.cafeterias ca
    join public.accounts ac on ac.id=ca.account_id and ac.status='active' and ac.tenant_kind='sandbox'
    where ca.id=p_cafeteria_id and ca.account_id=p_account_id
      and pikas_private.scope_active(ca.account_id,ca.school_id,ca.id);
  if school_uuid is null then
    raise exception using errcode='42501',message='sandbox_pov_not_available';
  end if;
  select pr.* into persona from pikas_private.sandbox_pov_personas pr
    where pr.account_id=p_account_id and pr.cafeteria_id=p_cafeteria_id and pr.pov_code=p_pov_code
      and pikas_private.sandbox_persona_valid(pr.id);
  if not found then
    raise exception using errcode='42501',message='sandbox_pov_not_available';
  end if;
  select pp.display_name into persona_name from public.persons pp where pp.id=persona.person_id;

  update pikas_private.sandbox_pov_sessions s set status='exited',ended_at=clock_timestamp(),end_reason='superseded'
    where s.initiator_person_id=actor and s.status='active';
  started:=clock_timestamp(); expiry:=started+interval '4 hours';
  insert into pikas_private.sandbox_pov_sessions(
    id,request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,
    persona_id,persona_person_id,persona_membership_id,persona_school_membership_id,started_at,expires_at
  ) values (
    session_uuid,p_request_id,actor,auth_actor,p_account_id,school_uuid,p_cafeteria_id,p_pov_code,
    persona.id,persona.person_id,persona.cafeteria_membership_id,persona.school_membership_id,started,expiry
  );
  result:=jsonb_build_object(
    'session_id',session_uuid,'account_id',p_account_id,'school_id',school_uuid,'cafeteria_id',p_cafeteria_id,
    'pov_code',p_pov_code,'persona_person_id',persona.person_id,'persona_display_name',persona_name,
    'persona_membership_id',coalesce(persona.cafeteria_membership_id,persona.school_membership_id),'started_at',started,'expires_at',expiry);
  insert into pikas_private.platform_requests(
    request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response
  ) values(p_request_id,'sandbox_pov_enter',fingerprint,auth_actor,actor,result);
  perform pikas_private.record_platform_audit(
    p_request_id,actor,auth_actor,'platform:sandbox:pov:enter','sandbox_pov_entered','sandbox_pov_entered',
    p_account_id,school_uuid,null,p_cafeteria_id,persona.person_id,null,
    jsonb_build_object('session_id',session_uuid,'pov_code',p_pov_code,'persona_id',persona.id,
      'persona_membership_id',coalesce(persona.cafeteria_membership_id,persona.school_membership_id),'expires_at',expiry));
  return result;
end $function$;

create or replace function public.platform_get_active_sandbox_pov() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 perform pikas_private.require_platform_capability('platform:sandbox:pov:enter');
 select jsonb_build_object('session_id',x.pov_session_id,'account_id',x.account_id,'account_name',a.name,
 'school_id',x.school_id,'cafeteria_id',x.cafeteria_id,'cafeteria_name',c.name,'pov_code',x.pov_code,
 'persona_display_name',p.display_name,'operator_name',ip.display_name,'expires_at',x.expires_at)
 into result from pikas_private.sandbox_validated_pov() x join public.accounts a on a.id=x.account_id
 join public.cafeterias c on c.id=x.cafeteria_id join public.persons p on p.id=x.persona_person_id
 join public.persons ip on ip.id=x.initiator_person_id;
 return result;
end $$;
create or replace function public.platform_list_sandbox_pov_targets() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 perform pikas_private.require_platform_capability('platform:sandbox:pov:enter');
 select coalesce(jsonb_agg(jsonb_build_object('account_id',a.id,'account_name',a.name,'school_id',pr.school_id,
 'cafeteria_id',c.id,'cafeteria_name',c.name,'pov_code',pr.pov_code,'persona_display_name',p.display_name)
 order by a.name,c.name,pr.pov_code),'[]'::jsonb) into result
 from pikas_private.sandbox_pov_personas pr join public.accounts a on a.id=pr.account_id
 join public.cafeterias c on c.id=pr.cafeteria_id join public.persons p on p.id=pr.person_id
 where pikas_private.sandbox_persona_valid(pr.id);
 return result;
end $$;
create or replace function pikas_private.stamp_audit_sandbox_pov() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare x record;
begin
 select * into x from pikas_private.sandbox_validated_pov();
 if found and new.account_id=x.account_id and (new.actor_person_id=x.persona_person_id or
  (x.pov_code in ('school_admin','cafeteria_admin') and new.actor_person_id=x.initiator_person_id)) then
  new.sandbox_pov_session_id:=x.pov_session_id;
  if x.pov_code in ('school_admin','cafeteria_admin') then
  new.after_metadata:=coalesce(new.after_metadata,'{}'::jsonb)||jsonb_build_object('real_operator_person_id',x.initiator_person_id,
    'effective_persona_person_id',x.persona_person_id,'pov_code',x.pov_code,'pov_session_id',x.pov_session_id,
    'account_id',x.account_id,'school_id',x.school_id,'cafeteria_id',x.cafeteria_id);
  end if;
 else new.sandbox_pov_session_id:=null; end if;
 return new;
end $$;
-- Deterministic fictional identities only. Missing Horizonte on pre-seed local reset skips;
-- initialized target drift aborts. Never grant memberships to a platform operator.
do $personas$
declare a constant uuid:='03e71159-69e9-4387-9b3b-65799d49faf0';
 s constant uuid:='df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488'; c constant uuid:='b9496342-5079-46ae-83b8-05c39bcbd7fe';
 r record;
begin
 if not exists(select 1 from public.accounts where id=a) then
  if not exists(select 1 from public.accounts) and not exists(select 1 from public.persons) then return; end if;
  raise exception 'sandbox_admin_bootstrap_horizonte_missing';
 end if;
 if not exists(select 1 from public.accounts where id=a and tenant_kind='sandbox' and status='active')
 or not exists(select 1 from public.cafeterias where id=c and account_id=a and school_id=s
  and school_location_id='cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4') or not pikas_private.scope_active(a,s,c) then
  raise exception 'sandbox_admin_bootstrap_scope_mismatch';
 end if;
 for r in select * from (values
 ('4d600000-0000-4000-8000-000000000001'::uuid,'4d600000-0000-4000-8000-000000000011'::uuid,'4d600000-0000-4000-8000-000000000021'::uuid,'school_admin','Administrador escolar · Demo Horizonte'),
 ('4d600000-0000-4000-8000-000000000002'::uuid,'4d600000-0000-4000-8000-000000000012'::uuid,'4d600000-0000-4000-8000-000000000022'::uuid,'cafeteria_admin','Administrador de cafetería · Demo Horizonte')) v(person_id,membership_id,persona_id,code,name) loop
 if not exists(select 1 from pikas_private.sandbox_pov_personas where id=r.persona_id) then
  if exists(select 1 from public.persons where id=r.person_id) then raise exception 'sandbox_admin_identity_collision'; end if;
  insert into public.persons(id,display_name,status,auth_user_id) values(r.person_id,r.name,'active',null);
  if r.code='school_admin' then
   insert into public.school_memberships(id,account_id,school_id,person_id,role_code) values(r.membership_id,a,s,r.person_id,r.code);
  else
   insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values(r.membership_id,a,s,c,r.person_id,r.code);
  end if;
  insert into pikas_private.sandbox_pov_personas(id,account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id,school_membership_id)
  values(r.persona_id,a,s,c,r.code,r.person_id,case when r.code='cafeteria_admin' then r.membership_id end,case when r.code='school_admin' then r.membership_id end);
  insert into public.audit_events(actor_role,actor_scope_kind,account_id,school_id,cafeteria_id,action,target_type,target_id,outcome,after_metadata)
  values('database_maintenance','system',a,s,c,'sandbox_persona_registered','sandbox_pov_personas',r.persona_id,'succeeded',jsonb_build_object('pov_code',r.code,'migration','202610120002_sandbox_admin_pov'));
 end if;
 if not pikas_private.sandbox_persona_valid(r.persona_id) or not exists(select 1 from pikas_private.sandbox_pov_personas
 where id=r.persona_id and person_id=r.person_id and pov_code=r.code and account_id=a and school_id=s and cafeteria_id=c
 and coalesce(school_membership_id,cafeteria_membership_id)=r.membership_id)
 or exists(select 1 from pikas_private.platform_memberships where person_id=r.person_id)
 or exists(select 1 from public.account_memberships where person_id=r.person_id)
 or (select count(*) from public.school_memberships where person_id=r.person_id)<>(case when r.code='school_admin' then 1 else 0 end)
 or (select count(*) from public.cafeteria_memberships where person_id=r.person_id)<>(case when r.code='cafeteria_admin' then 1 else 0 end) then
  raise exception 'sandbox_admin_bootstrap_persona_mismatch';
 end if;
 end loop;
end $personas$;
-- New private helpers are never browser-callable. Existing public grants are preserved.

alter function public.get_pos_access_context() volatile;
alter function public.get_my_open_register_session() volatile;
alter function public.get_pos_register_session(uuid) volatile;

revoke all on function pikas_private.sandbox_persona_valid(uuid),pikas_private.sandbox_pov_active_attempt(),
pikas_private.sandbox_validated_pov(),pikas_private.sandbox_admin_actor(text),
pikas_private.sandbox_admin_has_capability(text,text,uuid,uuid,uuid),pikas_private.begin_sandbox_admin_command(text),
pikas_private.revalidate_sandbox_admin_command(),pikas_private.check_sandbox_admin_write(),
pikas_private.tenant_school_admin_context(),pikas_private.tenant_cafeteria_admin_context()
from public,anon,authenticated,service_role;
commit;
