import { reportErrors, reportRequestSchema, reportResultSchema } from "../../../../../lib/cafeteria/reports";
import { supportRequestSchema } from "../../../../../lib/platform/customer-operations";
import { supportJson, supportReader, supportRpcFailure } from "../../../../../lib/platform/support-read-route";

// Backoffice Customer Management: read-only cafeteria reports (sales, top products, reconciliation).
const schema = supportRequestSchema(reportRequestSchema);
export async function POST(request: Request) {
  const auth = await supportReader(request);
  if ("response" in auth) return auth.response;
  let parsed;
  try { parsed = schema.safeParse(await request.json()); } catch { return supportJson({ error: "invalid_payload" }, 400); }
  if (!parsed.success) return supportJson({ error: "invalid_payload" }, 400);
  const { account_id, request: op } = parsed.data;
  try {
    const { data, error } = await auth.client.rpc("platform_support_cafeteria_report_read", { p_account_id: account_id, p_cafeteria_id: op.cafeteria_id, p_kind: op.kind, p_period: op.period, p_from: op.from, p_to: op.to });
    if (error) return supportRpcFailure(error, reportErrors);
    const result = reportResultSchema[op.kind].safeParse(data);
    if (!result.success || result.data.cafeteria_id !== op.cafeteria_id || result.data.kind !== op.kind || result.data.period !== op.period) return supportJson({ error: "invalid_response" }, 502);
    return supportJson({ result: result.data });
  } catch { return supportJson({ error: "support_read_unavailable" }, 503); }
}
