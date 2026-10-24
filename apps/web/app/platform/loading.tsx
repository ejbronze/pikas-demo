import { PikasLoadingScreen } from "@/components/pikas-loading";
// Inside the persistent Platform shell: only the content area softens; navigation stays usable.
export default function PlatformLoading() { return <PikasLoadingScreen frame="content" context="Cargando la plataforma." />; }
