"use client";

import { lazy, Suspense, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isDemoMode } from "@/lib/env";

// Import only when rendered: importing DemoProvider eagerly initializes its demo state.
const DemoProvider = lazy(() => import("./demo-provider").then((module) => ({ default: module.DemoProvider })));

export function RouteDemoProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/platform" || pathname?.startsWith("/platform/")) return children;
  if (!isDemoMode() && (pathname === null || pathname === "/pos" || pathname.startsWith("/pos/") || pathname === "/admin/escuela" || pathname.startsWith("/admin/escuela/") || pathname === "/admin/cafeteria" || pathname.startsWith("/admin/cafeteria/"))) {
    return children;
  }
  return <Suspense fallback={null}><DemoProvider>{children}</DemoProvider></Suspense>;
}
