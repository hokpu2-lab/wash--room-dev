# 洗衣管理系統（wash-room）

供兩個作業據點使用的內部洗衣管理系統。系統取代從匿名送車、洗衣處理、
到匿名取件的紙本流程，並以洗衣車、設備與控制點 QR Code 串聯完整作業歷程。

## 技術架構

- Next.js 與 TypeScript
- Supabase Postgres、Auth 與 Row Level Security（RLS）
- GitHub 串接 Vercel 部署
- Playwright 公開介面驗收測試

## 2026-09-12 最新接手快照

本節是目前接手的第一個入口。先執行 `git status --short --branch`、`git log -5 --oneline`，再閱讀
`AGENTS.md`、`CONTEXT.md`、`docs/requirements.md`、`docs/system-guide/` 及本次修改相關的 ADR；本節的 commit、測試與部署
資訊仍須以實際環境重新覆核。

- **操作控制台設備據點解析與快取清除機制**：
  - **根本原因排查**：跨作業據點（清福本館 MAIN vs 清福法人 CORP）的設備 QR 快取殘留在 `sessionStorage` 時，後端 `private.start_batch_stage_from_equipment` 嚴格阻擋跨據點混洗（`equipment.operating_site_id <> batch.operating_site_id`）觸發 `equipment_scope_denied`。然而前台控制台未顯示載入設備所屬據點、無重設清除按鈕，且選單未過濾批次據點，導致操作者深陷錯誤快取死循環。
  - **設備與據點資訊解析**：在 `src/lib/laundry-equipment/dispatch.ts` 擴充 `dispatchEquipmentQr`，查詢並回傳 `equipmentName`、`operatingSiteId`、`operatingSiteName` 與 `operatingSiteCode`。
  - **批次標籤與選單優化**：在 `src/app/app/operations/batch-label.ts` 與 `load-site-batches.ts` 加入據點欄位，`formatBatchLabel` 呈現據點名稱（如 `(清福本館)`），`use-live-batches.ts` 同步支援據點資訊。
  - **快取清理與跨據點防呆**：在 `use-qr-fragment.ts` 引入 `clear` 函式；於清洗（`washing/start-control.tsx`）、烘乾（`drying/control.tsx`）與消毒（`disinfection/control.tsx`）控制台加入「已載入設備卡片」與「🔄 清除此設備快取 / 重新掃描」按鈕。
  - **智慧過濾與警告防呆**：依設備據點優先篩選同據點批次；若偵測到跨據點批次，呈現醒目紅色警示並鎖定按鈕。若送出後 API 回傳 `equipment_scope_denied` 或 `invalid_qr`，前端自動清除快取並引導重新掃碼。
- **測試與建置覆核**（2026-09-12）：
  - `npm test`：28 個測試檔、100 個 tests 全數通過（新增 `tests/unit/operations-control.spec.ts`）。
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

- 2026-08-28 清福品牌化流程切片參考[清福長照集團官網](https://group.hok.com.tw/)的白色留白、珊瑚紅、玫瑰粉、暖沙色、
  `Noto Sans TC` 導向字體與 0.4–0.5 秒柔和轉場，放大 3D 角色／設備、目前狀態卡、選取摘要與文字節點；窄側欄依容器寬度改為
  兩欄 3D 路線、堆疊標題與分列控制，手機文字節點改為單欄。選取焦點環、洗衣車標記與節點縮放改在同一個 Three.js 場景內補間，
  並以流程內容簽章避免即時快照只更換陣列參照時反覆卸載場景。此切片只修改 client UI、CSS 與 configured E2E，無 SQL、migration、
  RPC、RLS、資料模型或狀態機變更。
- 2026-08-28 流程時間軸切片將洗衣單詳情補上建立、收單、待取件與結案時間，並沿用設備階段的實際
  `started_at`／`completed_at`；  `laundry-order-flow-3d.tsx` 改為「3D 路線＋垂直時間軸」，每個節點顯示日期時間、實際耗時、
  進行中的即時計時與程序標準分鐘，缺少事件時間時明確標示待補，不以估計值冒充實際紀錄。
  完整節點與實際耗時改由 `LIVE PROCESS MAP` 顯示：滑過 3D 節點或選取後，地圖卡與焦點狀態卡帶出日期時間與實際耗時；
  已移除獨立的 `ACTUAL TIMELINE`／「完整節點與實際耗時」區塊。
  3D 路線改為賽博龐克霓虹連接線（只連圖示之間、不貫穿節點），圖示放大並加描邊，hover 資訊卡會避開當前圖示並半透明。
  reduced-motion／WebGL fallback 改用地圖上的文字節點。時間資料由
  `20260828100000_add_workspace_order_timing.sql` 的受控 `get_workspace_order_detail()` 回傳，維持既有 authenticated scope，
  不開放 browser-direct Supabase read；migration 已通過本機真實 migration／RLS 合約並套用 linked hosted Supabase。
- [`c5553c3`](https://github.com/Kevin72333/wash-room/commit/c5553c3c9c17532f395a7c85cd536e21108330a3)
  的沉浸式流程切片把正式工作台與已取件彈窗改為「三大作業區＋全景 3D 主舞台＋焦點狀態卡＋完整實際時間軸」；
  照護交接、專業洗滌與安心送回可直接點選，Three.js 路線加入立體管線、完成路徑、當前信標、環境粒子與同場景焦點位移，
  並放寬 dashboard 選取詳情及歷程彈窗。五張原本帶棋盤格的角色／設備 WebP 已建立真正透明的 `*-clean.webp` 版本，
  手機仍以三幕總覽與單欄節點保持可讀。此切片只改 client UI、CSS、靜態素材與 configured E2E，無 SQL、migration、RPC、RLS、
  DTO 或狀態機變更；動畫仍遵守 reduced-motion，實際狀態只由既有掃碼與稽核資料決定。
- 本次功能提交為 `49f604c feat: add picked-up order history search` 與
  `68fabdf feat: add picked-up order history details`；migration
  `20260827140000_add_laundry_order_history_search.sql` 已通過本機真實 migration／RLS 合約並套用 linked
  hosted Supabase；新增的 `20260827160000_add_laundry_order_history_detail.sql` 也已套用，遠端確認
  `authenticated` 可執行、`anon` 與 `service_role` 不可執行。
- 本次時間軸併入地圖卡驗證（2026-08-28，`37e0269`）：lint 通過但保留 `use-workspace-live.ts` 與 `workspace-navigation.tsx` 的 2 個既有
  Hook warnings、typecheck 通過、`npm test` 25 檔／91 tests、build 通過、公開 E2E 4/4、流程主舞台 focused configured E2E 2/2。
  未重跑完整 configured 56／56，亦未把 `c5553c3` 的 GitHub Actions run `33134503339` 當成此次證據。
- 沉浸式流程切片歷史驗證（2026-08-28，`c5553c3`）：lint 通過但保留 2 個既有 Hook warnings、typecheck 通過、`npm test` 25 檔／91 tests、build 通過、公開 E2E 4/4、configured
  E2E 56/56、流程主舞台 focused E2E 2/2；另以本機 configured 資料完成桌面工作台、寬版已取件歷程彈窗與 390px 手機版的
  三大作業區、透明素材、日期／耗時及節點互動視覺覆核。
  GitHub Actions [run 33134503339](https://github.com/Kevin72333/wash-room/actions/runs/33134503339) 只證明到
  `c5553c3`。
  Production alias `/status` smoke 通過；目前程式實際引用的六張素材
  `laundry-worker.webp`、`sending-staff-clean.webp`、`laundry-cart-clean.webp`、
  `disinfection-tank-clean.webp`、`washer-clean.webp`、`dryer-clean.webp` 正式網址均回 HTTP 200 與 `image/webp`，舊版非 clean
  素材仍留在 repository 但不再由流程執行時引用。前次 `/login` 為 HTTP 200，
  未登入 `/app/history` 為 HTTP 307 導向 `/login`，回應的
  `X-Vercel-Id` 顯示 `hkg1::sin1`；正式登入後查詢流程仍須由正式帳號驗收，fake Supabase E2E 不取代正式驗收。

下一位 agent 若要續改洗衣流程，先讀 `src/app/app/laundry-order-flow-3d.tsx` 的 `flowVisualSources`、三大作業區、`LIVE PROCESS MAP` 與場景生命週期，
  再讀 `src/app/app/workspace.module.css` 的 `flowCanvasStage`／`flowMapTimeline` 容器查詢及 `tests/e2e/configured-auth.spec.ts` 的流程主舞台案例；
  保留透明素材、鍵盤操作、reduced-motion、WebGL fallback、DTO 狀態推導與實際／預估分離。若要延伸共用登入殼層，再讀
`style-switcher.tsx` 與 `workspace-shell.module.css`。完成後依 `AGENTS.md` 的完成檢查同步更新本節；若修改資料庫或權限，另外讀
相關 migration、`tests/database/`、`docs/adr/0013-delete-unused-laundry-equipment.md`、
`docs/adr/0014-managed-account-lifecycle.md` 及 `docs/adr/ADR-012-production-readiness.md`。

## 2026-08-18 正式環境與接手快照

接手時先執行 `git status --short` 與 `git log -1 --oneline`，以實際工作樹及最新提交為準，
不要把本段 2026-08-18 的歷史雜湊、測試數量或部署描述視為永遠不變的版本號；最新交付狀態見上方
「2026-08-28 最新接手快照」。

2026-08-18 當時 repository 與 `origin/main` 的同步 `HEAD` 為
[`293a748`](https://github.com/Kevin72333/wash-room/commit/293a7480cea8b4e8cf5b16a50245c09575e81b48)，
正式功能程式基線是其父提交
[`a4b365f`](https://github.com/Kevin72333/wash-room/commit/a4b365fa030d06a6336ff240c53aaa07e5286ec7)。
公開正式 alias 的 canonical origin 是 `https://wash-room.vercel.app`；可從
[正式登入頁](https://wash-room.vercel.app/login) 或 [系統狀態頁](https://wash-room.vercel.app/status)
進入；root `/` 在該歷史快照當時尚沒有頁面。`293a748` 已有成功的 Production deployment；不可變 deployment URL
受 Vercel Deployment Protection 保護，公開 smoke、`NEXT_PUBLIC_APP_URL` 與固定 QR 應使用穩定 alias。

Hosted Supabase 位於 `ap-southeast-1`（新加坡）；2026-08-18 當時本機與 hosted 已知共有 22 筆 migration。
登入方式是管理者建立的帳號密碼，不使用 Google OAuth；`admin` 只是一般
`laundry_supervisor` membership，不是資料庫超級使用者。

目前正式介面基線如下：

- 主管 `/app/admin` 是只讀的即時營運總覽，使用戰情室呈現風險、主管介入、流程與設備雷達；主管
  `/app/dashboard` 才承擔「洗衣單與批次」作業佇列、搜尋／分頁、選取詳情與目前洗滌批次。
  兩者都使用 RLS `select` 的 `WorkspaceSnapshot`（`src/app/app/workspace-live.tsx`、
  `src/app/app/live-queue.tsx`、`src/lib/analytics/workspace.ts`）；機構主管佇列為唯讀，
  不連到洗衣員控制點。
- 收單、清洗、消毒與烘乾改成原型 C 風格的掃碼工作台（`scan-stage.tsx`）；裝車保留為可選控制點，不是預設待取件前置步驟。
  QR fragment 由 `use-qr-fragment.ts` 讀取後立即清除；空 hash 不可立刻當成無效，
  以免串流重掛丟掉 token。raw bearer 仍只走 POST body。
- 批次控制中心改選授權範圍內的現有批次，不再要求操作者手填 UUID；本機最新切片另提供
  「還原上一步」，可補償誤開始、誤完成與誤裝車，並保留原紀錄、更正原因、冪等結果與稽核事件。
  對應 migration 為 `20260821100000_create_worker_operation_reversal.sql`；套用至 hosted 並完成
  正式瀏覽器驗證前，不得宣稱正式環境已可使用。
- 頁面改為同步殼層先畫（標題、hero、快捷入口），KPI／佇列／授權表用 `Suspense`
  補上。`src/proxy.ts` 在非 root 且 JWT `expires_at` 仍有效時略過 `getClaims()`；root 必須先驗證
  claims 才導向工作台，損壞 session 顯示公開 landing。過期 cookie 仍須刷新（`/status` 的
  session refresh 合約不可拿掉）。
- 頁內重複登出與多餘「返回工作台」連結已移除；登出只留在頂部列。
- `prototype.html` 仍是完全記憶體內的設計原型；正式資料不得直接接上 prototype mutation。
- 正式架構可以依下方四方案評估演進。已認證路徑必須保留使用者 JWT 與資料庫 scope 檢查；
  匿名送單／取件必須保留固定 QR credential、受限 anon RPC、rate limit 與冪等。兩者都不能繞過
  原子交易、RLS／函式授權及不可變稽核；純靜態殼層不能被誤當成無後端系統。

最後已知完整驗證結果（2026-08-18，不沿用為之後變更的證據）：

- `npm run lint`：通過。
- `npm run typecheck`：通過。
- `npm test`：15 個測試檔、59 個測試通過，包含真實 migration 的 RLS、rollback、冪等、跨 scope 與 workspace snapshot 合約。
- `npm run build`：通過；所有 `/app` 路由皆為 request-time dynamic route。
- `npm run test:e2e`：3/3 通過（含 root `/` 輕量入口）。
- `npm run test:e2e:configured`：41/41 通過（含主管首頁無意圖 prefetch 為 0）。
- [GitHub Actions run 32112124142](https://github.com/Kevin72333/wash-room/actions/runs/32112124142)
  只證明到 `293a748`；本切片必須重新跑 Actions，不能沿用該 run。

### 2026-08-21 本機逆流程切片驗證

「還原上一步」已由 commit `af62779` 推送 `origin/main`，但 hosted migration、Vercel 部署與新的
GitHub Actions 證據仍須另行覆核。該切片本機結果為：`npm run lint` 通過（保留 2 個既有 Hook 警告）、`npm run typecheck`
通過、`npm test` 與 `npm run test:db` 均為 19 個測試檔／72 個測試通過、`npm run build` 通過、
`npm run test:e2e` 4/4 通過、`npm run test:e2e:configured` 46/46 通過。正式上線前仍須在 hosted 套用
`20260821100000_create_worker_operation_reversal.sql`，並以正式帳號、實際批次和設備重跑控制中心流程。

### 2026-08-21 首頁 session／PWA 修正

Root `/` 對沒有 session cookie 的請求仍直接輸出輕量 landing；有 cookie 時，proxy 必須先取得有效
claims 才能導向 `/app`。損壞或無法刷新的 session 不再把首頁錯誤導向受保護工作區。由於 root 回應
依當次 cookie 決定，`public/sw.js` 不再 cache-first 攔截 `/`，只保留登入頁、離線頁、manifest 與圖示等
非敏感殼層。證據為 configured E2E 的損壞／有效 session 分支與 `tests/unit/pwa-service-worker.spec.ts`。
本機驗證結果：lint 通過（2 個既有 Hook 警告）、typecheck 通過、`npm test` 20 個測試檔／73 個測試
通過、production build 通過、公開 E2E 4/4、configured E2E 48/48。
修正 commit `9d1ef43` 推送後，正式 alias 已覆核 `wash-room-shell-v4` 且 root 不在 shell cache；以損壞
session cookie 首次開啟及 service worker 接管後重載 `/`，兩次皆為 HTTP 200 並顯示公開首頁。

### 2026-08-21 未使用設備刪除切片

洗衣主管的 `/app/admin/laundry-equipment` 新增「刪除誤建設備」。操作者必須再次輸入設備名稱、
勾選不可復原確認並填寫原因；`delete_unused_laundry_equipment` RPC 會鎖定設備並在同一交易檢查
設備占用、洗滌階段、排程及控制點請求。只有從未參與送洗作業的設備會連同未使用 QR 憑證刪除，
原 QR 隨即失效；建立與刪除的設備快照稽核永久保留。已有任何作業紀錄時只允許停用。

對應 migration 為 `20260821110000_delete_unused_laundry_equipment.sql`。本機 migration 合約涵蓋
成功刪除、QR 失效、稽核保留及已有階段紀錄時原子拒絕；configured Playwright 另從主管頁完成
名稱確認與刪除流程。本機驗證結果：lint 通過（2 個既有 Hook 警告）、typecheck 通過、`npm test`
20 個測試檔／74 個測試通過、`npm run test:db` 19 個測試檔／73 個測試通過、production build 通過、
公開 E2E 4/4、configured E2E 48/48。Hosted Supabase 套用 migration 並重新部署前，正式 alias 尚無此能力。

### 2026-08-21 正式模組標籤頁

正式登入後介面新增共用 `src/app/app/module-tabs.tsx`，依工作意圖整理多區塊頁面，不變更既有
DAL、Action、RPC、RLS 或交易邊界。頁籤可用滑鼠、觸控、方向鍵、Home／End 操作，使用
`role="tablist"`／`tab`／`tabpanel` 表達語意；目前選擇會寫入 `#tab=` 並以分模組
`localStorage` 記憶，重新整理或分享含 fragment 的網址仍可回到指定區塊。小螢幕改為橫向捲動，
且遵守 reduced-motion 設定。

已分類的正式模組如下：

- 主管首頁：即時營運、快速控制；帳號、角色與資料範圍集中在帳號管理模組。
- 洗衣員首頁：目前作業、作業控制點；預設目前作業。
- 批次控制中心：目前批次、還原上一步、批次操作、異常與重排。
- 送洗機構：新增機構、機構清單、修改機構；作業據點範圍與歷史配對警語保留在頁籤外。
- 洗衣車：登錄洗衣車、洗衣車清單。洗衣設備：新增、修改、刪除誤建、設備清單。
- 分類與程序、通知設定、舊單匯入及分析與 BI，依各自建立／清單或步驟分組；BI 內建流程健康度、分類工作量、據點產能與取件準備度樣本模型，結果仍走白名單與授權範圍。

收單、消毒浸泡、清洗、烘乾及取件屬於實體狀態機控制點，刻意維持單一路徑，避免頁籤讓
操作者誤以為可跳過順序。營運儀表板維持單一內容；報表與匯出、分析摘要與建議則整合在
「分析與 BI」的工作意圖頁籤內，避免同一份分析流程分散到不同主管入口。
瀏覽器合約集中於 `tests/e2e/configured-module-tabs.spec.ts`，並由原有帳號、機構、洗衣車、設備與
程序端到端流程驗證切換後仍可完成正式操作。

本機驗證結果：lint 通過（保留 2 個既有 Hook 警告）、typecheck 通過、`npm test` 20 個測試檔／
74 個測試通過、production build 通過、公開 E2E 4/4、configured E2E 50/50。此切片沒有新增
migration；正式 alias 是否已部署此介面仍須以本次 push 後的 Vercel deployment 覆核。

### 2026-08-21 完整帳號管理切片

洗衣主管可從 `/app/admin/accounts` 以「帳號清單／新增帳號／編輯帳號／密碼管理／刪除帳號／批次權限」
六個工作頁籤管理正式帳號。新增會在同一個受控流程建立 Supabase Auth 身分、帳號 profile、通知
Email 與一到多筆角色範圍；編輯可修改顯示名稱、通知 Email、啟用狀態及完整權限集合；批次權限
可用固定欄位 CSV 維護既有且已綁定的帳號，不會建立未綁定 profile；密碼管理
會設定符合強度規則的一次性暫時密碼，並強制本人下次登入修改。帳號不以破壞歷史資料的方式硬刪除：
「刪除帳號」會撤銷 Auth 身分、停用全部 membership，並保留 tombstone、洗衣紀錄與不可變稽核。
目前登入帳號及任一據點最後一位有效洗衣主管都不能被此流程停用或刪除。

登入帳號保存操作者輸入的大小寫，例如建立 `WorkerABC` 就會原樣顯示，且登入時必須輸入完全相同
的大小寫；為避免視覺混淆，唯一性仍不分大小寫，因此不能再建立 `workerabc`。Supabase Auth 內部
Email 則固定使用小寫 `workerabc@auth.wash-room.invalid`，只作技術識別，通知 Email 另存。

對應 migration 是 `20260821120000_manage_user_accounts.sql` 與
`20260822150000_consolidate_managed_account_permissions.sql`，決策與補償順序見
`docs/adr/0014-managed-account-lifecycle.md`。Auth Admin API 只由 Server Action 使用
`SUPABASE_SERVICE_ROLE_KEY`；瀏覽器 bundle、公開環境變數、HTML、日誌及 RPC payload 都不能取得
該 secret。Hosted 套用 migration、Vercel 設定 secret 並重新部署前，正式 alias 沒有此能力。
本機最終 Gate：lint 通過（保留 2 個既有 Hook 警告）、typecheck 通過、`npm test` 21 個測試檔／
78 個測試通過、`npm run test:db` 20 個資料庫測試檔／77 個測試通過、production build 通過、
公開 E2E 4/4、configured E2E 53/53。這些是本機 migration／fake Supabase 證據，不能取代 hosted
migration、正式 Auth Admin、Vercel secret 與正式瀏覽器驗收。

### 2026-08-22 帳號管理模組整合

帳號、資料、角色範圍、批次權限、暫時密碼與安全刪除現在集中於 `/app/admin/accounts`；主管首頁
只保留即時營運與快速控制。批次權限使用固定欄位 CSV，資料庫入口
`apply_managed_account_permission_changes` 只接受已由帳號生命週期建立且已綁定 Auth 的帳號，
並保留操作者範圍、冪等鍵與既有原子授權檢查，不再提供會產生未綁定 profile 的舊主管首頁入口。

本次新增 `20260822150000_consolidate_managed_account_permissions.sql`；本機 migration 合約
已通過，migration 尚未在本次工作階段覆核 hosted 套用狀態。當前本機證據為 `npm run lint`（2 個
既有 Hook warnings）、`npm run typecheck`、`npm test` 22 個測試檔／82 個測試通過、
`npm run test:db` 20 個資料庫測試檔／79 個測試通過、`npm run build`、公開 E2E 4/4、
configured E2E 54/54 與 `git diff --check` 通過。

### 2026-08-22 戰情室、BI 與交付快照（歷史）

本節是 2026-08-22 的歷史交付依據；目前交接請優先使用上方「2026-08-28 最新接手快照」，
仍須以實際 `git status --short`、`git log -1 --oneline`、hosted migration 與本次測試輸出覆核。

- 戰情室與 BI 切片提交為 [`649d9e2`](https://github.com/Kevin72333/wash-room/commit/649d9e2a2449acad95d818457cd1d39c45513716)，已推送至 `origin/main`；帳號管理模組整合為其後續變更，接手時仍須以實際 `HEAD` 覆核。
- 主管 `/app/admin` 使用 `WorkspaceLive` 的 `command` 模式與 `SupervisorCommandRoom`：
  `COMMAND ROOM / LIVE` 資料狀態、未結案／處理中／需介入／待取件 KPI、優先佇列、流程雷達與設備雷達。
  `/app/dashboard` 使用 `queue` 模式，專注洗衣單搜尋／分頁、選取詳情與目前洗滌批次；不再重複渲染戰情室。
  所有數字仍來自授權範圍的 `WorkspaceSnapshot`；沒有新增 browser-direct Supabase read 或繞過 RLS 的資料源。
- `分析與 BI` 的樣本模型定義在 `src/lib/analytics/bi-models.ts`，目前提供「流程健康度」、
  「分類工作量」、「據點產能比較」、「取件準備度」四個模型。`src/app/app/admin/bi/page.tsx`
  另提供營運戰情、分類產能、據點比較與取件準備四種靜態報表版面範例；支援模型庫、一鍵保存、
  我的分析、報表與匯出、摘要與建議及分組結果表；舊 `/app/admin/exports` 與 `/app/admin/ai`
  入口保留相容導向。`actions.ts` 仍走既有受控 RPC。模型只能使用
  `status`／`category`／`operating_site` 維度及 `order_count`／`batch_count`／`completed_count` 指標，
  不接受任意 SQL，結果受擁有者／分享設定與據點 scope 約束。
- `supabase/migrations/20260822140000_group_bi_view_results.sql` 已套用至 linked hosted Supabase，
  取代 `run_laundry_bi_view(uuid)` 的總計結果為受控分組 rows；本機與 hosted migration 清單目前均為
  40 筆且最新 migration 一致。修改 BI 維度、指標或結果格式時，需同步更新此 migration、
  `src/lib/analytics/bi-models.ts`、頁面與資料庫合約測試。
- 本次證據：`npm run lint` 通過（保留 `use-workspace-live.ts` 與 `workspace-navigation.tsx` 的 2 個既有 Hook warnings）、
  `npm run typecheck` 通過、`npm test` 為 22 個測試檔／81 個測試通過、`npm run build` 通過、
  `npm run test:e2e` 4/4、`npm run test:e2e:configured` 57/57；BI focused database tests 4/4、
  BI unit／contract tests 3/3。`git diff --check` 通過。
- 2026-08-22 對 `https://wash-room.vercel.app/` 與 `/login` 的唯讀檢查均為 HTTP 200；`/login` 的
  `X-Vercel-Id` 顯示 `hkg1::sin1`，但若要宣稱新版本已完成 Vercel Production deployment，仍應
  以 Vercel deployment 記錄與正式登入後頁面再次覆核。固定 QR 的 origin 仍只能使用 canonical alias。

### 2026-08-22 風格切換與視覺主題快照（歷史）

- 正式登入後共用殼層右上提供 `MX`／`AP`／`GS`／`MB`／`SH` 下拉切換，預設為 `MX`；選擇保存於本機，
  重新整理後仍維持選擇，且不改變 DAL、Action、RPC、RLS 或任何資料權限邊界。
- `MX` 保留現行營運綠色介面；`AP` 依 [Apple Design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md)
  採半透明材質、空間一致性、reduced-motion／reduced-transparency；`GS` 依
  [GSAP skills](https://github.com/greensock/gsap-skills) 採深色 kinetic control-room，切換過場使用
  GSAP transform／opacity 並支援清理與 reduced-motion；`MB` 依
  [mblode UI design skill](https://github.com/mblode/agent-skills/blob/main/skills/ui-design/SKILL.md)
  採資訊密度、安靜 chrome、編輯式字體階層與響應式可及性狀態；`SH` 依
  [shadcn/ui](https://github.com/shadcn-ui/ui) 與 [theming tokens](https://ui.shadcn.com/docs/theming)
  採 open-code／composition 語言、中性灰階、`background`／`foreground`／`card`／`primary`／`muted`／
  `accent`／`border`／`input`／`ring` 語意 token、低圓角與一致 focus ring。
- 本次實際驗證：`npm run lint` 通過（保留 2 個既有 Hook warnings）、`npm run typecheck` 通過、
  `npm test` 為 22 個測試檔／83 個測試通過、`npm run build` 通過、公開 E2E 4/4、configured E2E 55/55，
  並通過 `git diff --check`。configured E2E 新增右上風格切換與本機保存案例。

接手本切片後，先閱讀 `AGENTS.md`、`CONTEXT.md`、`docs/requirements.md` 與相關 ADR，再從
`src/app/app/workspace-live.tsx`、`src/app/app/admin/bi/page.tsx`、`src/lib/analytics/bi-models.ts`、
`supabase/migrations/20260822140000_group_bi_view_results.sql` 及對應測試開始。不要把戰情室的
衍生 KPI 當成新的資料表，也不要把 BI 模型改成任意查詢；任何新增維度／指標都必須保留白名單、
RLS scope、冪等與 migration／rollback 證據。

### 已確認的高優先缺口

GitHub Issues #1–#28 雖已關閉，Issue 狀態不能取代 Acceptance Criteria 與行為測試。

1. P0 跨機構 RLS 已在 PGlite 修正：`has_site_access()` 只承認洗衣員／洗衣主管據點 membership；
   送洗機構主管改走 `has_institution_supervisor_access()`。證據：
   `tests/database/cross-institution-rls.spec.ts`。正式 hosted 必須套用
   `20260818230000_fix_cross_institution_rls.sql` 後才算上線。在此之前仍不得新增
   browser-direct read、Realtime 或完整 SPA。
2. T16 異常 named arguments 與 critical `severity` 已有 PGlite 證據；正式 hosted 須套用
   `20260818240000_fix_incident_load_and_dispatch.sql`。
3. T14 合批後裝車已改為依來源車各自掃描；證據見 `laundry-incident-and-merge-load.spec.ts`。
4. `/scan/equipment` 已是設備固定 QR dispatcher；洗衣車 QR 在已登入洗衣員時依現況導向收單，待取件時則導向送洗人員取件；可選裝車不作為預設結束流程。
   configured E2E 從 `/scan/equipment#v1.equipment.<正式 token>` 進入清洗控制點。
5. T15–T27 已補資料庫行為／scope／冪等合約（`ticket-13-28-behavior.spec.ts`）。瀏覽器全流程與
   T28 真實營運負載仍須另補。
6. Root `/` 已有輕量入口（未登入顯示登入 CTA；已登入依角色導向工作台）。`/status` 仍是健康檢查頁。
   2026-08-22 對正式 alias root 的唯讀檢查為 HTTP 200；後續每次部署仍須重新覆核 root 與 `/status`。

## 2026-08-18 效能與操作體驗診斷

本節是目前可重現的基線，不是修正後成績。正式回應標頭顯示請求先抵達香港 edge，但動態
Next.js Function 實際執行於美國華盛頓 `iad1`；Supabase 則在新加坡。現有受保護頁面的主要路徑為：

```text
台灣瀏覽器 → 香港 Vercel Edge → 美國 iad1 Function
            → 新加坡 Supabase → 美國 Function → 香港 Edge → 瀏覽器
```

唯讀 curl 暖機樣本的 TTFB 中位數：

| 路徑 | 類型 | TTFB 中位數 |
| --- | --- | ---: |
| `/status` | 靜態 CDN | 約 147 ms |
| `/login` | 動態 Function | 約 376 ms |
| `/scan/cart` | 強制動態 Function | 約 374 ms |
| `/scan/pickup` | 強制動態 Function | 約 390 ms |
| `/prototype` | 強制動態 Function | 約 387 ms |

這輪初步 curl 診斷未保存每個路徑的完整樣本數與 p95，因此只能用來定位跨區根因，不能當成
優化完成證據。下一輪正式量測必須把 commit、region、樣本數、冷／暖條件、p50 與 p95 一起保存。

### 2026-08-18 production p50／p95（方案 A 後）

從本機對 canonical alias `https://wash-room.vercel.app` 做唯讀 curl。倉庫 `HEAD` 為 `6d38c16`；
回應 `X-Vercel-Id` 為 `hkg1::sin1::…`，compute 已在新加坡。每條路徑 11 次（第 1 次當冷樣本，
後 10 次暖機）。TTFB 單位毫秒。

| 路徑 | 類型 | 冷 TTFB | 暖 p50 | 暖 p95 | 含冷 p50 | 含冷 p95 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `/` | 動態 Function（`sin1`，每次 MISS） | 451 | 258 | 337 | 263 | 354 |
| `/login` | CDN PRERENDER／HIT | 449 | 143 | 153 | 145 | 180 |
| `/status` | CDN PRERENDER／HIT | 450 | 147 | 181 | 155 | 194 |
| `/scan/cart` | CDN PRERENDER／HIT | 560 | 142 | 168 | 145 | 171 |
| `/scan/pickup` | CDN PRERENDER／HIT | 508 | 155 | 211 | 160 | 248 |
| `/prototype` | CDN PRERENDER／HIT | 528 | 162 | 181 | 163 | 187 |

對照方案 A 前暖機中位數：`/login` 376→143、`/scan/cart` 374→142、`/scan/pickup` 390→155、
`/prototype` 387→162、`/status` 約 147 持平。公開殼層暖機已低於建議的 800 ms p95。

已認證瀏覽器量測（2026-08-18，`https://wash-room.vercel.app`，帳號 `admin`，n=3，
Playwright 點擊登入到 `/app` 出現 h1）：

| 流程 | 樣本 (ms) | p50 | 備註 |
| --- | --- | ---: | --- |
| 登入 → 工作台 | 1676、937、685 | 937 | 冷樣本 1.68 s；暖機低於建議 1.5 s |
| 站內切頁 → 新 h1 | 37、35 | 35 | 殼層 client navigation，低於建議 200 ms |

未單獨量控制點 RPC。密碼不得寫進 repo。重跑指令：

```powershell
$env:SMOKE_BASE_URL = "https://wash-room.vercel.app"
$env:PRODUCTION_LOGIN_NAME = "<login>"
$env:PRODUCTION_LOGIN_PASSWORD = "<password>"
node scripts/measure-production-auth.mjs
```

production build 搭配本機零延遲 fake Supabase 的結構量測另確認：

- 主管首頁可見導覽在兩秒內對 10 個目的頁各發出兩次 RSC prefetch，共 20 次；期間出現
  22 次 `GET /auth/v1/user`。背景預取完成後，實際切到 dashboard 仍需要兩次 `getUser`、
  account security RPC、access context RPC 與 dashboard RPC。
- `supabase.auth.getUser()` 每次都會連 Auth server；正式專案已使用 ES256，可評估以
  `getClaims()` 的快取 JWKS 做本地驗證，同時保留資料庫的帳號啟用與 membership 即時檢查。
- `src/app` 目前有 43 個原生 `<a>` render occurrences、4 個 `<Link>` render occurrences，且沒有任何
  route `loading.tsx`、`error.tsx`、`useFormStatus` 或 `useActionState`。大量站內操作會整頁重載，
  動態切頁也沒有立即 fallback。
- 登入後頁面的 JS／CSS 約 249 KB Brotli、865 KB 解壓；`workspace-navigation.tsx` 為了角色標籤
  引入含 Zod runtime 的 `access-role.ts`，約多出 70 KB Brotli／301 KB 解壓內容。
- `LIVE QUEUE` 是 request-time snapshot，不是 Realtime 或 polling。操作成功後通常只顯示文字，
  不更新佇列、不移除完成批次，也不提供下一個控制點。
- `/scan/cart` 的 `submitting` 初始為 `false` 且送出前沒有設為 `true`，慢速期間可能呈現空白。
- 查詢只有少數 `.limit()`；批次選單、主檔與永久歷史 KPI 會隨資料量持續增加。現有 load smoke
  只測 `/status`，無法發現 Auth、Function、RLS、RPC 或營運流程的延遲。

### 四個優化方案

#### 方案 A：保留 Next.js 混合式架構並修正根因（分析建議，待擁有者核准）

保留既有 RSC、server-only DAL、Route Handler、RPC、RLS 與 migration 測試，優先做以下調整：

1. 取得專案擁有者對正式環境變更的明確核准後，在 Vercel 將單一 Function Region 從 `iad1`
   改為與 Supabase 同區的 `sin1`；重新部署後確認 `X-Vercel-Id` 的 compute segment，再重測
   p50／p95。倉庫已加入 `vercel.json` 的 `"regions": ["sin1"]`；**正式 alias 是否已跑在
   `sin1` 必須部署後用回應標頭覆核，不能只看檔案存在。**
2. 建立 root `/` 輕量入口，並將 `/scan/cart`、`/scan/pickup`、prototype 與可行的登入殼層改成
   CDN 靜態頁；POST seam 維持動態。**已完成：** `/` landing、`/scan/cart`、`/scan/pickup`、
   `/prototype` 去掉 `force-dynamic`；登入殼層不再 await `searchParams`，錯誤改 client 讀取。
   `/` 是靜態 landing；無 cookie 時不打 Auth，有 cookie 時由 `src/proxy.ts` 驗證 claims，只有有效
   session 才導向 `/app`，損壞 session 保留在 landing。Root 維持 network-only，不納入 PWA cache-first。
3. 側欄 Link 預設關閉自動 prefetch，改為 hover／focus／touch intent；其餘站內 `<a>` 改成
   client navigation，但不可重新造成全選單 prefetch storm。**已完成：** `AppLink`
   （`prefetch={false}` + hover／focus／touch），configured E2E 證明主管首頁無意圖 prefetch
   路徑為空。
4. 新增 route loading/error、navigation pending、`useFormStatus`／`useActionState`，並在 100 ms 內
   回應點擊；修正匿名送單空白狀態及重複送出。**已完成：** `/app/loading.tsx`、`/app/error.tsx`、
   登入／登出 `useFormStatus`、匿名送單初始 `submitting=true`。`:active` 提供立即 pressed。
5. 將 client 可用的角色常數／標籤與 server-only Zod schema 分離，避免把 Zod 帶入共用殼層。
   **已完成：** `src/lib/auth/access-role-labels.ts`；client 導覽只引這個檔。
6. 以 ES256 `getClaims()` 取代頁面 hot path 的遠端 `getUser()`，合併 account security 與 access
   context；建立單一 role-scoped workspace snapshot RPC，一次回傳 scope、KPI、未結案洗衣單、
   活動批次、設備與待處理異常。**已完成：** `getClaims()` + `current_workspace_principal()`；
   `get_workspace_snapshot()` 一次回傳期間 KPI、分頁佇列、開放批次、設備與最近異常；
   `get_workspace_snapshot_with_details()` 只為目前分頁的洗衣單附加批次、程序階段與估計進度，
   並由 `get_workspace_order_detail()` 重新驗證角色 scope。
   HS256／fake JWT 仍會由 SDK 回退 `getUser()`；正式 ES256 走本地 JWKS。
7. 經 DB 行為測試證明 mutation RPC 自行完成帳號、角色與 scope 驗證後，移除 Route／DAL 的重複
   network preflight；保留輸入驗證與友善錯誤映射。**已完成：** 收單／洗烘／裝車／拆分／控制點
   DAL 不再先打 principal；`tests/database/workspace-snapshot.spec.ts` 證明未登入會被 RPC 拒絕。
8. 為長清單加入 server pagination/search，KPI 改查今日或指定期間，不在每次 render 掃描永久歷史。
   **已完成：** 佇列搜尋單號與分頁；`picked_up`／`completed` 只計今日期間。

優點是遷移成本最低、既有安全測試可保留，預期已能解決大部分實際延遲。若此方案達成下方效能門檻，
不需要重寫框架。

#### 方案 B：Next.js 靜態殼層＋Client Read Model＋PWA

在方案 A 與 P0 RLS 修正完成後，把高頻工作台做成一次載入的 client application：

- CDN／Service Worker 快取非敏感 HTML shell、CSS、圖示、說明與離線紙本流程。
- Browser 使用 publishable key、使用者 JWT 與已驗證 RLS 直接讀取精簡 workspace read model，
  以 Realtime 或有界短輪詢更新佇列；每個分頁只維持一條 Realtime connection，並保留 polling fallback。
- 已認證高風險寫入仍走具 `auth.uid()`、scope、冪等、原子交易與稽核的 RPC；匿名送單／取件則
  維持受限 anon RPC、QR credential 與 rate limit。通知、Email、LINE、Telegram、AI、匯出及秘密
  金鑰工作保留在 server／Edge Function。
- 離線只允許查看非敏感殼層與最後同步時間，不排隊實際營運交易，也不持久化 raw QR bearer。

此方案的重訪與站內互動可接近 SPA，但仍能漸進沿用 Next.js，不必一次重寫全部頁面。截至
2026-08-18，Supabase Free 文件列出的 Realtime 上限為 200 個 concurrent connections；21–100 位
使用者具有評估空間，但多分頁、斷線重連、100 messages/s 上限與 fallback 必須納入壓力測試。

**已完成：** 高頻工作台是 client read model。同一分頁共用一條 Realtime（洗衣單／批次／設備），
事件節流 1 秒，斷線或切回前景會重連並回退 polling。寫入仍走 RPC。PWA 只快取非敏感殼層。
localhost／E2E 不註冊 Service Worker。這是方案 B 的完整切片，不是方案 C。


#### 方案 C：完整靜態 SPA＋Supabase／Edge Functions

可使用 Vite／React 或 Next static frontend，將 HTML／JS／CSS 全部放 CDN；Browser 直接使用 Supabase
Auth、RLS select 與受控 RPC，匿名 QR、通知、AI、報表及需秘密金鑰的能力改由 Edge Functions 承接。

優點是殼層與 client routing 最快，且可移除多數 Browser → Vercel → Supabase 的中繼路徑。代價是：

- 現有 RSC、server-only DAL、Server Actions、cookie／Proxy session 與 Route Handlers 必須重新設計。
- Browser session、CSP、XSS、token、匿名 rate limit、所有 RLS／RPC 及錯誤復原都要重新威脅建模與驗收。
- Next static export 不支援目前使用的 cookies、Proxy、Server Actions 與 request-dependent Route Handlers；
  這是完整遷移，不是只設定 `output: "export"`。
- P0 跨機構 RLS 已有 PGlite 綠燈，但正式 hosted 尚未套用對應 migration 前，
   不能把正式讀取全面開給 Browser。

只有方案 A 完成後仍未達效能門檻，且團隊接受數週級重構與完整安全回歸時，才選此方案。

#### 方案 D：純靜態 HTML／記憶體網站

只適合 `prototype.html`、操作教學、展示或災難時的離線紙本說明。它無法安全滿足多人共享狀態、
設備占用、角色範圍、不可變稽核、跨裝置一致性、通知、匯入與正式報表。若靜態 HTML 加入 Auth、
Supabase 資料與 RPC，它在架構上就已成為方案 C 的 SPA，不再是純靜態系統。

架構評估所依據的官方限制與安全說明：

- [Next.js Static Exports](https://nextjs.org/docs/app/guides/static-exports) 與
  [Server／Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Supabase 資料安全](https://supabase.com/docs/guides/database/secure-data)、
  [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) 與
  [Realtime Limits](https://supabase.com/docs/guides/realtime/limits)
- [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) 與
  [Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)

### 推薦決策與執行順序

1. 先修正跨機構 RLS P0；這是所有 browser-direct read 與 Realtime 的出貨 gate。
2. 先提出 Vercel Function Region 改為 `sin1` 的外部設定變更；取得擁有者核准後才執行，並取得
   同一組 production p50／p95 A/B 數據。
3. 執行方案 A 的 Link／prefetch、loading、pending、Zod、static public shell 與 Auth／snapshot 優化。
4. 建立 canonical QR dispatcher 與單一掃碼工作台：掃任一固定 QR 後，由角色、據點、資產與實際狀態
   決定唯一允許的控制點；批次以單號、機構、車號、分類、優先級與 ETA 顯示，不以 UUID 當主名稱。
5. 若方案 A 仍未達門檻，再漸進導入方案 B；方案 C 需要新的 Issue、ADR、威脅模型與完整回歸。

建議的效能與 UX 驗收門檻（尚未成為正式 Issue AC，採用前需由專案擁有者核准）：

- 點擊後 100 ms 內顯示 pressed／pending。
- 暖啟動殼層 1 秒內可操作；站內切頁殼層 200 ms 內出現。
- 一般切頁完整資料 p95 小於 800 ms；登入至工作台 p95 小於 1.5 秒。
- 控制點 RPC p95 小於 800 ms，timeout／重試沿用相同冪等鍵。
- 主管首頁不得再對整份選單發出無意圖 RSC prefetch；一般切頁目標為一次本地 JWT 驗證與一次
  workspace RPC。
- App 內部導覽不得觸發 document full reload；寫入成功後本頁立即更新並顯示下一個實體步驟。
- 手機無水平溢位，常用操作在首屏內，主要觸控目標至少 48 px。

### 下一位 Agent 的優先工作

1. 正式帳號量測登入至工作台、站內切頁與一個已認證控制點的 p50／p95（curl 公開殼層已量完）。
   再用正式帳號覆核同據點兩機構主管看不到彼此資料。
2. 異常紀錄 RPC／critical trigger schema，以及合批後每個來源車的獨立裝車。不要以已關閉的
   T13–T28 或 schema 存在測試宣告完成。
3. 每個效能變更都先建立 tight、red-capable probe。正式 p50／p95 與本機 fake contract 分開記錄。
4. 延續共用工作區視覺語言，但以掃碼優先、唯一下一步、可讀批次卡片與 48 px 觸控目標重構。
5. 任一 production 變更完成後，取得新的完整驗證與正式 alias smoke；不可沿用本節的舊測試數字。

## 本地端設定

1. 安裝 Node.js 24 與 npm 11；確切版本記錄於 `.nvmrc` 與 `package.json`。
2. 安裝專案相依套件：

   ```text
   npm ci
   ```

3. 第一次執行 E2E 測試前，安裝 Playwright Chromium：

   ```text
   npx playwright install chromium
   ```

4. 將 `.env.example` 複製為 `.env.local`。若要測試未設定 Supabase 的狀態，
   可以先保留空值；若要連接 Supabase 專案，請依下方說明填入對應設定。
5. 雙擊 `start-local.bat`，或執行 `npm run dev`，然後開啟：

   `http://localhost:3003/status`

   較完整的互動 prototype 位於：

   `http://localhost:3003/prototype?variant=A`

   其他版型為 `variant=B`、`variant=C` 與 `variant=D`。其中 D 為設備數位孿生、
   瓶頸風險與 What-if 情境調度中心。

專案在沒有正式環境密鑰或通知服務密鑰時仍必須能夠成功建置。`/status` 頁面會
顯示缺少哪些設定，但不會印出環境變數的實際值。

## 獨立 HTML prototype

若不想安裝 Node.js、npm，也不想啟動伺服器或使用任何 port，可以直接雙擊
專案根目錄的 `prototype.html`。這是一個完全自包含的 HTML 檔案，包含 A/B/C/D
四種版型，以及送洗人員、洗衣員、洗衣主管與送洗機構主管四種操作視角。可以從
匿名送單開始，接著模擬收單分類、多批次拆分、消毒浸泡、洗衣、烘乾、裝車與匿名
取件；控制點皆包含固定 QR 辨識、內容核對與確認更新步驟。另可切換作業據點、設備
狀態、通知矩陣、異常流程、程序版本與報表範圍。D 版型另提供設備數位孿生、瓶頸
風險雷達、情境時間快轉、急件／停機／加班 What-if 演練；`Ctrl+K` 可叫出快速指令。
所有變更只存在目前瀏覽器分頁，重新載入檔案或按「重設」後會回復初始資料。

## 目前實作範圍

Repository 已包含 T02–T28 的 migration、RPC、頁面或測試骨架，但不能因此宣告 28 張票的每一項
正式行為都已完成。接手時應把能力分成兩層：

已有主要程式與既有測試證據：

- Supabase 帳號密碼登入、首次登入強制換密碼、三種認證角色，以及 allowlist／membership 的
  基礎授權與稽核流程。
- 送洗機構、洗衣車、消毒鍋、洗衣機、烘衣機、分類與版本化程序等主檔，以及固定 QR 的檢視、
  列印、下載、停用與例外重發垂直切片。
- 匿名送單、洗衣員收單分類、拆批、消毒、清洗、烘乾、裝車與匿名取件的資料庫／UI 控制點切片；
  寫入函式已有部分 rollback、冪等與 scope 測試，但尚未以實際印出的所有 QR 入口完成全流程驗收。
- 洗衣員／洗衣主管可在批次控制中心填寫原因並確認「還原上一步」；資料庫只允許最後一個可安全
  補償的誤開始、誤完成或誤裝車。已取件、跨據點、設備衝突或沒有安全目標時拒絕，且不刪除原紀錄。
- 正式 `/app` 共用殼層、角色首頁、作業佇列快照、掃碼工作台與本機 configured browser tests。
- 正式登入後共用殼層提供 `MX`／`AP`／`GS`／`MB`／`SH` 風格切換；預設為 `MX`，選擇由
  `src/app/app/style-switcher.tsx` 以 `localStorage` 保存。這是純視覺層，沒有替代任何 server-only
  DAL、RLS、RPC 或控制點授權。

目前只有 schema／RPC／UI 骨架，或仍缺完整行為證據的範圍：

- T17–T27 已有資料庫 scope／冪等／拒絕合約，但仍缺完整瀏覽器流程與部分 rollback／競態。
- T28 smoke 已接受「應用程式已啟動」；load check 仍只併發讀取 `/status`，不能證明登入或營運負載。

因此，角色化首頁與操作殼層的瀏覽器回歸測試只能證明 UI contract；其餘能力仍須依
`docs/requirements.md` 與各 Issue Acceptance Criteria 補強。不得只依 Issue closed、頁面可開啟、
資料表或 RPC 存在，判定正式功能完整。

`prototype.html` 是可直接雙擊的記憶體內互動原型，用來驗證 UI 與作業流程；
`src/app/prototype` 是需要 Next.js server 的原型頁面。兩者都不是正式資料輸入介面，
不會取代 `src/app/api`、server-only DAL、Supabase RPC 與 RLS 所形成的正式安全邊界。
正式 `/app` 只重用原型已確認的資訊架構與視覺語言，不會把原型的記憶體 mutation 直接接到
Supabase；所有正式寫入仍由既有 DAL、RPC、RLS、冪等與稽核邊界執行。

其他 AI agent 接手前，請先閱讀 [AGENTS.md](AGENTS.md)、[CONTEXT.md](CONTEXT.md)、
[需求規格](docs/requirements.md) 與相關 [ADR](docs/adr/)。功能與正式環境的交付狀態以
本文件、GitHub Issues、實際 migration 及測試結果交叉確認，不要只依原型畫面推定已上線能力。

## Supabase 設定

### Hosted Supabase

1. 建立 Supabase 專案，將專案 URL 與 publishable key 填入 `.env.local` 對應欄位。
   一般已驗證請求保留使用者 JWT，讓 RLS 仍是最後的資料存取權限邊界。完整帳號管理另需要
   `SUPABASE_SERVICE_ROLE_KEY`，但只能放在本機 `.env.local` 或 Vercel server-side secret，
   不得加上 `NEXT_PUBLIC_`、提交 Git、貼到畫面或交給瀏覽器。
2. 若需要透過 CLI 管理 hosted migration，先執行：

   ```text
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push --linked --dry-run
   npx supabase db push --linked
   ```

   `<project-ref>` 只填專案代碼本身，不要輸入 `<`、`>`，也不要把代碼誤寫成參數名稱。
   Schema 必須由 migration 推送；不要把 migration 逐檔貼進 SQL Editor，否則遠端 migration
   history 會與 GitHub 不一致。

### 帳號密碼驗證

1. 在 Supabase「Authentication > Sign In / Providers」啟用 Email provider、停用自行註冊、
   停用 Google 與其他未使用 provider。此處的 Email 是 Supabase Auth 內部識別，不是使用者
   日常輸入的登入名稱。
2. 在密碼安全設定將最短長度設為 12，要求大寫、小寫、數字與符號，並啟用「變更密碼時要求
   目前密碼」。免費方案若沒有外洩密碼檢查，仍保留前述強度要求。
3. 推送 migration 後，依照一次性
   [首位主管 bootstrap runbook](docs/runbooks/bootstrap-first-supervisor.md) 建立 `admin` 的
   profile 與兩個作業據點 membership。
4. 在「Authentication > Users」建立 Auth user：內部 Email 固定為
   `admin@auth.wash-room.invalid`，勾選 Auto Confirm，密碼使用密碼管理器產生的一次性強密碼。
   密碼不得填入 SQL、GitHub、README 或 Vercel，也不得使用 `9999`。
5. 使用畫面上的登入帳號 `admin` 與該一次性密碼登入；系統會先鎖住所有工作區，直到本人完成
   密碼更換。`admin` 只是具有正常 laundry supervisor membership 的帳號，不是資料庫超級使用者。
6. 首位主管完成登入後，後續帳號都從「主管管理 → 帳號與權限管理」建立；不再要求管理者分別到
   Supabase Dashboard 手動建立 Auth user 與資料庫 membership。暫時密碼只在建立／重設當下輸入，
   系統不保存明文，也不會再次顯示。

完整的 GitHub、Supabase 與 Vercel 線上設定順序，請見
[正式環境線上建置清單](docs/runbooks/online-production-setup.md)。

### 權限控制邊界

所有已驗證的讀取都受到 Row Level Security 約束。allowlist 資料表的直接
`INSERT`／`UPDATE`／`DELETE` 權限已從應用程式角色撤銷；單筆表單與 CSV 匯入都只會呼叫
同一個具原子性的 `SECURITY DEFINER` 資料庫函式。該函式從 `auth.uid()` 推導操作者，
套用與讀取 policy 相同的有效據點主管範圍，在變更資料前先驗證完整批次，並寫入稽核事件。
瀏覽器永遠不會取得 service-role key。Vercel 只在帳號管理 Server Action 內使用該 secret 呼叫
Auth Admin API；profile、membership、scope、最後主管與自我管理限制仍由使用操作者 JWT 的 RPC
驗證，service role 不取代這些資料庫授權判斷。

在 Supabase 尚未產生已驗證使用者前發生的帳密失敗，無法安全歸屬給某位操作者，
因此登入頁只會回傳相同的通用錯誤，不建立永久授權事件。取得已驗證使用者後，
每一筆 allowlist、provider、account 與 membership 拒絕都由 `authorize_current_user` 記錄；
同一使用者與原因的重複事件會限制為每小時一筆。

### 機構主檔

organization migration 會建立兩個獨立作業據點：`MAIN / 本館` 與 `CORP / 法人`。
洗衣主管在 `/app/admin/organizations` 管理送洗機構；頁面與 server action 只允許讀寫
目前使用者具有有效洗衣主管 membership 的作業據點。

每個機構只有一個目前的作業據點配對。變更配對時，操作者必須同時具備來源與目的據點的
主管權限、填寫變更理由，並提供冪等鍵。不可變稽核事件會保存兩個據點範圍與完整的變更前／後值。
目前配對只決定未來建立的洗衣單；T07 的建單交易必須 snapshot 機構 ID 與據點 ID，不能因機構
日後改配而重新推導既有歷史洗衣單的據點。

### 洗衣車與固定 QR Code

洗衣主管在 `/app/admin/laundry-carts` 管理洗衣車。車號會正規化、全域唯一且不可變；
每台洗衣車屬於一個送洗機構，並跟隨該機構目前的作業據點配對。

資料表直接寫入權限已撤銷。登錄、啟用／停用與例外 QR 重發都使用已驗證、具冪等性的
`SECURITY DEFINER` 函式；每次都重新確認目前主管範圍，並寫入不可變稽核事件。重複的未授權
嘗試只會在某個操作者、操作與已驗證目標範圍的 aggregate 首次建立時寫入一筆詳細事件。
跨過每小時視窗時，只更新同一 aggregate 的計數與最後嘗試時間，不增加另一筆詳細事件。
這樣可以保留生命週期總數，並以真實業務範圍限制永久稽核成長，而不是讓重試次數造成無限資料。

資料庫在登錄洗衣車時產生 256-bit 隨機 nonce 與 keyed signature。private schema 只儲存 nonce、
token digest、簽章金鑰版本與 credential history，永遠不儲存 raw bearer token，也不把 token
寫入稽核事件。授權的 QR 畫面會在 server-side 重建相同 token。一般啟用／停用不會輪替 QR：
停用洗衣車會讓 credential 無法使用，再啟用後恢復同一張固定 QR。確認過的例外重發會在同一交易
撤銷舊 credential 並建立下一個版本，舊 QR 永遠不能重新生效。

列印的 QR 包含設定好的 canonical application origin，並將 bearer credential 放在 URL fragment，
而不是 request path 或 query string。受保護的 SVG route 設為 private 且不可快取；頁面不會將 raw token
輸出到 HTML、action result、檔名、redirect 或測試觀察值。T07 負責公開掃碼交接：必須立即清除
fragment，只透過 POST body 傳送 token，在建單交易中重新驗證洗衣車、機構與目前據點，並將當時配對
snapshot 到新的洗衣單。

### 匿名送洗建單

`/scan/cart` 是單一用途的匿名控制點。QR fragment 會在瀏覽器傳送 credential 到受保護的
`/api/scan/cart` POST seam 前，先以 `history.replaceState` 清除。資料庫 RPC 會在單一交易中檢查
目前 credential、洗衣車／機構／據點是否啟用、全域有界的匿名 rate bucket，以及每台洗衣車只能有一張
開啟中洗衣單的鎖。交易會 snapshot 洗衣車、機構與作業據點，並建立可閱讀的
`SITE-YYYYMMDD-NNNN` 洗衣單編號與 `awaiting_receipt` 狀態。

重複 request ID 具冪等性；同一台車已有開啟中洗衣單時，新請求會被拒絕。匿名回應只包含目前洗衣單
編號、狀態或原因代碼，不會回傳歷史、分類、設備或 raw QR 資料。

支援的修改 RPC 拒絕會由應用程式寫入稽核。跨據點 QR 詳情或 SVG 讀取則由 RLS 與 server 遮罩為
`404`，RLS 遮罩的清單查無資料不會建立業務稽核事件；這些讀取嘗試由平台 log 負責。直接 SQL 被
權限或 RLS 拒絕時，整筆交易會 rollback，因此無法在同一交易建立持久的業務稽核事件，只能透過
Supabase database logs 追蹤。

### 洗衣員收單與初始批次

洗衣員在 `/app/operations/receive` 使用固定洗衣車 QR 作為收單控制點。頁面只接受 `v1.cart`
fragment，讀取後立即清除 fragment；QR bearer 只會透過受保護的 POST body 傳送，且每次由 server-only
DAL 重新驗證洗衣員的作業據點權限。收單時至少選擇一個啟用的洗滌分類；數量尺度固定為一台洗衣車，
不要求填寫件數或重量。

`receive_laundry_order_from_cart_qr` 會在單一交易中鎖定洗衣車、送洗機構、作業據點與待收件洗衣單，
先驗證所有分類及其已發布程序，再建立每個分類的初始洗滌批次。每個批次會保存來源洗衣單、洗衣車、
作業據點、分類，以及收單當下的程序範本與已發布版本 snapshot；洗衣單由 `awaiting_receipt` 轉為
`awaiting_cleaning`。request ID 支援冪等重試，重複掃描不會重建批次；分類停用、程序未發布、
跨據點或非洗衣員呼叫都會在寫入前拒絕。

### 清洗階段控制點

洗衣員可在 `/app/operations/washing` 選擇待清洗批次並掃描 `v1.equipment` 固定 QR。開始命令會
重新驗證批次作業據點、程序目前階段、洗衣機類型、分類與程序能力、設備狀態及占用衝突；第一版
不由系統自動指派設備。批次階段執行、設備占用、批次狀態與不可變操作稽核會在同一交易完成，
request ID 可安全重試而不會重複建立階段或占用機台。消毒鍋等前置階段尚未完成時，洗衣機控制點
會拒絕跳過流程。

### 消毒、烘衣與取件（裝車為可選控制點）

同一台設備掃兩次：第一次開始並占用，第二次結束並釋放。標準分鐘只供預估。
消毒分類在 `/app/operations/disinfection` 先掃消毒鍋開始浸泡，再掃同一消毒鍋結束浸泡。
`/app/operations/washing` 掃洗衣機開始／結束清洗；`/app/operations/drying` 掃烘衣機開始／結束烘乾。
最後一個設備階段完成後，該批次完成；該單所有必要批次完成後進入 `ready_for_pickup`。
送洗人員使用 `/scan/pickup` 掃同一張固定車卡取件結案。
所有開始／結束與占用／釋放命令都具備冪等鍵與不可變稽核。

若要使用可選的本地 Supabase stack，先啟動 Docker，再執行：

```text
npx supabase start
npx supabase status
```

CLI 已固定為 development dependency，請使用專案內的指令，不要依賴另外安裝的 global CLI 版本。

### 分類與版本化程序範本

洗衣主管在 `/app/admin/procedures` 管理全域洗滌分類目錄與據點範圍的程序範本。五個預設分類只會
seed 一次；自訂分類可以重新命名、排序或停用，但目錄不會實體刪除。

程序草稿保存排序後的階段、標準分鐘數、支援的設備類型、相容條件與轉移模式。實體設備階段必須由
操作員手動確認。發布程序時會退休前一版本，並讓已發布版本不可變；之後的修改會建立新的草稿／版本，
讓未來批次可以 snapshot 啟動當下的版本。分類與程序文字不接受住民／病患識別資料，也不接受任意
compatibility key。

### 洗衣設備與固定 QR Code

洗衣主管在 `/app/admin/laundry-equipment` 管理據點範圍的消毒鍋、洗衣機與烘衣機。每台設備記錄可容納洗衣車台數、
支援的洗滌分類、相容的已發布程序範本，以及四種操作狀態：normal、inactive、abnormal、maintenance。
工作流程以目前占用的洗衣車數對照容量；額滿才拒絕再開始。狀態變更不會輪替 QR。

設備能力驗證由登錄與更新 RPC 共用：設備必須位於主管的有效據點，選取的分類必須啟用，每個選取的
程序必須屬於該據點、具有已發布版本，且不能要求不同的實體設備類型。

資料表直接寫入權限已撤銷。登錄、更新與例外 QR 重發都必須驗證身份、具備冪等性、檢查範圍並記錄
變更前／後值。重發會在同一交易撤銷前一張 credential 並建立下一個版本；raw bearer token 保持私有，
只在已授權的 QR 詳情 seam 重建，永遠不會輸出到 HTML、URL、檔名、稽核紀錄或 server observation。
受保護的 SVG route 設為 private 且不可快取，使用 `v1.equipment` scan fragment namespace。

設備刪除是窄限的誤建資料治理操作：只有完全沒有批次、排程或控制點紀錄的設備可刪除，且必須
再次輸入設備名稱、確認不可復原並填寫原因。資料庫 RPC 在鎖定設備後才判斷，不接受瀏覽器自行
宣告「未使用」；已有紀錄或刪除競態會整筆拒絕並保留設備。完整決策見
`docs/adr/0013-delete-unused-laundry-equipment.md`。

## Vercel 部署

1. 在 Vercel 匯入 private GitHub repository `Kevin72333/wash-room`，並將 repository root 保留為
   project root；Vercel 應能自動偵測 Next.js。
2. 在專案設定選擇 Node.js 24.x。
3. 將 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、
   `NEXT_PUBLIC_APP_URL` 與 server-only 的 `SUPABASE_SERVICE_ROLE_KEY` 加入對應環境。
   service role secret 不得加上 `NEXT_PUBLIC_`，Preview／Production 應分別使用其對應 Supabase
   專案的 secret。Production 的 canonical origin 固定使用
   `https://wash-room.vercel.app`；不要把會隨部署改變且可能受 SSO 保護的 unique deployment URL
   印進固定 QR。Preview 若要實測 QR，應另配可控且穩定的 Preview alias。
   `SUPABASE_AUTH_EXTERNAL_*` 只供本地 Supabase stack 使用；正式帳密登入不需設定 Google OAuth。
4. `vercel.json` 已指定 Function region 為 `sin1`；2026-08-22 對 `/login` 的正式回應曾覆核
   `X-Vercel-Id: hkg1::sin1::…`。若後續變更 region，必須先取得專案擁有者明確核准，再重新部署，
   並用正式回應的 `X-Vercel-Id` 確認 compute segment，不要只看 edge POP。
5. 從 `main` 部署後開啟 `https://wash-room.vercel.app/status`，確認應用程式已執行，以及所有必要
   Supabase 設定是否存在。

GitHub Actions 與 Vercel Git deployment 目前是各自觸發，不能假設 Actions 一定先於正式部署完成；
需要嚴格 gate 時，應以受保護分支或明確 deployment workflow 串接。未來 Email、LINE 或 Telegram
credentials 都屬選用整合；即使未設定，也不能讓核心 build 失敗。

## 驗證方式

專案使用既定的公開測試 seam：Playwright 在本機啟動 production build mode 的 Next.js 應用程式；
configured suite 另連到 fake Supabase HTTP boundary。在尚未設定 Supabase integration environment 前，
由 PGlite 提供程序測試所需的 process 內 PostgreSQL 相容資料庫。這些測試不等於 hosted production
smoke、正式 Supabase 整合或效能量測。

```text
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:e2e:configured
```

GitHub Actions 會在推送到 `main` 與建立 pull request 時執行相同檢查。configured browser suite
會啟動僅供測試的 Supabase-compatible HTTP boundary，不會加入正式環境的測試登入頁或 bypass flag。

## 正式環境就緒檢查（T28）

發布 migration 前先執行本機 migration 合約與 linked dry-run：

```text
npm run test:db
npm run lint
npm run typecheck
npm run build
npx supabase db push --linked --dry-run
```

`ADR-012-production-readiness.md` 仍寫有「一次性 Supabase 專案演練」，但專案擁有者後續決定不建立
額外演練專案。兩者目前是待修文件衝突；下一次調整 production gate 時必須先更新 ADR 與 Issue，
不能默默沿用互相矛盾的流程。

正式環境 smoke check 的 PowerShell 語法如下：

```powershell
$env:SMOKE_BASE_URL = "https://wash-room.vercel.app"
npm run test:smoke
Remove-Item Env:SMOKE_BASE_URL
```

截至 2026-08-18，這個 smoke 指令會在 `/status` 回 200 後失敗：頁面顯示「應用程式已啟動」，
`scripts/production-smoke.mjs` 卻仍尋找英文 `running`。修正並重跑前不可宣稱 production smoke 綠燈。

有界 load check 預設接受 `SMOKE_REQUESTS=100`，最多 300 次；它只併發讀取 `/status`，不能證明
21–100 位登入使用者、Auth、RSC、RLS、RPC、設備控制點或 101–300 張洗衣單的實際負載能力。

免費 Supabase／Vercel 方案可以使用，但不保證備份與 SLA。依 `docs/requirements.md` 與
`docs/adr/0002-no-external-backup.md` 的已接受決策，本專案不建立額外備份或資料庫災難還原流程；這代表
誤刪、資料毀損、服務商故障或容量耗盡可能造成不可復原資料損失，不能把容量警示描述成備份。
批次控制中心的「還原上一步」只是保留歷史的營運補償事件，不是備份、時間點復原或資料庫 rollback。
容量警示 60／75／85／95% 只提供提醒、不會刪除資料；若無法測量分母，狀態會標記為 `unknown`。
Email／LINE／Telegram secrets 只存放在環境變數，不會儲存於 notification destinations。
寄送 Email 優先使用 Gmail：`GMAIL_USER` 與 `GMAIL_APP_PASSWORD`（Google 應用程式密碼）。
可選 `NOTIFICATION_EMAIL_FROM`；未設則用 `GMAIL_USER`。目的地只保存信箱。

## 專案參考文件

- `CONTEXT.md`：定義領域用語與業務邊界。
- `docs/requirements.md`：記錄產品需求。
- `docs/adr/`：存放已採納的架構決策。
- `docs/agents/`：記錄 issue tracker 與 agent 協作規範。
