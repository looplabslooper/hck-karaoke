@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

echo.
echo === Kiosco de Karaoke - instalacion ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node en el PATH.
  echo Instala Node 22.x ^(ver .nvmrc^) desde https://nodejs.org/ o con nvm-windows.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -e "console.log(process.versions.node)"') do set NODE_MAJOR=%%v
if not "!NODE_MAJOR!"=="22" (
  echo [ERROR] Se detecto Node !NODE_MAJOR!.x - este proyecto necesita Node 22.x exacto.
  echo better-sqlite3 no tiene binario precompilado para otras versiones en este entorno
  echo ^(y compilarlo a mano pide Visual Studio Build Tools^).
  echo Instala Node 22 ^(ver .nvmrc^) y volve a correr este script.
  pause
  exit /b 1
)
echo [OK] Node !NODE_MAJOR!.x

where pnpm >nul 2>nul
if errorlevel 1 (
  echo Habilitando pnpm via Corepack...
  call corepack enable
  if errorlevel 1 (
    echo [ERROR] No se pudo habilitar pnpm. Instalalo a mano: npm install -g pnpm
    pause
    exit /b 1
  )
)

echo.
echo Instalando dependencias ^(pnpm install^)...
call pnpm install
if errorlevel 1 (
  echo [ERROR] pnpm install fallo.
  pause
  exit /b 1
)

if not exist "data\kiosco.db" (
  echo.
  echo Creando la base de datos...
  call pnpm --filter @kiosco/server db:migrate
  if errorlevel 1 (
    echo [ERROR] La migracion fallo.
    pause
    exit /b 1
  )
  call pnpm --filter @kiosco/server db:seed
) else (
  echo.
  echo Ya existe data\kiosco.db - no se toca ^(evita pisar tu catalogo^).
)

echo.
echo === Pipeline de Python (sincronia de letras + Fun Box) ===
where uv >nul 2>nul
if errorlevel 1 (
  echo [AVISO] No se encontro "uv" en el PATH - se salta esta parte.
  echo Sin esto no vas a poder generar/sincronizar letras nuevas ni usar Fun Box.
  echo Instalalo despues desde https://docs.astral.sh/uv/ y corre "uv sync" dentro de pipeline\.
  goto :after_pipeline
)

set "FACESWAP_EXTRA=--extra faceswap"
set "GPU_NAMES="
for /f "delims=" %%g in ('powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController).Name -join ';'" 2^>nul') do set "GPU_NAMES=%%g"
echo %GPU_NAMES% | findstr /I "NVIDIA" >nul
if errorlevel 1 (
  echo.
  echo [AVISO] No se detecto una placa de video NVIDIA en esta PC.
  echo   Placas encontradas: %GPU_NAMES%
  echo.
  echo   - La sincronizacion de letras ^(WhisperX^) anda igual, mas lenta, corriendo en CPU.
  echo   - "Cara en el escenario" / Fun Box ^(face swap con IA^) NO es usable sin GPU NVIDIA:
  echo     probado en este proyecto, un clip de unos segundos tarda 13+ minutos en CPU.
  echo     Instalarlo igual baja como 1GB extra de dependencias CUDA que no vas a poder usar.
  echo.
  choice /C SNC /M "Instalar face swap igual (S), instalar sin face swap (N), o no instalar el pipeline ahora (C)"
  if errorlevel 3 goto :after_pipeline
  if errorlevel 2 (
    echo.
    echo Deshabilitando face swap en la configuracion...
    call pnpm --filter @kiosco/server db:set-faceswap 0
    set "FACESWAP_EXTRA="
  )
) else (
  echo [OK] Placa NVIDIA detectada: %GPU_NAMES%
)

echo.
echo Instalando dependencias de Python ^(uv sync %FACESWAP_EXTRA%^)...
pushd pipeline
call uv sync %FACESWAP_EXTRA%
if errorlevel 1 (
  echo [AVISO] La instalacion del pipeline de Python fallo - la app principal funciona igual,
  echo pero no vas a poder generar/sincronizar letras hasta resolverlo. Revisa el error de arriba.
)
popd

:after_pipeline

if exist "templates-export.zip" (
  echo.
  echo Se encontro templates-export.zip junto al repo.
  choice /C SN /M "Importar los templates de Fun Box ahora"
  if errorlevel 2 (
    echo Salteado - despues podes correr scripts\import-templates.ps1 a mano.
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\import-templates.ps1"
  )
)

echo.
echo === Listo ===
echo Server en :8080, admin en :5175 cuando corra "pnpm dev".
echo.
choice /C SN /M "Arrancar ahora en modo desarrollo (pnpm dev)"
if errorlevel 2 (
  echo.
  echo Cuando quieras arrancar: pnpm dev
  pause
  exit /b 0
)
call pnpm dev
