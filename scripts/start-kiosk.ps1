<#
.SYNOPSIS
  Arranca el kiosco de karaoke: build de admin si hace falta, servidor Node,
  espera a que responda, y Chrome en modo --kiosk apuntando a él. Al cerrar
  Chrome, mata el servidor. Ver DECISIONES-STACK.md §6/§11.

.NOTES
  Pensado para registrarse en el Programador de tareas de Windows con
  disparador "Al iniciar sesión" (ver README al final de este archivo) —
  también se puede correr a mano para probar antes de instalarlo así.
#>

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot 'data\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$serverLog = Join-Path $logDir 'server.log'
$serverErrLog = Join-Path $logDir 'server.error.log'

# --- 1. Regla de firewall (idempotente) -------------------------------------
$ruleName = 'KaraokeKiosk'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if ($isAdmin) {
    $existing = netsh advfirewall firewall show rule name="$ruleName" 2>&1 | Out-String
    if ($existing -match 'No rules match') {
        Write-Host "Creando regla de firewall '$ruleName' (puerto 8080/TCP, perfil privado)..."
        netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=8080 profile=private | Out-Null
    }
} else {
    Write-Warning "No corriendo como administrador — se salteó la regla de firewall. Si los celulares no llegan al kiosco desde la LAN (Fase 2), correr este script como admin al menos una vez."
}

# --- 2. Build de admin si no existe -----------------------------------------
$adminDist = Join-Path $repoRoot 'apps\admin\dist'
if (-not (Test-Path (Join-Path $adminDist 'index.html'))) {
    Write-Host "No hay build de apps/admin todavía — compilando (pnpm build)..."
    Push-Location $repoRoot
    try {
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw "pnpm build falló (código $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
}

# --- 3. Arrancar el servidor -------------------------------------------------
Write-Host "Arrancando el servidor (log en $serverLog)..."
$serverProc = Start-Process -FilePath 'pnpm' -ArgumentList @('start') `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $serverLog `
    -RedirectStandardError $serverErrLog `
    -WindowStyle Hidden -PassThru

function Stop-Server {
    if ($serverProc -and -not $serverProc.HasExited) {
        Write-Host "Cerrando el servidor (PID $($serverProc.Id))..."
        Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
        # pnpm en Windows no siempre reenvía la señal al proceso node hijo —
        # rematamos por puerto para no dejar nada colgado (ver gotcha en
        # CLAUDE.md sobre procesos node.exe viejos en :8080).
        Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    }
}

# --- 4. Esperar a que /health responda --------------------------------------
$deadline = (Get-Date).AddSeconds(30)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    try {
        $resp = Invoke-WebRequest -Uri 'http://localhost:8080/health' -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
}
if (-not $healthy) {
    Write-Error "El servidor no respondió en :8080/health a tiempo — revisar $serverErrLog"
    Stop-Server
    exit 1
}
Write-Host "Servidor arriba."

# --- 5. Lanzar Chrome en modo kiosco -----------------------------------------
$chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
    Write-Error "No se encontró Chrome instalado en las rutas esperadas: $($chromeCandidates -join ', ')"
    Stop-Server
    exit 1
}

$profileDir = "$env:LOCALAPPDATA\KaraokeKiosk\chrome-profile"
$chromeArgs = @(
    '--kiosk'
    '--app=http://localhost:8080/'
    "--user-data-dir=$profileDir"
    '--autoplay-policy=no-user-gesture-required'
    '--disable-session-crashed-bubble'
    '--disable-infobars'
    '--noerrdialogs'
    '--use-angle=d3d11'
)

Write-Host "Abriendo Chrome en modo kiosco..."
try {
    $chromeProc = Start-Process -FilePath $chrome -ArgumentList $chromeArgs -PassThru
    $chromeProc.WaitForExit()
} finally {
    # Se ejecuta también si Chrome se cierra con Alt+F4, se cuelga la sesión,
    # o el script se corta a mano (Ctrl+C) — nunca deja el servidor huérfano.
    Stop-Server
}

<#
.CÓMO REGISTRAR EL ARRANQUE AUTOMÁTICO (Programador de tareas)
No lo ejecuta este script solo — es un cambio de sistema que el usuario debe
confirmar. Desde una PowerShell como administrador, UNA vez:

  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
               -Argument '-NoProfile -ExecutionPolicy Bypass -File "E:\Work\scripts\start-kiosk.ps1"'
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  Register-ScheduledTask -TaskName 'KaraokeKiosk' -Action $action -Trigger $trigger `
    -RunLevel Highest -Description 'Arranca el kiosco de karaoke al iniciar sesión.'

Para sacarlo: Unregister-ScheduledTask -TaskName 'KaraokeKiosk' -Confirm:$false
Para probarlo sin esperar al próximo login: Start-ScheduledTask -TaskName 'KaraokeKiosk'
#>
