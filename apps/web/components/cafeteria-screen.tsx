import 'server-only';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../lib/supabase/server';
import { resolveCafeteriaAccess } from '../lib/auth/cafeteria-access';
import { readSchema } from '../lib/cafeteria/contracts';
import { ConnectedCafeteriaShell } from './connected-cafeteria-shell';
import { ConnectedCafeteriaProvider } from './connected-cafeteria-provider';
import { ConnectedCafeteriaPages, type CafeteriaSection } from './connected-cafeteria-pages';
export type CafeteriaSearchParams=Promise<Record<string,string|string[]|undefined>>;
export async function CafeteriaScreen({section,searchParams}:{section:CafeteriaSection;searchParams:CafeteriaSearchParams}) {
 const client=await createSupabaseServerClient(),access=await resolveCafeteriaAccess(client);
 if(access.status==='unauthenticated')redirect('/login?next=%2Fadmin%2Fcafeteria');
 if(access.status!=='authorized')redirect('/login?error=cafeteria_authority');
 const params=await searchParams,cafeteriaId=params.cafeteria??access.context.cafeterias[0].cafeteria_id;
 if(typeof cafeteriaId!=='string'||!access.context.cafeterias.some(c=>c.cafeteria_id===cafeteriaId))redirect('/login?error=cafeteria_authority');
 const {data,error}=await client.rpc('cafeteria_admin_read',{p_cafeteria_id:cafeteriaId});const parsed=readSchema.safeParse(data);
 if(error||!parsed.success||parsed.data.scope.cafeteria_id!==cafeteriaId||parsed.data.scope.actor_id!==access.context.person_id)return <ConnectedCafeteriaShell context={access.context} cafeteriaId={cafeteriaId}><p role="alert" className="card p-5">No se pudo cargar la información con tus permisos actuales. Recarga para reintentar.</p></ConnectedCafeteriaShell>;
 return <ConnectedCafeteriaShell context={access.context} cafeteriaId={cafeteriaId}><ConnectedCafeteriaProvider key={`${access.context.person_id}:${cafeteriaId}`} data={parsed.data}><ConnectedCafeteriaPages key={section} section={section} data={parsed.data}/></ConnectedCafeteriaProvider></ConnectedCafeteriaShell>;
}
