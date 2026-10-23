import { describe, expect, it } from "vitest";
import { classifyError, classifyStatus, messageKinds, stateCopy } from "./state-classes";

// UX 14: the classification is small and stable. Codes decide by default; named business refusals
// keep their own meaning; unknown problems are honest "temporary" failures, never a guess.
describe("classifyError", () => {
  it("maps Postgres codes to the UX kind", () => {
    expect(classifyError({ code: "42501", message: "cafeteria_authority_required" })).toBe("permission");
    expect(classifyError({ code: "P0002", message: "no_data_found" })).toBe("not_found");
    expect(classifyError({ code: "PGRST116" })).toBe("not_found");
    expect(classifyError({ code: "22023", message: "invalid_period" })).toBe("validation");
    expect(classifyError({ code: "23505", message: "request_key_reused" })).toBe("validation");
    expect(classifyError({ code: "40001", message: "serialization" })).toBe("temporary");
    expect(classifyError({ code: "54000", message: "student_export_limit" })).toBe("validation");
  });
  it("keeps the semantics of named refusals even under the same code: context matters", () => {
    expect(classifyError({ code: "42501", message: "temporary_access_expired" })).toBe("permission");
    expect(classifyError({ code: "42501", message: "customer_suspended" })).toBe("lifecycle");
    expect(classifyError({ code: "42501", message: "customer_closed" })).toBe("lifecycle");
    expect(classifyError({ code: "42501", message: "demo_mode_active" })).toBe("permission");
    expect(classifyError({ code: "23514", message: "register_session_closed" })).toBe("lifecycle");
    expect(classifyError({ code: "23514", message: "register_not_ready" })).toBe("not_configured");
    expect(classifyError({ code: "22023", message: "FINANCIAL_POLICY_NOT_ACTIVE" })).toBe("not_configured");
  });
  it("lets a surface declare its own names without widening the shared table", () => {
    expect(classifyError({ code: "42501", message: "today_unavailable" }, { today_unavailable: "temporary" })).toBe("temporary");
    expect(messageKinds.today_unavailable).toBeUndefined();
  });
  it("never invents a reason: unknown codes, unknown messages and missing errors are temporary", () => {
    expect(classifyError({ code: "XX000", message: "something" })).toBe("temporary");
    expect(classifyError({ message: "fetch failed" })).toBe("temporary");
    expect(classifyError(null)).toBe("temporary"); expect(classifyError(undefined)).toBe("temporary");
  });
});

describe("classifyStatus", () => {
  it("reads PIKAS' own route statuses and named errors", () => {
    expect(classifyStatus(403, { error: "cafeteria_authority_required" })).toBe("permission");
    expect(classifyStatus(401)).toBe("permission");
    expect(classifyStatus(404)).toBe("not_found");
    expect(classifyStatus(422, { error: "invalid_period" })).toBe("validation");
    expect(classifyStatus(413, { error: "student_export_limit" })).toBe("validation");
    expect(classifyStatus(403, { error: "customer_closed" })).toBe("lifecycle");
    expect(classifyStatus(503, { error: "today_unavailable" })).toBe("temporary");
    expect(classifyStatus(409, { error: "operation_unconfirmed" })).toBe("temporary");
  });
});

describe("default copy", () => {
  it("only a temporary failure invites a retry; every kind names a next step", () => {
    expect(stateCopy.temporary.retry).toBe(true);
    for (const kind of ["permission", "not_found", "not_configured", "lifecycle", "validation"] as const) {
      expect(stateCopy[kind].retry).toBe(false); expect(stateCopy[kind].description.length).toBeGreaterThan(20);
    }
    expect(stateCopy.permission.description).not.toMatch(/intent/i);
  });
});
