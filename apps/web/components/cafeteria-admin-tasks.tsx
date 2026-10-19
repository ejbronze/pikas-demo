'use client';
import { useState } from 'react';
import type { CafeteriaRead, Operation } from '../lib/cafeteria/contracts';
import { useCafeteriaMutation } from './connected-cafeteria-provider';
import { useCatalogEditor } from './cafeteria-editor-context';
import { CommandTask, type CommandResult } from './command-task';
import { TaskSummary } from './task-window';
import { useSessionDraft } from '../lib/session-draft';

const statusLabel = (s: string) => ({ active: 'Activo', inactive: 'Inactivo', suspended: 'Suspendido' })[s] ?? s;
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
  const command = useCafeteriaCommand();
  const [email, setEmail] = useState(''), [role, setRole] = useState('pos_cashier');
  return <CommandTask title="Agregar empleado POS" context={data.scope.cafeteria_name}
    pages={[{ label: 'Acceso', content: <>
      <label className="block font-bold">Correo *<input className="field mt-1 w-full" type="email" required maxLength={254} data-autofocus value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="block font-bold">Rol POS<select className="field mt-1 w-full" value={role} onChange={e => setRole(e.target.value)}><option value="pos_cashier">Cajero</option><option value="pos_supervisor">Supervisor</option></select></label>
      <p className="text-sm text-slate-600">Supervisor es un rol operativo y no concede administración. Las cajas se asignan después en Cajas.</p></> }]}
    review={<><TaskSummary rows={[['Correo', email.trim()], ['Rol POS', roleLabel(role)], ['Cafetería', data.scope.cafeteria_name]]} />
      <p className="text-sm text-slate-600">{data.scope.tenant_kind === 'sandbox' ? 'No se emiten enlaces de activación en sandbox. Solo puede completarse acceso para una identidad elegible ya existente.' : 'Preparar no concede acceso ni envía correo. Después generas un enlace privado de activación y confirmas este mismo acceso.'}</p></>}
    finalLabel="Preparar acceso" sendingLabel="Preparando acceso…" blocked={command.blocked} submit={() => command.submit('staff_prepare', { email: email.trim(), role })}
    dirty={!!email || role !== 'pos_cashier'} success={{ title: 'Acceso preparado', body: <p>Aparece en Accesos preparados. No se ha concedido acceso.</p>, closeMessage: 'Acceso POS preparado.' }} onClose={onClose} />;
}

export function StaffStatusTask({ member, onClose }: { member: Staff; onClose: (message?: string) => void }) {
  const command = useCafeteriaCommand();
  const [status, setStatus] = useState<string>(member.status);
  return <CommandTask title="Cambiar acceso POS" context={`${member.name} · ${roleLabel(member.role)}`}
    pages={[{ label: 'Estado', content: <><label className="block font-bold">Estado<select className="field mt-1 w-full" data-autofocus value={status} onChange={e => setStatus(e.target.value)}>{['active', 'suspended', 'inactive'].map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
      <p className="text-sm text-slate-600">El rol concedido y la identidad se conservan. Las cajas se asignan en Cajas.</p>
      {member.open && <p className="rounded-xl bg-amber-50 p-3 text-sm">Tiene una sesión abierta: suspender bloquea nuevas operaciones y conserva su cierre propio.</p>}</> }]}
    validate={() => status === member.status ? 'Elige un estado distinto del actual.' : null}
    review={<TaskSummary rows={[['Empleado', member.name], ['Estado actual', statusLabel(member.status)], ['Nuevo estado', statusLabel(status)]]} />}
    finalLabel={`Cambiar a ${statusLabel(status).toLowerCase()}`} destructive={status !== 'active'} blocked={command.blocked} submit={() => command.submit('staff_status', { membership_id: member.id, status })}
    dirty={status !== member.status} success={{ title: 'Acceso POS actualizado', closeMessage: 'Acceso POS actualizado.' }} onClose={onClose} />;
}

// Register CONFIGURATION only (name, code, active state). It never opens, closes or changes a
// register session; the server keeps rejecting edits while a session is open.
export function RegisterTask({ data, register, onClose, reopen }: { data: CafeteriaRead; register?: Register; onClose: (message?: string) => void; reopen?: () => void }) {
  const command = useCafeteriaCommand(), { draftScope } = useCatalogEditor();
  const [id] = useState(() => register?.id ?? crypto.randomUUID());
  const initial = { name: register?.name ?? '', code: register?.code ?? '', status: register?.status ?? 'active' };
  const { values: v, set, restored, drop, discard } = useSessionDraft(draftScope ? registerDraftKey(draftScope, register?.id ?? null) : null, register?.version ?? null, initial, 'La caja cambió desde tu borrador; empezamos con la configuración guardada.');
  const payload = () => ({ id, version: register?.version ?? null, code: v.code.trim(), name: v.name.trim(), status: register ? v.status : 'active' });
  return <CommandTask title={register ? 'Editar caja' : 'Crear caja'} context={register ? register.name : data.scope.cafeteria_name}
    pages={[{ label: 'Configuración', content: <>
      {restored && <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p className="flex-1 basis-56">{restored.note}</p>{restored.recovered && <button type="button" className="btn-secondary" onClick={discard}>Descartar borrador</button>}</div>}
      <label className="block font-bold">Nombre de caja *<input className="field mt-1 w-full" required maxLength={120} data-autofocus value={v.name} onChange={e => set('name', e.target.value)} /></label>
      <label className="block font-bold">Código de caja *<input className="field mt-1 w-full" required maxLength={32} readOnly={register?.has_history} value={v.code} onChange={e => set('code', e.target.value)} />{register?.has_history && <span className="mt-1 block text-sm font-normal text-slate-600">El código se conserva después del primer uso.</span>}</label>
      {register && <label className="block font-bold">Estado<select className="field mt-1 w-full" value={v.status} onChange={e => set('status', e.target.value as 'active' | 'inactive')}><option value="active">Activa</option><option value="inactive">Inactiva</option></select></label>}
      <p className="text-sm text-slate-600">Solo cambia la configuración. No abre, cierra ni modifica sesiones de caja; una sesión abierta bloquea los cambios.</p></> }]}
    validate={() => register && JSON.stringify(v) === JSON.stringify(initial) ? 'No hay cambios para guardar.' : null}
    review={<TaskSummary rows={[['Nombre', v.name.trim()], ['Código', v.code.trim()], ['Estado', register ? (v.status === 'active' ? 'Activa' : 'Inactiva') : 'Activa']]} />}
    finalLabel={register ? 'Guardar caja' : 'Crear caja'} blocked={command.blocked} submit={() => command.submit('register_save', payload())}
    dirty={JSON.stringify(v) !== JSON.stringify(initial)} onKeepDraft={draftScope ? () => onClose() : undefined} onDiscard={drop} onSucceeded={drop}
    success={{ title: register ? 'Caja actualizada' : 'Caja creada', body: !register ? <p>Asigna personal autorizado desde la lista de cajas.</p> : undefined, actions: !register && reopen ? <button type="button" className="btn-secondary" onClick={reopen}>Crear otra caja</button> : undefined, closeMessage: register ? 'Caja actualizada.' : 'Caja creada.' }} onClose={onClose} />;
}
export const registerDraftKey = (scope: string, registerId: string | null) => `pikas:register-draft:${scope}:${registerId ?? 'new'}`;
