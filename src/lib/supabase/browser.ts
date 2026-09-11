import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseConfiguration } from "./config";

export function createBrowserSupabaseClient() {
  const configuration = getPublicSupabaseConfiguration();
  if (!configuration) return null;
  return createBrowserClient(configuration.url, configuration.publishableKey);
}
