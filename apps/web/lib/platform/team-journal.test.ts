import { beforeEach,describe,expect,it,vi } from 'vitest';
import { prepareTeam,restoreTeam,confirmTeam,teamJournalKey } from './team-journal';
import { teamCommandSchema,teamReadSchema,type TeamCommand } from './team-contracts';
const command:TeamCommand={operation:'prepare',payload:{name:'Operator',email:'operator@example.invalid',demo:true}};
const key=teamJournalKey('a'.repeat(32));
let values:Map<string,string>;
const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
beforeEach(()=>{values=new Map();});
describe('team exact request recovery',()=>{
 it.each(['authorization','conflict','unavailable','400','401','403','422'])('preserves original request after unsuccessful recovery %s',async reason=>{
  const pending=prepareTeam(storage,key,command),saved=values.get(key);
  const fail=vi.fn().mockRejectedValue(Error(reason));await expect(confirmTeam(storage,key,pending,fail)).rejects.toThrow();
  expect(values.get(key)).toBe(saved);expect(restoreTeam(storage,key)).toEqual(pending);
  expect(prepareTeam(storage,key,{operation:'demo',payload:{handle:'b'.repeat(32),enabled:false}})).toEqual(pending);
  const success=vi.fn().mockResolvedValue({result:{request_id:pending.key,operation:'prepare',status:'confirmed'}});
  await confirmTeam(storage,key,restoreTeam(storage,key)!,success);expect(values.size).toBe(0);expect(success.mock.calls[0][1]).toBe(pending.key);expect(success.mock.calls[0][2]).toEqual(command);
 });
 it('keeps the journal for wrong request or operation',async()=>{const pending=prepareTeam(storage,key,command);await expect(confirmTeam(storage,key,pending,vi.fn().mockResolvedValue({result:{request_id:crypto.randomUUID(),operation:'prepare',status:'confirmed'}}))).rejects.toThrow();expect(values.size).toBe(1);});
 it('corrupt journal blocks preparation',()=>{values.set(key,'malformed');expect(()=>prepareTeam(storage,key,command)).toThrow();expect(values.get(key)).toBe('malformed');});
 it('does not journal invalid input',()=>{expect(()=>prepareTeam(storage,key,{...command,payload:{name:'',email:'x',demo:true}})).toThrow();expect(values.size).toBe(0);});
 it('rejects arbitrary identity fields and unsupported authority',()=>{expect(teamCommandSchema.safeParse({operation:'complete',payload:{handle:'b'.repeat(32),authUserId:crypto.randomUUID()}}).success).toBe(false);expect(teamCommandSchema.safeParse({operation:'deactivate',payload:{handle:'b'.repeat(32)}}).success).toBe(false);});
 it('strict read projection rejects Auth/security metadata',()=>{expect(teamReadSchema.safeParse({actor_handle:'a'.repeat(32),operators:[],prepared:[],auth_user_id:crypto.randomUUID()}).success).toBe(false);});
});
