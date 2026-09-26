param([Parameter(Mandatory)][string]$OutputPath, [Parameter(Mandatory)][string]$StopMarker)

$ErrorActionPreference = "Continue"
$names = @("peer0.insurer.blockinsure.test", "orderer.blockinsure.test", "couchdb.insurer.blockinsure.test")
$chaincodeName = & docker ps --format '{{.Names}}' | Where-Object { $_ -match '^dev-peer0\.insurer\.blockinsure\.test-insurance-contract_1\.4\.0-phase2-' } | Select-Object -First 1
if ($chaincodeName) { $names += $chaincodeName }
while (Test-Path -LiteralPath $StopMarker) {
  $observedAt = [DateTimeOffset]::UtcNow.ToString("o")
  $lines = & docker stats --no-stream --format '{{json .}}' $names 2>$null
  foreach ($line in $lines) {
    try {
      $item = $line | ConvertFrom-Json
      [pscustomobject]@{
        observedAt = $observedAt
        name = $item.Name
        cpuPercent = $item.CPUPerc
        memoryUsage = $item.MemUsage
        memoryPercent = $item.MemPerc
        networkIO = $item.NetIO
        blockIO = $item.BlockIO
      } | ConvertTo-Json -Compress | Add-Content -LiteralPath $OutputPath -Encoding utf8
    }
    catch { }
  }
  Start-Sleep -Seconds 5
}
