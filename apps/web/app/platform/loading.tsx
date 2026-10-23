import { PikasLoader } from "@pikas/ui/mascot";
// LOAD-01 appears only after a second of waiting; the status text is always there for screen readers.
export default function PlatformLoading() { return <div className="card p-8"><PikasLoader label="Cargando plataforma…" /></div>; }
