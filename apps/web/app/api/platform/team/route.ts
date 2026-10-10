import { createPlatformRpcPostHandler } from '../../../../lib/auth/platform-rpc-route';
import { TEAM_CAPABILITY,teamCommandSchema,teamResultSchema } from '../../../../lib/platform/team-contracts';
export const POST = createPlatformRpcPostHandler({capability:TEAM_CAPABILITY,schema:teamCommandSchema,resultSchema:teamResultSchema,
 invoke:(client,command,key)=>client.rpc('platform_team_command',{p_request_id:key,p_operation:command.operation,p_payload:command.payload}),
});
