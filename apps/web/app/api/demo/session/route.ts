import {cookies} from 'next/headers';
import {isDemoMode} from '@/lib/env';
export async function GET(){
  if(!isDemoMode())return Response.json({role:null},{status:403});
  const jar=await cookies(), base=jar.get('pikas_demo_role')?.value;
  const role=base==='admin'?jar.get('pikas_demo_admin_role')?.value:base==='pos'?'pos_operator':base;
  return Response.json({role:role??null},{headers:{'Cache-Control':'no-store'}});
}
