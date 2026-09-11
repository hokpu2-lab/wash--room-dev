# wash-room 新人開發交接與環境規劃報告

> 同一 GitHub Repository／獨立 Branch／Preview 環境之三個月交接方案
>
> 報告日期：2026 年 8 月 29 日

> **建議結論**
>
> 採用同一個 GitHub Repository，由新人加入 Collaborator，建立 `dev-newbie` 作為三個月獨立開發分支；`main` 保留為正式主線。Vercel 以 Preview Deployment 驗證 `dev-newbie`，Supabase 則以獨立 Development Project 避免測試操作影響正式資料。

## 一、報告目的

本報告針對 wash-room 專案即將交由新人獨立開發約三個月、之後再由原開發者收回繼續維護的情境，提出一套兼顧簡化操作、權限控管、正式環境安全與後續收回成本的交接方案。

核心原則是：程式碼可以讓新人獨立發展，但正式主線與正式資料環境必須保持可控。

## 二、建議方案摘要

| 層級 | 正式環境 | 新人開發環境 |
| --- | --- | --- |
| GitHub | `main` | `dev-newbie` |
| Vercel | Production Deployment | Preview Deployment |
| Supabase | Production Project | Development Project |

> **關鍵原則**
>
> Git Branch 只能隔離程式碼，不能隔離資料庫。若 `dev-newbie` 與 `main` 同時連到 Production Supabase，新人的測試操作仍可能影響正式資料，因此 Supabase 建議至少拆成 Production 與 Development 兩個 Project。

## 三、選擇此方案的理由

- 比 Fork 簡單：不需要維護第二個 GitHub Repository，也不需要另外處理 upstream 同步。
- 比 Template 容易收回：新人所有 commit 都留在同一個 Repo，三個月後可直接 Pull Request／Merge 回 `main`。
- 新人帳號需求最低：第一階段只需要 GitHub 帳號；Vercel、Supabase 帳號可視工作內容再決定是否提供。
- 你仍保有正式主線：`main` 由你管理，新人的日常修改集中在 `dev-newbie`。
- 部署成本低：同一個 Vercel Project 可使用 branch Preview Deployment，避免重建整套前端部署。

## 四、權限與責任分工

| 項目 | 你／管理者 | 新人 |
| --- | --- | --- |
| GitHub | 管理 Repo、`main`、權限與最終合併 | 在 `dev-newbie` 開發、commit、push |
| Vercel | 保管 Production 設定與環境變數 | 使用 Preview URL 測試 |
| Supabase | 管理 Production 與 Development Project | 只使用 Development；需要時才開 Dashboard 權限 |
| 交接收回 | Review、測試、Merge、移除權限 | 提交完整程式碼、migration 與說明 |

## 五、管理者首次設定

### 5.1 建立新人開發 Branch

1. 在 GitHub 的 wash-room Repository 由 `main` 建立 `dev-newbie`。
2. 確認 `dev-newbie` 建立當下與 `main` 指向相同版本。
3. 後續新人所有修改以 `dev-newbie` 為主要工作分支。

### 5.2 邀請新人為 Collaborator

1. 請新人先申請 GitHub 帳號並完成 Email 驗證。
2. GitHub Repository → Settings → Collaborators → Add people。
3. 輸入新人 GitHub 帳號並發送邀請。
4. 新人接受後即可 clone、pull 與 push Repository。

### 5.3 保護 main

若目前 GitHub 方案支援 Branch Rules／Rulesets，建議對 `main` 設定 Pull Request、禁止 force push、禁止刪除等保護。若方案限制無法啟用，至少應在交接規範中明訂新人不得直接 push `main`。

> **建議工作規則**
>
> 新人只修改 `dev-newbie`；`main` 由你負責 Review 與最終合併。

## 六、新人從零開始的準備方式

新人目前沒有任何開發服務帳號時，第一天只要求完成 GitHub 帳號即可。Vercel 與 Supabase 先由你保管，待新人確實需要查閱部署或資料庫後台時再開放。

### 6.1 新人需安裝

- Git
- Node.js 24.x（wash-room 專案要求）
- VS Code、Codex 或其他開發工具

### 6.2 第一次 clone

```bash
git clone https://github.com/Kevin72333/wash-room.git
cd wash-room
git switch dev-newbie
git branch
npm ci
```

確認 `git branch` 顯示目前位於 `dev-newbie` 後，再開始修改程式。

## 七、新人每日開發 SOP

### 7.1 每天開始

```bash
git switch dev-newbie
git pull origin dev-newbie
```

### 7.2 修改完成

```bash
git status
git add .
git commit -m "feat: 修改功能說明"
git push origin dev-newbie
```

> **新人只需要記住一件事**
>
> 工作開始前先確認自己在 `dev-newbie`；不要直接在 `main` 開發或 push。

## 八、Vercel 使用方式

建議保留目前 wash-room 的 Vercel Project，`main` 維持 Production Deployment；`dev-newbie` push 後使用 Vercel 的 Preview Deployment 做測試。

- 新人一開始不需要 Vercel 帳號，只要能取得 Preview URL 即可測試。
- 若日後需要查看 Build Log、Deployment Log 或設定 Environment Variables，再考慮加入 Vercel Team／Project。
- Production Environment Variables 由你保管，避免新人誤改正式設定。

## 九、Supabase 使用方式

Supabase 是此交接方案最重要的隔離點。建議建立獨立 Development Project，並讓 `dev-newbie` 的本機與 Preview 環境連到 Development Supabase。

- Production Supabase：正式網站與 `main` 使用。
- Development Supabase：新人本機與 `dev-newbie` Preview 使用。
- 新人若只改 UI／一般程式邏輯，可暫時不給 Supabase Dashboard 帳號。
- 若新人要修改 Table、Schema、RLS、RPC、Auth、Migration，再建立 Supabase 帳號並只加入 Development Project。

> **禁止事項**
>
> 不要把 Production Supabase 的敏感金鑰直接交給新人，也不要把 `.env.local` commit 到 GitHub。

## 十、三個月後收回流程

1. 新人停止新增功能，先將 `dev-newbie` 更新到完整可測試狀態。
2. 執行專案既有 lint、typecheck、test、build，以及此期間新增功能的相關測試。
3. 新人整理新增 migration、環境變數、部署需求與重大設計決策。
4. 由 `dev-newbie` 建立 Pull Request 至 `main`。
5. 你 Review 程式碼、處理衝突，並在 Development／Preview 環境完成驗證。
6. 確認可上線後 Merge `main`，再部署至正式 Vercel／Production Supabase。
7. 完成後刪除 `dev-newbie`（可選）並移除新人 Collaborator 權限。

## 十一、主要風險與控管

| 風險 | 建議控管 |
| --- | --- |
| 新人誤改 `main` | Branch Rules／Rulesets；日常規定只在 `dev-newbie` 工作。 |
| 測試污染正式資料 | `dev-newbie` 使用 Development Supabase，不共用 Production 資料庫。 |
| 三個月後難以合併 | 新人持續 commit，避免一次性大改；重大架構變更要留下說明。 |
| 環境變數外洩 | `.env.local` 不進 Git；Production Secret 由管理者保管。 |
| 離開後仍有權限 | 收回當日移除 GitHub／Vercel／Supabase 對應權限並盤點存取。 |

## 十二、交接驗收清單

- [ ] 新人 GitHub 帳號已建立並接受 Collaborator 邀請。
- [ ] `dev-newbie` 已由 `main` 建立。
- [ ] 新人本機已成功切至 `dev-newbie` 並可 `npm ci`。
- [ ] Vercel `dev-newbie` Preview 可正常開啟。
- [ ] Development Supabase 已與 Production 隔離。
- [ ] 新人明確知道不得直接修改 `main` 與 Production Secret。
- [ ] 三個月後收回時會以 Pull Request／Review／Merge 流程處理。

## 十三、結論

就目前「新人獨立開發約三個月，之後由你收回繼續開發」的需求而言，同一 Repository＋`dev-newbie` 是最容易操作與收回的方案。它避免 Fork／Template 所帶來的多 Repo 管理負擔，同時保留 `main` 的正式主線。

真正需要額外隔離的是資料環境：Vercel 可沿用同一 Project 的 Preview Deployment；Supabase 則建議準備一套 Development Project。此配置能在不過度增加帳號與維護成本的前提下，兼顧新人獨立工作與正式環境安全。
