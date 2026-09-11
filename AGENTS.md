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

- 接手前先讀 `README.md` 的「2026-08-31 最新接手快照」、「2026-08-28 沉浸式洗衣流程與已取件詳情切片（歷史）」、「2026-08-22 戰情室、BI 與交付快照（歷史）」、「2026-08-18 正式環境與接手快照」及「效能與操作體驗診斷」。
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

## 2026-08-31 最新接手快照

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
