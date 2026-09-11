import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicSupabaseConfiguration } from "./config";

export function createSupabaseAdminClient() {
  const configuration = getPublicSupabaseConfiguration();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!configuration || !serviceRoleKey) return null;

  return createClient(configuration.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
