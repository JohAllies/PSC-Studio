import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null | undefined;

export const getSupabaseUrl = () => import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
export const getSupabaseAnonKey = () => import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

export const isSupabaseConfigured = () =>
  getSupabaseUrl().length > 0 && getSupabaseAnonKey().length > 0;

export const getSupabaseClient = (): SupabaseClient | null => {
  if (supabaseClient !== undefined) {
    return supabaseClient;
  }

  if (!isSupabaseConfigured()) {
    supabaseClient = null;
    return supabaseClient;
  }

  supabaseClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return supabaseClient;
};
