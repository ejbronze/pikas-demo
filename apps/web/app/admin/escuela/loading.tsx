import { PikasLoadingScreen } from "@/components/pikas-loading";
// Workspace navigations (these pages render their own shell): the branded loader over a softened workspace outline.
// The layout above only resolves access, so without this boundary a navigation kept the old page with no signal.
export default function Loading() { return <PikasLoadingScreen frame="workspace" context="Cargando la administración escolar." />; }
