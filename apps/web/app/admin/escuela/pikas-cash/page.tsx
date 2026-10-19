import { redirect } from 'next/navigation';
import { isDemoMode } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveSchoolAccess } from '@/lib/auth/school-access';
import { readSchoolWalletAccess } from '@/lib/wallet/access';
import { ConnectedSchoolShell } from '@/components/connected-school-shell';
import { SchoolWalletReport } from '@/components/school-wallet-report';
import { AppPageHeader } from '@/components/app-page-header';
import { ErrorState } from '@/components/state-panels';
// Phase 5D.5 School PIKAS Cash report. Visible with the server-derived school:wallets:read; the
// sandbox admin POV keeps its financial exclusion.
export default async function Page({ searchParams }: { searchParams: Promise<{ school?: string }> }) {
  if (isDemoMode()) return <ErrorState title="El reporte de PIKAS Cash no está disponible en esta demostración." />;
  const client = await createSupabaseServerClient();
  const access = await resolveSchoolAccess(client);
  if (access.status !== 'authorized') redirect('/login?error=school_authority');
  const { school } = await searchParams;
  const schoolId = school ?? access.context.schools[0].school_id;
  if (!access.context.schools.some(s => s.school_id === schoolId)) redirect('/admin/escuela');
  const wallet = access.context.pov ? null : await readSchoolWalletAccess(client, schoolId);
  return <ConnectedSchoolShell context={access.context} schoolId={schoolId} walletNav={Boolean(wallet?.read)}>
    {access.context.pov ? <><AppPageHeader title="PIKAS Cash" /><p className="card p-5" role="status">Las operaciones y reportes financieros no están habilitados en este punto de vista de sandbox.</p></>
      : !wallet?.read ? <><AppPageHeader title="PIKAS Cash" /><ErrorState title="Tu rol no tiene acceso a PIKAS Cash en esta escuela." /></>
      : <SchoolWalletReport key={schoolId} schoolId={schoolId} />}
  </ConnectedSchoolShell>;
}
