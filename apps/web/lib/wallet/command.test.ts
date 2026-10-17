import { describe,it,expect,vi } from 'vitest';
import { load,prepare,send } from './command';
import { creditSchema } from './contracts';
const id='5b000000-0000-4000-8000-000000000001';
const command={operation:'replenish' as const,school_id:id,student_id:id,amount_minor:'2500',reference:'Fondos verificados',note:'',request_key:id};
function storage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}};}
describe('wallet financial request identity',()=>{
 it.each(['0','-1','1.5','abc','9223372036854775808'])('rejects invalid money %s without unsafe conversion',amount=>{expect(creditSchema.safeParse({...command,amount_minor:amount}).success).toBe(false);});
 it('requires evidence and rejects client balance/actor',()=>{expect(creditSchema.safeParse({...command,reference:''}).success).toBe(false);expect(creditSchema.safeParse({...command,balance_minor:'9999'}).success).toBe(false);});
 it('persists before transport and reuses original immutable payload',()=>{const s=storage();expect(prepare(s,'k',command)).toEqual(command);expect(prepare(s,'k',{...command,amount_minor:'5000'})).toEqual(command);expect(load(s,'k')).toEqual(command);});
 it('blocks corrupt storage',()=>{expect(()=>load({getItem:()=>'{bad'},'k')).toThrow();});
 it('does not send when persistence fails',()=>{expect(()=>prepare({getItem:()=>null,setItem:()=>{throw Error();}},'k',command)).toThrow();});
 it('lost success retains identity for exact recovery',async()=>{const s=storage();prepare(s,'k',command);const fetcher=vi.fn().mockRejectedValueOnce(Error('lost')).mockResolvedValueOnce(Response.json({result:{...command,wallet_id:id,replenishment_id:id,balance_after_minor:'2500',version:'1'}}));expect((await send(command,fetcher)).outcome).toBe('uncertain');expect((await send(load(s,'k')!,fetcher)).outcome).toBe('success');expect(fetcher.mock.calls[0][1]).toEqual(fetcher.mock.calls[1][1]);});
 it.each([401,403,422,502])('a non-success recovery does not clear journal %s',async status=>{const s=storage();prepare(s,'k',command);await send(command,vi.fn().mockResolvedValue(Response.json({error:'denied'},{status})));expect(load(s,'k')).toEqual(command);});
 it('does not confirm mismatched success',async()=>{expect((await send(command,vi.fn().mockResolvedValue(Response.json({result:{...command,student_id:'5b000000-0000-4000-8000-000000000002',wallet_id:id,replenishment_id:id,balance_after_minor:'2500',version:'1'}})))).outcome).toBe('uncertain');});
});
