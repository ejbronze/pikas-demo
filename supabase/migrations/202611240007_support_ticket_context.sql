-- PIKAS Pilot Hardening: support ticket context (local; not deployed).
--
-- Completes the minimum ticket fields of 202611240006 without changing its authority:
--   * Sede and Caja context, derived on the server: the Cafetería's sede, and the register of the reporter's own open
--     session in that Cafetería (if any). Never taken from the client.
--   * Application version and browser user agent, supplied by the server route (bounded; never form contents).
--   * Demo flag: a fictional sandbox tenant's own staff may report; their tickets are marked Demo and excluded from the
--     Platform queue unless «Incluir Demo» is chosen (the Reportes convention). A Demo POV is still refused: its
--     identity is the PIKAS operator, who reports outside the Demo.
--   * Every support mutation carries the shared UX11 guard (pikas_private.require_no_current_demo) explicitly, like the other
--     real mutation RPCs; the helpers use it too instead of their own check.
-- 202611240006 stays as committed; its create and list functions are replaced by the extended signatures here.
begin;

alter table pikas_private.support_tickets
  add column school_location_id uuid references public.school_locations(id),
  add column register_id uuid references public.cafeteria_registers(id),
  add column app_version text check (app_version is null or app_version ~ '^[A-Za-z0-9._+-]{1,40}$'),
  add column user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  add column is_demo boolean not null default false;
create index support_tickets_demo_idx on pikas_private.support_tickets(is_demo, status, updated_at desc);

create or replace function pikas_private.support_reporter() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := pikas_private.current_person_id();
begin
  perform pikas_private.require_no_current_demo();
  if actor is null or not exists (select 1 from public.persons p where p.id = actor and p.status = 'active') then
    raise exception using errcode = '42501', message = 'support_reporter_required'; end if;
  return actor;
end $$;

create or replace function pikas_private.support_platform_actor(p_capability text) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := pikas_private.require_platform_capability(p_capability);
begin
  perform pikas_private.require_no_current_demo();
  return actor;
end $$;

-- Sandbox tenants' own staff are reporters too (marked Demo); real customers unchanged.
create or replace function pikas_private.support_reporter_scopes(p_person uuid)
returns table(account_id uuid, account_name text, school_id uuid, school_name text, cafeteria_id uuid, cafeteria_name text, role text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, null::uuid, null::text, null::uuid, null::text, 'account_admin' from public.account_memberships m join public.accounts a on a.id = m.account_id
    where m.person_id = p_person and m.status = 'active' and m.role_code = 'account_admin' and a.tenant_kind in ('customer','sandbox')
  union all
  select a.id, a.name, s.id, s.name, null, null, 'school_admin' from public.school_memberships m join public.schools s on s.id = m.school_id join public.accounts a on a.id = m.account_id
    where m.person_id = p_person and m.status = 'active' and m.role_code = 'school_admin' and a.tenant_kind in ('customer','sandbox')
  union all
  select a.id, a.name, s.id, s.name, c.id, c.name, m.role_code from public.cafeteria_memberships m join public.cafeterias c on c.id = m.cafeteria_id
    join public.schools s on s.id = c.school_id join public.accounts a on a.id = m.account_id
    where m.person_id = p_person and m.status = 'active' and m.role_code in ('cafeteria_admin','pos_supervisor','pos_cashier','pos_operator') and a.tenant_kind in ('customer','sandbox')
$$;

drop function public.support_create_ticket(uuid,uuid,uuid,uuid,text,text,text,text);
create function public.support_create_ticket(p_request_key uuid, p_account_id uuid, p_school_id uuid, p_cafeteria_id uuid,
  p_category text, p_subject text, p_description text, p_page_path text default null, p_app_version text default null, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := pikas_private.support_reporter(); fp text; existing pikas_private.support_tickets%rowtype; scope record; t pikas_private.support_tickets%rowtype;
  subj text := btrim(coalesce(p_subject, '')); descr text := btrim(coalesce(p_description, '')); ua text := left(nullif(btrim(coalesce(p_user_agent, '')), ''), 300);
  ver text := nullif(btrim(coalesce(p_app_version, '')), ''); loc uuid; reg uuid; demo boolean;
begin
  perform pikas_private.require_no_current_demo();
  if p_request_key is null then raise exception using errcode = '22023', message = 'request_key_required'; end if;
  -- The fingerprint covers what the reporter wrote; version and browser describe the transport and may differ on a retry.
  fp := pikas_private.platform_request_fingerprint(jsonb_build_object('account', p_account_id, 'school', p_school_id, 'cafeteria', p_cafeteria_id,
    'category', p_category, 'subject', subj, 'description', descr, 'path', p_page_path));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_key::text, 20261124));
  select * into existing from pikas_private.support_tickets where request_key = p_request_key;
  if found then
    if existing.reporter_person_id <> actor or existing.request_fingerprint <> fp then raise exception using errcode = '23505', message = 'request_key_conflict'; end if;
    return pikas_private.support_reporter_view(existing) || jsonb_build_object('replayed', true);
  end if;
  select * into scope from pikas_private.support_reporter_scopes(actor) s
    where s.account_id = p_account_id and s.school_id is not distinct from p_school_id and s.cafeteria_id is not distinct from p_cafeteria_id
    order by case s.role when 'cafeteria_admin' then 0 when 'pos_supervisor' then 1 else 2 end limit 1;
  if not found then raise exception using errcode = '42501', message = 'support_scope_required'; end if;
  if p_category is null or p_category not in ('technical','access','pos','pikas_cash','report_data','other') then raise exception using errcode = '22023', message = 'invalid_category'; end if;
  if char_length(subj) not between 3 and 140 then raise exception using errcode = '22023', message = 'invalid_subject'; end if;
  if char_length(descr) not between 10 and 4000 then raise exception using errcode = '22023', message = 'invalid_description'; end if;
  if not pikas_private.support_text_ok(subj) or not pikas_private.support_text_ok(descr) then raise exception using errcode = '22023', message = 'support_secret_detected'; end if;
  if p_page_path is not null and p_page_path !~ '^/[A-Za-z0-9/_-]{0,199}$' then raise exception using errcode = '22023', message = 'invalid_page_path'; end if;
  if ver is not null and ver !~ '^[A-Za-z0-9._+-]{1,40}$' then ver := null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 20261124));
  if (select count(*) from pikas_private.support_tickets where reporter_person_id = actor and created_at > clock_timestamp() - interval '1 day') >= 20 then
    raise exception using errcode = '54000', message = 'support_rate_limited'; end if;
  select tenant_kind = 'sandbox' into demo from public.accounts where id = scope.account_id;
  if scope.cafeteria_id is not null then
    select c.school_location_id into loc from public.cafeterias c where c.id = scope.cafeteria_id;
    select rs.register_id into reg from public.register_sessions rs
      where rs.cafeteria_id = scope.cafeteria_id and rs.operator_person_id = actor and rs.status = 'open' order by rs.opened_at desc limit 1;
  end if;
  insert into pikas_private.support_tickets(account_id, school_id, cafeteria_id, school_location_id, register_id, reporter_person_id, reporter_auth_user_id, reporter_role,
    category, subject, description, page_path, app_version, user_agent, is_demo, request_key, request_fingerprint)
  values (scope.account_id, scope.school_id, scope.cafeteria_id, loc, reg, actor, auth.uid(), scope.role, p_category, subj, descr, p_page_path, ver, ua, demo, p_request_key, fp)
  returning * into t;
  insert into pikas_private.support_ticket_events(ticket_id, kind, visibility, body, actor_person_id, actor_auth_user_id, actor_side, to_status, request_key, request_fingerprint)
  values (t.id, 'created', 'reporter', null, actor, auth.uid(), 'reporter', 'received', p_request_key, fp);
  return pikas_private.support_reporter_view(t) || jsonb_build_object('replayed', false);
end $$;

create or replace function public.support_reporter_reply(p_request_key uuid, p_ticket_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := pikas_private.support_reporter(); fp text; prior pikas_private.support_ticket_events%rowtype; t pikas_private.support_tickets%rowtype;
  body text := btrim(coalesce(p_body, '')); next_status text;
begin
  perform pikas_private.require_no_current_demo();
  if p_request_key is null then raise exception using errcode = '22023', message = 'request_key_required'; end if;
  fp := pikas_private.platform_request_fingerprint(jsonb_build_object('ticket', p_ticket_id, 'action', 'reporter_reply', 'body', body));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_key::text, 20261124));
  select * into prior from pikas_private.support_ticket_events where request_key = p_request_key;
  if found then
    if prior.actor_person_id <> actor or prior.request_fingerprint <> fp then raise exception using errcode = '23505', message = 'request_key_conflict'; end if;
    select * into t from pikas_private.support_tickets where id = prior.ticket_id;
    return pikas_private.support_reporter_view(t) || jsonb_build_object('replayed', true);
  end if;
  select * into t from pikas_private.support_tickets where id = p_ticket_id and reporter_person_id = actor for update;
  if not found then raise exception using errcode = '42501', message = 'support_ticket_not_found'; end if;
  if t.status = 'closed' then raise exception using errcode = '55000', message = 'support_ticket_closed'; end if;
  if char_length(body) not between 1 and 4000 then raise exception using errcode = '22023', message = 'invalid_body'; end if;
  if not pikas_private.support_text_ok(body) then raise exception using errcode = '22023', message = 'support_secret_detected'; end if;
  next_status := case when t.status in ('info_requested','resolved') then 'in_review' else t.status end;
  insert into pikas_private.support_ticket_events(ticket_id, kind, visibility, body, actor_person_id, actor_auth_user_id, actor_side, from_status, to_status, request_key, request_fingerprint)
  values (t.id, 'reporter_reply', 'reporter', body, actor, auth.uid(), 'reporter', t.status, next_status, p_request_key, fp);
  update pikas_private.support_tickets set status = next_status, updated_at = clock_timestamp(), resolved_at = case when next_status = 'resolved' then resolved_at end
    where id = t.id returning * into t;
  return pikas_private.support_reporter_view(t) || jsonb_build_object('replayed', false);
end $$;

create or replace function public.platform_support_act(p_request_key uuid, p_ticket_id uuid, p_action text, p_body text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := pikas_private.support_platform_actor('platform:support:manage'); fp text; prior pikas_private.support_ticket_events%rowtype;
  t pikas_private.support_tickets%rowtype; body text := nullif(btrim(coalesce(p_body, '')), ''); next_status text; ev_kind text; vis text := 'reporter';
begin
  perform pikas_private.require_no_current_demo();
  if p_request_key is null then raise exception using errcode = '22023', message = 'request_key_required'; end if;
  fp := pikas_private.platform_request_fingerprint(jsonb_build_object('ticket', p_ticket_id, 'action', p_action, 'body', body));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_key::text, 20261124));
  select * into prior from pikas_private.support_ticket_events where request_key = p_request_key;
  if found then
    if prior.actor_person_id <> actor or prior.request_fingerprint <> fp then raise exception using errcode = '23505', message = 'request_key_conflict'; end if;
    return public.platform_support_ticket(prior.ticket_id) || jsonb_build_object('replayed', true);
  end if;
  select * into t from pikas_private.support_tickets where id = p_ticket_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'support_ticket_not_found'; end if;
  -- Revalidate after the lock wait.
  if pikas_private.support_platform_actor('platform:support:manage') is distinct from actor then raise exception using errcode = '42501', message = 'not_authorized'; end if;
  if body is not null and (char_length(body) > 4000 or not pikas_private.support_text_ok(body)) then
    raise exception using errcode = '22023', message = case when char_length(body) > 4000 then 'invalid_body' else 'support_secret_detected' end; end if;
  if p_action = 'reply' then
    if t.status = 'closed' then raise exception using errcode = '55000', message = 'support_ticket_closed'; end if;
    ev_kind := 'platform_reply'; next_status := case when t.status = 'received' then 'in_review' else t.status end;
  elsif p_action = 'note' then ev_kind := 'internal_note'; vis := 'internal'; next_status := t.status;
  elsif p_action = 'request_info' then
    if t.status not in ('received','in_review','info_requested') then raise exception using errcode = '55000', message = 'invalid_transition'; end if;
    ev_kind := 'info_requested'; next_status := 'info_requested';
  elsif p_action = 'review' then
    if t.status not in ('received','info_requested') then raise exception using errcode = '55000', message = 'invalid_transition'; end if;
    ev_kind := 'review_started'; next_status := 'in_review';
  elsif p_action = 'resolve' then
    if t.status not in ('received','in_review','info_requested') then raise exception using errcode = '55000', message = 'invalid_transition'; end if;
    ev_kind := 'resolved'; next_status := 'resolved';
  elsif p_action = 'close' then
    if t.status = 'closed' then raise exception using errcode = '55000', message = 'invalid_transition'; end if;
    ev_kind := 'closed'; next_status := 'closed';
  elsif p_action = 'reopen' then
    if t.status not in ('resolved','closed') then raise exception using errcode = '55000', message = 'invalid_transition'; end if;
    ev_kind := 'reopened'; vis := 'internal'; next_status := 'in_review';
  else raise exception using errcode = '22023', message = 'invalid_action'; end if;
  if body is null and p_action in ('reply','note','request_info','resolve','reopen') then raise exception using errcode = '22023', message = 'body_required'; end if;
  -- reopen keeps its reason internal; the reporter sees only the status change through the ticket.
  insert into pikas_private.support_ticket_events(ticket_id, kind, visibility, body, actor_person_id, actor_auth_user_id, actor_side, from_status, to_status, request_key, request_fingerprint)
  values (t.id, ev_kind, vis, body, actor, auth.uid(), 'platform', t.status, next_status, p_request_key, fp);
  update pikas_private.support_tickets set status = next_status, updated_at = clock_timestamp(),
    resolved_at = case when next_status = 'resolved' then clock_timestamp() when next_status = 'in_review' then null else resolved_at end,
    closed_at = case when next_status = 'closed' then clock_timestamp() when next_status = 'in_review' then null else closed_at end
    where id = t.id;
  return public.platform_support_ticket(t.id) || jsonb_build_object('replayed', false);
end $$;

create or replace function pikas_private.support_platform_row(t pikas_private.support_tickets) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'reference', pikas_private.support_ticket_number_label(t.number), 'category', t.category, 'subject', t.subject, 'status', t.status,
    'account_id', t.account_id, 'account_name', a.name, 'school_name', s.name, 'location_name', l.name, 'cafeteria_name', c.name, 'register_name', r.display_name,
    'reporter_name', p.display_name, 'reporter_role', t.reporter_role, 'is_demo', t.is_demo, 'created_at', t.created_at, 'updated_at', t.updated_at)
  from public.accounts a join public.persons p on p.id = t.reporter_person_id
  left join public.schools s on s.id = t.school_id left join public.school_locations l on l.id = t.school_location_id
  left join public.cafeterias c on c.id = t.cafeteria_id left join public.cafeteria_registers r on r.id = t.register_id where a.id = t.account_id
$$;

drop function public.platform_support_list(text,text,text);
create function public.platform_support_list(p_status text default 'open', p_category text default null, p_query text default null, p_include_demo boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(btrim(coalesce(p_query, '')), ''); demo boolean := coalesce(p_include_demo, false);
begin
  perform pikas_private.support_platform_actor('platform:support:read');
  if p_status not in ('open','all','received','in_review','info_requested','resolved','closed') then raise exception using errcode = '22023', message = 'invalid_status'; end if;
  if p_category is not null and p_category not in ('technical','access','pos','pikas_cash','report_data','other') then raise exception using errcode = '22023', message = 'invalid_category'; end if;
  if q is not null and char_length(q) > 100 then raise exception using errcode = '22023', message = 'invalid_query'; end if;
  return jsonb_build_object('include_demo', demo,
    'counts', (select jsonb_object_agg(st, n) from (select status st, count(*) n from pikas_private.support_tickets where demo or not is_demo group by status) x),
    'rows', coalesce((select jsonb_agg(pikas_private.support_platform_row(t) order by t.updated_at desc, t.id) from (
      select t.* from pikas_private.support_tickets t join public.accounts a on a.id = t.account_id join public.persons p on p.id = t.reporter_person_id
      where (demo or not t.is_demo)
        and (p_status = 'all' or (p_status = 'open' and t.status in ('received','in_review','info_requested')) or t.status = p_status)
        and (p_category is null or t.category = p_category)
        and (q is null or pikas_private.support_ticket_number_label(t.number) ilike '%' || q || '%' or t.subject ilike '%' || q || '%' or a.name ilike '%' || q || '%' or p.display_name ilike '%' || q || '%')
      order by t.updated_at desc, t.id limit 100) t), '[]'::jsonb));
end $$;

create or replace function public.platform_support_ticket(p_ticket_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t pikas_private.support_tickets%rowtype;
begin
  perform pikas_private.support_platform_actor('platform:support:read');
  select * into t from pikas_private.support_tickets where id = p_ticket_id;
  if not found then raise exception using errcode = 'P0002', message = 'support_ticket_not_found'; end if;
  return pikas_private.support_platform_row(t) || jsonb_build_object('description', t.description, 'page_path', t.page_path,
    'app_version', t.app_version, 'user_agent', t.user_agent,
    'can_manage', pikas_private.platform_has_capability('platform:support:manage'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'visibility', e.visibility, 'body', e.body, 'author', p.display_name, 'side', e.actor_side,
      'from_status', e.from_status, 'to_status', e.to_status, 'created_at', e.created_at) order by e.created_at, e.id)
      from pikas_private.support_ticket_events e join public.persons p on p.id = e.actor_person_id where e.ticket_id = t.id), '[]'::jsonb));
end $$;

do $acl$
declare f text;
begin
  foreach f in array array['public.support_create_ticket(uuid,uuid,uuid,uuid,text,text,text,text,text,text)','public.platform_support_list(text,text,text,boolean)'] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.support_reporter_context()','public.support_create_ticket(uuid,uuid,uuid,uuid,text,text,text,text,text,text)',
    'public.support_reporter_reply(uuid,uuid,text)','public.platform_support_list(text,text,text,boolean)','public.platform_support_ticket(uuid)',
    'public.platform_support_act(uuid,uuid,text,text)'] loop
    if exists (select 1 from aclexplode((select proacl from pg_proc where oid = f::regprocedure)) a where a.grantee in (0, 'anon'::regrole::oid, 'service_role'::regrole::oid))
      or not has_function_privilege('authenticated', f, 'execute') then raise exception 'support_acl_mismatch %', f; end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pikas_private' and p.proname like 'support_%'
      and has_function_privilege('authenticated', p.oid, 'execute')) then raise exception 'support_private_helper_exposed'; end if;
end $acl$;

commit;
