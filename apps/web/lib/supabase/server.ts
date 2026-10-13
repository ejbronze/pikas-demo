import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const expectedSession = (await headers()).get("x-pikas-session-id");
  const { url, anonKey } = getSupabasePublicConfig();

  return createServerClient(url, anonKey, {
    global: { headers: expectedSession ? { "x-pikas-session-id": expectedSession } : {} },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("Cookies can only be modified")
          ) {
            return;
          }
          throw error;
        }
      },
    },
  });
}
