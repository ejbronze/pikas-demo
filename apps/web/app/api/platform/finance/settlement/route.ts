import { createPlatformRpcPostHandler } from '../../../../../lib/auth/platform-rpc-route';
import { SETTLEMENT_MANAGE,settlementCommandSchema,settlementRejections,settlementResultSchema } from '../../../../../lib/platform/settlements';
// Settlement operations: finalize one ended week, run every ended week, confirm a payment/payout, open or resolve a review.
// The Idempotency-Key is the database request key, so a retry replays; the database re-checks authority after its locks.
export const POST = createPlatformRpcPostHandler({capability:SETTLEMENT_MANAGE,schema:settlementCommandSchema,resultSchema:settlementResultSchema,
 invoke:(client,c,key)=>c.operation==='finalize'?client.rpc('platform_finance_settlement_finalize',{p_cafeteria_id:c.cafeteria_id,p_week_start:c.week_start,p_request_key:key})
  :c.operation==='run'?client.rpc('platform_finance_settlement_run',{p_request_key:key})
  :c.operation==='payment'?client.rpc('platform_finance_settlement_confirm_payment',{p_reference:c.reference,p_amount_minor:Number(c.amount_minor),
    p_payment_reference:c.payment_reference,p_paid_on:c.paid_on,p_note:c.note||null,p_request_key:key})
  :client.rpc('platform_finance_settlement_review',{p_reference:c.reference,p_action:c.action,p_reason:c.action==='open'?c.reason:null,p_note:c.note||null,p_request_key:key}),
 rejections:message=>!!message&&settlementRejections.has(message),
});
