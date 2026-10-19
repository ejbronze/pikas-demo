import { describe, expect, it, vi } from "vitest";
import { organizationDenial } from "./tenant-lifecycle";

describe("organization lifecycle denial message", () => {
  it.each([["suspended", "organization_suspended"], ["closed", "organization_closed"], [null, null]])("%s → %s", async (data, expected) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    expect(await organizationDenial({ rpc })).toBe(expected); expect(rpc).toHaveBeenCalledWith("tenant_lifecycle_state");
  });
  it("fails closed to the existing generic denial on errors", async () => {
    expect(await organizationDenial({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } }) })).toBeNull();
    expect(await organizationDenial({ rpc: vi.fn().mockRejectedValue(new Error("down")) })).toBeNull();
  });
});
