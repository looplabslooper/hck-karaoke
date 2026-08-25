<#
.SYNOPSIS
  Contraparte de export-templates.ps1: trae templates/ + su metadata (nombre/
  hotkey) + el modelo de face swap desde un .zip a esta instalación.

.NOTES
  Correr DESPUÉS de scripts\setup.bat — necesita que ya exista data\kiosco.db
  (import-template-meta.ts escribe ahí).
#>
param(
  [string]$InFile = "$PSScriptRoot\..\templates-export.zip"
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path $InFile)) {
    Write-Error "No se encontró `"$InFile`". Pasá la ruta con -InFile si el zip está en otro lado."
    exit 1
}
if (-not (Test-Path (Join-Path $repoRoot 'data\kiosco.db'))) {
    Write-Error "No existe data\kiosco.db todavía - corré scripts\setup.bat primero (crea la base de datos)."
    exit 1
}

$stageDir = Join-Path $env:TEMP "kiosco-templates-import-$([guid]::NewGuid())"
Write-Host "Descomprimiendo $InFile..."
Expand-Archive -Path $InFile -DestinationPath $stageDir -Force

try {
    $templatesDir = Join-Path $repoRoot 'templates'
    New-Item -ItemType Directory -Force -Path $templatesDir | Out-Null
    Write-Host "Copiando templates a $templatesDir..."
    Copy-Item (Join-Path $stageDir 'templates\*') $templatesDir -Recurse -Force

    $metaFile = Join-Path $stageDir 'template-meta.json'
    if (Test-Path $metaFile) {
        Write-Host "Importando nombres/hotkeys a la base de datos..."
        Push-Location $repoRoot
        try {
            & pnpm --filter @kiosco/server exec tsx src/db/import-template-meta.ts $metaFile
            if ($LASTEXITCODE -ne 0) { throw "import-template-meta.ts falló (código $LASTEXITCODE)" }
        } finally {
            Pop-Location
        }
    }

    $modelSrc = Join-Path $stageDir 'models\inswapper_128.onnx'
    if (Test-Path $modelSrc) {
        $modelDst = Join-Path $repoRoot 'pipeline\models\inswapper_128.onnx'
        New-Item -ItemType Directory -Force -Path (Split-Path $modelDst) | Out-Null
        Write-Host "Copiando el modelo de face swap (~530MB, puede tardar un poco)..."
        Copy-Item $modelSrc $modelDst -Force
    } else {
        Write-Warning "El zip no traía el modelo de face swap - los templates 'faceswap' no van a funcionar hasta conseguirlo aparte (ver gotcha en CLAUDE.md)."
    }
} finally {
    Remove-Item $stageDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Listo. Si el server ya estaba corriendo, reinicialo (pnpm dev / pnpm start) para que tome los templates nuevos."
