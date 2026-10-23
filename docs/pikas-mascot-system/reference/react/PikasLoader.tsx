// Reference component — the flower-collecting loader (LOAD-01).
// Shows nothing for the first second, then the animation, then plain text after 10 s.
"use client";
import { useEffect, useState } from "react";

export function PikasLoader({ label = "Cargando…", slowLabel = "Esto está tardando más de lo normal…" }) {
  const [phase, setPhase] = useState<"hidden" | "anim" | "slow">("hidden");
  useEffect(() => {
    const a = setTimeout(() => setPhase("anim"), 1000);
    const b = setTimeout(() => setPhase("slow"), 10000);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);

  return (
    <div role="status" aria-live="polite" style={{ display: "grid", justifyItems: "center", gap: 12 }}>
      {phase === "anim" && (
        <img src="/brand/mascot/motion/pikas-load-01-collecting.svg" width={320} alt="" aria-hidden />
      )}
      {/* Screen readers always get the text; sighted users see it once loading is slow. */}
      <span style={phase === "slow" ? undefined : visuallyHidden}>{phase === "slow" ? slowLabel : label}</span>
    </div>
  );
}

const visuallyHidden: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
};
