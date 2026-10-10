import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { schoolContextSchema, type SchoolContext } from "../school/contracts";
export type SchoolAccess = { status: "authorized"; context: SchoolContext } | { status: "unauthenticated" | "forbidden" | "unavailable" };
export async function resolveSchoolAccess(client: Pick<SupabaseClient, "auth" | "rpc">): Promise<SchoolAccess> {
  try {
    const { data: { user }, error } = await client.auth.getUser();
    if (error) return { status: error.name === "AuthSessionMissingError" ? "unauthenticated" : "unavailable" };
    if (!user) return { status: "unauthenticated" };
    const response = await client.rpc("get_school_admin_context");
    if (response.error) return { status: response.error.code === "42501" ? "forbidden" : "unavailable" };
    if (response.data === null) return { status: "forbidden" };
    const parsed = schoolContextSchema.safeParse(response.data);
    if (!parsed.success) return { status: "unavailable" };
    return parsed.data.schools.length ? { status: "authorized", context: parsed.data } : { status: "forbidden" };
  } catch { return { status: "unavailable" }; }
}
