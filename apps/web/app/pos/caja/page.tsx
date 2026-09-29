import { RegisterSessions } from '@/components/register-sessions';
import { requireRole } from '@/lib/auth/require-role';
export default async function Page() {
  const session = await requireRole('pos_operator');
  return <main className="mx-auto max-w-6xl p-4 sm:p-6">{session.demo ? <RegisterSessions /> : <p>Sesiones de caja disponibles en el entorno de demostración.</p>}</main>;
}
