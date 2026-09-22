@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "PATH=C:\Users\user\AppData\Local\Programs\nodejs;C:\Users\user\AppData\Local\Programs\git\cmd;%PATH%"

:: 取得目前分支名稱
for /f "delims=" %%i in ('git rev-parse --abbrev-ref HEAD') do set "CURRENT_BRANCH=%%i"

echo ========================================================
echo  [GitHub 推送工具 - 自動新分支]
echo ========================================================
echo  目前所在分支: %CURRENT_BRANCH%
echo.

:: 若目前在 main 分支且有未推送 commit 或變更，自動產生新的時間戳分支
if "%CURRENT_BRANCH%"=="main" (
    for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set "dt=%%I"
    set "TIMESTAMP=!dt:~0,8!-!dt:~8,4!"
    set "NEW_BRANCH=feat/update-!TIMESTAMP!"
    echo  [自動建立新分支] !NEW_BRANCH!
    git checkout -b !NEW_BRANCH!
    set "CURRENT_BRANCH=!NEW_BRANCH!"
    echo.
)

echo  準備推送分支 [!CURRENT_BRANCH!] 至 GitHub 遠端儲存庫...
echo.

git push -u origin !CURRENT_BRANCH!

if %ERRORLEVEL% equ 0 (
    echo.
    echo ========================================================
    echo  [成功] 已成功將新分支 [!CURRENT_BRANCH!] 推送至 GitHub！
    echo  您可以在 GitHub 上直接建立 Pull Request (PR) 進行合併。
    echo ========================================================
) else (
    echo.
    echo ========================================================
    echo  [提示] 若需要輸入驗證，請輸入您的 GitHub 帳號與 Personal Access Token。
    echo ========================================================
)

echo.
pause
