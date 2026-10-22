// UX 11: Demo and real Platform operations are mutually exclusive modes. These helpers are pure and
// client-safe; the authoritative Demo state is always the server-side current POV.
export const DEMO_HOME = "/platform/demostracion";
export const DEMO_CONFLICT_PATH = "/platform/demostracion/salir";
export const PLATFORM_HOME = "/platform";

// Routes that stay reachable while Demo is active: the Demo workspace and everything under it
// (switching, continuing, the conflict screen). Everything else under /platform is a real operation.
export function isDemoRoute(pathname: string): boolean {
  return pathname === DEMO_HOME || pathname.startsWith(DEMO_HOME + "/");
}

// The only destinations "Salir del Demo y continuar" may follow: an internal Platform path with an
// optional query, never a scheme, host, protocol-relative path, Demo route or control character.
export function platformReturnTarget(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 500 || /[\s\\]/.test(raw)) return PLATFORM_HOME;
  if (!(raw === PLATFORM_HOME || raw.startsWith(PLATFORM_HOME + "/") || raw.startsWith(PLATFORM_HOME + "?"))) return PLATFORM_HOME;
  const path = raw.split("?")[0];
  if (path.includes("//") || path.includes("/.") || isDemoRoute(path)) return PLATFORM_HOME;
  return raw;
}

export function demoConflictHref(requested: unknown): string {
  const target = platformReturnTarget(requested);
  return target === PLATFORM_HOME ? DEMO_CONFLICT_PATH : `${DEMO_CONFLICT_PATH}?next=${encodeURIComponent(target)}`;
}
