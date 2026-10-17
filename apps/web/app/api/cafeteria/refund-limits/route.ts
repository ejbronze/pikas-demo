import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveCafeteriaAccess } from '../../../../lib/auth/cafeteria-access';
import { limitsRequestSchema, limitsSchema } from '../../../../lib/pos/refunds';
// Cashier refund limits (daily event count + amount); the database enforces Admin/Supervisor authority.
export async function POST(request: Request) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'same_origin_required' }, 403);
  let parsed;
  try { parsed = limitsRequestSchema.safeParse(await request.json()); } catch { return json({ error: 'invalid_payload' }, 400); }
  if (!parsed.success) return json({ error: 'invalid_payload' }, 400);
  const op = parsed.data;
  try {
    const client = await createSupabaseServerClient(), access = await resolveCafeteriaAccess(client);
    if (access.status !== 'authorized') return json({ error: 'cafeteria_authority_required' }, access.status === 'unauthenticated' ? 401 : access.status === 'unavailable' ? 503 : 403);
    if (access.context.pov || !access.context.cafeterias.some(c => c.cafeteria_id === op.cafeteria_id)) return json({ error: 'cafeteria_authority_required' }, 403);
    const { data, error } = op.operation === 'read'
      ? await client.rpc('get_cashier_refund_limits', { p_cafeteria_id: op.cafeteria_id })
      : await client.rpc('configure_cashier_refund_limits', { p_cafeteria_id: op.cafeteria_id, p_expected_version: op.expected_version,
        p_count_limit: op.count_limit, p_amount_limit_minor: op.amount_limit_minor });
    if (error) return json({ error: error.code === '42501' ? 'cafeteria_authority_required' : error.message === 'POLICY_VERSION_CONFLICT' ? 'POLICY_VERSION_CONFLICT' : 'operation_unconfirmed' },
      error.code === '42501' ? 403 : error.message === 'POLICY_VERSION_CONFLICT' ? 409 : 502);
    const result = limitsSchema.safeParse(data);
    if (!result.success || result.data.cafeteria_id !== op.cafeteria_id) return json({ error: 'invalid_response' }, 502);
    return json({ result: result.data });
  } catch { return json({ error: 'operation_unconfirmed' }, 503); }
}
