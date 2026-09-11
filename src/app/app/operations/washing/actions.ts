"use server";

import { requireAnyRole } from "@/lib/auth/principal";

import { loadSiteBatches } from "../load-site-batches";

export async function loadWashingControlData(siteId?: string) {
  await requireAnyRole(["laundry_worker", "laundry_supervisor"]);
  return loadSiteBatches(siteId ? { site: siteId } : {}, ["not_started"]);
}
