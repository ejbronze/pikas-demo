import { createPlatformRpcPostHandler } from '../../../../../lib/auth/platform-rpc-route';
import { FINANCE_VERIFY,decisionResultSchema,decisionSchema,financeRejections } from '../../../../../lib/platform/finance';
// Verify or reject one bank transfer. The Idempotency-Key is the FIN 2 decision key, so a retry with
// the same key replays the original decision; the database re-checks the capability after its locks.
export const POST = createPlatformRpcPostHandler({capability:FINANCE_VERIFY,schema:decisionSchema,resultSchema:decisionResultSchema,
 invoke:(client,command,key)=>client.rpc('platform_finance_decide_bank_replenishment',{p_reference:command.reference,p_decision:command.decision,
  p_rejection_reason:command.decision==='reject'?command.reason:null,p_decision_key:key}),
 rejections:message=>!!message&&financeRejections.has(message),
});
