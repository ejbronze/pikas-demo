-- PIKAS Pilot Hardening: support follows the customer lifecycle (local; not deployed).
--
-- The released lifecycle rule: memberships stay stored but grant nothing while the customer is suspended or closed.
-- Reporting and answering a support ticket are grants too, so they now require an active customer, like every other tenant
-- action. Staff of a suspended or closed customer use the contact channel (SUPPORT_OPERATIONS.md); Platform keeps reading
-- and answering their existing tickets. Nothing else changes.
begin;

create or replace function pikas_private.support_reporter_scopes(p_person uuid)
returns table(account_id uuid, account_name text, school_id uuid, school_name text, cafeteria_id uuid, cafeteria_name text, role text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, null::uuid, null::text, null::uuid, null::text, 'account_admin' from public.account_memberships m join public.accounts a on a.id = m.account_id
    where m.person_id = p_person and m.status = 'active' and m.role_code = 'account_admin' and a.tenant_kind in ('customer','sandbox') and a.status = 'active'
  union all
  select a.id, a.name, s.id, s.name, null, null, 'school_admin' from public.school_memberships m join public.schools s on s.id = m.school_id join public.accounts a on a.id = m.account_id
    where m.person_id = p_person and m.status = 'active' and m.role_code = 'school_admin' and a.tenant_kind in ('customer','sandbox') and a.status = 'active'
  union all
  select a.id, a.name, s.id, s.name, c.id, c.name, m.role_code from public.cafeteria_memberships m join public.cafeterias c on c.id = m.cafeteria_id
    join public.schools s on s.id = c.school_id join public.accounts a on a.id = m.account_id
    where m.person_id = p_person and m.status = 'active' and m.role_code in ('cafeteria_admin','pos_supervisor','pos_cashier','pos_operator')
      and a.tenant_kind in ('customer','sandbox') and a.status = 'active'
$$;

-- A reporter answers only while their customer is active (the ticket stays readable in «Mis reportes» only while it is,
-- since the reporter view requires the same authority as any tenant page).
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
  if not exists (select 1 from public.accounts a where a.id = t.account_id and a.status = 'active') then
    raise exception using errcode = '42501', message = 'support_scope_required'; end if;
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

-- «Mis reportes» lists only tickets of customers that are active (the scopes above), so a suspended customer's staff see
-- the same «organization suspended» state as every other tenant surface.
create or replace function public.support_reporter_context() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := pikas_private.support_reporter();
begin
  return jsonb_build_object('scopes', coalesce((select jsonb_agg(to_jsonb(s) order by s.account_name, s.school_name nulls first, s.cafeteria_name nulls first, s.role)
    from pikas_private.support_reporter_scopes(actor) s), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(pikas_private.support_reporter_view(t) order by t.created_at desc)
      from (select st.* from pikas_private.support_tickets st join public.accounts a on a.id = st.account_id
            where st.reporter_person_id = actor and a.status = 'active' order by st.created_at desc limit 50) t), '[]'::jsonb));
end $$;

do $acl$
begin
  if has_function_privilege('authenticated', 'pikas_private.support_reporter_scopes(uuid)', 'execute')
    or not has_function_privilege('authenticated', 'public.support_reporter_reply(uuid,uuid,text)', 'execute')
    or not has_function_privilege('authenticated', 'public.support_reporter_context()', 'execute')
    or has_function_privilege('anon', 'public.support_reporter_reply(uuid,uuid,text)', 'execute') then raise exception 'support_lifecycle_acl_mismatch'; end if;
end $acl$;

commit;
