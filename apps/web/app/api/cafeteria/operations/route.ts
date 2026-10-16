import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveCafeteriaAccess } from '../../../../lib/auth/cafeteria-access';
import { historyRequestSchema, readResultSchema, closeResultSchema } from '../../../../lib/cafeteria/operations';
export async function POST(request: Request) {
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.headers.get('origin') !== new URL(request.url).origin)
        return json({ error: 'same_origin_required' }, 403);
    let parsed;
    try {
        parsed = historyRequestSchema.safeParse(await request.json());
    }
    catch {
        return json({ error: 'invalid_payload' }, 400);
    }
    if (!parsed.success)
        return json({ error: 'invalid_payload' }, 400);
    const op = parsed.data;
    if (op.operation === 'close' && request.headers.get('Idempotency-Key') !== op.request_key)
        return json({ error: 'invalid_request_key' }, 400);
    try {
        const client = await createSupabaseServerClient(), access = await resolveCafeteriaAccess(client);
        if (access.status !== 'authorized')
            return json({ error: 'cafeteria_authority_required' }, access.status === 'unauthenticated' ? 401 : access.status === 'unavailable' ? 503 : 403);
        if (!access.context.cafeterias.some(c => c.cafeteria_id === op.cafeteria_id))
            return json({ error: 'cafeteria_authority_required' }, 403);
        const { data, error } = await client.rpc(op.operation === 'read' ? 'cafeteria_operations_read' : 'cafeteria_operations_close', op.operation === 'read' ? { p_cafeteria_id: op.cafeteria_id, p_kind: op.kind, p_offset: op.offset, p_target_id: op.target_id } : { p_cafeteria_id: op.cafeteria_id, p_session_id: op.session_id, p_version: op.version, p_counted_minor: op.counted_minor, p_reason: op.reason, p_note: op.note, p_request_key: op.request_key, p_expected_minor: op.expected_minor });
        if (error) {
            const definite = ['stale_expected_cash', 'stale_register_session_version', 'register_session_already_closed', 'invalid_counted_cash', 'invalid_exceptional_close_reason', 'exceptional_close_note_required_or_too_long'].includes(error.message);
            return json({ error: error.code === '42501' ? 'cafeteria_authority_required' : 'operation_unconfirmed', definite }, error.code === '42501' ? 403 : 409);
        }
        const result = (op.operation === 'read' ? readResultSchema(op.kind) : closeResultSchema).safeParse(data);
        if (!result.success)
            return json({ error: 'invalid_response' }, 502);
        if (op.operation === 'close') {
            const closed = closeResultSchema.parse(result.data);
            if (closed.request_key !== op.request_key || closed.session.id !== op.session_id || closed.session.status !== 'closed')
                return json({ error: 'invalid_response' }, 502);
        }
        else if ('cafeteria_id' in result.data && result.data.cafeteria_id !== op.cafeteria_id)
            return json({ error: 'invalid_response' }, 502);
        return json({ result: result.data });
    }
    catch {
        return json({ error: 'operation_unconfirmed' }, 503);
    }
}
