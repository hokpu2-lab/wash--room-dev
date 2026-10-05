import { hasPendingSsoFlashMessage } from "@/lib/auth/sso";

import { SsoFlashNoticeClient } from "./sso-flash-notice-client";

export async function SsoFlashNotice() {
  if (!(await hasPendingSsoFlashMessage())) return null;

  return <SsoFlashNoticeClient />;
}
