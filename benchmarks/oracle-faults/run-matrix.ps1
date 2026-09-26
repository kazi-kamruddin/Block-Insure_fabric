[CmdletBinding()]
param([ValidateRange(1, 20)][int]$Repetitions = 3)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$experimentChannel = "insurance-phase2-20260926"
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "network/channel-artifacts/$experimentChannel.block") -PathType Leaf)) {
  throw "Create the Phase 2 experiment channel before running the fault matrix"
}
$env:FABRIC_CHANNEL_NAME = $experimentChannel
$env:ORACLE_STATE_ROOT = Join-Path $projectRoot "data/oracle-phase2"
$env:EVENT_PROJECTION_ROOT = Join-Path $projectRoot "data/events-phase2"
$env:EVIDENCE_STORAGE_ROOT = Join-Path $projectRoot "data/evidence-phase2"
$webRoot = Join-Path $projectRoot "apps/web"
$reportRoot = Join-Path $PSScriptRoot "reports"
New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null
$runId = [DateTimeOffset]::UtcNow.ToString("yyyyMMddTHHmmssfffZ")
$artifactRelativeRoot = "artifacts/$runId"
$artifactRoot = Join-Path $reportRoot $artifactRelativeRoot

$profiles = @(
  @{ Name = "baseline"; Scenario = "baseline"; Grep = "2-of-3 Oracle quorum automatically" },
  @{ Name = "negative"; Scenario = "baseline"; Grep = "matching negative Oracle" },
  @{ Name = "one-unavailable"; Scenario = "one-unavailable"; Grep = "@oracle-one-unavailable" },
  @{ Name = "conflict"; Scenario = "conflict"; Grep = "@oracle-conflict" },
  @{ Name = "timeout"; Scenario = "timeout"; Grep = "@oracle-timeout" }
)

$measurements = @()
for ($repetition = 1; $repetition -le $Repetitions; $repetition++) {
  $orderedProfiles = @($profiles[($repetition - 1)..($profiles.Count - 1)])
  if ($repetition -gt 1) { $orderedProfiles += @($profiles[0..($repetition - 2)]) }
  foreach ($profile in $orderedProfiles) {
  $env:ORACLE_E2E_SCENARIO = $profile.Scenario
  $trialRoot = Join-Path $artifactRoot ("trial-$repetition-$($profile.Name)")
  New-Item -ItemType Directory -Force -Path $trialRoot | Out-Null
  $env:PLAYWRIGHT_OUTPUT_DIR = $trialRoot
  $logPath = Join-Path $trialRoot "playwright.log"
  $started = [DateTimeOffset]::UtcNow
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  Push-Location $webRoot
  try {
    & npm run test:e2e -- e2e/oracle-workflow.spec.ts --grep $profile.Grep 2>&1 | Tee-Object -LiteralPath $logPath
    $exitCode = $LASTEXITCODE
  }
  finally { Pop-Location }
  $stopwatch.Stop()
  $measurements += [pscustomobject]@{
    repetition = $repetition
    orderIndex = [array]::IndexOf($orderedProfiles, $profile) + 1
    profile = $profile.Name
    scenario = $profile.Scenario
    startedAt = $started.ToString("o")
    elapsedMs = $stopwatch.ElapsedMilliseconds
    passed = ($exitCode -eq 0 -and (Get-Content -LiteralPath $logPath -Raw) -match '(?m)^\s*1 passed')
    log = (Join-Path $artifactRelativeRoot "trial-$repetition-$($profile.Name)/playwright.log").Replace('\', '/')
  }
  }
}
Remove-Item Env:ORACLE_E2E_SCENARIO -ErrorAction SilentlyContinue
Remove-Item Env:PLAYWRIGHT_OUTPUT_DIR -ErrorAction SilentlyContinue
$report = [pscustomobject]@{
  schemaVersion = 2
  generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
  channel = $experimentChannel
  repetitions = $Repetitions
  orderStrategy = "cyclic rotation across profiles"
  artifactRoot = $artifactRelativeRoot
  measurements = $measurements
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportRoot "latest.json") -Encoding utf8
if ($measurements.Where({ -not $_.passed }).Count -gt 0) { throw "One or more Oracle fault profiles failed" }
