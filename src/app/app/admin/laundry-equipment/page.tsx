import { randomUUID } from "node:crypto";

import { getLaundryEquipmentWorkspace } from "@/lib/laundry-equipment/administration";
import { resolveEquipmentDurationFromConfig } from "@/lib/laundry-equipment/duration-config";
import { getEquipmentStatusBadge } from "@/lib/laundry-equipment/status";

import { ModuleTabs } from "../../module-tabs";
import styles from "../../workspace.module.css";
import { createLaundryEquipment, deleteLaundryEquipment, saveLaundryEquipment } from "./actions";
import { EquipmentCreateForm } from "./equipment-create-form";
import { EquipmentDeleteForm } from "./equipment-delete-form";
import { EquipmentEditForm } from "./equipment-edit-form";

const typeLabels = { disinfection_tank: "消毒鍋", washer: "洗衣機", dryer: "烘衣機" } as const;
const statusLabels = { normal: "正常", inactive: "停用", abnormal: "異常", maintenance: "維修中" } as const;

function procedureLabel(procedure: {
  id: string;
  laundry_categories?: { code?: string; name?: string } | Array<{ code?: string; name?: string }> | null;
  procedure_template_versions?: Array<{ template_name: string; status: string }>;
}) {
  const published = procedure.procedure_template_versions?.find((version) => version.status === "published");
  const cat = Array.isArray(procedure.laundry_categories) ? procedure.laundry_categories[0] : procedure.laundry_categories;
  const catPrefix = cat?.name ? `【${cat.name}】` : "";
  const name = published?.template_name ?? `程序 ${procedure.id.slice(0, 8)}`;
  return `${catPrefix}${name}`;
}


export default async function LaundryEquipmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const workspace = await getLaundryEquipmentWorkspace();
  const query = await searchParams;
  const result = typeof query.equipment === "string" ? query.equipment : "";
  const reason = typeof query.reason === "string" ? query.reason : "";

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="workspace-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>FIXED ASSET QR</p>
            <h1 id="workspace-title">洗衣設備與固定 QR</h1>
            <p className={styles.lede}>設備固定於作業據點，QR 初次產生後不隨狀態變更輪替。名稱、可容納洗衣車數、狀態與適用分類可在此修改。</p>
          </div>
        </header>
        {result === "applied" || result === "saved" ? (
          <p className={styles.successNotice} role="status">設備資料已儲存。</p>
        ) : result === "deleted" ? (
          <p className={styles.successNotice} role="status">未使用設備已刪除，原固定 QR 已失效。</p>
        ) : result === "delete-in-use" ? (
          <p className={styles.errorNotice} role="alert">此設備已有送洗、排程或操作紀錄，不能刪除；請改為停用。</p>
        ) : result === "delete-name-mismatch" ? (
          <p className={styles.errorNotice} role="alert">輸入的設備名稱不符，設備未刪除。</p>
        ) : result === "delete-denied" ? (
          <p className={styles.errorNotice} role="alert">你沒有刪除此設備的據點權限。</p>
        ) : result === "delete-invalid" ? (
          <p className={styles.errorNotice} role="alert">刪除確認資料不完整，設備未刪除。</p>
        ) : result === "denied" || reason === "site_scope_denied" ? (
          <p className={styles.errorNotice} role="alert">⚠️ 權限不足：你目前的帳號沒有此設備所在作業據點的主管管理權限。</p>
        ) : reason === "reason_required" ? (
          <p className={styles.errorNotice} role="alert">⚠️ 請填寫「異動理由」（例如：設備故障報修、例行保養維護等），此為系統強制稽核欄位，不可空白。</p>
        ) : reason === "procedure_incompatible" ? (
          <p className={styles.errorNotice} role="alert">⚠️ 所選相容程序與此設備機型不符（例如洗衣機不可勾選純烘乾程序），請檢查相容程序勾選。</p>
        ) : result === "invalid" ? (
          <p className={styles.errorNotice} role="alert">⚠️ 設備資料格式不正確或缺少必填資料，請確認「異動理由」與各欄位是否填寫完整。</p>
        ) : result ? (
          <p className={styles.errorNotice} role="alert">設備異動失敗，未套用任何變更。請確認異動理由與相容程序設定。</p>
        ) : null}

        <ModuleTabs
          ariaLabel="洗衣設備管理功能"
          storageKey="laundry-equipment"
          defaultTab="list"
          tabs={[
            { id: "create", label: "新增設備", description: "建立固定資產與 QR" },
            { id: "edit", label: "修改設備", description: "名稱、可容納洗衣車數、狀態與能力" },
            { id: "delete", label: "刪除誤建", description: "僅限完全未使用設備" },
            { id: "list", label: "設備清單", description: "檢視狀態與固定 QR", count: workspace.equipment.length },
          ]}
        >
        <section className={styles.managementSection} aria-labelledby="create-equipment-title">
          <div className={styles.sectionHeading}>
            <h2 id="create-equipment-title">登錄洗衣設備</h2>
            <p>設備類型與據點建立後固定；可依勾選之洗滌分類自訂預設清洗時間（JSON 結構），未勾選代表適用基準時間。</p>
          </div>
          <form action={createLaundryEquipment} className={styles.accessForm}>
            <EquipmentCreateForm
              sites={workspace.sites}
              categories={workspace.categories}
              procedures={workspace.procedures.map((procedure) => ({
                id: procedure.id,
                operating_site_id: procedure.operating_site_id,
                label: procedureLabel(procedure),
              }))}
              requestId={randomUUID()}
            />
          </form>
        </section>

        <section className={styles.managementSection} aria-labelledby="edit-equipment-title">
          <div className={styles.sectionHeading}>
            <h2 id="edit-equipment-title">修改設備資料</h2>
            <p>可改名稱、可容納洗衣車數、清洗時間（JSON 格式）、狀態與適用分類。設備類型與據點不可改。</p>
          </div>
          <form action={saveLaundryEquipment} className={styles.accessForm} aria-label="修改設備資料">
            <EquipmentEditForm
              equipment={workspace.equipment.map((item) => ({
                id: item.id,
                name: item.name,
                equipment_type: item.equipment_type,
                capacity_kg: item.capacity_kg,
                cleaning_duration_minutes: item.cleaning_duration_minutes,
                cleaning_duration_config: item.cleaning_duration_config,
                status: item.status,
                operating_site_id: item.operating_site_id,
                category_codes: item.category_codes,
                procedure_template_ids: item.procedure_template_ids,
              }))}
              categories={workspace.categories}
              procedures={workspace.procedures.map((procedure) => ({
                id: procedure.id,
                operating_site_id: procedure.operating_site_id,
                label: procedureLabel(procedure),
              }))}
              requestId={randomUUID()}
            />
            <button type="submit">儲存設備資料</button>
          </form>
        </section>

        <section className={`${styles.managementSection} ${styles.dangerZone}`} aria-labelledby="delete-equipment-title">
          <div className={styles.sectionHeading}>
            <h2 id="delete-equipment-title">刪除誤建設備</h2>
            <p>只有完全沒有送洗或操作紀錄的設備可以永久刪除；已有紀錄的設備請改為停用。</p>
          </div>
          <form action={deleteLaundryEquipment} className={styles.accessForm} aria-label="刪除未使用設備">
            <EquipmentDeleteForm
              equipment={workspace.equipment.map((item) => ({ id: item.id, name: item.name }))}
              requestId={randomUUID()}
            />
          </form>
        </section>

        <section aria-labelledby="equipment-list-title">
          <h2 id="equipment-list-title">目前設備</h2>
          {workspace.equipment.length === 0 ? (
            <p>目前管理範圍內尚無設備。</p>
          ) : (
            <div className={styles.tableScroller}>
              <table>
                <thead>
                  <tr>
                    <th>設備</th>
                    <th>類型</th>
                    <th>據點</th>
                    <th>可容納洗衣車</th>
                    <th>清洗時間</th>
                    <th>狀態</th>
                    <th>機構</th>
                    <th>車號</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.equipment.map((equipment) => {
                    const isOccupied = Boolean(equipment.occupied || (equipment.active_cart_count && equipment.active_cart_count > 0));
                    const institutionText = isOccupied
                      ? equipment.active_institutions && equipment.active_institutions.length > 0
                        ? equipment.active_institutions.join("、")
                        : "—"
                      : "—";
                    const cartNumberText = isOccupied
                      ? equipment.active_cart_numbers && equipment.active_cart_numbers.length > 0
                        ? equipment.active_cart_numbers.join("、")
                        : "—"
                      : "—";

                    const statusBadge = getEquipmentStatusBadge(equipment);
                    const durationMinutes = isOccupied
                      ? equipment.active_duration_minutes ??
                        resolveEquipmentDurationFromConfig(
                          equipment.cleaning_duration_config,
                          equipment.active_category_code || equipment.active_category_name,
                          equipment.cleaning_duration_minutes ?? 60,
                          equipment.equipment_type
                        )
                      : null;

                    return (
                      <tr key={equipment.id}>
                        <td>{equipment.name}</td>
                        <td>{typeLabels[equipment.equipment_type]}</td>
                        <td>
                          {equipment.operating_sites.code} · {equipment.operating_sites.name}
                        </td>
                        <td>1 台</td>
                        <td>
                          {isOccupied && durationMinutes ? (
                            <span>
                              {durationMinutes} 分鐘
                              {equipment.active_category_name ? ` (${equipment.active_category_name})` : ""}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.35rem",
                              padding: "0.2rem 0.55rem",
                              borderRadius: "9999px",
                              fontSize: "0.82rem",
                              fontWeight: 700,
                              background: statusBadge.bg,
                              border: `1px solid ${statusBadge.border}`,
                              color: statusBadge.color,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span>{statusBadge.icon}</span>
                            <span>{statusBadge.label}</span>
                          </span>
                        </td>
                        <td>{institutionText}</td>
                        <td>{cartNumberText}</td>
                        <td>
                          <a href={`/app/admin/laundry-equipment/${equipment.id}/qr`}>
                            查看 {equipment.name} 固定 QR
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        </ModuleTabs>
      </section>
    </main>
  );
}
