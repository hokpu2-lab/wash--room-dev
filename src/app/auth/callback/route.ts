import { NextResponse } from "next/server";

import { getApplicationOrigin } from "@/lib/supabase/config";

export function GET() {
  return NextResponse.redirect(
    new URL("/login?error=credentials", getApplicationOrigin()),
  );
}
