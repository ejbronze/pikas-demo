import { createPlatformRpcPostHandler } from '../../../../../lib/auth/platform-rpc-route';
import { FINANCE_REVERSE,financeRejections,reversalResultSchema,reversalSchema } from '../../../../../lib/platform/finance';
// Finance reversal of one verified bank transfer. The database decides eligibility
// (FINANCIAL_RESOLUTION_REQUIRED when the net is no longer available) and never partially reverses.
export const POST = createPlatformRpcPostHandler({capability:FINANCE_REVERSE,schema:reversalSchema,resultSchema:reversalResultSchema,
 invoke:(client,command,key)=>client.rpc('platform_finance_reverse_replenishment',{p_reference:command.reference,p_reason:command.reason,
  p_note:command.note||null,p_request_key:key}),
 rejections:message=>!!message&&financeRejections.has(message),
});
