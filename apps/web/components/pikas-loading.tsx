"use client";
// PIKAS branded loading system (Brand & Public). One vocabulary for substantial waits:
//  - PikasLoadingScreen: a route-level fallback (loading.tsx). The screen keeps a softened silhouette of the
//    application behind a translucent veil, and the LOAD-01 mascot with «Pikando…» sits centered in the
//    meaningful viewport, not as an ordinary first row.
//  - PikasBusyRegion: an in-place reload of content that stays on screen (for example a filtered list). The
//    previous content is softened and made inert while the overlay is up; filters outside the region stay usable.
// Small waits stay quiet: the veil fades in quickly but the mascot and text only appear after `delayMs`, and a
// region never blocks for a busy flag shorter than that. After ten seconds a plain sentence says it is slow.
// Screen readers always get role="status" text; motion is CSS inside the SVG and the global reduced-motion rule
// removes the fade-ins, so nothing depends on animation to be understood.
import { useEffect, useState } from "react";
import { assetUrl, motionFiles } from "@pikas/ui/mascot";

export const PIKANDO = "Pikando…";
const SLOW = "Esto está tardando más de lo normal…";
const SLOW_MS = 10_000;

function useSlow(active: boolean) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => { clearTimeout(timer); setSlow(false); };
  }, [active]);
  return slow;
}

export function PikandoIndicator({ context, slow = false, size = 132 }: { context: string; slow?: boolean; size?: number }) {
  return <div className="pk-loading-indicator" data-slow={slow || undefined}>
    {/* eslint-disable-next-line @next/next/no-img-element -- animated SVG: its CSS motion only plays as a plain image, and next/image adds nothing for SVG */}
    <img src={assetUrl(motionFiles["LOAD-01"])} width={size} alt="" aria-hidden decoding="async" draggable={false} data-mascot="LOAD-01" data-animated="true" />
    <p className="pk-loading-word" aria-hidden>{PIKANDO}</p>
    {slow && <p className="pk-loading-slow">{SLOW}</p>}
    <span className="sr-only">{slow ? SLOW : `${PIKANDO} ${context}`}</span>
  </div>;
}

// Route fallback. `frame` draws the outline of the screen that is coming: "app" for full-page workspaces
// (POS and other full pages), "workspace" for School/Cafetería administration (sidebar + header), "content"
// inside a persistent shell (Platform), "page" for anything else.
export function PikasLoadingScreen({ context = "Cargando la pantalla.", frame = "page" }: { context?: string; frame?: "app" | "content" | "page" | "workspace" }) {
  const slow = useSlow(true);
  return <div className="pk-loading-screen" data-frame={frame} role="status" aria-live="polite" aria-busy="true">
    <div className="pk-loading-silhouette" aria-hidden>
      {frame === "workspace" && <div className="pk-sil-side" />}
      <div className="pk-sil-main">
      {(frame === "app" || frame === "workspace") && <div className="pk-sil-bar" />}
      <div className="pk-sil-body">
        <div className="pk-sil-title" />
        <div className="pk-sil-line" />
        <div className="pk-sil-grid"><div /><div /><div /></div>
        <div className="pk-sil-block" />
      </div>
      </div>
    </div>
    <div className="pk-loading-veil" aria-hidden />
    <div className="pk-loading-center"><PikandoIndicator context={context} slow={slow} /></div>
  </div>;
}

// In-place reload. The children stay mounted (no lost scroll or focus history); while blocked they are inert,
// so keyboard and pointer cannot act on stale rows.
export function PikasBusyRegion({ busy, context, delayMs = 400, children, className = "" }: { busy: boolean; context: string; delayMs?: number; children: React.ReactNode; className?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => { clearTimeout(timer); setShown(false); };
  }, [busy, delayMs]);
  const slow = useSlow(busy && shown);
  const blocked = busy && shown;
  return <div className={`pk-busy-region ${className}`} aria-busy={busy || undefined}>
    <div className="pk-busy-content" inert={blocked || undefined} data-blocked={blocked || undefined}>{children}</div>
    {blocked && <div className="pk-busy-overlay" role="status" aria-live="polite"><PikandoIndicator context={context} slow={slow} size={112} /></div>}
  </div>;
}
