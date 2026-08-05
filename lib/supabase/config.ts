// NEXT_PUBLIC_* vars are inlined at build time, so this is safe to check from
// both server and client components.
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
