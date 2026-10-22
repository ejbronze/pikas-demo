import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePikasIdentity } from "@/lib/auth/pikas-context";
import { demoMutationBlock } from "./demo-guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

type PlatformRpcResponse = {
  data: unknown;
  error: { code: string; message?: string } | null;
};

type PlatformRpcPostOptions<TPayload, TResult> = {
  capability: string;
  schema: z.ZodType<TPayload>;
  resultSchema: z.ZodType<TResult>;
  invoke: (
    supabase: SupabaseServerClient,
    payload: TPayload,
    requestId: string,
  ) => PromiseLike<PlatformRpcResponse>;
  // Definite, user-correctable rejections returned as 422 with their code (never secrets).
  rejections?: (message: string | undefined) => boolean;
  // UX 11: real Platform mutations are refused while the operator has a current Demo POV. Only the
  // Demo controls themselves (enter, switch, exit) pass "allow".
  demo?: "allow" | "block";
};

function hasSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") return code;
  }
  if (error instanceof Error) return error.name;
  return "unknown";
}

export function createPlatformRpcPostHandler<TPayload, TResult>({
  capability,
  schema,
  resultSchema,
  invoke,
  rejections,
  demo = "block",
}: PlatformRpcPostOptions<TPayload, TResult>) {
  return async function POST(request: NextRequest) {
    if (!hasSameOrigin(request)) {
      return NextResponse.json({ error: "same_origin_required" }, { status: 403 });
    }

    const requestId = z.uuid().safeParse(request.headers.get("Idempotency-Key"));
    if (!requestId.success) {
      return NextResponse.json(
        { error: "invalid_idempotency_key" },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }

    let supabase: SupabaseServerClient;
    let identity: Awaited<ReturnType<typeof resolvePikasIdentity>>;
    try {
      supabase = await createSupabaseServerClient();
      identity = await resolvePikasIdentity(supabase);
    } catch (error) {
      console.error("Platform RPC authorization failed", { code: errorCode(error) });
      return NextResponse.json(
        { error: "authorization_unavailable" },
        { status: 503 },
      );
    }

    if (identity.status === "unauthenticated") {
      return NextResponse.json(
        { error: "authentication_required" },
        { status: 401 },
      );
    }

    if (
      identity.status !== "ready" ||
      !identity.platform?.capabilities.includes(capability)
    ) {
      return NextResponse.json(
        { error: "platform_authorization_required" },
        { status: 403 },
      );
    }

    if (demo !== "allow") {
      const block = await demoMutationBlock(supabase, identity);
      if (block) return NextResponse.json({ error: block.error }, { status: block.status });
    }

    let rpcResponse: PlatformRpcResponse;
    try {
      rpcResponse = await invoke(supabase, parsed.data, requestId.data);
    } catch (error) {
      console.error("Platform RPC failed", { code: errorCode(error) });
      return NextResponse.json(
        { error: "platform_operation_unavailable" },
        { status: 502 },
      );
    }

    if (rpcResponse.error) {
      console.error("Platform RPC rejected the request", {
        code: rpcResponse.error.code,
      });
      if (rejections?.(rpcResponse.error.message)) {
        return NextResponse.json({ error: rpcResponse.error.message }, { status: 422 });
      }
      if (rpcResponse.error.code === "42501") {
        return NextResponse.json(
          { error: "platform_authorization_required" },
          { status: 403 },
        );
      }
      if (rpcResponse.error.code === "23505") {
        return NextResponse.json(
          { error: "platform_operation_conflict" },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "platform_operation_unavailable" },
        { status: 502 },
      );
    }

    const result = resultSchema.safeParse(rpcResponse.data);
    if (!result.success) {
      console.error("Platform RPC returned an invalid result");
      return NextResponse.json(
        { error: "platform_operation_unavailable" },
        { status: 502 },
      );
    }

    return NextResponse.json({ result: result.data });
  };
}
