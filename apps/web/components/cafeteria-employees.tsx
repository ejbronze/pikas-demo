'use client';
import { useState } from 'react';
import { hasScopedPermission, employeeInScope, employeeSnapshot, type PosEmployeeInput } from '@pikas/data-access';
import { useDemo } from './demo-provider';
const scope = { organizationId: 'cafeteria-demo', locationId: 'principal' };
const roles = { cashier: 'Cajero', supervisor: 'Supervisor' };
const statuses = { active: 'Activo', suspended: 'Suspendido', inactive: 'Inactivo' };
function EmployeeEditor({ initial, creating, onClose }: { initial: PosEmployeeInput; creating: boolean; onClose: () => void }) {
  const { state, adminSavePosEmployee, connection } = useDemo();
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const registers = state.cafeteriaOperations.registers.filter(r => r.organizationId === scope.organizationId && r.locationId === scope.locationId);
  const open = state.registerSessions.some(s => s.cashierId === draft.id && s.status === 'open' && s.organizationId === scope.organizationId && s.locationId === scope.locationId);
  return <section className="card p-4 sm:p-6" aria-label={creating ? 'Nuevo empleado POS' : 'Editar empleado POS'}>
    <h2 className="text-xl font-black">{creating ? 'Nuevo empleado POS' : 'Editar empleado POS'}</h2>
    <p className="mt-2 break-all text-xs text-slate-500">ID: {draft.id}</p>
    <form className="mt-4 space-y-4" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError('');
      const result = await adminSavePosEmployee(draft, creating ? undefined : initial);
      setBusy(false); if (result.ok) onClose(); else setError(result.message);
    }}>
      <fieldset disabled={busy || connection !== 'Online'} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="font-bold">Nombre<input className="field mt-1" required maxLength={120} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="font-bold">Correo<input className="field mt-1" type="email" required maxLength={254} value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} /></label>
          <label className="font-bold">Rol POS<select className="field mt-1" value={draft.posRole} onChange={e => setDraft({ ...draft, posRole: e.target.value as PosEmployeeInput['posRole'] })}>{Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="font-bold">Estado<select className="field mt-1" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as PosEmployeeInput['status'] })}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <fieldset><legend className="font-bold">Cajas permitidas</legend><div className="mt-2 flex flex-wrap gap-4">{registers.filter(r => r.active || draft.allowedRegisterIds.includes(r.id)).map(r => <label key={r.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={draft.allowedRegisterIds.includes(r.id)} onChange={e => setDraft({ ...draft, allowedRegisterIds: e.target.checked ? [...draft.allowedRegisterIds, r.id] : draft.allowedRegisterIds.filter(id => id !== r.id) })} />{r.name}{!r.active ? ' (inactiva)' : ''}</label>)}</div>{!registers.some(r => r.active) ? <p className="text-sm text-slate-500">No hay cajas activas para asignar.</p> : null}</fieldset>
        {!draft.allowedRegisterIds.length ? <p className="text-sm">Sin cajas asignadas: no podrá abrir caja ni vender.</p> : null}
        <p className="text-sm text-slate-600">Supervisor es un rol operativo. No concede administración, reembolsos especiales ni cierre de sesiones ajenas.</p>
        {open ? <p className="rounded-xl bg-amber-50 p-3 text-sm">Tiene una sesión abierta. Al suspenderlo, desactivarlo o retirar acceso a la caja, no podrá iniciar nuevas operaciones; conservará únicamente el cierre y la conciliación de su propia sesión.</p> : null}
        <button className="btn" type="submit">{busy ? 'Guardando…' : 'Guardar empleado'}</button>
      </fieldset>
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      <button className="btn-secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
    </form>
  </section>;
}
export function CafeteriaEmployees() {
  const { state, sessionRole, connection } = useDemo();
  const [query, setQuery] = useState(''), [role, setRole] = useState('all'), [status, setStatus] = useState('all');
  const [editing, setEditing] = useState<{ initial: PosEmployeeInput; creating: boolean } | null>(null);
  const employees = state.administration.users.filter(u => employeeInScope(u, scope));
  const visible = employees.filter(u => (role === 'all' || u.posRole === role) && (status === 'all' || u.status === status) && `${u.name} ${u.email} ${u.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  if (sessionRole !== 'cafeteria_admin') return <p role="status">Confirma tu sesión de Administración de cafetería.</p>;
  const manager = state.administration.users.find(u => u.id === 'ca-1');
  if (!manager || !hasScopedPermission(manager, state.administration.memberships, { kind: 'cafeteria', ...scope }, 'pos_users:manage')) return <p role="alert">No tienes acceso al personal de esta cafetería.</p>;
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="label">Administración de cafetería</p><h1 className="text-3xl font-black">Personal POS</h1><p className="mt-2 text-slate-600">Identidad, estado y acceso a cajas de los empleados.</p></div><button className="btn" disabled={connection !== 'Online' || !!editing} onClick={() => { setEditing({ creating: true, initial: { id: crypto.randomUUID(), name: '', email: '', posRole: 'cashier', status: 'active', allowedRegisterIds: [] } }); }}>Agregar empleado</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm">Demo local: no se envían invitaciones ni se crean contraseñas. El acceso POS de esta demo usa la identidad Caja Demo (pos-1); su nombre, rol, estado y cajas se gestionan aquí.</p>
    {connection !== 'Online' ? <p role="alert">Confirma la conexión antes de guardar cambios.</p> : null}
    {editing ? <EmployeeEditor key={editing.initial.id} {...editing} onClose={() => setEditing(null)} /> : null}
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="font-bold">Buscar empleados<input className="field mt-1" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre, correo o ID" /></label>
      <label className="font-bold">Filtrar por rol<select className="field mt-1" value={role} onChange={e => setRole(e.target.value)}><option value="all">Todos los roles</option>{Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="font-bold">Filtrar por estado<select className="field mt-1" value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todos los estados</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <p className="text-sm text-slate-500">{visible.length} de {employees.length} empleados</p>
    <div className="space-y-3">{visible.map(user => {
      const open = state.registerSessions.find(s => s.cashierId === user.id && s.status === 'open' && s.organizationId === scope.organizationId && s.locationId === scope.locationId);
      const registers = state.cafeteriaOperations.registers.filter(r => user.allowedRegisterIds?.includes(r.id) && r.organizationId === scope.organizationId && r.locationId === scope.locationId);
      return <article className="card min-w-0 p-4" key={user.id} aria-label={user.name}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-black">{user.name}</h2><p className="break-all text-sm">{user.email}</p></div><button className="btn-secondary" disabled={!!editing || connection !== 'Online'} onClick={() => { setEditing({ initial: employeeSnapshot(user), creating: false }); }} aria-label={`Editar ${user.name}`}>Editar</button></div>
        <p className="mt-2 font-bold">{roles[user.posRole ?? 'cashier']} · {statuses[user.status]}</p>
        <p className="mt-1 text-sm">Cajas: {registers.map(r => `${r.name}${r.active ? '' : ' (inactiva)'}`).join(', ') || 'Sin asignación'}</p>
        <p className="mt-1 text-sm">{open ? `Sesión abierta en ${open.registerName}${user.status !== 'active' || !registers.some(r => r.active && r.id === open.registerId) ? ' · Solo conciliación y cierre' : ''}` : user.status !== 'active' ? 'Operaciones bloqueadas' : registers.some(r => r.active) ? 'Sin sesión abierta' : 'Sin caja activa autorizada'}</p>
        <p className="mt-2 break-all text-xs text-slate-500">ID: {user.id}</p>
      </article>;
    })}{!visible.length ? <p className="card p-5">No hay empleados que coincidan.</p> : null}</div>
  </div>;
}
