import { describe, expect, it, vi } from "vitest";

const { createSupabaseServerClient } = vi.hoisted(() => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
import { POST } from "./route";

describe("POST /api/platform/tenants (retired)", () => {
  it("is retired: answers 410 with the supported replacement and never reaches the database", async () => {
    const response = await POST();
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "route_retired", replacement: "/api/platform/schools/onboard" });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
});
