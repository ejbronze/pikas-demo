import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { exchangeCodeForSession, createSupabaseServerClient } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient,
}));

import { GET } from "./route";

describe("Auth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSupabaseServerClient.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });
    exchangeCodeForSession.mockResolvedValue({ error: null });
  });

  it("exchanges the PKCE code before redirecting to password recovery", async () => {
    const response = await GET(
      new NextRequest("https://pikas-pikas.app/auth/callback?code=one-time-code"),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
    expect(response.headers.get("location")).toBe(
      "https://pikas-pikas.app/actualizar-contrasena",
    );
  });

  it("does not exchange or redirect the code when exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: new Error("exchange failed"),
    });

    const response = await GET(
      new NextRequest("https://pikas-pikas.app/auth/callback?code=one-time-code"),
    );

    expect(response.headers.get("location")).toBe(
      "https://pikas-pikas.app/forgot-password",
    );
  });

  it("does not attempt an exchange when the callback has no code", async () => {
    const response = await GET(
      new NextRequest("https://pikas-pikas.app/auth/callback"),
    );

    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://pikas-pikas.app/forgot-password",
    );
  });
});
