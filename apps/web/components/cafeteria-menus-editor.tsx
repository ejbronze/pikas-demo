"use client";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { CafeteriaMenu, MenuEditSnapshot, ServiceShift } from '@pikas/data-access';
import { useCatalogEditor } from './cafeteria-editor-context';
import { ProductImage } from './product-image';
const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const money = (minor: number) => new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(minor / 100);
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
export function CafeteriaMenusEditor({ shifts = false }: { shifts?: boolean }) {
  const { state, connection, adminSetServiceScheduling, connected, scope, timeZone } = useCatalogEditor();
  const operations = state.cafeteriaOperations;
  const [menuEditor, setMenuEditor] = useState<{ id: string; expected?: MenuEditSnapshot } | null>(null);
  const [shiftEditor, setShiftEditor] = useState<{ id: string; expected?: ServiceShift } | null>(null);
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const close = (message?: string) => { setMenuEditor(null); setShiftEditor(null); if (message) setNotice(message); requestAnimationFrame(() => heading.current?.focus()); };
  if (menuEditor) return <MenuEditor key={menuEditor.id} {...menuEditor} close={close} />;
  if (shiftEditor) return <ShiftEditor key={shiftEditor.id} {...shiftEditor} close={close} />;
  return <>
    <p className="label">Administración de cafetería</p><h1 ref={heading} tabIndex={-1} className="text-3xl font-black">{shifts ? 'Turnos de servicio' : 'Menús'}</h1>
    <p className="mt-2 text-slate-600">{shifts ? timeZone ? `Organiza los horarios de atención en ${timeZone}.` : 'Organiza los horarios de atención en la hora de Santo Domingo.' : 'Agrupa productos del catálogo sin duplicarlos.'}</p>
    <nav aria-label="Menús y servicio" className="my-5 flex gap-2"><Link className={shifts ? 'btn-secondary' : 'btn'} aria-current={!shifts ? 'page' : undefined} href={connected ? `/admin/cafeteria/menus?cafeteria=${scope.locationId}` : "/admin/cafeteria/menus"}>Menús</Link><Link className={shifts ? 'btn' : 'btn-secondary'} aria-current={shifts ? 'page' : undefined} href={connected ? `/admin/cafeteria/menus/turnos?cafeteria=${scope.locationId}` : "/admin/cafeteria/menus/turnos"}>Turnos de servicio</Link></nav>
    {notice ? <p role="status" className="my-3 rounded-xl bg-emerald-50 p-3 text-emerald-900">{notice}</p> : null}
    {error ? <p role="alert" className="my-3 rounded-xl bg-red-50 p-3 text-red-800">{error}</p> : null}
    {shifts ? <>
      <section className="card mb-5 flex flex-wrap items-center justify-between gap-4 p-5"><div><h2 className="font-black">Turnos de servicio: {operations.serviceSettings.enabled ? 'ON' : 'OFF'}</h2><p className="mt-1 text-sm text-slate-600">{operations.serviceSettings.enabled ? 'Programación activada.' : 'Modo manual: todos los productos activos y disponibles. Los turnos conservan su configuración.'}</p><p className="mt-1 text-sm text-slate-600">ON limita el POS al menú del turno activo. OFF permite el catálogo manual. Siempre se requiere una sesión de caja abierta.</p></div><button role="switch" aria-label="Activar turnos de servicio" aria-checked={operations.serviceSettings.enabled} className="btn-secondary" disabled={busy || connection !== 'Online'} onClick={async () => {
        if (pending.current) return;
        if (operations.serviceSettings.enabled && !confirm('¿Usar catálogo manual sin restricciones de horario? Se conservarán los turnos individuales.')) return;
        pending.current = true; setBusy(true); setError('');
        try { const result = await adminSetServiceScheduling(!operations.serviceSettings.enabled, operations.serviceSettings.enabled); if (!result.ok) setError(result.message); else setNotice(operations.serviceSettings.enabled ? 'Modo manual activado.' : 'Programación activada.'); }
        finally { pending.current = false; setBusy(false); }
      }}>{operations.serviceSettings.enabled ? 'Usar modo manual' : 'Activar programación'}</button></section>
      <button className="btn" disabled={!operations.menus.length || connection !== 'Online'} onClick={() => { setNotice(''); setShiftEditor({ id: crypto.randomUUID() }); }}>Crear turno de servicio</button>
      {!operations.menus.length ? <p className="mt-3">Crea un menú antes de asignar un turno de servicio.</p> : null}
      <div className="mt-4 space-y-3">{operations.serviceShifts.map(shift => { const menu = operations.menus.find(menu => menu.id === shift.menuId); return <article key={shift.id} className="card flex flex-wrap items-center justify-between gap-4 p-5"><div className="min-w-0"><h2 className="break-words text-lg font-black">{shift.name}</h2><p>{shift.startTime}–{shift.endTime} · {shift.weekdays.map(day => days[day - 1]?.slice(0, 3)).join(', ')}</p><p className="break-words text-sm text-slate-600">Menú: {menu?.name ?? 'No disponible'}{menu && !menu.active ? ' · Menú inactivo: no ofrece productos' : ''}</p><span className="chip mt-2 inline-block">{shift.enabled ? 'Habilitado' : 'Deshabilitado'}</span></div><button className="btn-secondary" aria-label={`Editar turno ${shift.name}`} onClick={() => setShiftEditor({ id: shift.id, expected: structuredClone(shift) })}>Editar</button></article>; })}</div>
      {!operations.serviceShifts.length ? <p className="card mt-4 p-5">Aún no hay turnos de servicio. Añade el primer horario cuando estés listo.</p> : null}
    </> : <>
      <button className="btn" disabled={connection !== 'Online'} onClick={() => { setNotice(''); setMenuEditor({ id: crypto.randomUUID() }); }}>Crear menú</button>
      <div className="mt-4 space-y-3">{operations.menus.map(menu => {
        const ids = operations.menuProducts.filter(link => link.menuId === menu.id).map(link => link.productId);
        const saleable = state.menuItems.filter(product => ids.includes(product.id) && product.active !== false && product.available).length;
        return <article key={menu.id} className="card flex flex-wrap items-center justify-between gap-4 p-5"><div className="min-w-0"><h2 className="break-words text-lg font-black">{menu.name}</h2>{menu.description ? <p className="break-words text-sm text-slate-600">{menu.description}</p> : null}<p className="mt-2 text-sm">{ids.length} productos · {saleable} activos y disponibles</p><span className="chip mt-2 inline-block">{menu.active ? 'Activo' : 'Inactivo'}</span></div><button className="btn-secondary" aria-label={`Editar menú ${menu.name}`} onClick={() => setMenuEditor({ id: menu.id, expected: { menu: structuredClone(menu), productIds: ids } })}>Editar</button></article>;
      })}</div>
      {!operations.menus.length ? <p className="card mt-4 p-5">Aún no hay menús. Crea uno y selecciona productos del catálogo.</p> : null}
    </>}
  </>;
}

function MenuEditor({ id, expected, close }: { id: string; expected?: MenuEditSnapshot; close: (message?: string) => void }) {
  const { state, adminSaveCafeteriaMenu, connection, scope } = useCatalogEditor();
  const [selected, setSelected] = useState(expected?.productIds ?? []), [query, setQuery] = useState(''), [onlySelected, setOnlySelected] = useState(false), [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [dirty, setDirty] = useState(false);
  const pending = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const products = state.menuItems.filter(product => (!onlySelected || selected.includes(product.id)) && normalize(`${product.name} ${product.category}`).includes(normalize(query)));
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(products.length / 8) - 1));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (pending.current) return;
    const form = new FormData(event.currentTarget);
    const menu: CafeteriaMenu = { ...scope, id, name: String(form.get('name')), description: String(form.get('description') ?? ''), active: form.has('active') };
    if (expected?.menu.active && !menu.active && !confirm('¿Desactivar el menú? Sus turnos conservarán la configuración, pero el menú no ofrecerá productos.')) return;
    pending.current = true; setBusy(true); setError('');
    try { const result = await adminSaveCafeteriaMenu(menu, selected, expected); if (!result.ok) setError(result.message); else close('Menú guardado.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <><h1 ref={heading} tabIndex={-1} className="text-3xl font-black">{expected ? 'Editar menú' : 'Crear menú'}</h1><form onSubmit={submit} onChange={() => setDirty(true)} className="card mt-5 p-5"><fieldset disabled={busy} className="min-w-0 space-y-5">
    <div className="grid gap-4 sm:grid-cols-2"><label className="font-bold">Nombre del menú<input name="name" aria-label="Nombre del menú" className="field mt-1" required maxLength={120} defaultValue={expected?.menu.name ?? ''} /></label><label className="font-bold">Descripción<textarea name="description" aria-label="Descripción del menú" className="field mt-1" maxLength={500} defaultValue={expected?.menu.description ?? ''} /></label></div>
    <label className="flex items-center gap-2 font-bold"><input type="checkbox" name="active" defaultChecked={expected?.menu.active ?? true} className="size-5" />Menú activo</label>
    <section className="border-t pt-4"><h2 className="text-lg font-black">Productos del menú</h2><p className="text-sm text-slate-600">{selected.length} seleccionados. El precio y la información se mantienen en Productos.</p>
      <div className="my-3 flex flex-wrap items-center gap-3"><label className="min-w-0 flex-1">Buscar productos<input aria-label="Buscar productos para el menú" className="field mt-1" placeholder="Nombre o categoría" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label><button type="button" className="btn-secondary" aria-pressed={onlySelected} onClick={() => { setOnlySelected(!onlySelected); setPage(0); }}>{onlySelected ? 'Ver todo el catálogo' : 'Ver seleccionados'}</button></div>
      <div className="grid gap-2 lg:grid-cols-2">{products.slice(pageIndex * 8, pageIndex * 8 + 8).map(product => { const checked = selected.includes(product.id); return <div key={product.id} className={`flex min-w-0 flex-wrap items-center gap-3 rounded-xl border p-3 ${checked ? 'border-teal-700 bg-teal-50' : ''}`}><div className="w-14 shrink-0 overflow-hidden rounded-lg [&>div]:h-14"><ProductImage src={product.imageUrl} name={product.name} /></div><div className="min-w-0 flex-1 basis-24"><strong className="block break-words">{product.name}</strong><p className="break-words text-sm">{product.category} · {money(product.priceMinor)}</p><p className="text-xs text-slate-600">{product.active === false ? 'Inactivo' : 'Activo'} · {product.available ? 'Disponible' : 'No disponible'}</p></div><button type="button" className="btn-secondary" aria-label={`${checked ? 'Quitar' : 'Añadir'} ${product.name}`} aria-pressed={checked} onClick={() => { setDirty(true); setSelected(values => checked ? values.filter(value => value !== product.id) : [...values, product.id]); }}>{checked ? 'Quitar' : 'Añadir'}</button></div>; })}</div>
      {!products.length ? <p className="py-4">No hay productos para esta búsqueda.</p> : null}
      {products.length > 8 ? <div className="mt-3 flex items-center justify-between gap-2"><button type="button" className="btn-secondary" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>Anterior</button><span className="text-sm">{pageIndex + 1} / {Math.ceil(products.length / 8)}</span><button type="button" className="btn-secondary" disabled={(pageIndex + 1) * 8 >= products.length} onClick={() => setPage(pageIndex + 1)}>Siguiente</button></div> : null}
    </section>
    {error ? <p role="alert" className="text-red-800">{error}</p> : null}
    <div className="flex flex-wrap justify-end gap-3 border-t pt-4"><button type="button" className="btn-secondary" onClick={() => { if (!dirty || confirm('¿Descartar los cambios sin guardar?')) close(); }}>Cancelar</button><button className="btn" disabled={connection !== 'Online'}>{busy ? 'Guardando…' : 'Guardar menú'}</button></div>
  </fieldset></form></>;
}

function ShiftEditor({ id, expected, close }: { id: string; expected?: ServiceShift; close: (message?: string) => void }) {
  const { state, connection, adminSaveServiceShift, scope, timeZone } = useCatalogEditor();
  const menus = state.cafeteriaOperations.menus;
  const [menuId, setMenuId] = useState(expected?.menuId ?? menus.find(menu => menu.active)?.id ?? menus[0]?.id ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(expected?.weekdays ?? []), [busy, setBusy] = useState(false), [error, setError] = useState(''), [dirty, setDirty] = useState(false);
  const pending = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (pending.current) return;
    const form = new FormData(event.currentTarget);
    const shift: ServiceShift = { ...scope, id, name: String(form.get('name')), menuId, weekdays, startTime: String(form.get('start')), endTime: String(form.get('end')), enabled: form.has('enabled') };
    pending.current = true; setBusy(true); setError('');
    try { const result = await adminSaveServiceShift(shift, expected); if (!result.ok) setError(result.message); else close('Turno de servicio guardado.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <><h1 ref={heading} tabIndex={-1} className="text-3xl font-black">{expected ? 'Editar turno de servicio' : 'Crear turno de servicio'}</h1><p className="mt-2 text-slate-600">Horario del menú · {timeZone ?? 'Santo Domingo (UTC−4)'}. Este turno no es una sesión de caja.</p><form onSubmit={submit} onChange={() => setDirty(true)} className="card mt-5 p-5"><fieldset disabled={busy} className="min-w-0 space-y-5">
    <div className="grid gap-4 sm:grid-cols-2"><label className="font-bold">Nombre del turno<input name="name" aria-label="Nombre del turno" className="field mt-1" required maxLength={120} defaultValue={expected?.name ?? ''} /></label><label className="font-bold">Menú<select aria-label="Menú del turno" className="field mt-1" required value={menuId} onChange={event => setMenuId(event.target.value)}>{menus.map(menu => <option key={menu.id} value={menu.id}>{menu.name}{menu.active ? '' : ' (inactivo)'}</option>)}</select></label></div>
    {menus.find(menu => menu.id === menuId)?.active === false ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900">Este menú está inactivo. El turno conservará su horario, pero no ofrecerá productos hasta que actives el menú.</p> : null}
    <fieldset><legend className="font-bold">Días de servicio</legend><div className="mt-2 flex flex-wrap gap-2">{days.map((day, index) => <label key={day} className="flex min-h-11 items-center gap-2 rounded-xl border px-3"><input type="checkbox" checked={weekdays.includes(index + 1)} onChange={event => setWeekdays(values => event.target.checked ? [...values, index + 1].sort((a, b) => a - b) : values.filter(value => value !== index + 1))} />{day}</label>)}</div></fieldset>
    <div className="grid gap-4 sm:grid-cols-2"><label className="font-bold">Hora de inicio<input type="time" name="start" aria-label="Hora de inicio" className="field mt-1" required defaultValue={expected?.startTime ?? ''} /></label><label className="font-bold">Hora de fin<input type="time" name="end" aria-label="Hora de fin" className="field mt-1" required defaultValue={expected?.endTime ?? ''} /></label></div>
    <p className="text-sm text-slate-600">Inicio incluido y fin excluido. Los horarios consecutivos están permitidos; los superpuestos y nocturnos no.</p>
    <label className="flex items-center gap-2 font-bold"><input name="enabled" type="checkbox" className="size-5" defaultChecked={expected?.enabled ?? true} />Turno habilitado</label>
    {error ? <p role="alert" className="text-red-800">{error}</p> : null}
    <div className="flex flex-wrap justify-end gap-3 border-t pt-4"><button type="button" className="btn-secondary" onClick={() => { if (!dirty || confirm('¿Descartar los cambios sin guardar?')) close(); }}>Cancelar</button><button className="btn" disabled={connection !== 'Online'}>{busy ? 'Guardando…' : 'Guardar turno'}</button></div>
  </fieldset></form></>;
}
