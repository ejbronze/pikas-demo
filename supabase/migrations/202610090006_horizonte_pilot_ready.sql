-- Step 4C: deterministic fictional sandbox data. Pristine resets skip data; initialized drift fails closed.
-- Replay validates the audited manifest and never refills wallets or resets sessions/sales.
begin;
do $bootstrap$
declare
  acc constant uuid := '03e71159-69e9-4387-9b3b-65799d49faf0';
  sch constant uuid := 'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488';
  loc constant uuid := 'cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
  caf constant uuid := 'b9496342-5079-46ae-83b8-05c39bcbd7fe';
  maint constant uuid := '82af93c4-730f-468c-9e4c-2c5238f226f1';
  migration_name constant text := '202610090006_horizonte_pilot_ready';
  prefix constant text := '4c000000-0000-4000-8000-';
  tables constant text[] := array['persons','students','student_enrollments','student_campus_placements',
    'cafeteria_customers','student_wallets','wallet_adjustments','wallet_ledger_entries','student_spending_controls',
    'student_dietary_restrictions','cafeteria_registers','cafeteria_register_assignments',
    'cafeteria_product_categories','cafeteria_products','school_cafeteria_shares','school_cafeteria_share_categories'];
  jose uuid; membership uuid; share uuid; r record; t text; rows_value jsonb; manifest jsonb := '{}'::jsonb;
  previous jsonb; count_value integer; fictional_person uuid; student_id uuid; wallet_id uuid; adjustment_id uuid;
  stamp timestamptz := clock_timestamp();
begin
  if not exists(select 1 from public.accounts where id=acc) then
    if not exists(select 1 from public.accounts) and not exists(select 1 from public.persons)
      and not exists(select 1 from pikas_private.platform_memberships) then
      raise notice 'Pristine database: no Horizonte pilot dataset'; return;
    end if;
    raise exception 'pilot_bootstrap_account_missing';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(migration_name,0));
  if not exists(select 1 from public.accounts where id=acc and status='active' and tenant_kind='sandbox')
    or not pikas_private.scope_active(acc,sch,caf)
    or not exists(select 1 from public.cafeterias where id=caf and account_id=acc and school_id=sch and school_location_id=loc) then
    raise exception 'pilot_bootstrap_scope_mismatch';
  end if;
  select count(*) into count_value from pikas_private.sandbox_pov_personas sp
    join public.persons p on p.id=sp.person_id and p.status='active' and p.auth_user_id is null and p.display_name='José Ramírez'
    join public.cafeteria_memberships m on m.id=sp.cafeteria_membership_id and m.person_id=p.id
      and m.account_id=acc and m.school_id=sch and m.cafeteria_id=caf and m.status='active' and m.role_code='pos_cashier'
    where sp.account_id=acc and sp.school_id=sch and sp.cafeteria_id=caf and sp.pov_code='cashier' and sp.status='active';
  if count_value<>1 then raise exception 'pilot_bootstrap_persona_mismatch'; end if;
  select person_id,cafeteria_membership_id into jose,membership from pikas_private.sandbox_pov_personas
    where account_id=acc and school_id=sch and cafeteria_id=caf and pov_code='cashier' and status='active';
  if exists(select 1 from pikas_private.platform_memberships where person_id=jose)
    or not exists(select 1 from public.persons where id=maint and status='active'
      and auth_user_id='ec08ad21-4020-4b0d-b041-ee4a1fe09471') then raise exception 'pilot_bootstrap_identity_mismatch'; end if;
  if not exists(select 1 from public.cafeteria_operation_settings where cafeteria_id=caf and account_id=acc
      and school_id=sch and catalog_currency_code='DOP' and not scheduling_enabled)
    or not exists(select 1 from public.supported_currencies where currency_code='DOP' and status='enabled' and minor_unit_exponent=2)
    or not exists(select 1 from public.cafeteria_purchase_counters where cafeteria_id=caf and account_id=acc and school_id=sch and school_location_id=loc) then
    raise exception 'pilot_bootstrap_configuration_mismatch';
  end if;
  select count(*) into count_value from public.audit_events where action='sandbox_pilot_dataset_bootstrapped'
    and after_metadata->>'migration'=migration_name;
  if count_value>1 then raise exception 'pilot_bootstrap_audit_mismatch'; end if;
  select after_metadata into previous from public.audit_events where action='sandbox_pilot_dataset_bootstrapped'
    and after_metadata->>'migration'=migration_name and account_id=acc and cafeteria_id=caf and target_id=caf
    and outcome='succeeded' and actor_role='database_maintenance' and actor_person_id=maint;

  -- Fingerprint only the reserved dataset rows. Wallet balance/version and update timestamps may
  -- legitimately change after sales; immutable opening credits/ledger evidence remain covered.
  foreach t in array tables loop
    execute format('select coalesce(jsonb_agg((to_jsonb(x)-''updated_at''-%L::text[]) order by x.id),''[]''::jsonb) from public.%I x where id::text like %L',
      case when t='student_wallets' then '{current_balance_minor,balance_version}' else '{}' end,t,prefix||'%') into rows_value;
    manifest:=manifest||jsonb_build_object(t,md5(rows_value::text));
  end loop;
  if count_value=1 then
    if previous is null or previous->'manifest' is distinct from manifest
      or previous->>'jose_person_id' is distinct from jose::text or previous->>'jose_membership_id' is distinct from membership::text
      or not exists(select 1 from public.school_cafeteria_shares where id=(previous->>'share_id')::uuid
        and account_id=acc and school_id=sch and cafeteria_id=caf and status='active')
      or (select count(*) from public.school_cafeteria_share_categories where share_id=(previous->>'share_id')::uuid and enabled
        and category in ('basic_identification','student_code','placement','dietary_restrictions'))<>4 then
      raise exception 'pilot_bootstrap_replay_mismatch';
    end if;
    return; -- Never reset balances, reopen registers, or overwrite operator/admin edits.
  end if;
  foreach t in array tables loop
    execute format('select count(*) from public.%I where id::text like %L',t,prefix||'%') into count_value;
    if count_value<>0 then raise exception 'pilot_bootstrap_reserved_id_collision'; end if;
  end loop;
  -- Do not silently coexist with an unexplained previous catalog/register/student demo set.
  if exists(select 1 from public.students where school_id=sch)
    or exists(select 1 from public.cafeteria_products where cafeteria_id=caf)
    or exists(select 1 from public.cafeteria_product_categories where cafeteria_id=caf)
    or exists(select 1 from public.cafeteria_registers where cafeteria_id=caf) then raise exception 'pilot_bootstrap_existing_data'; end if;
  select id into share from public.school_cafeteria_shares where cafeteria_id=caf and account_id=acc and school_id=sch and status='active';
  if share is null then
    if exists(select 1 from public.school_cafeteria_shares where cafeteria_id=caf) then raise exception 'pilot_bootstrap_share_mismatch'; end if;
    share:=(prefix||lpad('1',12,'0'))::uuid;
    insert into public.school_cafeteria_shares(id,account_id,school_id,cafeteria_id) values(share,acc,sch,caf);
  end if;
  for r in select category,n from (values('basic_identification',2),('student_code',3),('placement',4),('dietary_restrictions',5)) v(category,n) loop
    insert into public.school_cafeteria_share_categories(id,account_id,school_id,cafeteria_id,share_id,category,enabled)
      values((prefix||lpad(r.n::text,12,'0'))::uuid,acc,sch,caf,share,r.category,true)
      on conflict(share_id,category) do update set enabled=true where not school_cafeteria_share_categories.enabled;
  end loop;
  insert into public.cafeteria_registers(id,account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
    values((prefix||lpad('10',12,'0'))::uuid,acc,sch,loc,caf,'HZ-01','Caja demo Horizonte');
  insert into public.cafeteria_register_assignments(id,account_id,school_id,school_location_id,cafeteria_id,cafeteria_membership_id,operator_person_id,register_id)
    values((prefix||lpad('11',12,'0'))::uuid,acc,sch,loc,caf,membership,jose,(prefix||lpad('10',12,'0'))::uuid);
  insert into public.cafeteria_product_categories(id,account_id,school_id,cafeteria_id,name,display_order)
    values((prefix||lpad('20',12,'0'))::uuid,acc,sch,caf,'Bebidas',1),((prefix||lpad('21',12,'0'))::uuid,acc,sch,caf,'Alimentos',2);
  for r in select * from (values
    (30,'Agua natural',2500,20,array['agua'],array[]::text[]),
    (31,'Jugo de naranja',5500,20,array['naranja','agua'],array[]::text[]),
    (32,'Fruta de temporada',4500,21,array['fruta fresca'],array[]::text[]),
    (33,'Sándwich de pollo',9500,21,array['pan','pollo','queso'],array['gluten','milk']),
    (34,'Empanada de vegetales',6500,21,array['harina','vegetales'],array['gluten']),
    (35,'Yogur natural',6000,21,array['leche','cultivos lácticos'],array['milk'])
  ) v(n,name,price,category,ingredients,allergens) loop
    insert into public.cafeteria_products(id,account_id,school_id,cafeteria_id,category_id,name,description,price_minor,ingredients,allergens)
      values((prefix||lpad(r.n::text,12,'0'))::uuid,acc,sch,caf,(prefix||lpad(r.category::text,12,'0'))::uuid,
        r.name,'Producto ficticio del sandbox Horizonte',r.price,r.ingredients,r.allergens);
  end loop;
  for r in select * from (values
    (1,'Luna','Castillo',120000,35000,20000,'active'),(2,'Mateo','Ventura',4000,25000,15000,'active'),
    (3,'Alma','Robles',60000,10000,8000,'active'),(4,'Bruno','Peña',50000,0,0,'frozen')
  ) v(n,first_name,last_name,balance,daily_limit,transaction_limit,wallet_status) loop
    fictional_person:=(prefix||lpad((100+r.n)::text,12,'0'))::uuid;
    student_id:=(prefix||lpad((200+r.n)::text,12,'0'))::uuid;
    wallet_id:=(prefix||lpad((600+r.n)::text,12,'0'))::uuid;
    adjustment_id:=(prefix||lpad((700+r.n)::text,12,'0'))::uuid;
    insert into public.persons(id,display_name,status,auth_user_id) values(fictional_person,r.first_name||' '||r.last_name,'active',null);
    insert into public.students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name)
      values(student_id,acc,sch,fictional_person,'DEMO-HZ-00'||r.n,r.first_name,r.last_name,r.first_name||' '||r.last_name);
    insert into public.student_enrollments(id,account_id,school_id,student_id,starts_on)
      values((prefix||lpad((300+r.n)::text,12,'0'))::uuid,acc,sch,student_id,'2026-08-01');
    insert into public.student_campus_placements(id,account_id,school_id,enrollment_id,school_location_id,grade_label,class_label,starts_on)
      values((prefix||lpad((400+r.n)::text,12,'0'))::uuid,acc,sch,(prefix||lpad((300+r.n)::text,12,'0'))::uuid,loc,'4.º primaria','A','2026-08-01');
    insert into public.cafeteria_customers(id,account_id,school_id,cafeteria_id,student_id)
      values((prefix||lpad((500+r.n)::text,12,'0'))::uuid,acc,sch,caf,student_id);
    insert into public.student_wallets(id,account_id,school_id,student_id,currency_code,current_balance_minor,balance_version,status)
      values(wallet_id,acc,sch,student_id,'DOP',r.balance,1,r.wallet_status);
    insert into public.wallet_adjustments(id,account_id,school_id,wallet_id,currency_code,amount_minor,reason_code,
      explanatory_note,actor_person_id,posted_at,idempotency_key,payload_fingerprint)
      values(adjustment_id,acc,sch,wallet_id,'DOP',r.balance,'administrative_correction',
        'Capital inicial ficticio; bootstrap owner del sandbox; no dinero real.',maint,stamp,migration_name||':'||r.n,
        encode(extensions.digest(convert_to(migration_name||':'||r.n||':'||r.balance,'UTF8'),'sha256'),'hex'));
    insert into public.wallet_ledger_entries(id,account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,balance_after_minor,
      balance_version_after,adjustment_id,occurred_at)
      values((prefix||lpad((800+r.n)::text,12,'0'))::uuid,acc,sch,wallet_id,'DOP','adjustment',r.balance,r.balance,1,adjustment_id,stamp);
    insert into public.student_spending_controls(id,account_id,school_id,student_id,currency_code,daily_limit_enabled,daily_limit_minor,
      per_transaction_limit_enabled,per_transaction_limit_minor,updated_by_person_id)
      values((prefix||lpad((900+r.n)::text,12,'0'))::uuid,acc,sch,student_id,'DOP',r.daily_limit>0,r.daily_limit,r.transaction_limit>0,r.transaction_limit,maint);
  end loop;
  insert into public.student_dietary_restrictions(id,account_id,school_id,student_id,restriction_type,restriction_code,display_label,starts_on)
    values((prefix||lpad('1001',12,'0'))::uuid,acc,sch,(prefix||lpad('203',12,'0'))::uuid,'allergen','milk','Alergia a leche','2026-08-01');
  manifest:='{}'::jsonb;
  foreach t in array tables loop
    execute format('select coalesce(jsonb_agg((to_jsonb(x)-''updated_at''-%L::text[]) order by x.id),''[]''::jsonb) from public.%I x where id::text like %L',
      case when t='student_wallets' then '{current_balance_minor,balance_version}' else '{}' end,t,prefix||'%') into rows_value;
    manifest:=manifest||jsonb_build_object(t,md5(rows_value::text));
  end loop;
  insert into public.audit_events(actor_person_id,actor_role,actor_scope_kind,account_id,school_id,cafeteria_id,
    action,target_type,target_id,outcome,before_metadata,after_metadata)
    values(maint,'database_maintenance','system',acc,sch,caf,'sandbox_pilot_dataset_bootstrapped','cafeterias',caf,'succeeded','{}',
      jsonb_build_object('migration',migration_name,'fictional_only',true,'students',4,'products',6,'registers',1,
        'jose_person_id',jose,'jose_membership_id',membership,'share_id',share,'manifest',manifest));
end
$bootstrap$;

-- Target ID is an identifier, never authority. Supports scoped close/replay without disclosing other
-- cashiers' sessions or relying on client-supplied scope. No writes or printer/reconciliation data.
create or replace function public.get_pos_register_session(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ctx jsonb; rs public.register_sessions%rowtype;
begin
  ctx:=public.get_pos_access_context();
  select * into rs from public.register_sessions where id=p_session_id;
  if ctx is null or not found or rs.operator_person_id is distinct from (ctx->'actor'->>'person_id')::uuid
    or not exists(select 1 from jsonb_array_elements(ctx->'memberships') m
      where (m->>'membership_id')::uuid=rs.operator_membership_id and (m->>'account_id')::uuid=rs.account_id
        and (m->>'school_id')::uuid=rs.school_id and (m->>'cafeteria_id')::uuid=rs.cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  return jsonb_build_object('session_id',rs.id,'register_id',rs.register_id,'cafeteria_id',rs.cafeteria_id,
    'status',rs.status,'version',rs.version,'currency_code',rs.currency_code,'opening_cash_minor',rs.opening_cash_minor::text,
    'counted_cash_minor',rs.counted_cash_minor::text);
end $$;
revoke all on function public.get_pos_register_session(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_pos_register_session(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.open_register_session(p_register_id uuid, p_assignment_id uuid, p_opening_cash_minor bigint, p_open_request_key text)
 RETURNS TABLE(session_id uuid, status text, opened_at timestamp with time zone, currency_code text, version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; a uuid; s uuid; l uuid; c uuid; zone text; scope_row record;
  register_row public.cafeteria_registers%rowtype; assignment_row public.cafeteria_register_assignments%rowtype;
  membership_id uuid; role_value text; currency text; existing public.register_sessions%rowtype;
  fingerprint text; now_value timestamptz; new_id uuid;
  delegation record; current_delegation record;
begin
  -- Preserve the original delegation across every lock wait, including same-person replacement.
  select * into delegation from pikas_private.sandbox_pov_context();
  actor:=coalesce(delegation.persona_person_id,pikas_private.current_person_id());
  if actor is null then raise exception using errcode='42501',message='not_authorized'; end if;
  if p_opening_cash_minor is null or p_opening_cash_minor<0 then raise exception using errcode='22023',message='invalid_opening_cash'; end if;
  if p_open_request_key is null or length(p_open_request_key) not between 16 and 128 then
    raise exception using errcode='22023',message='invalid_open_request_key';
  end if;
  select r.account_id,r.school_id,r.school_location_id,r.cafeteria_id into a,s,l,c
    from public.cafeteria_registers r where r.id=p_register_id;
  if not found then raise exception using errcode='23503',message='register_not_found'; end if;
  select * into scope_row from pikas_private.lock_active_cafeteria_scope(c);
  if not found or scope_row.account_id<>a or scope_row.school_id<>s or scope_row.school_location_id<>l then
    raise exception using errcode='42501',message='inactive_cafeteria_scope';
  end if;
  zone:=scope_row.business_timezone;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20261005));
  select r.* into register_row from public.cafeteria_registers r
    where r.id=p_register_id and r.account_id=a and r.school_id=s and r.school_location_id=l
      and r.cafeteria_id=c for update;
  if not found or register_row.status<>'active' then raise exception using errcode='23514',message='active_register_required'; end if;
  select ra.* into assignment_row from public.cafeteria_register_assignments ra
    where ra.id=p_assignment_id and ra.account_id=a and ra.school_id=s and ra.school_location_id=l
      and ra.cafeteria_id=c and ra.register_id=p_register_id and ra.operator_person_id=actor
      and ra.status='active' for update;
  if not found then raise exception using errcode='42501',message='active_exact_register_assignment_required'; end if;
  select m.id,m.role_code into membership_id,role_value from public.cafeteria_memberships m
    where m.id=assignment_row.cafeteria_membership_id and m.account_id=a and m.school_id=s
      and m.cafeteria_id=c and m.person_id=actor and m.status='active'
      for share;
  if not found or not pikas_private.pos_is_operator_membership(membership_id,actor,a,s,c,'cafeteria:pos:session:open') then
    raise exception using errcode='42501',message='active_pos_session_open_capability_required';
  end if;
  if delegation.pov_session_id is not null then
    perform 1 from pikas_private.sandbox_pov_sessions pv
      join pikas_private.sandbox_pov_personas pr on pr.id=pv.persona_id
      join public.cafeteria_memberships m on m.id=pv.persona_membership_id
      where pv.id=delegation.pov_session_id for share of pv,pr,m;
    select * into current_delegation from pikas_private.sandbox_pov_context();
    if not found or current_delegation.pov_session_id is distinct from delegation.pov_session_id
      or current_delegation.persona_person_id is distinct from actor
      or current_delegation.persona_membership_id is distinct from delegation.persona_membership_id
      or current_delegation.persona_membership_id is distinct from membership_id
      or current_delegation.account_id is distinct from delegation.account_id
      or current_delegation.school_id is distinct from delegation.school_id
      or current_delegation.cafeteria_id is distinct from delegation.cafeteria_id
      or current_delegation.account_id is distinct from a
      or current_delegation.school_id is distinct from s
      or current_delegation.cafeteria_id is distinct from c
      or pikas_private.pos_actor_person_id() is distinct from actor then
      raise exception using errcode='42501',message='active_pos_session_open_capability_required';
    end if;
  elsif pikas_private.pos_actor_person_id() is distinct from actor then
    raise exception using errcode='42501',message='active_pos_session_open_capability_required';
  end if;
  select os.catalog_currency_code into currency from public.cafeteria_operation_settings os
    join public.supported_currencies cu on cu.currency_code=os.catalog_currency_code and cu.status='enabled'
    where os.account_id=a and os.school_id=s and os.cafeteria_id=c;
  if currency is null then raise exception using errcode='23514',message='enabled_cafeteria_currency_required'; end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('operator_person_id',actor,
    'operator_membership_id',membership_id,'assignment_id',assignment_row.id,'cafeteria_id',c,
    'register_id',p_register_id,'currency_code',currency,'opening_cash_minor',p_opening_cash_minor)::text,'UTF8'),'sha256'),'hex');
  select rs.* into existing from public.register_sessions rs
    where rs.account_id=a and rs.open_request_key=p_open_request_key for update;
  if found then
    if existing.operator_person_id<>actor or existing.open_payload_fingerprint<>fingerprint then
      raise exception using errcode='23505',message='open_request_key_reused_with_different_payload';
    end if;
    return query select existing.id,existing.status,existing.opened_at,existing.currency_code,existing.version; return;
  end if;
  if exists(select 1 from public.register_sessions rs where rs.register_id=p_register_id and rs.status='open') then
    raise exception using errcode='23505',message='register_already_has_open_session';
  end if;
  if exists(select 1 from public.register_sessions rs where rs.operator_person_id=actor and rs.status='open') then
    raise exception using errcode='23505',message='operator_already_has_open_session';
  end if;
  now_value:=clock_timestamp();
  -- The request-key lookup above can also wait. Recheck immediately before the write.
  if delegation.pov_session_id is not null then
    if current_delegation.expires_at<=now_value or not exists(
      select 1 from pikas_private.sandbox_pov_context() x where x.pov_session_id=delegation.pov_session_id
        and x.persona_person_id=actor and x.persona_membership_id=membership_id
        and x.account_id=a and x.school_id=s and x.cafeteria_id=c)
      or pikas_private.pos_actor_person_id() is distinct from actor then
      raise exception using errcode='42501',message='active_pos_session_open_capability_required';
    end if;
  elsif pikas_private.pos_actor_person_id() is distinct from actor then
    raise exception using errcode='42501',message='active_pos_session_open_capability_required';
  end if;
  insert into public.register_sessions(account_id,school_id,school_location_id,cafeteria_id,register_id,
    assignment_id,operator_membership_id,operator_person_id,operator_role_code,register_code_snapshot,
    register_name_snapshot,opened_at,opened_business_date,business_timezone_snapshot,currency_code,
    opening_cash_minor,status,open_request_key,open_payload_fingerprint)
  values(a,s,l,c,p_register_id,assignment_row.id,membership_id,actor,role_value,register_row.register_code,
    register_row.display_name,now_value,(now_value at time zone zone)::date,zone,currency,p_opening_cash_minor,
    'open',p_open_request_key,fingerprint) returning id into new_id;
  perform pikas_private.record_pos_operational_audit(actor,auth.uid(),role_value,a,s,c,
    'register_session_opened','register_sessions',new_id,'{}'::jsonb,
    jsonb_build_object('register_id',p_register_id,'assignment_id',assignment_row.id,'currency_code',currency,
      'opened_business_date',(now_value at time zone zone)::date));
  return query select new_id,'open'::text,now_value,currency,1;
exception when unique_violation then
  raise exception using errcode='23505',message='register_or_operator_already_has_open_session';
end $function$;

CREATE OR REPLACE FUNCTION public.close_my_register_session(p_session_id uuid, p_expected_version integer, p_counted_cash_minor bigint, p_close_request_key text)
 RETURNS TABLE(session_id uuid, status text, closed_at timestamp with time zone, counted_cash_minor bigint, close_type text, version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; session_operator uuid; register_id_value uuid; a uuid; s uuid; c uuid;
  existing public.register_sessions%rowtype; fingerprint text; now_value timestamptz;
  delegation record; current_delegation record;
begin
  -- Capture delegated mode and session identity once; disappearance after waiting must never
  -- turn a delegated request into an ordinary owner-close request.
  select * into delegation from pikas_private.sandbox_pov_context();
  actor:=coalesce(delegation.persona_person_id,pikas_private.current_person_id());
  if actor is null then raise exception using errcode='42501',message='not_authorized'; end if;
  if p_counted_cash_minor is null or p_counted_cash_minor<0 then raise exception using errcode='22023',message='invalid_counted_cash'; end if;
  if p_close_request_key is null or length(p_close_request_key) not between 16 and 128 then
    raise exception using errcode='22023',message='invalid_close_request_key';
  end if;
  select rs.operator_person_id,rs.register_id,rs.account_id,rs.school_id,rs.cafeteria_id
    into session_operator,register_id_value,a,s,c from public.register_sessions rs where rs.id=p_session_id;
  if not found or session_operator<>actor then raise exception using errcode='42501',message='session_owner_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(session_operator::text,20261005));
  perform 1 from public.cafeteria_registers r where r.id=register_id_value for update;
  select rs.* into existing from public.register_sessions rs where rs.id=p_session_id for update;
  if not found or existing.operator_person_id<>actor then raise exception using errcode='42501',message='session_owner_required'; end if;
  -- Revalidate after all register/session waits. Hold delegated authority rows through mutation
  -- so a concurrent exit, persona change or membership revocation cannot pass this boundary.
  if delegation.pov_session_id is not null then
    perform 1 from pikas_private.sandbox_pov_sessions pv
      join pikas_private.sandbox_pov_personas pr on pr.id=pv.persona_id
      join public.cafeteria_memberships m on m.id=pv.persona_membership_id
      where pv.id=delegation.pov_session_id for share of pv,pr,m;
    select * into current_delegation from pikas_private.sandbox_pov_context();
    if not found or current_delegation.pov_session_id is distinct from delegation.pov_session_id
      or current_delegation.persona_person_id is distinct from actor
      or current_delegation.persona_membership_id is distinct from existing.operator_membership_id
      or current_delegation.account_id is distinct from existing.account_id
      or current_delegation.school_id is distinct from existing.school_id
      or current_delegation.cafeteria_id is distinct from existing.cafeteria_id
      or pikas_private.pos_actor_person_id() is distinct from actor then
      raise exception using errcode='42501',message='not_authorized';
    end if;
    perform public.get_pos_register_session(p_session_id);
  elsif pikas_private.pos_actor_person_id() is distinct from actor then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_expected_version is null then raise exception using errcode='40001',message='stale_register_session_version'; end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('session_id',p_session_id,
    'operator_person_id',actor,'close_type','normal','counted_cash_minor',p_counted_cash_minor)::text,'UTF8'),'sha256'),'hex');
  if existing.status='closed' then
    if p_expected_version=existing.version-1 and existing.close_request_key=p_close_request_key
        and existing.close_payload_fingerprint=fingerprint then
      return query select existing.id,existing.status,existing.closed_at,existing.counted_cash_minor,existing.close_type,existing.version; return;
    end if;
    raise exception using errcode='23505',message='register_session_already_closed';
  end if;
  if p_expected_version is null or existing.version<>p_expected_version then
    raise exception using errcode='40001',message='stale_register_session_version';
  end if;
  if exists(select 1 from public.register_sessions rs where rs.account_id=a and rs.close_request_key=p_close_request_key) then
    raise exception using errcode='23505',message='close_request_key_already_used';
  end if;
  now_value:=clock_timestamp();
  if delegation.pov_session_id is not null then
    if current_delegation.expires_at<=now_value or not exists(
      select 1 from pikas_private.sandbox_pov_context() x where x.pov_session_id=delegation.pov_session_id
        and x.persona_person_id=actor and x.persona_membership_id=existing.operator_membership_id
        and x.account_id=existing.account_id and x.school_id=existing.school_id and x.cafeteria_id=existing.cafeteria_id)
      or pikas_private.pos_actor_person_id() is distinct from actor then
      raise exception using errcode='42501',message='not_authorized';
    end if;
  end if;
  update public.register_sessions rs set status='closed',closed_at=now_value,closed_by_person_id=actor,
    counted_cash_minor=p_counted_cash_minor,close_type='normal',close_reason_code=null,close_note=null,
    close_request_key=p_close_request_key,close_payload_fingerprint=fingerprint,version=rs.version+1
    where rs.id=p_session_id;
  perform pikas_private.record_pos_operational_audit(actor,auth.uid(),existing.operator_role_code,a,s,c,
    'register_session_closed','register_sessions',p_session_id,
    jsonb_build_object('status','open','register_id',register_id_value),
    jsonb_build_object('status','closed','close_type','normal'));
  return query select p_session_id,'closed'::text,now_value,p_counted_cash_minor,'normal'::text,existing.version+1;
end $function$;

-- Keep register reads/opening on the exact registered POV membership; ordinary behavior is unchanged.
create or replace function pikas_private.pos_is_operator_membership(
  p_membership_id uuid,p_person_id uuid,p_account_id uuid,p_school_id uuid,p_cafeteria_id uuid,p_capability text
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cafeteria_memberships m
    join pikas_private.role_capabilities rc on rc.scope_kind=m.scope_kind and rc.role_code=m.role_code
    where m.id=p_membership_id and m.person_id=p_person_id and m.account_id=p_account_id
      and m.school_id=p_school_id and m.cafeteria_id=p_cafeteria_id and m.status='active'
      and p_person_id=pikas_private.pos_actor_person_id() and rc.capability=p_capability
      and (p_person_id=pikas_private.current_person_id() or exists(
        select 1 from pikas_private.sandbox_pov_context() x where x.persona_membership_id=p_membership_id
          and x.persona_person_id=p_person_id and x.account_id=p_account_id and x.school_id=p_school_id and x.cafeteria_id=p_cafeteria_id)))
$$;

CREATE OR REPLACE FUNCTION public.get_my_open_register_session()
 RETURNS TABLE(session_id uuid, cafeteria_id uuid, register_id uuid, assignment_id uuid, register_code_snapshot text, register_name_snapshot text, opened_at timestamp with time zone, opened_business_date date, business_timezone_snapshot text, currency_code text, opening_cash_minor bigint, status text, version integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
  actor:=pikas_private.pos_actor_person_id();
  if actor is null then raise exception using errcode='42501',message='not_authorized'; end if;
  return query select rs.id,rs.cafeteria_id,rs.register_id,rs.assignment_id,rs.register_code_snapshot,
    rs.register_name_snapshot,rs.opened_at,rs.opened_business_date,rs.business_timezone_snapshot,
    rs.currency_code,rs.opening_cash_minor,rs.status,rs.version
  from public.register_sessions rs where rs.operator_person_id=actor and rs.status='open'
    and (actor=pikas_private.current_person_id() or exists(
      select 1 from pikas_private.sandbox_pov_context() x where x.persona_membership_id=rs.operator_membership_id
        and x.persona_person_id=rs.operator_person_id and x.account_id=rs.account_id
        and x.school_id=rs.school_id and x.cafeteria_id=rs.cafeteria_id));
end $function$;

commit;
