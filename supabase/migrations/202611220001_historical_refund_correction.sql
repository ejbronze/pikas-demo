-- PIKAS Settlement: a refund follows the financial context of its ORIGINAL purchase (local; not deployed).
--
-- finance_after_wallet_refund returned early whenever the customer had no CURRENT financial activation. A PIKAS Cash sale
-- made while activated created a clearing → Cafetería payable; if activation ended and the sale was refunded, the wallet
-- was restored but the payable was never corrected, overpaying the Cafetería.
--
-- Now the authoritative evidence is the refunded purchase itself: if its wallet debit created a
-- wallet_purchase_fulfillment obligation, the refund records stored_value_restored and a wallet_refund_correction
-- (Cafetería → clearing) for exactly the refunded wallet amount, whatever the activation state on the day of the refund.
-- The existing correction guard still refuses any total above the original payable, so partial/itemized refunds correct
-- only what they refund. Without such a payable (a pre-activation purchase, or a cash sale, which never reaches this
-- trigger), behavior is unchanged: legacy_purchase_refund while activated, nothing when not. No replenishment, no fee,
-- no new stored-value funding. Activation still governs every NEW financial event.
begin;

create or replace function pikas_private.finance_after_wallet_refund()
returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.financial_entries; original uuid;
begin
  select o.id into original from public.financial_obligations o join public.financial_entries pe on pe.id = o.source_entry_id
    where pe.wallet_purchase_debit_id = new.original_purchase_debit_id and o.reason = 'wallet_purchase_fulfillment';
  -- A historical financialized sale is corrected even after activation ended; otherwise only an active policy records anything.
  if original is null and pikas_private.financial_activation(new.account_id) is null then return null; end if;
  insert into public.financial_entries(account_id,school_id,cafeteria_id,currency_code,entry_type,amount_minor,wallet_refund_credit_id,actor_person_id,occurred_at)
  values (new.account_id,new.school_id,new.cafeteria_id,new.currency_code,'stored_value_restored',new.amount_minor,new.id,new.actor_person_id,new.posted_at) returning * into e;
  if original is not null then
    perform pikas_private.record_obligation(e,'wallet_refund_correction',pikas_private.cafeteria_party(new.cafeteria_id),pikas_private.clearing_party(),original);
  else
    perform pikas_private.record_obligation(e,'legacy_purchase_refund',pikas_private.cafeteria_party(new.cafeteria_id),pikas_private.clearing_party(),null);
  end if;
  return null;
end $$;

revoke all on function pikas_private.finance_after_wallet_refund() from public, anon, authenticated, service_role;
do $acl$
begin
  if exists (select 1 from pg_proc p where p.oid = 'pikas_private.finance_after_wallet_refund()'::regprocedure
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee <> p.proowner))) then
    raise exception 'historical_refund_acl_mismatch'; end if;
end $acl$;

commit;
