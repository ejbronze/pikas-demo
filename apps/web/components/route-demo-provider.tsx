"use client";

import { lazy, Suspense, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isDemoMode } from "@/lib/env";

// Import only when rendered: importing DemoProvider eagerly initializes its demo state.
const DemoProvider = lazy(() => import("./demo-provider").then((module) => ({ default: module.DemoProvider })));

export function RouteDemoProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Demo state exists only in demo mode. Outside it (pilot/production) the provider never mounts,
  // so it makes no demo requests (e.g. the intentionally unavailable /api/menu).
  if (!isDemoMode()) return children;
  if (pathname === "/platform" || pathname?.startsWith("/platform/")) return children;
  return <Suspense fallback={null}><DemoProvider>{children}</DemoProvider></Suspense>;
}
