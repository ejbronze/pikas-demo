-- PIKAS UX 13B: a minimal, read-only student-service status for the Cafetería Admin.
--
-- The School owns sharing, sharing categories and student eligibility; the Cafetería can only ask
-- "should the POS find students today?". The existing Cafetería read (cafeteria_admin_read →
-- pikas_private.cafeteria_admin_read_core, authority in pikas_private.cafeteria_read_scope) gains one
-- additive key, 'student_service', computed for the cafetería already authorized by that scope:
--   sharing: never | active | revoked        (no school_cafeteria_shares row = never)
--   identification_shared: boolean           (active share with the basic_identification category — what the POS needs)
--   school_has_students: boolean             (any active student in the cafetería's school; no count, no roster)
--   enabled_students: integer                (active cafeteria_customers rows for active students of THIS cafetería)
--   state: not_shared | sharing_revoked | identification_not_shared | no_students | no_students_enabled | ready
-- No student names, ids, codes, placements, restrictions or eligibility rows leave the server. The
-- Platform support read shares this core and receives the same counts (it already reads the school's
-- structure). No table, column, RLS, capability, grant or role change; the public wrapper
-- cafeteria_admin_read(uuid) is untouched. The function below is its live definition verbatim plus the
-- stated addition; ownership and grants are preserved by CREATE OR REPLACE.
begin;

CREATE OR REPLACE FUNCTION pikas_private.cafeteria_admin_read_core(p_support_account uuid, p_cafeteria_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx jsonb; ss_sharing text; ss_ident boolean; ss_students boolean; ss_enabled integer; ss_state text;
begin
 ctx:=pikas_private.cafeteria_read_scope(p_support_account,p_cafeteria_id,null);
 -- UX 13B: student-service status for THIS cafetería (School-owned facts, operational truth only: no names, ids, codes or rows).
 select case when sh.id is null then 'never' when sh.status='active' then 'active' else 'revoked' end,
        sh.status='active' and exists(select 1 from public.school_cafeteria_share_categories sc where sc.share_id=sh.id and sc.enabled and sc.category='basic_identification'),
        exists(select 1 from public.students st where st.account_id=c.account_id and st.school_id=c.school_id and st.status='active'),
        (select count(*) from public.cafeteria_customers cu join public.students st on st.id=cu.student_id and st.status='active' where cu.cafeteria_id=c.id and cu.status='active')
   into ss_sharing,ss_ident,ss_students,ss_enabled
   from public.cafeterias c left join public.school_cafeteria_shares sh on sh.cafeteria_id=c.id and sh.school_id=c.school_id and sh.account_id=c.account_id
   where c.id=p_cafeteria_id;
 ss_state:=case when ss_sharing='never' then 'not_shared' when ss_sharing='revoked' then 'sharing_revoked' when not coalesce(ss_ident,false) then 'identification_not_shared'
   when not coalesce(ss_students,false) then 'no_students' when coalesce(ss_enabled,0)=0 then 'no_students_enabled' else 'ready' end;
 return jsonb_build_object('scope',ctx,
 'settings',(select jsonb_build_object('currency',catalog_currency_code,'scheduling_enabled',scheduling_enabled,'version',version) from public.cafeteria_operation_settings where cafeteria_id=p_cafeteria_id),
 'categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'display_order',display_order,'version',version) order by display_order,name,id) from public.cafeteria_product_categories where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'unit',unit,'category_id',category_id,'price_minor',price_minor,'active',active,'available',available,'ingredients',ingredients,'allergens',allergens,'version',version) order by name,id) from public.cafeteria_products where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'menus',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'active',status='active','version',version,'product_ids',coalesce((select jsonb_agg(mp.product_id order by mp.display_order,mp.product_id) from public.cafeteria_menu_products mp where mp.menu_id=m.id and mp.active),'[]'::jsonb)) order by display_order,name,id) from public.cafeteria_menus m where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'shifts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'menu_id',menu_id,'name',name,'start_time',to_char(start_time,'HH24:MI'),'end_time',to_char(end_time,'HH24:MI'),'enabled',enabled,'version',version,'weekdays',coalesce((select jsonb_agg(weekday_iso order by weekday_iso) from public.cafeteria_service_shift_days where service_shift_id=sh.id),'[]'::jsonb)) order by start_time,id) from public.cafeteria_service_shifts sh where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'registers',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'code',r.register_code,'name',r.display_name,'status',r.status,'version',r.version,'has_history',exists(select 1 from public.register_sessions rs where rs.register_id=r.id),'open',exists(select 1 from public.register_sessions rs where rs.register_id=r.id and rs.status='open')) order by r.register_code,r.id) from public.cafeteria_registers r where r.cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'staff',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',p.display_name,'role',m.role_code,'status',m.status,'open',exists(select 1 from public.register_sessions rs where rs.cafeteria_id=p_cafeteria_id and rs.operator_person_id=p.id and rs.status='open')) order by p.display_name,m.id) from public.cafeteria_memberships m join public.persons p on p.id=m.person_id where m.cafeteria_id=p_cafeteria_id and m.role_code in ('pos_cashier','pos_supervisor')),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'membership_id',cafeteria_membership_id,'register_id',register_id,'status',status,'version',version) order by id) from public.cafeteria_register_assignments where cafeteria_id=p_cafeteria_id),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',intended_email,'role',role_code,'status',case when status='pending' and expires_at<=clock_timestamp() then 'expired' else status end,'expires_at',expires_at) order by created_at,id) from public.invitations where cafeteria_id=p_cafeteria_id and scope_kind='cafeteria' and role_code in ('pos_cashier','pos_supervisor')),'[]'::jsonb),
 'service',(select to_jsonb(svc) from pikas_private.resolve_cafeteria_service_at(p_cafeteria_id,clock_timestamp()) svc),
 'student_service',jsonb_build_object('sharing',ss_sharing,'identification_shared',coalesce(ss_ident,false),'school_has_students',coalesce(ss_students,false),'enabled_students',coalesce(ss_enabled,0),'state',ss_state));
end $function$;

commit;
