import "server-only";
import { classifyError, type FailureKind } from "../ux/state-classes";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hasPlatformAuthority, resolvePikasIdentity } from "@/lib/auth/pikas-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { demoConflictHref, platformReturnTarget } from "./demo-mode";
import { readActiveDemo } from "./demo-state";

export { readActiveDemo, type ActiveDemo, type DemoState } from "./demo-state";

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
// Non-ready results say why: `failure` is the UX kind (lib/ux/state-classes) and, for an unavailable
// read, `reason` separates a failed call from a response PIKAS could not read (never "temporary" by habit).
export type ReadResult<T> = { kind: "ready"; value: T } | { kind: "forbidden"; failure: "permission" | "lifecycle" } | { kind: "missing"; failure: "not_found" }
  | { kind: "unavailable"; failure: FailureKind; reason: "rpc" | "invalid_response" | "exception"; code?: string };
export async function readPlatform<T>(session: PlatformSession, capability: string, rpc: string,
  args: Record<string, unknown>, schema: z.ZodType<T>): Promise<ReadResult<T>> {
  if (!session.capabilities.includes(capability)) return { kind: "forbidden", failure: "permission" };
  try {
    const result = await session.supabase.rpc(rpc, args);
    if (result.error) {
      const failure = classifyError(result.error);
      if (failure === "permission" || failure === "lifecycle") return { kind: "forbidden", failure };
      if (failure === "not_found") return { kind: "missing", failure };
      return { kind: "unavailable", failure, reason: "rpc", code: result.error.code ?? undefined };
    }
    const parsed = schema.safeParse(result.data);
    return parsed.success ? { kind: "ready", value: parsed.data } : { kind: "unavailable", failure: "temporary", reason: "invalid_response" };
  } catch { return { kind: "unavailable", failure: "temporary", reason: "exception" }; }
}
