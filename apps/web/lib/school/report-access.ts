import { notFound, redirect } from "next/navigation";
import { isDemoMode } from "../env";
import { createSupabaseServerClient } from "../supabase/server";
import { resolveSchoolAccess } from "../auth/school-access";
import { readSchoolWalletAccess } from "../wallet/access";
import { one, type SearchParams } from "../reports/filters";
import { crossSite } from "../reports/csv";

// UX 8 School Reportes: the same School authority as every School page. The school comes from the URL
// and must be one of the actor's schools; PIKAS Cash also needs the server-derived school:wallets:read
// and stays excluded from the sandbox POV, as in School PIKAS Cash.
export async function schoolReportPage(searchParams: Promise<SearchParams>) {
  if (isDemoMode()) notFound();
  const client = await createSupabaseServerClient(), access = await resolveSchoolAccess(client);
  if (access.status === "unauthenticated") redirect("/login?next=%2Fadmin%2Fescuela");
  if (access.status !== "authorized") redirect("/login?error=school_authority");
  const params = await searchParams, schoolId = one(params.school) ?? access.context.schools[0].school_id;
  const school = access.context.schools.find(s => s.school_id === schoolId);
  if (!school) redirect("/admin/escuela");
  const walletRead = !access.context.pov && (await readSchoolWalletAccess(client, schoolId)).read;
  return { client, context: access.context, params, schoolId, school, walletRead };
}

// CSV routes: same checks, answered as HTTP errors; the report's filters come from the same URL.
export async function schoolReportRoute(request: Request, { wallet = false } = {}) {
  const fail = (error: string, status: number) => ({ ok: false as const, response: Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }) });
  if (isDemoMode()) return fail("not_found", 404);
  if (crossSite(request)) return fail("same_origin_required", 403);
  const params = Object.fromEntries(new URL(request.url).searchParams) as SearchParams;
  const client = await createSupabaseServerClient(), access = await resolveSchoolAccess(client);
  if (access.status === "unauthenticated") return fail("authentication_required", 401);
  if (access.status !== "authorized") return fail("school_authority_required", access.status === "unavailable" ? 503 : 403);
  const schoolId = one(params.school), school = access.context.schools.find(s => s.school_id === schoolId);
  if (!schoolId || !school) return fail("school_authority_required", 403);
  if (wallet && (access.context.pov || !(await readSchoolWalletAccess(client, schoolId)).read)) return fail("school_authority_required", 403);
  return { ok: true as const, client, context: access.context, params, schoolId, school };
}
