import { redirectDemoDenial } from "../lib/platform/demo-recovery";
import 'server-only';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../lib/supabase/server';
import { resolveCafeteriaAccess } from '../lib/auth/cafeteria-access';
import { readSchema } from '../lib/cafeteria/contracts';
import { ConnectedCafeteriaShell } from './connected-cafeteria-shell';
import { ConnectedCafeteriaProvider } from './connected-cafeteria-provider';
import { ConnectedCafeteriaPages, type CafeteriaSection } from './connected-cafeteria-pages';
import { ErrorState } from './state-panels';
const sectionPath: Record<CafeteriaSection, string> = { summary: '', products: '/productos', menus: '/menus', shifts: '/menus/turnos', staff: '/personal', registers: '/cajas', settings: '/configuracion', transactions: '/transacciones', schools: '/escuelas', reports: '/reportes' };
export type CafeteriaSearchParams=Promise<Record<string,string|string[]|undefined>>;
export async function CafeteriaScreen({section,searchParams}:{section:CafeteriaSection;searchParams:CafeteriaSearchParams}) {
 const client=await createSupabaseServerClient(),access=await resolveCafeteriaAccess(client);
 if(access.status==='unauthenticated')redirect('/login?next=%2Fadmin%2Fcafeteria');
 if(access.status!=='authorized')return redirectDemoDenial(client, '/login?error=cafeteria_authority');
 const params=await searchParams,cafeteriaId=params.cafeteria??access.context.cafeterias[0].cafeteria_id;
 if(typeof cafeteriaId!=='string'||!access.context.cafeterias.some(c=>c.cafeteria_id===cafeteriaId))return redirectDemoDenial(client, '/login?error=cafeteria_authority');
 const {data,error}=await client.rpc('cafeteria_admin_read',{p_cafeteria_id:cafeteriaId});const parsed=readSchema.safeParse(data);
 if(error||!parsed.success||parsed.data.scope.cafeteria_id!==cafeteriaId||parsed.data.scope.actor_id!==access.context.person_id)return <ConnectedCafeteriaShell context={access.context} cafeteriaId={cafeteriaId}><ErrorState title="No pudimos cargar esta sección." description="Puede ser un problema temporal o un cambio en tus permisos." retryHref={`/admin/cafeteria${sectionPath[section]}?cafeteria=${cafeteriaId}`} /></ConnectedCafeteriaShell>;
 const scope=parsed.data.scope;
 return <ConnectedCafeteriaShell context={access.context} cafeteriaId={cafeteriaId} walletNav={scope.tenant_kind==='customer'&&scope.capabilities.includes('cafeteria:wallets:read')} reportsNav={scope.tenant_kind==='customer'&&scope.capabilities.includes('cafeteria:pos:purchases:read')}><ConnectedCafeteriaProvider key={`${access.context.pov?.operator_person_id ?? access.context.person_id}:${access.context.person_id}:${cafeteriaId}`} recoveryActorId={access.context.pov ? `${access.context.pov.operator_person_id}:${access.context.person_id}` : undefined} data={parsed.data}><ConnectedCafeteriaPages key={section} section={section} data={parsed.data}/></ConnectedCafeteriaProvider></ConnectedCafeteriaShell>;
}
