-- PIKAS Pilot Hardening: durable outcomes of the one-time bootstrap migrations (replaces three retired replay suites).
--
-- 202610090003 (Colegio Horizonte sandbox), 202610090004 (Edwin sandbox operator) and 202610090006 (Horizonte pilot
-- dataset) ran once and are recorded; they never run again. Their former suites (phase6b3_sandbox_bootstrap,
-- phase6b4_edwin_sandbox_operator, step4c_pilot_ready) replayed verbatim DO-block copies against simulated "pristine" and
-- "initialized" databases that predate the Demo Lab canonical baseline (202611170001), so they failed for reasons that
-- no longer describe the product. This suite keeps the contracts those bootstraps established and that still hold;
-- the living sandbox behaviour (reset, personas, Demo POV isolation, no financial obligations) is demo_lab_sandbox,
-- ux11_demo_mode and ux11_demo_mutation_isolation.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; s text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text, s=returned_sqlstate; return s||':'||m; end$$;

select is((select count(*) from supabase_migrations.schema_migrations where version in ('202610090003','202610090004','202610090006')),3::bigint,
 'The three one-time bootstrap migrations are recorded as applied (they cannot run again)');

-- 6B.3: Colegio Horizonte is the sandbox, with fixed identity, and can never become a real customer.
select is((select tenant_kind||':'||code from accounts where id='03e71159-69e9-4387-9b3b-65799d49faf0'),'sandbox:COLEGIO-HORIZONTE','Colegio Horizonte keeps its fixed id and is a sandbox');
select is((select count(*) from accounts where tenant_kind='sandbox'),1::bigint,'Exactly one sandbox account');
select ok(exists(select 1 from pg_trigger where tgrelid='public.accounts'::regclass and tgname='accounts_tenant_kind_immutable' and tgenabled<>'D'),'tenant_kind immutability trigger is present and enabled');
select ok(pg_temp.attempt($$update accounts set tenant_kind='customer' where id='03e71159-69e9-4387-9b3b-65799d49faf0'$$) <> 'ok','The sandbox cannot be reclassified as a customer');
select ok(pg_temp.attempt($$update accounts set tenant_kind='sandbox' where id='00000000-0000-0000-0000-000000000001'$$) <> 'ok','A customer cannot be reclassified as a sandbox');
select is(pg_temp.attempt($$select pikas_private.finance_activate_customer('03e71159-69e9-4387-9b3b-65799d49faf0',1,'Sandbox','historical-bootstrap-key-1')$$),
 '23514:ACTIVATION_REQUIRES_ACTIVE_CUSTOMER','The sandbox can never be financially activated');

-- 4C: the Horizonte structure keeps the fixed ids the Demo Lab baseline is rebuilt around.
select is((select concat_ws('/',(select account_id from schools where id='df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488'),(select account_id from school_locations where id='cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4'),
 (select account_id from cafeterias where id='b9496342-5079-46ae-83b8-05c39bcbd7fe')))::text,'03e71159-69e9-4387-9b3b-65799d49faf0/03e71159-69e9-4387-9b3b-65799d49faf0/03e71159-69e9-4387-9b3b-65799d49faf0',
 'Horizonte colegio, sede and cafetería keep their fixed ids and belong to the sandbox');

-- 6B.4: Edwin is a sandbox operator only — Demo entry, never Platform Admin or finance.
select is((select string_agg(role_code||':'||status,',' order by role_code) from pikas_private.platform_memberships where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1'),
 'platform_sandbox_operator:active','Edwin holds only the sandbox-operator role');
select is((select string_agg(capability,',' order by capability) from pikas_private.platform_role_capabilities where role_code='platform_sandbox_operator'),'platform:sandbox:pov:enter',
 'The sandbox-operator role grants Demo entry only');
select is((select count(*) from pikas_private.platform_role_capabilities where role_code='platform_sandbox_operator' and (capability like 'platform:finance%' or capability like 'platform:tenant%')),0::bigint,
 'No finance or tenant authority through the sandbox operator');

select * from finish();
rollback;
