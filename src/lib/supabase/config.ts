export type PublicSupabaseConfiguration = {
  url: string;
  publishableKey: string;
};

export function getPublicSupabaseConfiguration(): PublicSupabaseConfiguration | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    return null;
  }

  return { url, publishableKey };
}

export function getApplicationOrigin(): string {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!configuredOrigin) {
    throw new Error("NEXT_PUBLIC_APP_URL is required for authentication redirects");
  }

  const url = new URL(configuredOrigin);
  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (
    (url.protocol !== "https:" && !isLocalHttp) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("NEXT_PUBLIC_APP_URL must be a trusted application origin");
  }

  return url.origin;
}
