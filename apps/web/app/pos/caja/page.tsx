import { requirePosAccess } from '@/lib/auth/pos-access';
import { PosAccessBanner } from '@/components/connected-pos-dashboard';
export default async function Page() {
  const session = await requirePosAccess();
  if (session.demo) {
    const { RegisterSessions } = await import('@/components/register-sessions');
    return <main className="mx-auto max-w-6xl p-4 sm:p-6"><RegisterSessions /></main>;
  }
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6"><div className="sticky top-0"><PosAccessBanner context={session.context} /></div><p role="status" className="card mt-4 p-6">Las operaciones de caja todavía no están disponibles.</p></main>);
}
