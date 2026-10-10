-- 4D.4 internal team only. Existing tenant/POV contracts and data are unchanged.
begin;
insert into pikas_private.platform_capabilities(capability) values ('platform:team:manage');
insert into pikas_private.platform_role_capabilities(role_code,capability) values ('platform_admin','platform:team:manage');
alter table pikas_private.platform_audit_events drop constraint platform_audit_events_reason_code_check;
alter table pikas_private.platform_audit_events add constraint platform_audit_events_reason_code_check check (reason_code in (
 'owner_root_bootstrap','tenant_provisioned','school_location_added','customer_admin_intent_prepared',
 'identity_linked','customer_admin_granted','sandbox_pov_entered','sandbox_pov_exited',
 'team_prepared','team_completed','team_demo_changed'));
-- Opaque public handles never reveal Person/Auth/membership IDs.
create table pikas_private.platform_team_handles (
 handle text primary key default encode(extensions.gen_random_bytes(16),'hex'),
 person_id uuid not null unique references public.persons(id), check(handle ~ '^[0-9a-f]{32}$')
);
insert into pikas_private.platform_team_handles(person_id) select distinct person_id from pikas_private.platform_memberships;
create table pikas_private.platform_team_intents (
 handle text primary key default encode(extensions.gen_random_bytes(16),'hex'),
 display_name text not null check(length(btrim(display_name)) between 1 and 200),
 email_key text not null check(email_key=lower(btrim(email_key)) and length(email_key) between 3 and 254 and position('@' in email_key)>1),
 demo boolean not null, status text not null default 'pending' check(status in ('pending','completed')),
 created_by uuid not null references public.persons(id), created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '7 days',
 person_id uuid references public.persons(id), check((status='completed')=(person_id is not null))
);
alter table pikas_private.platform_team_handles enable row level security;
alter table pikas_private.platform_team_intents enable row level security;
revoke all on pikas_private.platform_team_handles,pikas_private.platform_team_intents from public,anon,authenticated,service_role;

create function pikas_private.lock_platform_team_actor() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 actor:=pikas_private.require_platform_capability('platform:team:manage');
 -- One small internal-team mutation at a time; consistent order before actor/target locks.
 perform pg_catalog.pg_advisory_xact_lock(20261010,4);
 perform 1 from public.persons where id=actor for share;
 perform 1 from pikas_private.platform_memberships where person_id=actor and role_code='platform_admin' order by id for share;
 if pikas_private.require_platform_capability('platform:team:manage') is distinct from actor then
  raise exception using errcode='42501',message='platform_actor_changed';
 end if;
 return actor;
end $$;
revoke all on function pikas_private.lock_platform_team_actor() from public,anon,authenticated,service_role;

create function public.platform_team_read() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform pikas_private.require_platform_capability('platform:team:manage');
 return jsonb_build_object('actor_handle',(select handle from pikas_private.platform_team_handles where person_id=pikas_private.platform_person_id()),'operators',coalesce((select jsonb_agg(jsonb_build_object(
  'handle',h.handle,'name',p.display_name,'email',u.email,'person_status',p.status,
  'admin_status',coalesce((select m.status from pikas_private.platform_memberships m where m.person_id=p.id and m.role_code='platform_admin' order by (m.status<>'inactive') desc,m.created_at desc,m.id limit 1),'none'),
  'demo',exists(select 1 from pikas_private.platform_memberships m where m.person_id=p.id and m.role_code='platform_sandbox_operator' and m.status='active')) order by p.display_name,h.handle)
  from pikas_private.platform_team_handles h join public.persons p on p.id=h.person_id left join auth.users u on u.id=p.auth_user_id),'[]'::jsonb),
 'prepared',coalesce((select jsonb_agg(jsonb_build_object('handle',handle,'name',display_name,'email',email_key,'demo',demo,
  'status',case when status='pending' and expires_at<=statement_timestamp() then 'expired' else status end) order by created_at,handle) from pikas_private.platform_team_intents),'[]'::jsonb));
end $$;

create function public.platform_team_command(p_request_id uuid,p_operation text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; fp text; replay jsonb; result jsonb; allowed text[]; target uuid; auth_id uuid; matches integer;
 intent pikas_private.platform_team_intents%rowtype; member pikas_private.platform_memberships%rowtype; enabled boolean;
begin
 actor:=pikas_private.lock_platform_team_actor();
 allowed:=case p_operation when 'prepare' then array['name','email','demo'] when 'complete' then array['handle'] when 'demo' then array['handle','enabled'] end;
 if allowed is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception using errcode='22023',message='invalid_team_command'; end if;
 if not(p_payload ?& allowed) or exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(allowed)) then raise exception using errcode='22023',message='unsupported_team_fields'; end if;
 fp:=pikas_private.platform_request_fingerprint(p_payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'team_'||p_operation,fp,actor);
 if replay is not null then return replay; end if;
 if p_operation='prepare' then
  if jsonb_typeof(p_payload->'name')<>'string' or jsonb_typeof(p_payload->'email')<>'string' or jsonb_typeof(p_payload->'demo')<>'boolean' then raise exception using errcode='22023',message='invalid_team_input'; end if;
  if exists(select 1 from pikas_private.platform_team_intents where email_key=lower(btrim(p_payload->>'email')) and status='pending' and expires_at>clock_timestamp()) then raise exception using errcode='23505',message='team_intent_already_pending'; end if;
  insert into pikas_private.platform_team_intents(display_name,email_key,demo,created_by) values(btrim(p_payload->>'name'),lower(btrim(p_payload->>'email')),(p_payload->>'demo')::boolean,actor);
 elsif p_operation='complete' then
  select * into intent from pikas_private.platform_team_intents where handle=p_payload->>'handle' for update;
  if not found or intent.status<>'pending' or intent.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_team_intent_required'; end if;
  select count(*) into matches from auth.users where lower(btrim(email))=intent.email_key;
  if matches<>1 then raise exception using errcode='23514',message='confirmed_identity_pending'; end if;
  begin
   select u.id into strict auth_id from auth.users u where lower(btrim(u.email))=intent.email_key and u.confirmed_at is not null
    and (not(to_jsonb(u)?'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
    and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
    and to_jsonb(u)->>'deleted_at' is null and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false for share;
  exception when no_data_found or too_many_rows then raise exception using errcode='23514',message='confirmed_identity_pending'; end;
  select id into target from public.persons where auth_user_id=auth_id for update;
  -- Never convert a customer identity or silently reactivate an existing operator.
  if auth_id=auth.uid() or exists(select 1 from public.account_memberships where person_id=target)
   or exists(select 1 from public.school_memberships where person_id=target)
   or exists(select 1 from public.cafeteria_memberships where person_id=target)
   or exists(select 1 from pikas_private.platform_memberships where person_id=target) then raise exception using errcode='42501',message='new_internal_operator_required'; end if;
  if target is not null and not exists(select 1 from public.persons where id=target and status='active') then raise exception using errcode='23514',message='active_person_required'; end if;
  if intent.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_team_intent_required'; end if;
  if target is null then insert into public.persons(auth_user_id,display_name) values(auth_id,intent.display_name) returning id into target; end if;
  insert into pikas_private.platform_memberships(person_id,role_code,granted_by_person_id) values(target,'platform_admin',actor);
  if intent.demo then insert into pikas_private.platform_memberships(person_id,role_code,granted_by_person_id) values(target,'platform_sandbox_operator',actor); end if;
  insert into pikas_private.platform_team_handles(person_id) values(target);
  update pikas_private.platform_team_intents set status='completed',person_id=target where handle=intent.handle;
 elsif p_operation='demo' then
  if jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception using errcode='22023',message='invalid_demo_flag'; end if;
  enabled:=(p_payload->>'enabled')::boolean;
  select person_id into target from pikas_private.platform_team_handles where handle=p_payload->>'handle';
  if target is null then raise exception using errcode='42501',message='internal_operator_required'; end if;
  perform 1 from public.persons where id=target and status='active' for share;
  if enabled and not found then raise exception using errcode='23514',message='active_operator_required'; end if;
  perform 1 from pikas_private.platform_memberships where person_id=target and role_code='platform_admin' and status='active' for share;
  if enabled and not found then raise exception using errcode='23514',message='active_platform_admin_required'; end if;
  if enabled then
   perform 1 from auth.users u join public.persons p on p.auth_user_id=u.id where p.id=target and u.confirmed_at is not null
    and (not(to_jsonb(u)?'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
    and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
    and to_jsonb(u)->>'deleted_at' is null and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false for share of u;
   if not found then raise exception using errcode='23514',message='confirmed_identity_pending'; end if;
  end if;
  select * into member from pikas_private.platform_memberships where person_id=target and role_code='platform_sandbox_operator' and status<>'inactive' for update;
  if enabled then
   if not found then insert into pikas_private.platform_memberships(person_id,role_code,granted_by_person_id) values(target,'platform_sandbox_operator',actor);
   elsif member.status<>'active' then update pikas_private.platform_memberships set status='active' where id=member.id; end if;
  elsif found then update pikas_private.platform_memberships set status='inactive' where id=member.id; end if;
 end if;
 if pikas_private.require_platform_capability('platform:team:manage') is distinct from actor then raise exception using errcode='42501',message='platform_actor_changed'; end if;
 result:=jsonb_build_object('request_id',p_request_id,'operation',p_operation,'status','confirmed');
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response) values(p_request_id,'team_'||p_operation,fp,auth.uid(),actor,result);
 perform pikas_private.record_platform_audit(p_request_id,actor,auth.uid(),'platform:team:manage','team_'||p_operation,
  case p_operation when 'prepare' then 'team_prepared' when 'complete' then 'team_completed' else 'team_demo_changed' end,
  null,null,null,null,target,null,jsonb_build_object('demo',case when p_operation='complete' then intent.demo when p_operation='demo' then enabled else (p_payload->>'demo')::boolean end));
 return result;
end $$;
revoke all on function public.platform_team_read(),public.platform_team_command(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.platform_team_read(),public.platform_team_command(uuid,text,jsonb) to authenticated;
commit;
