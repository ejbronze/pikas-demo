-- Focused LOCAL ONLY; run on the restored pikas-4d6 fixture. Every write rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.actor(q text) returns jsonb language plpgsql as $$
declare r jsonb; begin
 perform set_config('request.jwt.claim.sub','ec08ad21-4020-4b0d-b041-ee4a1fe09471',true);
 set local role authenticated; execute q into r; reset role; return r;
exception when others then reset role; raise; end $$;
create function pg_temp.denied(q text) returns text language plpgsql as $$
begin perform pg_temp.actor(q);return 'allowed';exception when others then return sqlstate;end $$;
create function pg_temp.pov(code text) returns jsonb language sql as $$
 select pg_temp.actor(format('select public.platform_enter_sandbox_pov(%L,%L,%L,%L)',gen_random_uuid(),'03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe',code)); $$;
create function pg_temp.save(payload jsonb,request uuid default gen_random_uuid()) returns jsonb language sql as $$
 select pg_temp.actor(format('select public.cafeteria_admin_command(%L,%L,%L,%L::jsonb)','b9496342-5079-46ae-83b8-05c39bcbd7fe',request,'product_save',payload)); $$;
create function pg_temp.payload(product uuid) returns jsonb language sql as $$
 select jsonb_build_object('id',p.id,'version',p.version,'name',p.name,'description',p.description,'category',c.name,'price_minor',p.price_minor,'active',p.active,'available',p.available,'unit',p.unit,'ingredients',p.ingredients,'allergens',p.allergens)
 from public.cafeteria_products p join public.cafeteria_product_categories c on c.id=p.category_id where p.id=product; $$;
select ok((select bool_and(unit='Unidad') from public.cafeteria_products),'existing fixture products default to Unidad');
select pg_temp.pov('cashier');
create temp table opened as select (pg_temp.actor($q$select to_jsonb(x) from public.open_register_session('4c000000-0000-4000-8000-000000000010','4c000000-0000-4000-8000-000000000011',0,'step4d7c-open-register-0001') x$q$)->>'session_id')::uuid id;
create temp table original_sale as select pg_temp.actor(format($q$select public.checkout_purchase(jsonb_build_object('request_key','step4d7c-original-sale','register_session_id',%L::uuid,'cafeteria_customer_id','4c000000-0000-4000-8000-000000000502','expected_total_minor','9500','items',jsonb_build_array(jsonb_build_object('product_id','4c000000-0000-4000-8000-000000000033','quantity',1,'expected_product_version',1,'expected_unit_price_minor','9500')),'tender',jsonb_build_object('type','cash','cash_received_minor','10000')))$q$,(select id from opened))) receipt;
select is((select receipt->>'total_minor' from original_sale),'9500','existing POS purchase path succeeds before catalog edits');
create temp table history as select (select to_jsonb(p) from public.purchases p where p.id=((select receipt from original_sale)->>'purchase_id')::uuid) purchase,(select jsonb_agg(to_jsonb(i) order by id) from public.purchase_items i where i.purchase_id=((select receipt from original_sale)->>'purchase_id')::uuid) items;
select pg_temp.pov('cafeteria_admin');
create temp table original_food as select ingredients,allergens from public.cafeteria_products where id='4c000000-0000-4000-8000-000000000033';
select lives_ok($q$select pg_temp.save(pg_temp.payload('4c000000-0000-4000-8000-000000000033')||'{"unit":"Porción","price_minor":10500}'::jsonb)$q$,'update current unit and price through existing command');
select is((select unit from public.cafeteria_products where id='4c000000-0000-4000-8000-000000000033'),'Porción','unit stored');
select is((select version from public.cafeteria_products where id='4c000000-0000-4000-8000-000000000033'),2,'one version increment per product command');
select is((select ingredients from public.cafeteria_products where id='4c000000-0000-4000-8000-000000000033'),(select ingredients from original_food),'ingredients survive price/unit edit');
select is((select allergens from public.cafeteria_products where id='4c000000-0000-4000-8000-000000000033'),(select allergens from original_food),'allergens survive price/unit edit');
select ok(pg_temp.actor($q$select public.cafeteria_admin_read('b9496342-5079-46ae-83b8-05c39bcbd7fe')$q$)->'products' @> '[{"id":"4c000000-0000-4000-8000-000000000033","unit":"Porción"}]','unit reaches authoritative read projection');
create temp table new_payload as select '{"id":"4d7c0000-0000-4000-8000-000000000001","version":null,"name":"Producto local","description":"Descripción","category":"Alimentos","unit":"Vaso","price_minor":0,"active":true,"available":true,"ingredients":["Avena","Agua"],"allergens":["Gluten"]}'::jsonb p;
select lives_ok($q$select pg_temp.save((select p from new_payload),'4d7c0000-0000-4000-8000-000000000002')$q$,'create with explicit unit, structured food lists and zero price');
select is((select unit from public.cafeteria_products where id='4d7c0000-0000-4000-8000-000000000001'),'Vaso','explicit new unit stored');
select lives_ok($q$select pg_temp.save((select p from new_payload),'4d7c0000-0000-4000-8000-000000000002')$q$,'exact retry replays');
select throws_ok($q$select pg_temp.save((select p from new_payload)||'{"unit":"Botella"}'::jsonb,'4d7c0000-0000-4000-8000-000000000002')$q$,'23505','request_key_reused','changed unit cannot reuse request key');
select throws_ok($q$select pg_temp.save(pg_temp.payload('4d7c0000-0000-4000-8000-000000000001')||'{"unit":" "}'::jsonb)$q$,'22023','invalid_product_unit','empty unit denied');
select throws_ok($q$select pg_temp.save(pg_temp.payload('4d7c0000-0000-4000-8000-000000000001')||jsonb_build_object('unit',repeat('x',41)))$q$,'22023','invalid_product_unit','oversized unit denied');
select lives_ok($q$select pg_temp.save(pg_temp.payload('4d7c0000-0000-4000-8000-000000000001')-'unit')$q$,'legacy pending payload remains accepted without transforming fingerprint');
select is((select unit from public.cafeteria_products where id='4d7c0000-0000-4000-8000-000000000001'),'Vaso','legacy update preserves stored unit');
select is((select ingredients from public.cafeteria_products where id='4d7c0000-0000-4000-8000-000000000001'),array['Avena','Agua'],'structured ingredient round-trip');
select is((select allergens from public.cafeteria_products where id='4d7c0000-0000-4000-8000-000000000001'),array['Gluten'],'structured allergen round-trip');
select throws_ok($q$select pg_temp.save(pg_temp.payload('4d7c0000-0000-4000-8000-000000000001')||'{"version":1,"unit":"Otra"}'::jsonb)$q$,'40001','stale_product_version','stale edit rejected');
select is(pg_temp.denied($q$select public.cafeteria_admin_command('00000000-0000-0000-0000-000000000222',gen_random_uuid(),'product_save','{}')$q$),'42501','cross-cafeteria authority denied');
select ok(exists(select 1 from public.cafeteria_products p join public.cafeteria_product_categories c on c.id=p.category_id and c.cafeteria_id=p.cafeteria_id where p.id='4d7c0000-0000-4000-8000-000000000001'),'category resolves in exact cafeteria');
select ok(exists(select 1 from public.audit_events where after_metadata->>'product_id'='4c000000-0000-4000-8000-000000000033' and after_metadata->>'unit'='Porción' and authenticated_user_id='ec08ad21-4020-4b0d-b041-ee4a1fe09471'),'unit update audited with real operator');
select pg_temp.pov('cashier');
select ok(pg_temp.actor($q$select public.get_cafeteria_saleable_catalog('b9496342-5079-46ae-83b8-05c39bcbd7fe')$q$)->'products' @> '[{"product_id":"4c000000-0000-4000-8000-000000000033","price_minor":10500}]','POS catalog remains compatible with current authoritative price');
create temp table future_sale as select pg_temp.actor(format($q$select public.checkout_purchase(jsonb_build_object('request_key','step4d7c-future-sale','register_session_id',%L::uuid,'cafeteria_customer_id','4c000000-0000-4000-8000-000000000502','expected_total_minor','10500','items',jsonb_build_array(jsonb_build_object('product_id','4c000000-0000-4000-8000-000000000033','quantity',1,'expected_product_version',2,'expected_unit_price_minor','10500')),'tender',jsonb_build_object('type','cash','cash_received_minor','11000')))$q$,(select id from opened))) receipt;
select is((select receipt->>'total_minor' from future_sale),'10500','new sale uses current price without unit multiplier or ingredient blocking');
select pg_temp.pov('cafeteria_admin');
select lives_ok($q$select pg_temp.save(pg_temp.payload('4c000000-0000-4000-8000-000000000033')||'{"available":false}'::jsonb)$q$,'availability can be changed independently');
select ok((select active and not available from public.cafeteria_products where id='4c000000-0000-4000-8000-000000000033'),'unavailable does not deactivate');
select pg_temp.pov('cashier');
select ok(not(pg_temp.actor($q$select public.get_cafeteria_saleable_catalog('b9496342-5079-46ae-83b8-05c39bcbd7fe')$q$)->'products' @> '[{"product_id":"4c000000-0000-4000-8000-000000000033"}]'),'unavailable product excluded from POS');
select pg_temp.pov('cafeteria_admin');
select lives_ok($q$select pg_temp.save(pg_temp.payload('4c000000-0000-4000-8000-000000000033')||'{"active":false}'::jsonb)$q$,'deactivation retains product identity');
select is((select to_jsonb(p) from public.purchases p where p.id=((select receipt from original_sale)->>'purchase_id')::uuid),(select purchase from history),'historical purchase row byte-equivalent after price/unit/status edits');
select is((select jsonb_agg(to_jsonb(i) order by id) from public.purchase_items i where i.purchase_id=((select receipt from original_sale)->>'purchase_id')::uuid),(select items from history),'historical line prices/totals/snapshots unchanged');
select * from finish();
rollback;
