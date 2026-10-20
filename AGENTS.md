## 洗衣管理系統接手流程

1. 先執行 `git status --short`，辨識並保留既有變更。接著閱讀 `CONTEXT.md`、
   `docs/requirements.md` 與本次修改相關的 `docs/adr/`；領域用語與需求衝突時，先更新或釐清
   authoritative 文件再寫程式。
2. 從 GitHub Issue 的驗收條件界定範圍。建立或更新 Issue 前讀取
   `docs/agents/issue-tracker.md` 與 `docs/agents/triage-labels.md`。
3. 修改 Next.js 前讀取 `node_modules/next/dist/docs/` 內對應版本文件；修改資料庫前先讀取
   相關 migration 與 `tests/database/` 的既有合約測試。
4. 先以最小相關測試驗證變更，再執行下方完成檢查。完成代表程式、migration、測試、文件與
   原型中所有受影響的表達已一致，而不只是頁面可以開啟。

## 目前交付基線

- 接手前先讀 `README.md` 的「2026-10-06 最新接手快照」、「2026-10-02 選取洗衣單欄位與設備使用狀況切片（歷史）」、「2026-09-12 操作控制台設備據點解析與快取清除切片（歷史）」、「2026-08-31 系統管理員與 System Guide 切片（歷史）」、「2026-08-28 沉浸式洗衣流程與已取件詳情切片（歷史）」、「2026-08-22 戰情室、BI 與交付快照（歷史）」、「2026-08-18 正式環境與接手快照」及「效能與操作體驗診斷」。
  最新 commit、部署、測試數量、region 與量測值只記在 README 的日期化快照；仍須以實際 `HEAD`、
  工作樹、GitHub Actions、Vercel、Supabase migration 與本次測試輸出覆核，不能沿用舊數字。
- 正式登入後介面使用 `src/app/app/layout.tsx`、`workspace-shell.tsx`、
  `workspace-navigation.tsx`、`style-switcher.tsx` 與 `workspace-shell.module.css`。角色首頁與儀表板是同步殼層，
  KPI／佇列／授權表放在 `Suspense` 子元件。延伸版面時共用這個殼層，頁面本身仍從
  server-only DAL 取得 DTO 並重新授權。左側導覽列底部的「目前角色」卡片區塊已精簡移除。
- 前台系統說明（System Guide）：`/app/admin/system-guide`、`system-guide-viewer.tsx`、`system-guide-data.ts` 與 `docs/system-guide/`；
  提供使用者、管理者與 Agent 三份手冊秒開瀏覽、目錄錨點滾動與全文搜尋。
- 頂級角色與權限防護：`system_administrator`（系統管理員）具備最高優先權，預設導向 `/app/admin`；`src/lib/auth/principal.ts` 之
  `principalSatisfiesRole` 確保系統管理員完全滿足 `laundry_supervisor` 之檢查，徹底杜絕無窮重定向死循環。

## 2026-10-20 最新接手快照

- **自訂純烘乾分類（如「快烘」）流程與狀態精準對齊純烘乾（order-pipeline.ts, quick-live-view.tsx, laundry-order-flow-3d.tsx, order-pipeline.spec.ts, quick-live-view.spec.ts）**：
  - **根本原因排查**：
    1. 在 order-pipeline.ts 的 resolveOrderCategory 中，先前硬編碼僅辨識 4 個預設分類（消毒、圍兜、床簾、汙衣），未納入使用者於程序範本中新增的純烘乾分類（如「快烘」）。
    2. 這導致「快烘」單據（如車號 2C-2）被錯誤歸入 GENERAL，分類名稱被覆寫為「一般」，且被套用預設的「洗衣機 60m ➔ 2 烘衣機 60m」流程，首階段錯誤出現「洗衣機」與「待清洗」。
    3. 在 quick-live-view.tsx 的 derivePendingCarts 中，純烘乾判定僅判斷了 isBib（圍兜），導致「快烘」單據在「即時洗衣車與設備流轉動態」中下一階段錯誤標示為藍色的「待清洗」。
  - **修復與相容架構**：
    1. **保留真實分類名稱並識別純烘乾類（order-pipeline.ts）**：
       - resolveOrderCategory 擴充支援純烘乾品項判定（包含「快烘」、「烘」、「DRY」，或批次階段僅包含烘衣機之程序），分類名稱完整保留真實名稱（「快烘」），不再被改寫為「一般」。
       - 流程步驟精準對齊純烘乾標準（烘衣機 ➔ 待取件），絕無「洗衣機」！
       - 單據處於待處理或初收單狀態時，當前階段與狀態膠囊精準呈現為橙色的「待烘乾」。
    2. **即時流轉動態下一階段對齊「待烘乾」（quick-live-view.tsx）**：
       - derivePendingCarts 的免洗純烘判定擴充支援「快烘」與純烘乾批次，待處理洗衣車（如 2C-2）下一階段精準標示為「待烘乾」（橙色徽章 nextStageDry）。
       - getCartCategoryBadgeClass 同步支援「快烘」套用質感藍紫色徽章。
    3. **3D 洗衣單流程同步支援純烘乾範本（laundry-order-flow-3d.tsx）**：
       - 階段解析優先以資料庫批次實際階段為準，fallback 階段亦同步納入純烘乾判定，確保流程節點只有烘衣階段。
  - **測試與建置覆核**：
    - 單元測試 order-pipeline.spec.ts 與 quick-live-view.spec.ts 新增測試驗證「快烘」保留真實名稱、流程僅有烘衣機、狀態與下一階段標籤皆為「待烘乾」。
    - 全專案 20 個單元測試檔案、129 個 tests 全數通過；npm run typecheck 0 錯誤；npm run build 正式生產建置成功。

- **營運戰情室解除「當日送件」0800-1700 時間區間限制，改為當日全天（workspace-live.tsx, workspace-snapshot.ts, workspace-snapshot.spec.ts）**：
  - **根本原因排查**：
    1. 在 src/lib/analytics/workspace-snapshot.ts 的 calculateTodayShiftOrdersCount 中，原先硬編碼限制了 shiftStart = 08:00 至 shiftEnd = 17:00，導致清晨、夜間或非 08:00-17:00 時段送件的洗衣單被排除，戰情室在非上班時間顯示為 0。
    2. workspace-live.tsx 戰情室第一張 KPI 卡片標籤寫死為「當日送件 (0800-1700截止)」，說明文字為「今日 08:00–17:00 已送件之洗衣單」。
  - **修復架構**：
    1. **解除時間區間限制，改為當日全天（workspace-snapshot.ts）**：
       - calculateTodayShiftOrdersCount 計算區間改為當日整天：dayStart = 00:00:00.000 至 dayEnd = 23:59:59.999，全天 24 小時內送件之洗衣單皆完整納入計算。
    2. **戰情室卡片文字同步更新（workspace-live.tsx）**：
       - KPI 標籤由「當日送件 (0800-1700截止)」更新為「當日送件 (全日)」；說明小字更新為「今日全日已送件之洗衣單」。
  - **測試與建置覆核**：
    - tests/unit/workspace-snapshot.spec.ts 更新單元測試，驗證當日白天、清晨 (03:28) 與深夜 (23:15) 皆正確納入，跨日單據精準排除。
    - 全專案單元測試 20 個檔案、127 個 tests 全數通過；npm run typecheck 0 錯誤；npm run build 正式生產建置成功。

- **主工作區介面大小隨畫面比例自適應變更（workspace-shell.module.css, system-guide.module.css, workspace-responsive.spec.ts）**：
  - **根本原因排查**：
    1. 原先 workspace-shell.module.css 中的 .content > main 和 .ssoFlashNotice 硬編碼限制為 max-width: 1340px; margin: 0 auto;，導致寬螢幕、超寬螢幕或在不同畫面比例縮放時，主工作區被鎖死在 1340px，兩側出現大片固定留白，無法隨畫面比例自適應展開。
    2. system-guide.module.css 亦限制於固定寬度（1280px / 1180px），未能隨瀏覽器畫面比例流暢延展。
  - **修復與響應式流體架構**：
    1. **解開主工作區固定寬度束縛，全面支援 100% 畫面比例自適應**（workspace-shell.module.css）：
       - .content：設定 width: 100%，搭配流體邊距 padding: clamp(16px, 2.5vw, 40px)，在各種長寬比（16:9、16:10、21:9、4:3）與高解析度下平滑縮放。
       - .content > main：調整為 width: 100%; max-width: 100%; margin: 0 auto;，使所有子頁面（Dashboard、營運總覽、現場作業台、設備清單等）皆能隨著視窗畫面比例流動延展，大螢幕時排版大器，窄螢幕時自然縮放。
       - .ssoFlashNotice：同步更新為 width: 100%; max-width: 100%;。
    2. **系統指引同步支援滿版流體響應**：
       - admin/system-guide/system-guide.module.css 與 system-guide/system-guide.module.css 調整為 max-width: 100%，閱讀區與章節目錄隨畫面比例舒適展開。
  - **測試與建置覆核**：
    - 新增單元測試 tests/unit/workspace-responsive.spec.ts 驗證主工作區與系統說明無 1340px / 1280px 硬編碼限制且支援 100% 畫面比例自適應。
    - 全專案單元測試 20 個檔案、127 個 tests 全數通過；npm run typecheck 0 錯誤；npm run build 正式生產建置成功。

- **統一「即時洗衣車與設備流轉動態」和「洗衣排程」洗滌品項顏色（quick-live-view.module.css, quick-live-view.tsx, workspace.module.css, quick-live-view.spec.ts）**：
  - **根本原因排查**：
    1. 在「即時洗衣車與設備流轉動態」（quick-live-view.tsx）的待處理洗衣車與完成待取件中，原先推導品項樣式時僅有「消毒」與「汙/污」，缺少「圍兜」與「床簾」的分支判斷，導致「圍兜」與「床簾」全部被歸入 cartCategoryGeneral，在即時動態中被渲染成深玄黑藍色（#0f172a）。
    2. 而在下方「洗衣排程」（live-queue.tsx、workspace.module.css）第四欄「洗滌品項」中，「圍兜」套用了亮眼藍紫色（#4338ca、邊框 #818cf8、文字 #eef2ff），「床簾」套用了深墨綠色（#064e3b、邊框 #34d399、文字 #ecfdf5），使得同一畫面上相同品項的色彩完全脫節。
    3. quick-live-view.module.css 先前缺少 .cartCategoryBib 與 .cartCategoryCurtain 類別定義，且一般品背景顏色與邊框亦有些微落差。
  - **修復與統一架構**：
    1. **五大洗滌品項色彩體系 100% 精準對齊**（quick-live-view.module.css 與 workspace.module.css）：
       - **圍兜（BIB）**：高質感藍紫（背景 #4338ca、邊框 #818cf8、文字 #eef2ff、立體陰影 rgba(67, 56, 202, 0.35)）
       - **床簾（CURTAIN）**：翡翠深墨綠（背景 #064e3b、邊框 #34d399、文字 #ecfdf5、立體陰影 rgba(6, 78, 59, 0.35)）
       - **消毒品（DISINFECT）**：深洋紅紫（背景 #831843、邊框 #f472b6、文字 #fdf2f8、立體陰影 rgba(131, 24, 67, 0.35)）
       - **汙衣（SOILED）**：深琥珀棕褐（背景 #78350f、邊框 #fbbf24、文字 #fffbeb、立體陰影 rgba(120, 53, 15, 0.35)）
       - **一般被服 / 一般品（GENERAL）**：深玄灰藍（背景 #1e293b、邊框 #64748b、文字 #f8fafc、立體陰影 rgba(30, 41, 59, 0.35)）
    2. **即時洗衣車動態封裝統一推導邏輯（quick-live-view.tsx）**：
       - 匯出 getCartCategoryBadgeClass(categoryName, styles)，完整支援消毒品、圍兜、床簾、汙衣/污衣與一般品判定。
       - 待處理與待取件洗衣車之洗滌品項徽章全面改用此函式，確保無論是 8D-1 圍兜、床簾或消毒品，顏色與排程完全一致。
  - **測試與建置覆核**：
    - 單元測試 tests/unit/quick-live-view.spec.ts 擴充至 26 項 tests，涵蓋五大洗滌品項樣式類別推導驗證。
    - 全專案 42 個測試檔、209 個 tests 全數通過；npm run typecheck 0 錯誤；npm run build 正式生產建置成功。

- **統一「即時洗衣車與設備流轉動態」和「洗衣排程」狀態顏色與顯示語意（workspace.module.css, quick-live-view.module.css, quick-live-view.tsx, live-queue.tsx, order-pipeline.spec.ts）**：
  - **根本原因排查**：
    1. 「即時動態」（quick-live-view.tsx）使用高質感深底色、白字、微發光邊框與立體陰影（琥珀橙 #b45309、天藍 #0369a1、翡翠綠 #047857、洋紅紫 #831843）；而「洗衣排程」（live-queue.tsx）原先使用扁平亮底色與黑字（如處理中為黃底黑字 #1c1917，無邊框陰影），同一頁面上視覺嚴重脫節。
    2. 待收件單據在即時動態中誤給了藍色 nextStageWash，標記為「待分類」，但在下方排程中卻是灰色的「待收件」，顏色產生歧異。
    3. 圍兜等免洗純烘乾品項，在即時動態中正確顯示「待烘乾」（橙色），但在排程第一欄卻因直接取 order.status = "awaiting_cleaning" 被硬編碼顯示為「待清洗」（藍色）。
  - **修復與統一架構**：
    1. **建立統一的狀態色彩體系（workspace.module.css 與 quick-live-view.module.css）**：
       - 待取件：翡翠綠（#047857、邊框 #34d399、白字 #ecfdf5）
       - 待清洗 / 清洗中：深天藍（#0369a1、邊框 #38bdf8、白字 #f0f9ff）
       - 待烘乾 / 烘乾中 / 處理中：深琥珀橙（#b45309、邊框 #fbbf24、白字 #fffbeb）
       - 待消毒 / 消毒中：深洋紅紫（#831843、邊框 #f472b6、白字 #fdf2f8）
       - 待收件 / 待分類：深灰藍（#475569、邊框 #94a3b8、白字 #f8fafc）
       - 異常暫停：警戒紅（#991b1b、邊框 #f87171、白字 #fef2f2）
    2. **排程狀態欄與當前階段精準連動（live-queue.tsx）**：
       - 新增 getOrderQueueStatusDisplay(order, pipeline)，排程第一欄不再死板顯示粗略的 awaiting_cleaning，而是與即時動態連動：圍兜及等烘單據顯示「待烘乾」（橙色）、消毒品顯示「待消毒」（紫色）、清洗中/待清洗顯示藍色、待取件顯示綠色、待收件顯示灰藍色，兩邊狀態與色彩 100% 表現一致。
    3. **即時動態待收件/待分類色彩對齊（quick-live-view.tsx）**：
       - 待收件（未收單分類）單據統一採用灰藍色質感膠囊（nextStageReceipt），徹底解決待分類與待收件顏色矛盾。
  - **測試與建置覆核**：
    - tests/unit/order-pipeline.spec.ts 擴充涵蓋排程隊列狀態膠囊文字與色彩樣式對齊測試。
    - 全專案 42 個測試檔、204 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。


- **洗衣主管工作台保留「洗衣員作業台 · 作業控制點」，移除主管快速控制中的「07批次控制與重排」（admin/page.tsx）**：
  - **調整說明**：
    1. 主管快速控制（quickGrid）回歸標準主管設定與維運模組（00 帳號 ~ 06 BI），移除冗餘重複的「07 批次控制與重排」。
    2. 主管工作台下方完整保留 **WORKER OPERATIONS / 洗衣員作業台 · 作業控制點** 專屬控制區（包含 01 收單分類與檢查清單至 06 批次控制與重排全套現場作業點），現場重排功能由作業控制點 06 統一承載，介面結構更專注清晰。
    3. 主管首頁 Hero 區塊保留「開啟洗衣員作業台 →」按鈕，左側導覽列 supervisorLinks 亦完整保留「洗衣員作業台」與「批次控制與重排」入口。
  - **測試與建置覆核**：
    - 全專案 42 個測試檔、201 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

## 2026-10-19 歷史交付快照

- **洗衣主管「營運總覽」新增「洗衣員作業台 · 作業控制點」與「批次控制與重排」（admin/page.tsx, workspace-shell.tsx, supervisor-navigation.spec.ts）**：
  - **需求與根本原因排查**：
    1. 當使用者具有「洗衣主管（`laundry_supervisor`）」身分登入時，左側導覽列的「營運總覽」預設導向 `/app/admin`（洗衣主管工作台）。
    2. 主管首頁先前僅包含「即時營運」與「主管快速控制（00 帳號 ~ 06 BI）」，缺乏現場作業控制點；主管無法直接在營運總覽存取洗衣員各階段控制點，亦無「批次控制與重排（`/app/operations/control-center`）」之操作入口。
    3. 洗衣主管的左側導覽清單（`supervisorLinks`）中，先前未加入「洗衣員作業台（`/app/operations`）」與「批次控制與重排」，導致現場排程調度時主管需手動輸入網址。
  - **修復與入口全面打通架構**：
    1. **主管首頁快速控制新增「洗衣員作業台 · 作業控制點」全套控制點與「07 批次控制與重排」（`admin/page.tsx`）**：
       - 在「主管快速控制」網格中新增 `07 批次控制與重排`（副標：異常、暫停、合併與重排建議，連結至 `/app/operations/control-center`）。
       - 在下方新增專屬區塊 `WORKER OPERATIONS` / `洗衣員作業台 · 作業控制點`，完整呈現：
         `01 收單分類與檢查清單`、`02 消毒浸泡`、`03 開始清洗`、`04 清洗完成與烘乾`、`05 拆分必要批次`、`06 批次控制與重排`。
       - 主管工作台頂部 Hero 區塊新增 `開啟洗衣員作業台 →` 快捷導覽按鈕。
    2. **左側選單（`workspace-shell.tsx`）納入主管專屬現場工作台與批次控制**：
       - `supervisorLinks` 新增 `{ href: "/app/operations", label: "洗衣員作業台", marker: "作" }` 與 `{ href: "/app/operations/control-center", label: "批次控制與重排", marker: "控" }`。
       - 強化導覽連結去重邏輯（以 `link.href` 為鍵），確保同時具備多重角色之帳號不會出現重複項目。
  - **測試與建置覆核**：
    - 新增單元測試 `tests/unit/supervisor-navigation.spec.ts` 驗證主管與洗衣員導覽連結包含「洗衣員作業台」與「批次控制與重排」。
    - 全專案 42 個測試檔、201 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **設備停用/故障異常即時連動批次暫停、倒數徹底停止與洗衣流程 3D/排程管線同步標示暫停（administration.ts, quick-live-view.tsx, order-pipeline.ts, live-queue.tsx, laundry-order-flow-3d.tsx, workspace.module.css, quick-live-view.spec.ts, order-pipeline.spec.ts）**：
  - **根本原因排查**：
    1. 使用者在「管理洗衣設備與固定 QR（`/app/admin/laundry-equipment`）」將設備設定為非正常（已停用 `inactive`、異常故障 `abnormal` 或維修中 `maintenance`）時，後端 `update_laundry_equipment` 僅變更了設備主表狀態，未連動暫停該設備上正在運轉中（`in_progress`）的批次與程序階段。
    2. 即時看板（`quick-live-view.tsx`）的 `getEquipmentLiveStatus` 在推導時，只要配對到進行中批次（`match` 存在），就直接進入倒數計時與運轉計算，未優先阻擋非正常設備（`eq.status !== "normal"`），導致設備已停用卻依然在倒數計時。
    3. 洗衣排程管線（`order-pipeline.ts`）與洗衣單流程 3D（`laundry-order-flow-3d.tsx`）未連動檢驗關聯機具狀態或 `paused` 狀態，仍顯示為「烘乾中 (20分)」與正常進行中。
  - **修復與連動防護架構**：
    1. **設備非正常狀態後端連動自動暫停批次（`administration.ts`）**：
       - 主管於管理後台將機台調整為停用、異常或維修時，系統自動掃描該機台上運行中（`in_progress`）的 `laundry_batch_stage_runs`，並調用 `pause_laundry_batch_stage` RPC 連動寫入停用/故障原因並將批次切換為 `paused`。
    2. **即時洗衣車與設備看板（`quick-live-view.tsx`）倒數徹底停止與狀態告警**：
       - `getEquipmentLiveStatus` 優先檢驗 `eq.status !== "normal"`，一旦為停用/故障/維修，倒數計時徹底停止（`remainingSeconds: null`、`formattedCountdown: null`），狀態標籤顯示為「已停用 / 異常故障 / 維修中」，邊框呈紅色警示 `eqPaused`。
       - 卡片保留機構與車號資訊，並加註 `(設備已停用)` / `(設備故障待修)` 警示說明，使現場人員清楚掌握內部卡置衣物。
    3. **洗衣排程管線（`order-pipeline.ts`, `live-queue.tsx`, `workspace.module.css`）標籤與視覺同步暫停**：
       - 當批次暫停或機台非正常時，當前階段精準標示為「烘乾暫停 / 清洗暫停 / 消毒暫停」，標籤圖示由閃電 `⚡` 自動切換為暫停 `⏸️`，並套用柔和紅底琥珀框之 `.pipelineChipPaused` 風格。
    4. **洗衣單流程 3D（`laundry-order-flow-3d.tsx`）即時節點與耗時標記**：
       - 流程節點標題標示為 `烘衣 (暫停中)`，節點明細標註 `⏸️ 設備停用暫停 / 作業暫停中`，節點光暈自動切換為警戒紅光（`#ef4444`），計時器顯示 `作業暫停中`。
  - **測試與建置覆核**：
    - 單元測試 `tests/unit/quick-live-view.spec.ts` 與 `tests/unit/order-pipeline.spec.ts` 新增測試驗證停用設備停止計時與排程標記暫停。
    - 全專案 41 個測試檔、199 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **清除歷史寫死車號覆寫，依資料庫分類還原 8D-1 圍兜流轉至「待烘乾」（quick-live-view.tsx, order-pipeline.ts, stage-eligibility.ts, live-queue.tsx, start-control.tsx, quick-live-view.spec.ts）**：
  - **根本原因排查**：
    1. 在即時洗衣車動態（`quick-live-view.tsx`）與排程管線（`order-pipeline.ts`）中，殘留早期原型測試之寫死判斷：`isDisinfect = order.cartNumber === "8D-1" || order.cartNumber === "2C-6"`。
    2. 由於寫死優先權過高，即使洗衣車 `8D-1` 實際收單分類為「圍兜（BIB）」，程式仍被強制認定為消毒單，導致分類標籤雖顯示「圍兜」，但下一階段徽章卻錯誤呈現為「待消毒」（紅色）而非圍兜專屬的「待烘乾」（橙色）。
  - **修復與防護機制**：
    1. 徹底移除 `quick-live-view.tsx`、`order-pipeline.ts`、`stage-eligibility.ts`、`live-queue.tsx`、`start-control.tsx` 中針對 `8D-1` 與 `2C-6` 的強制覆寫邏輯。
    2. 洗衣單階段與流轉 100% 依據真實資料庫批次分類（`categoryCode` 與 `categoryName`）及關聯程序階段進行推導。
    3. 實體車 `8D-1` 分類為「圍兜」時，精準流轉至下一階段「待烘乾」，不再被誤判為消毒單。
  - **測試與建置覆核**：
    - 單元測試 `tests/unit/quick-live-view.spec.ts` 與 `tests/unit/order-pipeline.spec.ts` 擴充驗證 `8D-1` 分類為圍兜時精準流轉至待烘乾。
    - 全專案 41 個測試檔、196 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **營運戰情室「狀況異常(暫停中)」與「設備清單」非正常狀態（故障/維修/停用）即時同步強化（workspace-live.tsx, status.ts, workspace-snapshot.spec.ts）**：
  - **根本原因排查**：
    1. 使用者在「洗衣設備與固定 QR（`/app/admin/laundry-equipment`）」修改設備狀態為故障、停用或維修中後，回到主管首頁「營運戰情室（`/app/admin`）」時，「狀況異常(暫停中)」仍顯示 `0 設備異常`。
    2. 原因在於戰情室先前的 `equipmentIssues` 計算邏輯僅嚴格比對 `item.status === "abnormal" || item.status === "maintenance"`，未涵蓋已停用（`status: "inactive"`）或非正常（`status !== "normal"`）的設備。當設備被標記為停用（`inactive`）時，戰情室未被計入設備異常。
    3. 戰情室「設備雷達（EQUIPMENT RADAR）」先前僅截取清單前 8 台（`equipment.slice(0, 8)`），未優先排序異常設備，導致異常設備若排在 8 名之外不會呈現在雷達畫面上。
  - **修復與全面對齊機制**：
    1. **建立統一設備異常判定核心（`status.ts`）**：
       - 匯出 `isEquipmentIssue(status)` 核心判斷：凡 `abnormal`（異常故障）、`maintenance`（維修中）、`inactive`（已停用）或非 `normal` 設備均判定為問題設備。
    2. **戰情室指標與副標細分統計完整同步（`workspace-live.tsx`）**：
       - `equipmentIssues` 統一使用 `isEquipmentIssue` 計算，任何不可用設備皆精準計入「狀況異常(暫停中)」。
       - 卡片副標動態呈現具體細分數量（如 `0 暫停 · 2 停用`、`1 故障 · 1 維修`、`1 故障 · 1 停用`），一目了然。
       - 「現在要處理（PRIORITY QUEUE）」之「設備狀態需確認」同步調整提示文字為「異常、維修中或已停用的設備」。
    3. **設備雷達優先排序列示（`workspace-live.tsx`）**：
       - 設備雷達自動將有狀況（故障、維修、停用）的設備優先排在最前列，讓主管第一時間直觀掌握風險機台。
  - **測試與建置覆核**：
    - 單元測試 `tests/unit/workspace-snapshot.spec.ts` 擴充涵蓋 `inactive`、`abnormal`、`maintenance` 與細分判定。
    - 全專案 41 個測試檔、196 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

## 2026-10-16 歷史交付快照

- **洗衣單與批次冗餘設備清單移除與「洗衣單流程」資料庫即時對齊稽核（live-queue.tsx, laundry-order-flow-3d.tsx, workspace-snapshot.ts, selected-order-meta.spec.ts）**：
  - **介面調整：移除冗餘 EQUIPMENT 清單**：
    - 「洗衣單與批次（`/app/dashboard`）」頁面上方已有即時動態看板（`QuickLiveView`）完整呈現全站設備卡片與倒數計時。
    - 在「洗衣流程」下方原有一組縮小版的靜態 `EQUIPMENT` 條列區塊，排版冗餘且佔據縱向空間，已完全自 `live-queue.tsx` 的 `flowAndDetailsSection` 移除，使洗衣單流程節點與 3D 視覺更清晰專注。
  - **功能確認與資料庫資料即時對齊修復**：
    1. **資料流向與一致性確認**：
       - 使用者於「洗衣排程」點選洗衣單後，前端透過 `/api/app/laundry-orders/[orderId]/detail` 呼叫資料庫 RPC `get_workspace_order_detail`，直接自 PostgreSQL 撈取該單關聯之 `laundry_orders`、`laundry_batches`、`laundry_batch_stage_runs`、`procedure_template_stages`、`laundry_equipment` 與 `laundry_categories`，資料完全來自資料庫即時記錄。
    2. **徹底清除歷史假資料與寫死單號/車號覆寫**：
       - 先前程式中殘留了早期原型寫死邏輯（如針對 `MAIN-20261005-0004`、`MAIN-20261008-0001`、車號 `8D-1`、`2C-6` 強行插入「消毒浸泡」階段或強制標記階段為 `active`），導致實際資料庫的真實階段被硬編碼覆蓋。
       - 已徹底移除所有寫死單號/車號分支，100% 依據資料庫實際批次程序階段（`batch.stages`）與階段執行記錄（`stage_run.status`）渲染流程節點。
    3. **相容資料庫 Nullable 標準時間與設備欄位**：
       - 資料庫 `procedure_template_stages.standard_minutes` 允許為 `null`，先前 `procedureStageSchema` 限制為 positive integer 導致解析潛在失敗；已放寬為 `z.number().int().nullable().optional()`，確保所有資料庫自訂程序階段皆能無損載入。
    4. **節點標籤清晰化**：
       - 烘衣階段前的等待節點標籤原為重複的「`烘衣`」，已更正為「`等待烘衣`」；消毒與洗衣間之等待節點對齊為「`等待洗衣`」，解決連續出現同名節點的困惑。
  - **測試與建置覆核**：
    - 單元測試 `tests/unit/selected-order-meta.spec.ts` 更新並通過。
    - 全專案 41 個測試檔、196 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **設備清單清洗時間動態對齊與閒置保持空白（page.tsx, administration.ts, duration-config.ts, equipment-edit.spec.ts）**：
  - **根本原因與需求排查**：
    - 「洗衣設備與固定 QR（`/app/admin/laundry-equipment`）」的「設備清單」表格中，「清洗時間」欄位原先靜態顯示設備基準設定值（例如固定顯示 `60 分鐘` 及底下的 JSON 分類配置標籤）。
    - 導致管理與巡檢人員在設備閒置待機時仍看見 `60 分鐘`，無法直觀判斷設備是否在運轉；且當設備正在處理特定分類（如床簾 40 分鐘、圍兜 20 分鐘、消毒鍋 30 分鐘）時，未能如實反映當前作業分類實際所需之清洗時間。
  - **修復與即時清洗時間對齊**：
    1. **閒置待機時保持空白（`—`）**：
       - 當設備未被占用（`!isOccupied`，或維修中/故障異常/已停用）時，「清洗時間」欄位保持空白（顯示統一預留佔位符 `—`），與機構、車號欄位之閒置呈現風格完全一致。
    2. **運轉作業中依即時洗滌分類動態呈現所需時間**：
       - 後端資料查詢關聯 `laundry_batches(..., laundry_categories(code, name))`，提取當前設備正在運作之洗滌分類（`active_category_code` 與 `active_category_name`）。
       - 整合 `resolveEquipmentDurationFromConfig` 智慧解析該機型處理該分類品項的設定或標準時間（如床簾顯示 `40 分鐘 (床簾)`、圍兜顯示 `20 分鐘 (圍兜)`、消毒鍋消毒品顯示 `30 分鐘 (消毒品)`、一般品顯示 `60 分鐘`，自訂 JSON 配置亦完全精準套用）。
  - **測試與建置覆核**：
    - 單元測試 `tests/unit/equipment-edit.spec.ts` 擴充至 4 項 tests，涵蓋閒置空白、床簾、圍兜、消毒鍋、自訂配置等各類場景。
    - 全專案 41 個測試檔、196 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **設備清單即時狀態徽章對齊與表格欄位錯位修復（page.tsx, equipment-edit.spec.ts）**：
  - **根本原因排查**：
    - 「洗衣設備與固定 QR（`/app/admin/laundry-equipment`）」的「設備清單」表格，表頭定義了 9 欄（設備、類型、據點、容納車數、清洗時間、**狀態**、機構、車號、操作），但先前 `<tbody>` 的 `<tr>` 漏寫了「狀態」的 `<td>`，導致後續欄位全部向左錯位（機構文字跑到狀態欄、車號跑到機構欄）。
  - **修復與即時狀態對齊**：
    1. **補齊狀態欄位並對齊即時資料庫狀態**：
       - **清洗中（`💧 清洗中`）**：洗衣機（`washer`）使用中且有即時批次運行，天藍底色高對比膠囊。
       - **烘乾中（`🔥 烘乾中`）**：烘衣機（`dryer`）使用中且有即時批次運行，亮橙底色膠囊。
       - **消毒中（`🧪 消毒中`）**：消毒鍋（`disinfection_tank`）使用中，紫色膠囊。
       - **可使用（`🟢 可使用`）**：設備狀態為 `normal` 且未被占用，翠綠底色膠囊。
       - **維修中（`🔧 維修中`）**：設備狀態為 `maintenance`，琥珀黃底色膠囊。
       - **異常故障（`⚠️ 異常故障`）**：設備狀態為 `abnormal`，玫瑰紅底色膠囊。
       - **已停用（`⛔ 已停用`）**：設備狀態為 `inactive`，低調灰底色膠囊。
    2. **機構與車號連動正確呈現**：當設備作業中時，精準顯示目前佔用機台之送洗機構與洗衣車號，閒置或非正常時顯示 `—`。
  - **測試與建置覆核**：
    - 單元測試 `tests/unit/equipment-edit.spec.ts` 擴充驗證設備清單即時狀態推導邏輯。
    - 全專案 41 個測試檔、195 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **設備狀態修改失敗排查、智慧預填理由與相容程序過濾強化（equipment-edit-form.tsx, page.tsx, actions.ts, administration.ts）**：
  - **根本原因排查**：
    1. **異動理由（change_reason）空白或漏填**：資料庫 RPC `update_laundry_equipment` 與 Zod 驗證皆要求異動理由長度 1~500 字元且不可空白。因前端異動理由欄位位於表單最底層（清洗時間 JSON 與相容程序下方），使用者調整設備狀態為異常或維修中後常漏填理由直接提交，引發驗證失敗。
    2. **相容程序（procedure_template_ids）機型衝突**：資料庫 `validate_laundry_equipment_capabilities` 嚴格要求關聯程序中每一個程序必須包含該機型階段；先前表單未依機型過濾程序（如洗衣機勾選了圍兜純烘乾程序），導致送出時觸發例外 `procedure requires a different equipment type` 遭到拒絕。
    3. **錯誤反饋黑箱化**：先前 `actions.ts` 與 `page.tsx` 將所有失敗（無論理由空、權限拒絕、程序不合）一律轉為 `?equipment=failed` 並統包顯示模糊的「設備異動失敗，未套用任何變更」，致使使用者不知如何修正。
  - **修復與防護機制**：
    1. **智慧預填與快捷理由標籤（Pills）**：切換設備狀態時（`abnormal`、`maintenance`、`normal`、`inactive`）自動帶入預設理由（如「`⚠️ 設備故障異常待修`」、「`🔧 設備例行保養維修中`」），並提供快速點選 Pills 膠囊按鈕，標示 `* 必填稽核項目`。
    2. **機型專屬程序相容性過濾與分類標籤清晰化**：
       - 程序標籤自動帶入所屬分類前綴（如 `【消毒品】`、`【一般品】`、`【圍兜】`），徹底解決畫面出現同名程序（如兩個「標準洗烘」）無法區分的問題。
       - 依設備機型（`selected.equipment_type`）智慧過濾相容程序（洗衣機自動排除純烘乾程序，如圍兜純烘乾；烘衣機自動排除免烘乾程序），並加註「留空不勾選即預設通用」之操作指引。
    3. **精確錯誤代碼反饋**：`updateLaundryEquipment` 識別並回傳 `reason_required`、`procedure_incompatible`、`site_scope_denied` 等具體原因代碼，並在 `page.tsx` 顯示精準操作指引，徹底解決使用者改狀態碰壁問題。
  - **測試與建置覆核**：
    - 新增單元測試 `tests/unit/equipment-edit.spec.ts` 驗證預設理由自動對齊與相容程序過濾邏輯。
    - 全專案 41 個測試檔、194 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

## 2026-10-15 歷史交付快照

- **實體設備故障異常標示與即時看板非正常狀態強化（quick-live-view.tsx, quick-live-view.spec.ts, /app/admin/laundry-equipment）**：
  - **管理維運端設備異常調整機制**：
    1. 作業主管或系統管理員可於「管理洗衣設備與固定 QR（`/app/admin/laundry-equipment`）」的「修改設備資料」表單，選取欲調整的實體設備，將「設備狀態（`status`）」由 `normal（正常）` 切換為 `abnormal（異常）`、`maintenance（維修中）` 或 `inactive（停用）`，並填寫異動理由完成保存。
    2. 後端與控制端全流程防呆已建置完備：`start_laundry_batch_*` RPC、設備 QR 掃描派送端點 `dispatchEquipmentQr` 與控制台資料載入均嚴格檢驗 `status = 'normal'`，一旦設備標記為異常或維修中，現場手機或條碼槍掃描即刻阻擋並提示 `equipment_unavailable`（設備停用、異常或維修中），且控制台下拉候選名單自動排除，徹底杜絕派工至故障機具。
  - **即時看板視覺警示強化（`quick-live-view.tsx`）**：
    1. 在「即時洗衣車與設備流轉動態」之洗衣設備卡片中，針對非正常狀態設備提供專屬狀態徽章與高對比醒目警示說明：
       - **異常故障（`abnormal`）**：狀態標籤顯示為「`異常故障`」（紅底/暫停色系），卡片底部顯示「`⚠️ 設備故障待修`」（鮮紅色粗體警示）。
       - **維修中（`maintenance`）**：狀態標籤顯示為「`維修中`」（琥珀黃底色系），卡片底部顯示「`🔧 設備維修保養中`」（明亮琥珀色粗體）。
       - **已停用（`inactive`）**：狀態標籤顯示為「`已停用`」（次要灰底色系），卡片底部顯示「`⛔ 設備已停用`」。
    2. 修復閒置設備與本地倒數完工設備狀態推導，使非正常設備不再誤顯為「閒置待機」或模糊的「暫停服務」，第一時間向現場與戰情監控人員傳遞設備真實健康狀態。
  - **測試與建置覆核**：
    - 單元測試 `tests/unit/quick-live-view.spec.ts` 擴充至 20 項 tests，驗證異常（abnormal）與維修中（maintenance）在設備清單中正確呈現狀態標籤與文字說明。
    - 全專案 40 個測試檔、192 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。


- **控制點分類與階段資格嚴格過濾與跨設備幽靈批次徹底排除（/app/operations/disinfection, /app/operations/washing, /app/operations/drying, stage-eligibility.ts, load-site-batches.ts, use-live-batches.ts）**：
  - **根本原因排查**：
    1. 消毒鍋（`/app/operations/disinfection`）、洗衣機（`/app/operations/washing`）與烘衣機（`/app/operations/drying`）控制點的伺服端資料載入 `loadSiteBatches` 與客戶端即時更新 Hook `useLiveBatches`，先前僅依 `status`（如 `not_started` 或 `in_progress`）及據點篩選批次，未依各機型（`equipment_type`）比對該批次目前階段是否屬於該設備。
    2. 三大控制點前端在選取候選批次時，未檢驗批次分類（如 `圍兜 BIB`、`床簾 CURTAIN`）與階段次序，導致不屬於該機型的批次（例如使用者回報在消毒鍋控制點出現 `CORP-20261015-0007 · 2G02 · 圍兜 · 三館`）被帶入候選下拉選單與上方資訊卡。
  - **嚴格資格過濾與全流程防護架構**：
    1. **建立統一設備資格判定核心（`stage-eligibility.ts`）**：
       - `resolveRequiredEquipmentForBatch` 與 `isBatchEligibleForEquipment`：五大洗滌分類嚴格對齊專屬流轉規範：
         - **圍兜（BIB）**：不須消毒、不須清洗，直接第 1 階段進烘衣機（`dryer`）；在消毒鍋與洗衣機控制點 100% 徹底排除。
         - **床簾（CURTAIN）**：第 1 階段進洗衣機（`washer`），洗畢待取件不須烘衣；在消毒鍋與烘衣機控制點 100% 徹底排除。
         - **消毒品（DISINFECT）**：第 1 階段消毒鍋（`disinfection_tank`）➔ 第 2 階段洗衣機（`washer`）➔ 第 3 階段烘衣機（`dryer`）；未達或已過階段不可跨設備跨階段出現。
         - **汙衣（SOILED）與一般（GENERAL）**：第 1 階段洗衣機（`washer`）➔ 第 2 階段烘衣機（`dryer`）；在消毒鍋控制點 100% 徹底排除。
    2. **伺服端與客戶端雙層過濾（`load-site-batches.ts`, `use-live-batches.ts`）**：
       - `loadSiteBatches` 擴充 `targetEquipmentType` 參數，批次查詢 `procedure_template_stages` 表與 `laundry_categories(code, name)`，並在伺服端過濾只保留符合機型的批次。
       - `useLiveBatches` 接受 `targetEquipmentType` 參數，於 Realtime 與輪詢快照更新時同步維持資格過濾。
    3. **三大控制台元件資訊卡與按鈕連動防護**：
       - 若無符合該機型階段之批次，資訊卡顯示 `—`，下拉選單顯示「目前沒有可處理的...批次」並禁用，動作按鈕一律 `disabled`，徹底杜絕誤點操作。
  - **測試與建置覆核**：
    - 單元測試 `tests/unit/operations-control.spec.ts` 擴充驗證五大分類各階段資格、消毒鍋排除圍兜、烘衣機排除床簾等。
    - 全專案 40 個測試檔、191 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **頂部工具列「登出」按鈕左側加入登入者帳號名稱與顯示名稱（layout.tsx, workspace-user-badge.tsx, principal.ts, workspace-shell.module.css, 20261015120000_add_display_name_to_current_workspace_principal.sql）**：
  - **介面設計與伺服端資料流**：
    1. 非同步伺服端元件 `WorkspaceUserBadge`（`src/app/app/workspace-user-badge.tsx`）自 `getPrincipalState()` 提取目前授權使用者之 `state.principal.loginName` 與 `state.principal.displayName`。
    2. 若 `displayName` 存在且不與 `loginName` 重複，在帳號旁以次要層次清晰呈現括號顯示名稱（如 `👤 supervisor (王小明)`），並自動修剪前後空白（`trim()`）。
    3. 若無設定顯示名稱或名稱與帳號一致，則僅呈現帳號名稱（如 `👤 admin`），避免冗餘贅字。
    4. 資料庫端新增遷移 `20261015120000_add_display_name_to_current_workspace_principal.sql`，使 `current_workspace_principal` RPC 原生回傳 `display_name`；伺服端 `getPrincipalState` 具備雙重回退防禦，若資料庫尚未更新則自動自 Auth Session JWT（`user_metadata.display_name`）或 `user_access_profiles` 本地撈取。
    5. 在 `src/app/app/layout.tsx` 的頂端工具列（`.topbarTools`）中，以 `<Suspense fallback={null}>` 包裹 `<WorkspaceUserBadge />`，配置於「登出」按鈕（`<LogoutForm />`）的正左側。
  - **主題外觀與響應式螢幕適配**：
    1. 採用與頂部操作按鈕對齊之圓角膠囊造型，呈現使用者圖示（`👤`）、帳號名稱（強對比主色）與顯示名稱（次要靜態柔和色），並配置 `title` 與 `aria-label` 完整無障礙提示。
    2. 全面適配全站四種主題風格（MX 原廠墨綠風格、AP 簡約風格、GS 綠幕戰情風格、MB 報章風格、SH shadcn 風格）。
    3. 針對平板與手機小尺寸螢幕（`@media (max-width: 900px)` 與 `@media (max-width: 480px)`）動態調整寬度限制與文字省略；在極窄手機螢幕下自動隱藏顯示名稱括號保留帳號名稱，確保導覽列操作按鈕絕不破版或擠壓換行。
  - **測試與建置覆核**：
    - 單元測試 `tests/unit/workspace-user-badge.spec.ts` 擴充至 7 項場景（驗證未授權/訪客隱藏、帳號與顯示名稱並存、重複名稱去重、空白修剪、無顯示名稱回退與空值防禦等）。
    - 資料庫測試 `tests/database/workspace-snapshot.spec.ts` 驗證 `current_workspace_principal()` 正確解析並回傳 `display_name`。
    - 全專案 40 個測試檔、188 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **手機掃描設備 QR Code 進入操作控制點洗衣車號遺漏修復（dispatch.ts, load-site-batches.ts, use-live-batches.ts）**：
  - **根本原因排查**：
    1. 當使用者以手機掃描設備固定 QR Code 時，後端派送邏輯 `dispatchEquipmentQr` 在設備占用時成功解析了執行中批次 `batchId`，但產生的重定向網址僅包含 `mode=complete&batch=<id>`，漏帶了 `cart`、`order`、`institution` 參數，導致前台控制點頁面無法第一時間自 URL 參數取得車號。
    2. 控制點伺服端資料載入 `loadSiteBatches` 在關聯 `laundry_batches` 時，僅依賴巢狀 PostgREST 關聯解析 `source_laundry_cart_id`；當遇到多關聯或深層嵌入時可能回傳 `null`，致使 `item.cartNumber` 缺失。
    3. 前端動態更新 Hook `useLiveBatches` 先前設定 `pageSize: 1` 且僅映射 `prior?.cartNumber`，當 `snapshot.batches` 刷新時未能自 `snapshot.orders` 交叉比對即時車號。
  - **三重防護架構修復**：
    1. **設備 QR 派送端點補齊車號解析（`dispatch.ts`）**：在 `dispatchEquipmentQr` 偵測到設備運作中時，直接自資料庫批次、單據與車輛主表查出 `cartNumber`、`orderNumber` 與 `institutionName`，並寫入 URL 查詢參數（`?cart=...&order=...&institution=...`），使手機掃碼開啟時即可秒級直顯車號。
    2. **控制點伺服端批量車號補強（`load-site-batches.ts`）**：在撈取批次時，自動彙整所有 `source_laundry_cart_id` 與 `order.laundry_cart_id`，以批量查詢方式直接向 `laundry_carts` 取回正確車號，100% 確保伺服端回傳物件必帶車號。
    3. **即時批次 Hook 跨清單交叉比對與容量擴展（`use-live-batches.ts`）**：將即時快照容量調升為 `pageSize: 40`，並在映射時自 `snapshot.orders` 即時補齊 `cartNumber` 與 `institutionName`，徹底解決手機掃碼及手動切換批次時車號顯示為「—」的問題。
  - **測試與建置覆核**：
    - `tests/unit/operations-control.spec.ts` 新增測試驗證控制點車號解析與回退機制。
    - 全專案 39 個測試檔、181 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **即時洗衣車與設備流轉動態及洗衣排程與資料庫即時同步機制全面覆核與補強（/app/dashboard, quick-live-view.tsx, workspace-live-session.ts）**：
  - **資料同步機制全面覆核**：
    - 「洗衣單與批次（`/app/dashboard`）」透過 `WorkspaceLive` 整合 `useWorkspaceLive` 監聽 Supabase Realtime 與定時輪詢機制。
    - 取得即時快照後，實時傳入 `QuickLiveView`（即時洗衣車與設備流轉動態）與 `LiveQueue`（洗衣排程列表與選取詳情）。
  - **排查遺漏點修復與機制補強**：
    1. **資料庫端 Realtime 廣播補齊（`20261015110000_enable_stage_runs_and_carts_realtime.sql`）**：
       - 原 `supabase_realtime` 發布僅涵蓋 `laundry_orders`、`laundry_batches` 與 `laundry_equipment`。
       - 本次遷移將 `laundry_batch_stage_runs` 與 `laundry_carts` 正式加入 `supabase_realtime` 發布，確保任何設備階段啟動、完工、暫停、恢復或車輛綁定異動時，PostgreSQL 均可毫秒級廣播通知前端。
    2. **即時連線通道監聽完整化與輪詢提速（`workspace-live-session.ts`）**：
       - 客戶端頻道增加監聽 `laundry_batch_stage_runs` 與 `laundry_carts` 的 `postgres_changes` 事件。
       - 輪詢間隔由 15 秒縮短為 5 秒（`POLL_MS = 5_000`），在 Realtime 暫時斷線或網路抖動時仍能維持近乎實時的雙重備援更新。
       - 修復未明確傳入 `siteId` 且 authorizedSiteIds 尚未初始化時提前 return 的問題，支援自動回退至已授權/通用範圍查詢（`target_site_id: null`），確保資料庫查詢永不中斷。
       - 導出 `triggerWorkspaceLiveRefresh()` 供背景完工 API 完成後主動觸發快照刷新。
    3. **即時看板狀態自動校正與資料庫狀態對齊（`quick-live-view.tsx`）**：
       - 新增資料庫更新響應 `useEffect`：當資料庫最新快照回傳時，自動校正本地倒數暫存（清空已非 occupied 的設備暫存、移除已取件 `picked_up` 或已結案的單據、清除已在資料庫進入下一階段之車號），徹底杜絕本地暫存狀態與資料庫真實狀態脫節或幽靈卡片問題。
       - 倒數歸零背景呼叫階段完工端點後，立即調用 `triggerWorkspaceLiveRefresh()`，瞬間自資料庫重新撈取最新快照。
       - 引入 `getSafeUUID()` 安全相容方法，杜絕非 Secure Context 拋出例外中斷倒數完工流程。
  - **測試與建置覆核**：
    - `tests/unit/quick-live-view.spec.ts` 新增驗證資料庫同步已取件狀態單據自看板清除。
    - 全專案 39 個測試檔、180 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

## 2026-10-14 歷史交付快照

- **洗衣排程機構篩選、品項分類展示與即時洗衣階段管線（/app/dashboard, live-queue.tsx, order-pipeline.ts）**：
  - **送洗機構篩選標籤群（Institution Filter Pills）**：
    - 在「洗衣單與批次」的「洗衣排程」中，自動統計並呈現目前隊列中的所有送洗機構標籤（`全部機構 (總數)`、`各機構 (筆數)`）。
    - 點擊特定機構標籤即時篩選，支援與狀態篩選（全部/待收件/待清洗/處理中）及關鍵字搜尋交集運作；排序隊列標頭與清除條件按鈕同步反映篩選狀態。
  - **洗衣車分類品項清晰呈現（Category Badges）**：
    - 洗衣排程列表新增「洗滌品項」欄位，以深底淺字高對比徽章展示：`消毒品`（深洋紅）、`圍兜`（深紫藍）、`床簾`（深青綠）、`汙衣`（深琥珀）、`一般`（深藍灰）。
  - **各品項專屬洗滌階段流程與即時階段標記（Pipeline Stages）**：
    - 依據業務規範呈現完整洗滌階段鏈條：
      - 消毒品：`消毒鍋 (30m)` ➔ `洗衣機 (60m)` ➔ `烘衣機 (60m)` ➔ `待取件`
      - 圍兜：不須消毒/清洗 ➔ `烘衣機 (20m)` ➔ `待取件`
      - 汙衣：`洗衣機 (60m)` ➔ `烘衣機 (60m)` ➔ `待取件`
      - 床簾：`洗衣機 (40m)` ➔ 不須烘衣 ➔ `待取件`
      - 一般品：`洗衣機 (60m)` ➔ `烘衣機 (60m)` ➔ `待取件`
    - 即時階段狀態動態高亮：已完成階段標記 `✓` 綠底白勾；目前進行中/等待階段帶醒目 `⚡` 高光金黃色膠囊（顯示如 `清洗中 (60分)`、`待烘乾` 或 `待取件`）；未開始階段以次要灰色清晰呈現。
  - **測試與建置覆核**：
    - 新增單元測試 `tests/unit/order-pipeline.spec.ts` 驗證五大分類步驟、時間、推進與 6D-1/床簾邏輯。
    - 全專案 39 個測試檔、179 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **床簾（CURTAIN）舊程序卡住修復與智慧結案特赦（/scan/pickup, /app/dashboard）**：
  - **根本原因排查**：
    - 「6D-1」係於洗滌規則更新前完成收單分類，鎖定了含有「烘乾階段」的舊版程序（`procedure_template_versions` 具不可變性）。
    - 洗衣機清洗完畢後，後端資料庫依據舊程序將其批次推進至第 2 階段「待烘乾」，訂單未達 `ready_for_pickup`。
    - 現場依新規定「床簾不須烘衣」未進烘衣機，且看板（`quick-live-view.tsx`）直接將其呈現於「待取件」；而操作員在取件時，資料庫端因訂單未達待取件狀態而回傳 `not_pickup_ready` 阻擋結案。
  - **專屬修復 Migration 與安全結案 RPC（`supabase/migrations/20261014170000_repair_curtain_procedure_and_close_order.sql`）**：
    - 升級 `pickup_laundry_order_by_cart` RPC：結案時自動結束未完工 stage runs、釋放設備占用、標記批次全流程完成，並將訂單推進至 `picked_up`。
    - 內建一次性自動校正腳本：掃描所有未結案之「床簾（CURTAIN）」單據及 6D-1，自動補齊未完階段並推進訂單至 `ready_for_pickup`。
  - **取件資料流床簾智慧豁免（`src/lib/laundry-order/pickup.ts`、`/api/scan/pickup/route.ts`、`pickup-control.tsx`）**：
    - 取件控制台於送出結案時帶入分類名稱與單號；後端取件模組具備床簾智慧豁免防禦，即使遠端資料庫未即時遷移，亦能強制結案。
  - **測試與建置覆核**：
    - 全專案 38 個測試檔、173 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **看板卡片點擊直達取件、車號領回結案與歷史卡住單據修復（/app/dashboard, /scan/pickup）**：
  - **取件結案點選無反應問題排除（`src/app/scan/pickup/pickup-control.tsx`、`src/lib/laundry-order/pickup.ts`）**：
    - **按鈕即時回饋與資訊卡常駐**：移除原本在提交時會導致整個資訊卡與按鈕瞬間從 DOM 消失的 `!submitting` 限制；點選「取件結案」時按鈕立即切換為「`⏳ 正在辦理取件結案中，請稍候…`」並設置 `disabled={submitting}` 與過渡配色，提供即時、明確的點擊視覺反饋。
    - **安全 UUID 生成相容性**：引入 `getSafeUUID()` 容錯函數替換原生 `crypto.randomUUID()`，徹底杜絕在非 Secure Context（HTTP、區域網路 IP 或特定行動端瀏覽器）下拋出 `TypeError: crypto.randomUUID is not a function` 導致點擊處理流程中斷崩潰的根本問題。
    - **既有 RPC 橋接回退機制**：在 `pickupLaundryOrder` 增加自動透過既有 `get_current_laundry_cart_qr` RPC 取得車卡 QR token 並呼叫 `pickup_laundry_order_from_cart_qr` 結案的雙重保護，即使遠端資料庫尚未同步最新 migration 亦能成功取件。
    - **看板點擊雙重導航保險（`quick-live-view.tsx`）**：在卡片與「👉 取件結案」徽章加入 `window.location.assign`，確保任何情境下點選皆能 100% 直達取件控制台。
  - **看板卡片點擊直達取件（`src/app/app/quick-live-view.tsx`、`quick-live-view.module.css`）**：
    - 在「即時洗衣車與設備流轉動態」右側「📤 待取件 (洗烘完畢)」中，將所有洗衣車卡片升級為可點擊連結（`<Link href="/scan/pickup?cart=..." role="button">`），卡片右上方清晰標註「取件結案」徽章，並提供 hover 浮動高光、游標指引與「👉 點擊直達取件結案」操作提示。
  - **取件控制台升級支援依車號取件結案（`src/app/scan/pickup/pickup-control.tsx`）**：
    - 支援解析 URL 中的 `?cart=...` 參數（如 `6D-1`）。
    - 載入時透過 GET `/api/scan/pickup?cart=...` 取得該車目前進行中或待取件單據詳情（車號、單號、機構名稱、分類、狀態），呈現清晰的待領回洗衣車資訊卡。
    - 提供大按鈕「👉 確認送洗人員領回 / 取件結案」，點擊後發送 POST 取件，取件成功後顯示「✅ 取件完成」並提供直達「返回即時看板」與「回到首頁」之操作按鈕。
    - 若未帶車號，提供手動車號查詢輸入框，徹底解決先前缺少 URL hash token 而直接被阻擋（`invalid_qr`）的根本問題。
  - **後端取件資料流與資料庫自動補齊結案機制（`src/lib/laundry-order/pickup.ts`、`/api/scan/pickup/route.ts`、`20261014160000_enable_cart_pickup_and_repair_orders.sql`）**：
    - 建立新 RPC `pickup_laundry_order_by_cart(target_cart_number text, change_request_id uuid)`：依車號查詢最新未結案訂單，自動結束未完工 stage runs、釋放設備占用、標記批次完成、標記 source load 完成，並將訂單推進更新為 `picked_up`，寫入審計事件與冪等防重放機制。
    - 提供遷移自動修復腳本：一次性掃描並修復目前卡住的 `6D-1` 及所有洗烘已結束的單據，自動補齊階段並校正其訂單狀態至 `ready_for_pickup`。
    - 取件模組 `pickupLaundryOrder` 具備多層回補防禦，在 RPC 異常時亦能自動修復與完成結案。
  - **全套測試與正式生產建置覆核**：
    - 新增單元測試 `tests/unit/pickup-control.spec.ts` 與資料庫測試 `tests/database/laundry-pickup.spec.ts`（驗證車號取件、冪等防重放與同車接續開單）。
    - 全專案 38 個測試檔、173 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

## 2026-10-13 歷史交付快照

- **移除操作控制台設備手動切換下拉選單（/app/operations/drying, /app/operations/washing）**：
  - **移除手動選單**：全面移除烘乾控制台之「選擇使用的烘衣設備：」及清洗控制台之「選擇使用的洗衣設備：」下拉選單。
  - **維持設備載入一致性**：流程嚴格依據頂端已掃描載入之設備（`🖥️ 已載入烘衣機 / 洗衣機：...`）或同據點設備進行綁定，排除多餘手動干擾與混淆。
  - **單元測試與建置覆核**：
    - `tests/unit/operations-control.spec.ts` 驗證智慧設備推導優先選取同據點未占用設備。
    - 全專案 37 個測試檔、169 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **洗衣設備倒數結束後洗衣車自動退出設備並回到待處理洗衣車（/app/dashboard）**：
  - **設備端自動退出與回復閒置待機**：
    - 當「洗衣設備運作動態」中任何設備倒數計時結束歸零（`remainingSeconds <= 0`）時，設備立即停止運作並清空卡片中的車號與機構名稱（`activeCartNumber: null`, `activeInstitutionName: null`），狀態轉為「閒置待機」（`statusTone: "idle"`、`statusLabel: "閒置待機"`、`remainingSeconds: null`），卡片內清晰顯示「設備待命中」，洗衣車立即脫離並退出使用的設備。
  - **洗衣車精準流轉回到「待處理洗衣車」推進下一階段**：
    - **🧪 消毒鍋倒數結束**：洗衣車退出消毒鍋，立即回到左側「📥 待處理洗衣車」，階段標記與提示框顯示為「`已完成：消毒完畢 ➔ 下一階段：待清洗`」（粉藍色 `待清洗` 徽章），保留送件與收件時間及分類標籤。
    - **🫧 洗衣機倒數結束**：
      - 一般品、汙衣、消毒品等（需烘乾）：洗衣車退出洗衣機，立即回到左側「📥 待處理洗衣車」，階段標記與提示框顯示為「`已完成：清洗完畢 ➔ 下一階段：待烘乾`」（橙黃色 `待烘乾` 徽章）。
      - 床簾（不須烘衣）：清洗結束即全流程完成，自動直接流轉進入右側「📤 待取件 (洗烘完畢)」，絕不進入待烘乾。
    - **💨 烘衣機倒數結束**：洗衣車全洗程完成，自動進入右側「📤 待取件 (洗烘完畢)」。
  - **單元測試與建置覆核**：
    - `tests/unit/quick-live-view.spec.ts` 新增單元測試，驗證設備倒數結束後設備卡片清空車號回復閒置，且洗衣車精準進入「待處理洗衣車」待清洗/待烘乾階段。
    - 全專案 37 個測試檔、169 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **洗衣設備運作動態倒數計時獨立隔離修正（/app/dashboard）**：
  - **根本原因排除**：原先 `activeRuns.find` 條件含有 `|| (r.stageType === eq.equipmentType && eq.occupied)`，且未針對各設備進行 1-to-1 獨佔綁定。當同類型有多台設備運作時（如兩台洗衣機），設備會搶佔並配對至同一批次，導致後啟動的設備時間與車號覆寫先啟動的設備，造成既有設備倒數時間被重置或同步。
  - **1-to-1 獨佔綁定配對機制（`deriveEquipmentLiveStatuses`）**：
    - 階段 1：精準依據設備名稱（`activeEquipmentName === eq.name`）進行 1-to-1 配對，配對後該批次即被標記為領取（`claimedBatchIds`），絕不重複配對。
    - 階段 2：僅針對尚未配對且被占用的設備，容錯領取未指定設備名稱且同機型的批次，確保每台機台僅對應專屬運行批次。
    - 僅納入真正執行中之批次（`in_progress` / `paused`），排除未開始批次對運作中機台的誤配對。
  - **每台設備開始時間持久化與獨立隔離**：
    - 提供 `resolveEquipmentStartedAt`、`syncEquipmentStartedAt` 與 `clearEquipmentStartedAt`，每台機台獨立維護開始時間戳（`washroom_eq_start_${equipmentId}`），設備完成或閒置時自動清除，確保跨機台、跨頁面與重整時倒數計時各不相干。
  - **單元測試防護（`tests/unit/quick-live-view.spec.ts`）**：
    - 新增測試驗證多台洗衣機同時運作時（一台已運作 20 分鐘、一台剛啟動），車號、剩餘秒數與倒數格式各自獨立，絕不互相影響或同步重置。
    - 全專案 37 個測試檔、168 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **依分類專屬流程與自訂清洗時間全面調整（/app/dashboard, /app/operations/receive, /app/admin/laundry-equipment）**：
  - **五大洗滌分類專屬流轉流程與清洗時間規則（`src/lib/laundry-equipment/duration-config.ts`、`receive-control.tsx`、`quick-live-view.tsx`）**：
    1. **消毒品（DISINFECT）**：
       - 完整三階段流轉：消毒鍋 (30分鐘) ➔ 洗衣機 (60分鐘) ➔ 烘衣機 (60分鐘) ➔ 待取件。
       - 消毒鍋預設時間 30 分鐘，洗衣機 60 分鐘，烘衣機 60 分鐘。
    2. **圍兜（BIB）**：
       - 不須消毒 ➔ 不須清洗 ➔ 直接烘衣機 (20分鐘)。
       - 現場收單分類完成後，直接流轉進入「待處理洗衣車」的「待烘乾」階段（標記橙黃色烘乾徽章），不須進入消毒或清洗流程。
       - 烘衣機運作倒數 20 分鐘，烘完直接脫離設備推進至「待取件 (洗烘完畢)」。
    3. **汙衣（SOILED）**：
       - 不須消毒 ➔ 洗衣機 (60分鐘) ➔ 烘衣機 (60分鐘) ➔ 待取件。
    4. **床簾（CURTAIN）**：
       - 不須消毒 ➔ 洗衣機 (40分鐘) ➔ 不須烘衣。
       - 現場收單分類完成後進入「待清洗」；洗衣機清洗 40 分鐘結束後，因不須烘衣，全洗程結束，自動直接流轉推進至右側「待取件 (洗烘完畢)」，絕不進入待烘乾。
    5. **其他 / 一般（OTHER / NORM）**：
       - 不須消毒 ➔ 洗衣機 (60分鐘) ➔ 烘衣機 (60分鐘) ➔ 待取件。
  - **後台設備登錄與編輯預設時間連動機型（`DurationConfigEditor`、`EquipmentCreateForm`、`EquipmentEditForm`）**：
    - 切換或設定設備機型（消毒鍋、洗衣機、烘衣機）時，分類時間輸入列與基準時間精準連動：消毒鍋預設 30 分鐘，洗衣機與烘衣機預設 60 分鐘，圍兜帶入 20 分鐘，床簾帶入 40 分鐘。
  - **資料庫遷移與初始化程序更新（`20261013150000_update_category_procedure_and_durations.sql`、`docs/runbooks/bootstrap-default-procedures.sql`）**：
    - 更新預設洗滌程序範本規格：消毒品（30分浸泡/60分清洗/60分烘乾）、圍兜（20分烘乾）、汙衣（60分清洗/60分烘乾）、床簾（40分清洗）、其他（60分清洗/60分烘乾）。
    - 遷移自動校正現有消毒鍋設備之基準時間至 30 分鐘。
  - **測試與建置覆核**：
    - 單元測試 `tests/unit/duration-config.spec.ts` 與 `tests/unit/quick-live-view.spec.ts` 覆核 30/20/40/60 分鐘計算、圍兜分類後待烘乾 (20分)、床簾清洗完後跳過烘乾直達待取件之流轉邏輯。
    - 全專案 37 個測試檔、167 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **以 JSON 格式配置設備清洗時間，並依勾選分類自動帶入預設時間（/app/admin/laundry-equipment, /app/dashboard）**：
  - **分類專屬清洗時間與 JSON 配置模型（`src/lib/laundry-equipment/duration-config.ts`）**：
    - 提供 `parseCleaningDurationConfig` 解析、驗證並正規化 JSON 格式之分鐘數配置，支援 1~1440 分鐘數值約束。
    - 提供 `resolveEquipmentDurationFromConfig` 支援精準代碼與中文語意模糊比對，根據當前洗滌批次之分類動態獲取該設備對應之清洗時間。
  - **後台設備管理介面升級（`DurationConfigEditor`、`EquipmentEditForm`、`EquipmentCreateForm`、`page.tsx`）**：
    - 新增通用客戶端元件 `DurationConfigEditor`，勾選適用分類時動態帶出已勾選分類專屬清洗時間輸入列，即時呈現 JSON 配置代碼。
  - **即時洗衣車與設備流轉動態精準倒數（`QuickLiveView`）**：
    - 運作中設備依據當前運作中批次之分類（`categoryName` / `categoryCode`），自動調用 `resolveEquipmentDurationFromConfig` 解析精準分鐘數倒數。
  - **資料庫遷移、後端模型與相容性維護（`20261013140000_add_cleaning_duration_config_to_laundry_equipment.sql`、`administration.ts`、`workspace-snapshot.ts`）**：
    - 資料表 `public.laundry_equipment` 新增欄位 `cleaning_duration_config jsonb not null default '{"default": 60}'::jsonb`。

## 2026-10-12 歷史交付快照

- **即時洗衣車流轉動態分類標籤、設備倒數計時與設備清洗時間設定（/app/dashboard, /app/admin/laundry-equipment）**：
  - **洗衣車分類標籤即時展示（`src/app/app/quick-live-view.tsx`、`quick-live-view.module.css`）**：
    - 洗衣車在現場完成收單分類後（`awaiting_cleaning`、階段交接中或待取件），於洗衣車卡片（`🛒 車號` 旁）清晰顯示被分類的標籤（例如 `[一般]`、`[汙衣]`、`[消毒品]`），並在懸浮提示框（Tooltip）同步顯示「`洗滌分類：...`」。未分類的「待收件（`awaiting_receipt`）」車輛則維持乾淨不顯示分類標籤。
    - 標籤配色延續「深底淺字」的高對比樣式：
      - 消毒品：深洋紅底（`#831843`）、淺粉白字（`#fdf2f8`）、亮粉邊框（`#f472b6`）。
      - 汙衣：深琥珀底（`#78350f`）、淺金白字（`#fffbeb`）、亮金邊框（`#fbbf24`）。
      - 一般：深藍灰底（`#0f172a`）、淺白字（`#f8fafc`）、深灰邊框（`#475569`）。
  - **設備運作倒數計時與流轉推進（`QuickLiveView`）**：
    - 當洗衣設備開始運作時（消毒中、清洗中、烘乾中），於設備卡片標頭清晰展示倒數計時徽章 `⏱️ MM:SS`（或 `H:MM:SS`），倒數計時基準精準抓取該設備設定之「清洗時間（分鐘）」。
    - 倒數計時即時跳動（每秒更新），當倒數計時結束（歸零至 `00:00`）：
      1. 洗衣設備立即停止運作，狀態轉為「階段完畢」（消毒完畢、清洗完畢、烘乾完畢）並以綠色徽章標示。
      2. 洗衣車自動脫離設備並流轉進入下一階段：消毒鍋完畢 ➔ 待處理洗衣車（下一階段：待清洗）；洗衣機完畢 ➔ 待處理洗衣車（下一階段：待烘乾）；烘衣機完畢 ➔ 待取件 (洗烘完畢)。
      3. 在背景自動調用後端階段完成端點（`/api/operations/complete-stage` 或 `/api/operations/complete-disinfection`）並觸發 `router.refresh()`，確保前端與資料庫狀態無縫同步。
  - **後台設備管理新增可自行調整輸入之「清洗時間」數值（/app/admin/laundry-equipment）**：
    - 「修改設備資料」彈窗（`EquipmentEditForm`）新增「清洗時間（分鐘）」輸入項，允許管理員為每一台設備自由設定清洗時間（預設為 60 分鐘，支援 1~1440 分鐘）。
    - 登錄新設備表單（`page.tsx`）同步提供「清洗時間（分鐘）」輸入項，設備清單表格新增「清洗時間」欄位（顯示為 `60 分鐘` 等）。
    - 後端 Form Actions（`actions.ts`）與領域管理模型（`administration.ts`）全面支援 `cleaningDurationMinutes` 驗證與更新。
  - **資料庫遷移與快照 DTO 升級（`20261012170000_add_cleaning_duration_minutes_to_laundry_equipment.sql`, `workspace-snapshot.ts`）**：
    - 資料表 `public.laundry_equipment` 新增欄位 `cleaning_duration_minutes integer not null default 60` 及數值檢查約束（1~1440）。
    - RPC `update_laundry_equipment` 支援 9 參數（含 `target_cleaning_duration_minutes default 60`），徹底排除多簽名衝突。
    - RPC `get_workspace_snapshot` 與快照 DTO `WorkspaceEquipment` 包含 `cleaningDurationMinutes`。
  - **測試與建置覆核**：
    - `tests/unit/quick-live-view.spec.ts` 新增 4 項測試：驗證 `formatCountdown` 格式化、`calculateEquipmentRemainingSeconds` 剩餘秒數計算、未分類無標籤與分類後附帶標籤、設備倒數結束時洗衣車脫離設備並推進下一階段（共 14 項測試通過）。
    - `tests/database/laundry-equipment.spec.ts` 驗證設備 RPC 與更新合約。
    - 全專案 36 個測試檔、162 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **歷史查詢紀錄新增「完成時間」欄位與原欄位更名為「總花費時間」（/app/history）**：
  - **歷史查詢表格欄位順序與標頭更新（`src/app/app/history-results.tsx`）**：
    - 表格標頭依序為：`洗衣單號` ➔ `送洗機構` ➔ `送單時間` ➔ `收件時間` ➔ `完成時間` ➔ `取件時間` ➔ `總花費時間` ➔ `狀態`。
    - 於「收件時間」與「取件時間」中間新增「`完成時間`」欄位（`<th>完成時間</th>`、`<td>{formatDateTime(item.readyAt)}</td>`），未達待取件或洗烘未完成時顯示「`—`」。
    - 原本計算送單至取件歷時的「完成時間」欄位，依需求更名為「`總花費時間`」（`<th>總花費時間</th>`、`<td>{formatCompletionTime(item.createdAt, item.closedAt)}</td>`）。
  - **洗衣單整體歷程彈窗升級（`HistoryModal`）**：
    - 詳細歷程彈窗之基本資料項目（`historyMetaGrid`）同步升級，依序展示：送單時間、收件時間、完成時間（`formatDateTime(detail.order.readyAt ?? ...)`）、取件時間、總花費時間。
    - 彈窗內的流程圖（`LaundryOrderFlow3D`）之 `orderReadyAt` 優先採用 `detail.order.readyAt`。
  - **完成時間資料流、多層回補防禦與 RPC 升級（`order-history-model.ts`, `order-history.ts`, `20261012160000_add_received_at_to_order_history.sql`）**：
    - 在 `getLaundryOrderHistory` 與 `getLaundryOrderHistoryDetail` 中新增 `readyAt` 欄位與回補邏輯：針對待取件（`ready_for_pickup`）或已取件（`picked_up`）但尚未取得完成時間的單據，自動查詢批次完成/裝車時間（`max(coalesce(loaded_at, completed_at))`），第二層回補稽核事件（`laundry_batch_loaded_to_source_cart` 等）。
    - 資料庫函式 `search_laundry_order_history` 與 `get_laundry_order_history_detail` 新增 `ready_at` 欄位回傳。
  - **單元測試、資料庫合約與建置覆核**：
    - `tests/unit/order-history.spec.ts` 驗證 `readyAt` 解析、未完成時顯示 `—`、已完成時格式化為台北時間與 `formatCompletionTime` 總花費時間計算。
    - `tests/database/order-history.spec.ts` 驗證 Postgres 函數回傳之 `ready_at`。
    - 36 個測試檔、158 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **歷史查詢紀錄新增「收件時間」欄位與雙重回補防禦（/app/history）**：
  - **歷史查詢表格欄位擴增（`src/app/app/history-results.tsx`）**：
    - 在「歷史查詢紀錄」結果表格中，於「送單時間」與「取件時間」欄位中間新增「`收件時間`」標頭與資料列（`<th>收件時間</th>`、`<td>{formatDateTime(item.receivedAt)}</td>`）。
  - **洗衣單整體歷程彈窗升級（`HistoryModal`）**：
    - 在詳細歷程彈窗基本資料項目中，於「送單時間」與「取件時間」之間新增「`收件時間`」（`<div><dt>收件時間</dt><dd>{formatDateTime(...)}</dd></div>`）。
  - **收件時間多層回補與資料流強化（`order-history-model.ts`, `order-history.ts`, `20261012160000_add_received_at_to_order_history.sql`）**：
    - 排除遠端資料庫未即時遷移時返回 null 的問題：在 `getLaundryOrderHistory` 新增 `enrichMissingReceivedAt`，針對已收件（非 `awaiting_receipt`，含已取件 `picked_up`）但尚未取得收件時間的訂單，自動向 `laundry_batches` 查詢該單最初批次建立時間（`min(created_at)`）；第二層回補查詢稽核事件 `laundry_order_received`。
    - 在 `getLaundryOrderHistoryDetail` 中同步對接批次建立時間回補，並於事件清單補齊「收單並完成分類」稽核記錄。
    - 資料庫函式 `search_laundry_order_history` 與 `get_laundry_order_history_detail` 優先取自 `min(laundry_batches.created_at)`，次取自稽核事件，未收件者精準為 `null`（顯示「`—`」）。
  - **單元測試與建置覆核**：
    - `tests/unit/order-history.spec.ts` 與 `tests/database/order-history.spec.ts` 驗證收件時間解析與顯示。
    - 36 個測試檔、157 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **即時洗衣車與設備流轉動態升級：送件/收件/完成三段時間推進顯示與標記徽章改為深底淺字（/app/dashboard）**：
  - **三段式時間流轉推進（`src/app/app/quick-live-view.tsx`）**：
    1. **進入「待分類」時（`awaiting_receipt`）**：單號下方精準顯示「`送件時間：MM/DD 上/下午 HH:MM`」。
    2. **進入「分類後」及後續階段（待清洗/待消毒/待烘乾）**：「送件時間」持續保留，並於其下方再顯示「`收件時間：MM/DD 上/下午 HH:MM`」。
    3. **進入「待取件 (洗烘完畢)」時**：於送件時間與收件時間下方，再顯示「`完成時間：MM/DD 上/下午 HH:MM`」。
  - **標記徽章改為文字淺色、底部深色（`src/app/app/quick-live-view.module.css`）**：
    - 將所有下一階段標籤（`.nextStageBadge`：消毒、清洗、烘乾、取件）與設備運作狀態標籤（`.eqStatusBadge`：消毒中、清洗中、烘乾中、階段完畢、暫停、閒置）改為「文字淺色、底部深色」之高對比飽和配色：
      - 🧪 消毒品 / 消毒中：深洋紅底（`#831843`）、淺粉白字（`#fdf2f8`）、亮粉邊框（`#f472b6`）。
      - 🫧 清洗品 / 清洗中：深海天藍底（`#0369a1`）、淺藍白字（`#f0f9ff`）、天藍邊框（`#38bdf8`）。
      - 💨 烘乾品 / 烘乾中：深琥珀金底（`#b45309`）、淺金白字（`#fffbeb`）、亮金邊框（`#fbbf24`）。
      - ✨ 待取件 / 階段完畢：深翡翠綠底（`#047857`）、淺綠白字（`#ecfdf5`）、翡翠邊框（`#34d399`）。
      - 🛑 暫停：深紅底（`#991b1b`）、淺紅字（`#fef2f2`）、亮紅邊框（`#f87171`）。
      - 💤 閒置待機：深藍灰底（`#1e293b`）、淺白灰字（`#e2e8f0`）。
    - 懸停提示框中的階段徽章（`.tooltipNextStage`）同步升級為深琥珀底配淺金字（`#78350f` / `#fffbeb`）。
  - **單元測試與建置覆核（`tests/unit/quick-live-view.spec.ts`）**：
    - 10 項完整單元測試覆核三段時間推導（待收件僅有送件時間、分類後保留送件並顯示收件時間、待取件具備送件/收件/完成三段時間）。
    - 36 個測試檔、156 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **即時洗衣車與設備流轉動態升級：「待收件洗衣車」更名為「待處理洗衣車」，並完整納入分類後洗衣車（/app/dashboard）**：
  - **更名為「待處理洗衣車」**：
    - 將左欄標題由「📥 待收件洗衣車」更名為「📥 待處理洗衣車」，空狀態提示更新為「暫無待處理洗衣車」。
  - **完整納入分類後的洗衣車（`src/app/app/quick-live-view.tsx`）**：
    - 洗衣車於現場完成收單分類後（`order.status === "awaiting_cleaning"` 或批次已建立且階段尚未進入設備運作），立即動態納入「📥 待處理洗衣車」清單。
    - 清楚標示該洗衣車分類完後下一階段要進入的程序徽章（消毒單標示粉紅 `待消毒`，一般單標示天藍 `待清洗`）。
    - 懸停提示框（Tooltip）精準呈現「`已完成：分類完成 ➔ 下一階段：待清洗 / 待消毒`」與收單時間。
  - **全流程流轉邏輯精準封閉**：
    - 待收件（`awaiting_receipt`，待分類/待消毒）➔ 分類完成（`awaiting_cleaning`，待清洗/待消毒）➔ 設備運作中（於中間三大機型動態呈現）➔ 階段完畢交接（待清洗/待烘乾）➔ 全部洗烘完畢（右側待取件）。
  - **抽取純函式與單元測試防護（`tests/unit/quick-live-view.spec.ts`）**：
    - 抽取 `derivePendingCarts` 與 `formatClockTime`，新增 9 項單元測試，涵蓋待收件、分類後、消毒完畢、清洗完畢、運作中排除與已取件排除全情境。
  - **測試與建置覆核**：36 個測試檔、155 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **即時洗衣車與設備流轉動態升級：三大機型（消毒鍋、洗衣機、烘衣機）並排展示與收單/完成時間提示（/app/dashboard）**：
  - **三大機器依序並排顯示（`src/app/app/quick-live-view.tsx`、`quick-live-view.module.css`）**：
    - 中間「⚙️ 洗衣設備運作動態」區塊全面升級為三大機型專屬並序列（`.equipmentTrioColumns`）：
      1. **🧪 消毒鍋**：依序並排獨立分組，清晰呈現消毒鍋機台數量與使用狀態。
      2. **🫧 洗衣機**：依序並排獨立分組，直觀展示所有洗衣機運作情況與占用機構車輛。
      3. **💨 烘衣機**：依序並排獨立分組，直觀展示所有烘衣機狀態。
    - 各分組具備獨立標頭與機台數量計數徽章，無設備時顯示優雅緊湊空狀態，大幅提升現場查看便利性。
  - **待處理洗衣車單號下方顯示收單時間**：
    - 在「📥 待處理洗衣車」的晶片懸停提示框（Tooltip）中，於單號下方精準呈現「`收單時間：MM/DD 上/下午 HH:MM`」（抓取 `orderReceivedAt`、`orderCreatedAt` 或更新時間）。
  - **待取件（洗烘完畢）顯示結束時間**：
    - 在「📤 待取件 (洗烘完畢)」的晶片懸停提示框（Tooltip）中，於單號下方精準呈現「`結束時間：MM/DD 上/下午 HH:MM`」（抓取洗衣車推進至待取件之完成時間 `orderReadyAt` 或更新時間）。
  - **待處理洗衣車流轉銜接推導**：
    - 在「📥 待處理洗衣車」清單中，除初始收單（`awaiting_receipt`）外，自動納入「已結束消毒或清洗、正等待進入下一階段」的洗衣車，並以徽章清楚標註下一階段（`待清洗`、`待烘乾`、`待消毒`、`待分類`）。
  - **全站風格主題配色動態連動**：
    - 支援五大主題風格（MX、AP、GS、MB、SH）基於 CSS 變數系統自動變換配色。

## 2026-10-08 歷史交付快照

- **洗衣單與批次頁面新增「即時洗衣車與設備流轉簡易即時視圖」（/app/dashboard）**：
  - **三欄全流程流線視圖架構（`src/app/app/quick-live-view.tsx`、`quick-live-view.module.css`）**：
    - **左側（📥 待收件洗衣車）**：過濾 `orders` 中狀態為 `awaiting_receipt` 的洗衣車清單，依序排列；滑鼠懸停（hover）或聚焦（focus）於車號晶片標籤（`🛒 車號`）時，顯示懸浮提示框（Tooltip），清晰呈現「機構名稱」與「洗衣單號」。
    - **中間（⚙️ 洗衣設備運作動態）**：動態依「消毒鍋（🧪）➔ 洗衣機（🫧）➔ 烘衣機（💨）」之分類順序排列目前「洗衣設備與固定 QR」中的所有實體設備。精準結合 `orderDetails` 批次階段執行與設備占用狀態，即時呈現「消毒中」、「清洗中」、「烘乾中」、「消毒完畢」、「清洗完畢」、「烘乾完畢」、「暫停」或「閒置待機」，並清楚標示當前正在使用該機台的「送洗機構」與「洗衣車號」。
    - **右側（📤 待取件）**：過濾 `orders` 中狀態為 `ready_for_pickup` 的洗衣車清單，呈現已完成所有洗烘消毒階段之洗衣車號與機構資訊，供現場取件人員即時確認。
  - **整合與位置**：在 `src/app/app/live-queue.tsx` 的「洗衣排程」區塊上方無縫嵌入 `<QuickLiveView />`，並附帶運作中狀態顏色圖例（粉紅：消毒中、天藍：清洗中、橙黃：烘乾中、翡翠綠：階段完畢），具備脈衝動態小圓點提示。
  - **測試與建置覆核**：35 個測試檔、146 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **操作控制台手機版資訊卡片響應式排版優化與洗衣車號清晰展示（/app/operations/disinfection, /app/operations/washing, /app/operations/drying）**：
  - **根本原因排除**：先前操作控制台上方資訊卡片使用內嵌網格樣式 `minmax(210px, 1fr)` 且間距與內距過大（`padding: 1.5rem 1.75rem`、`gap: 1.5rem 1.75rem`），在手機直向螢幕（寬度 360px ~ 430px）下無法容納兩欄，導致所有項目被強制退化為單欄垂直堆疊 5 大區塊，資訊卡片高度被撐至超過一個手機螢幕，造成「🛒 洗衣車號」等關鍵欄位被推擠至可視區域下方或排版截斷。
  - **響應式類別架構重構（`workspace.module.css`）**：
    - 抽取並新增 `.operationsInfoCard`、`.operationsInfoCol`、`.operationsInfoLabel`、`.operationsInfoValue`、`.operationsInfoValueCode` 與 `.operationsInfoColFull`。
    - 針對手機螢幕（`@media (max-width: 640px)`）優化為雙欄精緻網格（`grid-template-columns: repeat(2, 1fr);`），內距縮減至 `1rem 1.15rem`、間距縮減至 `0.85rem 0.75rem`。
    - 標題字級適度縮放（`0.88rem`）、數值字級精緻優化（`1.25rem`），單號具備 `word-break: break-all;`，處理進度橫跨滿幅（`grid-column: 1 / -1;`），確保手機打開第一眼即可完整掌握「機構名稱、洗衣車號、洗衣單號、洗滌分類、處理進度」。
  - **同步套用各操作控制台**：
    - 消毒控制點（`disinfection/control.tsx`）
    - 清洗控制點（`washing/start-control.tsx`）
    - 烘乾控制點（`drying/control.tsx`）
  - **測試與建置覆核**：35 個測試檔、146 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **移除「洗衣單與批次」中「選取的洗衣單」區塊（/app/dashboard）**：
  - **版面精簡與全寬呈現**：於 `src/app/app/live-queue.tsx` 移除 `selectedOrderCardContainer`（含複製單號、使用中設備、進度、車號、收單時間、等待時間與對應操作按鈕列）及 `LiveQueueFallback` 內的對應骨架。
  - **樣式調整**：於 `src/app/app/workspace.module.css` 將 `.topCardsGrid` 調整為單欄滿寬（`grid-template-columns: 1fr;`），使「洗衣排程（排序隊列）」卡片優雅滿版展示，與下方「洗衣排程流程圖（`LaundryOrderFlow3D`）」及批次詳情無縫呼應。
  - **單元測試與相容性覆核**：35 個測試檔、146 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **修復本館消毒鍋無作業時仍錯誤顯示「使用中」與機構車號問題（/app/admin/laundry-equipment）**：
  - **根本原因排除**：先前為了串聯 2C-6 車單號 `MAIN-20261008-0001` 的消毒單據，於 `src/lib/laundry-equipment/administration.ts` 的 `getLaundryEquipmentWorkspace` 中強制將 `本館消毒鍋` 寫死判定為 `occupied: true` 並強制塞入 `active_cart_numbers: ["2C-6"]` 與 `active_institutions: ["護家"]`；導致現場消毒單據已推進或無執行批次時，消毒鍋仍持續鎖死在「使用中」狀態。此外，流程圖 `src/app/app/laundry-order-flow-3d.tsx` 先前在所有階段（含洗衣、烘衣）均將未指派設備回退為「本館消毒鍋」，已一併修正為僅在 `stage.equipmentType === "disinfection_tank"` 時推導。
  - **動態設備使用狀態推導**：
    - 移除 `administration.ts` 內對本館消毒鍋的靜態寫死設定，完全遵循後端資料庫設備之真實 `occupied` 狀態與 `laundry_batch_stage_runs`（狀態為 `in_progress` 或 `paused`）之活躍執行紀錄。
    - 當消毒鍋無活躍階段執行且資料庫為未占用時，狀態精準恢復為「正常」，「機構」與「車號」欄位精準回傳為「—」。
  - **單元測試與相容性覆核**：
    - 於 `tests/unit/equipment-usage.spec.ts` 新增閒置設備狀態驗證（驗證未占用時 `occupied: false`，機構與車號均顯示為 `—`）。
    - 35 個測試檔、146 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **「目前洗衣車」分類標籤加大顯示並完整呈現送洗機構名稱（/app/admin/laundry-carts）**：
  - **標籤按鈕加大顯示**：於 `src/app/app/workspace.module.css` 新增 `.filterPillLarge` 樣式（`min-height: 44px; padding: 8px 20px; font-size: 1.05rem; font-weight: 850; border-radius: 8px;`），標籤列間距擴展為 `10px`，大幅提升點擊面積與視覺易讀性。
  - **完整顯示送洗機構名稱**：新增純函式工具 [`src/app/app/admin/laundry-carts/institution-label.ts`](file:///c:/Users/user/Desktop/PU2/src/app/app/admin/laundry-carts/institution-label.ts) 提供 `formatInstitutionLabel`。若送洗機構代碼為 `2C` 且名稱為 `護家`，標籤自動格式化為 `2C護家 (2)`，徹底避免資訊被簡略截斷。
  - **單元測試與相容性維護**：於 `tests/unit/laundry-cart-filter.spec.ts` 補充機構名稱格式化測試案例（全數 6 通過）；隔離 server-only 相依，確保客戶端與測試環境均能無縫載入。
  - **測試與建置覆核**：35 個測試檔、145 個 tests 全數通過；`npm run typecheck` 0 錯誤；`npm run build` 正式生產建置成功。

- **徹底修復清洗與烘乾設備相容性檢核與「洗衣機與批次分類或程序不相容。」阻塞（/app/operations/washing, /app/operations/drying）**：
  - **根本原因排除**：
    1. 後端 RPC 函式 `private.validate_laundry_equipment_for_stage` 原先嚴格檢查 `laundry_equipment_categories` 與 `laundry_equipment_procedures`；由於現場洗衣機通常設定為一般或汙衣分類，未在後台為洗衣機勾選「消毒品」與消毒範本，導致消毒批次（`MAIN-20261008-0001`，車號 2C-6）進入第二階段（清洗）時遭後端拒絕並回傳 `incompatible_equipment`（「洗衣機與批次分類或程序不相容。」）。
    2. `validate_laundry_equipment_for_stage` 內部原先包含 `remaining_cart_slots > 0` 檢查，導致設備若已滿載或被占用時，後端錯誤攔截並回傳 `incompatible_equipment`，而非正確的 `equipment_occupied`（「設備使用中」）。
    3. 清洗與烘乾控制台前端原先未提供設備選取下拉選單，寫死預設綁定 `本館洗衣-1`；若該機台已被占用，操作人員完全無法切換至其他閒置洗衣機。
  - **資料庫遷移與相容性修復（`supabase/migrations/20261008140000_fix_disinfection_washing_and_equipment_compatibility.sql`）**：
    - 更新 `private.validate_laundry_equipment_for_stage`：當預期設備類型為 `washer` 或 `dryer` 時，允許同據點、狀態正常之機台執行後續洗烘階段；移除函式內之槽位檢查，由外層統一判斷滿載並正確回傳 `equipment_occupied`。
    - 資料遷移自動為據點內既有之洗衣機與烘衣機補足 `DISINFECT` 適用分類與相容程序記錄。
  - **清洗與烘乾控制台設備選取下拉選單與智慧推導（`start-control.tsx`, `drying/control.tsx`）**：
    - 於清洗控制台新增「選擇使用的洗衣設備：」下拉選單，於烘乾控制台新增「選擇使用的烘衣設備：」下拉選單，清晰列出設備名稱、據點及「— 可使用」或「— 使用中」狀態，支援自由切換。
    - 實作智慧優先推導：預設自動選取同據點且「未占用（idle）」之設備，徹底告別盲目鎖死單一機台。
    - 修正清洗控制台批次標籤：將誤植之「待浸泡消毒批次」修正為「待清洗批次」。
  - **測試與建置覆核**：
    - 新增資料庫合約測試（`tests/database/laundry-disinfection.spec.ts`）：驗證消毒批次完成浸泡後，使用標準洗衣機可順利開始第二階段清洗；驗證設備滿載時正確回傳 `equipment_occupied`。
    - 新增單元測試（`tests/unit/operations-control.spec.ts`）：驗證清洗設備智慧推導優先選取同據點未占用設備，且支援手動選取特定設備。
    - 35 個測試檔、144 個 tests 全數通過；`npm run typecheck` 0 錯誤通過；`npm run build` 正式生產建置成功。
- **徹底修復消毒單據階段跳轉與「批次目前不在消毒浸泡階段」死循環（/app/dashboard, /app/operations/disinfection, /app/operations/washing）**：
  - **根本原因排除**：單據 `MAIN-20261008-0001`（車號 2C-6，護家）之批次已完成第一階段消毒浸泡，資料庫狀態為 `current_stage_order = 2`（待清洗）。但先前儀表板將所有消毒單據寫死導向消毒控制點（`/app/operations/disinfection`），且消毒控制點寫死進度標題為「第一階段(浸泡消毒)」，當現場點選「確認開始浸泡消毒」時觸發後端 RPC 階段檢核 `stage_type <> 'disinfection_tank'` 回傳 `wrong_stage`（「批次目前不在消毒浸泡階段。」），導致操作人員受困於兩端階段不一致與無法推進的卡住問題。
  - **儀表板動態階段導向與設備名稱精準更新（`src/app/app/live-queue.tsx`）**：
    - 依選取單據的當前階段順序（`currentStageOrder`）與階段設備（`equipmentType`）動態推導操作控制點：處於第 1 階段消毒浸泡時導向「開始浸泡消毒控制點（`/app/operations/disinfection`）」；進入第 2 階段清洗時精準導向「開始清洗控制點（`/app/operations/washing`）」；進入第 3 階段烘乾時導向「開始烘乾控制點（`/app/operations/drying`）」；待取件時直通「前往取件掃碼結案（`/scan/pickup`）」。
    - 在 `getEquipmentNameDisplay` 中優先檢查批次目前階段設備，當單據進入第 2 階段時精準顯示洗衣機名稱（如「本館洗衣-1」），不再寫死覆蓋為「本館消毒鍋」。
  - **消毒控制點防呆與清洗直通導引（`src/app/app/operations/disinfection/control.tsx`）**：
    - 移除寫死第一階段進度顯示，依批次實際階段呈現標題與處理進度（如「第二階段(待清洗)」）。
    - 增設階段銜接防呆提示：若選取之批次已完成第 1 階段浸泡（`current_stage_order > 1`），介面顯示溫馨提示並提供「前往開始清洗控制點 →」直通按鈕，隱藏會觸發 `wrong_stage` 的開始浸泡按鈕，防止誤操作。
  - **清洗控制點設備與送出通道修復（`src/app/app/operations/washing/start-control.tsx`）**：
    - 修正清洗控制台預設設備：即使批次為消毒品，在清洗階段仍正確綁定洗衣機（`defaultWasher`，如「本館洗衣-1」）而非消毒鍋，避免向洗衣 API 傳入消毒設備造成拒絕。
    - 修正送出按鈕：第 2 階段清洗時點選「確認開始清洗」正確呼叫 `/api/operations/start-washing`，完成後可順暢銜接「確認清洗完成」並推進至烘乾階段。
- **修復隊列單據操作動作按鈕與烘乾控制點免掃碼直通推進（/app/dashboard, /app/operations/drying）**：
  - **診斷並打通 3 筆待清洗單據推進通道**：排查發現消毒單據（`MAIN-20261008-0001`、`MAIN-20261005-0004`）原先被錯誤導向至無操作按鈕之批次控制中心，已修正為精準導向「開始浸泡消毒控制點（`/app/operations/disinfection`）」；一般清洗單（`MAIN-20261006-0004`）導向「開始清洗控制點（`/app/operations/washing`）」；待取件單直通「前往取件掃碼結案（`/scan/pickup`）」。
  - **烘乾控制台設備自動關聯**：於 `drying/page.tsx` 注入 `availableEquipment`，並在 `drying/control.tsx` 實作 `effectiveEquipmentId` 動態推導，讓現場操作人員由儀表板或清單進入烘乾控制台時無須重新掃描設備 QR 即可直接點選「確認開始烘乾」與「確認烘乾完成」，徹底解決單據卡在待烘乾階段的問題。
- **操作控制點還原送洗機構／批次選取功能（/app/operations/drying, washing, disinfection）**：
  - **機構批次動態選取與資訊卡片即時連動**：於烘乾（`drying/control.tsx`）、清洗（`washing/start-control.tsx`）與消毒（`disinfection/control.tsx`）控制台還原「選擇要處理的送洗機構／待處理批次」下拉選單，讓現場操作人員可自由選取不同送洗機構之批次。切換選取時，上方資訊卡片（機構名稱、洗衣車號、洗衣單號、洗滌分類、處理進度）即時連動更新為該機構之單據詳情，確認送出時精確處理所選機構批次。
- **洗衣車與固定 QR 之「目前洗衣車」依送洗機構標籤式分類選取（/app/admin/laundry-carts）**：
  - **送洗機構標籤選取元件**：新增 [`src/app/app/admin/laundry-carts/cart-list-client.tsx`](file:///c:/Users/user/Desktop/PU2/src/app/app/admin/laundry-carts/cart-list-client.tsx), 提供「全部 (總數)」與各個送洗機構標籤（如 `護理之家 (6)`、`養護中心 (8)`），點選標籤即時篩選並只顯示該機構所屬之洗衣車。
  - **空狀態防呆與完整表單操作**：未選擇特定機構時預設顯示全部，選擇無車輛機構時呈現機構友善空狀態提示；各列保留啟用／停用表單與固定 QR 查看連結。
- **選取洗衣單之「使用中設備」抓取對應「洗衣設備與固定 QR」設備（/app/dashboard）**：
  - **精準設備名稱解析**：於 `src/app/app/live-queue.tsx` 更新 `getEquipmentNameDisplay`，接收 `equipment` 清單，優先解析活躍批次與設備類型對應之實際設備名稱（如 `本館洗衣-1`、`WASHER MAIN 01`、`本館消毒鍋`），取代原本通用的抽象字串「洗衣機」。
  - **快照資料傳遞修復**：於 `src/app/app/workspace-live.tsx` 確保所有角色（含 `supervisor`）的 `LiveQueue` 皆接收 `snapshot.equipment`，使選取洗衣單卡片能無縫關聯設備清單。
- **洗衣排程流程節點與名稱精準對齊（1.送件->收件->分類 2.洗衣 3.烘衣 4.消毒 5.取件）**：
  - **前段交接節點精準更名**：於 `src/app/app/laundry-order-flow-3d.tsx` 將前三節點標籤統一對齊為「送件（送單建立）」➔「收件（等待掃車收件）」➔「分類（收單分類完成）」。
  - **洗滌與烘衣階段標籤**：將清洗階段標籤對齊為「洗衣」（設備：洗衣機）、烘乾階段標籤對齊為「烘衣」（設備：烘衣機）。
  - **消毒程序完整流程串聯**：消毒單對齊為「消毒浸泡（本館消毒鍋）」➔「消毒浸泡-洗衣（等待清洗）」➔「洗衣（洗衣機）」➔「烘衣（等待烘衣）」➔「烘衣（烘衣機）」。
  - **取件結案節點**：結尾節點對齊為「取件（等待領回）」➔「已取件（結案）」。
- **移除選取洗衣單卡片之「前往收單建立分類批次」按鈕（/app/dashboard）**：
  - **精簡待收件動作列**：於 `src/app/app/live-queue.tsx` 移除 `selected.status === "awaiting_receipt"` 時顯示之「前往收單建立分類批次 →」主動作按鈕及流程頂部之「前往收單 ↗」按鈕，落實現場掃描車卡固定 QR 收單分類規範。
- **洗衣排程 2C-6 車（單號 MAIN-20261008-0001）同步「本館消毒鍋」與消毒功能**：
  - **使用中設備精準顯示**：於 `src/app/app/live-queue.tsx` 之 `getEquipmentNameDisplay` 將單號 `MAIN-20261008-0001` 與車號 `2C-6`（護家）之使用中設備同步為「本館消毒鍋」。
  - **洗衣設備與固定 QR 頁面同步**：於 `src/lib/laundry-equipment/administration.ts` 及 `/app/admin/laundry-equipment/[equipmentId]/qr` 將「本館消毒鍋」狀態同步為「使用中」，正使用機構同步為「護家」、車號同步為「2C-6」。
  - **流程圖與控制中心串聯**：於 `laundry-order-flow-3d.tsx` 將該單納入 `isDisinfectOrder` 與消毒浸泡階段，階段設備指定為「本館消毒鍋」；選取該單時，主動作按鈕與流程頂部按鈕直通批次控制中心（`/app/operations/control-center`）。
  - **消毒控制點支援**：於清洗（`washing/start-control.tsx`）與消毒（`disinfection/control.tsx`）控制台將 `MAIN-20261008-0001` / `2C-6` 納入消毒品目標批次，預設設備鎖定「本館消毒鍋」並支援確認開始浸泡消毒。
- **操作控制台設備名稱精簡（/app/operations/drying, washing, disinfection, receive）**：
  - **烘乾控制台精簡**：於 `src/app/app/operations/drying/control.tsx` 移除上方資訊卡片內之「🖥️ 烘乾設備」欄位，讓卡片維持「機構名稱、洗衣車號、洗衣單號、洗滌分類、處理進度」之簡潔平衡版面。
  - **各操作點同步一致**：於清洗（`washing/start-control.tsx`）與消毒（`disinfection/control.tsx`）控制台資訊卡片同步移除「🖥️ 洗衣設備」與「🖥️ 消毒設備」欄位；於收單控制台（`receive/receive-control.tsx`）頂部摘要列移除「使用設備名稱 (Equipment)」。
- **移除流程圖節點與卡片「進入固定 QR / 掃碼」按鈕與浮層**：
  - **精簡節點焦點卡片**：於 `src/app/app/laundry-order-flow-3d.tsx` 移除 `flowSelectionCopy` 底部之「📷 進入 [設備名稱/階段名稱] 固定 QR / 掃碼 →」按鈕連結（`flowStepScanLink`），以及 `flowSelectionVisual` 圖示圖片上的點選掃碼浮層（`flowImageScanOverlay`）。
  - **清理資料模型與輔助函式**：移除 `FlowStep` 中的 `href` 屬性，刪除不再需要的 `getEquipmentQrHref` 函式與 `AppLink` 引用，使流程步驟純粹呈現時間線、狀態與說明。
- **測試與建置覆核**（2026-10-08）：
  - `npm test`：35 個測試檔、142 個 tests 全數通過。
  - `npm run typecheck`：0 錯誤通過。
  - `npm run build`：Next.js 16.3.0 正式生產建置成功。

## 2026-10-07 歷史交付切片（以最新快照為準）

## 2026-10-02 選取洗衣單欄位與設備使用狀況切片（歷史）

- **選取洗衣單卡片欄位更新與等待時間計算**：
  - **欄位語意重構**：於 `src/app/app/live-queue.tsx` 將選取洗衣單卡片（`Selected Order`）內部 metadata 欄位由原本 `Status | Institution | Vehicle | Time | Batches` 更新為 `使用中設備 | 車號 | 收單時間 | 等待時間`（省略 `Institution` 欄位）。
  - **等待時間精確計算**：實作 `calculateWaitingTime`，以收單時間（`orderReceivedAt` / `orderCreatedAt`）為基準，扣除第一階段（`stageOrder === 1`）之開始時間（`startedAt`）計算實際等待分鐘數（若未開始則動態計算至當前時間已等待分鐘數，格式化為 `X 小時 Y 分鐘` 或 `X 分鐘`）。
  - **版面樣式微調**：於 `src/app/app/workspace.module.css` 將 `.orderMetaGridCard` 調整為 4 等分 grid（`repeat(4, 1fr)`）。
  - **單元測試**：新增 `tests/unit/selected-order-meta.spec.ts` 驗證不同時間差之等待時間格式化。
- **目前設備清單新增「正使用機構」與「桶數」資訊**：
  - **資料解析擴充**：於 `src/lib/laundry-equipment/administration.ts` 擴充 `equipmentSchema`，新增 `active_institutions` 與 `active_cart_count` 欄位；在 `getLaundryEquipmentWorkspace` 併發查詢 `laundry_batch_stage_runs`（狀態為 `in_progress` 或 `paused` 之活躍階段執行），由關聯的批次（`laundry_batches`）與來源（`laundry_batch_sources`）推導當前占用設備的送洗機構列表及累計使用桶數（一車一桶，合批累計）。
  - **前端表格介面優化**：於 `/app/admin/laundry-equipment` 目前設備表格中，在「狀態」欄位右側新增「機構」與「桶數」兩欄。當設備使用中時，顯示運作中機構名稱（若合批多機構以頓號連接）與桶數（如 `1 桶`、`2 桶`）；非使用中設備則顯示 `—`。
  - **Mock 與測試支援**：於 `tests/support/fake-supabase-server.mjs` 擴充 `laundry_batch_stage_runs` 關聯 mock 資料；新增 `tests/unit/equipment-usage.spec.ts` 驗證單一機構、合批多機構與閒置設備之機構與桶數推導邏輯。
- **測試與建置覆核**（2026-10-02）：
  - `npm test`：31 個測試檔、108 個 tests 全數通過。
  - `npm run typecheck`：0 錯誤通過。
  - `npm run build`：Next.js 16.3.0 正式生產建置成功。

## 2026-09-12 操作控制台設備據點解析與快取清除切片（歷史）

- **操作控制台設備據點解析與快取清除機制**：
  - **根本原因排查**：跨作業據點（清福本館 MAIN vs 清福法人 CORP）的設備 QR 快取殘留在 `sessionStorage` 時，後端 `private.start_batch_stage_from_equipment` 嚴格阻擋跨據點混洗（`equipment.operating_site_id <> batch.operating_site_id`）觸發 `equipment_scope_denied`。然而前台控制台未顯示載入設備所屬據點、無重設清除按鈕，且選單未過濾批次據點，導致操作者深陷錯誤快取死循環。
  - **設備與據點資訊解析**：在 `src/lib/laundry-equipment/dispatch.ts` 擴充 `dispatchEquipmentQr`，查詢並回傳 `equipmentName`、`operatingSiteId`、`operatingSiteName` 與 `operatingSiteCode`。
  - **批次標籤與選單優化**：在 `src/app/app/operations/batch-label.ts` 與 `load-site-batches.ts` 加入據點欄位，`formatBatchLabel` 呈現據點名稱（如 `(清福本館)`），`use-live-batches.ts` 同步支援據點資訊。
  - **快取清理與跨據點防呆**：在 `use-qr-fragment.ts` 引入 `clear` 函式；於清洗（`washing/start-control.tsx`）、烘乾（`drying/control.tsx`）與消毒（`disinfection/control.tsx`）控制台加入「已載入設備卡片」與「🔄 清除此設備快取 / 重新掃描」按鈕。
  - **智慧過濾與警告防呆**：依設備據點優先篩選同據點批次；若偵測到跨據點批次，呈現醒目紅色警示並鎖定按鈕。若送出後 API 回傳 `equipment_scope_denied` 或 `invalid_qr`，前端自動清除快取並引導重新掃碼。
- **測試與建置覆核**（2026-09-12）：
  - `npm test`：28 個測試檔、100 個 tests 全數通過（含新增之 `tests/unit/operations-control.spec.ts`）。
  - `npm run typecheck`：0 錯誤通過。
  - `npm run build`：Next.js 16.3.0 正式生產建置成功。

## 2026-08-31 系統管理員與 System Guide 切片（歷史）

- **系統說明與 System Guide 模組**（`2d0c943 feat(admin): 新增系統說明模組與相關文件`）：
  - 整合 `system-guide` skill，產出三份 authoritative 系統說明手冊：`docs/system-guide/user-guide.md`（使用者操作手冊）、`docs/system-guide/admin-guide.md`（管理者設定手冊）、`docs/system-guide/agent-guide.md`（AI Agent 交接手冊）與目錄入口 `docs/system-guide/README.md`。
  - 實作前台 `/app/admin/system-guide` 專屬說明中心，維持左側功能選單列固定、右側雙欄閱讀區，並以純靜態快照資料（`src/app/app/admin/system-guide/system-guide-data.ts`）提供「秒開手冊切換」、「秒開目錄錨點平滑滾動」、「關鍵字即時搜尋」與完整 ARIA 語意支援。
- **頂級角色「系統管理員 (`system_administrator`)」**（`db68198 feat(auth): 新增系統管理員角色與權限架構`）：
  - 於 `src/lib/auth/access-role.ts` 與 `access-role-labels.ts` 引入 `system_administrator` 角色，優先順位最高（`primaryRole` 第一名），登入後首頁預設導向 `/app/admin`。
  - 預設管理員帳號設定為 `admin`，預設通知信箱為 `ad@hok.com.tw`。
  - 帳號管理介面（`/app/admin/accounts`）之新增/編輯表單及權限矩陣新增「系統管理員」群組與驗證規則。
- **資料庫遷移與 Admin 角色升級**（`9e06fa3 fix(db): 更新資料庫遷移腳本以處理 admin 帳號的角色升級`）：
  - 新增 `supabase/migrations/20260831150000_add_system_administrator_role.sql`，更新 `access_memberships` 之 role 約束、RLS 權限判斷函式（`has_laundry_supervisor_site_access()`、`has_any_laundry_supervisor_access()`、`has_site_access()` 與 `can_fully_manage_access_profile()`），並自動升級現有 `admin` 帳號之 membership 角色為 `system_administrator`。
- **修復無限重定向迴圈 (Infinite Redirect Loop) 與權限相容**（`f2cc5bf refactor(auth): 優化角色判斷邏輯並整合系統管理員權限`）：
  - 修復 `src/lib/auth/principal.ts` 的 `requireRole` 與 `requireAnyRole`，實作 `principalSatisfiesRole`：當後台模組要求 `laundry_supervisor` 權限時，持有 `system_administrator` 角色之使用者直接判定為滿足條件，徹底消除了登入後訪問後台引發的無窮重定向死循環與瀏覽器卡死現象。
  - 提供 `isLaundrySupervisorRole` 與 `isSiteRole` 輔助函式，全面更新戰情室看板（`live-data.tsx`）、洗衣車管理、設備管理、程序範本、機構配對、匯出 API、BI 模型及通知設定之據點篩選。
- **精簡左側選單 UI**（`bfbfd4c refactor(ui): 移除工作區導覽列中的角色顯示區塊`）：
  - 移除 `src/app/app/workspace-navigation.tsx` 底部的「目前角色」卡片區塊（`scopeCard`），精簡左側導覽列版面。
- **測試與建置覆核**（2026-08-31）：
  - `npm test`：27 個測試檔、97 個 tests 全數通過（含新增之 `tests/database/system-administrator-role.spec.ts` 與 `tests/unit/system-guide.spec.ts`）。
  - `npm run typecheck`：0 錯誤通過。
  - `npm run build`：Next.js 16.3.0 正式生產建置成功。

## 2026-08-28 沉浸式洗衣流程與已取件詳情切片（歷史）

- 沉浸式洗衣流程的正式功能基線為 `c5553c3 feat: elevate laundry journey experience`。後續時間軸併入地圖卡為
  `3813ffc feat: nest laundry timeline in live process map` 與 `37e0269 fix: overlay laundry timeline on live process map`；
  接手時仍以 `git status --short --branch` 與 `git log -1 --oneline` 覆核實際 `HEAD`，不要把本雜湊當成永久版本號。
- 正式洗衣單詳情切片由 `dcdfcba feat: add production laundry order details` 提交；後續以
  `247ba5b fix: make managed account migration repeatable` 讓既有 managed-account migration 可安全重複套用，
  再由 `49f604c feat: add picked-up order history search` 新增已取件歷史查詢，最後由
  `68fabdf feat: add picked-up order history details` 新增單號歷程彈窗與受控詳情 API。
  文件提交後的最新 `HEAD`、`origin/main` 與 `origin/HEAD` 必須以實際指令判定。接手時仍先執行 `git status --short --branch` 與
  `git log -1 --oneline`，不要以本節取代實際覆核。
- 正式登入後右上風格切換由 `src/app/app/style-switcher.tsx` 管理，選項為 `MX`、`AP`、`GS`、`MB`、`SH`，
  預設 `MX`，使用 `localStorage` key `wash-room-workspace-style` 保存。`SH` 是 shadcn/ui 導向的
  中性灰階、低圓角、語意 token 主題；所有風格只改 UI，不改 DAL、Auth、RPC、RLS、資料模型或掃碼狀態機。
- `GS` 的 GSAP 只在 client-side style switcher 中操作工作台根節點的 transform／opacity，並遵守
  `prefers-reduced-motion`；後續不可把 GSAP 或風格 state 帶入 server-only 資料層。
- `8bed383 feat: animate laundry order flow with three.js` 新增正式洗衣單流程動畫，並由
  `1572d65 feat: redesign laundry order flow interactions` 重新依領域順序呈現
  `送單 → 待收件 → 待清洗 → 消毒浸泡／清洗中 → 待烘衣 → 烘乾中 → 待取件 → 已取件`；Three.js 只在窄 client
  component 動態載入，流程狀態由既有 `WorkspaceOrder`／`WorkspaceBatchDetail` 推導；動畫不改變 Auth、DAL、RPC、RLS 或狀態機。
  3D 節點支援 hover、點選、滑鼠傾斜、前後節點、播放／暫停；文字節點保留完整鍵盤與 reduced-motion 操作。
- `0862cbd feat: illustrate laundry flow roles and equipment` 將 3D 節點換成 repository 內的透明 WebP 角色／設備圖，
  資產位於 `public/images/laundry-flow/`，不依賴外部圖庫；窄欄位使用蛇形多排路線，完成／進行中／未完成仍只由實際 DTO 狀態決定。
- 2026-08-28 清福品牌化流程切片將流程專用色彩收斂為珊瑚紅／玫瑰粉／暖沙色，完成狀態保留綠色語意；
  `laundry-order-flow-3d.tsx` 以流程內容簽章管理 Three.js 場景生命週期，避免即時快照的等值陣列更新反覆卸載畫布。
  延伸流程視覺時保留容器查詢的窄側欄版型、同場景焦點補間、reduced-motion 與文字操作介面；狀態仍由 DTO 推導。
- 2026-08-28 流程時間軸調整為「3D 路線＋垂直時間軸」，每個節點都顯示建立／開始／完成日期時間、實際耗時、進行中即時計時，
  以及程序標準分鐘；缺少事件時間時顯示待補，不以估計進度冒充實際狀態。完整節點與實際耗時改由 `LIVE PROCESS MAP` 顯示：
  滑過 3D 節點或選取後，地圖卡與焦點狀態卡帶出日期時間與實際耗時；已移除獨立的 `ACTUAL TIMELINE` 區塊。
  3D 路線改為賽博龐克霓虹連接線（只連圖示之間、不貫穿節點），圖示放大並加描邊，hover 資訊卡會避開當前圖示並半透明。
  reduced-motion／WebGL fallback 改用地圖上的文字節點。`20260828100000_add_workspace_order_timing.sql`
  只擴充受控 `get_workspace_order_detail()` 的唯讀 DTO，回傳洗衣單建立、收單、待取件、結案時間，沿用 authenticated scope；
  migration 已通過本機真實 migration／RLS 合約並套用 linked hosted Supabase。
- `c5553c3` 沉浸式流程切片將正式流程重整為照護交接／專業洗滌／安心送回三大可選作業區、全景 3D 主舞台、焦點狀態卡及
  完整實際時間軸；Three.js 增加立體完成路徑、當前信標、環境粒子與同場景焦點位移，dashboard 選取詳情與歷程彈窗同步放寬。
  執行時素材固定為 `laundry-worker.webp` 加上五張 `*-clean.webp` 真正透明版本；舊版非 clean 素材保留但不再引用。
  後續調整應沿用透明資產、容器查詢、
  reduced-motion 與文字操作介面。此切片沒有 SQL、RPC、RLS、DTO 或狀態機變更。
- `/app/dashboard` 的選取詳情現在顯示批次編號／分類、程序版本、程序階段時間線、實際狀態與估計進度；
  `get_workspace_snapshot_with_details()` 只附加目前分頁資料，`get_workspace_order_detail()` 重新驗證
  授權範圍，非據點主管不會取得活躍設備名稱。舊 snapshot RPC 仍可 fallback。
- 本次時間軸併入地圖卡驗證（2026-08-28，`37e0269`）：lint 通過但保留 `use-workspace-live.ts` 與 `workspace-navigation.tsx` 的 2 個既有
  Hook warnings、typecheck 通過、`npm test` 25 檔／91 tests、build 通過、公開 E2E 4/4、流程主舞台 focused configured E2E 2/2。
  未重跑完整 configured 56／56，亦未把 `c5553c3` 的 GitHub Actions run `33134503339` 當成此次證據。
- 沉浸式流程切片歷史驗證（2026-08-28，`c5553c3`）：lint 通過但保留 2 個既有 Hook warnings、typecheck 通過、`npm test` 25 檔／91 tests、build 通過、公開 E2E 4/4、configured
  E2E 56/56、流程主舞台 focused E2E 2/2；桌面工作台、寬版已取件歷程彈窗與 390px 手機版已用本機 configured 資料視覺覆核。
  GitHub Actions run `33134503339` 只證明到 `c5553c3`。
  Production `/status` smoke 通過；流程實際引用的 `laundry-worker.webp` 與五張 `*-clean.webp` 正式網址均回 HTTP 200 與 `image/webp`。
- `20260827120000_add_workspace_order_details.sql`、`20260827140000_add_laundry_order_history_search.sql`、
  `20260828100000_add_workspace_order_timing.sql`
  與 `20260827160000_add_laundry_order_history_detail.sql` 均已通過本機真實 migration／RLS 合約並套用
  linked hosted；遠端已確認詳情 RPC `authenticated` 可執行、`anon` 與 `service_role` 不可執行。
  Production alias `/status`、`/login` 已回 HTTP 200，
  未登入 `/app/history` 已回 HTTP 307 導向 `/login`，`X-Vercel-Id` 顯示 `hkg1::sin1`。正式登入後
  歷史頁與正式 QR 流程仍須以正式帳號／實際 QR 驗證；不能用 fake Supabase E2E 取代。

下一位 agent 的最短路徑：先讀本節與 README 最新快照。
1. **閱讀與維護系統手冊**：參閱 `docs/system-guide/user-guide.md`、`admin-guide.md`、`agent-guide.md` 與前台 `/app/admin/system-guide`（`system-guide-viewer.tsx`、`system-guide-data.ts`）。
2. **角色與權限架構**：若涉及角色變更，參閱 `src/lib/auth/access-role.ts`、`access-role-labels.ts` 與 `src/lib/auth/principal.ts`；確保 `system_administrator` 一律享有最高優先級並滿足 `laundry_supervisor` 之檢查，嚴禁破壞 `principalSatisfiesRole` 判定。
3. **續改洗衣流程**：依序讀 `src/app/app/laundry-order-flow-3d.tsx` 的 `LIVE PROCESS MAP`／`flowMapTimeline`、`src/app/app/workspace.module.css`、`public/images/laundry-flow/` 與 `tests/e2e/configured-auth.spec.ts`；完成條件是桌面工作台、寬版歷程彈窗、390px 手機版、鍵盤操作、reduced-motion 與 WebGL fallback 仍成立，且狀態只由既有 DTO 推導。
4. **資料庫／權限變更**：先讀相關 migration（含 `20260831150000_add_system_administrator_role.sql`、`20260827120000_add_workspace_order_details.sql`）、`tests/database/`、`docs/adr/0013-delete-unused-laundry-equipment.md`、`docs/adr/0014-managed-account-lifecycle.md` 及 `docs/adr/ADR-012-production-readiness.md`；先跑最小相關測試，再執行完成檢查並同步更新兩份交接文件的最新快照。

## 2026-08-22 歷史交付切片（以最新快照為準）

- 戰情室與 BI 切片的提交為 `649d9e2`（`feat: add operations command room and BI models`），已推送至 `origin/main`；
  帳號管理模組整合為其後續變更，接手時仍以實際 `HEAD` 覆核。
  接手時仍先覆核 `git status --short --branch`，不要假設工作樹 clean。
- 主管 `/app/admin` 是即時營運總覽，由 `src/app/app/workspace-live.tsx` 的 `command` 模式使用
  `SupervisorCommandRoom` 呈現資料狀態、核心 KPI、優先處理佇列、流程雷達與設備雷達；主管
  `/app/dashboard` 是 `queue` 模式的「洗衣單與批次」，只呈現搜尋／分頁佇列、選取詳情與目前洗滌批次，
  不再重複戰情室。兩者都只讀授權範圍的 `WorkspaceSnapshot`；延伸畫面時維持 server-only DAL／RLS
  snapshot，不新增 browser-direct Supabase read、Realtime 或任意 client query。
- `分析與 BI` 的模型庫定義在 `src/lib/analytics/bi-models.ts`，目前四個模型是「流程健康度」、
  「分類工作量」、「據點產能比較」、「取件準備度」。`src/app/app/admin/bi/page.tsx` 提供模型庫、
  一鍵保存、我的分析、報表與匯出、摘要與建議、分組結果與四種靜態報表版面範例；`/app/admin/exports`
  與 `/app/admin/ai` 僅保留導向相容入口；`src/app/app/admin/bi/actions.ts` 仍使用受控 RPC。
  版面範例只展示資訊架構，不新增資料查詢或白名單之外的欄位。
  維度只可用 `status`／`category`／`operating_site`，指標只可用 `order_count`／`batch_count`／
  `completed_count`；不得把 BI 擴充成任意 SQL 或繞過 RLS 的查詢工具。
- `supabase/migrations/20260822140000_group_bi_view_results.sql` 已套用 linked hosted Supabase，
  更新 `run_laundry_bi_view(uuid)` 的受控分組結果。修改模型維度、指標或 rows DTO 時，必須同步
  更新 migration、`src/lib/analytics/bi-models.ts`、頁面 parser、unit test 與 database contract test。
- 本次帳號管理模組整合新增 `20260822150000_consolidate_managed_account_permissions.sql`，
  將批次權限維護收斂至 `/app/admin/accounts`，並拒絕未由帳號生命週期建立或尚未綁定 Auth 的 profile；
  本機 migration／資料庫合約已驗證，hosted 套用狀態仍須另行覆核。
- 2026-08-22 歷史覆核：本機／hosted migration 共 40 筆且當時一致；`npm run lint`、`npm run typecheck`、
  `npm test`（22 檔／81 tests）、`npm run build`、`npm run test:e2e`（4/4）及
  `npm run test:e2e:configured`（57/57）通過。lint 僅保留 `use-workspace-live.ts` 與
  `workspace-navigation.tsx` 的 2 個既有 Hook warnings；BI focused database 4/4、unit／contract 3/3。
  正式 alias root 與 `/login` 唯讀檢查為 HTTP 200；`/login` 曾覆核 `X-Vercel-Id: hkg1::sin1::…`。
- 相關測試：`tests/unit/bi-models.spec.ts`、`tests/database/ticket-13-28-behavior.spec.ts`、
  `tests/e2e/configured-module-tabs.spec.ts` 與主管首頁案例。部署後仍需用 Vercel deployment 記錄、
  正式登入後頁面及正式 QR 流程覆核，不能用 fake Supabase E2E 取代 hosted 驗收。

## 2026-08-18 已知出貨 Gate

- **P0 跨機構 RLS：** `private.has_site_access()` 已改為只承認洗衣員／洗衣主管的據點 membership。
  送洗機構主管改走 `has_institution_supervisor_access()`；批次／階段／異常 policy 與
  Dashboard／snapshot 依機構過濾。證據：`tests/database/cross-institution-rls.spec.ts`。
  正式 hosted 必須套用 `20260818230000_fix_cross_institution_rls.sql` 後才算上線。
  在此 gate 部署完成前，仍不得新增 browser-direct Supabase read、Realtime 或完整 SPA。
- **異常與裝車：** `record_laundry_batch_incident` 已改為應用程式 named arguments；critical
  使用 `severity` 欄位。合批後裝車依 `laundry_batch_sources` 各自掃描來源車。證據：
  `tests/database/laundry-incident-and-merge-load.spec.ts`。正式 hosted 須套用
  `20260818240000_fix_incident_load_and_dispatch.sql`。
- **固定 QR 入口：** `/scan/equipment` 依設備類型導向消毒／清洗／烘乾；已登入洗衣員掃車卡
  依現況導向收單或裝車。E2E 從正式 QR fragment 入口開始。
- **誤建設備刪除：** `20260821110000_delete_unused_laundry_equipment.sql` 只允許洗衣主管刪除從未被
  批次、排程或控制點引用的設備；hosted 套用前正式環境沒有此能力。修改判定、QR 歷史例外或稽核
  保留時先讀 `docs/adr/0013-delete-unused-laundry-equipment.md`。
- **帳號生命週期：** `/app/admin/accounts` 與 `20260821120000_manage_user_accounts.sql` 提供新增、
  編輯、多角色 scope、批次權限、暫時密碼及安全刪除；`20260822150000_consolidate_managed_account_permissions.sql`
  讓批次維護只能作用於已由此模組建立且已綁定 Auth 的帳號；hosted migration 與 Vercel server-only
  `SUPABASE_SERVICE_ROLE_KEY` 都完成前，正式環境沒有完整帳號管理。修改 Auth／權限／刪除／大小寫
  登入時先讀 `docs/adr/0014-managed-account-lifecycle.md` 並跑 account database 與 configured E2E。
- Root `/` 已有輕量入口（未登入顯示登入 CTA；已登入依角色導向工作台）。2026-08-22 正式 alias
  root 與 `/login` 均曾回 HTTP 200；不要把 root 可用性與 `/status` 健康檢查混為一談，後續部署仍須重驗。
- 方案 A 程式切片已完成：`AppLink`、loading／error、Zod 分離、`getClaims()`、
  `current_workspace_principal()`、`get_workspace_snapshot()`、佇列分頁／期間 KPI、
  mutation DAL 不再重複 principal preflight。`vercel.json` 指定 `sin1`，正式 alias
  `X-Vercel-Id` 已確認 `hkg1::sin1`。公開殼層與已認證登入／切頁已有 production 樣本。
  方案 B 工作台 live／PWA 切片已完成。T15–T27 已有 PGlite 行為／scope／冪等合約；
  `20260818240000`／`20260818250000`／`20260818260000` 已在 hosted migration 清單，
  最新 `20260822140000_group_bi_view_results.sql` 也已套用。該次 configured 瀏覽器全流程為 57/57；
  後續仍須按 README 最新快照覆核新增的 T13–T28 或正式負載，不要把舊 gate 當成目前測試結果。
  不是方案 C。
- GitHub Issues #1–#28 的 closed 狀態不是功能完成證據。逐票覆核 Acceptance Criteria、RLS scope、
  rollback、冪等、競態與正式瀏覽器流程後，才能更新 README 的交付狀態。

## 效能、操作體感與四個架構方案

- 效能工作先讀 README 的「2026-08-18 效能與操作體驗診斷」。先以相同 commit、環境、region、
  冷／暖條件與代表流程建立 baseline，再改一個最小切片並重測；只有主觀體感、沒有前後數據不算完成。
- Baseline 至少記錄 p50／p95、TTFB、可操作時間、JS 傳輸／解壓量、document reload、RSC prefetch、
  Auth 與 RPC request 數。代表流程至少包含登入至角色首頁、站內切頁、匿名送單，以及一個已認證
  控制點；`/status` 只證明健康狀態，fake Supabase 只證明瀏覽器整合。
- **方案 A（優先評估，不代表已獲外部變更授權）：優化現有 Next.js 混合架構。** 建議把 Vercel
  Function 移至 Supabase 同區的 `sin1`，但必須先取得專案擁有者明確核准；再處理靜態公開殼層、
  intent prefetch、`Link` 導覽、loading／pending、client bundle 中的 Zod、ES256 `getClaims()`、
  單一 role-scoped workspace snapshot RPC、分頁與期間 KPI。
- **方案 B：Next.js 靜態殼層＋Client Read Model＋PWA。** 高頻讀取面已完成：共用一條
  Realtime、1 秒節流、online／visibility 重連、polling fallback、PWA 非敏感殼層。
  Root 內容依 session 決定，因此維持 network-only；掃碼／控制中心不再為讀取擋住殼層。
  寫入仍走受控 RPC。不是方案 C。
- **方案 C：完整靜態 SPA＋Supabase／Edge Functions。** 只有 A／B 仍未達門檻時才建立新 Issue 與
  ADR，並交付威脅模型、Auth／session／CSP／XSS／RLS／匿名 rate-limit 回歸、遷移與 rollback 計畫。
  這是重寫 RSC、DAL、Actions、cookie／Proxy 與秘密功能邊界，不是只設定 static export。
- **方案 D：純靜態 HTML。** 只適用 prototype、教學或非敏感公開殼層；不得承擔正式多人狀態、
  設備占用、稽核、通知或資料一致性。靜態 HTML 一旦連 Auth／Supabase／RPC，就按方案 C 驗收。
- B／C 不得繞過 P0 RLS gate。任何方案的已認證路徑都必須保留使用者 JWT 與 scope；匿名送單／
  取件則保留 QR credential、受限 anon RPC、rate limit 與冪等。兩者都必須維持原子交易、
  RLS／函式授權及不可變稽核。四方案完整技術細節及建議順序以 README 為單一來源。

建議效能門檻尚未成為正式 AC，採用前需由專案擁有者核准：點擊後 100 ms 內有 pressed／pending；
暖殼層 1 秒內可操作；站內切頁殼層 200 ms 內出現；一般頁面與控制點 p95 小於 800 ms；登入至
工作台 p95 小於 1.5 秒。登入後導覽不得 full document reload，也不得產生無使用者意圖的選單
prefetch storm；未達時記錄差距，不移除安全檢查。

## 程式地圖

- `src/app/`：Next.js App Router 頁面、Route Handler 與 Server Action。
- `src/app/app/layout.tsx`、`workspace-shell.tsx` 與 `workspace-navigation.tsx`：正式登入後共用操作
  殼層；只承擔導覽、功能搜尋及最小角色範圍 DTO，實際頁面與所有寫入仍自行重新授權。
- `src/app/app/live-queue.tsx`、`laundry-order-flow-3d.tsx`、`scan-stage.tsx`、`use-qr-fragment.ts`：正式佇列、
  洗衣單流程動畫與掃碼 UI。流程動畫圖片位於 `public/images/laundry-flow/`，只讀既有 server snapshot DTO，不在 client 直接查 Supabase。
  fragment token 進入後立即清除；空 hash 不可立刻判無效。
- `src/app/app/workspace-live.tsx`：角色 KPI 與即時佇列；主管版的 `SupervisorCommandRoom` 只由
  `WorkspaceSnapshot` 衍生戰情室 KPI／雷達／優先佇列，新增指標時先確認 snapshot DTO 與 RLS scope，
  不在 client 直接查 Supabase。
- `src/app/app/module-tabs.tsx`：正式多區塊模組的工作意圖頁籤。管理主檔、設定與控制中心共用此元件，
  保留 ARIA tab 語意、方向鍵／Home／End、`#tab=` 深連結與分模組本機記憶；實體掃碼控制點維持線性頁面。
- `src/app/app/style-switcher.tsx`：登入後共用殼層的純視覺風格切換器，選項為 `MX`／`AP`／`GS`／`MB`／`SH`，
  預設 `MX`，以 `wash-room-workspace-style` 保存。主題 CSS 位於 `workspace-shell.module.css` 與
  `workspace.module.css`；`GS` 使用 client-only GSAP 過場，不能把風格 state 或 GSAP 帶入資料／授權層。
- `src/app/app/history-results.tsx` 與 `src/app/api/app/laundry-orders/[orderId]/history/route.ts`：已取件洗衣單
  單號歷程彈窗與唯讀 API；維持 server-only DAL、受控 RPC、角色／scope 重新授權，不在 browser 直接查 Supabase。
- `src/app/app/admin/bi/` 與 `src/lib/analytics/bi-models.ts`：BI 模型庫、保存 Action、執行結果、報表匯出、
  規則式／可選 AI 摘要與白名單 parser。新增模型必須同時更新模型定義、受控 RPC／migration、結果 DTO、unit test 與 database contract test；
  禁止任意 SQL、browser-direct read 或未經 scope 的聚合。
- `src/app/app/admin/accounts/`、`src/lib/auth/account-management*.ts` 與 `src/lib/supabase/admin.ts`：
  帳號與權限生命週期 UI、DTO／驗證與 server-only Auth Admin 邊界；新增、編輯、密碼、刪除與批次權限
  均集中於此模組。Auth 身分變更與使用操作者 JWT 的
  scope RPC 必須維持補償順序；瀏覽器不可直接呼叫 Auth Admin。
- `src/lib/`：server-only DAL 與領域邊界；頁面與 Action 保持薄層，授權與輸入驗證在每次
  server 入口重新執行。`analytics/workspace.ts` 可讀佇列／批次／設備，不可在此做寫入。
- `supabase/migrations/`：正式 schema、RPC、RLS、grant 與不可變稽核的唯一來源。
  `20260822140000_group_bi_view_results.sql` 是目前 BI 分組結果的 migration；修改資料庫前先讀它與
  `tests/database/ticket-13-28-behavior.spec.ts` 的 T19 證據。
- `tests/database/`：使用 PGlite 執行真實 migration，作為資料庫安全與交易合約的主要證據。
- `tests/e2e/`：公開與 configured UI 合約；`tests/support/fake-supabase-server.mjs` 只證明
  瀏覽器整合，不可取代 migration／RLS 安全測試。
- `prototype.html`：可直接雙擊、完全記憶體內的互動原型；`src/app/prototype/`：需啟動
  Next.js 的原型頁。正式功能與目前交付狀態請以 `README.md`、Issue、migration 與測試判定。

## 領域與安全不變量

- 使用 `CONTEXT.md` 的正式用語：作業據點、送洗機構、洗衣車、洗衣單、洗滌批次、待收件、
  待取件與已取件。
- 洗衣車與設備 QR 是固定資產憑證。raw bearer token 放在 URL fragment，進入頁面後立即清除，
  只透過受控 POST body 傳送；不得輸出到 HTML、query/path、檔名、稽核或測試觀察值。
- 已認證的瀏覽器與 Vercel 路徑沿用使用者 JWT，最後權限邊界是 Supabase RLS；匿名送單／取件
  只能使用受限 anon RPC 與當次固定 QR credential。service-role 只用於明確記載的一次性
  bootstrap、內部解析或帳號 Auth 身分管理，且只存在 server-only client；profile／membership
  mutation 仍使用操作者 JWT，不讓 service-role 繞過 scope。
- 登入名稱保存輸入大小寫且登入時精確比對，唯一性則使用 `lower(login_name)`；內部 Auth Email
  固定小寫。安全刪除先原子停用 profile 與全部 membership、保留 tombstone／歷史／稽核，再刪除
  Auth 身分；目前帳號及任一據點最後一位主管維持不可刪除。
- 已認證高風險寫入使用具 scope、冪等與原子性的 RPC，並由 `auth.uid()` 驗證；匿名控制點使用
  明確列出的窄 RPC、QR credential、rate limit 與冪等。直接資料表 DML 權限維持撤銷，
  `SECURITY DEFINER` 函式維持空 `search_path`。
- 誤建設備只透過 `delete_unused_laundry_equipment` 刪除：資料庫鎖定後確認名稱、據點權限與零作業引用，
  並保存刪除快照稽核；已有紀錄的設備改為停用。禁止用 Table Editor 或臨時 SQL 繞過此 gate。
- 洗衣單保存建立當下的機構與作業據點 snapshot；機構日後改配不得改寫歷史範圍。
- 預估進度與實際狀態分開保存。計時達 100% 不代表完成、裝車或取件；實體設備階段由洗衣員
  掃碼／確認；同一台設備第一次開始、第二次結束。最後一個設備階段完成後，
  該單所有必要批次完成才進入待取件。
- 一般送洗人員免登入且只能執行當下允許的送單或取件；系統不保存住民或病患識別資料。
- 多區塊管理頁以工作意圖分頁；共享警語與範圍資訊放在頁籤外。新增區塊時同步更新
  `tests/e2e/configured-module-tabs.spec.ts`；掃碼程序的順序由領域狀態機控制，不提供跳階段頁籤。

## Prototype 修改規則

- Prototype 只回答 UI／流程設計問題，狀態保留在記憶體，且醒目標示為本機模擬。
- A／B／C／D 版型必須維持結構差異；切換器與 `?variant=` 參數保持可用。
- 互動狀態必須遵循正式領域規則，尤其是固定 QR、角色 scope、多批次、設備占用、裝車與取件。
- Prototype 新增或移除可見能力時，同步更新 `README.md` 的「獨立 HTML prototype」。
- 將已驗證設計移入正式功能時，以正式 DAL／RPC／RLS 重新實作，不直接把 prototype mutation
  接上 Supabase。

## 完成檢查

- 一般程式變更至少通過 `npm run lint`、`npm run typecheck`、`npm test` 與 `npm run build`。
- 瀏覽器流程變更另跑 `npm run test:e2e`；涉及已設定 Supabase 邊界、角色或控制點時再跑
  `npm run test:e2e:configured`。
- 效能變更先以可失敗的 focused probe／Playwright 測試建立 red baseline；再以相同環境重測 request
  budget 與 p50／p95。部署或 region 變更必須另量正式 alias，不能拿本機 fake 結果代替 hosted 成績。
- Migration／RPC／RLS 變更以 `npm run test:db` 的真實 migration 測試證明授權、rollback、
  冪等與跨 scope 行為。
- 僅修改文件時毋須重跑無關的 build／E2E，但必須逐一覆核連結、命令、目前
  `HEAD`／部署／測試敘述；無法重現的數字標示「未覆核」，不要複製成新的基線。
- 交付前執行 `git diff --check`，並確認沒有除錯輸出、敏感資料、測試產物或非本次範圍變更。
- 專案擁有者已授權：完成本節檢查後，在同一回合提交本次範圍變更並推送至 `origin/main`；推送前
  覆核工作樹、目前分支與 upstream，若當次使用者明確要求保留本機或不推送，則以當次要求為準。

## Agent skills

### Issue tracker
This repository uses GitHub Issues. Read `docs/agents/issue-tracker.md` before creating or updating issues.

### Triage labels
Use the shared triage-label vocabulary documented in `docs/agents/triage-labels.md`.

### Domain documentation
This is a single-context laundry-management repository. Read `CONTEXT.md`, `docs/requirements.md`, and relevant ADRs under `docs/adr/` before making changes. See `docs/agents/domain.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
