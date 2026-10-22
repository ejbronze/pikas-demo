import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hasPlatformAuthority, resolvePikasIdentity, type PikasIdentity } from "@/lib/auth/pikas-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { activeSchema, canUseSandboxPov } from "./sandbox-launcher";
import { demoConflictHref, platformReturnTarget } from "./demo-mode";
import type { SandboxPovCode } from "./sandbox-pov";

export type ActiveDemo = {
  sessionId: string; povCode: SandboxPovCode; accountId: string; schoolId: string; cafeteriaId: string;
  accountName: string; cafeteriaName: string; personaName: string; expiresAt: string;
};
export type DemoState = { kind: "none" } | { kind: "unknown" } | { kind: "active"; demo: ActiveDemo };

// UX 11: the operator's CURRENT Demo POV, from the authoritative server resolver
// (platform_get_active_sandbox_pov → sandbox_validated_pov: active, unexpired, persona valid, bound
// to this Auth user). Expired or exited sessions are "none". An unavailable read is "unknown": the
// database still refuses real operations under a POV, so nothing is granted either way.
export async function readActiveDemo(supabase: Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "rpc">, identity: PikasIdentity): Promise<DemoState> {
  if (!canUseSandboxPov(identity)) return { kind: "none" };
  try {
    const response = await supabase.rpc("platform_get_active_sandbox_pov");
    if (response.error) return { kind: "unknown" };
    if (response.data === null) return { kind: "none" };
    const active = activeSchema.safeParse(response.data);
    if (!active.success) return { kind: "unknown" };
    const a = active.data;
    if (Date.parse(a.expires_at) <= Date.now()) return { kind: "none" };
    return { kind: "active", demo: { sessionId: a.session_id, povCode: a.pov_code, accountId: a.account_id, schoolId: a.school_id ?? "", cafeteriaId: a.cafeteria_id,
      accountName: a.account_name, cafeteriaName: a.cafeteria_name, personaName: a.persona_display_name, expiresAt: a.expires_at } };
  } catch { return { kind: "unknown" }; }
}

// The requested Platform path, as the proxy recorded it (validated again before use).
async function requestedPlatformPath(): Promise<string> {
  try { return platformReturnTarget((await headers()).get("x-pikas-url")); } catch { return "/platform"; }
}

// Every Platform page starts here. By default a real Platform route is intercepted while a Demo POV
// is current: the operator is sent to the Demo conflict screen with the validated requested path.
// Demo-aware surfaces (the shell, the Demo workspace, the conflict screen) pass demo: "allow".
export async function requirePlatform(options: { demo?: "allow" | "intercept" } = {}) {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  let identity: Awaited<ReturnType<typeof resolvePikasIdentity>>;
  try {
    supabase = await createSupabaseServerClient();
    identity = await resolvePikasIdentity(supabase);
  } catch { redirect("/backoffice/login?error=platform_unavailable"); }
  if (identity.status === "unauthenticated") redirect("/backoffice/login");
  if (identity.status !== "ready") redirect("/backoffice/login?error=identity");
  if (!hasPlatformAuthority(identity) || !identity.platform) redirect("/backoffice/login?error=platform");
  const state = await readActiveDemo(supabase, identity);
  const demo = state.kind === "active" ? state.demo : null;
  if (demo && options.demo !== "allow") redirect(demoConflictHref(await requestedPlatformPath()));
  return { supabase, identity, capabilities: identity.platform.capabilities, demo };
}
export type PlatformSession = Awaited<ReturnType<typeof requirePlatform>>;
export type ReadResult<T> = { kind: "ready"; value: T } | { kind: "forbidden" | "unavailable" | "missing" };
export async function readPlatform<T>(session: PlatformSession, capability: string, rpc: string,
  args: Record<string, unknown>, schema: z.ZodType<T>): Promise<ReadResult<T>> {
  if (!session.capabilities.includes(capability)) return { kind: "forbidden" };
  try {
    const result = await session.supabase.rpc(rpc, args);
    if (result.error) return { kind: result.error.code === "42501" ? "forbidden" : result.error.code === "P0002" ? "missing" : "unavailable" };
    const parsed = schema.safeParse(result.data);
    return parsed.success ? { kind: "ready", value: parsed.data } : { kind: "unavailable" };
  } catch { return { kind: "unavailable" }; }
}
