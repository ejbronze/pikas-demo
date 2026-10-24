import { PikasLoadingScreen } from "@/components/pikas-loading";
// Branded route fallback: a softened outline of the coming screen with «Pikando…» centered in the viewport.
export default function Loading() { return <PikasLoadingScreen frame="app" context="Cargando la pantalla." />; }
