import { RegisterSessions } from '@/components/register-sessions';
import { isDemoMode } from '@/lib/env';
export default function Page() { return isDemoMode() ? <RegisterSessions admin /> : <p>Cajas disponibles en el entorno de demostración.</p>; }
