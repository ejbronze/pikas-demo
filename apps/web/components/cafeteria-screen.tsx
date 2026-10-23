import Link from "next/link";
import { redirectDemoDenial } from "../lib/platform/demo-recovery";
import 'server-only';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../lib/supabase/server';
import { resolveCafeteriaAccess } from '../lib/auth/cafeteria-access';
import { readSchema } from '../lib/cafeteria/contracts';
import { ConnectedCafeteriaShell } from './connected-cafeteria-shell';
import { ConnectedCafeteriaProvider } from './connected-cafeteria-provider';
import { ConnectedCafeteriaPages, type CafeteriaSection } from './connected-cafeteria-pages';
import { ErrorState, LoadFailure } from "./state-panels";
import { classifyError } from "../lib/ux/state-classes";
const sectionPath: Record<CafeteriaSection, string> = { summary: '', products: '/productos', menus: '/menus', shifts: '/menus/turnos', staff: '/personal', registers: '/cajas', settings: '/configuracion', transactions: '/transacciones', schools: '/escuelas', reports: '/reportes' };
export type CafeteriaSearchParams=Promise<Record<string,string|string[]|undefined>>;
export async function CafeteriaScreen({section,searchParams}:{section:CafeteriaSection;searchParams:CafeteriaSearchParams}) {
 const client=await createSupabaseServerClient(),access=await resolveCafeteriaAccess(client);
 if(access.status==='unauthenticated')redirect('/login?next=%2Fadmin%2Fcafeteria');
 if(access.status!=='authorized')return redirectDemoDenial(client, '/login?error=cafeteria_authority');
 const params=await searchParams,cafeteriaId=params.cafeteria??access.context.cafeterias[0].cafeteria_id;
 if(typeof cafeteriaId!=='string'||!access.context.cafeterias.some(c=>c.cafeteria_id===cafeteriaId))return redirectDemoDenial(client, '/login?error=cafeteria_authority');
 const {data,error}=await client.rpc('cafeteria_admin_read',{p_cafeteria_id:cafeteriaId});const parsed=readSchema.safeParse(data);
 // UX 14: the read's own answer decides the state (permission / not found / unreadable response / failed call).
 if(error||!parsed.success||parsed.data.scope.cafeteria_id!==cafeteriaId||parsed.data.scope.actor_id!==access.context.person_id){
  const kind=error?classifyError(error):'temporary', href=`/admin/cafeteria${sectionPath[section]}?cafeteria=${cafeteriaId}`;
  return <ConnectedCafeteriaShell context={access.context} cafeteriaId={cafeteriaId}>{kind==='permission'
   ?<ErrorState kind="permission" title="Ya no tienes acceso a esta sección de la cafetería." description="Tu rol o tu acceso cambiaron después de entrar. Vuelve a iniciar sesión; si el problema continúa, pídelo al administrador de la cuenta." action={<Link className="btn-secondary" href="/login?next=%2Fadmin%2Fcafeteria">Volver a iniciar sesión</Link>}/>
   :kind==='not_found'?<ErrorState kind="not_found" title="No encontramos esta cafetería." description="Puede haber sido desactivada o la dirección ya no es válida." action={<Link className="btn-secondary" href="/admin/cafeteria">Ir a mi cafetería</Link>}/>
   :<LoadFailure kind={kind} what="esta sección" invalidResponse={!error} retryHref={href}/>}</ConnectedCafeteriaShell>;
 }
 const scope=parsed.data.scope;
 return <ConnectedCafeteriaShell context={access.context} cafeteriaId={cafeteriaId} walletNav={scope.tenant_kind==='customer'&&scope.capabilities.includes('cafeteria:wallets:read')} reportsNav={scope.capabilities.includes('cafeteria:pos:purchases:read')}><ConnectedCafeteriaProvider key={`${access.context.pov?.operator_person_id ?? access.context.person_id}:${access.context.person_id}:${cafeteriaId}`} recoveryActorId={access.context.pov ? `${access.context.pov.operator_person_id}:${access.context.person_id}` : undefined} data={parsed.data}><ConnectedCafeteriaPages key={section} section={section} data={parsed.data}/></ConnectedCafeteriaProvider></ConnectedCafeteriaShell>;
}
