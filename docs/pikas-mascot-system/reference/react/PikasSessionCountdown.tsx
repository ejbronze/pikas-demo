// Reference component — session-ending warning (ATT-01 + COUNTDOWN motion).
// The SVG must be inline so the --countdown variable reaches its CSS.
// In Next.js, enable SVGR (@svgr/webpack) so .svg files import as React components.
"use client";
import { useState } from "react";
import WorriedCountdown from "@/public/brand/mascot/motion/pikas-att-01-worried-countdown.svg"; // adjust path

export function PikasSessionCountdown({ secondsLeft, onContinue }: { secondsLeft: number; onContinue: () => void }) {
  // Fix the hourglass length at mount; changing it every tick would restart the animation.
  const [total] = useState(secondsLeft);
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");
  return (
    <div role="alertdialog" aria-labelledby="pk-timeout-title" aria-describedby="pk-timeout-desc">
      <div aria-hidden style={{ width: 140, ["--countdown" as string]: `${total}s`, ["--countdown-repeat" as string]: "1" }}>
        <WorriedCountdown width="100%" height="auto" />
      </div>
      <h2 id="pk-timeout-title">Tu sesión está por terminar</h2>
      {/* The time left is always text; the hourglass only illustrates it. */}
      <p id="pk-timeout-desc">Se cerrará en {mm}:{ss} por inactividad.</p>
      <button type="button" onClick={onContinue}>Seguir conectado</button>
    </div>
  );
}
