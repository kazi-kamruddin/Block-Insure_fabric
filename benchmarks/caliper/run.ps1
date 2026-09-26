[CmdletBinding()]
param([ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$RunId = "latest")

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
if ($env:FABRIC_CHANNEL_NAME -notmatch '^insurance-phase2-[a-z0-9-]+$') {
  throw "Set FABRIC_CHANNEL_NAME to an isolated insurance-phase2-* channel before running Caliper"
}
node (Join-Path $PSScriptRoot "generate-network-config.mjs")
if ($LASTEXITCODE -ne 0) { throw "Caliper network configuration generation failed" }

$reportRoot = Join-Path $PSScriptRoot "reports"
New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null
$logPath = Join-Path $reportRoot "$RunId.log"
$reportPath = "benchmarks/caliper/reports/$RunId.html"

& docker run --rm `
  -v "${projectRoot}:/hyperledger/caliper/workspace" `
  -w /hyperledger/caliper/workspace `
  -e CALIPER_BIND_SUT=fabric:fabric-gateway `
  hyperledger/caliper:0.7.1 launch manager `
  --caliper-workspace . `
  --caliper-benchconfig benchmarks/caliper/benchmark.yaml `
  --caliper-networkconfig benchmarks/caliper/generated/network.yaml `
  --caliper-report-path $reportPath `
  --caliper-flow-only-test 2>&1 | Tee-Object -LiteralPath $logPath
$dockerExit = $LASTEXITCODE
$log = Get-Content -LiteralPath $logPath -Raw
if ($dockerExit -ne 0 -or $log -notmatch "Successful rounds:\s+7") { throw "Caliper benchmark failed; inspect $logPath" }
