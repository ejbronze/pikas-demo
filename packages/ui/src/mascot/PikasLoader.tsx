"use client";
// LOAD-01, the flower-collecting loader. Shows nothing for the first second (short waits stay quiet), the
// animation until ten seconds, then plain text. Screen readers always get the role="status" text; the SVG's
// CSS loop already stops under prefers-reduced-motion.
import { useEffect, useState } from "react";
import { motionFiles } from "./assets.generated";
import { assetUrl } from "./PikasMascot";

export function PikasLoader({ label = "Cargando…", slowLabel = "Esto está tardando más de lo normal…", size = 240, className }: { label?: string; slowLabel?: string; size?: number; className?: string }) {
  const [phase, setPhase] = useState<"hidden" | "anim" | "slow">("hidden");
  useEffect(() => {
    const a = setTimeout(() => setPhase("anim"), 1000), b = setTimeout(() => setPhase("slow"), 10000);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  return <div role="status" aria-live="polite" className={className} style={{ display: "grid", justifyItems: "center", gap: 12 }} data-phase={phase}>
    {phase !== "hidden" && <img src={assetUrl(motionFiles["LOAD-01"])} width={size} alt="" aria-hidden decoding="async" draggable={false} data-mascot="LOAD-01" data-animated="true" />}
    <span style={phase === "slow" ? undefined : visuallyHidden}>{phase === "slow" ? slowLabel : label}</span>
  </div>;
}

const visuallyHidden: React.CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };
