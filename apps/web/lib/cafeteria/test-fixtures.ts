import type { CafeteriaRead } from './contracts';
export const id='4d300000-0000-4000-8000-000000000001';
export function cafeteriaRead():CafeteriaRead {return {
 scope:{actor_id:id,membership_id:id,cafeteria_id:id,cafeteria_name:'Real cafeteria',account_id:id,account_name:'Real account',school_name:'Real school',location_name:'Real campus',tenant_kind:'customer',capabilities:['cafeteria:catalog:manage']},
 settings:{currency:'DOP',scheduling_enabled:false,version:1},categories:[],products:[],menus:[],shifts:[],registers:[],staff:[],assignments:[],invitations:[],service:null,
};}
