import type { CustomerReadiness } from "./readiness";
// Fictional readiness facts for focused tests. `configured` has steps 1–6 complete and no sale.
const u = (n: number) => `7e00d000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Patch = { [K in keyof CustomerReadiness]?: CustomerReadiness[K] extends object ? Partial<CustomerReadiness[K]> : CustomerReadiness[K] };
export function readinessFixture(n: number, kind: "empty" | "configured" = "configured", patch: Patch = {}): CustomerReadiness {
  const configured = kind === "configured";
  const base: CustomerReadiness = { account_id: u(n), name: `Colegio Ficticio ${n}`, code: `COL-${n}`, status: "active", created_at: "2026-10-01T12:00:00Z",
    profile: { active_schools: 1, missing_tax_id: 0, missing_address: 0, missing_province: 0 },
    structure: { active_locations: 1, operating_cafeterias: 1, first_cafeteria_id: u(100 + n) },
    administrators: { active: configured ? 1 : 0, requests: [] },
    staff: { active_pos: configured ? 1 : 0, pending_invitations: 0, expired_invitations: 0 },
    registers: { active: configured ? 1 : 0, staffed: configured ? 1 : 0 },
    products: { available: configured ? 12 : 0 },
    sales: { first_at: null, last_at: null } };
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) out[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...((base as unknown as Record<string, object>)[k]), ...v } : v;
  return out as CustomerReadiness;
}
export const request = (patch: Partial<CustomerReadiness["administrators"]["requests"][number]> = {}) =>
  ({ status: "pending", expires_at: "2026-10-27T01:12:00Z", request_expired: false, identity_state: "missing", link_state: "none", ...patch });
