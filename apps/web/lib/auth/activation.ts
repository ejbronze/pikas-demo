import 'server-only';
import { createHash,createHmac,randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicConfig } from '../supabase/config';
import { z } from 'zod';

// Exactly 32 cryptographically random bytes, independent of Auth/email/intent IDs.
export const activationToken = z.string().regex(/^[0-9a-f]{64}$/);
export const newActivationToken = () => randomBytes(32).toString('hex');
export const passwordFingerprint = (password:string,ownerKey:string) => createHmac('sha256',ownerKey).update(password).digest('hex');
export const providerContext = z.object({email:z.email(),owner_key:z.string().regex(/^[0-9a-f]{64}$/),auth_id:z.uuid().nullable(),ready:z.boolean()}).strict();
export const activationHandle = z.string().regex(/^[0-9a-f]{32}$/);
export const digestActivation = (token: string) => createHash('sha256').update(token).digest('hex');
export function activationOrigin() {
 const configured = process.env.PIKAS_APP_ORIGIN;
 if (!configured) throw Error('activation_configuration_required');
 const url = new URL(configured);
 if (url.protocol !== 'https:' || url.origin !== configured) throw Error('activation_configuration_required');
 return url.origin;
}
export function isolatedAuth() {
 const {url,anonKey} = getSupabasePublicConfig();
 return createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export function invitationProvider() {
 const {url} = getSupabasePublicConfig();
 const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
 if (!key) throw Error('activation_configuration_required');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export async function inspectOwnedIdentity(provider:ReturnType<typeof invitationProvider>,context:z.infer<typeof providerContext>) {
 if(!context.auth_id) throw Error('activation_identity_unavailable');
 const result=await provider.auth.admin.getUserById(context.auth_id);
 const user=result.data.user;
 if(result.error||!user||user.id!==context.auth_id||user.email?.trim().toLowerCase()!==context.email
  ||user.app_metadata.pikas_activation_owner!==context.owner_key||user.is_anonymous) throw Error('activation_identity_unavailable');
 return user;
}
export function sameOrigin(request: Request) {
 try { return new URL(request.headers.get('origin') ?? '').origin === new URL(request.url).origin; }
 catch { return false; }
}
