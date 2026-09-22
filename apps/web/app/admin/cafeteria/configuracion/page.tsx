import {isDemoMode} from '@/lib/env';
import {PosSettings} from '@/components/pos-settings';
export default function Page(){return isDemoMode()?<PosSettings/>:<p>Configuración financiera remota pendiente de integración.</p>}
