; KardiSynch Windows installer (NSIS).
;
; Per-user, no administrator rights, fixed install folder. Built in CI from the verified app image:
;   makensis /DVERSION=3.0.0 /DAPPDIR=<app image dir> /DOUTFILE=KardiSynch-Setup-3.0.0.exe installer.nsi
;
; It does three jobs:
;   1. installs (or replaces) KardiSynch and its shortcuts;
;   2. REMOVES THE ELECTRON VERSION (v2.x) if it is installed, so the user ends up with one KardiSynch.
;      The Electron app's data (its settings database, and the clinic's _DATA folder) is never touched;
;      the new app imports the old settings on its first start;
;   3. when started by an update (silent, "--updated"), starts the app again at the end.
; The same installer is what the Electron app's own updater downloads (via latest.yml), so existing
; installations move over without anyone running anything by hand.

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!insertmacro GetParameters
!insertmacro GetOptions

!ifndef VERSION
  !error "Pass /DVERSION=x.y.z"
!endif
; VIProductVersion needs X.X.X.X, so a pre-release suffix (3.0.0-beta.2) must be stripped for it.
!ifndef NUMVERSION
  !define NUMVERSION "${VERSION}"
!endif
!ifndef APPDIR
  !error "Pass /DAPPDIR=<folder with kardisynch.exe>"
!endif
!ifndef OUTFILE
  !define OUTFILE "KardiSynch-Setup-${VERSION}.exe"
!endif

!define APPNAME "KardiSynch"
!define EXENAME "kardisynch.exe"
; Not the key electron-builder used, so the two never overwrite each other's entry.
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\KardiSynch3"

Name "${APPNAME}"
OutFile "${OUTFILE}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\KardiSynch"
BrandingText "${APPNAME} ${VERSION}"
SetCompressor /SOLID lzma
VIProductVersion "${NUMVERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Start ${APPNAME}"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "German"

Var Updated

Function .onInit
  ; A started-by-update run: wait a moment for the old app (which exits right after launching us) to let go of its files.
  ${GetParameters} $0
  StrCpy $Updated "0"
  ClearErrors
  ${GetOptions} $0 "--updated" $1
  IfErrors +2 0
    StrCpy $Updated "1"
  ClearErrors
  ${GetOptions} $0 "--force-run" $1
  IfErrors +2 0
    StrCpy $Updated "1"
  IfSilent 0 +2
    Sleep 3000
FunctionEnd

; Uninstalls the Electron build (electron-builder's per-user NSIS default location) silently, keeping all user data.
Function RemoveElectronVersion
  StrCpy $2 "$LOCALAPPDATA\Programs\kardisynch"
  StrCpy $3 "$2\Uninstall kardisynch.exe"
  IfFileExists "$3" 0 done
    DetailPrint "Removing the previous version of ${APPNAME}"
    ; "_?=" makes the uninstaller run in place and return only when finished.
    ExecWait '"$3" /S _?=$2'
    Delete "$3"
    RMDir "$2"
  done:
FunctionEnd

Section "Install"
  Call RemoveElectronVersion

  ; Our own folder only; the app keeps nothing of the user's in here, so a clean replace is safe.
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${APPDIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXENAME}"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}"

  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "KardiSynch"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${EXENAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Function .onInstSuccess
  ; Silent runs have no finish page; an update (or the Electron app's updater) expects the app to come back.
  StrCmp $Updated "1" 0 done
    IfSilent 0 done
      Exec '"$INSTDIR\${EXENAME}"'
  done:
FunctionEnd

Section "Uninstall"
  ; Removes the program only. Patient data, the import folder and the app's settings stay where they are.
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\${APPNAME}.lnk"
  DeleteRegKey HKCU "${UNINSTKEY}"
  RMDir /r "$INSTDIR"
SectionEnd
