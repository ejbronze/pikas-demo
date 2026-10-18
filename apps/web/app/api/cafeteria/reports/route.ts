import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveCafeteriaAccess } from '../../../../lib/auth/cafeteria-access';
import { reportErrors, reportRequestSchema, reportResultSchema } from '../../../../lib/cafeteria/reports';
// Phase 5D read-only reports (sales_summary, top_products). Authority and all totals come from cafeteria_report_read.
export async function POST(request: Request) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'same_origin_required' }, 403);
  let parsed;
  try { parsed = reportRequestSchema.safeParse(await request.json()); } catch { return json({ error: 'invalid_payload' }, 400); }
  if (!parsed.success) return json({ error: 'invalid_payload' }, 400);
  const op = parsed.data;
  try {
    const client = await createSupabaseServerClient(), access = await resolveCafeteriaAccess(client);
    if (access.status !== 'authorized') return json({ error: 'cafeteria_authority_required' }, access.status === 'unauthenticated' ? 401 : access.status === 'unavailable' ? 503 : 403);
    if (!access.context.cafeterias.some(c => c.cafeteria_id === op.cafeteria_id)) return json({ error: 'cafeteria_authority_required' }, 403);
    const { data, error } = await client.rpc('cafeteria_report_read', { p_cafeteria_id: op.cafeteria_id, p_kind: op.kind, p_period: op.period, p_from: op.from, p_to: op.to });
    if (error) {
      if (error.code === '42501') return json({ error: 'cafeteria_authority_required' }, 403);
      if (error.code === '22023' && error.message in reportErrors) return json({ error: error.message }, 422);
      return json({ error: 'report_unavailable' }, 502);
    }
    const result = reportResultSchema[op.kind].safeParse(data);
    if (!result.success || result.data.cafeteria_id !== op.cafeteria_id || result.data.kind !== op.kind || result.data.period !== op.period) return json({ error: 'invalid_response' }, 502);
    return json({ result: result.data });
  } catch { return json({ error: 'report_unavailable' }, 503); }
}
