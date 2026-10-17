import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { accessSchema, type WalletAccess } from './contracts';
// Server-derived wallet capability; any failure is treated as no access.
export async function readSchoolWalletAccess(client: Pick<SupabaseClient,'rpc'>, schoolId: string): Promise<WalletAccess> {
  const denied = { school_id: schoolId, read: false, replenish: false, reverse: false, adjust: false };
  try {
    const { data, error } = await client.rpc('school_wallet_access', { p_school_id: schoolId });
    const parsed = accessSchema.safeParse(data);
    return error || !parsed.success || parsed.data.school_id !== schoolId ? denied : { ...parsed.data, replenish: parsed.data.read && parsed.data.replenish, reverse: parsed.data.read && parsed.data.reverse, adjust: parsed.data.read && parsed.data.adjust };
  } catch { return denied; }
}
