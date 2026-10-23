import { requirePlatform,readPlatform } from '../../../lib/platform/customer-console';
import { TEAM_CAPABILITY,teamReadSchema } from '../../../lib/platform/team-contracts';
import { TeamWorkspace } from './team-workspace';
import { ErrorState, LoadFailure } from '../../../components/state-panels';
export default async function TeamPage() {
 const session=await requirePlatform();
 const result=await readPlatform(session,TEAM_CAPABILITY,'platform_team_activation_read',{},teamReadSchema);
 // UX 14 (audit A-3): no authority is not a temporary failure. Only a failed read offers Reintentar.
 if(result.kind!=='ready')return result.kind==='forbidden'?<ErrorState kind="permission" title="No tienes acceso al equipo de PIKAS." description="Lo administran los administradores de la plataforma; pide el acceso si lo necesitas."/>
  :result.kind==='missing'?<ErrorState kind="not_found" title="No encontramos el equipo de PIKAS."/>
  :<LoadFailure what="el equipo" invalidResponse={result.reason==='invalid_response'} retryHref="/platform/equipo"/>;
 return <TeamWorkspace key={result.value.actor_handle} data={result.value}/>;
}
