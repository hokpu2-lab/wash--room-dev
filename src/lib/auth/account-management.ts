import "server-only";

import { z } from "zod";

import { requireRole } from "./principal";
import { managedAccountSchema, type ManagedAccount } from "./account-management-schema";
import { createServerSupabaseClient } from "../supabase/server";

export async function listManagedAccounts(): Promise<ManagedAccount[] | null> {
  await requireRole("laundry_supervisor");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("list_manageable_user_accounts");
  const parsed = z.array(managedAccountSchema).safeParse(data);
  return error || !parsed.success ? null : parsed.data;
}

export async function getManagedAccount(profileId: string) {
  const accounts = await listManagedAccounts();
  return accounts?.find((account) => account.profile_id === profileId) ?? null;
}
