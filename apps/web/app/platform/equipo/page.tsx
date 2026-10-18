import { requirePlatform,readPlatform } from '../../../lib/platform/customer-console';
import { TEAM_CAPABILITY,teamReadSchema } from '../../../lib/platform/team-contracts';
import { TeamWorkspace } from './team-workspace';
import { ErrorState } from '../../../components/state-panels';
export default async function TeamPage() {
 const session=await requirePlatform();
 const result=await readPlatform(session,TEAM_CAPABILITY,'platform_team_activation_read',{},teamReadSchema);
 if(result.kind!=='ready')return result.kind==='forbidden'?<ErrorState title="No tienes permiso para administrar el equipo de PIKAS."/>:<ErrorState title="No se pudo cargar el equipo." description="Puede ser un problema temporal. Vuelve a intentarlo." retryHref="/platform/equipo"/>;
 return <TeamWorkspace key={result.value.actor_handle} data={result.value}/>;
}
