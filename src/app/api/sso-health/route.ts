import { NextResponse } from "next/server";

import {
  SSO_CALLBACK_PATH,
  SSO_HEALTH_PATH,
  SSO_SYSTEM_CODE,
} from "@/lib/auth/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "wash-room",
      checkedAt: new Date().toISOString(),
      version: "v1",
      system: "wash-room",
      systemCode: SSO_SYSTEM_CODE,
      server: "nextjs",
      client: "supabase",
      callbackPath: SSO_CALLBACK_PATH,
      healthPath: SSO_HEALTH_PATH,
      flows: ["login", "account_binding"],
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
