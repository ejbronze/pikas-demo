-- Development metadata. Create Auth users through `supabase auth` or the Dashboard;
-- never commit passwords. After creating users, replace the UUID placeholders locally.
insert into public.schools(id,name) values('10000000-0000-0000-0000-000000000001','Instituto Nueva Generación') on conflict do nothing;
insert into public.families(id,family_code,display_name) values('20000000-0000-0000-0000-000000000001','PK-2048','Familia Rosa') on conflict do nothing;
insert into public.allergies(name) values('Maní'),('Lactosa'),('Gluten') on conflict do nothing;
insert into public.menu_items(school_id,name,description,category,price_minor,available) values('10000000-0000-0000-0000-000000000001','Pasta con pollo','Almuerzo completo','Almuerzo',18000,true),('10000000-0000-0000-0000-000000000001','Sándwich integral','Merienda escolar','Merienda',12000,true),('10000000-0000-0000-0000-000000000001','Pizza escolar','Porción individual','Almuerzo',15000,true);
