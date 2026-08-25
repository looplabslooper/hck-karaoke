<#
.SYNOPSIS
  Empaqueta lo que hace falta para mover Fun Box a otra instalación: la
  carpeta templates/ (video + mapeo por escena), su metadata (nombre/hotkey,
  vive en la base de datos, no en el filesystem) y el modelo de face swap
  (pipeline/models/inswapper_128.onnx, ~530MB). Ninguno de los tres viaja
  con git (ver .gitignore/CLAUDE.md) — es justo lo que un `git clone` +
  scripts\setup.bat no traen.

.NOTES
  El .zip resultante NO va al repo — es pesado y .gitignore ya lo excluye.
  Copialo a la otra PC por afuera de git (USB, red, la nube que uses) y ahí
  corré scripts\import-templates.ps1.
#>
param(
  [string]$OutFile = "$PSScriptRoot\..\templates-export.zip"
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$templatesDir = Join-Path $repoRoot 'templates'
$modelPath = Join-Path $repoRoot 'pipeline\models\inswapper_128.onnx'

if (-not (Test-Path $templatesDir) -or @(Get-ChildItem $templatesDir -ErrorAction SilentlyContinue).Count -eq 0) {
    Write-Error "No hay nada en templates\ para exportar."
    exit 1
}

$stageDir = Join-Path $env:TEMP "kiosco-templates-export-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $stageDir | Out-Null
try {
    Write-Host "Copiando templates..."
    Copy-Item $templatesDir (Join-Path $stageDir 'templates') -Recurse

    Write-Host "Exportando nombres/hotkeys desde la base de datos..."
    Push-Location $repoRoot
    try {
        & pnpm --filter @kiosco/server exec tsx src/db/export-template-meta.ts (Join-Path $stageDir 'template-meta.json')
        if ($LASTEXITCODE -ne 0) { throw "export-template-meta.ts falló (código $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }

    if (Test-Path $modelPath) {
        Write-Host "Empaquetando también el modelo de face swap (inswapper_128.onnx, ~530MB) - hace falta para que los templates 'faceswap' funcionen en la otra PC."
        New-Item -ItemType Directory -Path (Join-Path $stageDir 'models') | Out-Null
        Copy-Item $modelPath (Join-Path $stageDir 'models\inswapper_128.onnx')
    } else {
        Write-Warning "No se encontró pipeline\models\inswapper_128.onnx en esta PC - los templates 'faceswap' no van a andar en la otra instalación hasta conseguirlo aparte (ver gotcha en CLAUDE.md)."
    }

    if (Test-Path $OutFile) { Remove-Item $OutFile -Force }
    Write-Host "Comprimiendo a $OutFile (puede tardar un rato si va el modelo)..."
    Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $OutFile -CompressionLevel Optimal
} finally {
    Remove-Item $stageDir -Recurse -Force -ErrorAction SilentlyContinue
}

$sizeMb = [math]::Round((Get-Item $OutFile).Length / 1MB, 1)
Write-Host ""
Write-Host "Listo: $OutFile ($sizeMb MB)"
Write-Host "Este archivo NO va al repo. Copialo aparte (USB, red, la nube) junto con el clone del repo, y en la otra PC corré scripts\import-templates.ps1 despues de scripts\setup.bat."
