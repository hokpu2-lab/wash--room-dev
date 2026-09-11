import { randomUUID } from "node:crypto";

import {
  getProcedureWorkspace,
  type ProcedureStage,
  type ProcedureVersion,
} from "@/lib/procedure/template";

import { ModuleTabs } from "../../module-tabs";
import styles from "../../workspace.module.css";
import {
  publishProcedureDraft,
  saveLaundryCategory,
  saveProcedureDraft,
  toggleProcedureTemplate,
} from "./actions";
import { CategoryEditForm } from "./category-edit-form";
import {
  defaultProcedureStage,
  type ProcedureStageDraft,
} from "./procedure-stage-draft";
import { ProcedureStagesField } from "./procedure-stages-field";

type ProceduresPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function stageDrafts(stages: ProcedureStage[]): ProcedureStageDraft[] {
  if (stages.length === 0) return [defaultProcedureStage()];
  return stages.map((stage) => {
    const codes = stage.compatibility_conditions.category_codes;
    return {
      name: stage.name,
      standard_minutes: stage.standard_minutes,
      equipment_type: stage.equipment_type,
      transition_mode: stage.transition_mode,
      requires_operator_confirmation: stage.requires_operator_confirmation,
      category_codes: Array.isArray(codes)
        ? codes.filter((code): code is string => typeof code === "string")
        : [],
    };
  });
}

function versionLabel(version: ProcedureVersion) {
  return `v${version.version_no} · ${version.status === "draft" ? "草稿" : version.status === "published" ? "已發布" : "已封存"}`;
}

export default async function ProceduresPage({ searchParams }: ProceduresPageProps) {
  const workspace = await getProcedureWorkspace();
  const query = await searchParams;
  const result = typeof query.procedure === "string" ? query.procedure : "";
  const activeCategories = workspace.categories.filter((category) => category.active);

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="workspace-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>CATEGORIES & PROCEDURE VERSIONS</p>
            <h1 id="workspace-title">洗滌分類與程序範本</h1>
            <p className={styles.lede}>分類停用後仍保留歷史；已發布程序版本不可修改，變更請建立下一個版本。</p>
          </div>
        </header>

        {result === "applied" ? (
          <p className={styles.successNotice} role="status">
            已儲存程序設定。
          </p>
        ) : result === "invalid" ? (
          <p className={styles.errorNotice} role="alert">
            程序或分類資料無效，沒有套用變更。
          </p>
        ) : result === "failed" ? (
          <p className={styles.errorNotice} role="alert">
            程序設定未套用，請確認據點權限、分類狀態與版本狀態。
          </p>
        ) : null}

        <ModuleTabs
          ariaLabel="分類與程序管理功能"
          storageKey="procedures"
          tabs={[
            { id: "categories", label: "洗滌分類", description: "新增、排序、改名與停用", count: workspace.categories.length },
            { id: "templates", label: "程序範本", description: "階段、時間、發布與版本", count: workspace.templates.length },
          ]}
        >
        <section className={styles.managementSection} aria-labelledby="category-title">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>LAUNDRY CATEGORIES</p>
            <h2 id="category-title">洗滌分類</h2>
            <p>分類代碼建立後固定；停用只影響新收單，不會移除歷史資料。</p>
          </div>
          <div className={styles.formGrid}>
            <form action={saveLaundryCategory} className={styles.accessForm}>
              <h3>新增分類</h3>
              <input name="change_request_id" type="hidden" value={randomUUID()} />
              <input name="category_active" type="hidden" value="true" />
              <label>
                分類代碼
                <input name="category_code" maxLength={40} placeholder="例如 SPECIAL" required />
              </label>
              <label>
                分類名稱
                <input name="category_name" maxLength={80} required />
              </label>
              <label>
                排序
                <input name="sort_order" type="number" min={0} defaultValue={60} required />
              </label>
              <label>
                新增理由
                <input name="change_reason" maxLength={500} required />
              </label>
              <button type="submit">新增分類</button>
            </form>

            <div className={styles.accessForm}>
              <h3>目前分類</h3>
              <div className={styles.tableScroller}>
                <table>
                  <thead>
                    <tr>
                      <th>代碼</th>
                      <th>名稱</th>
                      <th>排序</th>
                      <th>狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.categories.map((category) => (
                      <tr key={category.id}>
                        <td>{category.code}</td>
                        <td>{category.name}</td>
                        <td>{category.sort_order}</td>
                        <td>{category.active ? "啟用" : "停用"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <form action={saveLaundryCategory} className={styles.accessForm} aria-label="修改分類">
            <h3>修改分類</h3>
            <CategoryEditForm categories={workspace.categories} requestId={randomUUID()} />
            <button type="submit">儲存分類</button>
          </form>
        </section>

        <section className={styles.managementSection} aria-labelledby="procedure-title">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>PROCEDURE TEMPLATES</p>
            <h2 id="procedure-title">程序範本與版本</h2>
            <p>
              每個據點與分類各有一組程序範本。階段用下拉與勾選設定名稱、時間、設備與相容分類，不得填入住民或病患資料。
            </p>
          </div>

          <div className={styles.formGrid}>
            <form action={saveProcedureDraft} className={styles.accessForm}>
              <h3>建立程序草稿</h3>
              <input name="change_request_id" type="hidden" value={randomUUID()} />
              <input name="template_id" type="hidden" value="" />
              <label>
                作業據點
                <select name="site_code" required>
                  {workspace.sites.map((site) => (
                    <option key={site.membership_id} value={site.scope_code}>
                      {site.scope_code} · {site.scope_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                使用分類
                <select name="category_code" required>
                  {activeCategories.map((category) => (
                    <option key={category.id} value={category.code}>
                      {category.code} · {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                程序名稱
                <input name="template_name" maxLength={120} required />
              </label>
              <ProcedureStagesField
                initialStages={[defaultProcedureStage()]}
                categories={activeCategories}
              />
              <label>
                草稿理由
                <input name="change_reason" maxLength={500} required />
              </label>
              <button type="submit">建立程序草稿</button>
            </form>
          </div>

          {workspace.templates.length === 0 ? (
            <p className={styles.warningNotice} role="note">
              目前尚未建立程序範本。
            </p>
          ) : (
            <div className={styles.formGrid}>
              {workspace.templates.map((template) => {
                const draft = template.versions.find((version) => version.status === "draft");
                const latest = template.versions.at(-1);
                const source = draft ?? latest;
                return (
                  <article className={styles.accessForm} key={template.id}>
                    <h3>
                      {template.categoryCode} · {template.categoryName}
                    </h3>
                    <p>
                      {template.siteCode} · {template.siteName} · {template.active ? "範本啟用" : "範本停用"}
                    </p>
                    <div className={styles.tableScroller}>
                      <table>
                        <thead>
                          <tr>
                            <th>版本</th>
                            <th>名稱</th>
                            <th>階段</th>
                          </tr>
                        </thead>
                        <tbody>
                          {template.versions.map((version) => (
                            <tr key={version.id}>
                              <td>{versionLabel(version)}</td>
                              <td>{version.template_name}</td>
                              <td>{version.stages.length}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {source ? (
                      <form action={saveProcedureDraft} className={styles.accessForm}>
                        <h4>{draft ? "編輯目前草稿" : "建立下一版本"}</h4>
                        <input name="change_request_id" type="hidden" value={randomUUID()} />
                        <input name="template_id" type="hidden" value={draft ? "" : template.id} />
                        <input name="version_id" type="hidden" value={draft?.id ?? ""} />
                        <input name="site_code" type="hidden" value="" />
                        <input name="category_code" type="hidden" value="" />
                        <label>
                          程序名稱
                          <input name="template_name" defaultValue={source.template_name} maxLength={120} required />
                        </label>
                        <ProcedureStagesField
                          initialStages={stageDrafts(source.stages)}
                          categories={workspace.categories}
                        />
                        <label>
                          版本理由
                          <input name="change_reason" maxLength={500} required />
                        </label>
                        <button type="submit">{draft ? "儲存草稿" : "建立下一版本草稿"}</button>
                      </form>
                    ) : null}

                    {draft ? (
                      <form action={publishProcedureDraft} className={styles.accessForm}>
                        <input name="change_request_id" type="hidden" value={randomUUID()} />
                        <input name="version_id" type="hidden" value={draft.id} />
                        <label>
                          發布理由
                          <input name="change_reason" maxLength={500} required />
                        </label>
                        <button type="submit">發布 v{draft.version_no}</button>
                      </form>
                    ) : null}

                    <form action={toggleProcedureTemplate} className={styles.compactForm}>
                      <input name="change_request_id" type="hidden" value={randomUUID()} />
                      <input name="template_id" type="hidden" value={template.id} />
                      <input name="target_active" type="hidden" value={template.active ? "false" : "true"} />
                      <input name="change_reason" placeholder="啟停理由" required />
                      <button type="submit">{template.active ? "停用範本" : "啟用範本"}</button>
                    </form>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        </ModuleTabs>
      </section>
    </main>
  );
}
