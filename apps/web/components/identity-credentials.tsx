'use client';
import { useEffect, useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { auditLabels, identityErrors, identityResponseSchema, roleLabels, type IdentityCommand, type IdentitySummary } from '../lib/identity/contracts';
import { isValidUsername, normalizeUsername, usernameRules } from '../lib/identity/username';
import { isInternalEmail } from '../lib/identity/staff-access';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from './task-window';
import { EmptyState, ErrorState } from './state-panels';

// Phase 6A identity support. One Person, one Auth identity: username, email and password changes
// never create another Person and never grant memberships. The server decides the scope
// (Platform support or tenant) on every call; this surface only offers what that scope allows.
type Outcome = { summary: IdentitySummary | null; temporary?: string };
export async function identityRequest(command: IdentityCommand): Promise<Outcome> {
  const response = await sessionFetch('/api/identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(identityErrors[payload.error] ?? (response.status === 403 ? identityErrors.identity_support_required : 'No se pudo completar la operación. Inténtalo de nuevo.'));
  const parsed = identityResponseSchema.safeParse(payload);
  if (!parsed.success) throw Error('No se pudo completar la operación. Inténtalo de nuevo.');
  return { summary: parsed.data.result, temporary: parsed.data.temporary_password };
}

type Task = 'username' | 'email' | 'temporary' | 'suspend' | null;
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' }) : 'Nunca';

export function IdentityCredentials({ initial }: { initial: IdentitySummary }) {
  const [identity, setIdentity] = useState(initial), [task, setTask] = useState<Task>(null);
  const platform = identity.support_scope === 'platform';
  const status = identity.login_suspended ? 'Inicio de sesión suspendido' : identity.must_change_password ? 'Debe crear su contraseña' : identity.email_confirmed ? 'Activo' : 'Pendiente de activación';
  return <section aria-labelledby="identity-title" className="space-y-4">
    <div className="card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 id="identity-title" className="text-xl font-black">{identity.display_name}</h2>
        <p className="text-sm text-slate-600">{platform ? 'Soporte de identidad de PIKAS. No otorga acceso a los datos del cliente.' : 'Acceso de inicio de sesión de esta persona.'}</p></div>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${identity.login_suspended ? 'bg-red-50 text-red-900' : identity.must_change_password ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'}`}>{status}</span></div>
      <TaskSummary rows={[
        ['Usuario', identity.username ?? <span className="font-normal text-slate-600">Sin usuario</span>],
        ['Correo', <span key="e" className="break-all">{isInternalEmail(identity.email) ? 'Sin correo · entra solo con su usuario' : identity.email ?? 'Sin correo'}</span>],
        ['Último inicio de sesión', when(identity.last_sign_in_at)],
        ...(identity.pending_email ? [['Cambio de correo pendiente', identity.pending_email] as [string, React.ReactNode]] : []),
      ]} />
      <div><h3 className="font-bold">Accesos</h3>
        {identity.memberships.length ? <ul className="mt-1 space-y-1 text-sm">{identity.memberships.map((m, i) => <li key={i}>{roleLabels[m.role] ?? m.role} · {m.name}{m.status !== 'active' ? ` (${m.status === 'inactive' ? 'inactivo' : 'pendiente'})` : ''}</li>)}</ul>
          : <p className="text-sm text-slate-600">Sin accesos asignados.</p>}
        <p className="mt-1 text-xs text-slate-600">Los accesos se gestionan en cada escuela o cafetería; aquí no se otorgan.</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => setTask('username')}>{identity.username ? 'Cambiar usuario' : 'Asignar usuario'}</button>
        <button type="button" className="btn-secondary" onClick={() => setTask('temporary')}>Emitir contraseña temporal</button>
        {platform && <button type="button" className="btn-secondary" onClick={() => setTask('email')}>Corregir correo</button>}
        {platform && <button type="button" className="btn-secondary" onClick={() => setTask('suspend')}>{identity.login_suspended ? 'Reactivar inicio de sesión' : 'Suspender inicio de sesión'}</button>}
      </div>
    </div>
    <section aria-labelledby="identity-audit" className="space-y-2"><h3 id="identity-audit" className="font-black">Historial de acceso</h3>
      {identity.audit.length ? <ol className="divide-y rounded-xl border bg-white text-sm">{identity.audit.map((e, i) => <li key={i} className="px-4 py-3">
        <p className="font-bold">{auditLabels[e.operation] ?? e.operation}{typeof e.metadata.to === 'string' ? `: ${e.metadata.to}` : ''}</p>
        <p className="text-slate-600">{when(e.occurred_at)} · {e.actor_scope === 'self' ? 'La propia persona' : `${e.actor_name}${e.actor_scope === 'platform' ? ' (PIKAS)' : ''}`}{e.reason ? ` · ${e.reason}` : ''}</p></li>)}</ol>
        : <EmptyState title="Sin cambios de acceso registrados." />}
    </section>
    {task && <IdentityTask key={task} task={task} identity={identity} onDone={next => { if (next) setIdentity(s => ({ ...next, support_scope: next.support_scope ?? s.support_scope })); }} onClose={() => setTask(null)} />}
  </section>;
}

function IdentityTask({ task, identity, onDone, onClose }: { task: Exclude<Task, null>; identity: IdentitySummary; onDone: (s: IdentitySummary | null) => void; onClose: () => void }) {
  const [value, setValue] = useState(task === 'username' ? identity.username ?? '' : ''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false), [temporary, setTemporary] = useState('');
  const suspend = !identity.login_suspended;
  const title = { username: identity.username ? 'Cambiar usuario' : 'Asignar usuario', email: 'Corregir correo', temporary: 'Emitir contraseña temporal', suspend: suspend ? 'Suspender inicio de sesión' : 'Reactivar inicio de sesión' }[task];
  const username = normalizeUsername(value), usernameOk = isValidUsername(username) && !username.includes('@');
  const ready = task === 'username' ? usernameOk && username !== identity.username : task === 'email' ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()) && reason.trim().length >= 3 : task === 'suspend' ? reason.trim().length >= 3 : true;
  const run = async () => {
    setBusy(true); setError('');
    try {
      const command: IdentityCommand = task === 'username' ? { operation: 'set_username', person_id: identity.person_id, username, expected_version: identity.version }
        : task === 'email' ? { operation: 'change_email', person_id: identity.person_id, email: value.trim().toLowerCase(), reason: reason.trim() }
        : task === 'temporary' ? { operation: 'temporary_access', person_id: identity.person_id }
        : { operation: 'set_suspended', person_id: identity.person_id, suspended: suspend, reason: reason.trim() };
      const outcome = await identityRequest(command);
      onDone(outcome.summary); setTemporary(outcome.temporary ?? ''); setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la operación.'); }
    finally { setBusy(false); }
  };
  const close = () => { setTemporary(''); onClose(); };
  return <TaskWindow title={title} context={identity.display_name} busy={busy} dirty={!done && (task === 'username' ? value !== (identity.username ?? '') : !!value || !!reason)} onClose={close}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={close}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={busy || !ready} onClick={run}>{busy ? 'Guardando…' : task === 'temporary' ? 'Emitir contraseña' : 'Confirmar'}</button></TaskActions>}>
    {done ? task === 'temporary'
      ? <TaskOutcome kind="success" title="Contraseña temporal emitida">
          <p>Entrégala a {identity.display_name} por un canal seguro. Al entrar deberá crear su propia contraseña.</p>
          <p className="rounded-lg border bg-white p-3 text-center font-mono text-xl font-black tracking-wider" aria-label="Contraseña temporal">{temporary}</p>
          <p className="text-sm font-bold">Cópiala ahora: PIKAS no la guarda y no se volverá a mostrar.</p>
        </TaskOutcome>
      : <TaskOutcome kind="success" title={task === 'username' ? 'Usuario guardado' : task === 'email' ? 'Correo corregido' : suspend ? 'Inicio de sesión suspendido' : 'Inicio de sesión reactivado'}>
          <p>{task === 'username' ? `Ya puede entrar con «${username}» o con su correo.` : task === 'email' ? 'Es la misma cuenta y la misma persona; solo cambió el correo de acceso y recuperación.' : suspend ? 'Las sesiones abiertas terminaron. Sus accesos no cambiaron.' : 'Ya puede iniciar sesión con sus credenciales.'}</p>
        </TaskOutcome>
    : <>
      {task === 'username' && <label className="block font-bold">Usuario<input data-autofocus className="field mt-1" value={value} onChange={e => setValue(e.target.value)} autoCapitalize="none" spellCheck={false} maxLength={40} aria-describedby="username-rules" />
        <span id="username-rules" className="mt-1 block text-sm font-normal text-slate-600">{usernameRules} Podrá entrar con el usuario o con su correo.</span>
        {value && !usernameOk && <span className="mt-1 block text-sm text-red-800">Ese usuario no cumple las reglas.</span>}</label>}
      {task === 'email' && <><p className="text-sm text-slate-600">Cambia el correo de la MISMA cuenta (inicio de sesión y recuperación). No crea otra persona. Actual: <strong className="break-all">{identity.email}</strong></p>
        <label className="block font-bold">Correo correcto<input data-autofocus type="email" className="field mt-1" value={value} onChange={e => setValue(e.target.value)} autoCapitalize="none" /></label></>}
      {task === 'temporary' && <><p>Se generará una contraseña temporal para {identity.display_name}. Sus sesiones abiertas terminarán y, al entrar, deberá crear su propia contraseña.</p>
        <p className="text-sm text-slate-600">La contraseña se muestra una sola vez. PIKAS no la guarda ni la registra.</p></>}
      {task === 'suspend' && <p>{suspend ? 'No podrá iniciar sesión y sus sesiones abiertas terminarán. Sus accesos y su historial no cambian.' : 'Podrá volver a iniciar sesión con sus credenciales actuales.'}</p>}
      {(task === 'email' || task === 'suspend') && <label className="block font-bold">Motivo<input className="field mt-1" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></label>}
      {error && <ErrorState title={error} />}
    </>}
  </TaskWindow>;
}

export function IdentitySearch() {
  const [identifier, setIdentifier] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<IdentitySummary | null | undefined>(undefined);
  return <div className="space-y-4">
    <form className="card flex flex-wrap items-end gap-3 p-4" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); setResult(undefined);
      try { setResult((await identityRequest({ operation: 'lookup', identifier: identifier.trim() })).summary); } catch (x) { setError(x instanceof Error ? x.message : 'No se pudo buscar.'); } finally { setBusy(false); } }}>
      <label className="block min-w-0 flex-1 font-bold">Correo o usuario exacto<input className="field mt-1" value={identifier} onChange={e => setIdentifier(e.target.value)} autoCapitalize="none" spellCheck={false} minLength={3} maxLength={254} required /></label>
      <button className="btn" disabled={busy}>{busy ? 'Buscando…' : 'Buscar'}</button>
      <p className="basis-full text-sm text-slate-600">Solo coincidencias exactas. Las identidades de la Plataforma no se gestionan aquí.</p>
    </form>
    {error && <ErrorState title={error} />}
    {result === null && <EmptyState title="No hay una identidad con ese correo o usuario." description="Revisa que esté escrito completo." />}
    {result && <IdentityCredentials key={result.person_id} initial={result} />}
  </div>;
}

// Tenant entry (Personal POS): the identity behind one membership row. The server allows it only
// when every role the person holds is managed by the signed-in administrator.
export function MemberCredentialsTask({ membershipId, name, onClose }: { membershipId: string; name: string; onClose: () => void }) {
  const [state, setState] = useState<{ summary?: IdentitySummary; error?: string }>({});
  useEffect(() => { let live = true;
    identityRequest({ operation: 'read_membership', membership_id: membershipId }).then(r => { if (live) setState(r.summary ? { summary: r.summary } : { error: 'No se encontró la identidad.' }); },
      e => { if (live) setState({ error: e instanceof Error ? e.message : 'No se pudo cargar.' }); });
    return () => { live = false; }; }, [membershipId]);
  return <TaskWindow title="Credenciales" context={name} onClose={onClose} footer={<TaskActions><TaskCancelButton>Cerrar</TaskCancelButton></TaskActions>}>
    {state.summary ? <IdentityCredentials initial={state.summary} /> : state.error ? <ErrorState title={state.error} /> : <p role="status">Cargando…</p>}
  </TaskWindow>;
}
