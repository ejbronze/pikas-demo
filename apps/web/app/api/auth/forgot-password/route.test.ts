import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resetPasswordForEmail, createSupabaseServerClient, isDemoMode } =
  vi.hoisted(() => ({
    resetPasswordForEmail: vi.fn(),
    createSupabaseServerClient: vi.fn(),
    isDemoMode: vi.fn(),
  }));

vi.mock("@/lib/env", () => ({ isDemoMode }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient,
}));

import { POST } from "./route";

describe("forgot-password route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDemoMode.mockReturnValue(false);
    resetPasswordForEmail.mockResolvedValue({ error: null });
    createSupabaseServerClient.mockResolvedValue({
      auth: { resetPasswordForEmail },
    });
  });

  it("sends recovery links through the application PKCE callback", async () => {
    const form = new FormData();
    form.set("email", "edwin@example.com");
    const request = new NextRequest(
      "https://pikas-pikas.app/api/auth/forgot-password",
      { method: "POST", body: form },
    );

    const response = await POST(request);

    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "edwin@example.com",
      { redirectTo: "https://pikas-pikas.app/auth/callback" },
    );
    expect(response.status).toBe(200);
  });

  it("does not send recovery email in demo mode", async () => {
    isDemoMode.mockReturnValue(true);
    const form = new FormData();
    form.set("email", "edwin@example.com");
    const request = new NextRequest(
      "https://pikas-pikas.app/api/auth/forgot-password",
      { method: "POST", body: form },
    );

    const response = await POST(request);

    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});
