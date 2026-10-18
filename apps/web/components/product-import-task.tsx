"use client";
import { useRef, useState } from 'react';
import { useCatalogEditor } from './cafeteria-editor-context';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskWindow } from './task-window';
import { parseProductCsv, productCsvColumns, productCsvMaxRows, productCsvRequired, productCsvTemplate, type ProductCsvResult } from '../lib/cafeteria/product-csv';

const money = (minor: number) => new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(minor / 100);
type Outcome = { created: string[]; rejected: { line: number; name: string; message: string }[]; stoppedAt: { line: number; name: string } | null; notSent: number };
type Phase = 'file' | 'review' | 'importing' | 'result';

// Product CSV import (Wave D.2). Parsing creates nothing. Import sends each valid row as one ordinary
// product_save through the existing catalog command path; it is not all-or-nothing. It stops at the
// first unconfirmed row: the provider keeps that exact request for explicit recovery, and the
// remaining rows are not sent.
export function ProductImportTask({ categories, productNames, close }: { categories: string[]; productNames: string[]; close: (message?: string) => void }) {
  const { adminAddMenu, connection, mutationBlocked } = useCatalogEditor();
  const [phase, setPhase] = useState<Phase>('file');
  const [fileName, setFileName] = useState(''), [fileError, setFileError] = useState('');
  const [parsed, setParsed] = useState<ProductCsvResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const running = useRef(false), input = useRef<HTMLInputElement>(null);
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(productCsvTemplate)}`;
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setFileError(''); setParsed(null); setFileName(file.name);
    try { setParsed(parseProductCsv(await file.text(), { categories, productNames })); setPhase('review'); }
    catch (cause) { setFileError(cause instanceof Error ? cause.message : 'No se pudo leer el archivo.'); setPhase('file'); }
  };
  const run = async () => {
    if (!parsed || running.current || !parsed.valid.length) return;
    running.current = true; setPhase('importing'); setProgress(0);
    const result: Outcome = { created: [], rejected: [], stoppedAt: null, notSent: 0 };
    for (const [index, row] of parsed.valid.entries()) {
      setProgress(index + 1);
      const response = await adminAddMenu(row.item);
      if (response.ok) { result.created.push(row.item.name); continue; }
      if ('pending' in response && response.pending) { result.stoppedAt = { line: row.line, name: row.item.name }; result.notSent = parsed.valid.length - index - 1; break; }
      result.rejected.push({ line: row.line, name: row.item.name, message: response.message });
    }
    running.current = false; setOutcome(result); setPhase('result');
  };
  const ready = parsed?.valid.length ?? 0, attention = parsed?.problems.length ?? 0;
  const footer = {
    file: <><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" data-autofocus onClick={() => input.current?.click()}>Elegir archivo CSV</button></>,
    review: <><button type="button" className="btn-secondary" onClick={() => input.current?.click()}>Elegir otro archivo</button><button type="button" className="btn" disabled={!ready || connection !== 'Online' || !!mutationBlocked} onClick={() => void run()}>Importar {ready} {ready === 1 ? 'producto' : 'productos'}</button></>,
    importing: <button type="button" className="btn" disabled>Importando…</button>,
    result: <button type="button" className="btn" data-autofocus onClick={() => close(outcome?.created.length ? `Se agregaron ${outcome.created.length} productos desde CSV.` : undefined)}>Cerrar</button>,
  }[phase];
  return <TaskWindow title="Importar productos" context={fileName || 'Desde un archivo CSV'} steps={phase === 'file' || phase === 'review' ? ['Archivo', 'Revisar'] : undefined} step={phase === 'review' ? 1 : 0}
    busy={phase === 'importing'} dirty={phase === 'review'} onClose={() => close()} footer={<TaskActions>{footer}</TaskActions>}>
    <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Archivo CSV de productos" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void choose(file); }} />
    {phase === 'file' && <>
      <p>Agrega productos nuevos al catálogo desde un archivo CSV. Antes de crear nada podrás revisar qué filas están listas y cuáles necesitan correcciones.</p>
      <div className="space-y-2 rounded-xl border p-3 text-sm">
        <p><strong>Obligatorias:</strong> {productCsvRequired.join(', ')}. <strong>Opcionales:</strong> {productCsvColumns.filter(c => !(productCsvRequired as readonly string[]).includes(c)).join(', ')}.</p>
        <ul className="list-disc space-y-1 pl-5"><li><strong>categoria</strong>: una categoría activa existente ({categories.join(', ') || 'ninguna'}).</li><li><strong>precio</strong>: en RD$ con punto decimal, por ejemplo 195.00.</li>
          <li><strong>disponible</strong> y <strong>activo</strong>: sí o no (por defecto sí).</li><li><strong>ingredientes</strong> y <strong>alergenos</strong>: separados por |.</li><li>Hasta {productCsvMaxRows} productos por archivo. Solo crea productos nuevos; no modifica los existentes.</li></ul>
        <a className="inline-flex min-h-11 items-center font-bold text-teal-800 underline" href={template} download="plantilla-productos-pikas.csv">Descargar plantilla CSV</a>
      </div>
      {fileError && <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-800">{fileError} Corrige el archivo y vuelve a elegirlo.</p>}
    </>}
    {phase === 'review' && parsed && <>
      <p className="text-lg font-black" role="status">{ready} {ready === 1 ? 'producto listo' : 'productos listos'}{attention ? ` · ${attention} ${attention === 1 ? 'necesita' : 'necesitan'} atención` : ''}</p>
      {attention > 0 && <section className="space-y-2" aria-label="Filas con problemas"><p className="text-sm">Estas filas no se importarán. Corrige el archivo y vuelve a elegirlo para incluirlas.</p>
        <ul className="divide-y rounded-xl border border-amber-300 bg-amber-50">{parsed.problems.map(p => <li key={p.line} className="p-3 text-sm"><strong>Línea {p.line} · {p.name}</strong><ul className="list-disc pl-5">{p.problems.map(text => <li key={text}>{text}</li>)}</ul></li>)}</ul></section>}
      {ready > 0 && <details className="rounded-xl border p-3" open={ready <= 10}><summary className="flex min-h-11 cursor-pointer items-center font-bold">Productos que se crearán ({ready})</summary>
        <ul className="divide-y text-sm">{parsed.valid.map(v => <li key={v.line} className="flex flex-wrap justify-between gap-2 py-2"><span className="min-w-0 break-words"><strong>{v.item.name}</strong> · {v.item.category}{v.item.available ? '' : ' · No disponible'}{v.item.active === false ? ' · Inactivo' : ''}</span><span className="tabular-nums">{money(v.item.priceMinor)}</span></li>)}</ul></details>}
      <p className="text-sm text-slate-600">Cada producto se registra por separado. Si una fila no puede confirmarse, la importación se detiene y te lo indicaremos.</p>
    </>}
    {phase === 'importing' && <TaskOutcome kind="pending" title={`Importando ${progress} de ${ready}…`}><p>No cierres esta ventana.</p></TaskOutcome>}
    {phase === 'result' && outcome && <>
      <TaskOutcome kind={outcome.stoppedAt ? 'uncertain' : outcome.rejected.length ? 'failure' : 'success'} title={`Se agregaron ${outcome.created.length} de ${ready} productos`}>
        {outcome.stoppedAt && <p>La importación se detuvo en la línea {outcome.stoppedAt.line} ({outcome.stoppedAt.name}): no sabemos si se registró. Confirma la solicitud pendiente en Productos antes de continuar. {outcome.notSent} {outcome.notSent === 1 ? 'fila no se envió' : 'filas no se enviaron'}; si vuelves a importar el archivo, los productos ya creados se marcarán como existentes.</p>}
        {!outcome.stoppedAt && !outcome.rejected.length && <p>Todos los productos listos se agregaron al catálogo.</p>}
      </TaskOutcome>
      {outcome.rejected.length > 0 && <section aria-label="Filas rechazadas"><p className="font-bold">No se crearon:</p><ul className="divide-y rounded-xl border text-sm">{outcome.rejected.map(r => <li key={r.line} className="p-3"><strong>Línea {r.line} · {r.name}</strong>: {r.message}</li>)}</ul></section>}
    </>}
  </TaskWindow>;
}
