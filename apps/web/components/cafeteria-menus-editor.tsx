"use client";
import { AppPageHeader } from './app-page-header';
import { useRef, useState } from 'react';
import Link from 'next/link';
import type { CafeteriaMenu, MenuEditSnapshot, ServiceShift } from '@pikas/data-access';
import { useCatalogEditor } from './cafeteria-editor-context';
import { ProductImage } from './product-image';
import { EmptyState } from './state-panels';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskWindow } from './task-window';
const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const money = (minor: number) => new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(minor / 100);
const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');

// Menús reference catalog products by ID (no copies); Turnos are schedules that point at one menu.
// Wave D.2: editors are focused tasks over the page; the same commands and data model are used.
export function CafeteriaMenusEditor({ shifts = false }: { shifts?: boolean }) {
  const { state, connection, adminSetServiceScheduling, connected, scope, timeZone } = useCatalogEditor();
  const operations = state.cafeteriaOperations;
  const [menuEditor, setMenuEditor] = useState<{ id: string; expected?: MenuEditSnapshot } | null>(null);
  const [shiftEditor, setShiftEditor] = useState<{ id: string; expected?: ServiceShift } | null>(null);
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirmManual, setConfirmManual] = useState(false);
  const pending = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const close = (message?: string) => { setMenuEditor(null); setShiftEditor(null); if (message) setNotice(message); };
  const toggleScheduling = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setConfirmManual(false);
    try { const result = await adminSetServiceScheduling(!operations.serviceSettings.enabled, operations.serviceSettings.enabled); if (!result.ok) setError(result.message); else setNotice(operations.serviceSettings.enabled ? 'Modo manual activado.' : 'Programación activada.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <>
    <AppPageHeader headingRef={heading} title={shifts ? 'Turnos de servicio' : 'Menús'} description={shifts ? timeZone ? `Organiza los horarios de atención en ${timeZone}.` : 'Organiza los horarios de atención en la hora de Santo Domingo.' : 'Agrupa productos del catálogo sin duplicarlos.'}
      action={shifts ? <button className="btn" disabled={!operations.menus.length || connection !== 'Online'} onClick={() => { setNotice(''); setShiftEditor({ id: crypto.randomUUID() }); }}>Crear turno de servicio</button>
        : <button className="btn" disabled={connection !== 'Online'} onClick={() => { setNotice(''); setMenuEditor({ id: crypto.randomUUID() }); }}>Crear menú</button>} />
    <nav aria-label="Menús y servicio" className="my-5 flex gap-2"><Link className={shifts ? 'btn-secondary' : 'btn'} aria-current={!shifts ? 'page' : undefined} href={connected ? `/admin/cafeteria/menus?cafeteria=${scope.locationId}` : "/admin/cafeteria/menus"}>Menús</Link><Link className={shifts ? 'btn' : 'btn-secondary'} aria-current={shifts ? 'page' : undefined} href={connected ? `/admin/cafeteria/menus/turnos?cafeteria=${scope.locationId}` : "/admin/cafeteria/menus/turnos"}>Turnos de servicio</Link></nav>
    {notice ? <p role="status" className="my-3 rounded-xl bg-emerald-50 p-3 text-emerald-900">{notice}</p> : null}
    {error ? <p role="alert" className="my-3 rounded-xl bg-red-50 p-3 text-red-800">{error}</p> : null}
    {shifts ? <>
      <section className="card mb-5 space-y-3 p-5"><div><h2 className="font-black">Turnos de servicio: {operations.serviceSettings.enabled ? 'ON' : 'OFF'}</h2><p className="mt-1 text-sm text-slate-600">{operations.serviceSettings.enabled ? 'Programación activada.' : 'Modo manual: todos los productos activos y disponibles. Los turnos conservan su configuración.'}</p><p className="mt-1 text-sm text-slate-600">ON limita el POS al menú del turno activo. OFF permite el catálogo manual. Siempre se requiere una sesión de caja abierta.</p></div>
        {confirmManual ? <div role="alertdialog" aria-label="Usar modo manual" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="font-bold">¿Usar catálogo manual sin restricciones de horario?</p><p className="text-sm">Se conservarán los turnos individuales.</p><div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => setConfirmManual(false)}>Cancelar</button><button className="btn" disabled={busy} onClick={() => void toggleScheduling()}>Usar modo manual</button></div></div>
          : <button role="switch" aria-label="Activar turnos de servicio" aria-checked={operations.serviceSettings.enabled} className="btn-secondary" disabled={busy || connection !== 'Online'} onClick={() => operations.serviceSettings.enabled ? setConfirmManual(true) : void toggleScheduling()}>{operations.serviceSettings.enabled ? 'Usar modo manual' : 'Activar programación'}</button>}
      </section>
      {!operations.menus.length ? <p className="mt-3">Crea un menú antes de asignar un turno de servicio.</p> : null}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">{operations.serviceShifts.map(shift => { const menu = operations.menus.find(menu => menu.id === shift.menuId); return <article key={shift.id} className="card flex flex-wrap items-center justify-between gap-4 p-5"><div className="min-w-0"><h2 className="break-words text-lg font-black">{shift.name}</h2><p>{shift.startTime}–{shift.endTime} · {shift.weekdays.map(day => days[day - 1]?.slice(0, 3)).join(', ')}</p><p className="break-words text-sm text-slate-600">Menú: {menu?.name ?? 'No disponible'}{menu && !menu.active ? ' · Menú inactivo: no ofrece productos' : ''}</p><span className="chip mt-2 inline-block">{shift.enabled ? 'Habilitado' : 'Deshabilitado'}</span></div><button className="btn-secondary" aria-label={`Editar turno ${shift.name}`} onClick={() => { setNotice(''); setShiftEditor({ id: shift.id, expected: structuredClone(shift) }); }}>Editar</button></article>; })}</div>
      {!operations.serviceShifts.length ? <EmptyState title="Aún no hay turnos de servicio." description="Añade el primer horario cuando estés listo." /> : null}
    </> : <>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">{operations.menus.map(menu => {
        const ids = operations.menuProducts.filter(link => link.menuId === menu.id).map(link => link.productId);
        const items = state.menuItems.filter(product => ids.includes(product.id));
        const saleable = items.filter(product => product.active !== false && product.available).length;
        return <article key={menu.id} className="card flex flex-col gap-3 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-black">{menu.name}</h2>{menu.description ? <p className="break-words text-sm text-slate-600">{menu.description}</p> : null}<p className="mt-1 text-sm">{ids.length} productos · {saleable} activos y disponibles</p></div><span className="chip">{menu.active ? 'Activo' : 'Inactivo'}</span></div>
          {items.length ? <ul className="flex flex-wrap gap-1.5" aria-label={`Productos de ${menu.name}`}>{items.slice(0, 6).map(p => <li key={p.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold">{p.name}</li>)}{items.length > 6 && <li className="rounded-full px-2 py-1 text-xs text-slate-600">+{items.length - 6} más</li>}</ul> : <p className="text-sm text-slate-600">Este menú todavía no tiene productos.</p>}
          <button className="btn-secondary self-start" aria-label={`Editar menú ${menu.name}`} onClick={() => { setNotice(''); setMenuEditor({ id: menu.id, expected: { menu: structuredClone(menu), productIds: ids } }); }}>Editar</button></article>;
      })}</div>
      {!operations.menus.length ? <EmptyState title="Aún no hay menús." description="Crea uno y selecciona productos del catálogo." /> : null}
    </>}
    {menuEditor && <MenuEditor key={menuEditor.id} {...menuEditor} close={close} />}
    {shiftEditor && <ShiftEditor key={shiftEditor.id} {...shiftEditor} close={close} />}
  </>;
}

function MenuEditor({ id, expected, close }: { id: string; expected?: MenuEditSnapshot; close: (message?: string) => void }) {
  const { state, adminSaveCafeteriaMenu, connection, scope } = useCatalogEditor();
  const [name, setName] = useState(expected?.menu.name ?? ''), [description, setDescription] = useState(expected?.menu.description ?? ''), [active, setActive] = useState(expected?.menu.active ?? true);
  const [selected, setSelected] = useState(expected?.productIds ?? []), [query, setQuery] = useState(''), [category, setCategory] = useState(''), [onlySelected, setOnlySelected] = useState(false), [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  const categories = [...new Set(state.menuItems.map(p => p.category))].sort((a, b) => a.localeCompare(b, 'es'));
  const products = state.menuItems.filter(product => (!onlySelected || selected.includes(product.id)) && (!category || product.category === category) && normalize(`${product.name} ${product.category}`).includes(normalize(query)));
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(products.length / 8) - 1));
  const dirty = name !== (expected?.menu.name ?? '') || description !== (expected?.menu.description ?? '') || active !== (expected?.menu.active ?? true) || JSON.stringify([...selected].sort()) !== JSON.stringify([...(expected?.productIds ?? [])].sort());
  const deactivating = !!expected?.menu.active && !active;
  const save = async () => {
    if (pending.current) return;
    if (!name.trim()) { setError('Escribe el nombre del menú.'); return; }
    const menu: CafeteriaMenu = { ...scope, id, name, description, active };
    pending.current = true; setBusy(true); setError('');
    try { const result = await adminSaveCafeteriaMenu(menu, selected, expected); if (!result.ok) setError(result.message); else close('Menú guardado.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <TaskWindow title={expected ? 'Editar menú' : 'Crear menú'} context={`${selected.length} ${selected.length === 1 ? 'producto seleccionado' : 'productos seleccionados'}`} busy={busy} dirty={dirty} onClose={() => close()}
    footer={<TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={busy || connection !== 'Online'} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar menú'}</button></TaskActions>}>
    <div className="grid gap-4 sm:grid-cols-2"><label className="font-bold">Nombre del menú<input data-autofocus aria-label="Nombre del menú" className="field mt-1" required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label><label className="font-bold">Descripción<textarea aria-label="Descripción del menú" className="field mt-1" maxLength={500} value={description} onChange={e => setDescription(e.target.value)} /></label></div>
    <label className="flex min-h-11 items-center gap-2 font-bold"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="size-5" />Menú activo</label>
    {deactivating && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-950">Al desactivar el menú, sus turnos conservan la configuración, pero el menú no ofrecerá productos.</p>}
    <section className="space-y-3 border-t pt-4"><div><h3 className="text-lg font-black">Productos del menú</h3><p className="text-sm text-slate-600">Elige productos del catálogo. El precio y la información se mantienen en Productos.</p></div>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]"><label className="min-w-0 text-sm font-bold">Buscar productos<input aria-label="Buscar productos para el menú" type="search" className="field mt-1" placeholder="Nombre o categoría" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
        <label className="text-sm font-bold">Categoría<select aria-label="Categoría de productos" className="field mt-1" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}><option value="">Todas</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label></div>
      <button type="button" className="btn-secondary" aria-pressed={onlySelected} onClick={() => { setOnlySelected(!onlySelected); setPage(0); }}>{onlySelected ? 'Ver todo el catálogo' : `Ver seleccionados (${selected.length})`}</button>
      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Productos del catálogo">{products.slice(pageIndex * 8, pageIndex * 8 + 8).map(product => { const checked = selected.includes(product.id); return <li key={product.id}><button type="button" aria-pressed={checked} aria-label={`${checked ? 'Quitar' : 'Añadir'} ${product.name}`}
        className={`flex w-full min-w-0 items-center gap-3 rounded-xl border p-2 text-left transition ${checked ? 'border-teal-700 bg-teal-50 ring-1 ring-teal-700' : 'hover:bg-slate-50'}`} onClick={() => setSelected(values => checked ? values.filter(value => value !== product.id) : [...values, product.id])}>
        <span className="w-12 shrink-0 overflow-hidden rounded-lg [&>div]:h-12 [&>div]:text-base"><ProductImage src={product.imageUrl} name={product.name} /></span>
        <span className="min-w-0 flex-1"><strong className="block break-words">{product.name}</strong><span className="block text-xs text-slate-600">{product.category} · {money(product.priceMinor)}{product.active === false ? ' · Inactivo' : product.available ? '' : ' · No disponible'}</span></span>
        <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full border text-sm font-black ${checked ? 'border-teal-700 bg-teal-700 text-white' : 'text-slate-500'}`}>{checked ? '✓' : '+'}</span></button></li>; })}</ul>
      {!products.length ? <p className="py-2">{onlySelected ? 'Este menú todavía no tiene productos.' : 'No hay productos para esta búsqueda.'}</p> : null}
      {products.length > 8 ? <div className="flex items-center justify-between gap-2"><button type="button" className="btn-secondary" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>Anterior</button><span className="text-sm">{pageIndex + 1} / {Math.ceil(products.length / 8)}</span><button type="button" className="btn-secondary" disabled={(pageIndex + 1) * 8 >= products.length} onClick={() => setPage(pageIndex + 1)}>Siguiente</button></div> : null}
    </section>
    {error ? <TaskOutcome kind="failure" title="No se guardó el menú"><p>{error}</p></TaskOutcome> : null}
  </TaskWindow>;
}

function ShiftEditor({ id, expected, close }: { id: string; expected?: ServiceShift; close: (message?: string) => void }) {
  const { state, connection, adminSaveServiceShift, scope, timeZone } = useCatalogEditor();
  const menus = state.cafeteriaOperations.menus;
  const [name, setName] = useState(expected?.name ?? ''), [menuId, setMenuId] = useState(expected?.menuId ?? menus.find(menu => menu.active)?.id ?? menus[0]?.id ?? '');
  const [start, setStart] = useState(expected?.startTime ?? ''), [end, setEnd] = useState(expected?.endTime ?? ''), [enabled, setEnabled] = useState(expected?.enabled ?? true);
  const [weekdays, setWeekdays] = useState<number[]>(expected?.weekdays ?? []), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  const dirty = name !== (expected?.name ?? '') || start !== (expected?.startTime ?? '') || end !== (expected?.endTime ?? '') || enabled !== (expected?.enabled ?? true) || JSON.stringify(weekdays) !== JSON.stringify(expected?.weekdays ?? []) || (!!expected && menuId !== expected.menuId);
  const save = async () => {
    if (pending.current) return;
    if (!name.trim() || !start || !end || !menuId) { setError('Completa el nombre, el menú y el horario.'); return; }
    const shift: ServiceShift = { ...scope, id, name, menuId, weekdays, startTime: start, endTime: end, enabled };
    pending.current = true; setBusy(true); setError('');
    try { const result = await adminSaveServiceShift(shift, expected); if (!result.ok) setError(result.message); else close('Turno de servicio guardado.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <TaskWindow title={expected ? 'Editar turno de servicio' : 'Crear turno de servicio'} context={`Horario del menú · ${timeZone ?? 'Santo Domingo (UTC−4)'}. Este turno no es una sesión de caja.`} busy={busy} dirty={dirty} onClose={() => close()}
    footer={<TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={busy || connection !== 'Online'} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar turno'}</button></TaskActions>}>
    <div className="grid gap-4 sm:grid-cols-2"><label className="font-bold">Nombre del turno<input data-autofocus aria-label="Nombre del turno" className="field mt-1" required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label><label className="font-bold">Menú<select aria-label="Menú del turno" className="field mt-1" required value={menuId} onChange={event => setMenuId(event.target.value)}>{menus.map(menu => <option key={menu.id} value={menu.id}>{menu.name}{menu.active ? '' : ' (inactivo)'}</option>)}</select></label></div>
    {menus.find(menu => menu.id === menuId)?.active === false ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900">Este menú está inactivo. El turno conservará su horario, pero no ofrecerá productos hasta que actives el menú.</p> : null}
    <fieldset><legend className="font-bold">Días de servicio</legend><div className="mt-2 flex flex-wrap gap-2">{days.map((day, index) => <label key={day} className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 ${weekdays.includes(index + 1) ? 'border-teal-700 bg-teal-50' : ''}`}><input type="checkbox" checked={weekdays.includes(index + 1)} onChange={event => setWeekdays(values => event.target.checked ? [...values, index + 1].sort((a, b) => a - b) : values.filter(value => value !== index + 1))} />{day}</label>)}</div></fieldset>
    <div className="grid gap-4 sm:grid-cols-2"><label className="font-bold">Hora de inicio<input type="time" aria-label="Hora de inicio" className="field mt-1" required value={start} onChange={e => setStart(e.target.value)} /></label><label className="font-bold">Hora de fin<input type="time" aria-label="Hora de fin" className="field mt-1" required value={end} onChange={e => setEnd(e.target.value)} /></label></div>
    <p className="text-sm text-slate-600">Inicio incluido y fin excluido. Los horarios consecutivos están permitidos; los superpuestos y nocturnos no.</p>
    <label className="flex min-h-11 items-center gap-2 font-bold"><input type="checkbox" className="size-5" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Turno habilitado</label>
    {error ? <TaskOutcome kind="failure" title="No se guardó el turno"><p>{error}</p></TaskOutcome> : null}
  </TaskWindow>;
}
