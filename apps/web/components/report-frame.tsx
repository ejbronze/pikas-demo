import Link from "next/link";
import { Download } from "lucide-react";
import { PrintButton } from "./print-button";
import { maxReportDays, reportPeriods, type ReportPeriod } from "../lib/cafeteria/reports";
import { periodLabels, reportHref } from "../lib/reports/filters";

// PIKAS report frame (UX 8), shared by every role's reports: header (name, scope, active filters,
// output), summary, visualization and detail. Presentation only — each role's page passes data it
// already read and reduced under its own authority. Print keeps the report and drops the app chrome.
export type ReportFilterLabel = { label: string; value: string };

export function ReportHeader({ back, title, scope, purpose, filters, generated, csvHref }: { back: { href: string; label: string }; title: string; scope: string; purpose: string;
  filters: ReportFilterLabel[]; generated: string; csvHref?: string }) {
  return <header className="rpt-head">
    <Link className="rpt-back" href={back.href}>← {back.label}</Link>
    <div className="rpt-title-row">
      <div className="min-w-0"><h1 className="rpt-title">{title}</h1><p className="rpt-scope">{scope}</p></div>
      <div className="rpt-actions">{csvHref && <a className="btn-secondary" href={csvHref} download><Download aria-hidden size={18} />Exportar CSV</a>}<PrintButton /></div>
    </div>
    <p className="rpt-purpose">{purpose}</p>
    <dl className="rpt-filters" aria-label="Filtros aplicados">{filters.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
      <div className="rpt-generated"><dt>Generado</dt><dd>{generated}</dd></div></dl>
  </header>;
}

// A few summary figures; each must reconcile with the report's own filtered data.
export function ReportSummary({ label, items }: { label: string; items: { label: string; value: React.ReactNode; help?: string }[] }) {
  return <dl className="rpt-summary" aria-label={label}>{items.map(i => <div key={i.label}><dt>{i.label}</dt><dd className="num-display">{i.value}</dd>{i.help && <dd className="rpt-help">{i.help}</dd>}</div>)}</dl>;
}

export type ReportColumn<T> = { header: string; cell: (row: T) => React.ReactNode; align?: "end"; primary?: boolean };
// A real table on screen and in print; below 640 px each row reads as a labelled card.
export function ReportTable<T>({ label, rows, rowKey, columns, foot }: { label: string; rows: T[]; rowKey: (row: T) => string; columns: ReportColumn<T>[]; foot?: React.ReactNode }) {
  return <div className="rpt-table-wrap"><table className="rpt-table">
    <caption className="sr-only">{label}</caption>
    <thead><tr>{columns.map(c => <th key={c.header} scope="col" data-align={c.align}>{c.header}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={rowKey(row)}>{columns.map(c => c.primary
      ? <th key={c.header} scope="row" data-label={c.header}>{c.cell(row)}</th>
      : <td key={c.header} data-label={c.header} data-align={c.align}>{c.cell(row)}</td>)}</tr>)}</tbody>
    {foot && <tfoot>{foot}</tfoot>}
  </table></div>;
}

// Horizontal bars for a comparison between groups. The count is always written out (never color
// alone); a bar links to the report filtered to that group only when that filter exists.
export function BarList({ label, items, unit }: { label: string; items: { key: string; label: string; count: number; href?: string }[]; unit: [string, string] }) {
  const max = Math.max(...items.map(i => i.count), 1);
  return <ul className="rpt-bars" aria-label={label}>{items.map(i => {
    const text = `${i.count.toLocaleString("es-DO")} ${i.count === 1 ? unit[0] : unit[1]}`, body = <>
      <span className="rpt-bar-label">{i.label}</span>
      <span className="rpt-bar-track" aria-hidden><span className="rpt-bar" style={{ width: `${Math.max((i.count / max) * 100, 2)}%` }} /></span>
      <span className="rpt-bar-value num">{text}</span></>;
    return <li key={i.key}>{i.href ? <Link className="rpt-bar-row" href={i.href} aria-label={`${i.label}: ${text}. Ver solo este grupo`}>{body}</Link> : <div className="rpt-bar-row">{body}</div>}</li>;
  })}</ul>;
}

// Dashboard → report: a figure that opens the report already filtered to exactly that figure.
export function TraceLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return <Link className="rpt-trace" href={href} aria-label={label}>{children}<span aria-hidden className="rpt-trace-arrow">→</span></Link>;
}

// Period selection as links and a GET form, so the selected period is part of the report URL.
export function PeriodControls({ path, keep, period, draft, error }: { path: string; keep: Record<string, string>; period: ReportPeriod | null; draft: { from: string; to: string }; error?: string }) {
  return <div className="rpt-period" data-print="hide">
    <nav aria-label="Período del reporte" className="stu-chips">{reportPeriods.map(p => <Link key={p} className="stu-chip" aria-current={period === p ? "page" : undefined}
      href={reportHref(path, { ...keep, period: p, ...(p === "custom" ? draft : {}) })}>{periodLabels[p]}</Link>)}</nav>
    {period === "custom" || error ? <form method="get" action={path} className="rpt-range" noValidate>
      {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}<input type="hidden" name="period" value="custom" />
      <label>Desde<input className="field" type="date" name="from" defaultValue={draft.from} /></label>
      <label>Hasta<input className="field" type="date" name="to" defaultValue={draft.to} /></label>
      <button className="btn-secondary">Aplicar fechas</button>
      <p className="rpt-help basis-full">Hasta {maxReportDays} días, por fecha de operación de la escuela.</p>
      {error && <p role="alert" className="basis-full text-sm font-bold text-red-800">{error}</p>}
    </form> : null}
  </div>;
}
