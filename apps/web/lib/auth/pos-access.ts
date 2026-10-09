import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { isDemoMode } from "@/lib/env";
import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { posAccessContextSchema, type PosAccessContext } from "../pos/access-context";

type PosAccess =
  | { status: "authorized"; context: PosAccessContext }
  | { status: "unauthenticated" | "forbidden" | "unavailable" };

// Shared by proxy and server pages. Never merges the effective actor into Auth/tenant identity.
export async function resolvePosAccess(supabase: Pick<SupabaseClient, "auth" | "rpc">): Promise<PosAccess> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      return { status: error.name === "AuthSessionMissingError" ? "unauthenticated" : "unavailable" };
    }
    if (!user) return { status: "unauthenticated" };
    const response = await supabase.rpc("get_pos_access_context");
    if (response.error) return { status: response.error.code === "42501" ? "forbidden" : "unavailable" };
    if (response.data === null) return { status: "forbidden" };
    const parsed = posAccessContextSchema.safeParse(response.data);
    if (!parsed.success || (parsed.data.pov && Date.parse(parsed.data.pov.expires_at) <= Date.now())) {
      return { status: "unavailable" };
    }
    return { status: "authorized", context: parsed.data };
  } catch {
    return { status: "unavailable" };
  }
}

export async function requirePosAccess(): Promise<
  { demo: true; context: null } | { demo: false; context: PosAccessContext }
> {
  if (isDemoMode()) {
    await requireRole("pos_operator");
    return { demo: true, context: null };
  }
  const access = await resolvePosAccess(await createSupabaseServerClient());
  if (access.status === "unauthenticated") redirect("/login?next=%2Fpos");
  if (access.status === "forbidden") redirect("/login?error=pos_authority");
  if (access.status !== "authorized") redirect("/login?error=pos_unavailable");
  return { demo: false, context: access.context };
}
