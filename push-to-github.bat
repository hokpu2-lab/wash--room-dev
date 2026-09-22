@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "PATH=C:\Users\user\AppData\Local\Programs\gh;C:\Users\user\AppData\Local\Programs\nodejs;C:\Users\user\AppData\Local\Programs\git\cmd;%PATH%"

echo ========================================================
echo  [wash-room GitHub 自動推送與 Vercel 部署]
echo ========================================================
echo.

:: 檢查是否已登入 GitHub
gh auth status >nul 2>&1
if errorlevel 1 (
    echo [提示] 尚未登入 GitHub，正在為您開啟瀏覽器一鍵授權登入...
    echo.
    gh auth login -h github.com -p https -w
    echo.
)

:: 設定 git credential helper
gh auth setup-git >nul 2>&1

echo 正在將最新 main 分支推送至 GitHub...
echo.

git push origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo ========================================================
    echo  [成功] 程式碼已成功推送至 GitHub main 分支！
    echo  Vercel 正在自動開始建置與發布新版本！
    echo ========================================================
) else (
    echo.
    echo ========================================================
    echo  [失敗] 推送未完成，請檢查上方錯誤訊息。
    echo ========================================================
)

echo.
pause
