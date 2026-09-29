"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseMoney, validateProduct, type PosMenuItemRecord } from '@pikas/data-access';
import { useDemo } from './demo-provider';
import { ProductImage } from './product-image';
import { ProductImagePicker, type ProductImageValue } from './product-image-picker';

const money = (minor: number) => new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(minor / 100);
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');

export function CafeteriaProducts() {
  const { state, connection } = useDemo();
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [status, setStatus] = useState('');
  const [editor, setEditor] = useState<{ id: string; product?: PosMenuItemRecord } | null>(null);
  const [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const categories = [...new Set(state.menuItems.map(item => item.category))].sort((a, b) => a.localeCompare(b, 'es'));
  const products = state.menuItems.filter(item => normalized(`${item.name} ${item.description}`).includes(normalized(query.trim())) && (!category || item.category === category) && (!status || (status === 'active' ? item.active !== false : status === 'inactive' ? item.active === false : status === 'available' ? item.available : !item.available)));
  const close = (message?: string) => { setEditor(null); if (message) setNotice(message); requestAnimationFrame(() => heading.current?.focus()); };
  if (editor) return <ProductEditor key={editor.id} id={editor.id} product={editor.product} categories={categories} close={close} />;
  return <>
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="label">Administración de cafetería</p><h1 ref={heading} tabIndex={-1} className="text-3xl font-black">Productos</h1><p className="mt-2 text-slate-600">Administra precios, información alimentaria y disponibilidad.</p></div>
      <button className="btn" disabled={connection !== 'Online'} onClick={() => { setNotice(''); setEditor({ id: crypto.randomUUID() }); }}>Crear producto</button>
    </header>
    {notice ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-900">{notice}</p> : null}
    {connection !== 'Online' ? <p role="status" className="mt-4">Confirma la conexión para guardar cambios.</p> : null}
    <div className="mt-6 grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
      <label className="text-sm font-bold">Buscar productos<input className="field mt-1" placeholder="Nombre o descripción" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="text-sm font-bold">Categoría<select aria-label="Categoría" className="field mt-1" value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas las categorías</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="text-sm font-bold">Estado<select aria-label="Estado" className="field mt-1" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos los estados</option><option value="active">Activos</option><option value="inactive">Inactivos</option><option value="available">Disponibles</option><option value="unavailable">No disponibles</option></select></label>
    </div>
    <p className="my-4 text-sm text-slate-600" aria-live="polite">{products.length} de {state.menuItems.length} productos</p>
    <section aria-label="Catálogo de productos" className="space-y-3">
      {products.map(item => <article key={item.id} className="card flex flex-wrap items-center gap-4 p-4">
        <div className="w-20 shrink-0 overflow-hidden rounded-xl"><ProductImage key={item.imageUrl ?? 'none'} src={item.imageUrl} name={item.name} /></div>
        <div className="min-w-0 flex-1 basis-40"><h2 className="break-words text-lg font-black">{item.name}</h2><p className="break-words text-sm text-slate-600">{item.category}</p><div className="mt-2 flex flex-wrap gap-2"><span className={`chip ${item.active === false ? 'bg-slate-200' : 'bg-emerald-50 text-emerald-900'}`}>{item.active === false ? 'Inactivo' : 'Activo'}</span><span className={`chip ${item.available ? 'bg-teal-50 text-teal-900' : 'bg-amber-50 text-amber-900'}`}>{item.available ? 'Disponible' : 'No disponible'}</span></div></div>
        <strong className="whitespace-nowrap text-lg tabular-nums">{money(item.priceMinor)}</strong>
        <button className="btn-secondary" aria-label={`Editar ${item.name}`} onClick={() => { setNotice(''); setEditor({ id: item.id, product: structuredClone(item) }); }}>Editar</button>
      </article>)}
      {!products.length ? <div className="card p-6"><p>No hay productos que coincidan con estos filtros.</p><button className="btn-secondary mt-3" onClick={() => { setQuery(''); setCategory(''); setStatus(''); }}>Limpiar filtros</button></div> : null}
    </section>
  </>;
}

function ProductEditor({ id, product, categories, close }: { id: string; product?: PosMenuItemRecord; categories: string[]; close: (message?: string) => void }) {
  const { adminAddMenu, adminUpdateMenu, connection } = useDemo();
  const [image, setImage] = useState<ProductImageValue>({ imageUrl: product?.imageUrl ?? null, imageAssetId: product?.imageAssetId ?? null }), [imageBusy, setImageBusy] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [dirty, setDirty] = useState(false);
  const submitting = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const cancel = () => { if (!dirty || confirm('¿Descartar los cambios sin guardar?')) close(); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || imageBusy) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    const entries = (name: string) => value(name).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    setError('');
    try {
      const priceMinor = parseMoney(value('price'));
      if (priceMinor === null) throw new Error('Precio no válido. Usa un importe mayor o igual a RD$0, con hasta dos decimales y punto decimal.');
      const item = validateProduct({ id, name: value('name'), description: value('description'), category: value('category'), priceMinor, ...image, ingredients: entries('ingredients'), allergens: entries('allergens'), restrictionTags: entries('restrictionTags'), active: form.has('active'), available: form.has('available') }, product);
      if (product && ((product.active !== false && !item.active) || (product.available && !item.available)) && !confirm('Este cambio impedirá nuevas ventas del producto. Las compras anteriores se conservarán. ¿Guardar cambios?')) return;
      submitting.current = true; setBusy(true);
      const result = product ? await adminUpdateMenu(item, product) : await adminAddMenu(item);
      if (!result.ok) { setError(result.message); return; }
      close(product ? 'Producto actualizado.' : 'Producto creado.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el producto.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <>
    <p className="label">Productos</p><h1 ref={heading} tabIndex={-1} className="text-3xl font-black">{product ? 'Editar producto' : 'Crear producto'}</h1>
    <p className="mt-2 text-slate-600">Los cambios se aplican a las nuevas ventas. Las compras anteriores conservan sus datos originales.</p>
    <form className="card mt-5 p-4 sm:p-6" onSubmit={submit} onChange={() => setDirty(true)}>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <section className="min-w-0 space-y-4" aria-labelledby="product-information-heading">
            <h2 id="product-information-heading" className="text-lg font-black">Información del producto</h2>
            <label className="block font-bold">Nombre<input className="field mt-1" name="name" required maxLength={120} defaultValue={product?.name ?? ''} /></label>
            <div className="grid gap-4 sm:grid-cols-2"><label className="font-bold">Categoría<input className="field mt-1" name="category" aria-label="Categoría" required maxLength={80} list="product-categories" defaultValue={product?.category ?? ''} /><datalist id="product-categories">{categories.map(category => <option key={category} value={category} />)}</datalist></label>
            <label className="font-bold">Precio (RD$)<input className="field mt-1" name="price" aria-label="Precio (RD$)" required inputMode="decimal" aria-describedby="price-help" defaultValue={product ? (product.priceMinor / 100).toFixed(2) : ''} /><span id="price-help" className="mt-1 block text-sm font-normal text-slate-600">Ejemplo: 195.00. RD$0 es válido.</span></label></div>
            <label className="block font-bold">Descripción<textarea className="field mt-1 min-h-28" name="description" aria-label="Descripción" maxLength={500} defaultValue={product?.description ?? ''} /></label>
          </section>
          <ProductImagePicker value={image} onChange={value => { setImage(value); setDirty(true); }} onBusy={setImageBusy} />
        </div>
        <h2 className="border-t pt-5 text-lg font-black">Información alimentaria</h2>
        <p id="metadata-help" className="text-sm text-slate-600">Escribe una entrada por línea. Conserva los alérgenos y advertencias al actualizar el producto.</p>
        <div className="grid gap-4 md:grid-cols-3">{([['ingredients', 'Ingredientes'], ['allergens', 'Alérgenos'], ['restrictionTags', 'Etiquetas alimentarias']] as const).map(([field, label]) => <label key={field} className="font-bold">{label}<textarea className="field mt-1 min-h-28" name={field} aria-label={label} aria-describedby="metadata-help" defaultValue={product?.[field].join('\n') ?? ''} /></label>)}</div>
        <h2 className="border-t pt-5 text-lg font-black">Estado</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-start gap-3"><input className="mt-1 size-5" type="checkbox" name="active" defaultChecked={product?.active !== false} /><span><strong>Activo</strong><span className="block text-sm text-slate-600">Forma parte del catálogo operativo. Inactivo impide nuevas ventas.</span></span></label>
          <label className="flex items-start gap-3"><input className="mt-1 size-5" type="checkbox" name="available" defaultChecked={product?.available ?? true} /><span><strong>Disponible</strong><span className="block text-sm text-slate-600">Puede venderse ahora si también está activo. Puedes suspenderlo temporalmente.</span></span></label>
        </div>
        {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p> : null}
        {connection !== 'Online' ? <p role="status">Confirma la conexión antes de guardar.</p> : null}
        <div className="flex flex-wrap justify-end gap-3 border-t pt-5"><button className="btn-secondary" type="button" onClick={cancel}>Cancelar</button><button className="btn" type="submit" disabled={connection !== 'Online' || imageBusy}>{busy ? 'Guardando…' : product ? 'Guardar cambios' : 'Crear producto'}</button></div>
      </fieldset>
    </form>
  </>;
}
