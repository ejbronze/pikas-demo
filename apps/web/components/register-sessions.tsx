'use client';
import Link from 'next/link';
import { useState } from 'react';
import { parseMoney, resolveRegisterGate, summarizeRegisterSession, type RegisterSession, type RegisterSessionSummary } from '@pikas/data-access';
import { useDemo } from './demo-provider';
import { posMoney } from './pos-tools';
const date = (value: string) => new Date(value).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' });
function Summary({ session, summary }: { session: RegisterSession; summary: RegisterSessionSummary }) {
  const values: [string, string | number][] = [
    ['Caja', session.registerName], ['Cajero', session.cashierName], ['Apertura', date(session.openedAt)],
    ['Cierre', session.status === 'closed' ? date(session.closedAt) : 'Sesión abierta'],
    ['Fondo inicial', posMoney(session.openingCashMinor)], ['Ventas totales', posMoney(summary.salesMinor)],
    ['Ventas en efectivo', posMoney(summary.cashSalesMinor)], ['Ventas con Saldo PIKAS', posMoney(summary.walletSalesMinor)],
    ['Recargas', posMoney(summary.replenishmentsMinor)], ['Recargas en efectivo', posMoney(summary.cashReplenishmentsMinor)],
    ['Reembolsos', posMoney(summary.refundsMinor)], ['Reembolsos en efectivo', posMoney(summary.cashRefundsMinor)],
    ['Número de transacciones', summary.transactionCount], ['Efectivo esperado', posMoney(summary.expectedCashMinor)],
    ['Efectivo contado', session.status === 'closed' ? posMoney(session.countedCashMinor) : 'Sin contar'],
    ['Diferencia', session.status === 'closed' ? posMoney(session.differenceMinor) : '—'],
  ];
  return <section aria-label="Resumen de sesión" className="mt-4"><h3 className="text-lg font-black">Resumen de sesión</h3><dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{values.map(([label, value]) => <div key={label}><dt className="text-sm text-slate-500">{label}</dt><dd className="break-words font-bold">{value}</dd></div>)}</dl>{session.status === 'closed' && session.closingNote ? <p className="mt-4 break-words">Motivo del cierre: {session.closingNote}</p> : null}<p className="mt-3 break-all text-xs text-slate-500">Sesión {session.id}</p></section>;
}
function SessionAction({ session, summary, disabled }: { session?: RegisterSession; summary?: RegisterSessionSummary; disabled: boolean }) {
  const { openRegister, closeRegister, retryConnection } = useDemo();
  const [amount, setAmount] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const [review, setReview] = useState<RegisterSessionSummary | null>(null);
  const counted = parseMoney(amount), difference = counted !== null && summary ? counted - summary.expectedCashMinor : null;
  const closing = session?.status === 'open';
  return <form className="mt-5 border-t pt-4" onSubmit={async event => {
    event.preventDefault(); setError('');
    if (counted === null) { setError('Indica un monto RD$ válido, mayor o igual a cero.'); return; }
    if (closing && !review) { setReview(summary!); return; }
    if (!confirm(closing ? '¿Confirmar cierre? La sesión no podrá modificarse.' : '¿Confirmar apertura de caja?')) return;
    setBusy(true);
    const result = closing ? await closeRegister(session.id, counted, note, review!, key) : await openRegister(counted, key);
    if (!result.ok) { setError(result.message); setReview(null); await retryConnection(); }
    setBusy(false);
  }}>
    <h3 className="text-lg font-black">{closing ? 'Cerrar caja' : 'Abrir caja'}</h3>
    <div className="mt-3 grid gap-4 sm:grid-cols-2"><label className="font-bold">{closing ? 'Efectivo contado (RD$)' : 'Fondo inicial (RD$)'}<input className="field mt-2" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setReview(null); }} disabled={busy || disabled} required /></label>
    {closing ? <label className="font-bold">Motivo de diferencia<textarea className="field mt-2" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} required={difference !== null && difference !== 0} disabled={busy || disabled} /></label> : null}</div>
    {closing && difference !== null ? <p className="mt-3 font-bold">Diferencia: {posMoney(difference)}{difference !== 0 ? ' · Requiere motivo; puedes cerrar con sobrante o faltante.' : ''}</p> : null}
    {review ? <p role="status" className="mt-3">Revisa el conteo y el resumen. Confirmar guarda el cierre definitivo.</p> : null}
    {error ? <p role="alert" className="mt-3 text-red-700">{error}</p> : null}
    <button className="btn mt-4" disabled={busy || disabled}>{busy ? 'Guardando…' : closing ? review ? 'Confirmar cierre' : 'Revisar cierre' : 'Confirmar apertura'}</button>
  </form>;
}
export function RegisterSessions({ admin = false }: { admin?: boolean }) {
  const { state, sessionRole, connection } = useDemo();
  const registers = state.cafeteriaOperations.registers.filter(r => r.organizationId === 'cafeteria-demo' && r.locationId === 'principal' && (admin || r.id === 'caja-1'));
  const user = state.administration.users.find(u => u.id === 'pos-1');
  const gate = resolveRegisterGate({ actor: user ? { id: user.id, name: user.name, role: user.role, active: user.status === 'active', organizationId: 'cafeteria-demo', locationId: 'principal', registerId: 'caja-1' } : undefined, allowedRegisterIds: user?.allowedRegisterIds ?? [], registers: state.cafeteriaOperations.registers, sessions: state.registerSessions });
  const [selected, setSelected] = useState<string | null>(null);
  if (sessionRole !== (admin ? 'cafeteria_admin' : 'pos_operator')) return <p role="status">Confirma tu sesión para consultar las cajas.</p>;
  return <div className="space-y-5">
    {!admin ? <Link className="btn-secondary" href="/pos">Volver a Venta</Link> : null}
    <header><p className="label">{admin ? 'Administración de cafetería' : 'Operación POS'}</p><h1 className="text-3xl font-black">{admin ? 'Cajas' : 'Mi caja'}</h1><p className="mt-2 text-slate-600">Sesiones de caja y conciliación de efectivo. Los turnos de servicio se configuran por separado.</p></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm">Demo: el cajero abre y cierra su sesión. Para vender o recibir efectivo se requiere una sesión abierta y autorizada. Las transacciones históricas conservan su atribución original. Horas de Santo Domingo.</p>
    {!admin && gate.status !== 'ready' ? <p role="status" className="font-bold">{gate.message}</p> : null}
    {!admin && user?.status !== 'active' ? <p role="status">Cuenta suspendida o inactiva: solo puedes conciliar y cerrar tu sesión existente.</p> : null}
    {connection !== 'Online' ? <p role="alert">No se ha confirmado la conexión. Las operaciones están bloqueadas.</p> : null}
    {registers.map(register => {
      const sessions = state.registerSessions.filter(s => s.registerId === register.id && s.organizationId === register.organizationId && s.locationId === register.locationId);
      const open = sessions.find(s => s.status === 'open');
      const summary = open ? summarizeRegisterSession(open, state.purchases, state.events) : undefined;
      const historical = sessions.find(s => s.id === selected && s.status === 'closed');
      return <article className="card p-4 sm:p-6" key={register.id}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black">{register.name}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold">{register.active ? 'Activa' : 'Inactiva'} · {open ? 'Abierta' : 'Cerrada'}</span></div>
        {open && summary ? <Summary session={open} summary={summary} /> : <p className="mt-3 text-slate-600">Sin sesión abierta.</p>}
        {!admin && (gate.status === 'ready' || gate.status === 'no_open_session' || (!!open && !!user && open.cashierId === user.id)) ? <SessionAction key={open?.id ?? `closed-${sessions.length}`} session={open} summary={summary} disabled={connection !== 'Online' || (!open && !register.active)} /> : null}
        <h3 className="mt-6 font-black">Sesiones anteriores</h3>
        <div className="mt-2 divide-y">{sessions.filter(s => s.status === 'closed').map(s => <button key={s.id} className="flex min-h-12 w-full flex-wrap justify-between gap-2 py-3 text-left" onClick={() => setSelected(selected === s.id ? null : s.id)} aria-expanded={selected === s.id}><span>{date(s.openedAt)} · {s.cashierName}</span><span className="font-bold">Ver cierre</span></button>)}{!sessions.some(s => s.status === 'closed') ? <p className="text-sm text-slate-500">Todavía no hay sesiones cerradas.</p> : null}</div>
        {historical ? <Summary session={historical} summary={summarizeRegisterSession(historical, state.purchases, state.events)} /> : null}
      </article>;
    })}
    <p className="text-sm text-slate-500">Efectivo esperado = fondo inicial + ventas en efectivo + recargas en efectivo − reembolsos en efectivo. Saldo PIKAS no aumenta el efectivo. El conteo de transacciones incluye ventas, recargas, reembolsos y correcciones; excluye cancelaciones sin movimiento.</p>
  </div>;
}
