'use client';
import { usePathname } from "next/navigation";
import { DemoEnvironmentBar } from "./demo-environment-bar";
import { AdministrativeShell, type ShellNavItem } from "./administrative-shell";
import { HierarchyTrail } from "./cafeteria-management-map";
import type { CafeteriaContext } from '../lib/cafeteria/contracts';
// UX 12A: two groups. "Operación" is the day-to-day work; "Mi cafetería" is what the admin manages
// inside the cafetería, in hierarchy order (cajas → personal → productos → menús → configuración).
// Item order is unchanged so the mobile bottom bar keeps its first four destinations.
const OPERATION = 'Operación', STRUCTURE = 'Mi cafetería';
const allItems = [['', 'Hoy', 'home', OPERATION], ['/transacciones', 'Transacciones', 'receipt', OPERATION], ['/cajas', 'Cajas', 'receipt', STRUCTURE], ['/reportes', 'Reportes', 'chart', OPERATION], ['/escuelas', 'PIKAS Cash', 'wallet', OPERATION],
  ['/personal', 'Personal POS', 'users', STRUCTURE], ['/productos', 'Productos', 'utensils', STRUCTURE], ['/menus', 'Menús', 'utensils', STRUCTURE], ['/configuracion', 'Configuración', 'shield', STRUCTURE]] as const;
// The current area for the location cue, most specific first (sub-routes such as reports and shifts).
const areas = [['/admin/cafeteria/menus/turnos', 'Turnos de servicio'], ['/admin/cafeteria/menus', 'Menús'], ['/admin/cafeteria/menu', 'Menú'], ['/admin/cafeteria/reportes', 'Reportes'], ['/admin/cafeteria/transacciones', 'Transacciones'], ['/admin/cafeteria/cajas', 'Cajas'],
  ['/admin/cafeteria/personal', 'Personal POS'], ['/admin/cafeteria/productos', 'Productos'], ['/admin/cafeteria/configuracion', 'Configuración'], ['/admin/cafeteria/escuelas', 'PIKAS Cash']] as const;
export const currentArea = (path: string, walletNav: boolean) => { const hit = areas.find(([match]) => path === match || path.startsWith(match + '/')); return !hit ? 'Hoy' : hit[1] === 'PIKAS Cash' && !walletNav ? 'Escuelas conectadas' : hit[1]; };
// PIKAS Cash (balances/scoped adjustments on /escuelas) is listed only when the server-derived read grants cafeteria:wallets:read;
// Reportes only with cafeteria:pos:purchases:read on a customer tenant (the report RPC enforces both).
export function ConnectedCafeteriaShell({ context, cafeteriaId, walletNav = false, reportsNav = false, children }: { context: CafeteriaContext; cafeteriaId: string; walletNav?: boolean; reportsNav?: boolean; children: React.ReactNode }) {
  const scope = context.cafeterias.find(c => c.cafeteria_id === cafeteriaId)!, path = usePathname();
  const nav: ShellNavItem[] = allItems.filter(([suffix]) => (walletNav || suffix !== '/escuelas') && (reportsNav || suffix !== '/reportes'))
    .map(([suffix, label, icon, group]) => ({ href: `/admin/cafeteria${suffix}?cafeteria=${cafeteriaId}`, label, icon, match: `/admin/cafeteria${suffix}`, exact: suffix === '', group }));
  return <AdministrativeShell tone="teal" area="Administración de cafetería" homeHref={`/admin/cafeteria?cafeteria=${cafeteriaId}`} navLabel="Administración" nav={nav}
    context={{ label: 'Cafetería', name: scope.cafeteria_name, detail: context.pov ? 'Datos ficticios' : `${scope.location_name} · ${scope.school_name}` }}
    switcher={context.pov ? undefined : { id: 'workspace-cafeteria', name: 'cafeteria', label: 'Cafetería', value: cafeteriaId, options: context.cafeterias.map(c => ({ value: c.cafeteria_id, label: c.cafeteria_name })) }}
    account={context.pov ? { name: context.pov.operator_name, role: 'Operador de PIKAS · Demo' } : { name: context.display_name, role: 'Administrador de cafetería' }}
    logout={!context.pov}
    demo={context.pov ? <DemoEnvironmentBar pov={context.pov} persona={context.display_name} context={scope.account_name} /> : undefined}
    notice={!context.pov && scope.tenant_kind === 'sandbox' ? <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm font-bold text-amber-950" role="status">DEMO / SANDBOX · {scope.cafeteria_name} · Datos de prueba</div> : undefined}
    trail={<HierarchyTrail levels={[{ label: 'Colegio', name: scope.school_name }, { label: 'Sede', name: scope.location_name }, { label: 'Cafetería', name: scope.cafeteria_name }]} current={currentArea(path, walletNav)} />}>
    {children}
  </AdministrativeShell>;
}
