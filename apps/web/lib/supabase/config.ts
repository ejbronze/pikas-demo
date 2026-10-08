export type SupabasePublicConfig = {
  url: string;
  anonKey: string;
};

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const projectRef = process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF;

  if (!url || !anonKey || !projectRef) {
    throw new Error("Supabase URL, publishable key, and project ref are required.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
  }

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== `${projectRef}.supabase.co`
  ) {
    throw new Error("Supabase URL does not match NEXT_PUBLIC_SUPABASE_PROJECT_REF.");
  }

  return { url, anonKey };
}
