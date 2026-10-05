import { NextResponse } from "next/server";

import {
  clearPendingSsoBinding,
  completeCentralSsoBinding,
  createTargetSsoSession,
  parseSsoRequest,
  resolveCurrentTargetSsoAccount,
  resolveLocalSsoAccount,
  savePendingSsoBinding,
  saveSsoFlashMessage,
  saveSsoSessionMarker,
  SsoFlowError,
  type SsoBindingResult,
  verifyCentralSsoTicket,
} from "@/lib/auth/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseHeaders() {
  return {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function loginRedirect(request: Request, query: Record<string, string>) {
  const url = new URL("/login", request.url);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return NextResponse.redirect(url, {
    status: 303,
    headers: responseHeaders(),
  });
}

function appRedirect(request: Request) {
  return NextResponse.redirect(new URL("/app", request.url), {
    status: 303,
    headers: responseHeaders(),
  });
}

function errorResponse(request: Request, error: unknown) {
  const code = error instanceof SsoFlowError ? error.code : "sso_verification_failed";
  if (request.method === "GET") return loginRedirect(request, { error: "sso" });
  return NextResponse.json(
    { ok: false, error: code },
    { status: code === "sso_configuration" ? 503 : 400, headers: responseHeaders() },
  );
}

async function handleSsoRequest(request: Request): Promise<Response> {
  try {
    const ssoRequest = await parseSsoRequest(request);

    if (ssoRequest.flow === "account_binding") {
      const current = await resolveCurrentTargetSsoAccount();
      if (!current) {
        await savePendingSsoBinding(ssoRequest.ticket);
        return loginRedirect(request, { next: "/api/sso-login" });
      }

      let bindingResult: SsoBindingResult;
      try {
        bindingResult = await completeCentralSsoBinding(
          ssoRequest.ticket,
          current.account,
        );
      } finally {
        await clearPendingSsoBinding();
      }
      await saveSsoFlashMessage(
        bindingResult === "pending_review"
          ? "account_binding_pending_review"
          : "account_binding_complete",
      );
      return appRedirect(request);
    }

    const identity = await verifyCentralSsoTicket(
      ssoRequest.ticket,
      ssoRequest.systemCode,
    );
    const account = await resolveLocalSsoAccount(identity);
    await createTargetSsoSession(account);
    await saveSsoSessionMarker(account);
    await saveSsoFlashMessage("login");
    return appRedirect(request);
  } catch (error) {
    return errorResponse(request, error);
  }
}

export async function GET(request: Request) {
  return handleSsoRequest(request);
}

export async function POST(request: Request) {
  return handleSsoRequest(request);
}
