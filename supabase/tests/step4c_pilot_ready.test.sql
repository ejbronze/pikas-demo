begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.run_bootstrap() returns void language plpgsql as $bootstrap$
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
create function pg_temp.snapshot() returns jsonb language plpgsql as $$
declare r record; rows_value jsonb; result jsonb:='{}';
begin
  for r in select schemaname,tablename from pg_tables where schemaname in ('public','pikas_private') order by 1,2 loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]'') from %I.%I t',r.schemaname,r.tablename) into rows_value;
    result:=result||jsonb_build_object(r.schemaname||'.'||r.tablename,rows_value);
  end loop;
  return result;
end $$;
create function pg_temp.attempt(setup text) returns text language plpgsql as $$
declare result text;
begin
  begin
    execute setup;
    perform pg_temp.run_bootstrap();
    result:='success';
    raise exception 'test_rollback';
  exception when others then if sqlerrm<>'test_rollback' then result:=sqlerrm; end if; end;
  return result;
end $$;
select is(pg_temp.attempt(''), 'pilot_bootstrap_account_missing','Initialized DB without expected Horizonte fails closed');
select is(pg_temp.attempt('set local session_replication_role=replica; truncate public.accounts,public.persons,pikas_private.platform_memberships cascade; set local session_replication_role=origin'),
  'success','Pristine pre-seed database safely skips data');
-- Synthetic fixture identities only; the migration never inserts any Auth identity.
insert into auth.users(id,aud,role,email) values('ec08ad21-4020-4b0d-b041-ee4a1fe09471','authenticated','authenticated','step4c-operator@example.invalid');
insert into public.persons(id,auth_user_id,display_name) values('82af93c4-730f-468c-9e4c-2c5238f226f1','ec08ad21-4020-4b0d-b041-ee4a1fe09471','Edwin');
insert into pikas_private.platform_memberships(person_id,role_code,status) values('82af93c4-730f-468c-9e4c-2c5238f226f1','platform_sandbox_operator','active');
insert into public.accounts(id,code,name,tenant_kind) values('03e71159-69e9-4387-9b3b-65799d49faf0','HZ-4C','Colegio Horizonte','sandbox');
insert into public.schools(id,account_id,code,name) values('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','03e71159-69e9-4387-9b3b-65799d49faf0','HZ','Colegio Horizonte');
insert into public.school_locations(id,account_id,school_id,code,name) values('cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','PRINCIPAL','Campus principal');
insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name) values('b9496342-5079-46ae-83b8-05c39bcbd7fe','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4','CAF','Cafetería Escolar');
insert into public.persons(id,display_name) values('6c000000-0000-4000-8000-000000000001','José Ramírez');
insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code)
  values('6c000000-0000-4000-8000-000000000002','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','b9496342-5079-46ae-83b8-05c39bcbd7fe','6c000000-0000-4000-8000-000000000001','pos_cashier');
insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id)
  values('03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','b9496342-5079-46ae-83b8-05c39bcbd7fe','cashier','6c000000-0000-4000-8000-000000000001','6c000000-0000-4000-8000-000000000002');
create temp table before_bootstrap as select pg_temp.snapshot() data,(select count(*) from auth.users) auth_count;
select is(pg_temp.attempt($s$update public.accounts set status='inactive' where id='03e71159-69e9-4387-9b3b-65799d49faf0'$s$),'pilot_bootstrap_scope_mismatch','Inactive sandbox rejected');
select is(pg_temp.attempt($s$update pikas_private.sandbox_pov_personas set status='inactive' where person_id='6c000000-0000-4000-8000-000000000001'$s$),'pilot_bootstrap_persona_mismatch','Inactive registered persona rejected');
select is(pg_temp.attempt($s$insert into auth.users(id,aud,role,email) values('6c000000-0000-4000-8000-000000000040','authenticated','authenticated','step4c-linked-person@example.invalid'); update public.persons set auth_user_id='6c000000-0000-4000-8000-000000000040' where id='6c000000-0000-4000-8000-000000000001'$s$),'pilot_bootstrap_persona_mismatch','Auth-linked Jose cannot be provisioned');
select is(pg_temp.attempt($s$update public.cafeteria_operation_settings set scheduling_enabled=true where cafeteria_id='b9496342-5079-46ae-83b8-05c39bcbd7fe'$s$),'pilot_bootstrap_configuration_mismatch','Unexpected scheduling configuration rejected');
select is(pg_temp.attempt($s$insert into public.persons(id,display_name) values('4c000000-0000-4000-8000-000000000101','Collision')$s$),'pilot_bootstrap_reserved_id_collision','Reserved IDs cannot overwrite unrelated rows');
select is(pg_temp.attempt($s$insert into public.cafeteria_registers(account_id,school_id,school_location_id,cafeteria_id,register_code,display_name) values('03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4','b9496342-5079-46ae-83b8-05c39bcbd7fe','EXISTING','Existing')$s$),'pilot_bootstrap_existing_data','Unexplained prior register data rejected');
select is(pg_temp.snapshot(),(select data from before_bootstrap),'Rejected bootstrap cases leave all rows unchanged');
select lives_ok('select pg_temp.run_bootstrap()','Expected sandbox receives deterministic dataset');
set constraints all immediate;
set constraints all deferred;
select is((select count(*) from public.students where school_id='df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488'),4::bigint,'Four fictional students');
select is((select count(*) from public.persons where id::text like '4c000000%' and auth_user_id is null),4::bigint,'All fictional people Auth-less');
select is((select count(*) from auth.users),(select auth_count from before_bootstrap),'No Auth identities added');
select is((select count(*) from public.cafeteria_products where cafeteria_id='b9496342-5079-46ae-83b8-05c39bcbd7fe'),6::bigint,'Six real-priced sandbox products');
select is((select count(*) from public.cafeteria_register_assignments where operator_person_id='6c000000-0000-4000-8000-000000000001' and cafeteria_membership_id='6c000000-0000-4000-8000-000000000002'),1::bigint,'Exact existing Jose membership assigned');
select is((select count(*) from public.wallet_adjustments where id::text like '4c000000%'),4::bigint,'Opening balances have four immutable credit sources');
select is((select count(*) from public.wallet_ledger_entries where id::text like '4c000000%'),4::bigint,'Every credit has ledger evidence');
select is((select count(*) from public.student_wallets where id::text like '4c000000%' and current_balance_minor>0 and balance_version=1),4::bigint,'Initial balances and versions correct');
select is((select count(*) from public.student_wallets where id::text like '4c000000%' and status='frozen'),1::bigint,'Frozen-wallet scenario');
select is((select count(*) from public.student_dietary_restrictions where student_id='4c000000-0000-4000-8000-000000000203'),1::bigint,'Alma has authoritative restriction');
select is((select count(*) from public.audit_events where action='sandbox_pilot_dataset_bootstrapped'),1::bigint,'One explicit owner-maintenance audit');
select is((select count(*) from public.register_sessions),jsonb_array_length((select data->'public.register_sessions' from before_bootstrap))::bigint,'Bootstrap never opens a register');
select is((select count(*) from public.purchases),jsonb_array_length((select data->'public.purchases' from before_bootstrap))::bigint,'Bootstrap creates no purchases');
select is((select count(*) from pikas_private.sandbox_pov_sessions),0::bigint,'Bootstrap creates no POV');
select is((select jsonb_agg(to_jsonb(m) order by to_jsonb(m)::text) from pikas_private.platform_memberships m),(select data->'pikas_private.platform_memberships' from before_bootstrap),'Platform authority unchanged');
create temp table after_bootstrap as select pg_temp.snapshot() data;
select lives_ok('select pg_temp.run_bootstrap()','Replay succeeds');
select is(pg_temp.snapshot(),(select data from after_bootstrap),'Replay changes no row and adds no credit/audit');
select is(pg_temp.attempt($s$update public.cafeteria_products set price_minor=1 where id='4c000000-0000-4000-8000-000000000030'$s$),'pilot_bootstrap_replay_mismatch','Replay fails closed after dataset drift');
select ok(has_function_privilege('authenticated','public.get_pos_register_session(uuid)','execute'),'Authenticated session inspection granted');
select ok(not has_function_privilege('anon','public.get_pos_register_session(uuid)','execute') and not has_function_privilege('service_role','public.get_pos_register_session(uuid)','execute'),'Anon/service role denied');
select throws_ok($s$select public.get_pos_register_session('4c000000-0000-4000-8000-000000000010')$s$,'42501','not_authorized','No actor cannot inspect a session');
-- An extra membership held by the same Auth-less Person is not POV authority.
insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code)
 values('6c000000-0000-4000-8000-000000000030','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','b9496342-5079-46ae-83b8-05c39bcbd7fe','6c000000-0000-4000-8000-000000000001','pos_supervisor');
insert into public.cafeteria_registers(id,account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
 values('6c000000-0000-4000-8000-000000000031','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4','b9496342-5079-46ae-83b8-05c39bcbd7fe','TEST-OTHER','Unregistered membership');
insert into public.cafeteria_register_assignments(id,account_id,school_id,school_location_id,cafeteria_id,register_id,cafeteria_membership_id,operator_person_id)
 values('6c000000-0000-4000-8000-000000000032','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4','b9496342-5079-46ae-83b8-05c39bcbd7fe','6c000000-0000-4000-8000-000000000031','6c000000-0000-4000-8000-000000000030','6c000000-0000-4000-8000-000000000001');
-- Real RPC journey in a rolled-back test transaction, Auth remains Edwin and actor is Jose.
select set_config('request.jwt.claim.sub','ec08ad21-4020-4b0d-b041-ee4a1fe09471',true);
set local role authenticated;
select is(public.get_pos_access_context(),null::jsonb,'Edwin without POV has no tenant POS access');
select lives_ok($s$select public.platform_enter_sandbox_pov('6c000000-0000-4000-8000-000000000010','03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe','cashier')$s$,'Backoffice enters registered cashier POV');
select is(public.get_pos_access_context()->'actor'->>'person_id','6c000000-0000-4000-8000-000000000001','POS resolves Jose while Edwin remains authenticated');
select is((select count(*) from public.list_my_operable_registers()),1::bigint,'One operable assigned register');
select throws_ok($s$select * from public.open_register_session('6c000000-0000-4000-8000-000000000031','6c000000-0000-4000-8000-000000000032',0,'step4c-foreign-open-001')$s$,'42501','active_pos_session_open_capability_required','POV cannot open through another membership of same Person');

create temp table opened as select * from public.open_register_session('4c000000-0000-4000-8000-000000000010','4c000000-0000-4000-8000-000000000011',10000,'step4c-open-request-0001');
select is((select count(*) from public.get_my_open_register_session()),1::bigint,'Open session recoverable');
select is((select session_id from public.open_register_session('4c000000-0000-4000-8000-000000000010','4c000000-0000-4000-8000-000000000011',10000,'step4c-open-request-0001')),(select session_id from opened),'Open replay returns same session');
select is(jsonb_array_length(public.get_cafeteria_saleable_catalog('b9496342-5079-46ae-83b8-05c39bcbd7fe')->'products'),6,'Catalog ready without scheduling writes');
select is((select count(*) from public.cafeteria_customer_projection('b9496342-5079-46ae-83b8-05c39bcbd7fe','DEMO-HZ')),4::bigint,'All four students discoverable');
select is(public.get_pos_customer_purchase_context('b9496342-5079-46ae-83b8-05c39bcbd7fe','4c000000-0000-4000-8000-000000000501')->'wallet'->>'balance_minor','120000','Authoritative initial wallet');
create temp table wallet_sale as select public.checkout_purchase(jsonb_build_object('request_key','step4c-wallet-sale-001','register_session_id',(select session_id from opened),'cafeteria_customer_id','4c000000-0000-4000-8000-000000000501','expected_total_minor','5500','items',jsonb_build_array(jsonb_build_object('product_id','4c000000-0000-4000-8000-000000000031','quantity',1,'expected_product_version',1,'expected_unit_price_minor','5500')),'tender',jsonb_build_object('type','student_wallet'))) receipt;
select is((select receipt->>'wallet_balance_after_minor' from wallet_sale),'114500','Wallet checkout debits once');
select is(public.get_pos_customer_purchase_context('b9496342-5079-46ae-83b8-05c39bcbd7fe','4c000000-0000-4000-8000-000000000501')->'wallet'->>'balance_minor','114500','Post-sale context reflects committed balance');
create temp table cash_sale as select public.checkout_purchase(jsonb_build_object('request_key','step4c-cash-sale-0001','register_session_id',(select session_id from opened),'cafeteria_customer_id','4c000000-0000-4000-8000-000000000502','expected_total_minor','9500','items',jsonb_build_array(jsonb_build_object('product_id','4c000000-0000-4000-8000-000000000033','quantity',1,'expected_product_version',1,'expected_unit_price_minor','9500')),'tender',jsonb_build_object('type','cash','cash_received_minor','10000'))) receipt;
select is((select receipt->>'change_due_minor' from cash_sale),'500','Cash checkout returns committed change');
select is(public.get_pos_customer_purchase_context('b9496342-5079-46ae-83b8-05c39bcbd7fe','4c000000-0000-4000-8000-000000000502')->'wallet'->>'balance_minor','4000','Cash does not debit wallet');
select is(public.get_pos_register_session((select session_id from opened))->>'status','open','Narrow session reader resolves own POV scope');
select lives_ok($s$select * from public.close_my_register_session((select session_id from opened),1,19500,'step4c-close-request-001')$s$,'Close with counted cash');
select is(public.get_pos_register_session((select session_id from opened))->>'status','closed','Closed session remains inspectable for safe replay');
select lives_ok($s$select * from public.close_my_register_session((select session_id from opened),1,19500,'step4c-close-request-001')$s$,'Close replay succeeds');
reset role;
-- A historically closed same-Person session in an unregistered membership remains inaccessible.
insert into public.register_sessions
 select (jsonb_populate_record(null::public.register_sessions,to_jsonb(rs)||jsonb_build_object(
   'id','6c000000-0000-4000-8000-000000000033','register_id','6c000000-0000-4000-8000-000000000031',
   'assignment_id','6c000000-0000-4000-8000-000000000032','operator_membership_id','6c000000-0000-4000-8000-000000000030',
   'operator_role_code','pos_supervisor','open_request_key','step4c-other-open-001','close_request_key','step4c-other-close-001'))).*
 from public.register_sessions rs where rs.id=(select session_id from opened);
set local role authenticated;
select throws_ok($s$select public.get_pos_register_session('6c000000-0000-4000-8000-000000000033')$s$,'42501','not_authorized','POV reader denies same Person other membership');
select throws_ok($s$select * from public.close_my_register_session('6c000000-0000-4000-8000-000000000033',1,19500,'step4c-other-close-001')$s$,'42501','not_authorized','Direct close replay cannot bypass exact POV membership');

select is((select count(*) from public.get_my_open_register_session()),0::bigint,'Closed session no longer ready');
select lives_ok($s$select * from public.open_register_session('4c000000-0000-4000-8000-000000000010','4c000000-0000-4000-8000-000000000011',10000,'step4c-open-request-0002')$s$,'Next register lifecycle can begin');
select lives_ok($s$select public.platform_exit_sandbox_pov('6c000000-0000-4000-8000-000000000011')$s$,'Exit uses existing authoritative RPC');
select throws_ok($s$select public.get_pos_register_session((select session_id from opened))$s$,'42501','not_authorized','Exited POV cannot inspect Jose sessions');
reset role;
select ok(not pikas_private.pos_is_operator_membership('6c000000-0000-4000-8000-000000000002','6c000000-0000-4000-8000-000000000001',
 '03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','b9496342-5079-46ae-83b8-05c39bcbd7fe','cafeteria:pos:session:open'),
 'Stale delegated Person cannot fall back to ordinary membership authority after exit');
set local role authenticated;
select is((select count(*) from public.get_my_open_register_session()),0::bigint,'Exited POV cannot recover Jose open session through ordinary fallback');
reset role;
-- Ordinary authenticated tenant cashier resolves their own membership and session normally.
insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code)
 values('6c000000-0000-4000-8000-000000000020','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','b9496342-5079-46ae-83b8-05c39bcbd7fe','82af93c4-730f-468c-9e4c-2c5238f226f1','pos_cashier');
insert into public.cafeteria_registers(id,account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
 values('6c000000-0000-4000-8000-000000000021','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4','b9496342-5079-46ae-83b8-05c39bcbd7fe','TEST-NORMAL','Normal cashier test');
insert into public.cafeteria_register_assignments(id,account_id,school_id,school_location_id,cafeteria_id,register_id,cafeteria_membership_id,operator_person_id)
 values('6c000000-0000-4000-8000-000000000022','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4','b9496342-5079-46ae-83b8-05c39bcbd7fe','6c000000-0000-4000-8000-000000000021','6c000000-0000-4000-8000-000000000020','82af93c4-730f-468c-9e4c-2c5238f226f1');
set local role authenticated;
select is(public.get_pos_access_context()->'actor'->>'person_id','82af93c4-730f-468c-9e4c-2c5238f226f1','Ordinary cashier resolves authenticated Person without POV');
select is(public.get_pos_access_context()->'pov','null'::jsonb,'Ordinary cashier has no synthetic POV');
select throws_ok($s$select public.get_pos_register_session((select session_id from opened))$s$,'42501','not_authorized','Same-tenant ordinary cashier cannot inspect Jose session');
create temp table normal_open as select * from public.open_register_session('6c000000-0000-4000-8000-000000000021','6c000000-0000-4000-8000-000000000022',0,'step4c-normal-open-001');
select is(public.get_pos_register_session((select session_id from normal_open))->>'status','open','Ordinary cashier can inspect their exact own session');
select lives_ok($s$select * from public.close_my_register_session((select session_id from normal_open),1,0,'step4c-normal-close-001')$s$,'Ordinary cashier can close normally');
reset role;
create temp table after_sales as select pg_temp.snapshot() data;
select lives_ok('select pg_temp.run_bootstrap()','Replay after wallet/cash sales and session lifecycle succeeds');
select is(pg_temp.snapshot(),(select data from after_sales),'Replay preserves spent balances, purchases and sessions exactly');
select * from finish();
rollback;
