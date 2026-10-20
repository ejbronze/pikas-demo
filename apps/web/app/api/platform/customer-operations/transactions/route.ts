import { detailResultSchema, transactionsErrors, transactionsOperationSchema, transactionsResultSchema } from "../../../../../lib/cafeteria/transactions";
import { supportRequestSchema } from "../../../../../lib/platform/customer-operations";
import { supportJson, supportReader, supportRpcFailure } from "../../../../../lib/platform/support-read-route";

// Backoffice Customer Management: read-only transaction history/detail for an explicit customer
// cafeteria (platform_support_* wrappers). No transaction mutation exists behind this route.
const schema = supportRequestSchema(transactionsOperationSchema);
export async function POST(request: Request) {
  const auth = await supportReader(request);
  if ("response" in auth) return auth.response;
  let parsed;
  try { parsed = schema.safeParse(await request.json()); } catch { return supportJson({ error: "invalid_payload" }, 400); }
  if (!parsed.success) return supportJson({ error: "invalid_payload" }, 400);
  const { account_id, request: op } = parsed.data;
  try {
    const { data, error } = op.operation === "list"
      ? await auth.client.rpc("platform_support_cafeteria_transactions_read", { p_account_id: account_id, p_cafeteria_id: op.cafeteria_id, p_period: op.period, p_from: op.from, p_to: op.to,
        p_tender: op.tender, p_refund_status: op.refund_status, p_receipt: op.receipt, p_offset: op.offset })
      : await auth.client.rpc("platform_support_cafeteria_transaction_detail", { p_account_id: account_id, p_cafeteria_id: op.cafeteria_id, p_purchase_id: op.purchase_id });
    if (error) return supportRpcFailure(error, transactionsErrors);
    if (op.operation === "list") {
      const result = transactionsResultSchema.safeParse(data);
      if (!result.success || result.data.cafeteria_id !== op.cafeteria_id || result.data.offset !== op.offset) return supportJson({ error: "invalid_response" }, 502);
      return supportJson({ result: result.data });
    }
    const result = detailResultSchema.safeParse(data);
    if (!result.success || result.data.cafeteria_id !== op.cafeteria_id || result.data.data.id !== op.purchase_id) return supportJson({ error: "invalid_response" }, 502);
    return supportJson({ result: result.data });
  } catch { return supportJson({ error: "support_read_unavailable" }, 503); }
}
