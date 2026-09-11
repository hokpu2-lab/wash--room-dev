import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicSupabaseConfiguration } from "./config";

type ServerSupabaseClientOptions = {
  cookieWritesRequired?: boolean;
  responseHeaders?: Headers;
};

export async function createServerSupabaseClient(
  options: ServerSupabaseClientOptions = {},
) {
  const configuration = getPublicSupabaseConfiguration();

  if (!configuration) {
    throw new Error("Supabase public configuration is unavailable");
  }

  const cookieStore = await cookies();

  return createServerClient(configuration.url, configuration.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, authHeaders) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch (error) {
          // Server Components cannot write cookies. src/proxy.ts refreshes the
          // session before they render; Actions and Route Handlers can write.
          if (options.cookieWritesRequired) throw error;
        }

        Object.entries(authHeaders).forEach(([name, value]) => {
          options.responseHeaders?.set(name, value);
        });
      },
    },
  });
}
