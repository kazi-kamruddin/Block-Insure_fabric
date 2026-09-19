[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
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
foreach ($profile in $profiles) {
  $env:ORACLE_E2E_SCENARIO = $profile.Scenario
  $env:PLAYWRIGHT_OUTPUT_DIR = Join-Path $artifactRoot $profile.Name
  $started = [DateTimeOffset]::UtcNow
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  Push-Location $webRoot
  try {
    & npm run test:e2e -- e2e/oracle-workflow.spec.ts --grep $profile.Grep
    $exitCode = $LASTEXITCODE
  }
  finally { Pop-Location }
  $stopwatch.Stop()
  $measurements += [pscustomobject]@{
    profile = $profile.Name
    scenario = $profile.Scenario
    startedAt = $started.ToString("o")
    elapsedMs = $stopwatch.ElapsedMilliseconds
    passed = ($exitCode -eq 0)
  }
  if ($exitCode -ne 0) { break }
}
Remove-Item Env:ORACLE_E2E_SCENARIO -ErrorAction SilentlyContinue
Remove-Item Env:PLAYWRIGHT_OUTPUT_DIR -ErrorAction SilentlyContinue
$report = [pscustomobject]@{
  schemaVersion = 1
  generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
  artifactRoot = $artifactRelativeRoot
  measurements = $measurements
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportRoot "latest.json") -Encoding utf8
if ($measurements.Where({ -not $_.passed }).Count -gt 0) { throw "One or more Oracle fault profiles failed" }
