import { CafeteriaMenus } from '@/components/cafeteria-menus';
import { isDemoMode } from '@/lib/env';
export default function Page() { return isDemoMode() ? <CafeteriaMenus shifts /> : <p>Turnos disponibles en el entorno de demostración.</p>; }
