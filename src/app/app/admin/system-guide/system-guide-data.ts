export type GuideSection = {
  id: string;
  title: string;
  level: number;
};

export type GuideDocument = {
  id: "user" | "admin" | "agent";
  badge: string;
  title: string;
  subtitle: string;
  audience: string;
  version: string;
  updateDate: string;
  summary: string;
  rawMarkdown: string;
  sections: GuideSection[];
};

export const USER_GUIDE_RAW = `# 洗衣管理系統 — 使用者操作手冊 (User Guide)

**適用對象**：第一線作業人員（送洗人員、洗衣員、送洗機構主管）  
**版本**：v0.1.0  
**更新日期**：2026-08-31

---

## 1. 角色與系統入口

| 角色 | 身分識別 | 主要工作與權限 |
| :--- | :--- | :--- |
| **系統管理員** | 帳號密碼登入（預設 \`admin\`，\`ad@hok.com.tw\`） | 系統最高管理權限，跨作業據點營運監控、帳號與角色權限生命週期管理、程序範本與系統手冊。 |
| **洗衣主管** | 帳號密碼登入（作業據點授權） | 授權作業據點之營運戰情室、設備狀態、程序範本、異常通知與受控 BI 模型分析。 |
| **洗衣員** | 帳號密碼登入（作業據點授權） | 於作業據點（本館或法人）執行實體收單、洗滌分類、機台掃碼操作（浸泡/清洗/烘乾）、批次拆分/合併、還原上一步及異常通報。 |
| **送洗機構主管** | 帳號密碼登入（機構授權） | 查閱本機構專屬之送洗清單、處理進度、異常通知與歷史紀錄。 |
| **送洗人員** | 免登入（匿名掃碼） | 於送洗機構端掃描洗衣車固定 QR Code 建立送單；於待取件時再次掃碼確認領回取件。 |

---

## 2. 核心作業流程總覽

整個送洗作業遵循嚴謹的領域生命週期：

\`\`\`mermaid
graph TD
    A[1. 送單 (送洗人員掃車卡 QR)] --> B[2. 待收件]
    B --> C[3. 收單與分類 (洗衣員掃車卡 QR 填分類)]
    C --> D[4. 待清洗 / 待消毒]
    D --> E[5. 浸泡/清洗/烘乾 (掃機台 QR: 首次開始/二次結束)]
    E --> F[6. 待取件 (全部必要階段完成)]
    F --> G[7. 已取件結案 (送洗人員掃車卡 QR 領回)]
\`\`\`

---

## 3. 詳細操作步驟指引

### 3.1 送洗人員：掃碼送單（建立洗衣單）
1. **抵達送洗點**：送洗人員推移裝載送洗物之洗衣車至指定位置。
2. **掃描車卡**：使用手機或平板相機掃描張貼於洗衣車上的固定 QR Code。
3. **確認送單**：畫面上顯示該洗衣車所屬之「送洗機構」與配對「作業據點」，確認無誤後點擊「確認送單」。
4. **狀態更新**：系統自動建立洗衣單，狀態標示為 \`待收件\`。

> [!NOTE]
> - 一台洗衣車在未結案前，系統不允許建立第二張未結案單。
> - 送洗人員無需帳號，掃碼入口僅顯示該次送單之必要確認資訊。

---

### 3.2 洗衣員：收單與洗滌分類
1. **登入系統**：洗衣員使用帳號密碼登入工作台（\`/app/operations\`）。
2. **實體核對**：確認現場洗衣車實體，點選「收單與分類」或直接掃描該洗衣車 QR Code。
3. **勾選分類**：依送洗物性質勾選一至多個洗滌分類（例如：\`消毒品\`、\`圍兜\`、\`汙衣\`、\`床簾\`、\`其他\`）。
4. **送出收單**：系統自動依所選分類套用最新發布之程序範本，狀態轉為 \`待清洗\`（若含消毒品則進入 \`待消毒\`）。

---

### 3.3 洗衣員：設備階段掃碼操作（同一設備掃兩次）

系統採用嚴格的「同一設備掃兩次」物理閉環設計：

#### 步驟一：開始階段（占用設備）
1. 將送洗物投入相容設備（消毒鍋、洗衣機或烘衣機）。
2. 掃描設備上的固定 QR Code，系統提示「開始階段」。
3. 點擊確認後，機台狀態變更為「運轉中（占用）」，系統開始計時並記錄實際開始時間。

#### 步驟二：結束階段（釋放設備）
1. 機台運轉完成且衣物取出後，洗衣員**再次掃描同一台設備**之固定 QR Code。
2. 系統提示「完成階段」，點擊確認後機台立即釋放，進度推進至下一階段（例如清洗完成轉為 \`待烘衣\`）。

#### 常見處理路徑：
- **需要浸泡流程**：掃消毒鍋開始浸泡 ➔ 再掃同一消毒鍋結束浸泡 ➔ 掃洗衣機開始清洗 ➔ 再掃同一洗衣機結束清洗 ➔ 掃烘衣機開始烘乾 ➔ 再掃同一烘衣機結束烘乾 ➔ 進入 \`待取件\`。
- **一般標準流程**：掃洗衣機開始清洗 ➔ 再掃同一洗衣機結束清洗 ➔ 掃烘衣機開始烘乾 ➔ 再掃同一烘衣機結束烘乾 ➔ 進入 \`待取件\`。

> [!IMPORTANT]
> - 系統計算之「標準時間」僅供預估進度參考，所有實體階段的開始與結束**一律以洗衣員掃碼確認為準**，設備不會自動判定完成。
> - 若設備已被其他批次占用或據點不符，系統將立即阻擋操作並提示原因。

---

### 3.4 洗衣員：批次拆分、合併與裝車
- **拆分批次**：單一洗衣單若包含多種相異處理程序之分類，可在「拆分必要批次」介面中將不同分類拆為獨立批次，分別排入不同機台。
- **合併批次**：相同分類且採用相同程序之衣物可於機台操作時合併處理，系統完整保留各來源洗衣車與洗衣單關聯。
- **裝車確認**：所有設備階段完成後，預設直接進入 \`待取件\`；若作業據點啟用裝車管制，洗衣員可逐一掃描來源車卡完成裝車。

---

### 3.5 洗衣員：還原上一步（可逆操作更正）
若現場發生誤掃或誤按操作，洗衣員可於控制中心執行「還原上一步」：
- **可還原範圍**：
  1. 設備階段開始誤按（取消執行並釋放設備）。
  2. 設備階段完成誤按（保留紀錄並重新開啟該階段）。
  3. 裝回來源車誤按（恢復待裝車狀態並撤銷待取件）。
- **安全保障**：系統採用「補償事件」機制，完整保留更正歷程與原因，絕不物理刪除歷史紀錄。洗衣單一旦取件結案則不可還原。

---

### 3.6 異常事件申報
若作業過程遭遇突發狀況，可在工作台填報異常：
- **異常分類**：設備異常、設備維修、機構端事項、洗衣房端事項、待洗量超額。
- **通報效果**：系統將記錄異常並依主管設定之「通知矩陣」即時發送通知至相關人員（Email/站內通知）。

---

### 3.7 送洗人員：掃碼取件（結案）
1. 送洗人員於領取區核對已完成洗滌之洗衣車。
2. 掃描該洗衣車上的固定 QR Code。
3. 系統顯示「洗衣單已完成，請確認領回」，點擊確認取件。
4. 洗衣單狀態轉為 \`已取件\` 並正式結案，洗衣車即可用於下次送洗。

---

### 3.8 已取件歷史查詢與 3D 流程地圖導覽
- **歷史查詢 (\`/app/history\`)**：支援依日期區間、機構、洗衣單號或車號搜尋歷史已取件紀錄。點擊單號可開啟詳情彈窗，查閱完整稽核時間軸與批次歷程。
- **3D 流程地圖**：工作台即時顯示 3D 洗衣單流程主舞台，依序呈現 \`送單 ➔ 待收件 ➔ 待清洗 ➔ 消毒浸泡／清洗中 ➔ 待烘衣 ➔ 烘乾中 ➔ 待取件 ➔ 已取件\`，節點支援點選、視角旋轉與詳細階段時間戳記查看。

---

## 4. 常見問題與排除 (FAQ)

**Q1：掃描洗衣車 QR Code 出現「已有進行中的洗衣單」？**  
**A**：表示該洗衣車前一次送洗尚未完成取件結案。請先在工作台確認該車目前狀態，完成取件結案後即可重新送單。

**Q2：掃描洗衣機時提示「設備已被占用」？**  
**A**：表示該設備已有其他批次正在進行且尚未掃碼結束。請確認機台是否已清洗完畢，由前一手作業人員再次掃描機台 QR 結束階段以釋放機台。

**Q3：如果不小心掃錯機台怎麼辦？**  
**A**：請立即於控制中心點擊「還原上一步」，選擇該批次並填寫更正原因，系統即會釋放誤占之機台。
`;

export const ADMIN_GUIDE_RAW = `# 洗衣管理系統 — 管理者設定手冊 (Admin Guide)

**適用對象**：系統管理員與洗衣主管  
**管理後台範圍**：\`/app/admin/*\`  
**版本**：v0.1.0  
**更新日期**：2026-08-31

---

## 1. 系統管理員與洗衣主管角色管理邊界

- **系統管理員 (\`system_administrator\`)**：系統最高管理角色，預設帳號為 \`admin\`（通知信箱為 \`ad@hok.com.tw\`），具備跨作業據點之全系統營運監控、帳號與角色權限生命週期管理、程序範本發布與系統手冊管理。
- **洗衣主管 (\`laundry_supervisor\`)**：負責授權作業據點內的營運監控、機台狀態維護、流程規範與異常通報管理。
- 本系統權限完全依據登入人員所持有的「作業據點 membership」在後端進行資料隔離，維持多租戶 RLS 安全。

---

## 2. 營運總覽與戰情室 (\`/app/admin\`)

主管首頁即為即時營運戰情室，聚合以下核心看板：
- **即時營運指標 (KPI)**：今日送單量、處理中批次、待取件單量、今日已結案單量、異常通報數。
- **優先處理佇列**：即時標示滯留時間過長或逾時之洗衣單與批次。
- **流程雷達與設備雷達**：各機台（消毒鍋、洗衣機、烘衣機）當前占用率、稼動率與各洗滌階段的瓶頸分析。

---

## 3. 帳號與權限生命週期管理 (\`/app/admin/accounts\`)

系統提供嚴格且安全的內部帳號生命週期管理機制：

### 3.1 帳號新增與編輯
- **預設系統管理員**：系統出廠預設提供 \`admin\` 帳號，預設綁定通知信箱 \`ad@hok.com.tw\`，具備系統管理員與各據點主管管理權限。
- **登入名稱**：支援英數字元。系統嚴格保留建立時所輸入的**大小寫**（例如 \`WorkerA\` 與 \`workera\`），登入時必須精確相符，但全系統唯一性比對不區分大小寫（防止建立混淆帳號）。
- **通知 Email**：作為系統通知與受控復原管道，與登入名稱分離。
- **角色與 Membership**：可為同一帳號指派多個作業據點之角色（\`system_administrator\` / \`laundry_supervisor\` / \`laundry_worker\`）或送洗機構（\`institution_supervisor\`）。

### 3.2 密碼安全與強制修改
- **一次性暫時密碼**：主管建立帳號或重設密碼時，系統產生一次性強密碼。
- **首次登入強制變更**：使用者登入後會被導向密碼修改頁，未變更前工作區維持鎖定，無法進入後台。

### 3.3 帳號停用與安全刪除（墓碑機制）
- **安全刪除**：撤銷該使用者的 Supabase Auth 身分並停用所有 membership。
- **歷史完整性**：所有過去經手的洗衣單、批次操作與稽核紀錄**永久保留**，不物理抹除任何資料。
- **防呆保護**：系統嚴格禁止刪除操作者本人，亦禁止刪除任一作業據點的最後一位有效洗衣主管。

### 3.4 批次權限維護
- 支援透過 CSV 批次更新人員據點權限與狀態，重複提交具備冪等性保證。

---

## 4. 送洗機構與作業據點配對 (\`/app/admin/organizations\`)

- **送洗機構**：代表送洗單位的內部組織（例如：護理之家 A 棟、長照中心）。
- **作業據點**：實體執行洗滌並擁有設備的廠區（本館、法人）。
- **固定配對關係**：每間送洗機構必須指定一個作業據點。新建立的洗衣單會自動綁定當下的配對關係；日後調整配對不回溯既有已建立之歷史單據。

---

## 5. 洗衣車資產與固定 QR 管理 (\`/app/admin/laundry-carts\`)

- **固定資產 QR**：每台洗衣車建檔時產生唯一固定 QR Code，永久張貼於車體，非單次單號 QR。
- **功能操作**：
  - 新增車輛並指派所屬送洗機構。
  - 下載或列印車卡 QR Code 標籤。
  - 停用車輛（停用後該車 QR Code 立即失效，無法送單）。
  - 例外重發（遺失或損壞時重發，舊 QR 立即作廢並產生新版本）。

---

## 6. 洗衣設備與固定 QR 管理 (\`/app/admin/laundry-equipment\`)

- **設備類型**：消毒鍋 (\`disinfection\`)、洗衣機 (\`washing\`)、烘衣機 (\`drying\`)。
- **設備容量**：以「可容納洗衣車台數」為度量單位。排程與階段啟動時嚴格檢查累計來源車數不得超載。
- **固定 QR 標籤**：張貼於機台實體，支援列印與下載。
- **誤建設備刪除**：僅允許刪除「從未被任何批次、排程或控制點引用過」之全新誤建設備，已投入使用之設備僅可停用並保留歷史稽核。

---

## 7. 洗滌分類與程序範本版本化 (\`/app/admin/procedures\`)

系統支援動態定義多階段洗滌標準作業程序（SOP）：

### 7.1 洗滌分類管理
- 預設提供 \`消毒品\`、\`圍兜\`、\`汙衣\`、\`床簾\`、\`其他\`。
- 主管可新增分類、調整排序與停用。已使用之分類只能停用，不可刪除以維護歷史。

### 7.2 程序範本版本發布
- **程序階段配置**：可依序設定階段名稱、標準預估分鐘、所需設備類型、轉換模式（人工確認 / 計時自動）。
- **版本控制狀態**：
  - \`草稿 (draft)\`：編輯中的版本。
  - \`已發布 (published)\`：目前生效版本。**已發布版本嚴格禁止原地修改**；若需調整必須建立下一版本。
  - \`已封存 (archived)\`：歷史版本。
- **執行保障**：已在進行中之洗滌批次固定鎖定建立當時的程序版本，不受後續新版發布影響。

---

## 8. 異常事件通報矩陣 (\`/app/admin/notifications\`)

- 設定各類異常（設備故障、超量送洗等）之通報管道。
- 支援站內即時通知與 Email 外部目的地清單。
- 若外部目的地未配置，自動安全降級為站內留存，確保通報不遺失。

---

## 9. 營運分析與受控 BI 模型庫 (\`/app/admin/bi\`)

提供主管決策支援與數據報表分析，所有查詢皆受資料庫 RLS 與受控 RPC 保護：

| BI 核心模型 | 分析目的與指標 |
| :--- | :--- |
| **流程健康度** | 分析各洗滌階段的平均耗時、逾時比例與瓶頸工序。 |
| **分類工作量** | 統計各洗滌分類（消毒/圍兜/汙衣等）的件數佔比與耗用資源。 |
| **據點產能比較** | 比較本館與法人兩大作業據點的日吞吐量、設備利用率與交付達成率。 |
| **取件準備度** | 追蹤已完工待取件單據的滯留時間與機構領回效率。 |

> [!NOTE]
> BI 模組僅允許使用白名單維度（\`status\` / \`category\` / \`operating_site\`）與指標（\`order_count\` / \`batch_count\` / \`completed_count\`），禁止任意未授權 SQL 執行。
`;

export const AGENT_GUIDE_RAW = `# 洗衣管理系統 — AI Agent 技術交接手冊 (Agent Guide)

**適用對象**：接手之 AI Agent、全端工程師、系統架構師  
**版本**：v0.1.0  
**基線基準**：Next.js 16.3.0 App Router + Supabase + React 19 + Three.js  
**更新日期**：2026-08-31

---

## 1. 系統架構地圖與技術棧

\`\`\`
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
\`\`\`

---

## 2. 安全與授權架構 (Security & Auth)

### 2.1 Server-Only DAL 原則
- 瀏覽器端嚴格禁止直連 Supabase 進行任意資料庫讀取或寫入。
- 所有資料讀取必須透過 Server Component / Server-Only DAL 取得經過型別保護的 DTO；所有變更操作透過受控 Server Actions 或 Route Handler 呼叫具備明確授權的 PostgreSQL RPC。

### 2.2 Principal 解析與 React Request Cache
- \`src/lib/auth/principal.ts\` 使用 React \`cache()\` 包裹 \`getPrincipalState()\`，確保同一 RSC 渲染週期中重複呼叫 \`requirePrincipal()\` 或 \`requireRole()\` 不會產生多餘的 Auth / RPC 往返。
- 角色清單：\`system_administrator\` (系統管理員，最高權限)、\`laundry_supervisor\` (洗衣主管)、\`laundry_worker\` (洗衣員)、\`institution_supervisor\` (送洗機構主管)。
- 角色驗證函式：
  - \`requirePrincipal()\`：驗證已登入且帳號正常。
  - \`requireRole("system_administrator")\` / \`requireRole("laundry_supervisor")\`：非授權角色自動導向自身專屬入口。
  - \`requireRole("laundry_worker")\` / \`requireRole("institution_supervisor")\`。

### 2.3 RLS 跨機構與跨據點強制隔離
- **P0 RLS 合約**：\`private.has_site_access()\` 與 \`private.has_laundry_supervisor_site_access()\` 承認 \`system_administrator\`、\`laundry_supervisor\` 與 \`laundry_worker\` 之據點 membership；送洗機構主管走 \`has_institution_supervisor_access()\`。
- 預設管理員帳號：\`admin\` 綁定通知信箱 \`ad@hok.com.tw\`，具備系統管理員身分。
- 機構主管只能讀取本機構洗衣單，絕不可跨機構窺探其他機構之單據或設備。

---

## 3. 核心資料模型與領域規則

1. **作業據點 (\`operating_sites\`)**：本館與法人兩大獨立據點，設備與佇列實體分離。
2. **送洗機構 (\`institutions\`)**：與作業據點維持一對一固定配對關係。
3. **洗衣車 (\`laundry_carts\`)**：重複使用的實體載具，張貼固定 QR Code（不隨單號變更）。
4. **洗衣單 (\`laundry_orders\`)**：一台洗衣車送洗時建立的獨立作業紀錄，狀態流轉：
   \`pending_receipt (待收件) ➔ in_progress (處理中) ➔ ready_for_pickup (待取件) ➔ picked_up (已取件結案)\`。
5. **洗滌批次 (\`laundry_batches\`)**：實際進入洗滌程序的單元，可由洗衣單拆分或相容合併，支援獨立階段推進。
6. **洗衣設備 (\`laundry_equipment\`)**：消毒鍋、洗衣機、烘衣機，具備固定 QR 與洗衣車台數容量限制。
7. **程序範本與階段 (\`procedure_templates\` / \`procedure_stages\`)**：定義 SOP 階段與標準分鐘，具備 draft ➔ published ➔ archived 版本控制，已發布版本不可原地覆寫。
8. **不可變稽核與可逆更正**：所有高風險操作與狀態變更留下完整稽核日誌；更正操作使用「補償事件」還原可逆狀態，絕不物理刪除歷史。

---

## 4. 前端渲染與「秒開」效能規範

### 4.1 核心效能指標 (SLO)
- 點擊操作響應：100ms 內展現 pending / active 狀態。
- 工作台切頁：200ms 內出現新頁面殼層。
- 系統說明與技術手冊：**秒開（Zero-Lag / 0ms 外部網路請求）**。

### 4.2 秒開實作機制
1. **零資料庫相依 (Zero DB I/O)**：System Guide 內容直接以靜態結構化模組載入，不打 Supabase RPC，不等待資料庫連線。
2. **路由預取 (Intent Prefetch)**：左側選單連結使用 \`<AppLink>\`，在滑鼠懸停或視野內自動由 Next.js 進行背景預取。
3. **客戶端秒切頁籤 (Instant Tabs)**：採用 \`ModuleTabs\` 搭配 URL Hash (\`#tab=user\` / \`#tab=admin\` / \`#tab=agent\`)，切換無網路傳輸，支援本機記憶與鍵盤無障礙操作。

### 4.3 3D 流程引擎架構 (\`laundry-order-flow-3d.tsx\`)
- Three.js 只在 Client Component 動態載入，依據 DTO 推導 8 個領域階段節點。
- 採用專屬內容簽章（Content Signature）管理 Scene 生命週期，避免即時 Snapshot 更新造成畫布反覆卸載重繪。
- 完整支援 \`prefers-reduced-motion\` 與文字版節點 Fallback。

---

## 5. 測試體系與驗證命令

### 5.1 測試套件架構
- **資料庫合約測試 (\`tests/database/\`)**：使用 \`@electric-sql/pglite\` 啟動真實 in-memory PostgreSQL，套用全套 migrations 驗證 RLS、RPC 邊界、交易與冪等性（目前 26 檔 / 93 tests 通過）。
- **單元測試 (\`tests/unit/\`)**：Vitest 驗證 BI 模型解析、PWA Service Worker、訂單歷程 DTO、System Guide 完整性。
- **端到端測試 (\`tests/e2e/\`)**：Playwright 測試公開掃碼流程與登入後工作台各角色權限。

### 5.2 常用開發與驗證指令
\`\`\`bash
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
\`\`\`

---

## 6. 接手注意事項與已知限制

1. **不可繞過 RLS**：修改任何查詢或 API 時，嚴禁在客戶端直接查詢資料庫或使用 \`service_role\` 繞過權限。
2. **風格系統獨立性**：登入後風格切換（MX/AP/GS/MB/SH）純屬前端視覺呈現，絕不可將風格狀態或 GSAP 邏輯滲透至 Server-Only 資料層。
3. **不可變歷史原則**：禁止物理刪除洗衣單、批次、稽核紀錄或已投入使用之設備。
`;

export function extractSections(markdown: string): GuideSection[] {
  const lines = markdown.split("\n");
  const sections: GuideSection[] = [];
  let index = 1;

  for (const line of lines) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const rawTitle = match[2].trim();
      const cleanTitle = rawTitle.replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      const id = `sec-${index++}-${cleanTitle.slice(0, 24).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "-")}`;
      sections.push({
        id,
        title: cleanTitle,
        level,
      });
    }
  }

  return sections;
}

export const GUIDE_DOCUMENTS: GuideDocument[] = [
  {
    id: "user",
    badge: "使用者手冊",
    title: "使用者操作說明",
    subtitle: "第一線送洗人員、洗衣員與送洗機構主管日常操作完整指引",
    audience: "送洗人員 · 洗衣員 · 機構主管 · 系統管理員",
    version: "v0.1.0",
    updateDate: "2026-08-31",
    summary: "涵蓋匿名送單/取件、實體收單分類、機台掃碼操作（同一設備掃兩次）、批次拆分與合併、可逆還原上一步、異常申報與 3D 流程地圖導覽。",
    rawMarkdown: USER_GUIDE_RAW,
    sections: extractSections(USER_GUIDE_RAW),
  },
  {
    id: "admin",
    badge: "管理設定",
    title: "管理者設定說明",
    subtitle: "系統管理員與洗衣主管營運戰情室監控、資產、程序範本與帳號權限維護手冊",
    audience: "系統管理員 (預設 admin / ad@hok.com.tw) · 洗衣主管",
    version: "v0.1.0",
    updateDate: "2026-08-31",
    summary: "涵蓋營運戰情室 KPI、系統管理員角色與帳號生命週期、機構據點配對、固定資產 QR 管理、洗滌程序版本化發布、通知矩陣與受控 BI 模型庫。",
    rawMarkdown: ADMIN_GUIDE_RAW,
    sections: extractSections(ADMIN_GUIDE_RAW),
  },
  {
    id: "agent",
    badge: "AI 交接",
    title: "AI Agent 技術交接說明",
    subtitle: "架構地圖、Server-Only DAL、RLS 多租戶隔離合約與秒開效能預算規範",
    audience: "AI Agent · 開發團隊 · 系統架構師",
    version: "v0.1.0",
    updateDate: "2026-08-31",
    summary: "涵蓋 Next.js 16 App Router 架構、系統管理員與主管 RLS 策略、Three.js 3D 流程引擎、5 大視覺主題切換、秒開零延遲機制、PGlite 測試體系與出貨 Gate。",
    rawMarkdown: AGENT_GUIDE_RAW,
    sections: extractSections(AGENT_GUIDE_RAW),
  },
];
