import { MoneyValue } from './money-value';
import { ReportSummary, ReportTable } from './report-frame';
import { walletLines } from '../lib/school/reports';
import { reportDay } from '../lib/reports/filters';
import type { WalletReportView } from '../lib/school/wallet-report';

// Phase 5D.5 School PIKAS Cash report, rehomed in School Reportes (UX 8). Every number is returned by
// school_wallet_report for the period in the URL; this component formats it and never adds amounts.
// Wallet movement of this school's students only: no per-cafetería breakdown (removed in UX 7), no
// products, no per-student spending.
const times = (n: number, one: string, many: string) => `${n.toLocaleString('es-DO')} ${n === 1 ? one : many}`;

export function SchoolWalletReport({ report: r }: { report: WalletReportView }) {
  const m = r.movements, c = r.current, lines = walletLines(r);
  return <div className="space-y-5">
    <ReportSummary label="Resumen del período" items={[
      { label: 'Movimiento neto del período', value: <MoneyValue minor={m.net_movement_minor} intent="movement" />, help: times(m.entry_count, 'movimiento', 'movimientos') },
      { label: 'Recargas netas', value: <MoneyValue minor={m.net_replenished_minor} intent="movement" />, help: 'Recargas − reversiones de recarga' },
      { label: 'Monederos con movimiento', value: m.wallets_with_movement.toLocaleString('es-DO'), help: `con recargas, compras o ajustes · ${reportDay(r.from)} al ${reportDay(r.to)}` },
    ]} />
    <section aria-labelledby="rpt-movements" className="space-y-3">
      <h2 id="rpt-movements" className="sch-h2">Movimientos del período</h2>
      {m.entry_count === 0 ? <p className="sch-panel text-sm text-slate-600">Sin movimientos de PIKAS Cash en este período. No hubo recargas, compras, reembolsos ni correcciones en estas fechas.</p>
        : <ReportTable label="Movimientos de PIKAS Cash del período" rows={lines} rowKey={l => l.key} columns={[
          { header: 'Concepto', primary: true, cell: l => l.subtotal ? <span className="rpt-subtotal">{l.label}</span> : l.label },
          { header: 'Movimientos', align: 'end', cell: l => l.count === null ? '—' : l.count.toLocaleString('es-DO') },
          { header: 'Monto', align: 'end', cell: l => <MoneyValue minor={l.minor} intent="movement" className={l.subtotal ? 'font-bold' : ''} /> },
        ]} foot={<tr><th scope="row">Movimiento neto del período</th><td data-align="end">{m.entry_count.toLocaleString('es-DO')}</td><td data-align="end"><MoneyValue minor={m.net_movement_minor} intent="movement" className="font-black" /></td></tr>} />}
      <p className="rpt-help">Las reversiones corrigen recargas; no son reembolsos de compras. Fechas de operación de la escuela ({r.business_timezone}).</p>
    </section>
    <section aria-labelledby="rpt-now" className="sch-panel space-y-1">
      <h2 id="rpt-now" className="sch-h2">Monederos ahora</h2>
      <p className="text-sm text-slate-600">No depende del período. {c.wallet_count === 0 ? 'Aún no hay monederos de PIKAS Cash en este colegio.'
        : <>{times(c.wallet_count, 'monedero', 'monederos')} · {c.active_wallet_count.toLocaleString('es-DO')} activos{c.frozen_wallet_count ? ` · ${times(c.frozen_wallet_count, 'congelado', 'congelados')}` : ''} · saldo total <MoneyValue minor={c.total_balance_minor} intent="balance" />{c.negative_wallet_count ? <> · {times(c.negative_wallet_count, 'saldo negativo', 'saldos negativos')} (<MoneyValue minor={c.negative_balance_minor} intent="balance" />)</> : null}</>}</p>
    </section>
  </div>;
}
