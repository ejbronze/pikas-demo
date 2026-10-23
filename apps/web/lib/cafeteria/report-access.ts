import { notFound, redirect } from "next/navigation";
import { isDemoMode } from "../env";
import { createSupabaseServerClient } from "../supabase/server";
import { resolveCafeteriaAccess } from "../auth/cafeteria-access";
import { readSchema } from "./contracts";
import { one, type SearchParams } from "../reports/filters";
import { crossSite } from "../reports/csv";

// UX 9 Cafetería Reportes: the same Cafetería authority as every Cafetería page. The cafetería comes
// from the URL and must be one of the actor's; financial reports need a customer tenant with
// cafeteria:pos:purchases:read (Cajas y cierres also cafeteria:pos:sessions:read), exactly the rule
// the Reportes navigation and Cafetería Hoy already apply. Inside the sandbox (Demo Lab) the reports show the
// sandbox's OWN fictional data: the report RPCs decide (read-only POV capability) and re-check authority on every read.
export async function cafeteriaReportPage(searchParams: Promise<SearchParams>) {
  if (isDemoMode()) notFound();
  const client = await createSupabaseServerClient(), access = await resolveCafeteriaAccess(client);
  if (access.status === "unauthenticated") redirect("/login?next=%2Fadmin%2Fcafeteria");
  if (access.status !== "authorized") redirect("/login?error=cafeteria_authority");
  const params = await searchParams, cafeteriaId = one(params.cafeteria) ?? access.context.cafeterias[0].cafeteria_id;
  const cafeteria = access.context.cafeterias.find(c => c.cafeteria_id === cafeteriaId);
  if (!cafeteria) redirect("/admin/cafeteria");
  const { data, error } = await client.rpc("cafeteria_admin_read", { p_cafeteria_id: cafeteriaId }), parsed = readSchema.safeParse(data);
  const scope = !error && parsed.success && parsed.data.scope.cafeteria_id === cafeteriaId && parsed.data.scope.actor_id === access.context.person_id ? parsed.data.scope : null;
  const caps = scope?.capabilities ?? [], customer = scope?.tenant_kind === "customer" && cafeteria.tenant_kind === "customer", reportable = !!scope && scope.tenant_kind === cafeteria.tenant_kind;
  const sales = reportable && caps.includes("cafeteria:pos:purchases:read"), sessions = sales && caps.includes("cafeteria:pos:sessions:read");
  return { client, context: access.context, params, cafeteriaId, cafeteria, scope, sales, sessions, walletNav: customer && caps.includes("cafeteria:wallets:read") };
}

// CSV routes: same checks answered as HTTP errors. Capabilities are enforced by the report RPCs (the sandbox
// POV holds read-only report capabilities; wallets and finance stay refused there).
export async function cafeteriaReportRoute(request: Request) {
  const fail = (error: string, status: number) => ({ ok: false as const, response: Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }) });
  if (isDemoMode()) return fail("not_found", 404);
  if (crossSite(request)) return fail("same_origin_required", 403);
  const params = Object.fromEntries(new URL(request.url).searchParams) as SearchParams;
  const client = await createSupabaseServerClient(), access = await resolveCafeteriaAccess(client);
  if (access.status === "unauthenticated") return fail("authentication_required", 401);
  if (access.status !== "authorized") return fail("cafeteria_authority_required", access.status === "unavailable" ? 503 : 403);
  const cafeteriaId = one(params.cafeteria), cafeteria = access.context.cafeterias.find(c => c.cafeteria_id === cafeteriaId);
  if (!cafeteriaId || !cafeteria) return fail("cafeteria_authority_required", 403);
  return { ok: true as const, client, params, cafeteriaId, cafeteria };
}
