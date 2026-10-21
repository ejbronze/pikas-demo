import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveSchoolAccess } from '../../../../lib/auth/school-access';
import { reportErrors } from '../../../../lib/cafeteria/reports';
import { walletReportRequestSchema, walletReportSchema } from '../../../../lib/school/wallet-report';
// Phase 5D.5 read-only School PIKAS Cash report. Authority and every total come from school_wallet_report.
// UX 7: the per-cafetería breakdown is validated but never sent to the School browser.
export async function POST(request: Request) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'same_origin_required' }, 403);
  let parsed;
  try { parsed = walletReportRequestSchema.safeParse(await request.json()); } catch { return json({ error: 'invalid_payload' }, 400); }
  if (!parsed.success) return json({ error: 'invalid_payload' }, 400);
  const op = parsed.data;
  try {
    const client = await createSupabaseServerClient(), access = await resolveSchoolAccess(client);
    if (access.status !== 'authorized') return json({ error: 'school_authority_required' }, access.status === 'unauthenticated' ? 401 : access.status === 'unavailable' ? 503 : 403);
    if (access.context.pov || !access.context.schools.some(s => s.school_id === op.school_id)) return json({ error: 'school_authority_required' }, 403);
    const { data, error } = await client.rpc('school_wallet_report', { p_school_id: op.school_id, p_period: op.period, p_from: op.from, p_to: op.to });
    if (error) {
      if (error.code === '42501') return json({ error: 'school_authority_required' }, 403);
      if (error.code === '22023' && error.message in reportErrors) return json({ error: error.message }, 422);
      return json({ error: 'report_unavailable' }, 502);
    }
    const result = walletReportSchema.safeParse(data);
    if (!result.success || result.data.school_id !== op.school_id || result.data.period !== op.period) return json({ error: 'invalid_response' }, 502);
    const { cafeterias, ...report } = result.data; void cafeterias;
    return json({ result: report });
  } catch { return json({ error: 'report_unavailable' }, 503); }
}
