'use client';
import { DemoEnvironmentBar } from "./demo-environment-bar";
import { AdministrativeShell, type ShellNavItem } from "./administrative-shell";
import type { CafeteriaContext } from '../lib/cafeteria/contracts';
// Operational destinations first (mobile shows the first four; the rest under "Más").
const allItems = [['', 'Resumen', 'home'], ['/transacciones', 'Transacciones', 'receipt'], ['/cajas', 'Cajas', 'receipt'], ['/reportes', 'Reportes', 'chart'], ['/escuelas', 'PIKAS Cash', 'wallet'], ['/productos', 'Productos', 'utensils'], ['/menus', 'Menús', 'utensils'], ['/personal', 'Personal POS', 'users'], ['/configuracion', 'Configuración', 'shield']] as const;
// PIKAS Cash (balances/scoped adjustments on /escuelas) is listed only when the server-derived read grants cafeteria:wallets:read;
// Reportes only with cafeteria:pos:purchases:read on a customer tenant (the report RPC enforces both).
export function ConnectedCafeteriaShell({ context, cafeteriaId, walletNav = false, reportsNav = false, children }: { context: CafeteriaContext; cafeteriaId: string; walletNav?: boolean; reportsNav?: boolean; children: React.ReactNode }) {
  const scope = context.cafeterias.find(c => c.cafeteria_id === cafeteriaId)!;
  const nav: ShellNavItem[] = allItems.filter(([suffix]) => (walletNav || suffix !== '/escuelas') && (reportsNav || suffix !== '/reportes'))
    .map(([suffix, label, icon]) => ({ href: `/admin/cafeteria${suffix}?cafeteria=${cafeteriaId}`, label, icon, match: `/admin/cafeteria${suffix}`, exact: suffix === '' }));
  return <AdministrativeShell tone="teal" area="Administración de cafetería" homeHref={`/admin/cafeteria?cafeteria=${cafeteriaId}`} navLabel="Administración" nav={nav}
    context={{ label: 'Cafetería', name: scope.cafeteria_name, detail: context.pov ? 'Datos ficticios' : scope.school_name }}
    switcher={context.pov ? undefined : { id: 'workspace-cafeteria', name: 'cafeteria', label: 'Cafetería', value: cafeteriaId, options: context.cafeterias.map(c => ({ value: c.cafeteria_id, label: c.cafeteria_name })) }}
    account={context.pov ? { name: context.pov.operator_name, role: 'Operador de PIKAS · Demo' } : { name: context.display_name, role: 'Administrador de cafetería' }}
    logout={!context.pov}
    demo={context.pov ? <DemoEnvironmentBar pov={context.pov} /> : undefined}
    notice={!context.pov && scope.tenant_kind === 'sandbox' ? <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm font-bold text-amber-950" role="status">DEMO / SANDBOX · {scope.cafeteria_name} · Datos de prueba</div> : undefined}>
    {children}
  </AdministrativeShell>;
}
