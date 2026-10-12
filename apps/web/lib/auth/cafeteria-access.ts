import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contextSchema, type CafeteriaContext } from '../cafeteria/contracts';
export type CafeteriaAccess = { status:'authorized'; context:CafeteriaContext } | { status:'unauthenticated'|'forbidden'|'unavailable' };
export async function resolveCafeteriaAccess(client: Pick<SupabaseClient,'auth'|'rpc'>): Promise<CafeteriaAccess> {
 try {
  const {data:{user},error} = await client.auth.getUser();
  if (error) return {status:error.name === 'AuthSessionMissingError' ? 'unauthenticated':'unavailable'};
  if (!user) return {status:'unauthenticated'};
  const response = await client.rpc('get_cafeteria_admin_context');
  if (response.error) return {status:response.error.code === '42501' ? 'forbidden':'unavailable'};
  if (response.data === null) return {status:'forbidden'};
  const parsed = contextSchema.safeParse(response.data);
  if (!parsed.success) return {status:'unavailable'};
  if (parsed.data.pov && (parsed.data.pov.pov_code !== 'cafeteria_admin' || Date.parse(parsed.data.pov.expires_at) <= Date.now() || parsed.data.cafeterias.length !== 1 || parsed.data.cafeterias[0].tenant_kind !== 'sandbox')) return {status:'forbidden'};
  return parsed.data.cafeterias.length ? {status:'authorized',context:parsed.data}:{status:'forbidden'};
 } catch { return {status:'unavailable'}; }
}
