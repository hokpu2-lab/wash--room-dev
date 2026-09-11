import { requireAnyRole } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import styles from "../../workspace.module.css";
import { SplitControl } from "./control";

export default async function SplitPage() {
  await requireAnyRole(["laundry_worker", "laundry_supervisor"]);
  const supabase = await createServerSupabaseClient();
  const [{ data: orders }, { data: categories }] = await Promise.all([
    supabase.from("laundry_orders").select("id,status").in("status", ["awaiting_cleaning", "in_process"]).order("created_at", { ascending: true }),
    supabase.from("laundry_categories").select("code,name").eq("active", true).order("sort_order", { ascending: true }),
  ]);
  const safeOrders = Array.isArray(orders) ? orders.filter((item): item is { id: string; status: string } => typeof item?.id === "string" && typeof item?.status === "string") : [];
  const safeCategories = Array.isArray(categories) ? categories.filter((item): item is { code: string; name: string } => typeof item?.code === "string" && typeof item?.name === "string") : [];
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="split-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>BATCH SPLIT</p>
            <h1 id="split-title">拆分必要批次</h1>
            <p className={styles.lede}>依新增分類建立有序必要批次；不改寫既有批次的程序版本。</p>
          </div>
        </header>
        <section className={styles.managementSection}>
          <SplitControl orders={safeOrders} categories={safeCategories} />
        </section>
      </section>
    </main>
  );
}
