'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CafeteriaRead, Operation } from '../lib/cafeteria/contracts';
import { useCafeteriaMutation } from './connected-cafeteria-provider';
import { useCatalogEditor } from './cafeteria-editor-context';
import { CommandTask, type CommandResult } from './command-task';
import { TaskSummary } from './task-window';
import { useSessionDraft } from '../lib/session-draft';
import { ProvisioningUsernameField, usernameProblem } from './provisioning-username-field';
import { normalizeUsername } from '../lib/identity/username';
import { sessionFetch } from '../lib/auth/session-fetch';
import { isUsernameRejection, usernameRejectionMessage } from '../lib/identity/provisioning';
import { staffAccessErrors, staffAccessResponseSchema, suggestUsername, type StaffAccessResult } from '../lib/identity/staff-access';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskWindow } from './task-window';

export const roleLabel = (s: string) => s === 'pos_supervisor' ? 'Supervisor' : 'Cajero';
type Staff = CafeteriaRead['staff'][number];
type Register = CafeteriaRead['registers'][number];

// The cafeteria command path (one exact-request journal per actor and cafeteria) for CommandTask.
// A request left unconfirmed by ANOTHER task blocks this one: retrying here would resend that other
// request, so the user is sent back to confirm it first. Our own unconfirmed request is retried
// unchanged by the provider.
function useCafeteriaCommand() {
  const execute = useCafeteriaMutation(), { pendingMutation } = useCatalogEditor();
  const [foreignPending] = useState(!!pendingMutation);
  const submit = async (operation: Operation, payload: unknown): Promise<CommandResult> => {
    const result = await execute(operation, payload);
    return result.ok ? { kind: 'success' } : result.pending ? { kind: 'uncertain', message: result.message } : { kind: 'rejected', message: result.message };
  };
  return { submit, blocked: foreignPending ? 'Hay otra solicitud pendiente de confirmar en esta cafetería. Confírmala antes de hacer este cambio.' : undefined };
}

export function StaffPrepareTask({ data, onClose }: { data: CafeteriaRead; onClose: (message?: string) => void }) {
  const cafeteriaName = data.scope.cafeteria_name;
  const command = useCafeteriaCommand();
  const [email, setEmail] = useState(''), [role, setRole] = useState('pos_cashier'), [username, setUsername] = useState('');
  return <CommandTask title="Agregar personal POS" context={cafeteriaName}
    pages={[{ label: 'Acceso', content: <>
      {data.scope.tenant_kind !== 'sandbox' && <ProvisioningUsernameField value={username} onChange={setUsername} autoFocus />}
      <label className="block font-bold">Correo *<input className="field mt-1 w-full" type="email" required maxLength={254} data-autofocus={data.scope.tenant_kind === 'sandbox' || undefined} value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="block font-bold">Rol POS<select className="field mt-1 w-full" value={role} onChange={e => setRole(e.target.value)}><option value="pos_cashier">Cajero</option><option value="pos_supervisor">Supervisor</option></select></label>
      <p className="text-sm text-slate-600">Supervisor es un rol operativo y no concede administración. Las cajas se asignan después en Cajas.</p></> }]}
    validate={() => data.scope.tenant_kind === 'sandbox' ? null : usernameProblem(username)}
    review={<><TaskSummary rows={[...(data.scope.tenant_kind === 'sandbox' ? [] : [['Usuario', normalizeUsername(username)] as [string, React.ReactNode]]), ['Correo', email.trim()], ['Rol POS', roleLabel(role)], ['Cafetería', cafeteriaName]]} />
      <p className="text-sm text-slate-600">{data.scope.tenant_kind === 'sandbox' ? 'No se emiten enlaces de activación en sandbox. Solo puede completarse acceso para una identidad elegible ya existente.' : 'Preparar no concede acceso ni envía correo. Después generas un enlace privado de activación y confirmas este mismo acceso.'}</p></>}
    finalLabel="Preparar acceso" sendingLabel="Preparando acceso…" blocked={command.blocked} submit={() => command.submit('staff_prepare', data.scope.tenant_kind === 'sandbox' ? { email: email.trim(), role } : { email: email.trim(), role, username: normalizeUsername(username) })}
    dirty={!!email || !!username || role !== 'pos_cashier'} success={{ title: 'Acceso preparado', body: <p>Aparece en Accesos preparados con el usuario reservado. No se ha concedido acceso.</p>, closeMessage: 'Acceso POS preparado.' }} onClose={onClose} />;
}

// UX 12B: one-step POS staff access. Persona → Caja → Revisar → «Crear acceso». One request key for
// the task's lifetime: an uncertain result is retried with exactly the same key (the server replays
// each step). The one-time password is shown once, here only; it is never kept in component state
// after the task closes.
type AccessPhase = 0 | 1 | 'review' | 'sending' | 'success' | 'rejected' | 'uncertain';
type AccessOutcome = { result: StaffAccessResult; temporary?: string };
const emailOk = (value: string) => !value.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
const demoUsername = (u: string) => !u ? '' : u.endsWith('.demo') ? u : `${u.slice(0, 35).replace(/[._-]+$/, '')}.demo`;
export function StaffAccessTask({ data, onClose }: { data: CafeteriaRead; onClose: (message?: string) => void }) {
  const cafeteriaName = data.scope.cafeteria_name;
  const { pendingMutation } = useCatalogEditor(), router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [role, setRole] = useState('pos_cashier'), [username, setUsername] = useState(''), [touched, setTouched] = useState(false), [registerId, setRegisterId] = useState('');
  const [phase, setPhase] = useState<AccessPhase>(0), [problem, setProblem] = useState(''), [message, setMessage] = useState(''), [outcome, setOutcome] = useState<AccessOutcome | null>(null), [copied, setCopied] = useState('');
  const sending = useRef(false);
  const registers = data.registers.filter(r => r.status === 'active');
  // Demo Lab: inside the sandbox every username ends in «.demo» (the database refuses any other), so the suggestion carries it.
  const sandbox = data.scope.tenant_kind === 'sandbox';
  const suggested = sandbox ? demoUsername(suggestUsername(name)) : suggestUsername(name), effectiveUsername = normalizeUsername(touched ? username : suggested);
  const blocked = pendingMutation ? 'Hay otra solicitud pendiente de confirmar en esta cafetería. Confírmala antes de crear este acceso.' : '';
  const validate = (): string | null => !name.trim() ? 'Escribe el nombre completo.' : usernameProblem(effectiveUsername) ?? (sandbox && !effectiveUsername.endsWith('.demo') ? staffAccessErrors.sandbox_username_requires_demo_suffix : !emailOk(email) ? 'Ese correo no es válido. Déjalo vacío si no tiene.' : null);
  const send = async () => {
    if (sending.current || blocked) return;
    sending.current = true; setPhase('sending'); setMessage('');
    try {
      const response = await sessionFetch('/api/cafeteria/staff-access', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ cafeteriaId: data.scope.cafeteria_id, display_name: name.trim(), email: email.trim() ? email.trim().toLowerCase() : null, role, username: effectiveUsername, register_id: registerId || null }) });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        const parsed = staffAccessResponseSchema.safeParse(payload);
        if (!parsed.success) { setMessage(staffAccessErrors.operation_uncertain); setPhase('uncertain'); return; }
        setOutcome({ result: parsed.data.result, temporary: parsed.data.temporary_password }); setPhase('success'); return;
      }
      const code = typeof payload.error === 'string' ? payload.error : '';
      if (isUsernameRejection(code)) { setProblem(usernameRejectionMessage(code)); setTouched(true); setUsername(effectiveUsername); setPhase(0); return; }
      if (response.status >= 500 || code === 'operation_uncertain' || code === 'authorization_unavailable') { setMessage(staffAccessErrors.operation_uncertain); setPhase('uncertain'); return; }
      setMessage(staffAccessErrors[code] ?? 'No se pudo crear el acceso. Revisa los datos.'); setPhase('rejected');
    } catch { setMessage(staffAccessErrors.operation_uncertain); setPhase('uncertain'); }
    finally { sending.current = false; }
  };
  const next = (index: 0 | 1) => { if (index === 0) { const issue = validate(); if (issue) { setProblem(issue); return; } } setProblem(''); setPhase(index === 0 ? 1 : 'review'); };
  // After a success the server read is stale (new person, assignment, readiness): refresh it on close.
  const close = () => { const done = phase === 'success'; setOutcome(null); onClose(done ? 'Acceso POS creado.' : undefined); if (done) router.refresh(); };
  const registerName = (id: string | null | undefined) => registers.find(r => r.id === id)?.name ?? '';
  const editing = typeof phase === 'number' || phase === 'review';
  const footer = typeof phase === 'number'
    ? <>{phase > 0 ? <button type="button" className="btn-secondary" onClick={() => setPhase(0)}>Atrás</button> : <TaskCancelButton>Cancelar</TaskCancelButton>}<button type="button" className="btn" onClick={() => next(phase)}>Continuar</button></>
    : {
      review: <><button type="button" className="btn-secondary" onClick={() => setPhase(1)}>Atrás</button><button type="button" className="btn" disabled={!!blocked} onClick={() => void send()}>Crear acceso</button></>,
      sending: <button type="button" className="btn" disabled>Creando acceso…</button>,
      success: <button type="button" className="btn" data-autofocus onClick={close}>Cerrar</button>,
      rejected: <><button type="button" className="btn-secondary" onClick={close}>Cerrar</button><button type="button" className="btn" onClick={() => setPhase(0)}>Revisar datos</button></>,
      uncertain: <><button type="button" className="btn-secondary" onClick={close}>Cerrar</button><button type="button" className="btn" disabled={!!blocked} onClick={() => void send()}>Reintentar la misma solicitud</button></>,
    }[phase];
  const r = outcome?.result;
  return <TaskWindow title="Agregar personal POS" context={cafeteriaName} steps={editing ? ['Persona', 'Caja', 'Revisar'] : undefined} step={typeof phase === 'number' ? phase : 2}
    busy={phase === 'sending'} dirty={editing && (!!name || !!email || touched || !!registerId)} onClose={close} footer={<TaskActions>{footer}</TaskActions>}>
    <section hidden={phase !== 0} className="space-y-4">
      <p className="text-sm text-slate-600">Se crea el acceso en un paso: PIKAS sugiere el usuario, genera una contraseña temporal de un solo uso y concede el rol en {cafeteriaName}. No se envía correo.</p>
      <label className="block font-bold">Nombre completo *<input className="field mt-1 w-full" data-autofocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
      <label className="block font-bold">Rol POS<select className="field mt-1 w-full" value={role} onChange={e => setRole(e.target.value)}><option value="pos_cashier">Cajero</option><option value="pos_supervisor">Supervisor</option></select>
        <span className="mt-1 block text-sm font-normal text-slate-600">Supervisor es un rol operativo y no concede administración.</span></label>
      <ProvisioningUsernameField value={touched ? username : suggested} onChange={value => { setTouched(true); setUsername(value); }} />
      {!touched && suggested && <p className="text-sm text-slate-600">Sugerido por PIKAS a partir del nombre; puedes cambiarlo antes de confirmar.{sandbox ? ' En el Demo los usuarios terminan en «.demo».' : ''}</p>}
      <label className="block font-bold">Correo (opcional)<input className="field mt-1 w-full" type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} autoCapitalize="none" autoComplete="off" />
        <span className="mt-1 block text-sm font-normal text-slate-600">Sin correo, la persona entra solo con su usuario y no podrá recuperar la contraseña por correo; tú puedes emitirle una temporal desde Credenciales.</span></label>
    </section>
    <section hidden={phase !== 1} className="space-y-4">
      <p className="font-bold">Caja en {cafeteriaName}</p>
      {registers.length ? <fieldset className="space-y-2"><legend className="text-sm text-slate-600">La persona solo podrá abrir las cajas que tenga asignadas. Puedes cambiarlo después en Cajas.</legend>
        <label className="flex min-h-11 items-center gap-3"><input type="radio" name="staff-access-register" checked={registerId === ''} onChange={() => setRegisterId('')} /><span>Asignar después</span></label>
        {registers.map(reg => <label key={reg.id} className="flex min-h-11 items-center gap-3"><input type="radio" name="staff-access-register" checked={registerId === reg.id} onChange={() => setRegisterId(reg.id)} /><span>{reg.name} <span className="text-slate-500">· {reg.code}</span></span></label>)}</fieldset>
        : <p className="text-sm text-slate-600">Aún no hay cajas activas en esta cafetería. Crea una en Cajas y asigna a la persona desde allí.</p>}
    </section>
    {problem && typeof phase === 'number' && <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-800">{problem}</p>}
    {phase === 'review' && <><TaskSummary rows={[['Nombre', name.trim()], ['Rol POS', roleLabel(role)], ['Usuario', effectiveUsername], ['Correo', email.trim() ? email.trim().toLowerCase() : 'Sin correo · entra solo con su usuario'], ['Cafetería', cafeteriaName], ['Caja', registerId ? registerName(registerId) : 'Asignar después']]} />
      <p className="text-sm text-slate-600">Al confirmar se crea el inicio de sesión y verás una contraseña temporal una sola vez. La persona deberá crear su propia contraseña al entrar.</p>
      {blocked && <p role="alert" className="text-sm font-bold text-red-800">{blocked}</p>}</>}
    {phase === 'sending' && <TaskOutcome kind="pending" title="Creando acceso…"><p>No cierres esta ventana.</p></TaskOutcome>}
    {phase === 'success' && r && <TaskOutcome kind="success" title="Listo para iniciar sesión">
      <TaskSummary rows={[['Nombre', r.display_name], ['Usuario', r.username ?? effectiveUsername], ['Rol POS', roleLabel(r.role)], ['Cafetería', cafeteriaName],
        ['Caja', r.register ? (r.register.assigned ? registerName(r.register.register_id) : `No se pudo asignar ${registerName(r.register.register_id)}: asígnala en Cajas.`) : 'Sin caja asignada todavía: asígnala en Cajas.'],
        ['Correo', r.email_kind === 'real' ? email.trim().toLowerCase() : 'Sin correo · entra solo con su usuario']]} />
      {outcome.temporary ? <>
        <p className="font-bold">Contraseña temporal (una sola vez)</p>
        <p className="rounded-lg border bg-white p-3 text-center font-mono text-xl font-black tracking-wider" aria-label="Contraseña temporal">{outcome.temporary}</p>
        <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn-secondary" onClick={async () => { try { await navigator.clipboard.writeText(outcome.temporary ?? ''); setCopied('Contraseña copiada.'); } catch { setCopied('No se pudo copiar; selecciónala y cópiala a mano.'); } }}>Copiar contraseña</button>{copied && <span role="status" className="text-sm">{copied}</span>}</div>
        <p className="text-sm font-bold">Cópiala ahora: PIKAS no la guarda y no se volverá a mostrar. Vale 15 minutos si no se usa. Entrégala por un canal seguro.</p>
        <p className="text-sm">Cómo entra: en la pantalla de inicio de sesión escribe su usuario «{r.username ?? effectiveUsername}» y esta contraseña; PIKAS le pedirá crear una contraseña personal y luego podrá abrir su caja en el POS.</p>
      </> : <p>Esta persona ya tenía acceso a PIKAS y conserva su contraseña: solo se le concedió el rol en esta cafetería.</p>}
    </TaskOutcome>}
    {phase === 'rejected' && <TaskOutcome kind="failure" title="No se creó el acceso">{message && <p>{message}</p>}</TaskOutcome>}
    {phase === 'uncertain' && <TaskOutcome kind="uncertain" title="Pendiente de confirmar"><p>{message}</p><p className="text-sm">Si cierras sin confirmar, cualquier acceso preparado aparecerá en Personal POS.</p></TaskOutcome>}
  </TaskWindow>;
}

export function StaffStatusTask({ member, cafeteriaName, onClose }: { member: Staff; cafeteriaName: string; onClose: (message?: string) => void }) {
  const command = useCafeteriaCommand();
  const [status, setStatus] = useState<string>(member.status);
  const accessWord = (s: string) => ({ active: 'Activo', suspended: 'Suspendido (temporal)', inactive: 'Desactivado' })[s] ?? s;
  return <CommandTask title={`Cambiar acceso a ${cafeteriaName}`} context={`${member.name} · ${roleLabel(member.role)}`}
    pages={[{ label: 'Estado', content: <><label className="block font-bold">Acceso a {cafeteriaName}<select className="field mt-1 w-full" data-autofocus value={status} onChange={e => setStatus(e.target.value)}>{['active', 'suspended', 'inactive'].map(s => <option key={s} value={s}>{accessWord(s)}</option>)}</select></label>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700"><li><strong>Suspendido</strong>: temporal y reversible; no podrá abrir cajas ni vender en {cafeteriaName} mientras dure.</li><li><strong>Desactivado</strong>: deja de tener este rol aquí; la persona sigue existiendo y puede reactivarse si vuelve.</li><li>Solo afecta su acceso a esta cafetería: su usuario, su inicio de sesión en PIKAS y sus accesos en otros lugares no cambian (la suspensión global del inicio de sesión la hace PIKAS). Sus cajas asignadas, sesiones y ventas se conservan. Nada se elimina.</li></ul>
      {member.open && <p className="rounded-xl bg-amber-50 p-3 text-sm">Tiene una sesión abierta: suspender bloquea nuevas operaciones y conserva su cierre propio.</p>}</> }]}
    validate={() => status === member.status ? 'Elige un estado distinto del actual.' : null}
    review={<TaskSummary rows={[['Persona', member.name], ['Cafetería', cafeteriaName], ['Estado actual', accessWord(member.status)], ['Nuevo estado', accessWord(status)]]} />}
    finalLabel={status === 'active' ? `Reactivar acceso a ${cafeteriaName}` : status === 'suspended' ? `Suspender acceso a ${cafeteriaName}` : `Desactivar acceso a ${cafeteriaName}`} destructive={status !== 'active'} blocked={command.blocked} submit={() => command.submit('staff_status', { membership_id: member.id, status })}
    dirty={status !== member.status} success={{ title: 'Acceso POS actualizado', closeMessage: 'Acceso POS actualizado.' }} onClose={onClose} />;
}

// Register CONFIGURATION only (name, code, active state). It never opens, closes or changes a
// register session; the server keeps rejecting edits while a session is open.
export function RegisterTask({ data, register, onClose, reopen }: { data: CafeteriaRead; register?: Register; onClose: (message?: string) => void; reopen?: () => void }) {
  const cafeteriaName = data.scope.cafeteria_name;
  const command = useCafeteriaCommand(), { draftScope } = useCatalogEditor();
  const [id] = useState(() => register?.id ?? crypto.randomUUID());
  // The caja code is assigned by PIKAS (CAJA-NN) and is not operator-editable; edits keep it.
  const initial = { name: register?.name ?? '', status: register?.status ?? 'active' };
  const { values: v, set, restored, drop, discard } = useSessionDraft(draftScope ? registerDraftKey(draftScope, register?.id ?? null) : null, register?.version ?? null, initial, 'La caja cambió desde tu borrador; empezamos con la configuración guardada.');
  const payload = () => ({ id, version: register?.version ?? null, code: null, name: v.name.trim(), status: register ? v.status : 'active' });
  return <CommandTask title={register ? 'Editar caja' : 'Crear caja'} context={register ? register.name : cafeteriaName}
    pages={[{ label: 'Configuración', content: <>
      {restored && <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p className="flex-1 basis-56">{restored.note}</p>{restored.recovered && <button type="button" className="btn-secondary" onClick={discard}>Descartar borrador</button>}</div>}
      <label className="block font-bold">Nombre de caja *<input className="field mt-1 w-full" required maxLength={120} data-autofocus value={v.name} onChange={e => set('name', e.target.value)} /></label>
      {register ? <p className="text-sm"><span className="font-bold">Código de caja:</span> {register.code} <span className="text-slate-600">· asignado por PIKAS; aparece en el POS y en los recibos.</span></p>
        : <p className="text-sm text-slate-600">PIKAS asigna el código de la caja (por ejemplo, CAJA-01). Aparece en el POS, en el cierre de caja y en los recibos.</p>}
      {register && <label className="block font-bold">Estado<select className="field mt-1 w-full" value={v.status} onChange={e => set('status', e.target.value as 'active' | 'inactive')}><option value="active">Activa</option><option value="inactive">Inactiva</option></select>
        <span className="mt-1 block text-sm font-normal text-slate-600">Inactiva: no se pueden abrir sesiones nuevas en esta caja; sus sesiones, ventas y asignaciones anteriores se conservan como historial y puede reactivarse después. Una caja con historial nunca se elimina.</span></label>}
      <p className="text-sm text-slate-600">Solo cambia la configuración. No abre, cierra ni modifica sesiones de caja; una sesión abierta bloquea los cambios.</p></> }]}
    validate={() => register && JSON.stringify(v) === JSON.stringify(initial) ? 'No hay cambios para guardar.' : null}
    review={<TaskSummary rows={[['Nombre', v.name.trim()], ['Código', register ? register.code : 'Lo asigna PIKAS (CAJA-NN)'], ['Estado', register ? (v.status === 'active' ? 'Activa' : 'Inactiva') : 'Activa']]} />}
    finalLabel={register ? 'Guardar caja' : 'Crear caja'} blocked={command.blocked} submit={() => command.submit('register_save', payload())}
    dirty={JSON.stringify(v) !== JSON.stringify(initial)} onKeepDraft={draftScope ? () => onClose() : undefined} onDiscard={drop} onSucceeded={drop}
    success={{ title: register ? 'Caja actualizada' : 'Caja creada', body: !register ? <p>PIKAS le asignó su código; lo verás en la lista de cajas. Asigna personal autorizado desde esa lista.</p> : undefined, actions: !register && reopen ? <button type="button" className="btn-secondary" onClick={reopen}>Crear otra caja</button> : undefined, closeMessage: register ? 'Caja actualizada.' : 'Caja creada.' }} onClose={onClose} />;
}
export const registerDraftKey = (scope: string, registerId: string | null) => `pikas:register-draft:${scope}:${registerId ?? 'new'}`;
