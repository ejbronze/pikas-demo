begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity),58::bigint,
  'RLS is enabled on every public table through Phase 4C');
select is((select count(*) from pg_policies where schemaname='public' and cmd<>'SELECT'),0::bigint,
  'Phase 4B adds no direct-write RLS policy');
select is((select count(*) from information_schema.columns where table_schema='public'
  and table_name='cafeteria_menu_products' and column_name in ('price_minor','currency_code','available')),0::bigint,
  'Menu assignments do not duplicate price, currency, or availability');
select ok(not has_table_privilege('authenticated','public.cafeteria_menus','INSERT') and
  not has_table_privilege('authenticated','public.cafeteria_menus','UPDATE') and
  not has_table_privilege('authenticated','public.cafeteria_menus','DELETE') and
  not has_table_privilege('authenticated','public.cafeteria_menus','TRUNCATE') and
  not has_table_privilege('authenticated','public.cafeteria_menu_products','TRUNCATE') and
  not has_table_privilege('authenticated','public.cafeteria_service_shifts','TRUNCATE') and
  not has_table_privilege('authenticated','public.cafeteria_service_shift_days','TRUNCATE'),
  'Authenticated direct mutation and TRUNCATE grants are absent');
select ok(not has_function_privilege('authenticated','pikas_private.resolve_cafeteria_service_at(uuid,timestamp with time zone)','EXECUTE') and
  not has_function_privilege('authenticated','pikas_private.saleable_catalog_at(uuid,timestamp with time zone)','EXECUTE') and
  has_function_privilege('authenticated','public.get_cafeteria_saleable_catalog(uuid)','EXECUTE'),
  'Only the current-time saleability endpoint is executable by authenticated callers');
select ok(not has_function_privilege('anon','pikas_private.saleable_catalog_at(uuid,timestamp with time zone)','EXECUTE') and
  not has_function_privilege('service_role','pikas_private.saleable_catalog_at(uuid,timestamp with time zone)','EXECUTE') and
  not has_function_privilege('anon','public.get_cafeteria_saleable_catalog(uuid)','EXECUTE') and
  not has_function_privilege('service_role','public.get_cafeteria_saleable_catalog(uuid)','EXECUTE'),
  'Anon and service roles cannot execute the test clock or catalog projection');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','pikas_private') and p.prosecdef and not ('search_path=""'=any(p.proconfig))),0::bigint,
  'Phase 4B SECURITY DEFINER functions pin an empty search path');
select is((select count(*) from cafeteria_menus),4::bigint,'Synthetic menus are cafeteria-scoped');
select is((select count(*) from cafeteria_menu_products),4::bigint,'Synthetic menu links reuse cafeteria products');
select is((select count(*) from cafeteria_service_shifts),3::bigint,'Synthetic service shifts include disabled overlap configuration');
select is((select count(*) from cafeteria_service_shift_days),7::bigint,'Weekday rows use normalized ISO weekday values');
select is((select count(*) from cafeteria_menus where name_key='desayuno'),3::bigint,
  'The same normalized menu name is allowed in another cafeteria');
select is((select count(*) from cafeteria_operation_settings where not scheduling_enabled),4::bigint,
  'Phase 4B fixtures leave all cafeterias in manual scheduling mode');
insert into public.cafeteria_products(id,account_id,school_id,cafeteria_id,category_id,name,description,price_minor,active,available)
values('00000000-0000-0000-0000-000000008211','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000112',
  '00000000-0000-0000-0000-000000008003','A2 agua','Synthetic Cafeteria A2 product',5000,true,true);
insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name)
values('00000000-0000-0000-0000-000000000115','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000211','CATALOG-SIBLING','Synthetic same-campus sibling cafeteria');
select is((select count(*) from cafeteria_operation_settings where cafeteria_id='00000000-0000-0000-0000-000000000115'),1::bigint,
  'Same-campus sibling fixture receives its exact cafeteria settings');
select throws_ok($$update public.cafeteria_menus set cafeteria_id='00000000-0000-0000-0000-000000000113'
  where id='00000000-0000-0000-0000-000000009001'$$,'23514',null,
  'Menu cafeteria ancestry is immutable even to privileged SQL');
select throws_ok($$update public.cafeteria_menu_products set product_id='00000000-0000-0000-0000-000000008211'
  where cafeteria_id='00000000-0000-0000-0000-000000000111'
    and menu_id='00000000-0000-0000-0000-000000009001'
    and product_id='00000000-0000-0000-0000-000000008101'$$,'23514',null,
  'Menu/product pair identity cannot be reparented even to a real sibling-cafeteria product');
select throws_ok($$update public.cafeteria_service_shifts set cafeteria_id='00000000-0000-0000-0000-000000000113'
  where id='00000000-0000-0000-0000-000000009101'$$,'23514',null,
  'Service-shift cafeteria ancestry is immutable even to privileged SQL');
select throws_ok($$update public.cafeteria_service_shift_days set weekday_iso=6
  where service_shift_id='00000000-0000-0000-0000-000000009101' and weekday_iso=1$$,'23514',null,
  'Weekday row identity cannot be rewritten directly');

select throws_ok($$insert into public.cafeteria_menus(id,account_id,school_id,cafeteria_id,name)
  values('00000000-0000-0000-0000-000000009201','00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','Forged account')$$,
  '23503',null,'Menu ancestry rejects forged account/school/cafeteria relationships');
select throws_ok($$insert into public.cafeteria_menu_products(account_id,school_id,cafeteria_id,menu_id,product_id)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000009001',
  '00000000-0000-0000-0000-000000008211')$$,'23503',null,
  'Composite link constraints reject a Cafeteria A menu assigned to another cafeteria product');
select throws_ok($$insert into public.cafeteria_service_shifts(id,account_id,school_id,cafeteria_id,menu_id,name,start_time,end_time)
  values('00000000-0000-0000-0000-000000009201','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009003','Cross cafeteria menu','07:00','09:00')$$,'23503',null,
  'Composite shift/menu FK rejects a sibling-cafeteria menu');
select throws_ok($$insert into public.cafeteria_service_shift_days(account_id,school_id,cafeteria_id,service_shift_id,weekday_iso)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000009103',6)$$,'23503',null,
  'Composite shift-day FK rejects forged cafeteria ancestry');
select throws_ok($$insert into public.cafeteria_service_shifts(id,account_id,school_id,cafeteria_id,menu_id,name,start_time,end_time)
  values('00000000-0000-0000-0000-000000009201','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009001','Invalid equal window','09:00','09:00')$$,'23514',null,
  'Database check rejects zero-length service window');
select throws_ok($$insert into public.cafeteria_service_shifts(id,account_id,school_id,cafeteria_id,menu_id,name,start_time,end_time)
  values('00000000-0000-0000-0000-000000009201','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009001','Invalid overnight window','22:00','02:00')$$,'23514',null,
  'Database check rejects overnight service windows');
select throws_ok($$insert into public.cafeteria_service_shift_days(account_id,school_id,cafeteria_id,service_shift_id,weekday_iso)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000009101',8)$$,'23514',null,
  'Database check rejects ISO weekday outside 1 through 7');

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select is((select count(*) from cafeteria_menus),2::bigint,'Cafeteria Admin reads menus only for the exact cafeteria');
select is((select count(*) from cafeteria_menus where cafeteria_id='00000000-0000-0000-0000-000000000115'),0::bigint,
  'Cafeteria Admin cannot read a same-campus sibling cafeteria');
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000115')$$,
  '42501',null,'Cafeteria Admin cannot request same-campus sibling saleability');
select is((select count(*) from cafeteria_menu_products),4::bigint,'Cafeteria Admin reads exact-cafeteria menu assignments');
select is((select count(*) from cafeteria_service_shifts),2::bigint,'Cafeteria Admin reads exact-cafeteria service shifts');
select lives_ok($$select public.create_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301','Merienda','Synthetic menu',30)$$,
  'Cafeteria Admin creates a menu');
select lives_ok($$select public.create_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301',' Merienda ',' Synthetic menu ',30)$$,
  'Identical menu creation retry is idempotent');
select throws_ok($$select public.create_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009305','   ','',0)$$,'22023',null,
  'Whitespace-only menu name is rejected');
select lives_ok($$select public.create_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009306',repeat('x',120),'',0)$$,
  'Maximum-length menu name is accepted');
select throws_ok($$select public.create_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009307',repeat('x',121),'',0)$$,'22023',null,
  'Menu name above maximum length is rejected');
select lives_ok($$select public.create_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009308','Piña escolar','',5)$$,
  'Valid Unicode menu name is accepted');
select throws_ok($$select public.create_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009302','MERIENDA','Other',40)$$,'23505',null,
  'Normalized menu-name uniqueness is cafeteria-scoped');
select throws_ok($$select public.create_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301','Changed retry','Synthetic menu',30)$$,'23505',null,
  'Menu UUID retry with changed payload is rejected');
select lives_ok($$select public.update_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301',1,'Merienda escolar','Synthetic menu',30,'active')$$,
  'Menu update renames/reorders while preserving its UUID');
select throws_ok($$select public.update_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301',1,'Stale menu','Synthetic menu',30,'active')$$,
  '40001',null,'Stale menu update is rejected');
select throws_ok($$select public.update_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301',null,'Null menu version','Synthetic menu',30,'active')$$,
  '40001',null,'NULL menu update version is rejected');
select is((select version from cafeteria_menus where id='00000000-0000-0000-0000-000000009301'),2,
  'Failed stale/NULL menu updates leave the version unchanged');
select ok(not exists(select 1 from audit_events where target_id='00000000-0000-0000-0000-000000009301'
  and after_metadata->>'name' in ('Stale menu','Null menu version')),
  'Failed stale/NULL menu updates create no success audit');
select lives_ok($$select public.create_cafeteria_menu_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301','00000000-0000-0000-0000-000000008104',10)$$,
  'Cafeteria Admin assigns an uncategorized product to a menu');
select lives_ok($$select public.create_cafeteria_menu_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301','00000000-0000-0000-0000-000000008104',10)$$,
  'Identical menu/product assignment retry reuses its stable pair');
select lives_ok($$select public.create_cafeteria_menu_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301','00000000-0000-0000-0000-000000008101',5)$$,
  'One product may be assigned to multiple cafeteria menus');
select throws_ok($$select public.create_cafeteria_menu_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301','00000000-0000-0000-0000-000000008104',20)$$,'23505',null,
  'Assignment retry with changed ordering is rejected');
select lives_ok($$select public.create_cafeteria_menu_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301','00000000-0000-0000-0000-000000008103',20)$$,
  'Inactive product may remain configured in a menu');
select throws_ok($$select public.create_cafeteria_menu_product('00000000-0000-0000-0000-000000000112',
  '00000000-0000-0000-0000-000000009003','00000000-0000-0000-0000-000000008101',10)$$,'42501',null,
  'Cafeteria A Admin cannot create assignments in a sibling cafeteria');
select lives_ok($$select public.update_cafeteria_menu_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301','00000000-0000-0000-0000-000000008104',1,10,false)$$,
  'Assignment can be deactivated without deleting its identity');
select throws_ok($$select public.update_cafeteria_menu_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301','00000000-0000-0000-0000-000000008104',1,10,true)$$,
  '40001',null,'Stale assignment update is rejected');
select throws_ok($$select public.update_cafeteria_menu_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301','00000000-0000-0000-0000-000000008104',null,10,true)$$,
  '40001',null,'NULL assignment version is rejected');
select lives_ok($$select public.update_cafeteria_menu_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301','00000000-0000-0000-0000-000000008104',2,10,true)$$,
  'Assignment can be reactivated while retaining stable identity');

select lives_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009311','00000000-0000-0000-0000-000000009001','Breakfast','09:00','10:00',true,array[1,2])$$,
  'Adjacent same-day windows and a multi-day shift are accepted');
select lives_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009311','00000000-0000-0000-0000-000000009001','Breakfast','09:00','10:00',true,array[2,1])$$,
  'Identical shift creation retry reuses the original weekday configuration');
select throws_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009311','00000000-0000-0000-0000-000000009001','Breakfast','09:00','10:00',true,array[1])$$,
  '23505',null,'Shift creation retry with changed weekdays rejects');
select throws_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009311','00000000-0000-0000-0000-000000009001','Changed shift','09:00','10:00',true,array[1,2])$$,
  '23505',null,'Shift creation retry with changed name rejects');
select lives_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009312','00000000-0000-0000-0000-000000009001','Breakfast','08:00','10:00',false,array[1])$$,
  'Disabled overlapping shifts may remain configured');
select throws_ok($$select public.update_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009312',1,'00000000-0000-0000-0000-000000009001','Breakfast','08:00','10:00',true,array[1])$$,
  '23P01',null,'Enabling a disabled overlapping shift is rejected');
select is((select enabled=false and version=1 from cafeteria_service_shifts
  where id='00000000-0000-0000-0000-000000009312'),true,
  'Rejected overlap leaves disabled shift unchanged');
select throws_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009313','00000000-0000-0000-0000-000000009001','Overlap','08:59','10:00',true,array[1])$$,
  '23P01',null,'Overlapping enabled shifts are rejected');
select ok(not exists(select 1 from audit_events where target_type='cafeteria_service_shifts'
  and target_id='00000000-0000-0000-0000-000000009313' and outcome='succeeded'),
  'Rejected overlapping shift creates no success audit');
select lives_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009314','00000000-0000-0000-0000-000000009001','Sunday','08:00','10:00',true,array[7])$$,
  'Same time on a different weekday is allowed');
select lives_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009315','00000000-0000-0000-0000-000000009001','Saturday','08:00','10:00',true,array[6])$$,
  'Same time on a different weekday is allowed');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select lives_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000113',
  '00000000-0000-0000-0000-000000009322','00000000-0000-0000-0000-000000009004','Campus C2','08:00','10:00',true,array[1])$$,
  'Same window in another cafeteria is allowed');
select lives_ok($$select public.update_cafeteria_service_shift('00000000-0000-0000-0000-000000000113',
  '00000000-0000-0000-0000-000000009322',1,'00000000-0000-0000-0000-000000009004',
  'Campus C2 all day','00:00','24:00',true,array[1,2,3,4,5,6,7])$$,
  'Same-day full business-day window is valid and remains school-local');
select lives_ok($$select public.update_cafeteria_catalog_settings('00000000-0000-0000-0000-000000000113',true,1)$$,
  'Scheduling can be enabled independently for the endpoint fixture');
select is((public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000113')->>'status'),
  'active','Public endpoint derives current service using database time');
select is((public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000113')->'service_shift'->>'id'),
  '00000000-0000-0000-0000-000000009322','Public projection returns exact active shift context');
select is(jsonb_array_length(public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000113')->'products'),0,
  'Scheduled projection returns no products when active menu has no assignments');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select throws_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009316','00000000-0000-0000-0000-000000009003','Cross menu','11:00','12:00',false,array[1])$$,
  '23503',null,'Service shift cannot reference another cafeteria menu');
select throws_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009317','00000000-0000-0000-0000-000000009001','Equal','10:00','10:00',false,array[1])$$,
  '22023',null,'RPC rejects equal start and end times');
select throws_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009318','00000000-0000-0000-0000-000000009001','Overnight','22:00','02:00',false,array[1])$$,
  '22023',null,'RPC rejects overnight service windows');
select throws_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009319','00000000-0000-0000-0000-000000009001','Bad weekday','10:00','11:00',false,array[0])$$,
  '22023',null,'RPC rejects invalid ISO weekday');
select throws_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009320','00000000-0000-0000-0000-000000009001','Duplicate weekday','10:00','11:00',false,array[1,1])$$,
  '22023',null,'RPC rejects duplicate weekdays');
select throws_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009321','00000000-0000-0000-0000-000000009001','Empty weekdays','10:00','11:00',false,array[]::integer[])$$,
  '22023',null,'RPC rejects a shift without weekdays');
select throws_ok($$select public.update_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009311',0,'00000000-0000-0000-0000-000000009001','Breakfast','09:00','10:00',true,array[1])$$,
  '40001',null,'Stale shift update is rejected');
select throws_ok($$select public.update_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009311',null,'00000000-0000-0000-0000-000000009001','Breakfast','09:00','10:00',true,array[1])$$,
  '40001',null,'NULL shift update version is rejected');
select throws_ok($$select public.update_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009311',0,'00000000-0000-0000-0000-000000009001','Breakfast','09:00','10:00',true,array[1,2,3])$$,
  '40001',null,'Failed stale shift update leaves state unchanged');
select is((select version from cafeteria_service_shifts where id='00000000-0000-0000-0000-000000009311'),1,
  'Failed stale shift update creates no state increment');
select ok(not exists(select 1 from audit_events where target_type='cafeteria_service_shifts'
  and target_id='00000000-0000-0000-0000-000000009311' and action='update'
  and after_metadata->>'start_time'='08:00:00'),
  'Failed stale shift update creates no success audit');
select lives_ok($$select public.update_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009311',1,'00000000-0000-0000-0000-000000009001','Breakfast','09:00','10:00',true,array[1,2,3])$$,
  'Shift update atomically replaces normalized weekdays');
select is((select count(*) from cafeteria_service_shift_days where service_shift_id='00000000-0000-0000-0000-000000009311'),3::bigint,
  'Shift update stores one row per weekday');
select is((select version from cafeteria_service_shifts where id='00000000-0000-0000-0000-000000009311'),2,
  'Successful shift update increments exactly one version');
select throws_ok($$select public.update_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009311',2,'00000000-0000-0000-0000-000000009001','Breakfast','08:00','10:00',true,array[1,2,3])$$,
  '23P01',null,'Shift update that creates overlap on existing weekdays is rejected');
select is((select version=2 and start_time='09:00'::time from cafeteria_service_shifts
  where id='00000000-0000-0000-0000-000000009311'),true,
  'Rejected overlapping update leaves shift time and version unchanged');

select lives_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008212','No menu product','',null,0,true,true)$$,
  'Active zero-price product can exist without a menu assignment');
select throws_ok($$select public.update_cafeteria_catalog_settings('00000000-0000-0000-0000-000000000111',true,null)$$,
  '40001',null,'NULL settings version cannot bypass optimistic locking');
select lives_ok($$select public.update_cafeteria_catalog_settings('00000000-0000-0000-0000-000000000111',true,1)$$,
  'Scheduling can be enabled outside any configured service window');
select is((select version from cafeteria_operation_settings where cafeteria_id='00000000-0000-0000-0000-000000000111'),2,
  'Scheduling toggle shares and increments the Phase 4A settings version');

reset role;
select is((select status from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 10:59:59+00'::timestamptz)),
  'no_active_service','Monday 06:59:59 local is before service start');
select is((select service_shift_id from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 11:00:00+00'::timestamptz)),
  '00000000-0000-0000-0000-000000009101'::uuid,'Monday 07:00 local is inclusive at shift start');
select is((select service_shift_id from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 12:59:59+00'::timestamptz)),
  '00000000-0000-0000-0000-000000009101'::uuid,'Monday 08:59:59 local remains within breakfast');
select is((select service_shift_id from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 11:00:00.000001+00'::timestamptz)),
  '00000000-0000-0000-0000-000000009101'::uuid,'Microsecond after start remains inside service window');
select is((select service_shift_id from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 12:59:59.999999+00'::timestamptz)),
  '00000000-0000-0000-0000-000000009101'::uuid,'Last representable microsecond before end remains active');
select is((select service_shift_id from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 13:00:00+00'::timestamptz)),
  '00000000-0000-0000-0000-000000009311'::uuid,'Adjacent shift starts inclusively at 09:00 local');
select is((select status from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 14:00:00+00'::timestamptz)),
  'no_active_service','10:00 local is exclusive at the adjacent shift end');
select is((select status from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-04 11:30:00+00'::timestamptz)),
  'no_active_service','A configured weekday does not resolve on Sunday');
select is((select service_shift_id from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 12:15:00+00'::timestamptz)),
  '00000000-0000-0000-0000-000000009101'::uuid,'Disabled overlapping shift is ignored in current-service resolution');
select is((select service_shift_id from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-04 12:30:00+00'::timestamptz)),
  '00000000-0000-0000-0000-000000009314'::uuid,'ISO weekday 7 selects the Sunday shift');
select is((select business_date from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 03:30:00+00'::timestamptz)),
  '2026-10-04'::date,'Business date follows local school date across UTC midnight');
select is((select business_timezone from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 11:00:00+00'::timestamptz)),
  'America/Santo_Domingo','Service resolution derives the school timezone');
select is((pikas_private.saleable_catalog_at('00000000-0000-0000-0000-000000000111',
  '2026-10-05 11:30:00+00'::timestamptz)->>'status'),'active','Test-clock saleability resolves active service');
select is(jsonb_array_length(pikas_private.saleable_catalog_at('00000000-0000-0000-0000-000000000111',
  '2026-10-05 11:30:00+00'::timestamptz)->'products'),1,
  'Scheduled saleability requires current-menu assignment and active/available product state');
select ok((pikas_private.saleable_catalog_at('00000000-0000-0000-0000-000000000111',
  '2026-10-05 11:30:00+00'::timestamptz)->'products') @>
  '[{"product_id":"00000000-0000-0000-0000-000000008101","price_minor":5000,"currency_code":"DOP"}]'::jsonb,
  'Scheduled projection supplies authoritative product ID, price, and currency');
select is(jsonb_array_length(pikas_private.saleable_catalog_at('00000000-0000-0000-0000-000000000111',
  '2026-10-05 10:59:59+00'::timestamptz)->'products'),0,
  'No active service yields an empty scheduled catalog');
update public.schools set business_timezone='America/New_York' where id='00000000-0000-0000-0000-000000000011';
select is((select local_time from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-03-09 11:00:00+00'::timestamptz)),
  '07:00:00'::time,'IANA timezone conversion observes daylight-saving time');
select is((select business_date from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-01-05 12:00:00+00'::timestamptz)),
  '2026-01-05'::date,'IANA timezone conversion observes standard time');
select is((select status from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-03-09 10:59:59+00'::timestamptz)),
  'no_active_service','DST-aware local time preserves the pre-start boundary');
insert into public.cafeteria_service_shifts(id,account_id,school_id,cafeteria_id,menu_id,name,start_time,end_time,enabled)
values('00000000-0000-0000-0000-000000009350','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009002','Skipped DST window','02:00','03:00',true);
insert into public.cafeteria_service_shift_days(account_id,school_id,cafeteria_id,service_shift_id,weekday_iso)
values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000009350',7);
select is((select status from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-03-08 07:00:00+00'::timestamptz)),
  'no_active_service','A spring-forward local-time gap has no matching service instant');
insert into public.cafeteria_service_shifts(id,account_id,school_id,cafeteria_id,menu_id,name,start_time,end_time,enabled)
values('00000000-0000-0000-0000-000000009351','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009002','Repeated DST hour','01:00','02:00',true);
insert into public.cafeteria_service_shift_days(account_id,school_id,cafeteria_id,service_shift_id,weekday_iso)
values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000009351',7);
select is((select service_shift_id from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-11-01 05:30:00+00'::timestamptz)),
  '00000000-0000-0000-0000-000000009351'::uuid,'First fall-back 01:30 local occurrence resolves the shift');
select is((select service_shift_id from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-11-01 06:30:00+00'::timestamptz)),
  '00000000-0000-0000-0000-000000009351'::uuid,'Repeated fall-back 01:30 local occurrence resolves the same shift');
update public.schools set business_timezone='America/Santo_Domingo' where id='00000000-0000-0000-0000-000000000011';
update public.supported_currencies set status='disabled' where currency_code='DOP';
select is((select count(*) from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 11:30:00+00'::timestamptz)),0::bigint,
  'Disabled catalog currency removes operational service context');
select is((pikas_private.saleable_catalog_at('00000000-0000-0000-0000-000000000111',
  '2026-10-05 11:30:00+00'::timestamptz)->>'status'),'invalid_configuration',
  'Disabled currency fails saleability closed');
select is(jsonb_array_length(pikas_private.saleable_catalog_at('00000000-0000-0000-0000-000000000111',
  '2026-10-05 11:30:00+00'::timestamptz)->'products'),0,'Disabled currency exposes no products');
update public.supported_currencies set status='enabled' where currency_code='DOP';
insert into public.cafeteria_service_shifts(id,account_id,school_id,cafeteria_id,menu_id,name,start_time,end_time,enabled)
values('00000000-0000-0000-0000-000000009399','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009001','Corrupt overlap','08:00','08:30',true);
insert into public.cafeteria_service_shift_days(account_id,school_id,cafeteria_id,service_shift_id,weekday_iso)
values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000009399',1);
select is((select status from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 12:15:00+00'::timestamptz)),
  'invalid_configuration','Corrupted multiple active windows fail closed');
select is(jsonb_array_length(pikas_private.saleable_catalog_at('00000000-0000-0000-0000-000000000111',
  '2026-10-05 12:15:00+00'::timestamptz)->'products'),0,
  'Corrupted overlap never chooses an arbitrary saleable menu');
delete from public.cafeteria_service_shift_days where service_shift_id='00000000-0000-0000-0000-000000009399';
delete from public.cafeteria_service_shifts where id='00000000-0000-0000-0000-000000009399';

select lives_ok($$select public.update_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009001',1,'Desayuno','Synthetic breakfast menu',10,'archived')$$,
  'Menu can be archived without cascading shifts or assignments');
select is((select status from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 11:30:00+00'::timestamptz)),
  'no_active_service','Inactive menu is non-operational while shifts remain configured');
select is((select count(*) from cafeteria_service_shifts where menu_id='00000000-0000-0000-0000-000000009001'),5::bigint,
  'Menu archive retains shift references');
select is((select count(*) from cafeteria_menu_products where menu_id='00000000-0000-0000-0000-000000009001'),3::bigint,
  'Menu archive retains product assignments');
select throws_ok($$select public.update_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009102',1,'00000000-0000-0000-0000-000000009001',
  'Disabled breakfast','10:00','11:00',true,array[1])$$,'23503',null,
  'Enabling a shift whose menu is inactive is rejected');
select lives_ok($$select public.update_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009001',2,'Desayuno','Synthetic breakfast menu',10,'active')$$,
  'Reactivating a menu restores potential service without recreating links');
select is((select status from pikas_private.resolve_cafeteria_service_at(
  '00000000-0000-0000-0000-000000000111','2026-10-05 11:30:00+00'::timestamptz)),
  'active','Reactivated menu restores eligible service with preserved configuration');

select lives_ok($$select public.update_cafeteria_catalog_settings('00000000-0000-0000-0000-000000000111',false,2)$$,
  'Scheduling OFF selects manual eligibility and does not mutate shifts');
select is((public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')->>'status'),
  'manual','Public endpoint returns manual catalog mode');
select is((public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')->>'business_timezone'),
  'America/Santo_Domingo','Public projection includes school business timezone');
select is(jsonb_array_length(public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')->'products'),3,
  'Manual saleability includes active/available products and excludes inactive/unavailable products');
select ok((public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')->'products') @>
  '[{"product_id":"00000000-0000-0000-0000-000000008104","price_minor":0,"currency_code":"DOP"},{"product_id":"00000000-0000-0000-0000-000000008212","price_minor":0,"currency_code":"DOP"}]'::jsonb,
  'Manual mode includes unassigned zero-price products without menu dependence');
select ok((public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')->'service_shift')='null'::jsonb
  and (public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')->'menu')='null'::jsonb,
  'Manual mode returns NULL service and menu context');

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002004',true);
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Cafeteria B Admin cannot request Cafeteria A saleability');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select is((select count(*) from cafeteria_menus where cafeteria_id in
  ('00000000-0000-0000-0000-000000000112','00000000-0000-0000-0000-000000000113',
   '00000000-0000-0000-0000-000000000121')),0::bigint,
  'Cafeteria Admin cannot read sibling, other-campus, or other-account menus');
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000113')$$,
  '42501',null,'Cafeteria Admin cannot request another campus projection');
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000121')$$,
  '42501',null,'Cafeteria Admin cannot request another-account projection');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'School Admin has no implicit saleability access');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002001',true);
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Account Admin has no implicit saleability access');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'POS customer-lookup capability does not grant catalog operation access');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002012',true);
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Staff affiliation alone has no saleability access');
reset role;
insert into auth.users(id,aud,role,email) values
  ('00000000-0000-0000-0000-000000002101','authenticated','authenticated','phase4b-student@example.invalid'),
  ('00000000-0000-0000-0000-000000002102','authenticated','authenticated','phase4b-guardian@example.invalid');
update public.persons set auth_user_id='00000000-0000-0000-0000-000000002101'
  where id='00000000-0000-0000-0000-000000005101';
update public.persons set auth_user_id='00000000-0000-0000-0000-000000002102'
  where id='00000000-0000-0000-0000-000000005103';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002101',true);
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Student identity alone cannot read saleability');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002102',true);
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Guardian relationship alone cannot read saleability');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
update public.cafeteria_memberships set status='suspended' where id='00000000-0000-0000-0000-000000003201';
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Suspended membership cannot read saleability');
select throws_ok($$select public.create_cafeteria_menu('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009301','Merienda escolar','Synthetic menu',30)$$,'42501',null,
  'Suspended actor cannot retrieve an idempotent menu-creation result');
select throws_ok($$select public.create_cafeteria_menu_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009001','00000000-0000-0000-0000-000000008101',10)$$,'42501',null,
  'Suspended actor cannot retrieve an idempotent assignment result');
select throws_ok($$select public.create_cafeteria_service_shift('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009101','00000000-0000-0000-0000-000000009001','Desayuno',
  '07:00','09:00',true,array[1,2,3,4,5])$$,'42501',null,
  'Suspended actor cannot retrieve an idempotent shift result');
reset role;
update public.cafeteria_memberships set status='active' where id='00000000-0000-0000-0000-000000003201';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
reset role;
update public.school_locations set status='inactive' where id='00000000-0000-0000-0000-000000000211';
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Inactive campus denies saleability');
reset role;
update public.school_locations set status='active' where id='00000000-0000-0000-0000-000000000211';
update public.cafeterias set status='inactive' where id='00000000-0000-0000-0000-000000000111';
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Inactive cafeteria denies saleability');
reset role;
update public.cafeterias set status='active' where id='00000000-0000-0000-0000-000000000111';
update public.schools set status='inactive' where id='00000000-0000-0000-0000-000000000011';
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Inactive school denies saleability');
reset role;
update public.schools set status='active' where id='00000000-0000-0000-0000-000000000011';
update public.accounts set status='inactive' where id='00000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Inactive account denies saleability');
reset role;
update public.accounts set status='active' where id='00000000-0000-0000-0000-000000000001';
delete from pikas_private.role_capabilities where scope_kind='cafeteria' and role_code='cafeteria_admin'
  and capability='cafeteria:catalog:read';
set local role authenticated;
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Revoked catalog-read capability denies saleability');
reset role;
insert into pikas_private.role_capabilities(scope_kind,role_code,capability)
values('cafeteria','cafeteria_admin','cafeteria:catalog:read');

select ok(exists(select 1 from audit_events where target_type='cafeteria_menus'
  and target_id='00000000-0000-0000-0000-000000009301' and action='insert'
  and actor_role='cafeteria_admin' and after_metadata->>'name'='Merienda'),
  'Menu creation is audited with a minimal safe payload');
select ok(exists(select 1 from audit_events where target_type='cafeteria_service_shifts'
  and target_id='00000000-0000-0000-0000-000000009311' and action='insert'
  and actor_role='cafeteria_admin'),'Shift creation is audited atomically');
select ok(exists(select 1 from audit_events where target_type='cafeteria_service_shift_days'
  and target_id='00000000-0000-0000-0000-000000009311' and action='insert'
  and after_metadata->>'weekday_iso'='1'),'Weekday configuration changes are audited by shift/day');

reset role;
grant insert,update,delete on public.cafeteria_menus,public.cafeteria_menu_products,
  public.cafeteria_service_shifts,public.cafeteria_service_shift_days to authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select throws_ok($$insert into public.cafeteria_menus(account_id,school_id,cafeteria_id,name)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','Direct menu')$$,'42501',null,'RLS denies direct menu insert despite broadened grants');
select throws_ok($$insert into public.cafeteria_menu_products(account_id,school_id,cafeteria_id,menu_id,product_id)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000009001',
  '00000000-0000-0000-0000-000000008104')$$,'42501',null,'RLS denies direct assignment insert despite broadened grants');
select throws_ok($$insert into public.cafeteria_service_shifts(account_id,school_id,cafeteria_id,menu_id,name,start_time,end_time)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000009001','Direct shift','11:00','12:00')$$,
  '42501',null,'RLS denies direct shift insert despite broadened grants');
select throws_ok($$insert into public.cafeteria_service_shift_days(account_id,school_id,cafeteria_id,service_shift_id,weekday_iso)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000009101',6)$$,
  '42501',null,'RLS denies direct weekday insert despite broadened grants');
with changed as (update public.cafeteria_menus set status='archived',version=999
  where id='00000000-0000-0000-0000-000000009001' returning id)
select is(count(*),0::bigint,'RLS denies direct menu lifecycle/version update') from changed;
with changed as (update public.cafeteria_menu_products set active=false,display_order=999,version=999
  where menu_id='00000000-0000-0000-0000-000000009001'
    and product_id='00000000-0000-0000-0000-000000008101' returning menu_id)
select is(count(*),0::bigint,'RLS denies direct assignment lifecycle/order/version update') from changed;
with changed as (update public.cafeteria_service_shifts set enabled=false,start_time='00:00',version=999
  where id='00000000-0000-0000-0000-000000009101' returning id)
select is(count(*),0::bigint,'RLS denies direct shift schedule/state/version update') from changed;
with removed as (delete from public.cafeteria_menu_products where menu_id='00000000-0000-0000-0000-000000009001' returning menu_id)
select is(count(*),0::bigint,'RLS denies direct menu assignment delete') from removed;
with removed as (delete from public.cafeteria_service_shifts where id='00000000-0000-0000-0000-000000009101' returning id)
select is(count(*),0::bigint,'RLS denies direct shift delete') from removed;
with removed as (delete from public.cafeteria_menus where id='00000000-0000-0000-0000-000000009001' returning id)
select is(count(*),0::bigint,'RLS denies direct menu delete') from removed;
with changed as (update public.cafeteria_service_shift_days set weekday_iso=7
  where service_shift_id='00000000-0000-0000-0000-000000009101' returning service_shift_id)
select is(count(*),0::bigint,'RLS denies direct weekday update') from changed;
with removed as (delete from public.cafeteria_service_shift_days
  where service_shift_id='00000000-0000-0000-0000-000000009101' returning service_shift_id)
select is(count(*),0::bigint,'RLS denies direct weekday delete') from removed;
select throws_ok($$truncate table public.cafeteria_menus$$,'42501',null,'TRUNCATE of menus is denied');
select throws_ok($$truncate table public.cafeteria_menu_products$$,'42501',null,'TRUNCATE of menu assignments is denied');
select throws_ok($$truncate table public.cafeteria_service_shifts$$,'42501',null,'TRUNCATE of shifts is denied');
select throws_ok($$truncate table public.cafeteria_service_shift_days$$,'42501',null,'TRUNCATE of shift days is denied');
reset role;
revoke insert,update,delete on public.cafeteria_menus,public.cafeteria_menu_products,
  public.cafeteria_service_shifts,public.cafeteria_service_shift_days from authenticated;
select * from finish();
rollback;