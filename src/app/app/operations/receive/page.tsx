import { requireAnyRole } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import styles from "../../workspace.module.css";
import { ReceiveCartControl } from "./receive-control";

export default async function ReceiveLaundryOrderPage() {
  await requireAnyRole(["laundry_worker", "laundry_supervisor"]);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("laundry_categories").select("code, name").eq("active", true).order("sort_order", { ascending: true });
  const categories = !error && Array.isArray(data) ? data.filter((item): item is { code: string; name: string } => typeof item.code === "string" && typeof item.name === "string") : [];
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="receive-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>LAUNDRY RECEIVING</p>
            <h1 id="receive-title">收單與分類</h1>
            <p className={styles.lede}>掃描待收件洗衣車 QR 後，至少選擇一個啟用分類；數量尺度固定為一台洗衣車。</p>
          </div>
        </header>
        <ReceiveCartControl categories={categories} />
      </section>
    </main>
  );
}
