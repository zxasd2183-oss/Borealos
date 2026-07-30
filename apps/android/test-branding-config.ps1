$ErrorActionPreference = "Stop"

$config = Get-Content -Raw (Join-Path $PSScriptRoot "app\build.gradle")

if ($config -notmatch 'applicationId\s+"dev\.borealos\.app"') {
    throw "Phone applicationId must use the Borealos namespace."
}

if ($config -notmatch 'applicationId\s+"dev\.borealos\.pad"') {
    throw "Tablet applicationId must use the Borealos namespace."
}

Write-Output "Android Borealos branding configuration tests passed."
