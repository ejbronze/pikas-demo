-- Development metadata. Create Auth users through `supabase auth` or the Dashboard;
-- never commit passwords. After creating users, replace the UUID placeholders locally.
insert into public.schools(id,name) values('10000000-0000-0000-0000-000000000001','Instituto Nueva Generación') on conflict do nothing;
insert into public.families(id,family_code,display_name) values('20000000-0000-0000-0000-000000000001','PK-2048','Familia Rosa') on conflict do nothing;
insert into public.allergies(name) values('Maní'),('Lactosa'),('Gluten') on conflict do nothing;
insert into public.students(id,family_id,school_id,student_code,first_name,last_name,preferred_name,grade,status) values
('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','PK-10982','Sofía','Rosa','Sofi','5.º A','active'),
('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','PK-11804','Mateo','Rosa','Mateo','2.º B','active') on conflict do nothing;
insert into public.wallets(id,student_id,status) values
('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','active'),
('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','active') on conflict do nothing;
insert into public.student_controls(student_id,daily_spending_limit_minor,per_transaction_limit_minor) values
('30000000-0000-0000-0000-000000000001',35000,25000),('30000000-0000-0000-0000-000000000002',30000,20000) on conflict(student_id) do nothing;
insert into public.student_allergies(student_id,allergy_id) select '30000000-0000-0000-0000-000000000001',id from public.allergies where name in ('Maní','Lactosa') on conflict do nothing;
insert into public.blocked_products(student_id,product_name) values
('30000000-0000-0000-0000-000000000001','Bebidas energéticas'),('30000000-0000-0000-0000-000000000002','Bebidas energéticas') on conflict do nothing;
insert into public.menu_items(id,school_id,name,description,category,price_minor,available) values
('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Pasta con pollo','Almuerzo completo','Almuerzo',18000,true),
('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Sándwich integral','Merienda escolar','Merienda',12000,true),
('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Pizza escolar','Porción individual','Almuerzo',15000,true),
('50000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Bebidas energéticas','Producto restringible','Bebidas',11000,true),
('50000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','Especial del día','Agotado por hoy','Almuerzo',20000,false) on conflict do nothing;
insert into public.wallet_ledger_entries(wallet_id,transaction_type,amount_minor,direction,status,description,category,idempotency_key) values
('40000000-0000-0000-0000-000000000001','parent_top_up',261000,'credit','completed','Saldo inicial ficticio','Recarga','seed:sofia:credit'),
('40000000-0000-0000-0000-000000000001','cafeteria_purchase',16000,'debit','completed','Jugo natural y sándwich','Alimentos','seed:sofia:purchase'),
('40000000-0000-0000-0000-000000000002','parent_top_up',178500,'credit','completed','Saldo inicial ficticio','Recarga','seed:mateo:credit'),
('40000000-0000-0000-0000-000000000002','cafeteria_purchase',10500,'debit','completed','Agua y barra de cereal','Alimentos','seed:mateo:purchase') on conflict do nothing;
