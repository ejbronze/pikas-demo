import { requirePosAccess } from '@/lib/auth/pos-access';
import { ConnectedPosDashboard } from '@/components/connected-pos-dashboard';
export default async function Page() {
  const session = await requirePosAccess();
  if (session.demo) {
    const { RegisterSessions } = await import('@/components/register-sessions');
    return <main className="mx-auto max-w-6xl p-4 sm:p-6"><RegisterSessions /></main>;
  }
  return <ConnectedPosDashboard context={session.context} initialWorkspace="register" />;
}
