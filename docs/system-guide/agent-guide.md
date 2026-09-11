# 洗衣管理系統 — AI Agent 技術交接手冊 (Agent Guide)

<!-- SYSTEM-GUIDE:GENERATED:START -->

**適用對象**：接手之 AI Agent、全端工程師、系統架構師  
**版本**：v0.1.0  
**基線基準**：Next.js 16.3.0 App Router + Supabase + React 19 + Three.js  
**更新日期**：2026-08-31

---

## 1. 系統架構地圖與技術棧

```
wash-room/
├── src/
│   ├── app/                      # Next.js App Router 路由與版面
│   │   ├── app/                  # 登入後共用工作台 (Workspace Shell)
│   │   │   ├── layout.tsx        # 包含頂部列、左側側邊欄、右側內容區
│   │   │   ├── workspace-shell.tsx       # 伺服器端連結池與權限解析
│   │   │   ├── workspace-navigation.tsx  # 客戶端選單列與即時搜尋
│   │   │   ├── laundry-order-flow-3d.tsx # Three.js 3D 流程引擎主舞台
│   │   │   ├── admin/            # 洗衣主管管理模組 (accounts, bi, carts, equipment, procedures...)
│   │   │   ├── operations/       # 洗衣員操作控制點 (receive, washing, disinfection, drying, split...)
│   │   │   ├── history/          # 已取件歷史查詢與詳情彈窗
│   │   │   └── dashboard/        # 洗衣單與批次儀表板
│   │   ├── scan/                 # 匿名與實體 QR 掃碼導向入口
│   │   ├── login/                # 登入頁面
│   │   └── api/                  # Server-only Route Handlers
│   ├── lib/                      # Server-Only 資料存取層 (DAL)
│   │   ├── auth/                 # Principal 解析、權限驗證 (principal.ts, access-role.ts)
│   │   ├── analytics/            # 工作區 Snapshot、訂單歷程、BI 模型 (workspace.ts, bi-models.ts)
│   │   ├── procedure/            # 程序範本與分類邏輯
│   │   └── supabase/             # Supabase 客戶端邊界 (server.ts, admin.ts, proxy.ts)
├── supabase/
│   └── migrations/               # 資料庫遷移檔案 (40+ 筆完整 SQL 遷移合約)
├── tests/
│   ├── database/                 # PGlite 真實 PostgreSQL + RLS 合約測試
│   ├── unit/                     # Vitest 單元測試
│   └── e2e/                      # Playwright 瀏覽器整合測試
└── public/
    └── images/laundry-flow/      # 3D 流程引擎專用透明 WebP 角色與設備資產
```

---

## 2. 安全與授權架構 (Security & Auth)

### 2.1 Server-Only DAL 原則
- 瀏覽器端嚴格禁止直連 Supabase 進行任意資料庫讀取或寫入。
- 所有資料讀取必須透過 Server Component / Server-Only DAL 取得經過型別保護的 DTO；所有變更操作透過受控 Server Actions 或 Route Handler 呼叫具備明確授權的 PostgreSQL RPC。

### 2.2 Principal 解析與 React Request Cache
- `src/lib/auth/principal.ts` 使用 React `cache()` 包裹 `getPrincipalState()`，確保同一 RSC 渲染週期中重複呼叫 `requirePrincipal()` 或 `requireRole()` 不會產生多餘的 Auth / RPC 往返。
- 角色清單：`system_administrator` (系統管理員，最高權限)、`laundry_supervisor` (洗衣主管)、`laundry_worker` (洗衣員)、`institution_supervisor` (送洗機構主管)。
- 角色驗證函式：
  - `requirePrincipal()`：驗證已登入且帳號正常。
  - `requireRole("system_administrator")` / `requireRole("laundry_supervisor")`：非授權角色自動導向自身專屬入口。
  - `requireRole("laundry_worker")` / `requireRole("institution_supervisor")`。

### 2.3 RLS 跨機構與跨據點強制隔離
- **P0 RLS 合約**：`private.has_site_access()` 與 `private.has_laundry_supervisor_site_access()` 承認 `system_administrator`、`laundry_supervisor` 與 `laundry_worker` 之據點 membership；送洗機構主管走 `has_institution_supervisor_access()`。
- 預設管理員帳號：`admin` 綁定通知信箱 `ad@hok.com.tw`，具備系統管理員身分。
- 機構主管只能讀取本機構洗衣單，絕不可跨機構窺探其他機構之單據或設備。

---

## 3. 核心資料模型與領域規則

1. **作業據點 (`operating_sites`)**：本館與法人兩大獨立據點，設備與佇列實體分離。
2. **送洗機構 (`institutions`)**：與作業據點維持一對一固定配對關係。
3. **洗衣車 (`laundry_carts`)**：重複使用的實體載具，張貼固定 QR Code（不隨單號變更）。
4. **洗衣單 (`laundry_orders`)**：一台洗衣車送洗時建立的獨立作業紀錄，狀態流轉：
   `pending_receipt (待收件) ➔ in_progress (處理中) ➔ ready_for_pickup (待取件) ➔ picked_up (已取件結案)`。
5. **洗滌批次 (`laundry_batches`)**：實際進入洗滌程序的單元，可由洗衣單拆分或相容合併，支援獨立階段推進。
6. **洗衣設備 (`laundry_equipment`)**：消毒鍋、洗衣機、烘衣機，具備固定 QR 與洗衣車台數容量限制。
7. **程序範本與階段 (`procedure_templates` / `procedure_stages`)**：定義 SOP 階段與標準分鐘，具備 draft ➔ published ➔ archived 版本控制，已發布版本不可原地覆寫。
8. **不可變稽核與可逆更正**：所有高風險操作與狀態變更留下完整稽核日誌；更正操作使用「補償事件」還原可逆狀態，絕不物理刪除歷史。

---

## 4. 前端渲染與「秒開」效能規範

### 4.1 核心效能指標 (SLO)
- 點擊操作響應：100ms 內展現 pending / active 狀態。
- 工作台切頁：200ms 內出現新頁面殼層。
- 系統說明與技術手冊：**秒開（Zero-Lag / 0ms 外部網路請求）**。

### 4.2 秒開實作機制
1. **零資料庫相依 (Zero DB I/O)**：System Guide 內容直接以靜態結構化模組載入，不打 Supabase RPC，不等待資料庫連線。
2. **路由預取 (Intent Prefetch)**：左側選單連結使用 `<AppLink>`，在滑鼠懸停或視野內自動由 Next.js 進行背景預取。
3. **客戶端秒切頁籤 (Instant Tabs)**：採用 `ModuleTabs` 搭配 URL Hash (`#tab=user` / `#tab=admin` / `#tab=agent`)，切換無網路傳輸，支援本機記憶與鍵盤無障礙操作。

### 4.3 3D 流程引擎架構 (`laundry-order-flow-3d.tsx`)
- Three.js 只在 Client Component 動態載入，依據 DTO 推導 8 個領域階段節點。
- 採用專屬內容簽章（Content Signature）管理 Scene 生命週期，避免即時 Snapshot 更新造成畫布反覆卸載重繪。
- 完整支援 `prefers-reduced-motion` 與文字版節點 Fallback。

---

## 5. 測試體系與驗證命令

### 5.1 測試套件架構
- **資料庫合約測試 (`tests/database/`)**：使用 `@electric-sql/pglite` 啟動真實 in-memory PostgreSQL，套用全套 migrations 驗證 RLS、RPC 邊界、交易與冪等性（目前 25 檔 / 92 tests 通過）。
- **單元測試 (`tests/unit/`)**：Vitest 驗證 BI 模型解析、PWA Service Worker、訂單歷程 DTO。
- **端到端測試 (`tests/e2e/`)**：Playwright 測試公開掃碼流程與登入後工作台各角色權限。

### 5.2 常用開發與驗證指令
```bash
# 執行全套單元與資料庫合約測試
npm test

# 執行特定資料庫合約測試
npm run test:db

# 執行型別檢查
npm run typecheck

# 執行 Lint 檢查
npm run lint

# 執行 Next.js 正式建置
npm run build

# 執行 Playwright E2E 測試
npm run test:e2e
```

---

## 6. 接手注意事項與已知限制

1. **不可繞過 RLS**：修改任何查詢或 API 時，嚴禁在客戶端直接查詢資料庫或使用 `service_role` 繞過權限。
2. **風格系統獨立性**：登入後風格切換（MX/AP/GS/MB/SH）純屬前端視覺呈現，絕不可將風格狀態或 GSAP 邏輯滲透至 Server-Only 資料層。
3. **不可變歷史原則**：禁止物理刪除洗衣單、批次、稽核紀錄或已投入使用之設備。

<!-- SYSTEM-GUIDE:GENERATED:END -->

<!-- SYSTEM-GUIDE:MANUAL:START -->
## 手動 Agent 交接紀錄
<!-- SYSTEM-GUIDE:MANUAL:END -->

