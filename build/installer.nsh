; ============================================================
; Pin install dir to D drive (electron-builder NSIS custom hook).
;
; The user wants every future install to land in a fixed folder on
; D:.  electron-builder 26 has no nsis.installDir option, so we use
; the officially supported build/installer.nsh hook: customInit runs
; at the end of .onInit, after multiUser has computed its default
; (%LOCALAPPDATA%\Programs\...), so our StrCpy wins.
;
; The folder name matches APP_FILENAME (sbmodmanager), so
; assistedInstaller.nsh's instFilesPre does not append another
; \sbmodmanager subfolder (it checks StrContains first).
; ============================================================
!macro customInit
  StrCpy $INSTDIR "D:\Program Files\sbmodmanager"
!macroend

; ------------------------------------------------------------
; CRITICAL - lesson learned 2026-11-25 (do NOT remove this hook):
; electron-builder's default uninstaller runs `RMDir /r $INSTDIR`
; on every UPGRADE (see uninstaller.nsh).  Because the download
; library now lives at $INSTDIR\library, that wiped 14.5 GB of
; installed mod archives during a version upgrade.
; Defining customRemoveFiles REPLACES that destructive block.
; We delete only the known app payload and NEVER touch \library.
; ------------------------------------------------------------
!macro customRemoveFiles
  Delete /REBOOTOK "$INSTDIR\*.exe"
  Delete /REBOOTOK "$INSTDIR\*.dll"
  Delete /REBOOTOK "$INSTDIR\*.pak"
  Delete /REBOOTOK "$INSTDIR\*.dat"
  Delete /REBOOTOK "$INSTDIR\*.bin"
  Delete /REBOOTOK "$INSTDIR\*.json"
  Delete /REBOOTOK "$INSTDIR\*.txt"
  Delete /REBOOTOK "$INSTDIR\*.html"
  Delete /REBOOTOK "$INSTDIR\*.ico"
  RMDir /r /REBOOTOK "$INSTDIR\locales"
  RMDir /r /REBOOTOK "$INSTDIR\resources"
  ; NOTE: $INSTDIR\library is user data -- intentionally preserved.
!macroend

; Grant the Users group write access to the install folder, so the
; manager (running as invoker / medium integrity) can write the
; library subfolder.  Without this, downloads into Program Files fail.
; S-1-5-32-545 = BUILTIN\Users.
!macro customInstall
  nsExec::ExecToLog 'icacls "$INSTDIR" /grant *S-1-5-32-545:(OI)(CI)F /T'
!macroend
