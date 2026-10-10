-- 4D.1: platform-only customer discovery and first-admin completion.
-- No role/capability changes, tenant-kind changes, Auth creation or operational data.
begin;
create function public.platform_list_customers(p_query text default '',p_status text default null,
 p_kind text default null,p_after uuid default null,p_limit integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform pikas_private.require_platform_capability('platform:tenant:lifecycle:read');
 if p_query is null or length(p_query)>80 or p_limit is null or p_limit not between 1 and 100
   or (p_status is not null and p_status not in ('active','suspended','inactive'))
   or (p_kind is not null and p_kind not in ('customer','sandbox')) then
   raise exception using errcode='22023',message='invalid_customer_filter';
 end if;
 with selected as (
   select a.* from public.accounts a where (p_after is null or a.id>p_after)
    and (p_status is null or a.status=p_status) and (p_kind is null or a.tenant_kind=p_kind)
    and position(lower(btrim(p_query)) in lower(a.name||' '||a.code))>0 order by a.id limit p_limit+1
 ), page as (select * from selected order by id limit p_limit)
 select jsonb_build_object('customers',coalesce((select jsonb_agg(jsonb_build_object(
   'id',a.id,'name',a.name,'code',a.code,'status',a.status,'tenant_kind',a.tenant_kind,
   'school_count',(select count(*) from public.schools s where s.account_id=a.id),
   'location_count',(select count(*) from public.school_locations l where l.account_id=a.id),
   'cafeteria_count',(select count(*) from public.cafeterias c where c.account_id=a.id)) order by a.id) from page a),'[]'::jsonb),
   'next_cursor',case when (select count(*) from selected)>p_limit then (select id from page order by id desc limit 1) else null end)
 into result;
 return result;
end $$;

create function public.platform_get_customer_overview(p_account_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 -- Reuse the existing hierarchy projection and capability gate.
 result:=public.platform_get_tenant_lifecycle(p_account_id);
 return result||jsonb_build_object(
  'tenant_kind',(select tenant_kind from public.accounts where id=p_account_id),
  'administrators',coalesce((select jsonb_agg(jsonb_build_object('display_name',p.display_name,'status',m.status,'person_status',p.status) order by m.id) from public.account_memberships m join public.persons p on p.id=m.person_id where m.account_id=p_account_id and m.role_code='account_admin'),'[]'::jsonb),
  'administrator_intents',case when pikas_private.platform_has_capability('platform:customer_admin:provision') then
   coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.intended_email_key,
     'status',case when i.status in ('pending','linked') and i.expires_at<=statement_timestamp() then 'expired' else i.status end,
     'expires_at',i.expires_at,'role_code',i.role_code,'scope_kind',i.scope_kind,
     'display_name',p.display_name) order by i.created_at desc,i.id)
    from pikas_private.platform_customer_admin_intents i left join public.persons p on p.id=i.linked_person_id
    where i.account_id=p_account_id),'[]'::jsonb) else '[]'::jsonb end);
end $$;

create function public.platform_complete_initial_customer_admin(p_request_id uuid,p_intent_id uuid,p_display_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; fingerprint text; replay jsonb; intent pikas_private.platform_customer_admin_intents%rowtype;
 target_auth uuid; matching_identities integer; result jsonb; payload jsonb;
begin
 actor:=pikas_private.require_platform_capability('platform:customer_admin:provision');
 perform pikas_private.require_platform_capability('platform:identity:link');
 if p_intent_id is null or nullif(btrim(p_display_name),'') is null or length(btrim(p_display_name))>200 then
   raise exception using errcode='22023',message='invalid_initial_admin_input';
 end if;
 payload:=jsonb_build_object('intent_id',p_intent_id,'display_name',btrim(p_display_name));
 fingerprint:=pikas_private.platform_request_fingerprint(payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'initial_customer_admin_complete',fingerprint,actor);
 if replay is not null then return replay; end if;
 select * into intent from pikas_private.platform_customer_admin_intents where id=p_intent_id for update;
 if not found or intent.status not in ('pending','linked') or intent.expires_at<=clock_timestamp()
   or intent.scope_kind<>'account' or intent.role_code<>'account_admin' then
   raise exception using errcode='23514',message='initial_customer_admin_intent_required';
 end if;
 perform 1 from public.accounts where id=intent.account_id and tenant_kind='customer' and status='active' for update;
 if not found then raise exception using errcode='42501',message='active_customer_required'; end if;
 if exists(select 1 from public.account_memberships where account_id=intent.account_id and role_code='account_admin') then
   raise exception using errcode='23505',message='initial_admin_already_exists';
 end if;
 -- Reject ambiguous email matches rather than selecting an arbitrary Auth identity.
 select count(*) into matching_identities from auth.users u where lower(btrim(u.email))=intent.intended_email_key;
 if matching_identities<>1 then raise exception using errcode='23514',message='confirmed_identity_pending'; end if;
 -- The browser never supplies an Auth UUID. Resolve only the intended, confirmed identity.
 begin
 select u.id into strict target_auth from auth.users u where lower(btrim(u.email))=intent.intended_email_key
   and u.confirmed_at is not null
   -- The local Auth fixture is intentionally minimal. When GoTrue fields exist,
   -- require email confirmation (phone confirmation is insufficient) and eligibility.
   and (not (to_jsonb(u) ? 'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
   and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
   and to_jsonb(u)->>'deleted_at' is null
   and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false for share;
 exception when no_data_found or too_many_rows then
   raise exception using errcode='23514',message='confirmed_identity_pending';
 end;
 -- Lock an existing Person before checking eligibility or invoking link/grant.
 perform 1 from public.persons where auth_user_id=target_auth for update;
 if pikas_private.require_platform_capability('platform:customer_admin:provision') is distinct from actor
   or pikas_private.require_platform_capability('platform:identity:link') is distinct from actor then
   raise exception using errcode='42501',message='platform_actor_changed';
 end if;
 if intent.expires_at<=clock_timestamp() then
   raise exception using errcode='23514',message='initial_customer_admin_intent_required';
 end if;
 if target_auth=auth.uid() or exists(select 1 from public.persons p join pikas_private.platform_memberships m on m.person_id=p.id
   where p.auth_user_id=target_auth) then
   raise exception using errcode='42501',message='customer_identity_required';
 end if;
 if intent.status='pending' then
   perform public.platform_link_customer_admin_identity(gen_random_uuid(),p_intent_id,target_auth,btrim(p_display_name));
 elsif intent.linked_auth_user_id is distinct from target_auth then
   raise exception using errcode='42501',message='confirmed_identity_mismatch';
 end if;
 if intent.expires_at<=clock_timestamp() then
   raise exception using errcode='23514',message='initial_customer_admin_intent_required';
 end if;
 result:=public.platform_grant_customer_admin(gen_random_uuid(),p_intent_id);
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
 values(p_request_id,'initial_customer_admin_complete',fingerprint,auth.uid(),actor,result);
 -- Existing link/grant RPCs emit real-operator audit events; no parallel audit system.
 return result;
end $$;

revoke all on function public.platform_list_customers(text,text,text,uuid,integer),
 public.platform_get_customer_overview(uuid),public.platform_complete_initial_customer_admin(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.platform_list_customers(text,text,text,uuid,integer),
 public.platform_get_customer_overview(uuid),public.platform_complete_initial_customer_admin(uuid,uuid,text) to authenticated;
commit;
