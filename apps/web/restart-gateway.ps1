$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*node_modules\openclaw\dist*' }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force }
schtasks /Run /TN 'OpenClaw Gateway' | Out-Null
Start-Sleep -Seconds 25
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:18789/" -UseBasicParsing -TimeoutSec 5
  Write-Output ("GATEWAY HTTP " + $r.StatusCode)
} catch {
  if ($_.Exception.Response) { Write-Output ("GATEWAY HTTP " + [int]$_.Exception.Response.StatusCode) }
  else { Write-Output ("ERR " + $_.Exception.Message) }
}
