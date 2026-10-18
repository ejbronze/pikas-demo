import Link from "next/link";
import type { Ref } from "react";
import { ArrowLeft } from "lucide-react";

// Wave C page header for administrative pages: the title matches the navigation label, the shell
// already names the context, so no eyebrow repeats it. Back links only on drill-down pages.
export function AppPageHeader({ title, description, action, back, meta, headingRef }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  back?: { href: string; label: string };
  meta?: React.ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return <header className="space-y-1">
    {back && <Link href={back.href} className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-bold text-slate-600 hover:text-slate-900"><ArrowLeft aria-hidden size={16} />{back.label}</Link>}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-64">
        <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="break-words text-2xl font-black sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
        {meta && <div className="mt-2 text-sm text-slate-600">{meta}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  </header>;
}
