import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getPublicSupabaseConfiguration } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname.startsWith("/auth/") ||
    request.nextUrl.pathname.startsWith("/prototype") ||
    request.nextUrl.pathname.startsWith("/scan/cart") ||
    request.nextUrl.pathname.startsWith("/scan/pickup") ||
    request.nextUrl.pathname.startsWith("/scan/equipment")
  ) {
    return NextResponse.next({ request });
  }

  const hasAuthCookie = request.cookies.getAll().some((cookie) =>
    cookie.name.includes("-auth-token") || cookie.name.startsWith("sb-"),
  );
  if (!hasAuthCookie) {
    return NextResponse.next({ request });
  }

  const isRootRequest = request.nextUrl.pathname === "/";

  if (sessionStillFresh(request) && !isRootRequest) {
    const fresh = NextResponse.next({ request });
    persistWorkspaceScope(request, fresh);
    return fresh;
  }

  const configuration = getPublicSupabaseConfiguration();

  if (!configuration) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const cookiesForBrowser = new Map<
    string,
    { name: string; value: string; options: CookieOptions }
  >();
  const authResponseHeaders = new Headers();

  const supabase = createServerClient(
    configuration.url,
    configuration.publishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headersToSet) {
          cookiesToSet.forEach((cookie) => {
            request.cookies.set(cookie.name, cookie.value);
            cookiesForBrowser.set(cookie.name, cookie);
          });
          Object.entries(headersToSet).forEach(([name, value]) => {
            authResponseHeaders.set(name, value);
          });

          response = NextResponse.next({ request });
          cookiesForBrowser.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
          authResponseHeaders.forEach((value, name) => {
            response.headers.set(name, value);
          });
        },
      },
    },
  );

  // This is the earliest request boundary. It only verifies/refreshes the
  // Supabase session; pages and actions still perform their own authorization
  // checks and all data access remains protected by RLS.
  const claimsResult = await supabase.auth.getClaims();
  const hasVerifiedSubject =
    !claimsResult.error && typeof claimsResult.data?.claims?.sub === "string";

  if (isRootRequest && hasVerifiedSubject) {
    const redirectResponse = NextResponse.redirect(new URL("/app", request.url));
    cookiesForBrowser.forEach(({ name, value, options }) => {
      redirectResponse.cookies.set(name, value, options);
    });
    authResponseHeaders.forEach((value, name) => {
      redirectResponse.headers.set(name, value);
    });
    return redirectResponse;
  }

  if (isRootRequest) {
    return response;
  }

  persistWorkspaceScope(request, response);
  return response;
}

function persistWorkspaceScope(request: NextRequest, response: NextResponse) {
  if (!request.nextUrl.pathname.startsWith("/app")) return;
  const site = request.nextUrl.searchParams.get("site");
  const institution = request.nextUrl.searchParams.get("institution");
  const options = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 30 };
  if (site && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(site)) {
    response.cookies.set("wr_workspace_site", site, options);
  }
  if (
    institution &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(institution)
  ) {
    response.cookies.set("wr_workspace_institution", institution, options);
  }
}

function sessionStillFresh(request: NextRequest): boolean {
  const cookie = request.cookies.getAll().find((item) => item.name.includes("-auth-token"));
  if (!cookie?.value.startsWith("base64-")) return false;
  try {
    const encoded = cookie.value.slice("base64-".length);
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const session = JSON.parse(atob(normalized + pad)) as { expires_at?: number };
    return typeof session.expires_at === "number" && session.expires_at * 1000 > Date.now() + 15_000;
  } catch {
    return false;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
