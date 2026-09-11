---
name: system-guide
description: 分析目前專案，建立或更新使用者、管理者與 AI Agent 的系統說明，並可選擇加入前台 System Guide 頁面。
metadata:
  short-description: 產生並維護完整的系統說明
---

# 系統說明

當使用者要求撰寫系統文件、說明前台使用方式、描述後台管理設定、準備 AI Agent 交接資料，或更新 System Guide 時，使用此 Skill。

目前工作目錄就是專案根目錄。使用者不需要提供提示詞路徑、文件路徑或冗長的指令內容。

## 模式選擇

- `audit`、`analyze`、`review` 或 `inspect` 代表 `AUDIT_ONLY`：檢查專案並回報預計產生的文件與整合變更，不修改檔案。
- `apply`、`build`、`create`、`update` 或明確要求實作 System Guide，代表 `APPLY`：建立或更新允許範圍內的文件與前台整合。
- 如果無法判斷模式，使用 `AUDIT_ONLY`。

開始工作前，先閱讀 [references/system-guide-prompt.md](references/system-guide-prompt.md)。如果專案內有 `docs/system-guide/system-guide-prompt.md`，在讀取套件內參考文件後，再讀取這份專案文件；專案設定可以調整路徑與角色，但不能降低本 Skill 的安全與證據要求。

## 快速流程

1. 偵測專案根目錄、框架、套件管理器、路由、API、資料模型、驗證、角色、測試、建置指令與既有文件。
2. 偵測 `system-guide.config.yaml`、`system-guide.config.yml` 或等效的專案設定；未指定的值使用自動探索。
3. 分析目前程式碼，並在可取得時檢查目前分支、基礎分支差異、未提交變更、近期提交、變更紀錄與工單。
4. 在 `AUDIT_ONLY` 模式中，回報預計建立的檔案、證據、前台路由、權限、風險與未解問題。
5. 在 `APPLY` 模式中，建立或更新三份 Markdown 說明，以及最小且相容的前台 System Guide 介面，然後執行專案適用的檢查。
6. 結束時提供執行摘要，列出實際檔案、證據、檢查結果、未知資訊與後續工作。

## 不可省略的界線

- 以可執行程式碼與設定作為主要證據。缺少的事實標記為未知或推論，絕不自行捏造行為。
- 優先重用專案既有的框架、元件、CSS、路由、驗證、授權與文件載入方式。
- 變更範圍限於 System Guide 文件、前台介面、文件載入程式、路由與權限註冊、範圍限定的 CSS、設定與測試。
- 保留手動維護的文件區塊，只更新明確標記為自動產生的區塊。
- 使用者說明要實用且避免不必要的技術細節；詳細路徑、資料流、命令、變更歷史與風險放在 AI Agent 說明。
- 對渲染的 Markdown 進行清理，阻擋不安全的 HTML 或 JavaScript。
- 如果無法整合前台，仍依選定模式產生允許的 Markdown 計畫或文件，並回報限制原因。

## 標準使用方式

最簡單的一句話是：

```text
請自動分析目前專案，產生使用者操作說明、管理者設定說明與 AI Agent 交接說明，並整合成前台可使用的 System Guide。
```

預期的使用者指令是：

```text
$system-guide audit
$system-guide apply
```

「分析目前系統的說明」、「建立系統說明」或「更新 AI Agent 交接文件」等自然語言，也應自動路由到此 Skill。
