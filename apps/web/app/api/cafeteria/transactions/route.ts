import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveCafeteriaAccess } from '../../../../lib/auth/cafeteria-access';
import { detailResultSchema, transactionsErrors, transactionsOperationSchema, transactionsResultSchema } from '../../../../lib/cafeteria/transactions';
// Phase 5D.4 Transacciones lookup. Read-only; filters, pagination, refund state and authority come from the database.
export async function POST(request: Request) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'same_origin_required' }, 403);
  let parsed;
  try { parsed = transactionsOperationSchema.safeParse(await request.json()); } catch { return json({ error: 'invalid_payload' }, 400); }
  if (!parsed.success) return json({ error: 'invalid_payload' }, 400);
  const op = parsed.data;
  try {
    const client = await createSupabaseServerClient(), access = await resolveCafeteriaAccess(client);
    if (access.status !== 'authorized') return json({ error: 'cafeteria_authority_required' }, access.status === 'unauthenticated' ? 401 : access.status === 'unavailable' ? 503 : 403);
    if (!access.context.cafeterias.some(c => c.cafeteria_id === op.cafeteria_id)) return json({ error: 'cafeteria_authority_required' }, 403);
    const { data, error } = op.operation === 'list'
      ? await client.rpc('cafeteria_transactions_read', { p_cafeteria_id: op.cafeteria_id, p_period: op.period, p_from: op.from, p_to: op.to,
        p_tender: op.tender, p_refund_status: op.refund_status, p_receipt: op.receipt, p_offset: op.offset })
      : await client.rpc('cafeteria_transaction_detail', { p_cafeteria_id: op.cafeteria_id, p_purchase_id: op.purchase_id });
    if (error) {
      if (error.code === '42501') return json({ error: 'cafeteria_authority_required' }, 403);
      if (error.code === '22023' && error.message in transactionsErrors) return json({ error: error.message }, 422);
      return json({ error: 'transactions_unavailable' }, 502);
    }
    if (op.operation === 'list') {
      const result = transactionsResultSchema.safeParse(data);
      if (!result.success || result.data.cafeteria_id !== op.cafeteria_id || result.data.period !== op.period || result.data.tender !== op.tender
        || result.data.refund_status !== op.refund_status || result.data.receipt !== op.receipt || result.data.offset !== op.offset) return json({ error: 'invalid_response' }, 502);
      return json({ result: result.data });
    }
    const result = detailResultSchema.safeParse(data);
    if (!result.success || result.data.cafeteria_id !== op.cafeteria_id || result.data.data.id !== op.purchase_id) return json({ error: 'invalid_response' }, 502);
    return json({ result: result.data });
  } catch { return json({ error: 'transactions_unavailable' }, 503); }
}
