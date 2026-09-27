[CmdletBinding()]
param(
  [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$RunId = "latest",
  [ValidateSet("baseline", "robustness")][string]$Profile = "baseline"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
if ($env:FABRIC_CHANNEL_NAME -notmatch '^insurance-phase2-[a-z0-9-]+$') {
  throw "Set FABRIC_CHANNEL_NAME to an isolated insurance-phase2-* channel before running Caliper"
}
node (Join-Path $PSScriptRoot "generate-network-config.mjs")
if ($LASTEXITCODE -ne 0) { throw "Caliper network configuration generation failed" }

$reportRoot = Join-Path $projectRoot "docs/results/phase2-caliper"
New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null
$logPath = Join-Path $reportRoot "$RunId.log"
$reportPath = "docs/results/phase2-caliper/$RunId.html"
$benchmarkConfig = if ($Profile -eq "robustness") { "benchmarks/caliper/robustness.yaml" } else { "benchmarks/caliper/benchmark.yaml" }
$expectedRounds = if ($Profile -eq "robustness") { 10 } else { 19 }
$resourcePath = Join-Path $reportRoot "$RunId-resources.jsonl"
$stopMarker = Join-Path $reportRoot "$RunId-sampling.marker"
Set-Content -LiteralPath $stopMarker -Value "running"
$resourceJob = Start-Job -FilePath (Join-Path $PSScriptRoot "sample-resources.ps1") -ArgumentList $resourcePath, $stopMarker

try {
& docker run --rm `
  -v "${projectRoot}:/hyperledger/caliper/workspace" `
  -w /hyperledger/caliper/workspace `
  -e CALIPER_BIND_SUT=fabric:fabric-gateway `
  -e CALIPER_PHASE2_RUN_ID=$RunId `
  hyperledger/caliper:0.7.1 launch manager `
  --caliper-workspace . `
  --caliper-benchconfig $benchmarkConfig `
  --caliper-networkconfig benchmarks/caliper/generated/network.yaml `
  --caliper-report-path $reportPath `
  --caliper-flow-only-test 2>&1 | Tee-Object -LiteralPath $logPath
$dockerExit = $LASTEXITCODE
}
finally {
  Remove-Item -LiteralPath $stopMarker -ErrorAction SilentlyContinue
  $resourceJob | Wait-Job -Timeout 20 | Out-Null
  if ($resourceJob.State -eq "Running") { $resourceJob | Stop-Job }
  $resourceJob | Receive-Job | Out-Null
  $resourceJob | Remove-Job
}
$log = Get-Content -LiteralPath $logPath -Raw
if ($dockerExit -ne 0 -or $log -notmatch "Successful rounds:\s+$expectedRounds(?!\d)") { throw "Caliper benchmark failed; inspect $logPath" }
if (-not (Test-Path -LiteralPath $resourcePath -PathType Leaf)) { throw "Resource sampling failed; inspect $resourcePath" }
