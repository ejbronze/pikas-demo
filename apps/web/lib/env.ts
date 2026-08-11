export function isDemoMode(){return process.env.NEXT_PUBLIC_PIKAS_DEMO_MODE==="true"}
export function hasSupabaseEnv(){return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)}
