import { AppPageHeader } from '../../../../../../components/app-page-header';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '../../../../../../lib/supabase/server';
import { resolveSchoolAccess } from '../../../../../../lib/auth/school-access';
import { readSchoolWalletAccess } from '../../../../../../lib/wallet/access';
import { ConnectedSchoolShell } from '../../../../../../components/connected-school-shell';
import { StudentWallet } from '../../../../../../components/student-wallet';
export default async function Page({params,searchParams}:{params:Promise<{studentId:string}>;searchParams:Promise<{school?:string}>}) {
 const client=await createSupabaseServerClient();const access=await resolveSchoolAccess(client);
 if(access.status!=='authorized')redirect('/login?error=school_authority');
 const {studentId}=await params;const {school}=await searchParams;
 if(!z.guid().safeParse(studentId).success||!school||!access.context.schools.some(s=>s.school_id===school))redirect('/admin/escuela/estudiantes');
 const wallet=access.context.pov?null:await readSchoolWalletAccess(client,school);
 return <ConnectedSchoolShell context={access.context} schoolId={school}><AppPageHeader back={{ href: `/admin/escuela/estudiantes?school=${school}`, label: "Estudiantes" }} title="PIKAS Cash" />{access.context.pov?<p className="card p-5" role="status">Las operaciones financieras no están habilitadas en este punto de vista de sandbox.</p>:!wallet?.read?<p role="alert">Tu rol no tiene acceso a PIKAS Cash en esta escuela.</p>:<StudentWallet key={`${school}:${studentId}`} schoolId={school} studentId={studentId} actorId={access.context.person_id} canReplenish={wallet.replenish} canReverse={wallet.reverse} canAdjust={wallet.adjust}/>}</ConnectedSchoolShell>;
}
