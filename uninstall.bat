@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Go cai dat Study Docs

rem ==================================================================
rem  Go Study Docs khoi may. Double-click file nay de chay.
rem   1. Tat app neu dang mo
rem   2. Tim trinh go cai dat trong registry va chay o che do im lang
rem   3. Hoi truoc khi xoa settings/cache trong %APPDATA%\Study Docs
rem  KHONG bao gio dung toi thu muc tai lieu cua ban
rem  (file .md, .html va .docs-meta.json van giu nguyen).
rem ==================================================================

set "APP_NAME=Study Docs"
set "APP_EXE=Study Docs.exe"
set "UNINST_EXE=Uninstall Study Docs.exe"
set "DATA_DIR=%APPDATA%\Study Docs"
set "UNINST="
set "INSTALL_DIR="

echo.
echo  ===== Gỡ cài đặt %APP_NAME% =====
echo.

rem ---------- 1. Tat app neu dang chay ----------
tasklist /fi "imagename eq %APP_EXE%" 2>nul | findstr /i /c:"%APP_EXE%" >nul
if errorlevel 1 goto :find
echo  - Đang tắt %APP_NAME%...
taskkill /im "%APP_EXE%" /f >nul 2>&1
timeout /t 2 /nobreak >nul

rem ---------- 2. Tim trinh go cai dat ----------
:find
rem Tim trong registry truoc: dung ca khi ban da doi thu muc cai dat.
call :find_in_registry HKCU
if not defined UNINST call :find_in_registry HKLM

rem Khong co trong registry thi thu thu muc cai mac dinh.
if defined UNINST goto :uninstall
set "INSTALL_DIR=%LOCALAPPDATA%\Programs\Study Docs"
if exist "%INSTALL_DIR%\%UNINST_EXE%" set UNINST="%INSTALL_DIR%\%UNINST_EXE%"
if defined UNINST goto :uninstall

echo  - Không thấy %APP_NAME% được cài trên máy, bỏ qua bước gỡ app.
goto :appdata

:uninstall
echo  - Đang gỡ app...
start "" /wait %UNINST% /S
rem Trinh go NSIS tu chep sang thu muc tam roi moi chay, nen doi
rem toi khi file app bien mat, toi da khoang 30 giay.
if not defined INSTALL_DIR goto :uninstalled
for /l %%i in (1,1,30) do (
  if not exist "%INSTALL_DIR%\%APP_EXE%" goto :uninstalled
  timeout /t 1 /nobreak >nul
)
echo    Cảnh báo: app có vẻ chưa gỡ hết, kiểm tra lại trong Settings, Apps.
goto :appdata
:uninstalled
echo    Đã gỡ app.

rem ---------- 3. Settings va cache ----------
:appdata
echo.
if not exist "%DATA_DIR%" goto :done
echo  Settings và cache của app đang nằm ở:
echo    %DATA_DIR%
echo  Tài liệu, tag và trạng thái học trong thư mục tài liệu sẽ KHÔNG bị xoá.
choice /c YN /m " Xoá luôn settings và cache"
if errorlevel 2 goto :keepdata
rmdir /s /q "%DATA_DIR%"
echo  - Đã xoá settings và cache.
goto :done
:keepdata
echo  - Giữ lại settings và cache.

:done
echo.
echo  Hoàn tất.
pause
exit /b 0


rem ------------------------------------------------------------------
rem  :find_in_registry HKCU^|HKLM
rem  Tim key Uninstall co DisplayName chua "Study Docs", lay ra
rem  UninstallString va InstallLocation.
rem ------------------------------------------------------------------
:find_in_registry
set "KEY="
for /f "delims=" %%K in ('reg query "%~1\Software\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "%APP_NAME%" /d 2^>nul ^| findstr /b /i "HKEY_"') do set "KEY=%%K"
if not defined KEY goto :eof
for /f "tokens=2,*" %%A in ('reg query "%KEY%" /v UninstallString 2^>nul ^| findstr /i "UninstallString"') do set "UNINST=%%B"
for /f "tokens=2,*" %%A in ('reg query "%KEY%" /v InstallLocation 2^>nul ^| findstr /i "InstallLocation"') do set "INSTALL_DIR=%%B"
rem electron-builder khong ghi InstallLocation: lay thu muc tu duong dan trinh go.
if not defined INSTALL_DIR for %%P in (%UNINST%) do if not defined INSTALL_DIR set "INSTALL_DIR=%%~dpP"
rem Chi chap nhan neu dung la trinh go cua Study Docs.
echo %UNINST% | findstr /i /c:"%UNINST_EXE%" >nul || (set "UNINST=" & set "INSTALL_DIR=")
goto :eof
