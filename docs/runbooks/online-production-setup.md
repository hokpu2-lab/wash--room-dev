# 正式環境線上建置清單

本清單以 GitHub、Supabase Dashboard、Vercel Dashboard 為主；只在推送資料庫 migration 時
使用 PowerShell。正式 schema 不直接貼到 SQL Editor，SQL Editor 只執行首位主管 bootstrap。

## A. GitHub

1. 確認 `wash-room` repository 是 Private，預設分支是 `main`。
2. 確認最新程式已在 `main`，且 GitHub Actions 全部通過。
3. 不要把 `.env.local`、Supabase secret key、資料庫密碼或任何使用者密碼加入 repository。

## B. Supabase 專案

1. 在 Supabase Dashboard 建立正式專案，保存 project ref 與資料庫密碼。
2. 在「Project Settings > API」取得 Project URL、publishable key 與 service role secret。publishable
   key 可供瀏覽器使用；service role 只貼到 Vercel 的 server-only 環境變數，不得提交 Git、加上
   `NEXT_PUBLIC_`、出現在畫面或傳給使用者。
3. 在 Authentication 設定：
   - Email provider：啟用。
   - Allow new users to sign up：停用。
   - Google 與其他 provider：停用。
   - Minimum password length：12。
   - Required characters：大寫、小寫、數字、符號。
   - Require current password when changing password：啟用。
4. 在專案資料夾執行：

   ```text
   npx supabase login
   npx supabase link --project-ref 你的專案REF
   npx supabase db push --linked --dry-run
   npx supabase db push --linked
   npx supabase migration list --linked
   ```

   `--project-ref` 後面只接代碼；例如 `sovrsaemicgfthakjdxe`。不要輸入
   `npx supabase link --sovrsaemicgfthakjdxe <正式專案REF>`。
5. 依照[首位主管 bootstrap](bootstrap-first-supervisor.md)在 SQL Editor 建立 `admin` 的兩個據點權限，
   再到 Authentication > Users 建立內部 Email 與一次性強密碼。

Supabase 官方建議讓 migration 檔與遠端 migration history 保持同步；Dashboard 的 SQL/Table Editor
直接改 schema 會繞過 migration history，因此後續 schema 變更一律新增 migration 並執行 `db push`。

## C. Vercel

1. 在 Vercel Dashboard 選「Add New > Project」，匯入 GitHub 的 private `wash-room` repository。
2. Framework Preset 選 Next.js，Root Directory 保持 repository root，Production Branch 選 `main`。
3. 在 Environment Variables 為 Production 設定：

   ```text
   NEXT_PUBLIC_SUPABASE_URL=https://你的專案REF.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=你的 publishable key
   NEXT_PUBLIC_APP_URL=https://你的正式網域
   SUPABASE_SERVICE_ROLE_KEY=你的 service role secret
   ```

   `NEXT_PUBLIC_APP_URL` 不可有結尾 `/`、path、query 或 fragment。`SUPABASE_SERVICE_ROLE_KEY`
   只供帳號管理 Server Action 呼叫 Auth Admin API，名稱不得加上 `NEXT_PUBLIC_`。
4. 按 Deploy。若環境變數之後有修改，必須 Redeploy；Vercel 不會把新值套到舊 deployment。
5. 部署完成後把正式 URL 回填 `NEXT_PUBLIC_APP_URL`，再執行一次 Production Redeploy。

## D. 上線驗收

1. 開啟 `/status`，確認三個公開環境變數都顯示已設定，且頁面不顯示實際 key。
2. 開啟 `/login`，確認只有登入帳號與密碼，沒有 Google 按鈕。
3. 用 `admin` 與一次性強密碼登入，確認先被導向換密碼頁。
4. 換密碼後確認可進主管工作台，並可看到 `MAIN`、`CORP` 兩個授權據點。
5. 登出後重新登入，確認新密碼有效、暫時密碼失效。
6. 從「主管管理 → 帳號與權限管理」建立大小寫混合的測試帳號，確認原樣顯示、大小寫不同時拒絕
   登入；再完成權限修改、暫時密碼重設及安全刪除，確認帳號無法登入且歷史資料仍保留。
7. 在 Vercel Deployments 確認 Production deployment 來自 `main`，在 GitHub 確認同一 commit 的 Actions 通過。

## 官方參考

- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase password security](https://supabase.com/docs/guides/auth/password-security)
- [Supabase users](https://supabase.com/docs/guides/auth/users)
- [Vercel Git deployments](https://vercel.com/docs/git)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [GitHub 建立 repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)
