$pids = @()
try {
  $pids += Get-NetTCPConnection -LocalPort 18790 -State Listen -ErrorAction Stop |
    Select-Object -ExpandProperty OwningProcess
} catch {}
try {
  $pids += Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*work-ui\server.js*' } |
    Select-Object -ExpandProperty ProcessId
} catch {}
foreach ($processId in ($pids | Where-Object { $_ } | Sort-Object -Unique)) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1
wscript "C:\Users\Gateway\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\shasha-work-ui.vbs"
Start-Sleep -Seconds 3
try {
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  if (-not ([System.Management.Automation.PSTypeName]'TrustAllCertPolicy').Type) {
    Add-Type 'public class TrustAllCertPolicy : System.Net.ICertificatePolicy { public bool CheckValidationResult(System.Net.ServicePoint sp, System.Security.Cryptography.X509Certificates.X509Certificate cert, System.Net.WebRequest req, int problem) { return true; } }'
  }
  [System.Net.ServicePointManager]::CertificatePolicy = [TrustAllCertPolicy]::new()
  $r = Invoke-WebRequest -Uri "https://127.0.0.1:18790/" -UseBasicParsing -TimeoutSec 5
  Write-Output ("HTTPS " + $r.StatusCode)
} catch {
  Write-Output ("ERR " + $_.Exception.Message)
}
