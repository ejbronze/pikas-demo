'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { money } from '../lib/cafeteria/operations';
import { cafeteriaDirection, cafeteriaSettlementDetailSchema, cafeteriaSettlementsSchema, directionOf, dueLabel, netOf, paidOnLabel, weekLabel,
  type CafeteriaSettlementDetail, type CafeteriaSettlements } from '../lib/platform/settlements';
import { PikasBusyRegion } from './pikas-loading';
import { SettlementBadge, SettlementEvents, SettlementLines, SettlementTotals } from './settlement-views';
import { EmptyState, ErrorState } from './state-panels';

// What this Cafetería owes PIKAS or is owed, week by week. Read only: PIKAS calculates and confirms; corrections arrive as
// new movements in a later week.
export function CafeteriaSettlements({ cafeteriaId }: { cafeteriaId: string }) {
  const [data, setData] = useState<CafeteriaSettlements | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const post = useCallback(async (body: Record<string, string>) => {
    const response = await sessionFetch('/api/cafeteria/settlements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cafeteria_id: cafeteriaId, ...body }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(payload.error ?? 'read');
    return payload.result;
  }, [cafeteriaId]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { const parsed = cafeteriaSettlementsSchema.safeParse(await post({ operation: 'read' })); if (!parsed.success) throw Error('shape'); setData(parsed.data); setState('ready'); }
    catch { setState(s => s === 'ready' ? 'ready' : 'error'); }
    finally { setRefreshing(false); }
  }, [post]);
  useEffect(() => { void refresh(); }, [refresh]);
  if (selected) return <SettlementDetail reference={selected} load={post} onBack={() => setSelected(null)} />;
  return <div className="space-y-5">
    <p className="text-sm text-slate-600">Cada semana (lunes a domingo, hora de Santo Domingo) PIKAS compara el efectivo que recibiste para recargas de PIKAS Cash con lo que tus estudiantes pagaron con PIKAS Cash. La diferencia se paga el martes siguiente. PIKAS no mueve dinero por sí solo: los pagos se hacen por transferencia y PIKAS los confirma.</p>
    {state === 'loading' && <p role="status" className="text-sm text-slate-600">Cargando liquidaciones…</p>}
    {state === 'error' && <ErrorState title="No pudimos cargar las liquidaciones." description="Intenta de nuevo en unos minutos." action={<button type="button" className="btn-secondary" onClick={() => void refresh()}>Reintentar</button>} />}
    {data && !data.enabled && <p role="status" className="card p-5 text-sm">Las liquidaciones no están habilitadas para este cliente. Cuando PIKAS active el modelo financiero de PIKAS Cash, verás aquí cada semana.</p>}
    {data && data.enabled && <PikasBusyRegion busy={refreshing} context="Actualizando liquidaciones." className="space-y-5">
      <section className="card space-y-3 p-5" aria-labelledby="current-week">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="current-week" className="text-lg font-bold">Semana en curso · {weekLabel(data.current.week_start, data.current.week_end)}</h2><span className="chip bg-slate-100 text-slate-800">Abierta</span></div>
        <PeriodTotals owes={data.current.cafeteria_owes_minor} owed={data.current.clearing_owes_minor} />
        <p className="text-sm text-slate-600">Estimado con {data.current.line_count} movimientos hasta ahora. Se calcula cuando termine la semana; vencería el {dueLabel(data.current.due_on)}.</p>
      </section>
      {data.pending.length > 0 && <section className="space-y-3" aria-labelledby="pending-weeks"><h2 id="pending-weeks" className="text-lg font-bold">Semanas cerradas en cálculo</h2>
        <ul className="space-y-3">{data.pending.map(p => <li key={p.week_start} className="card space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{weekLabel(p.week_start, p.week_end)}</p><SettlementBadge status="ready" /></div>
          <PeriodTotals owes={p.cafeteria_owes_minor} owed={p.clearing_owes_minor} />
          <p className="text-sm text-slate-600">PIKAS calculará esta liquidación. Vence el {dueLabel(p.due_on)}.</p></li>)}</ul></section>}
      <section className="space-y-3" aria-labelledby="settled-weeks"><h2 id="settled-weeks" className="text-lg font-bold">Liquidaciones</h2>
        {data.settlements.length === 0 ? <EmptyState title="Todavía no hay liquidaciones." description="Cuando PIKAS calcule tu primera semana cerrada, aparecerá aquí con lo que debes o te deben." />
          : <ul className="space-y-3">{data.settlements.map(s => <li key={s.reference} className="card space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{weekLabel(s.week_start, s.week_end)} <span className="font-mono font-normal text-slate-600">· {s.reference}</span></p><SettlementBadge status={s.status} /></div>
            <SettlementTotals owes={s.cafeteria_owes_minor} owed={s.clearing_owes_minor} direction={s.net_direction} net={s.net_amount_minor} audience="cafeteria" compact />
            <p className="text-sm text-slate-600">{s.status === 'settled' ? (s.net_direction === 'none' ? 'Sin saldo pendiente.' : `Pago confirmado por PIKAS${s.settled_at ? ` el ${paidOnLabel(s.settled_at.slice(0, 10))}` : ''}.`)
              : s.status === 'in_review' ? 'PIKAS está revisando esta liquidación. Los totales no cambian; cualquier corrección llega como un movimiento nuevo.' : `Vence el ${dueLabel(s.due_on)}.`}</p>
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setSelected(s.reference)} aria-label={`Ver detalle de ${weekLabel(s.week_start, s.week_end)}`}>Ver detalle</button>
          </li>)}</ul>}
      </section>
    </PikasBusyRegion>}
  </div>;
}

function PeriodTotals({ owes, owed }: { owes: string; owed: string }) {
  return <SettlementTotals owes={owes} owed={owed} direction={directionOf(owes, owed)} net={netOf(owes, owed)} audience="cafeteria" compact />;
}

function SettlementDetail({ reference, load, onBack }: { reference: string; load: (body: Record<string, string>) => Promise<unknown>; onBack: () => void }) {
  const [detail, setDetail] = useState<CafeteriaSettlementDetail | null>(null), [failure, setFailure] = useState<'' | 'missing' | 'error'>('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { let alive = true; load({ operation: 'detail', reference }).then(r => { const parsed = cafeteriaSettlementDetailSchema.safeParse(r); if (!alive) return; if (parsed.success) setDetail(parsed.data); else setFailure('error'); })
    .catch(e => { if (alive) setFailure(e instanceof Error && e.message === 'SETTLEMENT_NOT_FOUND' ? 'missing' : 'error'); }); return () => { alive = false; }; }, [load, reference]);
  useEffect(() => { if (detail) heading.current?.focus(); }, [detail]);
  const back = <button type="button" className="btn-secondary" onClick={onBack}>Volver a liquidaciones</button>;
  if (failure) return <ErrorState kind={failure === 'missing' ? 'not_found' : undefined} title={failure === 'missing' ? 'No encontramos esta liquidación.' : 'No pudimos cargar la liquidación.'} description="Vuelve a la lista e inténtalo de nuevo." action={back} />;
  if (!detail) return <p role="status" className="text-sm text-slate-600">Cargando liquidación…</p>;
  const d = detail;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">{back}<SettlementBadge status={d.status} /></div>
    <section className="card space-y-3 p-5" aria-labelledby="settlement-heading">
      <h2 id="settlement-heading" ref={heading} tabIndex={-1} className="text-xl font-black outline-none">{weekLabel(d.week_start, d.week_end)} <span className="font-mono text-base font-normal text-slate-600">· {d.reference}</span></h2>
      <SettlementTotals owes={d.cafeteria_owes_minor} owed={d.clearing_owes_minor} direction={d.net_direction} net={d.net_amount_minor} audience="cafeteria" />
      <p className="text-sm">{d.net_direction === 'none' ? 'Lo que debías y lo que te debían se compensan: no hay pago pendiente.'
        : `${cafeteriaDirection[d.net_direction]} ${money(d.net_amount_minor)}: es la diferencia entre ${money(d.cafeteria_owes_minor)} y ${money(d.clearing_owes_minor)}.`} Vence el {dueLabel(d.due_on)}.</p>
      {d.status === 'in_review' && <p role="status" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-950">PIKAS está revisando esta liquidación. Los totales calculados no se editan; si hay que corregir algo, la corrección aparecerá como un movimiento en una semana posterior.</p>}
      {d.late_line_count > 0 && <p className="text-sm text-slate-600">Incluye {d.late_line_count} movimiento(s) de semanas anteriores que se registraron después de que esas semanas se liquidaron.</p>}
    </section>
    <section className="card space-y-3 p-5" aria-label="Movimientos incluidos"><h2 className="text-lg font-bold">Movimientos incluidos ({d.lines.length})</h2><SettlementLines lines={d.lines} audience="cafeteria" /></section>
    <section className="card space-y-3 p-5" aria-label="Historial de la liquidación"><h2 className="text-lg font-bold">Historial</h2><SettlementEvents events={d.events} direction={d.net_direction} audience="cafeteria" /></section>
  </div>;
}
