begin;

alter table pikas_private.platform_audit_events
  drop constraint platform_audit_events_reason_code_check;
alter table pikas_private.platform_audit_events
  add constraint platform_audit_events_reason_code_check check (reason_code in (
    'owner_root_bootstrap','tenant_provisioned','school_location_added',
    'customer_admin_intent_prepared','identity_linked','customer_admin_granted'
  ));

create function public.platform_add_school_location(
  p_request_id uuid,
  p_account_id uuid,
  p_school_id uuid,
  p_location_code text,
  p_location_name text,
  p_cafeteria_code text,
  p_cafeteria_name text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid; auth_actor uuid; payload jsonb; fingerprint text; replay jsonb;
  account_status text; school_status text;
  location_id_value uuid; cafeteria_id_value uuid; result jsonb;
  location_code_value text; location_name_value text;
  cafeteria_code_value text; cafeteria_name_value text;
begin
  actor:=pikas_private.require_platform_capability('platform:tenant:provision');
  auth_actor:=auth.uid();
  location_code_value:=nullif(btrim(p_location_code),'');
  location_name_value:=nullif(btrim(p_location_name),'');
  cafeteria_code_value:=nullif(btrim(p_cafeteria_code),'');
  cafeteria_name_value:=nullif(btrim(p_cafeteria_name),'');
  if p_account_id is null or p_school_id is null
    or location_code_value is null or length(location_code_value)>64
    or location_name_value is null or length(location_name_value)>200
    or cafeteria_code_value is null or length(cafeteria_code_value)>64
    or cafeteria_name_value is null or length(cafeteria_name_value)>200 then
    raise exception using errcode='22023',message='invalid_school_location_input';
  end if;

  payload:=jsonb_build_object(
    'account_id',p_account_id,'school_id',p_school_id,
    'location_code',location_code_value,'location_name',location_name_value,
    'cafeteria_code',cafeteria_code_value,'cafeteria_name',cafeteria_name_value
  );
  fingerprint:=pikas_private.platform_request_fingerprint(payload);
  replay:=pikas_private.platform_replay_request(
    p_request_id,'school_location_add',fingerprint,actor
  );
  if replay is not null then return replay; end if;

  select a.status into account_status
  from public.accounts a where a.id=p_account_id for update;
  if not found or account_status<>'active' then
    raise exception using errcode='23503',message='active_account_school_required';
  end if;
  select s.status into school_status
  from public.schools s
  where s.id=p_school_id and s.account_id=p_account_id
  for update;
  if not found or school_status<>'active' then
    raise exception using errcode='23503',message='active_account_school_required';
  end if;

  begin
    insert into public.school_locations(account_id,school_id,code,name)
      values(p_account_id,p_school_id,location_code_value,location_name_value)
      returning id into location_id_value;
    insert into public.cafeterias(
      account_id,school_id,school_location_id,code,name
    ) values (
      p_account_id,p_school_id,location_id_value,cafeteria_code_value,cafeteria_name_value
    ) returning id into cafeteria_id_value;
  exception when unique_violation then
    raise exception using errcode='23505',message='platform_tenant_code_conflict';
  end;

  result:=jsonb_build_object(
    'account_id',p_account_id,'school_id',p_school_id,
    'location_id',location_id_value,'cafeteria_id',cafeteria_id_value
  );
  insert into pikas_private.platform_requests(
    request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response
  ) values(p_request_id,'school_location_add',fingerprint,auth_actor,actor,result);
  perform pikas_private.record_platform_audit(
    p_request_id,actor,auth_actor,'platform:tenant:provision','school_location_added',
    'school_location_added',p_account_id,p_school_id,location_id_value,cafeteria_id_value,
    null,null,payload
  );
  return result;
end $$;

revoke all on function public.platform_add_school_location(uuid,uuid,uuid,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.platform_add_school_location(uuid,uuid,uuid,text,text,text,text)
  to authenticated;

commit;
