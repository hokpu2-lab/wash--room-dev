import { NextResponse } from "next/server";

import { consumeSsoFlashMessage } from "@/lib/auth/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const message = await consumeSsoFlashMessage();
  return NextResponse.json(
    { message },
    {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
