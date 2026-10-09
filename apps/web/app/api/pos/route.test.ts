import { beforeEach, describe, expect, it, vi } from "vitest";
import { posContext } from "../../../lib/pos/access-context.test-fixtures";

const mocks = vi.hoisted(() => ({ create: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
vi.mock("@/lib/auth/pos-access", () => ({ resolvePosAccess: mocks.access }));
import { POST } from "./route";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = posContext();
const cafe = context.memberships[0].cafeteria_id;
const register = { cafeteria_id: cafe, register_id: id(1), assignment_id: id(2), register_code: "R1", display_name: "Caja", register_version: 1, assignment_version: 1 };
const session = { ...register, session_id: id(3), status: "open", version: 1, opening_cash_minor: "10000", currency_code: "DOP", register_code_snapshot: "R1", register_name_snapshot: "Caja" };
const catalog = { cafeteria_id: cafe, status: "manual", currency_code: "DOP", service_shift: null, menu: null,
  products: [{ product_id: id(4), name: "Producto", description: null, category_id: null, category_name: null, price_minor: 10000, version: 1, currency_code: "DOP" }] };
const customer = { customer_id: id(5), customer_type: "student", display_name: "Estudiante", student_code: null, grade_label: null, class_label: null, restrictions: [] };
const pc = { customer_id: id(5), customer_type: "student", currency_code: "DOP", business_date: "2026-10-09", business_timezone: "America/Santo_Domingo",
  as_of: "2026-10-09T12:00:00Z", wallet: { status: "active", balance_minor: "50000" }, daily_limit: { enabled: false, limit_minor: null },
  per_transaction_limit: { enabled: false, limit_minor: null }, spent_today_minor: "0", available_today_minor: "50000", restrictions: [] };
const checkout = { request_key: id(6), register_session_id: session.session_id, cafeteria_customer_id: customer.customer_id,
  items: [{ product_id: id(4), quantity: 1, expected_product_version: 1, expected_unit_price_minor: "10000" }], expected_total_minor: "10000", tender: { type: "student_wallet" } };
const receipt = { purchase_id: id(7), purchase_number: "1", purchased_at: "2026-10-09T12:00:00Z", business_date: "2026-10-09", business_timezone: "America/Santo_Domingo",
  currency_code: "DOP", total_minor: "10000", register_id: register.register_id, register_session_id: session.session_id,
  cafeteria_customer_id: customer.customer_id, customer_type: "student", customer_name: "Committed student", tender_type: "student_wallet",
  cash_received_minor: null, change_due_minor: null, wallet_balance_after_minor: "40000",
  items: [{ product_id: id(4), name: "Committed name", product_version: 1, unit_price_minor: "10000", quantity: 1, line_total_minor: "10000" }] };
const responses: Record<string, unknown> = { list_my_operable_registers: [register], get_my_open_register_session: [session],
  get_cafeteria_saleable_catalog: catalog, cafeteria_customer_projection: [customer], get_pos_customer_purchase_context: pc, checkout_purchase: receipt };
function call(body: unknown, origin: string | null = "https://pikas-pikas.app", key = checkout.request_key) {
  return POST(new Request("https://pikas-pikas.app/api/pos", { method: "POST", headers: {
    "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), "Idempotency-Key": key }, body: JSON.stringify(body) }));
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.access.mockResolvedValue({ status: "authorized", context });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: responses[name], error: null }));
});

describe("authenticated POS adapter", () => {
  it.each([null, "https://other.example"])("requires same-origin requests (%s)", async (origin) => {
    expect((await call({ operation: "bootstrap" }, origin)).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["unauthenticated", "forbidden", "unavailable"])("fails closed for %s POS authority", async (status) => {
    mocks.access.mockResolvedValue({ status }); const response = await call({ operation: "bootstrap" });
    expect(response.status).toBe(status === "unauthenticated" ? 401 : status === "forbidden" ? 403 : 503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["cafeteria_id", "actor_id", "membership_id", "persona_id", "role"])("rejects client authority %s", async (field) => {
    expect((await call({ operation: "bootstrap", [field]: id(99) })).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("derives catalog scope from the exact authenticated open session", async () => {
    const response = await call({ operation: "bootstrap" }); expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("get_cafeteria_saleable_catalog", { p_cafeteria_id: cafe });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).result.context.actor.person_id).toBe(context.actor.person_id);
  });
  it("also supports ordinary tenant POS context", async () => {
    mocks.access.mockResolvedValue({ status: "authorized", context: { ...context, pov: null } });
    expect((await call({ operation: "bootstrap" })).status).toBe(200);
  });
  it.each([[], [{ ...session, cafeteria_id: id(99) }], [{ ...session, assignment_id: id(99) }], [session, session]].map((sessions) => ({ sessions })))("blocks missing/foreign/ambiguous open-session state ($sessions)", async ({ sessions }) => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "get_my_open_register_session" ? sessions : responses[name], error: null }));
    const response = await call({ operation: "bootstrap" }); expect(response.status).toBe(200); expect((await response.json()).result.session).toBeNull();
    expect(mocks.rpc.mock.calls.some(([name]) => name === "get_cafeteria_saleable_catalog")).toBe(false);
    expect((await call({ operation: "customer", customer_id: customer.customer_id })).status).toBe(409);
  });
  it("filters operable registers outside the effective membership scope", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "list_my_operable_registers" ? [register, { ...register, cafeteria_id: id(99) }] : responses[name], error: null }));
    const result = (await (await call({ operation: "bootstrap" })).json()).result; expect(result.registers).toEqual([register]);
  });
  it("keeps no-active-service and empty-catalog states blocked", async () => {
    for (const value of [{ ...catalog, status: "no_active_service", products: [] }, { ...catalog, products: [] }]) {
      mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "get_cafeteria_saleable_catalog" ? value : responses[name], error: null }));
      expect((await (await call({ operation: "bootstrap" })).json()).result.blocked).not.toBeNull();
    }
  });
  it("rejects malformed or cross-scope catalog data instead of demo fallback", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "get_cafeteria_saleable_catalog" ? { ...catalog, cafeteria_id: id(99) } : responses[name], error: null }));
    expect((await call({ operation: "bootstrap" })).status).toBe(502);
  });
  it("searches students with server-derived cafeteria scope and returns authoritative pre-sale context", async () => {
    expect((await call({ operation: "search", query: "Estudiante" })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("cafeteria_customer_projection", { p_cafeteria_id: cafe, p_query: "Estudiante" });
    const response = await call({ operation: "customer", customer_id: customer.customer_id }); expect((await response.json()).result.wallet.balance_minor).toBe("50000");
    expect(mocks.rpc).toHaveBeenCalledWith("get_pos_customer_purchase_context", { p_cafeteria_id: cafe, p_cafeteria_customer_id: customer.customer_id });
  });
  it("rejects mismatched customer or currency context", async () => {
    for (const value of [{ ...pc, customer_id: id(99) }, { ...pc, currency_code: "USD" }]) {
      mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "get_pos_customer_purchase_context" ? value : responses[name], error: null }));
      expect((await call({ operation: "customer", customer_id: customer.customer_id })).status).toBe(502);
    }
  });
  it("filters staff search results and rejects wildcard searches", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "cafeteria_customer_projection" ? [customer, { ...customer, customer_type: "staff", customer_id: id(99) }] : responses[name], error: null }));
    expect((await (await call({ operation: "search", query: "Estudiante" })).json()).result).toEqual([customer]);
    expect((await call({ operation: "search", query: "%" })).status).toBe(400);
  });
  it("forwards only checkout targets/evidence, never actor/persona/role/cafeteria authority", async () => {
    const response = await call({ operation: "checkout", request: checkout }); expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("checkout_purchase", { p_request: checkout });
    expect((await response.json()).result.items[0].name).toBe("Committed name");
  });
  it("supports unchanged replay targets without requiring an open register again", async () => {
    expect((await call({ operation: "checkout", request: checkout })).status).toBe(200);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "get_my_open_register_session")).toBe(false);
  });
  it("validates cash received/change and permits only wallet or cash tenders", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...receipt, tender_type: "cash", wallet_balance_after_minor: null, cash_received_minor: "15000", change_due_minor: "5000" }, error: null });
    expect((await call({ operation: "checkout", request: { ...checkout, tender: { type: "cash", cash_received_minor: "15000" } } })).status).toBe(200);
    expect((await call({ operation: "checkout", request: { ...checkout, tender: { type: "staff_credit" } } })).status).toBe(400);
  });
  it("requires matching idempotency header and rejects supplied checkout authority", async () => {
    expect((await call({ operation: "checkout", request: checkout }, undefined, id(99))).status).toBe(400);
    expect((await call({ operation: "checkout", request: { ...checkout, actor_id: id(99) } })).status).toBe(400);
  });
  it("marks known DB rollback errors definite but treats conflicts/timeouts/invalid receipts as uncertain", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "PRODUCT_STALE" } });
    let response = await call({ operation: "checkout", request: checkout }); expect(response.status).toBe(409); expect((await response.json()).definite).toBe(true);
    for (const message of ["IDEMPOTENCY_CONFLICT", "query timeout", "not_authorized"]) {
      mocks.rpc.mockResolvedValue({ data: null, error: { code: "23505", message } }); response = await call({ operation: "checkout", request: checkout });
      expect((await response.json()).definite).toBe(false);
    }
    mocks.rpc.mockResolvedValue({ data: { ...receipt, total_minor: "1" }, error: null });
    expect((await call({ operation: "checkout", request: checkout })).status).toBe(502);
  });
});

describe("connected register lifecycle", () => {
 it("opens only a register in authoritative scope and derives assignment", async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "open_register_session" ? [{ session_id: session.session_id, status: "open", version: 1 }] : responses[name], error: null }));
  expect((await call({ operation: "open_register", register_id: register.register_id, opening_cash_minor: "10000", request_key: checkout.request_key })).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("open_register_session", { p_register_id: register.register_id, p_assignment_id: register.assignment_id, p_opening_cash_minor: "10000", p_open_request_key: checkout.request_key });
  expect((await call({ operation: "open_register", register_id: id(99), opening_cash_minor: "10000", request_key: checkout.request_key })).status).toBe(403);
 });
 it("guards close and closed-session replay using effective scope", async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "get_pos_register_session" ? { session_id: session.session_id } : name === "close_my_register_session" ? [{ session_id: session.session_id, status: "closed", version: 2 }] : responses[name], error: null }));
  const op = { operation: "close_register", session_id: session.session_id, expected_version: 1, counted_cash_minor: "15000", request_key: checkout.request_key };
  expect((await call(op)).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("get_pos_register_session", { p_session_id: session.session_id });
  expect(mocks.rpc).toHaveBeenCalledWith("close_my_register_session", { p_session_id: session.session_id, p_expected_version: 1, p_counted_cash_minor: "15000", p_close_request_key: checkout.request_key });
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect((await call(op)).status).toBe(403);
 });
 it("rejects supplied register authority and missing idempotency header", async () => {
  const op = { operation: "open_register", register_id: register.register_id, opening_cash_minor: "0", request_key: checkout.request_key };
  expect((await call({ ...op, assignment_id: register.assignment_id })).status).toBe(400);
  expect((await call(op, "https://pikas-pikas.app", id(99))).status).toBe(400);
 });
});
