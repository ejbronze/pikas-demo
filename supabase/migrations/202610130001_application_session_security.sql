-- 4D.7F: application deadlines are separate from Auth, POV and register sessions.
-- Activation must verify the PostgREST pre-request setting after applying this migration.
create table pikas_private.application_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  last_active_at timestamptz not null,
  idle_seconds integer not null default 1800 check (idle_seconds in (900,1800)),
  ended_at timestamptz,
  check (last_active_at >= started_at)
);
alter table pikas_private.application_sessions enable row level security;
revoke all on pikas_private.application_sessions from public, anon, authenticated, service_role;

create function pikas_private.application_session_id(p_expected uuid default null)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if auth.uid() is null or v_id is null or not exists (
    select 1 from auth.sessions s where s.id=v_id and s.user_id=auth.uid()
      and (s.not_after is null or s.not_after > statement_timestamp())
  ) then raise exception 'application_session_required' using errcode='42501'; end if;
  if p_expected is not null and p_expected <> v_id then
    raise exception 'authentication_session_changed' using errcode='PT409';
  end if;
  return v_id;
end $$;

create function pikas_private.application_session_assert(p_pos boolean default false)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_row pikas_private.application_sessions; v_now timestamptz := clock_timestamp();
begin
  v_id := pikas_private.application_session_id();
  select * into v_row from pikas_private.application_sessions where session_id=v_id and user_id=auth.uid();
  if not found or v_row.ended_at is not null or v_now >= v_row.started_at + interval '8 hours'
    or v_now >= v_row.last_active_at + make_interval(secs => least(v_row.idle_seconds,case when p_pos then 900 else 1800 end))
  then raise exception 'application_session_expired' using errcode='42501'; end if;
end $$;

create function pikas_private.application_session_result(p_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object('session_id',session_id,'user_id',user_id,
    'server_now',clock_timestamp(),'started_at',started_at,'last_active_at',last_active_at,
    'idle_deadline',last_active_at + make_interval(secs=>idle_seconds),
    'absolute_deadline',started_at + interval '8 hours','idle_seconds',idle_seconds)
  from pikas_private.application_sessions where session_id=p_id and user_id=auth.uid();
$$;

create function public.pikas_session_start()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid := pikas_private.application_session_id();
begin
  -- The Auth session creation time is authoritative. Repeated starts cannot revive/extend it.
  insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at)
  select id,user_id,created_at,created_at from auth.sessions where id=v_id
  on conflict (session_id) do nothing;
  perform pikas_private.application_session_assert();
  return pikas_private.application_session_result(v_id);
end $$;

create function public.pikas_session_status(p_expected_session_id uuid default null, p_pos boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid := pikas_private.application_session_id(p_expected_session_id);
begin
  perform 1 from pikas_private.application_sessions where session_id=v_id for update;
  perform pikas_private.application_session_assert(p_pos);
  -- POS uses the stricter deadline across this Auth session's tabs. This does not count as activity.
  if p_pos then update pikas_private.application_sessions set idle_seconds=900 where session_id=v_id and idle_seconds<>900; end if;
  return pikas_private.application_session_result(v_id);
end $$;

create function public.pikas_session_activity(p_expected_session_id uuid, p_pos boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid := pikas_private.application_session_id(p_expected_session_id);
begin
  if p_expected_session_id is null then raise exception 'expected_session_required' using errcode='42501'; end if;
  perform 1 from pikas_private.application_sessions where session_id=v_id for update;
  -- Recheck wall time AFTER waiting for another tab. Expired sessions cannot be revived.
  perform pikas_private.application_session_assert(p_pos);
  update pikas_private.application_sessions set last_active_at=clock_timestamp(),
    idle_seconds=least(idle_seconds,case when p_pos then 900 else 1800 end) where session_id=v_id;
  return pikas_private.application_session_result(v_id);
end $$;

create function public.pikas_session_end(p_expected_session_id uuid default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid := pikas_private.application_session_id(p_expected_session_id);
begin
  update pikas_private.application_sessions set ended_at=coalesce(ended_at,clock_timestamp()) where session_id=v_id and user_id=auth.uid();
end $$;

create function pikas_private.application_session_pre_request()
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_path text := coalesce(current_setting('request.path',true),'');
begin
  -- Service/anonymous flows retain their existing RLS and RPC authority; no customer bypass is added.
  if coalesce(auth.jwt()->>'role','') <> 'authenticated' then return; end if;
  -- Propagated from the per-tab transport binding. Old tabs cannot write under replacement cookies.
  perform pikas_private.application_session_id(nullif(
    coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-pikas-session-id','')::uuid);
  if v_path = any(array[
    '/rpc/pikas_session_start','/rpc/pikas_session_status','/rpc/pikas_session_activity','/rpc/pikas_session_end',
    '/rpc/activation_preview','/rpc/activation_consume','/rpc/activation_password_status','/rpc/activation_claim_password'
  ]) then return; end if;
  perform pikas_private.application_session_assert(v_path = any(array[
    '/rpc/get_pos_access_context','/rpc/list_my_operable_registers','/rpc/get_my_open_register_session',
    '/rpc/get_pos_register_session','/rpc/open_register_session','/rpc/close_my_register_session',
    '/rpc/checkout_purchase','/rpc/get_pos_customer_purchase_context','/rpc/cafeteria_customer_projection',
    '/rpc/get_cafeteria_saleable_catalog','/rpc/exceptionally_close_register_session',
    '/rpc/create_purchase_refund','/rpc/create_purchase_refund_approval','/rpc/get_purchase_refundability',
    '/rpc/revoke_financial_approval','/rpc/claim_purchase_receipt_print_job','/rpc/report_receipt_print_job',
    '/rpc/retry_receipt_print_job','/rpc/request_purchase_receipt_reprint',
    '/rpc/get_staff_credit_pos_projection','/rpc/settle_staff_receivable'
  ]));
end $$;

revoke all on function pikas_private.application_session_id(uuid),
 pikas_private.application_session_assert(boolean),pikas_private.application_session_result(uuid),
 pikas_private.application_session_pre_request(),public.pikas_session_start(),
 public.pikas_session_status(uuid,boolean),public.pikas_session_activity(uuid,boolean),public.pikas_session_end(uuid)
 from public,anon,authenticated,service_role;
grant execute on function pikas_private.application_session_pre_request(),public.pikas_session_start(),
 public.pikas_session_status(uuid,boolean),public.pikas_session_activity(uuid,boolean),public.pikas_session_end(uuid) to authenticated;

-- Refuse to replace an unrelated guard. Database-specific configuration avoids other databases.
do $$
declare v_existing text; v_setting text;
begin
  for v_setting in select unnest(setconfig) from pg_db_role_setting
    where setrole=(select oid from pg_roles where rolname='authenticator')
      and setdatabase in (0,(select oid from pg_database where datname=current_database()))
  loop
    if v_setting like 'pgrst.db_pre_request=%' then
      v_existing := substring(v_setting from length('pgrst.db_pre_request=')+1);
      if v_existing <> '' and v_existing <> 'pikas_private.application_session_pre_request' then
        raise exception 'Unexpected existing PostgREST pre-request guard: %',v_existing;
      end if;
    end if;
  end loop;
  execute format('alter role authenticator in database %I set pgrst.db_pre_request = %L',current_database(),'pikas_private.application_session_pre_request');
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
