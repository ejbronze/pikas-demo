"use client";
export default function PlatformError({ reset }: { reset: () => void }) {
  return <div className="card p-5" role="alert"><p>No pudimos cargar la plataforma.</p><button className="btn mt-4" onClick={reset}>Volver a intentar</button></div>;
}
