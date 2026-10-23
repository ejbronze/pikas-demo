"use client";
import { ErrorState } from "../../components/state-panels";
// Route-level failure of the Platform shell: a real, unexpected failure, so it is the one alert with a retry.
export default function PlatformError({ reset }: { reset: () => void }) {
  return <ErrorState title="No pudimos cargar la plataforma." description="Inténtalo de nuevo. Si continúa, vuelve a entrar más tarde." retry={<button className="btn" onClick={reset}>Volver a intentar</button>} />;
}
