import { CafeteriaMenus } from '@/components/cafeteria-menus';
import { isDemoMode } from '@/lib/env';
export default function Page() { return isDemoMode() ? <CafeteriaMenus /> : <p>Menús disponibles en el entorno de demostración.</p>; }
