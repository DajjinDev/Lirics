# Prueba REAL de YouTube Data API v3 con tu clave.
#
# La clave se pide aquí, en tu terminal, sin mostrarla: NO se guarda en ningún archivo ni se envía a
# ningún sitio salvo a googleapis.com (desde la prueba). Al terminar se borra de la sesión.
#
# Consumo de cuota: 1 búsqueda (≈100 unidades) + 1 consulta de video (≈1 unidad) — consulta tu cuota
# diaria real en Google Cloud. Ejecuta desde la raíz del proyecto:   .\scripts\probar-youtube.ps1

$ErrorActionPreference = 'Stop'

$secure = Read-Host 'Pega tu clave de YouTube Data API v3 (no se mostrará)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:LIRIKS_YT_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$informe = Join-Path $PWD 'informe-en-vivo.json'
$env:LIRIKS_LIVE = '1'
$env:LIRIKS_LIVE_REPORT = $informe

try {
  Write-Host "`nEjecutando la prueba en vivo (≈ 1,5 min: respeta los límites de iTunes y MusicBrainz)...`n"
  npx ng test --watch=false
} finally {
  # La clave no queda en la sesión.
  Remove-Item Env:LIRIKS_YT_KEY, Env:LIRIKS_LIVE, Env:LIRIKS_LIVE_REPORT -ErrorAction SilentlyContinue
}

if (Test-Path $informe) {
  Write-Host "`n=== Resultado de YouTube y LRCLIB ===" -ForegroundColor Cyan
  (Get-Content $informe -Raw | ConvertFrom-Json).notes | ForEach-Object { Write-Host " - $_" }
  Write-Host "`nInforme completo: $informe (no contiene tu clave)"
} else {
  Write-Host 'No se generó el informe: revisa los errores de arriba.' -ForegroundColor Yellow
}
