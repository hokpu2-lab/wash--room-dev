# 洗衣管理系統 — 系統說明手冊 (System Guide)

<!-- SYSTEM-GUIDE:GENERATED:START -->

**分析與產生時間**：2026-08-31  
**適用版本**：v0.1.0 (Next.js 16 App Router + Supabase + Three.js)  
**專案代碼**：`wash-room`  
**語言規範**：繁體中文（台灣用語，對齊 `CONTEXT.md`）

---

## 執行摘要 (Executive Summary)

本系統說明手冊專為「洗衣管理系統」量身打造，涵蓋跨作業據點（本館、法人）接收、處理及交還送洗物之完整作業生命週期。本手冊分為三大專屬面向，分別為第一線作業人員、後台系統管理者以及後續承接之 AI Agent / 開發維護團隊提供完整且精確的操作與架構指引。

---

## 文件導覽清單

| 文件名稱 | 目標受眾 | 核心內容與涵蓋範圍 |
| :--- | :--- | :--- |
| [**使用者操作說明 (user-guide.md)**](./user-guide.md) | 送洗人員、洗衣員、送洗機構主管 | 匿名掃碼送單/取件、洗衣員實體收單與分類、浸泡/清洗/烘乾機台掃碼操作、批次拆分與合併、可逆還原上一步、異常申報、已取件歷史查詢、3D 流程地圖導覽。 |
| [**管理者設定說明 (admin-guide.md)**](./admin-guide.md) | 洗衣主管 (系統管理員) | 即時戰情室營運總覽與 KPI、帳號生命週期管理（登入大小寫、多角色 membership、停用/安全刪除墓碑）、送洗機構與作業據點配對、洗衣車與洗衣設備固定 QR 管理、洗滌分類與程序範本版本化發布、異常通知矩陣設定、受控 BI 營運分析模型庫。 |
| [**AI Agent 交接說明 (agent-guide.md)**](./agent-guide.md) | AI Agent、開發團隊、維護工程師 | 領域模型與架構邊界、Next.js 16 App Router + Supabase 技術棧、Server-Only DAL、RLS 與多租戶隔離合約、RPC 接口規範、Three.js 3D 流程引擎架構、5 大視覺風格切換機制、秒開效能預算規範、PGlite 與 Playwright 測試體系、歷史出貨 Gate 覆核。 |

---

## 證據來源與權威等級 (Authority Hierarchy)

本手冊嚴格遵循以下證據優先順序編撰：

1. **可執行程式碼與資料庫 Migration**：
   - 核心邏輯：`src/lib/auth/`、`src/lib/analytics/`、`src/lib/procedure/`
   - 資料庫遷移與 RLS：`supabase/migrations/` (40+ 筆 migration，含 `20260818230000_fix_cross_institution_rls.sql`、`20260822150000_consolidate_managed_account_permissions.sql`、`20260828100000_add_workspace_order_timing.sql` 等)
2. **測試套件**：
   - PGlite 資料庫合約測試 (25 檔 / 92 tests 通過)
   - Playwright E2E 測試套件
3. **專案規格與架構決策記錄**：
   - `CONTEXT.md` (領域術語單一事實來源)
   - `AGENTS.md` (交付基線與接手規範)
   - `docs/requirements.md` (需求規格書)
   - `docs/adr/` (ADR-001 至 ADR-014)

---

## 前台整合與權限說明

- **前台路徑**：`/app/admin/system-guide`
- **權限控制**：僅限系統管理員與洗衣主管（`system_administrator` / `laundry_supervisor`，預設管理員為 `admin`，`ad@hok.com.tw`）可見。伺服器端透過 `requireRole` 嚴格把關；非授權使用者將自動重定向至自身工作台。
- **秒開優化**：
  - 零網路延遲：手冊內容以靜態預載方式打包，不產生額外資料庫請求。
  - 左側選單秒開：導航按鈕採用 `<AppLink>` 並由 Next.js 進行意圖預取。
  - 頁籤切換秒開：採用客戶端 `ModuleTabs` 配合 URL hash（`#tab=user`、`#tab=admin`、`#tab=agent`），切換 0 延遲且具備狀態記憶。
- **排版佈局**：
  - 遵循系統工作台殼層規範，左側保留完整導覽列、搜尋列與據點切換器；右側內容區呈現高對比度目錄導航、標籤標示與一鍵複製功能。

<!-- SYSTEM-GUIDE:GENERATED:END -->

<!-- SYSTEM-GUIDE:MANUAL:START -->
## 手動補充與備註區

如需針對各據點之特殊維運規範進行手動補充，請在此區塊撰寫，後續自動更新將完整保留此內容。
<!-- SYSTEM-GUIDE:MANUAL:END -->

