begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity),32::bigint,
  'RLS remains enabled on all Phase 1 through Phase 4A public tables');
select is((select count(*) from pg_policies where schemaname='public' and cmd<>'SELECT'),0::bigint,
  'No Phase 4A write RLS policies exist');
select is((select data_type from information_schema.columns where table_schema='public'
  and table_name='cafeteria_products' and column_name='price_minor'),'bigint',
  'Catalog prices use bigint minor units');
select is((select count(*) from information_schema.columns where table_schema='public'
  and table_name='cafeteria_products' and column_name='currency_code'),0::bigint,
  'Products inherit currency and cannot drift independently');
select is((select count(*) from pikas_private.role_capabilities
  where scope_kind='cafeteria' and capability in ('cafeteria:catalog:read','cafeteria:catalog:manage')),
  2::bigint,'Only two narrow cafeteria catalog capabilities are introduced');
select ok(not exists(select 1 from pikas_private.role_capabilities
  where capability in ('cafeteria:catalog:read','cafeteria:catalog:manage')
    and (scope_kind<>'cafeteria' or role_code<>'cafeteria_admin')),
  'Catalog capabilities are not assigned to Account Admin, School Admin, POS, or staff roles');
select ok(not has_table_privilege('authenticated','public.cafeteria_products','INSERT') and
  not has_table_privilege('authenticated','public.cafeteria_products','UPDATE') and
  not has_table_privilege('authenticated','public.cafeteria_products','DELETE') and
  not has_table_privilege('authenticated','public.cafeteria_products','TRUNCATE') and
  not has_table_privilege('authenticated','public.cafeteria_product_categories','TRUNCATE') and
  not has_table_privilege('authenticated','public.cafeteria_operation_settings','TRUNCATE') and
  not has_table_privilege('authenticated','public.cafeteria_operation_settings','UPDATE'),
  'Authenticated users have no direct catalog mutation grants');
select ok(not has_table_privilege('anon','public.cafeteria_products','SELECT') and
  not has_table_privilege('service_role','public.cafeteria_products','SELECT'),
  'Anonymous and service roles have no catalog base-table read grants');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','pikas_private') and p.prosecdef and not ('search_path=""'=any(p.proconfig))),0::bigint,
  'All Phase 4A SECURITY DEFINER functions pin an empty search path');
select ok(not has_function_privilege('anon','public.create_cafeteria_product(uuid,uuid,text,text,uuid,bigint,boolean,boolean,text[],text[])','EXECUTE') and
  not has_function_privilege('service_role','public.update_cafeteria_product(uuid,uuid,integer,text,text,uuid,bigint,boolean,boolean,text[],text[])','EXECUTE'),
  'Anonymous and service roles cannot invoke Phase 4A catalog mutations');

select is((select count(*) from cafeteria_operation_settings),4::bigint,
  'Existing four synthetic cafeterias each receive exactly one settings row');
select is((select count(*) from cafeteria_operation_settings where catalog_currency_code='DOP' and scheduling_enabled=false and version=1),4::bigint,
  'Catalog settings default to supported DOP and scheduling OFF');
select is((select count(*) from cafeteria_product_categories),3::bigint,'Synthetic categories are cafeteria-owned');
select is((select count(*) from cafeteria_products),4::bigint,'Synthetic products exercise catalog states');
select ok(exists(select 1 from cafeteria_products where cafeteria_id='00000000-0000-0000-0000-000000000111' and active and available and price_minor=5000)
  and exists(select 1 from cafeteria_products where cafeteria_id='00000000-0000-0000-0000-000000000111' and active and not available and price_minor=0)
  and exists(select 1 from cafeteria_products where cafeteria_id='00000000-0000-0000-0000-000000000111' and not active and available)
  and exists(select 1 from cafeteria_products where cafeteria_id='00000000-0000-0000-0000-000000000111' and category_id is null and price_minor=0),
  'Fixtures cover active/available, unavailable zero-price, inactive, and uncategorized products');
select is((select count(distinct cafeteria_id) from cafeteria_product_categories where name_key='bebidas'),2::bigint,
  'Same normalized category label is isolated per cafeteria');
select is((select count(*) from supported_currencies where currency_code='DOP' and status='enabled'),1::bigint,
  'Catalog uses the existing enabled DOP currency');
select lives_ok($$insert into cafeterias(id,account_id,school_id,school_location_id,code,name)
  values('00000000-0000-0000-0000-000000000115','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000211','CATALOG-TEST','Synthetic Catalog Test')$$,
  'New cafeteria insertion initializes its catalog settings');
select is((select count(*) from cafeteria_operation_settings where cafeteria_id='00000000-0000-0000-0000-000000000115'
  and catalog_currency_code='DOP' and scheduling_enabled=false and version=1),1::bigint,
  'New cafeteria receives exactly one DOP manual-mode settings row');
select is((select count(*) from cafeteria_products where cafeteria_id='00000000-0000-0000-0000-000000000115'),0::bigint,
  'Settings initialization does not create catalog products');
insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name)
values('00000000-0000-0000-0000-000000000115','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000211','CATALOG-TEST','Synthetic Catalog Test')
on conflict(id) do nothing;
insert into public.cafeteria_operation_settings(account_id,school_id,cafeteria_id,catalog_currency_code)
values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000115','DOP') on conflict(cafeteria_id) do nothing;
select is((select count(*) from cafeteria_operation_settings where cafeteria_id='00000000-0000-0000-0000-000000000115'),1::bigint,
  'Repeated cafeteria/settings initialization is both idempotent and uniqueness-protected');

delete from cafeteria_operation_settings where cafeteria_id='00000000-0000-0000-0000-000000000115';
select throws_ok($$insert into cafeteria_operation_settings(account_id,school_id,cafeteria_id,catalog_currency_code)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000115','USD')$$,'23503',null,'Unsupported catalog currency is rejected');
select throws_ok($$insert into cafeteria_operation_settings(account_id,school_id,cafeteria_id,catalog_currency_code)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000115','dop')$$,'23503',null,'Lowercase currency code does not bypass the registry');
select throws_ok($$insert into cafeteria_operation_settings(account_id,school_id,cafeteria_id,catalog_currency_code)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000115',' DOP ')$$,'23503',null,'Whitespace currency code does not bypass the registry');
select throws_ok($$insert into public.cafeteria_products(id,account_id,school_id,cafeteria_id,name,price_minor)
  values('00000000-0000-0000-0000-000000008410','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000115','Orphan Catalog Product',0)$$,
  '23503',null,'Database prevents a product without cafeteria settings/currency context');
select throws_ok($$insert into cafeteria_operation_settings(account_id,school_id,cafeteria_id,catalog_currency_code)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000115','DOP')$$,'23503',null,'Existing but mismatched school/cafeteria ancestry is rejected');
select throws_ok($$insert into cafeteria_product_categories(account_id,school_id,cafeteria_id,name)
  values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','Wrong tenant')$$,
  '23503',null,'Category cannot cross account/school/cafeteria ancestry');
select throws_ok($$insert into cafeteria_product_categories(account_id,school_id,cafeteria_id,name)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000111','Forged School')$$,
  '23503',null,'Category cannot forge individually valid but mismatched school ancestry');
select throws_ok($$insert into cafeteria_products(account_id,school_id,cafeteria_id,name,price_minor)
  values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','Wrong tenant',0)$$,
  '23503',null,'Product cannot cross account/school/cafeteria ancestry');
select throws_ok($$insert into cafeteria_products(account_id,school_id,cafeteria_id,name,price_minor)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000111','Forged School',0)$$,
  '23503',null,'Product cannot forge individually valid but mismatched school ancestry');
select throws_ok($$insert into cafeteria_products(account_id,school_id,cafeteria_id,category_id,name,price_minor)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000008003','Cross Cafeteria FK',0)$$,
  '23503',null,'Composite product/category FK rejects another cafeteria category directly');

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select is((select count(*) from cafeteria_operation_settings),1::bigint,'Cafeteria Admin reads only own catalog settings');
select is((select count(*) from cafeteria_products),4::bigint,'Cafeteria Admin reads only its own seeded products');
select lives_ok($$select public.update_cafeteria_catalog_settings('00000000-0000-0000-0000-000000000111',true,1)$$,
  'Cafeteria Admin enables future scheduling configuration');
select throws_ok($$select public.update_cafeteria_catalog_settings('00000000-0000-0000-0000-000000000111',false,1)$$,
  '40001',null,'Stale settings version is rejected');
select is((select version from cafeteria_operation_settings where cafeteria_id='00000000-0000-0000-0000-000000000111'),2,
  'Stale settings update leaves the current version unchanged');
select ok(not exists(select 1 from audit_events where target_type='cafeteria_operation_settings'
  and action='update' and actor_person_id='00000000-0000-0000-0000-000000001003'
  and cafeteria_id='00000000-0000-0000-0000-000000000111'
  and after_metadata->>'scheduling_enabled'='false'),
  'Stale settings update creates no success audit');
select throws_ok($$update cafeteria_operation_settings set catalog_currency_code='USD'
  where cafeteria_id='00000000-0000-0000-0000-000000000111'$$,
  '42501',null,'Cafeteria Admin cannot directly rewrite inherited catalog currency');
select ok(exists(select 1 from audit_events where target_type='cafeteria_operation_settings'
  and action='update' and actor_person_id='00000000-0000-0000-0000-000000001003'
  and cafeteria_id='00000000-0000-0000-0000-000000000111'),
  'Settings update creates exact-cafeteria audit');
select lives_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008004','Postres',30)$$,'Cafeteria Admin creates category');
select lives_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008004',' Postres ',30)$$,'Identical category creation retry is idempotent');
select is((select count(*) from cafeteria_product_categories where id='00000000-0000-0000-0000-000000008004'),1::bigint,
  'Category retry creates no duplicate row');
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008005',' postres ',40)$$,'23505',null,
  'Normalized category names are unique within exact cafeteria');
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008004','Postres changed',30)$$,'23505',null,
  'Category request UUID cannot be retried with a changed payload');
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008006','POSTRES',50)$$,'23505',null,
  'Uppercase category spelling is normalized within exact cafeteria');
select lives_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008201','Agua de prueba','Agua local','00000000-0000-0000-0000-000000008004',
  0,true,true,array['Water'],array['None'])$$,'Cafeteria Admin creates a categorized zero-price product');
select lives_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008201','Agua de prueba','Agua local','00000000-0000-0000-0000-000000008004',
  0,true,true,array['Water'],array['None'])$$,'Identical product creation retry is idempotent');
select is((select count(*) from cafeteria_products where id='00000000-0000-0000-0000-000000008201'),1::bigint,
  'Product creation retry creates no duplicate row');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002004',true);
set local role authenticated;
select throws_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000112',
  '00000000-0000-0000-0000-000000008201','Cross-tenant retry','',null,0,true,true)$$,'23505',null,
  'A product request UUID cannot disclose or reuse an object from another cafeteria');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
reset role;
insert into public.supported_currencies(currency_code,minor_unit_exponent,status) values('USD',2,'enabled');
select throws_ok($$update public.cafeteria_operation_settings set catalog_currency_code='USD'
  where cafeteria_id='00000000-0000-0000-0000-000000000111'$$,'23514',null,
  'Catalog currency remains immutable after product creation');
select ok(not exists(select 1 from audit_events where target_type='cafeteria_operation_settings'
  and target_id='00000000-0000-0000-0000-000000000111'
  and after_metadata->>'catalog_currency_code'='USD'),
  'Rejected currency change does not create a success audit');
select throws_ok($$update public.cafeteria_operation_settings set cafeteria_id='00000000-0000-0000-0000-000000000113'
  where cafeteria_id='00000000-0000-0000-0000-000000000111'$$,'23514',null,
  'Settings cafeteria ancestry is immutable even to privileged SQL');
select throws_ok($$update public.cafeteria_product_categories set cafeteria_id='00000000-0000-0000-0000-000000000113'
  where id='00000000-0000-0000-0000-000000008001'$$,'23514',null,
  'Category cafeteria ancestry is immutable even to privileged SQL');
select throws_ok($$update public.cafeteria_products set cafeteria_id='00000000-0000-0000-0000-000000000113'
  where id='00000000-0000-0000-0000-000000008101'$$,'23514',null,
  'Product cafeteria ancestry is immutable even to privileged SQL');
select throws_ok($$delete from public.cafeteria_product_categories
  where id='00000000-0000-0000-0000-000000008004'$$,'23503',null,
  'Referenced category cannot be destructively deleted');
select throws_ok($$delete from public.cafeteria_operation_settings
  where cafeteria_id='00000000-0000-0000-0000-000000000111'$$,'23503',null,
  'Settings/currency context cannot be deleted while products depend on it');
update public.cafeteria_operation_settings set catalog_currency_code='DOP'
  where cafeteria_id='00000000-0000-0000-0000-000000000111';
set local role authenticated;
reset role;
update public.supported_currencies set status='disabled' where currency_code='DOP';
select throws_ok($$insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name)
  values('00000000-0000-0000-0000-000000000116','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000211','DISABLED-DOP','Disabled DOP Test')$$,
  '23514',null,'New cafeteria cannot initialize while DOP is disabled');
set local role authenticated;
select throws_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008211','Disabled currency','',null,10,true,true)$$,
  '23514',null,'Product creation rejects a disabled catalog currency');
reset role;
update public.supported_currencies set status='enabled' where currency_code='DOP';
set local role authenticated;
select throws_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008201','Changed','Changed','00000000-0000-0000-0000-000000008004',
  1,true,true,array['Water'],array['None'])$$,'23505',null,'Product UUID retry with changed payload is rejected');
select throws_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008102','Invalid','',null,-1,true,true)$$,
  '22023',null,'Negative product price is rejected');
select throws_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008212','   ','',null,1,true,true)$$,
  '22023',null,'Whitespace-only product name is rejected');
select lives_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008214',repeat('x',120),'',null,1,true,true)$$,
  'Maximum-length product name is accepted');
select throws_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008215',repeat('x',121),'',null,1,true,true)$$,
  '22023',null,'Product name above the maximum length is rejected');
select lives_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008206','Precio máximo','',null,9223372036854775807,true,true)$$,
  'Bigint upper-bound price is accepted without intermediate arithmetic');
select is((select price_minor from cafeteria_products where id='00000000-0000-0000-0000-000000008206'),9223372036854775807::bigint,
  'Maximum price remains an exact bigint minor-unit value');
select throws_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008207','Overflow','',null,9223372036854775808::bigint,true,true)$$,
  '22003',null,'Price overflow is rejected by bigint conversion');
select throws_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008208','Malformed','',null,'not-a-price'::bigint,true,true)$$,
  '22P02',null,'Malformed price is rejected by bigint conversion');
select throws_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008209','Wrong numeric type','',null,1.25::numeric,true,true)$$,
  '42883',null,'A fractional numeric value cannot call the bigint price RPC');
select lives_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008210','  Agua mineral  ','',null,5000,true,true)$$,
  'Leading/trailing product-name whitespace is trimmed and duplicate names are allowed');
select is((select count(*) from cafeteria_products where cafeteria_id='00000000-0000-0000-0000-000000000111' and name='Agua mineral'),2::bigint,
  'Product names are not unique within a cafeteria');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002004',true);
set local role authenticated;
select lives_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000112',
  '00000000-0000-0000-0000-000000008211','Agua mineral','',null,5000,true,true)$$,
  'The same product name is allowed in another cafeteria');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008213','Piña escolar','',null,1,true,true)$$,
  'Unusual valid Unicode product names are accepted');
select throws_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008204','Cross category','',
  '00000000-0000-0000-0000-000000008003',100,true,true)$$,
  '23503',null,'Product cannot reference another cafeteria category');
select lives_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008203','Uncategorized','',null,0,true,false)$$,
  'A product may have no category');
select lives_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008203',1,'Uncategorized','',
  '00000000-0000-0000-0000-000000008001',0,true,false)$$,
  'Existing product can be assigned to a different active category');
select is((select category_id='00000000-0000-0000-0000-000000008001' and version=2
  from cafeteria_products where id='00000000-0000-0000-0000-000000008203'),true,
  'Successful category reassignment preserves UUID and increments version once');
select lives_ok($$select public.update_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008004',1,'Postres fríos',40)$$,
  'Category update increments its optimistic version');
select throws_ok($$select public.update_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008004',1,'Stale edit',40)$$,
  '40001',null,'Stale category edit is rejected');
select is((select version from cafeteria_product_categories where id='00000000-0000-0000-0000-000000008004'),2,
  'Stale category edit leaves the version unchanged');
select ok(not exists(select 1 from audit_events where target_id='00000000-0000-0000-0000-000000008004'
  and after_metadata->>'name'='Stale edit'),'Stale category edit creates no success audit');
select lives_ok($$select public.set_cafeteria_product_category_status('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008004',2,'archived')$$,
  'Category archives without deleting its product relationship');
select throws_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008105','New in archived category','',
  '00000000-0000-0000-0000-000000008004',100,true,true)$$,
  '23503',null,'Archived category is rejected for new product assignment');
select throws_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008101',1,'Agua mineral','Synthetic active saleable product',
  '00000000-0000-0000-0000-000000008004',5000,true,true)$$,
  '23503',null,'Existing product cannot be moved into a different archived category');
select throws_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008101',1,'Agua mineral','Synthetic active saleable product',
  '00000000-0000-0000-0000-000000008003',5000,true,true)$$,
  '23503',null,'Product update RPC rejects a category from another cafeteria');
select lives_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008201',1,'Agua fresca','Agua local',
  '00000000-0000-0000-0000-000000008004',12550,false,true,array['Water'],array['None'])$$,
  'Product may retain its existing archived category while configuration changes');
select is((select active=false and available=true and price_minor=12550 from cafeteria_products
  where id='00000000-0000-0000-0000-000000008201'),true,
  'Inactive and available remain separate states; price remains integer minor units');
select throws_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008201',1,'Stale','',
  '00000000-0000-0000-0000-000000008004',100,true,true,array['Water'],array['None'])$$,
  '40001',null,'Stale product version is rejected');
select is((select version from cafeteria_products where id='00000000-0000-0000-0000-000000008201'),2,
  'Stale product edit leaves the version unchanged');
select ok(not exists(select 1 from audit_events where target_id='00000000-0000-0000-0000-000000008201'
  and after_metadata->>'name'='Stale'),'Stale product edit creates no success audit');
select lives_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008201',2,'Agua fresca','Agua local',
  '00000000-0000-0000-0000-000000008004',12550,true,false,array['Water'],array['None'])$$,
  'Product reactivation preserves explicit unavailable state');
select is((select active=true and available=false from cafeteria_products
  where id='00000000-0000-0000-0000-000000008201'),true,
  'Reactivation does not silently set product available');
select lives_ok($$select public.set_cafeteria_product_category_status('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008004',3,'active')$$,'Category may be reactivated explicitly');
select lives_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008201',3,'Agua fresca','Agua local',
  '00000000-0000-0000-0000-000000008004',12550,true,true,array['Water'],array['None'])$$,
  'Availability is changed explicitly after product reactivation');
select ok(exists(select 1 from audit_events where target_type='cafeteria_products'
  and action='update' and actor_person_id='00000000-0000-0000-0000-000000001003'
  and cafeteria_id='00000000-0000-0000-0000-000000000111' and after_metadata->>'price_minor'='12550'),
  'Price update produces exact-cafeteria administrative audit');
select ok(exists(select 1 from audit_events where target_type='cafeteria_product_categories'
  and action='update' and target_id='00000000-0000-0000-0000-000000008004'
  and cafeteria_id='00000000-0000-0000-0000-000000000111' and actor_role='cafeteria_admin'),
  'Category archive/reactivation is audited with exact cafeteria scope');
select ok(exists(select 1 from audit_events where target_type='cafeteria_products'
  and action='insert' and target_id='00000000-0000-0000-0000-000000008201'
  and cafeteria_id='00000000-0000-0000-0000-000000000111' and actor_role='cafeteria_admin'),
  'Product creation is audited without requiring payload snapshots');
select ok(exists(select 1 from audit_events where target_type='cafeteria_products'
  and target_id='00000000-0000-0000-0000-000000008201' and after_metadata ? 'price_minor'
  and not (after_metadata ?| array['description','ingredients','allergens','restrictionTags'])),
  'Product audit retains operational price but omits description and food payloads');
select is((select version from cafeteria_product_categories where id='00000000-0000-0000-0000-000000008004'),4,
  'Category rename/reorder/archive/reactivation increments exactly once per successful mutation');
select is((select version from cafeteria_products where id='00000000-0000-0000-0000-000000008201'),4,
  'Product price/state edits increment exactly once per successful mutation');
select throws_ok($$select public.update_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008001',null,'Bebidas',10)$$,
  '40001',null,'NULL category version cannot bypass optimistic locking');
select is((select version from cafeteria_product_categories where id='00000000-0000-0000-0000-000000008001'),1,
  'Rejected NULL category version leaves the record unchanged');
select throws_ok($$select public.set_cafeteria_product_category_status('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008001',null,'archived')$$,
  '40001',null,'NULL category lifecycle version cannot bypass optimistic locking');
select is((select status='active' and version=1 from cafeteria_product_categories
  where id='00000000-0000-0000-0000-000000008001'),true,
  'Rejected NULL lifecycle version leaves category status/version unchanged');
select throws_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008101',null,'Agua mineral','Synthetic active saleable product',
  '00000000-0000-0000-0000-000000008001',5000,true,true)$$,
  '40001',null,'NULL product version cannot bypass optimistic locking');
select is((select version from cafeteria_products where id='00000000-0000-0000-0000-000000008101'),1,
  'Rejected NULL product version leaves the record unchanged');

reset role;
update public.cafeteria_memberships set status='suspended' where id='00000000-0000-0000-0000-000000003201';
set local role authenticated;
select throws_ok($$select public.update_cafeteria_catalog_settings('00000000-0000-0000-0000-000000000111',false,2)$$,
  '42501',null,'Suspended Cafeteria Admin membership cannot mutate catalog');
select throws_ok($$select public.create_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008201','Agua de prueba','Agua local','00000000-0000-0000-0000-000000008004',
  0,true,true,array['Water'],array['None'])$$,'42501',null,
  'Current authorization is checked before returning an idempotent product retry');
reset role;
update public.cafeteria_memberships set status='active' where id='00000000-0000-0000-0000-000000003201';
update public.accounts set status='inactive' where id='00000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008401','Inactive Account',1)$$,'42501',null,
  'Inactive account ancestry denies catalog mutation');
reset role;
update public.accounts set status='active' where id='00000000-0000-0000-0000-000000000001';
update public.schools set status='inactive' where id='00000000-0000-0000-0000-000000000011';
set local role authenticated;
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008402','Inactive School',1)$$,'42501',null,
  'Inactive school ancestry denies catalog mutation');
reset role;
update public.schools set status='active' where id='00000000-0000-0000-0000-000000000011';
update public.school_locations set status='inactive' where id='00000000-0000-0000-0000-000000000211';
set local role authenticated;
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008403','Inactive Campus',1)$$,'42501',null,
  'Inactive campus ancestry denies catalog mutation');
reset role;
update public.school_locations set status='active' where id='00000000-0000-0000-0000-000000000211';
update public.cafeterias set status='inactive' where id='00000000-0000-0000-0000-000000000111';
set local role authenticated;
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008404','Inactive Cafeteria',1)$$,'42501',null,
  'Inactive cafeteria denies catalog mutation');
reset role;
update public.cafeterias set status='active' where id='00000000-0000-0000-0000-000000000111';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002012',true);
set local role authenticated;
select is((select count(*) from cafeteria_products),0::bigint,'Staff affiliation alone grants no catalog read');
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008405','Staff Unauthorized',1)$$,'42501',null,
  'Staff affiliation alone grants no catalog mutation');

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select is((select count(*) from cafeteria_products),0::bigint,'School Admin has no implicit catalog read access');
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008301','School Unauthorized',1)$$,'42501',null,
  'School Admin without cafeteria capability cannot mutate catalog');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002001',true);
set local role authenticated;
select is((select count(*) from cafeteria_operation_settings),0::bigint,'Account Admin has no implicit catalog read access');
select throws_ok($$select public.update_cafeteria_catalog_settings('00000000-0000-0000-0000-000000000111',false,2)$$,
  '42501',null,'Account Admin has no implicit catalog mutation authority');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select is((select count(*) from cafeteria_products),0::bigint,'POS operator has no catalog administration read access');
select throws_ok($$select public.update_cafeteria_product('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000008201',4,'POS Edit','',null,1,true,true)$$,
  '42501',null,'POS operator cannot mutate catalog');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select is((select count(*) from cafeteria_products where cafeteria_id='00000000-0000-0000-0000-000000000112'),0::bigint,
  'Cafeteria A Admin cannot read sibling cafeteria catalog');
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000112',
  '00000000-0000-0000-0000-000000008302','Cross Cafeteria',1)$$,'42501',null,
  'Cafeteria A Admin cannot mutate sibling cafeteria catalog');
select is((select count(*) from cafeteria_operation_settings where cafeteria_id in
  ('00000000-0000-0000-0000-000000000113','00000000-0000-0000-0000-000000000115',
   '00000000-0000-0000-0000-000000000121')),0::bigint,
  'Cafeteria Admin cannot read other campus, same-campus sibling, or other-account settings');
select is((select count(*) from cafeteria_product_categories where cafeteria_id in
  ('00000000-0000-0000-0000-000000000112','00000000-0000-0000-0000-000000000113',
   '00000000-0000-0000-0000-000000000115','00000000-0000-0000-0000-000000000121')),0::bigint,
  'Cafeteria Admin cannot read cross-school/campus/account categories');
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000115',
  '00000000-0000-0000-0000-000000008408','Same-Campus Sibling',1)$$,'42501',null,
  'Cafeteria Admin cannot mutate a sibling cafeteria at the same campus');
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000113',
  '00000000-0000-0000-0000-000000008406','Other Campus',1)$$,'42501',null,
  'Cafeteria Admin cannot mutate another campus in the same school');
select throws_ok($$select public.create_cafeteria_product_category('00000000-0000-0000-0000-000000000121',
  '00000000-0000-0000-0000-000000008407','Other Account',1)$$,'42501',null,
  'Cafeteria Admin cannot mutate another account');

reset role;
grant insert,update,delete on public.cafeteria_products,public.cafeteria_product_categories,public.cafeteria_operation_settings to authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select throws_ok($$insert into public.cafeteria_operation_settings(account_id,school_id,cafeteria_id,catalog_currency_code)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000115','DOP')$$,'42501',null,
  'RLS rejects direct settings insert despite broad SQL grant');
select throws_ok($$insert into public.cafeteria_products(account_id,school_id,cafeteria_id,name,price_minor)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','Direct Write',100)$$,'42501',null,
  'RLS rejects direct product insert despite broad SQL grant');
select throws_ok($$insert into public.cafeteria_product_categories(account_id,school_id,cafeteria_id,name)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','Direct Category')$$,'42501',null,
  'RLS rejects direct category insert despite broad SQL grant');
with changed as (update public.cafeteria_products set price_minor=1
  where id='00000000-0000-0000-0000-000000008201' returning id)
select is(count(*),0::bigint,'RLS rejects direct price update despite broad SQL grant') from changed;
with changed as (update public.cafeteria_product_categories set name='Direct Update'
  where id='00000000-0000-0000-0000-000000008004' returning id)
select is(count(*),0::bigint,'RLS rejects direct category update despite broad SQL grant') from changed;
with removed as (delete from public.cafeteria_products where id='00000000-0000-0000-0000-000000008201' returning id)
select is(count(*),0::bigint,'RLS rejects direct product delete despite broad SQL grant') from removed;
with removed as (delete from public.cafeteria_product_categories
  where id='00000000-0000-0000-0000-000000008004' returning id)
select is(count(*),0::bigint,'RLS rejects direct category delete despite broad SQL grant') from removed;
with changed as (update public.cafeteria_operation_settings set scheduling_enabled=false
  where cafeteria_id='00000000-0000-0000-0000-000000000111' returning cafeteria_id)
select is(count(*),0::bigint,'RLS rejects direct settings update despite broad SQL grant') from changed;
with removed as (delete from public.cafeteria_operation_settings
  where cafeteria_id='00000000-0000-0000-0000-000000000111' returning cafeteria_id)
select is(count(*),0::bigint,'RLS rejects direct settings delete despite broad SQL grant') from removed;
with changed as (update public.cafeteria_products set price_minor=999,active=false,available=false,
  category_id=null,cafeteria_id='00000000-0000-0000-0000-000000000113',version=999
  where id='00000000-0000-0000-0000-000000008201' returning id)
select is(count(*),0::bigint,'RLS rejects direct product price/state/category/ancestry/version rewrite') from changed;
with changed as (update public.cafeteria_product_categories set name='Direct Update',status='archived',
  cafeteria_id='00000000-0000-0000-0000-000000000113',version=999
  where id='00000000-0000-0000-0000-000000008004' returning id)
select is(count(*),0::bigint,'RLS rejects direct category name/status/ancestry/version rewrite') from changed;
select throws_ok($$truncate table public.cafeteria_operation_settings$$,'42501',null,
  'Authenticated role cannot truncate catalog settings');
select throws_ok($$truncate table public.cafeteria_product_categories$$,'42501',null,
  'Authenticated role cannot truncate categories');
select throws_ok($$truncate table public.cafeteria_products$$,'42501',null,
  'Authenticated role cannot truncate products');
reset role;
revoke insert,update,delete on public.cafeteria_products,public.cafeteria_product_categories,public.cafeteria_operation_settings from authenticated;
select * from finish();
rollback;