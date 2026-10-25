import "server-only";
import type { z } from "zod";
import { readPlatform, requirePlatform, type PlatformSession } from "./customer-console";
import { READINESS_CAPABILITY, readinessSchema } from "./readiness";
import { financeReportSchema, networkReportSchema, type CustomerFilters } from "./reports";
import { resolvePikasIdentity } from "../auth/pikas-context";
import { createSupabaseServerClient } from "../supabase/server";
import { crossSite } from "../reports/csv";
import type { PeriodFilter } from "../reports/filters";

// Platform Reportes use the authority of the data they show and nothing more:
//   Clientes, Red y adopción — platform:customer:operations:read (platform_customer_readiness, platform_network_report);
//   Finanzas (resumen)       — platform:finance:read (platform_finance_report).
// The database re-checks every capability and refuses a sandbox POV; pages and CSV routes call the same reads with the
// same arguments, so an export can never cover a different scope than its page.
export const FINANCE_REPORT_CAPABILITY = "platform:finance:read";
export const canReadNetworkReports = (capabilities: string[]) => capabilities.includes(READINESS_CAPABILITY);
export const canReadFinanceReports = (capabilities: string[]) => capabilities.includes(FINANCE_REPORT_CAPABILITY);
export const canReadPlatformReports = (capabilities: string[]) => canReadNetworkReports(capabilities) || canReadFinanceReports(capabilities);

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
export const networkArgs = (p: PeriodFilter, demo: boolean) => ({ p_period: p.period, p_from: p.from, p_to: p.to, p_include_demo: demo });
export const financeArgs = (p: PeriodFilter) => ({ p_period: p.period, p_from: p.from, p_to: p.to });
export const clientesNetworkArgs = (f: CustomerFilters) => networkArgs({ period: "last_30_days", from: null, to: null }, f.demo === "1");

export async function platformSession() { return requirePlatform(); }
export const readReadiness = (s: PlatformSession) => readPlatform(s, READINESS_CAPABILITY, "platform_customer_readiness", { p_account_id: null }, readinessSchema);
export const readNetwork = (s: PlatformSession, args: ReturnType<typeof networkArgs>) => readPlatform(s, READINESS_CAPABILITY, "platform_network_report", args, networkReportSchema);
export const readFinance = (s: PlatformSession, args: ReturnType<typeof financeArgs>) => readPlatform(s, FINANCE_REPORT_CAPABILITY, "platform_finance_report", args, financeReportSchema);

// CSV routes: the same capability and reads, answered as HTTP errors. A truncated network is never exported.
export async function platformReportRoute<T extends Record<string, z.ZodType>>(request: Request, capability: string, reads: { [K in keyof T]: { fn: string; args: Record<string, unknown>; schema: T[K] } }) {
  const fail = (error: string, status: number) => ({ ok: false as const, response: Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }) });
  if (crossSite(request)) return fail("same_origin_required", 403);
  try {
    const client = await createSupabaseServerClient(), identity = await resolvePikasIdentity(client);
    if (identity.status === "unauthenticated") return fail("authentication_required", 401);
    if (identity.status !== "ready" || !identity.platform?.capabilities.includes(capability)) return fail("report_authority_required", 403);
    const values = {} as { [K in keyof T]: z.infer<T[K]> };
    for (const key of Object.keys(reads) as (keyof T)[]) {
      const { fn, args, schema } = reads[key], { data, error } = await (client as unknown as Rpc).rpc(fn, args);
      if (error) return error.code === "42501" ? fail("report_authority_required", 403) : error.code === "22023" ? fail("invalid_filters", 400) : fail("report_unavailable", 502);
      const parsed = schema.safeParse(data);
      if (!parsed.success) return fail("report_unavailable", 502);
      if ((parsed.data as { truncated?: boolean }).truncated) return fail("report_truncated", 413);
      values[key] = parsed.data;
    }
    return { ok: true as const, values };
  } catch { return fail("authorization_unavailable", 503); }
}
