# 系統說明操作參考

這份參考文件是 `system-guide` Skill 的詳細操作契約。

## 目標

分析目前專案，維護一套面向三種讀者的 System Guide：

1. `user-guide.md` — 前台使用、角色、前置條件、導覽、操作流程、欄位、驗證、錯誤與常見問題。
2. `admin-guide.md` — 後台設定、角色、權限、整合、資料操作、維護、備份、錯誤與復原。
3. `agent-guide.md` — 架構、模組邊界、相依性、資料與事件流程、API、資料模型、慣例、命令、測試、部署、近期變更、風險、未知資訊與證據。

Markdown 檔案是內容來源。如果專案有合適的前台，則透過簡單的 System Guide 頁面呈現相同的文件，通常使用 `/system-guide`。

## 自動探索

將目前專案視為 `PROJECT_ROOT`，自動偵測：

- 框架、程式語言、套件管理器與進入點；
- 前台路由、後端 API、服務、資料模型、驗證與授權；
- 測試、Lint、型別檢查、建置、開發與部署命令；
- README、docs、變更紀錄、ADR、工單與既有說明文件；
- 目前分支、基礎分支、未提交變更、近期提交與相關差異。

可選的專案設定可以位於 `system-guide.config.yaml` 或 `system-guide.config.yml`：

```yaml
systemGuide:
  mode: AUDIT_ONLY
  outputDir: docs/system-guide
  frontendRoute: /system-guide
  language: zh-TW
  baseBranch: main
  roles:
    user: [viewer, member]
    admin: [approver, owner]
    agent: [developer, maintainer, devops]
  scan:
    exclude: [node_modules, vendor, dist, build, coverage, .git]
```

未指定的值會自動探索。預設語言為繁體中文（`zh-TW`）。

## 證據與正確性

證據優先順序如下：

1. 可執行程式碼與設定；
2. 測試，以及可觀察的路由或 API；
3. 專案文件與變更紀錄；
4. Git 歷史、分支差異與工單。

重要的技術判斷要記錄檔案路徑、行號或具名符號。如果 Git 或某項來源無法取得，必須明確說明。當程式碼與文件不一致時，回報差異，不要默默選擇其中一方。

## 輸出位置與自動產生區塊

除非專案已有固定的文件位置，否則使用 `docs/system-guide/`，並維持以下結構：

```text
docs/system-guide/
├── README.md
├── user-guide.md
├── admin-guide.md
└── agent-guide.md
```

使用以下標記包住自動產生的內容，讓手動內容在更新時保留：

```markdown
<!-- SYSTEM-GUIDE:GENERATED:START -->
自動產生的內容
<!-- SYSTEM-GUIDE:GENERATED:END -->

<!-- SYSTEM-GUIDE:MANUAL:START -->
手動維護的內容；請保留
<!-- SYSTEM-GUIDE:MANUAL:END -->
```

`README.md` 是索引與執行摘要，記錄模式、分析時間、專案與掃描範圍、產生的檔案、前台整合、驗證結果、未知資訊、未解問題與下一步。

## 前台 System Guide

在 `APPLY` 模式中，整合最小且相容的唯讀頁面或路由：

- 使用既有的版面、元件、CSS、驗證與授權；
- 透過簡單的連結或分頁呈現三份說明；
- 支援標題、段落、清單、表格與程式碼區塊；
- 同時適用於桌面與行動裝置；
- 將 CSS 限定在 System Guide 介面範圍內；
- 使用既有角色名稱，並在後端或伺服器邊界強制存取控制，不可只靠隱藏前台連結；
- 在建置時、透過既有安全文件 API，或使用侵入性最低的專案原生方式載入 Markdown；
- 清理 Markdown 輸出，拒絕不安全的 HTML 與 JavaScript。

如果專案沒有前台或授權系統，保留文件並回報無法整合的部分。

## 變更範圍

允許變更：

- 三份說明與索引；
- System Guide 頁面、元件、安全的文件載入、範圍限定的 CSS、測試、設定、路由註冊與權限註冊。

不要變更商業規則、資料庫結構或資料、無關頁面、核心登入系統或無關相依套件。實作說明功能時，不要進行大範圍重構。

## 模式

### AUDIT_ONLY

不要建立、修改或刪除專案檔案。回傳架構摘要、預計產生的文件內容與檔案清單、前台方案、權限模型、證據、驗證計畫、風險與未解問題。

### APPLY

先分析，再只修改允許範圍內的檔案。盡可能重用既有的說明介面、保留手動區塊、執行適用的 Lint、型別檢查、測試、建置與路由檢查，並回報每個建立、修改、略過與失敗的項目。

## 完成檢查表

- 三份面向不同讀者的說明，已涵蓋目前可確認的事實；
- 使用者說明避免不必要的實作細節；
- 管理者說明解釋設定與權限；
- AI Agent 說明包含架構、變更交接、證據、命令、風險與未知資訊；
- 在可行時，前台使用相同的 Markdown 來源；
- 角色可見性與 Markdown 安全性已被強制執行；
- 既有檢查沒有退化；
- 執行摘要列出剩餘未知資訊與後續工作。
