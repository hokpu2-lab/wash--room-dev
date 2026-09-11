import { randomUUID } from "node:crypto";

import { getOrganizationWorkspace } from "@/lib/organization/master-data";

import { ModuleTabs } from "../../module-tabs";
import styles from "../../workspace.module.css";
import { saveInstitution } from "./actions";

type OrganizationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OrganizationsPage({
  searchParams,
}: OrganizationsPageProps) {
  const workspace = await getOrganizationWorkspace();
  const query = await searchParams;
  const organizationResult =
    typeof query.organization === "string" ? query.organization : "";
  const savedCode = typeof query.code === "string" ? query.code : "";

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="workspace-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>ORGANIZATION MASTER DATA</p>
            <h1 id="workspace-title">作業據點與送洗機構</h1>
            <p className={styles.lede}>管理授權作業據點與送洗機構的固定配對。</p>
          </div>
        </header>

        <section aria-labelledby="site-title">
          <h2 id="site-title">可管理作業據點</h2>
          <ul className={styles.scopeList}>
            {workspace.sites.map((site) => (
              <li key={site.id}>
                <strong>{site.code}</strong>
                <span>{site.name}</span>
              </li>
            ))}
          </ul>
        </section>

        <p className={styles.warningNotice} role="note">
          配對變更只影響之後建立的洗衣單，不會回寫既有單據。
        </p>

        {organizationResult === "applied" ? (
          <p className={styles.successNotice} role="status">
            已儲存送洗機構 {savedCode}。
          </p>
        ) : organizationResult === "invalid" ? (
          <p className={styles.errorNotice} role="alert">
            送洗機構資料無效，沒有套用任何變更。
          </p>
        ) : organizationResult === "failed" ? (
          <p className={styles.errorNotice} role="alert">
            送洗機構異動失敗，請確認作業據點權限後再試一次。
          </p>
        ) : null}

        <ModuleTabs
          ariaLabel="送洗機構管理功能"
          storageKey="organizations"
          defaultTab="list"
          tabs={[
            { id: "create", label: "新增機構", description: "建立代碼與固定配對" },
            { id: "list", label: "機構清單", description: "檢視配對與啟停狀態", count: workspace.institutions.length },
            ...(workspace.institutions.length > 0
              ? [{ id: "edit", label: "修改機構", description: "調整名稱、配對與狀態" }]
              : []),
          ]}
        >
        <section className={styles.managementSection} aria-labelledby="create-title">
          <div className={styles.sectionHeading}>
            <h2 id="create-title">新增送洗機構</h2>
            <p>機構代碼建立後固定；後續修改以相同代碼識別原主檔。</p>
          </div>
          <form action={saveInstitution} className={styles.accessForm}>
            <input name="change_request_id" type="hidden" value={randomUUID()} />
            <label>
              新機構代碼
              <input name="institution_code" maxLength={40} required />
            </label>
            <label>
              新機構名稱
              <input name="institution_name" maxLength={120} required />
            </label>
            <label>
              新機構固定配對
              <select name="target_site_code" required>
                {workspace.sites.map((site) => (
                  <option key={site.id} value={site.code}>
                    {site.code} · {site.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              新機構異動理由
              <input name="change_reason" maxLength={500} required />
            </label>
            <label className={styles.checkboxLabel}>
              <input name="institution_active" type="checkbox" defaultChecked />
              新機構啟用
            </label>
            <button type="submit">新增送洗機構</button>
          </form>
        </section>

        <section aria-labelledby="institution-title">
          <h2 id="institution-title">目前送洗機構</h2>
          {workspace.institutions.length === 0 ? (
            <p>目前管理範圍內尚無送洗機構。</p>
          ) : (
            <div className={styles.tableScroller}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">機構代碼</th>
                    <th scope="col">機構名稱</th>
                    <th scope="col">固定配對</th>
                    <th scope="col">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.institutions.map((institution) => (
                    <tr key={institution.id}>
                      <td>{institution.code}</td>
                      <td>{institution.name}</td>
                      <td>
                        {institution.operating_sites.code} · {institution.operating_sites.name}
                      </td>
                      <td>{institution.active ? "啟用" : "停用"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {workspace.institutions.length > 0 ? (
          <section
            className={styles.managementSection}
            aria-labelledby="edit-title"
          >
            <div className={styles.sectionHeading}>
              <h2 id="edit-title">修改送洗機構</h2>
            </div>
            <div className={styles.formGrid}>
              {workspace.institutions.map((institution) => (
                <form
                  key={institution.id}
                  action={saveInstitution}
                  aria-label={`修改 ${institution.code}`}
                  className={styles.accessForm}
                >
                  <input
                    name="change_request_id"
                    type="hidden"
                    value={randomUUID()}
                  />
                  <label>
                    機構代碼
                    <input
                      name="institution_code"
                      value={institution.code}
                      readOnly
                    />
                  </label>
                  <label>
                    機構名稱
                    <input
                      name="institution_name"
                      defaultValue={institution.name}
                      maxLength={120}
                      required
                    />
                  </label>
                  <label>
                    固定配對
                    <select
                      name="target_site_code"
                      defaultValue={institution.operating_sites.code}
                      required
                    >
                      {workspace.sites.map((site) => (
                        <option key={site.id} value={site.code}>
                          {site.code} · {site.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    異動理由
                    <input name="change_reason" maxLength={500} required />
                  </label>
                  <label className={styles.checkboxLabel}>
                    <input
                      name="institution_active"
                      type="checkbox"
                      defaultChecked={institution.active}
                    />
                    啟用
                  </label>
                  <button type="submit">儲存 {institution.code}</button>
                </form>
              ))}
            </div>
          </section>
        ) : null}
        </ModuleTabs>
      </section>
    </main>
  );
}
