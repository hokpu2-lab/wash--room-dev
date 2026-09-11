import { randomUUID } from "node:crypto";

import { getLaundryEquipmentWorkspace } from "@/lib/laundry-equipment/administration";

import { ModuleTabs } from "../../module-tabs";
import styles from "../../workspace.module.css";
import { createLaundryEquipment, deleteLaundryEquipment, saveLaundryEquipment } from "./actions";
import { EquipmentDeleteForm } from "./equipment-delete-form";
import { EquipmentEditForm } from "./equipment-edit-form";

const typeLabels = { disinfection_tank: "消毒鍋", washer: "洗衣機", dryer: "烘衣機" } as const;
const statusLabels = { normal: "正常", inactive: "停用", abnormal: "異常", maintenance: "維修中" } as const;

function procedureLabel(procedure: {
  id: string;
  procedure_template_versions?: Array<{ template_name: string; status: string }>;
}) {
  const published = procedure.procedure_template_versions?.find((version) => version.status === "published");
  return published?.template_name ?? `程序 ${procedure.id.slice(0, 8)}`;
}

export default async function LaundryEquipmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const workspace = await getLaundryEquipmentWorkspace();
  const query = await searchParams;
  const result = typeof query.equipment === "string" ? query.equipment : "";

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
        ) : result ? (
          <p className={styles.errorNotice} role="alert">設備異動失敗，未套用任何變更。</p>
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
            <p>設備類型與據點建立後固定；適用分類未勾選代表同據點不限制。</p>
          </div>
          <form action={createLaundryEquipment} className={styles.accessForm}>
            <input name="change_request_id" type="hidden" value={randomUUID()} />
            <label>
              設備名稱
              <input name="name" maxLength={80} required />
            </label>
            <label>
              設備類型
              <select name="equipment_type" defaultValue="washer">
                <option value="disinfection_tank">消毒鍋</option>
                <option value="washer">洗衣機</option>
                <option value="dryer">烘衣機</option>
              </select>
            </label>
            <label>
              作業據點代碼
              <select name="site_code" defaultValue={workspace.sites[0]?.code ?? "MAIN"} required>
                {workspace.sites.map((site) => (
                  <option key={site.id} value={site.code}>
                    {site.name} · {site.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              可容納洗衣車（台）
              <input name="capacity_kg" type="number" min={1} max={20} />
            </label>
            <fieldset className={styles.compatList}>
              <legend>適用分類</legend>
              {workspace.categories.map((category) => (
                <label className={styles.checkboxLabel} key={`create-${category.code}`}>
                  <input type="checkbox" name="category_codes" value={category.code} />
                  {category.name}
                </label>
              ))}
            </fieldset>
            <fieldset className={styles.compatList}>
              <legend>相容程序</legend>
              {workspace.procedures.map((procedure) => (
                <label className={styles.checkboxLabel} key={`create-${procedure.id}`}>
                  <input type="checkbox" name="procedure_template_ids" value={procedure.id} />
                  {procedureLabel(procedure)}
                </label>
              ))}
            </fieldset>
            <label>
              登錄理由
              <input name="change_reason" maxLength={500} required />
            </label>
            <button type="submit">登錄設備</button>
          </form>
        </section>

        <section className={styles.managementSection} aria-labelledby="edit-equipment-title">
          <div className={styles.sectionHeading}>
            <h2 id="edit-equipment-title">修改設備資料</h2>
            <p>可改名稱、可容納洗衣車數、狀態與適用分類。設備類型與據點不可改。</p>
          </div>
          <form action={saveLaundryEquipment} className={styles.accessForm} aria-label="修改設備資料">
            <EquipmentEditForm
              equipment={workspace.equipment.map((item) => ({
                id: item.id,
                name: item.name,
                capacity_kg: item.capacity_kg,
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
                    <th>狀態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.equipment.map((equipment) => (
                    <tr key={equipment.id}>
                      <td>{equipment.name}</td>
                      <td>{typeLabels[equipment.equipment_type]}</td>
                      <td>
                        {equipment.operating_sites.code} · {equipment.operating_sites.name}
                      </td>
                      <td>{equipment.capacity_kg == null ? "—" : `${equipment.capacity_kg} 台`}</td>
                      <td>{equipment.occupied ? "使用中" : statusLabels[equipment.status]}</td>
                      <td>
                        <a href={`/app/admin/laundry-equipment/${equipment.id}/qr`}>
                          查看 {equipment.name} 固定 QR
                        </a>
                      </td>
                    </tr>
                  ))}
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
