'use client';
// FIN 4 · Cafetería cash collection. The Cafetería physically receives cash for a student's PIKAS Cash: the wallet
// is credited the cash minus the PIKAS replenishment fee. The section shows whether collection is enabled for the
// customer, starts the «Recibir efectivo» task and lists the cash this Cafetería collected. The database decides
// everything; amounts shown before confirmation are the same half-up arithmetic it applies.
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { cafeteriaReadSchema, type CafeteriaWalletRead } from '../lib/wallet/contracts';
import { parseCash } from '../lib/pos/contracts';
import { cashJournalKey, cashMessage, cashPreview, cashWhen, feePercent, loadJournal, prepareJournal, readSchema, sendCollection,
  type CashCollectionRead, type CashCommand, type CashResult } from '../lib/cafeteria/cash-collection';
import { MoneyValue } from './money-value';
import { PikasBusyRegion } from './pikas-loading';
import { ErrorState } from './state-panels';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from './task-window';

export function CafeteriaCashCollection({ cafeteriaId, actorId }: { cafeteriaId: string; actorId: string }) {
  const [read, setRead] = useState<CashCollectionRead | null>(null);
  const [older, setOlder] = useState<CashCollectionRead['collections']>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const load = useCallback(async (before: string | null) => {
    const response = await sessionFetch('/api/cafeteria/cash-collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'read', cafeteria_id: cafeteriaId, before }) });
    const parsed = readSchema.safeParse((await response.json()).result);
    if (!response.ok || !parsed.success || parsed.data.cafeteria_id !== cafeteriaId) throw Error('read');
    return parsed.data;
  }, [cafeteriaId]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { const data = await load(null); setRead(data); setOlder([]); setNext(data.next_before); setState('ready'); }
    catch { setState(s => s === 'ready' ? 'ready' : 'error'); }
    finally { setRefreshing(false); }
  }, [load]);
  useEffect(() => { void refresh(); }, [refresh]);
  // An in-flight request from an earlier visit reopens the task in its recovery state.
  useEffect(() => { try { if (loadJournal(sessionStorage, cashJournalKey(actorId, cafeteriaId))) setOpen(true); } catch { /* storage unavailable */ } }, [actorId, cafeteriaId]);
  const more = async () => { if (!next) return; try { const data = await load(next); setOlder(o => [...o, ...data.collections]); setNext(data.next_before); } catch { setNotice('No se pudieron cargar más recargas. Intenta de nuevo.'); } };
  const rows = read ? [...read.collections, ...older] : [];
  return <section className="card mt-5 space-y-4 p-5" aria-labelledby="cash-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-64"><h2 id="cash-title" className="text-xl font-black">Recargas en efectivo</h2>
        <p className="text-sm text-slate-600">{read?.enabled && read.fee_bps !== null
          ? `Recibe efectivo para el PIKAS Cash de un estudiante. Se acredita el efectivo recibido menos el cargo por recarga PIKAS (${feePercent(read.fee_bps)}).`
          : 'Recibe efectivo para el PIKAS Cash de un estudiante cuando esté habilitado para este cliente.'}</p></div>
      {read?.enabled && <button type="button" className="btn" onClick={() => { setNotice(''); setOpen(true); }}>Recibir efectivo</button>}
    </div>
    {state === 'loading' && <p role="status" className="text-sm text-slate-600">Cargando recargas en efectivo…</p>}
    {state === 'error' && <ErrorState title="No pudimos cargar las recargas en efectivo." description="Intenta actualizar la página." />}
    {read && !read.enabled && <p role="status" className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm">Las recargas en efectivo no están habilitadas para este cliente. Cuando PIKAS las habilite, podrás registrarlas aquí.</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{notice}</p>}
    {read && <PikasBusyRegion busy={refreshing} context="Actualizando recargas en efectivo.">
      {rows.length === 0 ? (read.enabled && <p className="text-sm text-slate-600">Todavía no hay recargas en efectivo en esta cafetería.</p>)
        : <ul className="cash-list" aria-label="Recargas en efectivo recibidas">{rows.map(r => <li key={r.reference} className="cash-row" data-status={r.status}>
          <div className="cash-who"><p className="font-bold">{r.student_name}{r.student_code ? <span className="font-normal text-slate-600"> · {r.student_code}</span> : null}</p>
            <p className="text-sm text-slate-600">{cashWhen(r.collected_at)} · Recibido por {r.collected_by ?? 'la cafetería'} · {r.reference}</p></div>
          <dl className="cash-amounts">
            <div><dt>Efectivo recibido</dt><dd><MoneyValue minor={r.gross_minor} intent="amount" /></dd></div>
            <div><dt>Cargo por recarga PIKAS</dt><dd><MoneyValue minor={r.fee_minor} intent="amount" /></dd></div>
            <div><dt>Acreditado al monedero</dt><dd className="font-bold"><MoneyValue minor={r.net_minor} intent="amount" /></dd></div>
          </dl>
          <span className={`chip ${r.status === 'reversed' ? 'bg-rose-100 text-rose-900' : 'bg-emerald-100 text-emerald-900'}`}>{r.status === 'reversed' ? 'Revertida por PIKAS' : 'Acreditada'}</span>
        </li>)}</ul>}
      {next && <button type="button" className="btn-secondary mt-3" onClick={() => void more()}>Ver más recargas</button>}
    </PikasBusyRegion>}
    {open && read?.enabled && read.fee_bps !== null && <CashCollectionTask cafeteriaId={cafeteriaId} actorId={actorId} feeBps={read.fee_bps}
      onClose={() => setOpen(false)} onPosted={result => { setNotice(`Recarga ${result.reference} registrada para ${result.student_name}.`); void refresh(); }} />}
    {open && read && !read.enabled && <CashCollectionTask cafeteriaId={cafeteriaId} actorId={actorId} feeBps={null} onClose={() => setOpen(false)} onPosted={() => void refresh()} />}
  </section>;
}

type Student = CafeteriaWalletRead['students'][number];
type Phase = 'student' | 'amount' | 'review' | 'pending' | 'success' | 'rejected' | 'uncertain';

export function CashCollectionTask({ cafeteriaId, actorId, feeBps, onClose, onPosted }: { cafeteriaId: string; actorId: string; feeBps: number | null; onClose: () => void; onPosted: (result: CashResult) => void }) {
  const key = cashJournalKey(actorId, cafeteriaId);
  const [recovery] = useState<CashCommand | null>(() => { try { return loadJournal(sessionStorage, key); } catch { return null; } });
  const [phase, setPhase] = useState<Phase>(recovery ? 'uncertain' : 'student');
  const [query, setQuery] = useState(''), [searching, setSearching] = useState(false), [found, setFound] = useState<Student[] | null>(null), [searchError, setSearchError] = useState('');
  const [student, setStudent] = useState<Student | null>(null);
  const [amount, setAmount] = useState(''), [payer, setPayer] = useState(''), [received, setReceived] = useState(false);
  const [problem, setProblem] = useState(''), [rejection, setRejection] = useState('');
  const [request, setRequest] = useState<CashCommand | null>(recovery);
  const [result, setResult] = useState<CashResult | null>(null);
  const inFlight = useRef(false);
  const grossMinor = parseCash(amount);
  const preview = grossMinor && BigInt(grossMinor) > 0n && feeBps !== null ? cashPreview(grossMinor, feeBps) : null;
  const search = async () => {
    if (searching) return; setSearching(true); setSearchError('');
    try {
      const response = await sessionFetch('/api/cafeteria/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cafeteria_id: cafeteriaId, query: query.trim() }) });
      const parsed = cafeteriaReadSchema.safeParse((await response.json()).result);
      if (!response.ok || !parsed.success) throw Error('search');
      setFound(parsed.data.students);
    } catch { setFound(null); setSearchError('No se pudo buscar estudiantes. Intenta de nuevo.'); }
    finally { setSearching(false); }
  };
  const toAmount = () => { if (!student) { setProblem('Elige al estudiante que recibe la recarga.'); return; } setProblem(''); setPhase('amount'); };
  const toReview = () => {
    if (!preview) { setProblem('Escribe el efectivo recibido: un monto positivo con hasta dos decimales.'); return; }
    if (BigInt(preview.net) <= 0n) { setProblem('El monto es demasiado pequeño para acreditar PIKAS Cash.'); return; }
    if (payer.trim().length > 160) { setProblem('El nombre de quien entrega el efectivo es demasiado largo.'); return; }
    setProblem(''); setReceived(false); setPhase('review');
  };
  const commit = async () => {
    if (inFlight.current) return;
    let command: CashCommand;
    try {
      command = request ?? prepareJournal(sessionStorage, key, { operation: 'collect', cafeteria_id: cafeteriaId, student_id: student!.student_id, student_name: student!.display_name,
        gross_minor: grossMinor!, payer_name: payer.trim(), request_key: crypto.randomUUID() });
    } catch { setProblem('No se pudo preparar la recarga. No se envió ninguna solicitud.'); return; }
    inFlight.current = true; setRequest(command); setPhase('pending');
    const outcome = await sendCollection(command);
    inFlight.current = false;
    if (outcome.outcome === 'success') { try { sessionStorage.removeItem(key); } catch { /* ignore */ } setResult(outcome.result); setRequest(null); setPhase('success'); onPosted(outcome.result); return; }
    // The database replays a posted request before re-checking authority (202611190002), so a named refusal is
    // authoritative even on a recovery retry: the original never posted.
    if (outcome.outcome === 'rejected') { try { sessionStorage.removeItem(key); } catch { /* ignore */ } setRequest(null); setRejection(outcome.code); setPhase('rejected'); return; }
    setPhase('uncertain');
  };
  const restart = () => { setStudent(null); setFound(null); setQuery(''); setAmount(''); setPayer(''); setReceived(false); setResult(null); setRejection(''); setProblem(''); setPhase('student'); };
  const stepIndex = { student: 0, amount: 1, review: 2 } as Record<Phase, number>;
  const dirty = (phase === 'student' && !!student) || phase === 'amount' || phase === 'review';
  const shown = request ?? (student && grossMinor ? { student_name: student.display_name, gross_minor: grossMinor } : null);
  if (feeBps === null && phase !== 'uncertain') return <TaskWindow title="Recibir efectivo" onClose={onClose} footer={<TaskActions><TaskCancelButton>Cerrar</TaskCancelButton></TaskActions>}>
    <TaskOutcome kind="failure" title="Recargas en efectivo no habilitadas"><p>{cashMessage('FINANCIAL_POLICY_NOT_ACTIVE')}</p></TaskOutcome></TaskWindow>;
  return <TaskWindow title={phase === 'success' ? 'Recarga registrada' : 'Recibir efectivo'} context={student?.display_name ?? request?.student_name}
    steps={phase in stepIndex ? ['Estudiante', 'Efectivo', 'Revisar'] : undefined} step={stepIndex[phase] ?? 0}
    busy={phase === 'pending'} dirty={dirty} onClose={onClose}
    footer={<TaskActions>{{
      student: <><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={!student} onClick={toAmount}>Continuar</button></>,
      amount: <><button type="button" className="btn-secondary" onClick={() => setPhase('student')}>Atrás</button><button type="button" className="btn" onClick={toReview}>Revisar</button></>,
      review: <><button type="button" className="btn-secondary" onClick={() => setPhase('amount')}>Atrás</button><button type="button" className="btn" disabled={!received} onClick={() => void commit()}>Registrar recarga</button></>,
      pending: <button type="button" className="btn" disabled>Registrando recarga…</button>,
      success: <><button type="button" className="btn-secondary" onClick={restart}>Nueva recarga</button><button type="button" className="btn" data-autofocus onClick={onClose}>Listo</button></>,
      rejected: <><TaskCancelButton>Cerrar</TaskCancelButton><button type="button" className="btn" onClick={() => setPhase(student ? 'amount' : 'student')}>Revisar datos</button></>,
      uncertain: <><button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button><button type="button" className="btn" onClick={() => void commit()}>Reintentar la misma recarga</button></>,
    }[phase]}</TaskActions>}>
    {phase === 'student' && <>
      <form className="flex flex-wrap gap-2" role="search" aria-label="Buscar estudiante" onSubmit={e => { e.preventDefault(); void search(); }}>
        <label className="sr-only" htmlFor="cash-student-q">Nombre o código del estudiante</label>
        <input id="cash-student-q" data-autofocus className="field min-w-0 flex-1 basis-48" placeholder="Nombre o código" maxLength={80} value={query} onChange={e => setQuery(e.target.value)} />
        <button className="btn-secondary" disabled={searching}>{searching ? 'Buscando…' : 'Buscar'}</button>
      </form>
      <p className="text-xs text-slate-600">Solo aparecen los estudiantes que el colegio comparte con esta cafetería.</p>
      {searchError && <p role="alert" className="font-bold text-red-800">{searchError}</p>}
      {found && (found.length === 0 ? <p role="status">No encontramos estudiantes compartidos con ese nombre.</p>
        : <fieldset className="space-y-2"><legend className="font-bold">¿Para quién es la recarga?</legend>{found.map(s => {
          const frozen = s.wallet_status === 'frozen';
          return <label key={s.student_id} className={`cash-pick ${frozen ? 'opacity-70' : ''}`}>
            <input type="radio" name="cash-student" disabled={frozen} checked={student?.student_id === s.student_id} onChange={() => { setStudent(s); setProblem(''); }} />
            <span className="min-w-0 flex-1"><span className="block font-bold">{s.display_name}</span>
              <span className="block text-sm text-slate-600">{s.wallet_status === null ? 'Sin PIKAS Cash todavía: se crea con esta recarga.' : frozen ? 'PIKAS Cash congelado: no puede recibir recargas.' : <>Saldo actual <MoneyValue minor={s.balance_minor} intent="balance" /></>}</span></span>
          </label>; })}</fieldset>)}
      {problem && <p role="alert" className="font-bold text-red-800">{problem}</p>}
    </>}
    {phase === 'amount' && student && <>
      <label className="block font-bold">Efectivo recibido (RD$)<input data-autofocus className="field mt-1" inputMode="decimal" autoComplete="off" maxLength={14} placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} aria-describedby="cash-breakdown" /></label>
      <label className="block font-bold">Entregado por <span className="font-normal text-slate-600">(opcional)</span><input className="field mt-1" maxLength={160} autoComplete="off" value={payer} onChange={e => setPayer(e.target.value)} /></label>
      <CashBreakdown id="cash-breakdown" preview={preview} feeBps={feeBps!} />
      {problem && <p role="alert" className="font-bold text-red-800">{problem}</p>}
    </>}
    {phase === 'review' && student && preview && <>
      <TaskSummary rows={[['Estudiante', student.display_name], ['Efectivo recibido', <MoneyValue key="g" minor={preview.gross} intent="amount" />],
        [`Cargo por recarga PIKAS (${feePercent(feeBps!)})`, <MoneyValue key="f" minor={preview.fee} intent="amount" />],
        ['Se acredita al monedero', <MoneyValue key="n" minor={preview.net} intent="amount" className="font-bold" />],
        ...(student.wallet_status ? [['Saldo después (estimado)', <MoneyValue key="b" minor={(BigInt(student.balance_minor) + BigInt(preview.net)).toString()} intent="balance" />] as [string, React.ReactNode]] : []),
        ...(payer.trim() ? [['Entregado por', payer.trim()] as [string, string]] : [])]} />
      <label className="cash-confirm"><input type="checkbox" checked={received} onChange={e => setReceived(e.target.checked)} /><span>Recibí <MoneyValue minor={preview.gross} intent="amount" className="font-bold" /> en efectivo.</span></label>
      <p className="text-sm text-slate-600">PIKAS registra la recarga al pulsar «Registrar recarga». Guarda el efectivo en la cafetería.</p>
      {problem && <p role="alert" className="font-bold text-red-800">{problem}</p>}
    </>}
    {phase === 'pending' && shown && <TaskOutcome kind="pending" title="Registrando la recarga…"><p>No cierres esta ventana. Efectivo recibido: <MoneyValue minor={shown.gross_minor} intent="amount" /> para {shown.student_name}.</p></TaskOutcome>}
    {phase === 'success' && result && <TaskOutcome kind="success" title={result.replayed ? 'Esta recarga ya estaba registrada' : 'Recarga registrada'}>
      <TaskSummary rows={[['Efectivo recibido', <MoneyValue key="g" minor={result.gross_minor} intent="amount" />], [`Cargo por recarga PIKAS (${feePercent(result.fee_bps)})`, <MoneyValue key="f" minor={result.fee_minor} intent="amount" />],
        ['Acreditado al monedero', <MoneyValue key="n" minor={result.net_minor} intent="amount" className="font-bold" />], ['Estudiante', result.student_name],
        ['Nuevo saldo', <MoneyValue key="b" minor={result.balance_after_minor} intent="balance" />], ['Referencia', result.reference],
        ['Recibido por', result.collected_by ?? '—'], ['Fecha', cashWhen(result.collected_at)]]} />
    </TaskOutcome>}
    {phase === 'rejected' && <TaskOutcome kind="failure" title="No se registró la recarga"><p>{cashMessage(rejection)}</p><p className="text-sm">No se movió dinero.</p></TaskOutcome>}
    {phase === 'uncertain' && request && <TaskOutcome kind="uncertain" title="Recarga pendiente de confirmar"><p>No sabemos si se registró la recarga de <MoneyValue minor={request.gross_minor} intent="amount" /> en efectivo para {request.student_name}. Reintenta la misma solicitud: PIKAS no la duplicará. No inicies otra recarga.</p></TaskOutcome>}
  </TaskWindow>;
}

// Gross / fee / net, always all three and always labelled: the fee is never hidden and gross is never presented as
// the amount added to the wallet.
function CashBreakdown({ id, preview, feeBps }: { id: string; preview: { gross: string; fee: string; net: string } | null; feeBps: number }) {
  return <dl id={id} className="cash-breakdown" aria-live="polite">
    <div><dt>Efectivo recibido</dt><dd>{preview ? <MoneyValue minor={preview.gross} intent="amount" /> : '—'}</dd></div>
    <div><dt>Cargo por recarga PIKAS ({feePercent(feeBps)})</dt><dd>{preview ? <>− <MoneyValue minor={preview.fee} intent="amount" /></> : '—'}</dd></div>
    <div className="cash-breakdown-net"><dt>Se acredita al monedero</dt><dd>{preview ? <MoneyValue minor={preview.net} intent="amount" /> : '—'}</dd></div>
  </dl>;
}
