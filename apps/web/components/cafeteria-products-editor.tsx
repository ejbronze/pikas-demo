"use client";

import { AppPageHeader } from './app-page-header';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseMoney, validateProduct, type PosMenuItemRecord } from '@pikas/data-access';
import { useCatalogEditor } from './cafeteria-editor-context';
import { ProductImage } from './product-image';
import { ProductImagePicker, type ProductImageValue } from './product-image-picker';
import { EmptyState } from './state-panels';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from './task-window';
import { ProductImportTask } from './product-import-task';
import { listSessionDrafts, useSessionDraft } from '../lib/session-draft';

const money = (minor: number) => new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(minor / 100);
const normalized = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');
const sorts = { name: ['Nombre A–Z', (a: PosMenuItemRecord, b: PosMenuItemRecord) => a.name.localeCompare(b.name, 'es')], nameDesc: ['Nombre Z–A', (a: PosMenuItemRecord, b: PosMenuItemRecord) => b.name.localeCompare(a.name, 'es')],
  price: ['Precio: menor a mayor', (a: PosMenuItemRecord, b: PosMenuItemRecord) => a.priceMinor - b.priceMinor || a.name.localeCompare(b.name, 'es')], priceDesc: ['Precio: mayor a menor', (a: PosMenuItemRecord, b: PosMenuItemRecord) => b.priceMinor - a.priceMinor || a.name.localeCompare(b.name, 'es')] } as const;
export const productDraftKey = (scope: string, productId: string | null) => `pikas:catalog-draft:${scope}:${productId ?? 'new'}`;

// Wave D.2 catalog workspace: the full catalog stays on the page; create, edit and import are focused tasks.
export function CafeteriaProductsEditor() {
  const { state, connection, connected, categories: savedCategories, draftScope, mutationBlocked } = useCatalogEditor();
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [status, setStatus] = useState(''), [sort, setSort] = useState<keyof typeof sorts>('name');
  const [editor, setEditor] = useState<{ id: string; product?: PosMenuItemRecord } | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const categories = useMemo(() => [...new Set([...(savedCategories ?? []), ...(connected ? [] : state.menuItems.map(item => item.category))])].sort((a, b) => a.localeCompare(b, 'es')), [savedCategories, connected, state.menuItems]);
  const menuCount = (id: string) => new Set(state.cafeteriaOperations.menuProducts.filter(link => link.productId === id).map(link => link.menuId)).size;
  const products = state.menuItems.filter(item => normalized(`${item.name} ${item.description} ${item.category}`).includes(normalized(query.trim())) && (!category || item.category === category)
    && (!status || (status === 'active' ? item.active !== false : status === 'inactive' ? item.active === false : status === 'available' ? item.available : !item.available))).sort(sorts[sort][1]);
  const filtered = !!(query.trim() || category || status);
  const refreshDrafts = () => { if (draftScope) setDrafts(listSessionDrafts(`pikas:catalog-draft:${draftScope}:`)); };
  useEffect(() => { queueMicrotask(refreshDrafts); }, [draftScope]); // eslint-disable-line react-hooks/exhaustive-deps -- read once per scope
  const openEditor = (product?: PosMenuItemRecord) => { setNotice(''); setEditor({ id: product?.id ?? crypto.randomUUID(), product: product && structuredClone(product) }); };
  const close = (message?: string) => { setEditor(null); setImporting(false); refreshDrafts(); if (message) setNotice(message); };
  const blocked = connection !== 'Online' || !!mutationBlocked;
  return <>
    <AppPageHeader headingRef={heading} title="Productos" description="Administra lo que ofrece tu cafetería: precios, disponibilidad e información alimentaria."
      action={<><button className="btn-secondary" disabled={blocked || !categories.length} title={!categories.length ? 'Crea una categoría antes de importar' : undefined} onClick={() => { setNotice(''); setImporting(true); }}>Importar CSV</button><button className="btn" disabled={blocked} onClick={() => openEditor()}>Agregar producto</button></>} />
    {notice ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-900">{notice}</p> : null}
    {connection !== 'Online' ? <p role="status" className="mt-4">Confirma la conexión para guardar cambios.</p> : null}
    {drafts.includes('new') && <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="flex-1 basis-60 text-sm"><strong>Tienes un producto nuevo sin guardar</strong> en esta sesión del navegador.</p><button className="btn-secondary" disabled={blocked} onClick={() => setEditor({ id: crypto.randomUUID() })}>Continuar borrador</button></div>}
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
      <label className="text-sm font-bold sm:col-span-2 lg:col-span-1">Buscar productos<input className="field mt-1" type="search" placeholder="Nombre, descripción o categoría" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="text-sm font-bold">Categoría<select aria-label="Categoría" className="field mt-1" value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas las categorías</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="text-sm font-bold">Estado<select aria-label="Estado" className="field mt-1" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos los estados</option><option value="active">Activos</option><option value="inactive">Inactivos</option><option value="available">Disponibles</option><option value="unavailable">No disponibles</option></select></label>
      <label className="text-sm font-bold">Ordenar<select aria-label="Ordenar" className="field mt-1" value={sort} onChange={e => setSort(e.target.value as keyof typeof sorts)}>{Object.entries(sorts).map(([value, [label]]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <div className="my-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600"><p aria-live="polite">{products.length} de {state.menuItems.length} productos</p>{filtered && products.length > 0 && <button className="min-h-11 font-bold underline" onClick={() => { setQuery(''); setCategory(''); setStatus(''); }}>Limpiar filtros</button>}</div>
    {!state.menuItems.length ? <EmptyState title="Aún no hay productos." description="Agrega el primer producto de esta cafetería o impórtalos desde un archivo CSV." action={<button className="btn" disabled={blocked} onClick={() => openEditor()}>Agregar producto</button>} />
      : !products.length ? <EmptyState title="No encontramos productos con estos filtros." description="Prueba otra búsqueda o limpia los filtros para ver todo el catálogo." action={<button className="btn-secondary" onClick={() => { setQuery(''); setCategory(''); setStatus(''); }}>Limpiar filtros</button>} />
      : <ul aria-label="Catálogo de productos" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {products.map(item => { const inactive = item.active === false, menus = menuCount(item.id); return <li key={item.id} className={`card flex min-w-0 overflow-hidden transition hover:shadow-md focus-within:ring-2 focus-within:ring-teal-600 ${inactive ? 'opacity-75' : ''}`}>
          <div className="w-24 shrink-0 [&>div]:h-full [&>div]:min-h-28"><ProductImage key={item.imageUrl ?? 'none'} src={item.imageUrl} name={item.name} /></div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
            <div className="flex min-w-0 items-start justify-between gap-2"><h2 className="min-w-0 break-words font-black leading-tight">{item.name}</h2><strong className="shrink-0 tabular-nums">{money(item.priceMinor)}</strong></div>
            <p className="text-xs text-slate-600">{item.category} · {item.unit ?? 'Unidad'}{menus ? ` · En ${menus} ${menus === 1 ? 'menú' : 'menús'}` : ''}</p>
            <div className="flex flex-wrap gap-1.5 text-xs font-bold">
              <span className={`rounded-full px-2 py-0.5 ${item.available && !inactive ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-700'}`}>{item.available ? 'Disponible' : 'No disponible'}</span>
              {inactive && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-700">Inactivo</span>}
              {drafts.includes(item.id) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">Borrador sin guardar</span>}
            </div>
            <button className="btn-secondary mt-auto self-start" aria-label={`Editar ${item.name}`} disabled={blocked} onClick={() => openEditor(item)}>Editar</button>
          </div>
        </li>; })}
      </ul>}
    {editor && <ProductTask key={editor.id} id={editor.id} product={editor.product} categories={categories} close={close} reopen={() => setEditor({ id: crypto.randomUUID() })} />}
    {importing && <ProductImportTask categories={categories} productNames={state.menuItems.map(p => p.name)} close={close} />}
  </>;
}

type Values = { name: string; categoryChoice: string; newCategory: string; price: string; unit: string; available: boolean; active: boolean; description: string; ingredients: string; allergens: string; restrictionTags: string };
type Phase = 'details' | 'review' | 'pending' | 'success' | 'failed';

// Create and edit share one non-financial task. Typed values may be kept as a browser-session draft
// (connected only: actor + cafeteria + product, never submitted automatically, cleared on save or discard).
function ProductTask({ id, product, categories, close, reopen }: { id: string; product?: PosMenuItemRecord; categories: string[]; close: (message?: string) => void; reopen: () => void }) {
  const { adminAddMenu, adminUpdateMenu, connection, connected, mutationBlocked, pendingMutation, recoverPending, draftScope } = useCatalogEditor();
  const initial: Values = { name: product?.name ?? '', categoryChoice: product && (!connected || categories.includes(product.category)) ? product.category : '', newCategory: '', price: product ? (product.priceMinor / 100).toFixed(2) : '',
    unit: product?.unit ?? 'Unidad', available: product?.available ?? true, active: product?.active !== false, description: product?.description ?? '', ingredients: product?.ingredients.join('\n') ?? '', allergens: product?.allergens.join('\n') ?? '', restrictionTags: product?.restrictionTags.join('\n') ?? '' };
  const key = draftScope ? productDraftKey(draftScope, product?.id ?? null) : null;
  const base = product?.catalogVersion ?? null;
  const { values, set, restored, drop: dropDraft, discard } = useSessionDraft<Values>(key, base, initial, 'El producto cambió desde tu borrador; empezamos con la versión guardada.');
  const [image, setImage] = useState<ProductImageValue>({ imageUrl: product?.imageUrl ?? null, imageAssetId: product?.imageAssetId ?? null }), [imageBusy, setImageBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('details'), [problem, setProblem] = useState(''), [failure, setFailure] = useState(''), [checked, setChecked] = useState<PosMenuItemRecord | null>(null);
  const submitting = useRef(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial) || image.imageUrl !== (product?.imageUrl ?? null);
  const lines = (text: string) => text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const review = () => {
    try {
      const priceMinor = parseMoney(values.price);
      if (priceMinor === null) throw new Error('Precio no válido. Usa un importe mayor o igual a RD$0, con hasta dos decimales y punto decimal.');
      const categoryName = connected && values.categoryChoice === '__new' ? values.newCategory : values.categoryChoice;
      if (!categoryName.trim()) throw new Error('Selecciona una categoría.');
      setChecked(validateProduct({ id, name: values.name, description: values.description, category: categoryName, unit: values.unit, priceMinor, ...image, ingredients: lines(values.ingredients), allergens: lines(values.allergens),
        restrictionTags: connected ? product?.restrictionTags ?? [] : lines(values.restrictionTags), active: values.active, available: values.available }, product));
      setProblem(''); setPhase('review');
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : 'Revisa los datos del producto.'); }
  };
  const save = async () => {
    if (!checked || submitting.current || mutationBlocked) return;
    submitting.current = true; setPhase('pending');
    try {
      const result = product ? await adminUpdateMenu(checked, product) : await adminAddMenu(checked);
      if (result.ok) { dropDraft(); setPhase('success'); } else { setFailure(result.message); setPhase('failed'); }
    } finally { submitting.current = false; }
  };
  const stopsSales = !!product && ((product.active !== false && checked?.active === false) || (product.available && checked?.available === false));
  const footer = {
    details: <><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={imageBusy} onClick={review}>Continuar</button></>,
    review: <><button type="button" className="btn-secondary" onClick={() => setPhase('details')}>Atrás</button><button type="button" className="btn" disabled={connection !== 'Online' || !!mutationBlocked} onClick={() => void save()}>{product ? 'Guardar cambios' : 'Crear producto'}</button></>,
    pending: <button type="button" className="btn" disabled>Guardando…</button>,
    success: <>{!product && <button type="button" className="btn-secondary" onClick={reopen}>Crear otro producto</button>}<button type="button" className="btn" data-autofocus onClick={() => close(product ? 'Producto actualizado.' : 'Producto creado.')}>Cerrar</button></>,
    failed: connected && pendingMutation ? <><button type="button" className="btn-secondary" onClick={() => close()}>Cerrar</button><button type="button" className="btn" onClick={async () => { if (!recoverPending || submitting.current) return; submitting.current = true; setPhase('pending'); try { const r = await recoverPending(); if (r.ok) { dropDraft(); setPhase('success'); } else { setFailure(r.message); setPhase('failed'); } } finally { submitting.current = false; } }}>Confirmar solicitud pendiente</button></>
      : <><button type="button" className="btn-secondary" onClick={() => close()}>Cerrar</button><button type="button" className="btn" onClick={() => setPhase('details')}>Revisar datos</button></>,
  }[phase];
  const preview = checked ?? product;
  return <TaskWindow title={phase === 'success' ? (product ? 'Producto actualizado' : 'Producto creado') : product ? 'Editar producto' : 'Agregar producto'} context={product ? product.name : 'Nuevo producto del catálogo'}
    steps={phase === 'details' || phase === 'review' ? ['Detalles', 'Revisar'] : undefined} step={phase === 'review' ? 1 : 0}
    busy={phase === 'pending'} dirty={(phase === 'details' || phase === 'review') && dirty} onClose={() => { dropDraft(); close(); }} onKeepDraft={key ? () => close() : undefined} footer={<TaskActions>{footer}</TaskActions>}>
    {phase === 'details' && <>
      {restored && <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p className="flex-1 basis-56">{restored.note}</p>{restored.recovered && <button type="button" className="btn-secondary" onClick={discard}>Descartar borrador</button>}</div>}
      <p className="text-sm text-slate-600">Los cambios se aplican a las ventas nuevas. Las compras anteriores conservan sus datos originales.</p>
      <label className="block font-bold">Nombre del producto *<input data-autofocus className="field mt-1" required maxLength={120} value={values.name} onChange={e => set('name', e.target.value)} /></label>
      {connected ? <><label className="block font-bold">Categoría *<select className="field mt-1" value={values.categoryChoice} onChange={e => set('categoryChoice', e.target.value)}><option value="" disabled>Seleccionar categoría</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}<option value="__new">Crear nueva categoría…</option></select></label>
        {values.categoryChoice === '__new' && <label className="block font-bold">Nombre de la nueva categoría *<input className="field mt-1" maxLength={80} value={values.newCategory} onChange={e => set('newCategory', e.target.value)} /></label>}</>
        : <label className="block font-bold">Categoría *<input className="field mt-1" maxLength={80} list="product-categories" value={values.categoryChoice} onChange={e => set('categoryChoice', e.target.value)} /><datalist id="product-categories">{categories.map(c => <option key={c} value={c} />)}</datalist></label>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="font-bold">Precio de venta (RD$) *<input className="field mt-1" inputMode="decimal" aria-describedby="price-help" value={values.price} onChange={e => set('price', e.target.value)} /><span id="price-help" className="mt-1 block text-sm font-normal text-slate-600">Ejemplo: 195.00. RD$0 es válido.</span></label>
        <label className="font-bold">Unidad *<input className="field mt-1" maxLength={40} value={values.unit} onChange={e => set('unit', e.target.value)} /></label></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex min-h-11 items-start gap-3 rounded-xl border p-3"><input className="mt-1 size-5" type="checkbox" role="switch" checked={values.available} onChange={e => set('available', e.target.checked)} /><span><strong>Disponible para la venta</strong><span className="block text-sm text-slate-600">Puede venderse ahora en el POS.</span></span></label>
        <label className="flex min-h-11 items-start gap-3 rounded-xl border p-3"><input className="mt-1 size-5" type="checkbox" checked={values.active} onChange={e => set('active', e.target.checked)} /><span><strong>Activo</strong><span className="block text-sm text-slate-600">Forma parte del catálogo operativo.</span></span></label>
      </div>
      <label className="block font-bold">Descripción<textarea className="field mt-1 min-h-24" aria-label="Descripción" maxLength={500} value={values.description} onChange={e => set('description', e.target.value)} /></label>
      <details className="rounded-xl border p-3"><summary className="flex min-h-11 cursor-pointer items-center font-bold">Información alimentaria</summary><p id="metadata-help" className="text-sm text-slate-600">Una entrada por línea. Se conservan al actualizar el producto.</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">{(connected ? [['ingredients', 'Ingredientes'], ['allergens', 'Alérgenos']] as const : [['ingredients', 'Ingredientes'], ['allergens', 'Alérgenos'], ['restrictionTags', 'Etiquetas alimentarias']] as const).map(([field, label]) => <label key={field} className="font-bold">{label}<textarea className="field mt-1 min-h-24" aria-label={label} aria-describedby="metadata-help" value={values[field]} onChange={e => set(field, e.target.value)} /></label>)}</div></details>
      {connected ? <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3"><div className="w-16 shrink-0 overflow-hidden rounded-lg [&>div]:h-16"><ProductImage src={null} name={values.name || 'Producto'} /></div><p className="text-sm text-slate-600"><strong className="block text-slate-800">Imagen del producto</strong>El catálogo y el POS muestran las iniciales del producto. La carga de fotos aún no está disponible en esta versión.</p></div>
        : <ProductImagePicker value={image} onChange={value => setImage(value)} onBusy={setImageBusy} />}
      {problem && <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-800">{problem}</p>}
    </>}
    {phase === 'review' && checked && <>
      <div className="flex gap-3 rounded-xl border p-3"><div className="w-20 shrink-0 overflow-hidden rounded-lg [&>div]:h-20"><ProductImage src={checked.imageUrl} name={checked.name} /></div><div className="min-w-0"><p className="break-words text-lg font-black">{checked.name}</p><p className="text-sm text-slate-600">{checked.category} · {checked.unit}</p><p className="mt-1 text-lg font-black tabular-nums">{money(checked.priceMinor)}</p></div></div>
      <TaskSummary rows={[['Disponible para la venta', checked.available ? 'Sí' : 'No'], ['Activo', checked.active !== false ? 'Sí' : 'No'], ['Descripción', checked.description || '—'],
        ['Ingredientes', checked.ingredients.length ? checked.ingredients.join(', ') : '—'], ['Alérgenos', checked.allergens.length ? checked.allergens.join(', ') : '—']]} />
      {stopsSales && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-950">Este cambio impedirá nuevas ventas del producto. Las compras anteriores se conservan.</p>}
      {connected && values.categoryChoice === '__new' && <p className="text-sm text-slate-600">Se creará la categoría «{checked.category}».</p>}
    </>}
    {phase === 'pending' && <TaskOutcome kind="pending" title="Guardando el producto…"><p>No cierres esta ventana.</p></TaskOutcome>}
    {phase === 'success' && preview && <TaskOutcome kind="success" title={product ? 'Cambios guardados' : 'Producto agregado al catálogo'}><p className="font-bold">{preview.name} · {money(preview.priceMinor)}</p><p className="text-sm">{product ? 'El catálogo muestra la versión actualizada.' : 'Ya puedes agregarlo a un menú.'}</p></TaskOutcome>}
    {phase === 'failed' && (connected && pendingMutation ? <TaskOutcome kind="uncertain" title="Cambio pendiente de confirmar"><p>{failure} Confirma la misma solicitud; no se creará un duplicado.</p></TaskOutcome> : <TaskOutcome kind="failure" title="No se guardó el producto"><p>{failure}</p></TaskOutcome>)}
  </TaskWindow>;
}
