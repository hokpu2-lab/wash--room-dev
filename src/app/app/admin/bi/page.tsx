import { Suspense } from "react";

import {
  biDimensionLabels,
  biLayoutExamples,
  biMetricLabels,
  biSampleModels,
  parseBiRunResult,
  type BiLayoutPreview,
} from "@/lib/analytics/bi-models";
import { listSavedBiViews, runSavedBiView, summarizeDashboard } from "@/lib/analytics/workspace";
import { getOrganizationWorkspace } from "@/lib/organization/master-data";

import { AppLink } from "../../app-link";
import { ModuleTabs } from "../../module-tabs";
import styles from "../../workspace.module.css";
import { commitImportAction, previewImport } from "../imports/actions";
import { saveBiView } from "./actions";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BiPage({ searchParams }: Props) {
  const views = await listSavedBiViews();
  const workspace = await getOrganizationWorkspace();
  const query = await searchParams;
  const status = typeof query.status === "string" ? query.status : "";
  const runId = typeof query.run === "string" ? query.run : "";
  const importId = typeof query.id === "string" ? query.id : "";
  const runResult = runId ? parseBiRunResult(await runSavedBiView(runId)) : null;
  const importDefault = status === "previewed" || status === "committed" || status === "invalid" || Boolean(importId);
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="bi-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>DECISION INTELLIGENCE</p>
            <h1 id="bi-title">分析與 BI</h1>
            <p className={styles.lede}>用可重複的分析模型回答現場問題；舊單匯入也放在同一模組最右側。維度、指標與資料範圍都由系統白名單保護。</p>
          </div>
        </header>
        {status === "saved" ? <p className={styles.successNotice} role="status">分析版型已保存。</p> : null}
        {status === "failed" ? <p className={styles.errorNotice} role="alert">分析版型保存失敗，沒有套用任何資料。</p> : null}
        {status === "previewed" ? <p className={styles.successNotice} role="status">預覽完成：有效 {query.valid ?? 0} 列，無效 {query.invalid ?? 0} 列。</p> : null}
        {status === "invalid" ? <p className={styles.errorNotice} role="alert">匯入檔案或欄位驗證失敗，沒有直接寫入營運資料。</p> : null}
        {status === "committed" ? <p className={styles.successNotice} role="status">匯入批次已完成並保留重複資料報告。</p> : null}
        <ModuleTabs
          ariaLabel="分析與 BI 功能"
          storageKey="bi-views"
          defaultTab={importDefault ? "imports" : "create"}
          tabs={[
            { id: "create", label: "模型庫", description: "選擇可直接套用的分析問題" },
            { id: "saved", label: "我的分析", description: "執行私人與同據點版型", count: views.length },
            { id: "exports", label: "報表與匯出", description: "下載授權範圍的作業報表" },
            { id: "insights", label: "摘要與建議", description: "規則式 KPI 摘要與可選 AI" },
            { id: "imports", label: "舊單匯入", description: "CSV／XLSX 預覽、驗證與提交" },
          ]}
        >
          <div className={styles.biStudio}>
            <section className={styles.biIntroBand} aria-labelledby="bi-model-library-title">
              <div>
                <p className={styles.eyebrow}>MODEL LIBRARY</p>
                <h2 id="bi-model-library-title">先選一個現場問題</h2>
                <p>樣本模型已經配好維度與 KPI，套用後可在「我的分析」執行並查看授權範圍內的分組結果。</p>
              </div>
              <span className={styles.biSafeBadge}>RLS SCOPED</span>
            </section>

            <section className={styles.biLayoutSection} aria-labelledby="bi-layout-examples-title">
              <div className={styles.biLayoutHeader}>
                <div>
                  <p className={styles.eyebrow}>LAYOUT EXAMPLES</p>
                  <h2 id="bi-layout-examples-title">報表版面範例</h2>
                  <p>先選擇閱讀方式，再套用下方模型；這些是版面示意，不會讀取額外資料或改變 BI 白名單。</p>
                </div>
                <span className={styles.biLayoutNote}>STATIC WIREFRAMES</span>
              </div>
              <div className={styles.biLayoutGrid}>
                {biLayoutExamples.map((example) => (
                  <article key={example.id} className={styles.biLayoutCard}>
                    <div className={styles.biLayoutCardMeta}><span>{example.kicker}</span><span>範例版面</span></div>
                    <h3>{example.name}</h3>
                    <p>{example.description}</p>
                    <LayoutPreview preview={example.preview} />
                    <div className={styles.biLayoutDecision}><span>適合回答</span><strong>{example.decision}</strong></div>
                    <div className={styles.biLayoutBlocks} aria-label={`${example.name} 的版面區塊`}>
                      {example.blocks.map((block) => <span key={block}>{block}</span>)}
                    </div>
                    <span className={styles.biLayoutModel}>對應模型：{biSampleModels.find((model) => model.id === example.modelId)?.name ?? example.modelId}</span>
                  </article>
                ))}
              </div>
            </section>

            <div className={styles.biSampleGrid}>
              {biSampleModels.map((model) => (
                <article key={model.id} className={styles.biSampleCard}>
                  <div className={styles.biCardTopline}>
                    <span>{model.kicker}</span>
                    <span>{model.dimensions.map((dimension) => biDimensionLabels[dimension]).join(" × ")}</span>
                  </div>
                  <h3>{model.name}</h3>
                  <p>{model.description}</p>
                  <div className={styles.biDecision}><span>要回答</span><strong>{model.decision}</strong></div>
                  <div className={styles.biTagList} aria-label={`${model.name} 使用的指標`}>
                    {model.metrics.map((metric) => <span key={metric}>{biMetricLabels[metric]}</span>)}
                  </div>
                  <form action={saveBiView} className={styles.biSampleAction}>
                    <input type="hidden" name="sample_id" value={model.id} />
                    <label className={styles.checkboxLabel}><input name="shared" type="checkbox" />與同據點主管分享</label>
                    <button type="submit">套用這個模型</button>
                  </form>
                </article>
              ))}
            </div>

            <form action={saveBiView} className={styles.biCustomForm}>
              <div>
                <p className={styles.eyebrow}>CUSTOM NAMING</p>
                <h2>保存自訂名稱</h2>
                <p>仍可用目前的安全預設 KPI 組合建立自己的版型名稱。</p>
              </div>
              <label>版型名稱<input name="name" maxLength={100} required /></label>
              <label className={styles.checkboxLabel}><input name="shared" type="checkbox" />與同據點主管分享</label>
              <button type="submit">保存自訂版型</button>
            </form>
          </div>

          <section className={styles.biSavedPanel} aria-labelledby="saved-views-title">
            <div className={styles.sectionHeadingRow}>
              <div><p className={styles.eyebrow}>SAVED ANALYSES</p><h2 id="saved-views-title">我的分析版型</h2></div>
              <p>執行結果只使用目前授權的作業據點資料。</p>
            </div>
            {runId && !runResult ? <p className={styles.errorNotice} role="alert">無法執行這個分析版型，可能已被撤銷或不在你的授權範圍。</p> : null}
            {runResult ? <BiResultTable result={runResult} /> : null}
            {views.length === 0 ? (
              <p>尚無保存版型，先到「模型庫」套用一個樣本。</p>
            ) : (
              <ul className={styles.biSavedList}>
                {views.map((view) => {
                  const dimensions = Array.isArray(view.dimensions) ? view.dimensions.map((item: string) => biDimensionLabels[item as keyof typeof biDimensionLabels] ?? item) : [];
                  const metrics = Array.isArray(view.metrics) ? view.metrics.map((item: string) => biMetricLabels[item as keyof typeof biMetricLabels] ?? item) : [];
                  return (
                    <li key={String(view.id)}>
                      <div><strong>{String(view.name)}</strong><small>{view.shared ? "已分享" : "私人"} · {dimensions.join("、") || "總計"}</small></div>
                      <span>{metrics.join(" · ")}</span>
                      <AppLink href={`/app/admin/bi?run=${encodeURIComponent(String(view.id))}#tab=saved`}>執行分析</AppLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className={styles.biSavedPanel} aria-labelledby="bi-exports-title">
            <div className={styles.sectionHeadingRow}>
              <div><p className={styles.eyebrow}>REPORTS & EXPORTS</p><h2 id="bi-exports-title">報表與匯出</h2></div>
              <p>所有檔案只取回目前授權作業據點，回應 private/no-store。</p>
            </div>
            <div className={styles.quickGrid}>
              <a href="/api/admin/exports?format=csv"><span>01</span><strong>下載 CSV<small>目前授權範圍的作業資料</small></strong></a>
              <a href="/api/admin/exports?format=xlsx"><span>02</span><strong>下載 XLSX<small>試算表格式，便於對帳</small></strong></a>
              <a href="/api/admin/exports?format=pdf"><span>03</span><strong>下載 PDF<small>只讀報表，禁止快取</small></strong></a>
            </div>
          </section>
          <Suspense fallback={<section className={styles.biSavedPanel} aria-label="分析摘要載入中"><p>正在產生摘要與建議…</p></section>}>
            <BiInsightsPanel />
          </Suspense>
          <section className={styles.biSavedPanel} aria-labelledby="bi-imports-title">
            <div className={styles.sectionHeadingRow}>
              <div><p className={styles.eyebrow}>LEGACY IMPORT</p><h2 id="bi-imports-title">舊單匯入</h2></div>
              <p>先預覽驗證，再提交有效列；無效列只留報告。</p>
            </div>
            <form action={previewImport} className={styles.accessForm} encType="multipart/form-data">
              <h3>預覽與驗證</h3>
              <label>CSV／XLSX 檔案<input name="file" type="file" accept=".csv,.xlsx" required /></label>
              <label>工作表名稱（XLSX 可留白）<input name="sheet" maxLength={80} /></label>
              <button type="submit">預覽與驗證</button>
            </form>
            {importId ? (
              <form action={commitImportAction} className={styles.accessForm}>
                <h3>提交有效列</h3>
                <input type="hidden" name="import_batch_id" value={importId} />
                <p>預覽批次：<code>{importId}</code></p>
                <button type="submit">提交有效列（保留無效報告）</button>
              </form>
            ) : null}
            <p className={styles.muted}>可管理據點：{workspace.sites.map((site) => site.code).join("、")}</p>
          </section>
        </ModuleTabs>
      </section>
    </main>
  );
}

async function BiInsightsPanel() {
  const summary = await summarizeDashboard();
  return (
    <section className={styles.biSavedPanel} aria-labelledby="bi-insights-title">
      <div className={styles.sectionHeadingRow}>
        <div><p className={styles.eyebrow}>OPTIONAL AI INSIGHTS</p><h2 id="bi-insights-title">分析摘要與建議</h2></div>
        <p>摘要使用白名單 KPI；未設定 AI 金鑰時使用規則式建議。</p>
      </div>
      {!summary ? (
        <p className={styles.errorNotice} role="alert">目前無法產生摘要。</p>
      ) : (
        <section className={styles.managementSection}>
          <p className={styles.successNotice} role="status">{summary.headline}</p>
          <ul className={styles.scopeList}>
            {summary.recommendations.map((recommendation) => (
              <li key={recommendation}><span>{recommendation}</span></li>
            ))}
          </ul>
          <p className={styles.muted}>{summary.aiEnabled ? "已偵測到可選 AI 設定。" : "目前未啟用外部 AI。"}</p>
        </section>
      )}
    </section>
  );
}

function LayoutPreview({ preview }: { preview: BiLayoutPreview }) {
  if (preview === "command") {
    return (
      <div className={styles.biMiniPreview} data-preview={preview} aria-label="KPI、流程分佈與優先佇列版面示意">
        <div className={styles.biPreviewKpis}><span><b>128</b><small>洗衣單</small></span><span><b>42</b><small>處理中</small></span><span><b>18</b><small>待介入</small></span></div>
        <div className={styles.biPreviewBody}><div className={styles.biPreviewBars}><span><i style={{ width: "82%" }} />待收件</span><span><i style={{ width: "58%" }} />處理中</span><span><i style={{ width: "36%" }} />待取件</span></div><ul className={styles.biPreviewList}><li><b>01</b>異常佇列</li><li><b>02</b>待收件</li><li><b>03</b>待取件</li></ul></div>
      </div>
    );
  }

  if (preview === "workload") {
    return (
      <div className={styles.biMiniPreview} data-preview={preview} aria-label="分類比較、完成批次與明細表版面示意">
        <div className={styles.biPreviewBody}><div className={styles.biPreviewColumns}><i style={{ height: "46%" }} /><i style={{ height: "78%" }} /><i style={{ height: "60%" }} /><i style={{ height: "92%" }} /><i style={{ height: "34%" }} /></div><ul className={styles.biPreviewList}><li><b>SOILED</b> 42 批</li><li><b>BIB</b> 28 批</li><li><b>OTHER</b> 16 批</li></ul></div>
        <div className={styles.biPreviewTable}><span>分類</span><span>洗衣單</span><span>完成率</span></div>
      </div>
    );
  }

  if (preview === "comparison") {
    return (
      <div className={styles.biMiniPreview} data-preview={preview} aria-label="據點 KPI、差異排行與範圍說明版面示意">
        <div className={styles.biPreviewKpis}><span><b>MAIN</b><small>82% 完成</small></span><span><b>CORP</b><small>64% 完成</small></span></div>
        <div className={styles.biPreviewCompare}><span><b>MAIN</b><i style={{ width: "82%" }} /></span><span><b>CORP</b><i style={{ width: "64%" }} /></span><span><b>差距</b><i style={{ width: "42%" }} /></span></div>
        <small className={styles.biPreviewCaption}>目前授權作業據點範圍</small>
      </div>
    );
  }

  return (
    <div className={styles.biMiniPreview} data-preview={preview} aria-label="交付摘要、準備度與例外提醒版面示意">
      <div className={styles.biPreviewFlow}><span><i>完成</i><b>64</b></span><em>→</em><span><i>待取件</i><b>18</b></span><em>→</em><span><i>已取件</i><b>46</b></span></div>
      <div className={styles.biPreviewReadiness}><i style={{ width: "72%" }} /><span>準備度 72%</span></div>
      <ul className={styles.biPreviewList}><li><b>3</b> 高優先待處理</li><li><b>5</b> 逾時風險</li></ul>
    </div>
  );
}

function BiResultTable({ result }: { result: ReturnType<typeof parseBiRunResult> extends infer T ? Exclude<T, null> : never }) {
  return (
    <section className={styles.biResultPanel} aria-labelledby="bi-result-title">
      <div className={styles.sectionHeadingRow}>
        <div><p className={styles.eyebrow}>LIVE RESULT</p><h3 id="bi-result-title">分組結果</h3></div>
        <span>{result.rows.length} 個分組</span>
      </div>
      <div className={styles.tableScroller}>
        <table>
          <thead><tr><th>分組</th><th>洗衣單數</th><th>批次數</th><th>完成批次</th></tr></thead>
          <tbody>{result.rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.order_count ?? "—"}</td><td>{row.batch_count ?? "—"}</td><td>{row.completed_count ?? "—"}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
