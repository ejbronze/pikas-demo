// Wave C responsive collection: a table at ≥1024 px, compact rows below. Cells are presentation
// only; callers pass already-authorized server data. Optional row actions (Wave D.3) render as the
// last table column and as a button row under each compact item.
export type DataColumn<T> = { header: string; cell: (row: T) => React.ReactNode; primary?: boolean; align?: "end" };

export function DataList<T>({ label, rows, rowKey, columns, actions }: { label: string; rows: T[]; rowKey: (row: T) => string; columns: DataColumn<T>[]; actions?: (row: T) => React.ReactNode }) {
  const [primary, ...rest] = [...columns].sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  return <>
    <div className="card hidden overflow-hidden lg:block">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="border-b bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-600"><tr>{columns.map(c => <th key={c.header} scope="col" className={`px-4 py-3 ${c.align === "end" ? "text-right" : ""}`}>{c.header}</th>)}{actions && <th scope="col" className="px-4 py-3 text-right"><span className="sr-only">Acciones</span></th>}</tr></thead>
        <tbody className="divide-y">{rows.map(row => <tr key={rowKey(row)} className="align-top">{columns.map(c => <td key={c.header} className={`px-4 py-3 ${c.align === "end" ? "text-right" : ""} ${c.primary ? "font-bold" : ""}`}>{c.cell(row)}</td>)}{actions && <td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-2">{actions(row)}</div></td>}</tr>)}</tbody>
      </table>
    </div>
    <ul aria-label={label} className="card divide-y lg:hidden">{rows.map(row => <li key={rowKey(row)} className="min-w-0 break-words p-4">
      <div className="font-bold">{primary.cell(row)}</div>
      <dl className="mt-1 space-y-0.5 text-sm text-slate-600">{rest.map(c => <div key={c.header} className="flex flex-wrap gap-x-2"><dt className="font-semibold text-slate-500">{c.header}:</dt><dd className="min-w-0">{c.cell(row)}</dd></div>)}</dl>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions(row)}</div>}
    </li>)}</ul>
  </>;
}
