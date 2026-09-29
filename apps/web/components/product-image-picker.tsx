"use client";
import { useRef, useState } from 'react';
import { PRODUCT_IMAGE_GALLERY, type PosMenuItemRecord } from '@pikas/data-access';
import { prepareDemoProductImage } from '@/lib/product-image-upload';
import { ProductImage } from './product-image';
export type ProductImageValue = Pick<PosMenuItemRecord, 'imageUrl' | 'imageAssetId'>;
export function ProductImagePicker({ value, onChange, onBusy }: { value: ProductImageValue; onChange: (value: ProductImageValue) => void; onBusy: (busy: boolean) => void }) {
  const [gallery, setGallery] = useState(false), [category, setCategory] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null);
  return <section className="rounded-xl bg-slate-50 p-4" aria-labelledby="product-image-heading">
    <h2 id="product-image-heading" className="text-lg font-black">Imagen del producto</h2>
    <div className="mt-3 overflow-hidden rounded-xl [&>div]:h-48"><ProductImage key={value.imageUrl ?? 'none'} src={value.imageUrl} name="Producto" /></div>
    <input ref={input} className="sr-only" type="file" aria-label="Subir imagen del producto" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      setError(''); setBusy(true); onBusy(true);
      try { const imageUrl = await prepareDemoProductImage(file); onChange({ imageUrl, imageAssetId: null }); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo preparar la imagen.'); }
      finally { setBusy(false); onBusy(false); }
    }} />
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Preparando…' : 'Subir imagen'}</button><button type="button" className="btn-secondary" disabled={busy} aria-expanded={gallery} onClick={() => { dialog.current?.showModal(); setGallery(true); }}>Galería PIKAS</button>{value.imageUrl ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setError(''); onChange({ imageUrl: null, imageAssetId: null }); }}>Quitar imagen</button> : null}</div>
    <p className="mt-2 text-xs text-slate-600">JPG, PNG o WebP · hasta 5 MB. Se guarda una copia reducida en este navegador.</p>
    {error ? <p role="alert" className="mt-2 text-sm text-red-800">{error}</p> : null}
    <dialog ref={dialog} onClose={() => setGallery(false)} className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border p-5 backdrop:bg-slate-900/50" aria-labelledby="gallery-title"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="gallery-title" className="text-xl font-black">Galería PIKAS</h2><button type="button" className="btn-secondary" onClick={() => dialog.current?.close()}>Cerrar galería</button></div><label className="text-sm font-bold">Categoría de imagen<select aria-label="Categoría de imagen" className="field mt-1" value={category} onChange={event => setCategory(event.target.value)}><option value="">Todas</option>{[...new Set(PRODUCT_IMAGE_GALLERY.map(asset => asset.category))].map(label => <option key={label}>{label}</option>)}</select></label><div className="mt-3 grid grid-cols-2 gap-2">{PRODUCT_IMAGE_GALLERY.filter(asset => !category || asset.category === category).map(asset => <button type="button" disabled={busy} key={asset.id} aria-label={`Seleccionar ${asset.name}`} aria-pressed={value.imageAssetId === asset.id || value.imageUrl === asset.src} className="overflow-hidden rounded-xl border bg-white p-2 text-left text-sm font-bold aria-pressed:border-teal-700 aria-pressed:ring-2 aria-pressed:ring-teal-700" onClick={() => { setError(''); onChange({ imageAssetId: asset.id, imageUrl: asset.src }); dialog.current?.close(); }}><ProductImage src={asset.src} name={asset.name} /><span className="mt-1 block">{asset.name}</span></button>)}</div></dialog>
  </section>;
}
