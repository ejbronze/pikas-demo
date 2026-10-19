// Wave C metric presentation for numbers that already exist (no new reads). Render inside a <dl>.
export function MetricCard({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return <div className="card min-w-0 p-4"><dt className="text-sm font-bold text-slate-600">{label}</dt><dd className="mt-1 break-words text-2xl font-black">{children}</dd>{help && <dd className="mt-1 text-xs text-slate-500">{help}</dd>}</div>;
}
