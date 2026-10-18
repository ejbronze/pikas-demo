import Link from "next/link";

// Wave C shared states. EmptyState is a legitimate zero result (status); ErrorState is a failure
// (alert) and never renders data or zeros. Specialized financial errors keep their own copy.
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return <div role="status" className="card p-5">
    <p className="font-bold">{title}</p>
    {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>;
}

export function ErrorState({ title = "No pudimos cargar esta información.", description, retryHref, retry }: {
  title?: string; description?: string; retryHref?: string; retry?: React.ReactNode;
}) {
  return <div role="alert" className="card border-red-200 p-5">
    <p className="font-bold text-red-800">{title}</p>
    {description && <p className="mt-1 text-sm text-slate-700">{description}</p>}
    {(retry || retryHref) && <div className="mt-3">{retry ?? <Link className="btn-secondary" href={retryHref!}>Reintentar</Link>}</div>}
  </div>;
}
