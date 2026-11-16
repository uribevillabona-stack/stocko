; Ajustes del instalador de Stocko para Windows (electron-builder lo incluye solo).
;
; Smart App Control (Windows 11) bloquea programas sin firma digital cuando se
; ejecutan desde la carpeta temporal. El instalador estándar copia ahí el
; desinstalador de la versión anterior para actualizar, Windows lo bloquea y la
; actualización falla. Por eso:
;   - Stocko se cierra con calma (guarda la copia del día y detiene la base).
;   - Al actualizar se quitan los archivos del programa anterior (nunca los
;     datos, que están en %LOCALAPPDATA%\Stocko) y se instala encima, sin pasar
;     por el desinstalador anterior. Quedan los archivos que la versión nueva
;     sobrescribe; los de "resources" se borran antes para no mezclar versiones.
;   - El desinstalador queda registrado para ejecutarse en su propia carpeta.
; Solo se cierran los procesos del usuario actual (otro usuario del PC puede
; tener su propio Stocko abierto).

!macro customCheckAppRunning
  ; 1. Pedir a Stocko que se cierre como si se cerrara la ventana.
  nsExec::Exec '"$SYSDIR\cmd.exe" /C taskkill /FI "USERNAME eq %USERNAME%" /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $R0
  StrCpy $R1 0
  stocko_wait:
    nsExec::Exec '"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /NH | find /I "${APP_EXECUTABLE_FILENAME}"'
    Pop $R0
    StrCmp $R0 "0" 0 stocko_closed
    IntOp $R1 $R1 + 1
    IntCmp $R1 90 stocko_force 0 stocko_force
    Sleep 500
    Goto stocko_wait
  stocko_force:
    ; 45 s sin cerrar: se fuerza (la base se recupera sola al abrir).
    nsExec::Exec '"$SYSDIR\cmd.exe" /C taskkill /F /T /FI "USERNAME eq %USERNAME%" /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $R0
    Sleep 1500
  stocko_closed:

  ; 2. Si quedó la base abierta (cierre forzado), se detiene para liberar sus archivos.
  IfFileExists "$INSTDIR\resources\pgsql\bin\pg_ctl.exe" 0 stocko_pg_done
  IfFileExists "$LOCALAPPDATA\Stocko\pgdata\postmaster.pid" 0 stocko_pg_done
    nsExec::Exec '"$INSTDIR\resources\pgsql\bin\pg_ctl.exe" stop -D "$LOCALAPPDATA\Stocko\pgdata" -m fast -w -t 30'
    Pop $R0
  stocko_pg_done:

  !ifndef BUILD_UNINSTALLER
    ; 3. Actualización: se instala encima sin ejecutar el desinstalador anterior
    ;    (también si la versión anterior está en otra carpeta).
    ReadRegStr $R3 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    StrCmp $R3 "" 0 +2
      StrCpy $R3 "$INSTDIR"
    IfFileExists "$R3\${APP_EXECUTABLE_FILENAME}" stocko_update 0
    IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" stocko_update stocko_fresh
    stocko_update:
      RMDir /r "$R3\resources"
      RMDir /r "$INSTDIR\resources"
      ; La versión anterior estaba en otra carpeta: se quita entera, pero solo si
      ; de verdad es una instalación de Stocko (tiene el programa y su desinstalador).
      StrCmp "$R3" "$INSTDIR" stocko_same_dir 0
      IfFileExists "$R3\${APP_EXECUTABLE_FILENAME}" 0 stocko_same_dir
      IfFileExists "$R3\${UNINSTALL_FILENAME}" 0 stocko_same_dir
        RMDir /r "$R3"
      stocko_same_dir:
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"
    stocko_fresh:
  !endif
!macroend

!macro customUnInstall
  ; Con _?= el desinstalador no puede borrarse a sí mismo: un cmd lo borra
  ; (y la carpeta, si quedó vacía) unos segundos después de que termine.
  ; El cmd arranca fuera de la carpeta: si su directorio actual fuera esa carpeta, no podría borrarla.
  SetOutPath "$TEMP"
  Exec '"$SYSDIR\cmd.exe" /C cd /d "$TEMP" & ping -n 4 127.0.0.1 >nul & del /f /q "$INSTDIR\${UNINSTALL_FILENAME}" & rmdir "$INSTDIR"'
!macroend

!macro customInstall
  ; Stocko.exe es el electron.exe original sin modificar (así Smart App Control lo
  ; reconoce): el ícono de Stocko se pone en los accesos directos y en "Programas".
  IfFileExists "$newStartMenuLink" 0 +3
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\stocko.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  IfFileExists "$newDesktopLink" 0 +3
    CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\stocko.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayIcon" "$INSTDIR\resources\stocko.ico"
  ; El desinstalador corre en su carpeta (_?=) en vez de copiarse a TEMP.
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$INSTDIR\${UNINSTALL_FILENAME}" /currentuser _?=$INSTDIR'
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '"$INSTDIR\${UNINSTALL_FILENAME}" /currentuser /S _?=$INSTDIR'
!macroend
