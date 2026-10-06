import { requireAnyRole } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import styles from "../../workspace.module.css";
import { ReceiveCartControl, type AvailableEquipment } from "./receive-control";

export default async function ReceiveLaundryOrderPage() {
  await requireAnyRole(["laundry_worker", "laundry_supervisor"]);
  const supabase = await createServerSupabaseClient();
  const [categoriesResult, equipmentResult] = await Promise.all([
    supabase.from("laundry_categories").select("code, name").eq("active", true).order("sort_order", { ascending: true }),
    supabase.from("laundry_equipment").select("id, name, equipment_type, operating_site_id, occupied, status").eq("status", "normal").order("name", { ascending: true }),
  ]);
  const categories = !categoriesResult.error && Array.isArray(categoriesResult.data)
    ? categoriesResult.data.filter((item): item is { code: string; name: string } => typeof item.code === "string" && typeof item.name === "string")
    : [];
  const initialEquipment: AvailableEquipment[] = !equipmentResult.error && Array.isArray(equipmentResult.data)
    ? equipmentResult.data.map((row) => ({
        id: row.id,
        name: row.name,
        equipmentType: row.equipment_type,
        operatingSiteId: row.operating_site_id,
        occupied: Boolean(row.occupied),
        status: row.status,
      }))
    : [];

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="receive-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>LAUNDRY RECEIVING</p>
            <h1 id="receive-title">收單分類與檢查</h1>
            <p className={styles.lede}>掃描待收件洗衣車 QR 後，至少選擇一個啟用分類；數量尺度固定為一台洗衣車。</p>
          </div>
        </header>
        <ReceiveCartControl categories={categories} initialEquipment={initialEquipment} />
      </section>
    </main>
  );
}
