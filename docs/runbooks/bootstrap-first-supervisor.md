# 啟用初始 `admin` 洗衣主管

本流程只用於全新正式 Supabase 專案。資料庫 migration 已建立 `MAIN / 本館` 與
`CORP / 法人` 兩個作業據點後，先建立 `admin` 的 profile 與 membership，再到
Supabase Authentication 建立密碼身分。

## 重要安全規則

- `admin` 是一般登入帳號，權限只來自 laundry supervisor membership，不是資料庫超級使用者。
- 不使用 `9999`。暫時密碼必須由密碼管理器隨機產生，至少 12 字元並含大小寫、數字與符號。
- 密碼只在 Supabase Authentication 的建立使用者畫面輸入；不可放進 SQL、GitHub、Vercel 或文件。
- 日常登入只輸入 `admin`。`admin@auth.wash-room.invalid` 是 Supabase Auth 的內部識別，不寄信。
- 真實 Email 只存為通知／人工復原聯絡管道；目前密碼復原由管理者在 Supabase Dashboard 重設。

## 1. 確認 migration 已推送

PowerShell 請輸入真正的 project ref，不可保留尖括號：

```text
npx supabase link --project-ref 你的專案REF
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase migration list --linked
```

例如 project ref 是 `sovrsaemicgfthakjdxe`，正確指令是：

```text
npx supabase link --project-ref sovrsaemicgfthakjdxe
```

## 2. 在 SQL Editor 建立兩個據點 membership

開啟 Supabase Dashboard 的 SQL Editor，只把 `your-notice@example.com` 換成實際通知 Email。
兩個 request UUID 由資料庫產生，不需要自行準備。

```sql
begin;

select *
from public.bootstrap_first_password_laundry_supervisor(
  'admin',
  'your-notice@example.com',
  'MAIN',
  gen_random_uuid()
);

select *
from public.bootstrap_first_password_laundry_supervisor(
  'admin',
  'your-notice@example.com',
  'CORP',
  gen_random_uuid()
);

commit;
```

此時 `admin` 仍為 onboarding 鎖定狀態，不會開放任何營運 RPC。不要直接手動修改
`active` 或 `must_change_password`。

## 3. 在 Supabase Authentication 建立 Auth user

1. 進入「Authentication > Users」。
2. 選擇「Add user / Create new user」。
3. Email 輸入 `admin@auth.wash-room.invalid`。
4. Password 輸入密碼管理器產生的一次性強密碼。
5. 啟用 Auto Confirm／確認 Email，然後建立使用者。
6. 不要把這組暫時密碼貼進 SQL 或儲存於 repository。

## 4. 首次登入與驗證

1. 開啟 Vercel 正式網址的 `/login`。
2. 登入帳號輸入 `admin`，密碼輸入一次性暫時密碼。
3. 系統必須先導向「設定新的登入密碼」，不能直接看到主管工作台。
4. 輸入目前暫時密碼與新的強密碼；成功後才會進入洗衣主管工作台。
5. 確認目前授權同時顯示 `MAIN / 本館` 與 `CORP / 法人`。

## 5. 建立其他登入帳號

首位主管完成 bootstrap 後，其他帳號一律從系統的「帳號與權限管理」模組建立，包含內部
Auth 身分、profile、角色範圍與一次性強密碼；不需要再到 Supabase Authentication 手動新增
使用者。批次權限維護也只接受已由此模組建立且已綁定 Auth 的帳號，不會產生未綁定 profile。

目前首位 `admin` 與後續由模組建立的帳號都由資料庫強制首次換密碼；一次性密碼只在建立或
重設當下輸入，系統不保存明文。
