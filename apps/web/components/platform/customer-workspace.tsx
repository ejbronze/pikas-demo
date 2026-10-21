"use client";
import { useEffect, useState } from "react";

// PIKAS UX 3: one customer page with anchored sections. The section ids are the existing anchors
// (Puesta en marcha links to them), so navigation never needs a route of its own.
export type WorkspaceSection = { id: string; label: string };

export function WorkspaceNav({ sections }: { sections: WorkspaceSection[] }) {
  const [current, setCurrent] = useState(sections[0]?.id ?? "");
  useEffect(() => {
    const targets = sections.map(s => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    if (!targets.length || typeof IntersectionObserver === "undefined") return;
    // The section whose top most recently crossed below the sticky header and this bar is current.
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setCurrent(visible.target.id);
    }, { rootMargin: "-136px 0px -55% 0px" });
    targets.forEach(t => observer.observe(t));
    return () => observer.disconnect();
  }, [sections]);
  return <nav aria-label="Secciones del cliente" className="ws-nav">
    <ul>{sections.map(s => <li key={s.id}><a href={`#${s.id}`} aria-current={current === s.id ? "location" : undefined} onClick={() => setCurrent(s.id)}>{s.label}</a></li>)}</ul>
  </nav>;
}
