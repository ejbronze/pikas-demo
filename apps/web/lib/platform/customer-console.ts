import "server-only";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hasPlatformAuthority, resolvePikasIdentity } from "@/lib/auth/pikas-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requirePlatform() {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  let identity: Awaited<ReturnType<typeof resolvePikasIdentity>>;
  try {
    supabase = await createSupabaseServerClient();
    identity = await resolvePikasIdentity(supabase);
  } catch { redirect("/backoffice/login?error=platform_unavailable"); }
  if (identity.status === "unauthenticated") redirect("/backoffice/login");
  if (identity.status !== "ready") redirect("/backoffice/login?error=identity");
  if (!hasPlatformAuthority(identity) || !identity.platform) redirect("/backoffice/login?error=platform");
  return { supabase, identity, capabilities: identity.platform.capabilities };
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
