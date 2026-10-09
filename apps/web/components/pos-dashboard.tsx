"use client";
import { lazy, Suspense } from "react";
import { ConnectedPosDashboard } from "./connected-pos-dashboard";
import type { PosAccessContext } from "@/lib/pos/access-context";

const DemoPosDashboard = lazy(() => import("./demo-pos-dashboard"));

export function PosDashboard({ access }: {
  access: { demo: true; context: null } | { demo: false; context: PosAccessContext };
}) {
  return access.demo
    ? <Suspense fallback={null}><DemoPosDashboard demo /></Suspense>
    : <ConnectedPosDashboard context={access.context} />;
}
