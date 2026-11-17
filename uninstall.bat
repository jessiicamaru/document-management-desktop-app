@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Study Docs - Uninstall / Go cai dat

rem ==================================================================
rem  Removes Study Docs from this PC. Double-click this file to run it.
rem  Messages are shown in English and Vietnamese.
rem   1. Close the app if it is running
rem   2. Find its uninstaller in the registry and run it silently
rem   3. Ask before deleting the app's data (settings, tags, notes)
rem      in %APPDATA%\Study Docs
rem  Your document folders (.md, .html, .pdf...) are NEVER touched.
rem ==================================================================

set "APP_NAME=Study Docs"
set "APP_EXE=Study Docs.exe"
set "UNINST_EXE=Uninstall Study Docs.exe"
set "DATA_DIR=%APPDATA%\Study Docs"
set "UNINST="
set "INSTALL_DIR="

echo.
echo  ===== Uninstall %APP_NAME% / Gỡ cài đặt %APP_NAME% =====
echo.

rem ---------- 1. Close the app if it is running ----------
tasklist /fi "imagename eq %APP_EXE%" 2>nul | findstr /i /c:"%APP_EXE%" >nul
if errorlevel 1 goto :find
echo  - Closing %APP_NAME%... / Đang tắt %APP_NAME%...
taskkill /im "%APP_EXE%" /f >nul 2>&1
timeout /t 2 /nobreak >nul

rem ---------- 2. Find the uninstaller ----------
:find
rem The registry first: it works even if the app was installed in another folder.
call :find_in_registry HKCU
if not defined UNINST call :find_in_registry HKLM

rem Not in the registry: try the default install folder.
if defined UNINST goto :uninstall
set "INSTALL_DIR=%LOCALAPPDATA%\Programs\Study Docs"
if exist "%INSTALL_DIR%\%UNINST_EXE%" set UNINST="%INSTALL_DIR%\%UNINST_EXE%"
if defined UNINST goto :uninstall

echo  - %APP_NAME% is not installed on this PC; skipping this step.
echo    Không thấy %APP_NAME% được cài trên máy, bỏ qua bước gỡ app.
goto :appdata

:uninstall
echo  - Uninstalling... / Đang gỡ app...
start "" /wait %UNINST% /S
rem The NSIS uninstaller copies itself to a temp folder before running,
rem so wait until the app's files are gone, for up to about 30 seconds.
if not defined INSTALL_DIR goto :uninstalled
for /l %%i in (1,1,30) do (
  if not exist "%INSTALL_DIR%\%APP_EXE%" goto :uninstalled
  timeout /t 1 /nobreak >nul
)
echo    Warning: the app may not be fully removed; check Settings, Apps.
echo    Cảnh báo: app có vẻ chưa gỡ hết, kiểm tra lại trong Settings, Apps.
goto :appdata
:uninstalled
echo    Uninstalled. / Đã gỡ app.

rem ---------- 3. The app's data ----------
:appdata
echo.
if not exist "%DATA_DIR%" goto :done
echo  The app's data (settings, tags, study status, highlights, notes, cache) is in:
echo  Dữ liệu của app (settings, tag, trạng thái học, highlight, ghi chú, cache) nằm ở:
echo    %DATA_DIR%
echo.
echo  To keep your tags and notes: open the app, Settings, Data, "Back up to a file..." first.
echo  Muốn giữ tag và ghi chú: mở app, Cài đặt, Dữ liệu, "Sao lưu ra file..." trước khi xoá.
echo  Your document files (.md, .html, .pdf...) are NEVER deleted.
echo  File tài liệu của bạn (.md, .html, .pdf...) KHÔNG bao giờ bị xoá.
echo.
choice /c YN /m " Delete the app's data too? / Xoá luôn dữ liệu của app?"
if errorlevel 2 goto :keepdata
rmdir /s /q "%DATA_DIR%"
echo  - The app's data was deleted. / Đã xoá dữ liệu của app.
goto :done
:keepdata
echo  - The app's data was kept (a new install uses it again).
echo    Giữ lại dữ liệu của app (cài lại sẽ dùng tiếp).

:done
echo.
echo  Done. / Hoàn tất.
pause
exit /b 0


rem ------------------------------------------------------------------
rem  :find_in_registry HKCU^|HKLM
rem  Finds the Uninstall key whose DisplayName contains "Study Docs" and
rem  reads its UninstallString and InstallLocation.
rem ------------------------------------------------------------------
:find_in_registry
set "KEY="
for /f "delims=" %%K in ('reg query "%~1\Software\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "%APP_NAME%" /d 2^>nul ^| findstr /b /i "HKEY_"') do set "KEY=%%K"
if not defined KEY goto :eof
for /f "tokens=2,*" %%A in ('reg query "%KEY%" /v UninstallString 2^>nul ^| findstr /i "UninstallString"') do set "UNINST=%%B"
for /f "tokens=2,*" %%A in ('reg query "%KEY%" /v InstallLocation 2^>nul ^| findstr /i "InstallLocation"') do set "INSTALL_DIR=%%B"
rem electron-builder doesn't write InstallLocation: take the folder of the uninstaller.
if not defined INSTALL_DIR for %%P in (%UNINST%) do if not defined INSTALL_DIR set "INSTALL_DIR=%%~dpP"
rem Only accept it if it really is Study Docs' uninstaller.
echo %UNINST% | findstr /i /c:"%UNINST_EXE%" >nul || (set "UNINST=" & set "INSTALL_DIR=")
goto :eof
