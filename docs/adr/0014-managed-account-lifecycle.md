---
status: accepted
---

# 由正式系統管理帳號生命週期

洗衣主管需要在正式介面完成新增、編輯、權限、密碼及刪除，不再依賴日常操作 Supabase Dashboard。

登入帳號保存管理者輸入的大小寫，唯一索引使用 `lower(login_name)` 防止易混淆重複；登入先用不分大小寫的
內部 Auth Email 驗證密碼，再以授權資料中的 `login_name` 驗證使用者輸入大小寫完全一致。錯誤時只回傳通用
帳密失敗，不提供帳號列舉訊息。

Supabase Auth Admin API 只由 Next.js Server Action 透過 `SUPABASE_SERVICE_ROLE_KEY` 呼叫。瀏覽器只提交
經 Zod 驗證的表單資料；每個 Action 重新驗證洗衣主管角色，資料庫 RPC 再驗角色、完整管理範圍、冪等鍵、
最後主管及自我操作限制。密碼不進入 public schema、RPC payload、URL、稽核或日誌。

新增帳號先建立 Auth 使用者，再以使用者 JWT 呼叫具範圍的資料庫 RPC；資料庫失敗時補償刪除新 Auth 身分。
登入名稱異動同步修改 Auth Email，失敗時回復原 Email。密碼重設只允許啟用且未刪除帳號，設定一次性強密碼
並要求下次登入修改。

刪除採安全退休：資料庫先在交易內停用帳號及全部 membership、標記 `deleted_at` 並寫稽核，接著撤銷 Auth
身分。即使外部 Auth 清理暫時失敗，RLS 與授權 RPC 已拒絕該帳號；墓碑、作業關聯及稽核永久保留。
