import { requirePlatform,readPlatform } from '../../../lib/platform/customer-console';
import { TEAM_CAPABILITY,teamReadSchema } from '../../../lib/platform/team-contracts';
import { TeamWorkspace } from './team-workspace';
export default async function TeamPage() {
 const session=await requirePlatform();
 const result=await readPlatform(session,TEAM_CAPABILITY,'platform_team_read',{},teamReadSchema);
 if(result.kind!=='ready')return <p role="alert" className="card p-5">{result.kind==='forbidden'?'No tienes permiso para administrar el equipo de PIKAS.':'No se pudo cargar el equipo. Recarga para reintentar.'}</p>;
 return <TeamWorkspace key={result.value.actor_handle} data={result.value}/>;
}
