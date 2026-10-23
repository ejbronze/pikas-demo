-- PIKAS UX 12B closure: a temporary (one-time) password expires 15 minutes after issuance if unused.
--
-- "Used" means the person completed the forced password change (identity_complete_password_change).
-- Until then the credential is temporary: pikas_private.login_identities.must_change_password is true,
-- password_baseline holds the hash issued, temporary_issued_at the issuance time (Phase 6A, 202610260001).
-- The rule is enforced at the database, in the two places a temporary credential can be used:
--   * public.pikas_session_start(): no application session starts for an expired temporary credential
--     (the pre-request guard requires an application session for every other RPC), raising
--     42501 'temporary_access_expired';
--   * public.identity_complete_password_change(): an expired temporary credential cannot be turned
--     into a permanent password, same error.
-- Reads expose the state: identity_credential_state() (the login path) and identity_summary() (the
-- Credenciales/Personal POS reads) gain 'temporary_expired'. A permanent password is never subject to
-- the rule (must_change_password false). Reissuing (identity_begin/finish_temporary_access, unchanged)
-- resets temporary_issued_at and therefore the window. Nothing terminates unrelated sessions: the
-- expired credential simply cannot start one. Every function below is its live definition verbatim
-- plus the stated addition; parameters, return shapes, grants and ownership are unchanged.
-- No capability, grant, role, membership, RLS, table or data change.
begin;

create function pikas_private.temporary_access_expired(p_person uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select li.must_change_password and li.temporary_issued_at is not null and li.password_baseline is not null
   and clock_timestamp() >= li.temporary_issued_at + interval '15 minutes'
  from pikas_private.login_identities li where li.person_id=p_person),false)
$$;
revoke all on function pikas_private.temporary_access_expired(uuid) from public,anon,authenticated,service_role;

create or replace function public.identity_credential_state() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('must_change_password',coalesce(bool_or(li.must_change_password),false),
  'login_suspended',coalesce(bool_or(li.login_suspended_at is not null),false),
  'temporary_expired',coalesce(bool_or(pikas_private.temporary_access_expired(p.id)),false))
 from public.persons p left join pikas_private.login_identities li on li.person_id=p.id where p.auth_user_id=(select auth.uid())
$$;

create or replace function public.pikas_session_start() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid := pikas_private.application_session_id();
begin
  -- The Auth session creation time is authoritative. Repeated starts cannot revive/extend it.
  insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at)
  select id,user_id,created_at,created_at from auth.sessions where id=v_id
  on conflict (session_id) do nothing;
  perform pikas_private.application_session_assert();
  -- UX 12B closure: an unused temporary password older than 15 minutes starts no application session.
  if exists(select 1 from public.persons p where p.auth_user_id=(select auth.uid()) and pikas_private.temporary_access_expired(p.id)) then
    raise exception 'temporary_access_expired' using errcode='42501';
  end if;
  return pikas_private.application_session_result(v_id);
end $$;

create or replace function public.identity_complete_password_change() returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; li pikas_private.login_identities; hash text;
begin
 select p.id into target from public.persons p where p.auth_user_id=(select auth.uid()) and p.status='active';
 if target is null then raise exception using errcode='42501',message='identity_required'; end if;
 select * into li from pikas_private.login_identities where person_id=target for update;
 if li.person_id is null or not li.must_change_password then return jsonb_build_object('must_change_password',false); end if;
 if li.login_suspended_at is not null then raise exception using errcode='42501',message='identity_required'; end if;
 -- UX 12B closure: an expired temporary credential cannot become a permanent password.
 if pikas_private.temporary_access_expired(target) then raise exception using errcode='42501',message='temporary_access_expired'; end if;
 select encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex') into hash from auth.users u where u.id=(select auth.uid());
 if li.password_baseline is null or hash=li.password_baseline then raise exception using errcode='22023',message='password_change_required'; end if;
 update pikas_private.login_identities set must_change_password=false,password_baseline=null,version=version+1,updated_at=now() where person_id=target;
 insert into pikas_private.identity_audit_events(operation,actor_scope,actor_person_id,actor_auth_user_id,target_person_id,target_auth_user_id)
  values('password_change_completed','self',target,(select auth.uid()),target,(select auth.uid()));
 return jsonb_build_object('must_change_password',false);
end $$;

create or replace function pikas_private.identity_summary(p_target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('person_id',p.id,'display_name',p.display_name,'person_status',p.status,
  'username',li.username,'email',u.email,'email_confirmed',u.email_confirmed_at is not null,'last_sign_in_at',u.last_sign_in_at,
  'must_change_password',coalesce(li.must_change_password,false),'login_suspended',li.login_suspended_at is not null,
  'temporary_issued_at',li.temporary_issued_at,'temporary_expired',pikas_private.temporary_access_expired(p.id),'pending_email',li.pending_email,'version',coalesce(li.version,1),
  'memberships',coalesce((select jsonb_agg(x order by x->>'scope',x->>'name') from (
    select jsonb_build_object('scope','account','role',m.role_code,'status',m.status,'name',a.name) x from public.account_memberships m join public.accounts a on a.id=m.account_id where m.person_id=p.id
    union all select jsonb_build_object('scope','school','role',m.role_code,'status',m.status,'name',s.name) from public.school_memberships m join public.schools s on s.id=m.school_id where m.person_id=p.id
    union all select jsonb_build_object('scope','cafeteria','role',m.role_code,'status',m.status,'name',c.name) from public.cafeteria_memberships m join public.cafeterias c on c.id=m.cafeteria_id where m.person_id=p.id) q),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(jsonb_build_object('operation',e.operation,'occurred_at',e.occurred_at,'actor_scope',e.actor_scope,
     'actor_name',ap.display_name,'metadata',e.metadata,'reason',e.reason) order by e.occurred_at desc)
   from (select * from pikas_private.identity_audit_events where target_person_id=p.id order by occurred_at desc limit 20) e join public.persons ap on ap.id=e.actor_person_id),'[]'::jsonb))
 from public.persons p left join pikas_private.login_identities li on li.person_id=p.id left join auth.users u on u.id=p.auth_user_id where p.id=p_target
$$;

commit;
