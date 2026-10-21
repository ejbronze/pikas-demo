import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveCafeteriaAccess } from '../../../../lib/auth/cafeteria-access';
import { todayRequestSchema, todaySchema } from '../../../../lib/cafeteria/today';
// Cafetería Hoy V1 read (hourly shape, same-time baseline, last sale). Authority and every value come from cafeteria_today_read.
export async function POST(request: Request) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'same_origin_required' }, 403);
  let parsed;
  try { parsed = todayRequestSchema.safeParse(await request.json()); } catch { return json({ error: 'invalid_payload' }, 400); }
  if (!parsed.success) return json({ error: 'invalid_payload' }, 400);
  const cafeteriaId = parsed.data.cafeteria_id;
  try {
    const client = await createSupabaseServerClient(), access = await resolveCafeteriaAccess(client);
    if (access.status !== 'authorized') return json({ error: 'cafeteria_authority_required' }, access.status === 'unauthenticated' ? 401 : access.status === 'unavailable' ? 503 : 403);
    if (!access.context.cafeterias.some(c => c.cafeteria_id === cafeteriaId)) return json({ error: 'cafeteria_authority_required' }, 403);
    const { data, error } = await client.rpc('cafeteria_today_read', { p_cafeteria_id: cafeteriaId });
    if (error) return error.code === '42501' ? json({ error: 'cafeteria_authority_required' }, 403) : json({ error: 'today_unavailable' }, 502);
    const result = todaySchema.safeParse(data);
    if (!result.success || result.data.cafeteria_id !== cafeteriaId) return json({ error: 'invalid_response' }, 502);
    return json({ result: result.data });
  } catch { return json({ error: 'today_unavailable' }, 503); }
}
