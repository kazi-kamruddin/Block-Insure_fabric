# Run against the existing LevelDB dev-lite network and app, without real email.
[CmdletBinding()]
param([ValidatePattern('^\d{8}T\d{10}Z$')][string]$ResumeRun)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root 'apps/web'
$relativeOutput = 'data/dev-lite/onboarding-20261121/{0}' -f ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssffffZ'))
$output = Join-Path $root $relativeOutput

& git -C $root -c "safe.directory=$($root.Replace('\', '/'))" check-ignore -q -- "$relativeOutput/report.json"
if ($LASTEXITCODE -ne 0) { throw 'The onboarding evidence directory is not git-ignored.' }
$definitions = @()
for ($attempt = 0; $attempt -lt 2; $attempt++) {
    $readback = @(& wsl.exe -d Ubuntu --cd $root --exec bash network/scripts/read-dev-lite-sequence.sh)
    $readbackExit = $LASTEXITCODE
    $definitions = @($readback | Where-Object { $_ -match '^(insurer|hospital|auditor|bank|oracle) Version: ' })
    if ($readbackExit -eq 0 -and $definitions.Count -eq 5) { break }
    if ($attempt -eq 1) { throw 'Could not read the five LevelDB dev-lite peer definitions.' }
    Start-Sleep -Seconds 2
}
foreach ($org in @('insurer', 'hospital', 'auditor', 'bank', 'oracle')) {
    if ($definitions -notcontains "$org Version: 1.9.0, Sequence: 7") { throw "$org does not report dev-lite Version 1.9.0, Sequence 7." }
}
$health = Invoke-RestMethod 'http://127.0.0.1:3219/api/fabric/health' -TimeoutSec 30
if ($health.channel -ne 'insurance-dev-lite-190' -or $health.chaincode -ne 'insurance-contract' -or $health.schemaVersion -ne 15) {
    throw 'The running app did not report the LevelDB dev-lite channel and schema 15.'
}
$browser = Join-Path $web 'node_modules/@playwright/test/cli.js'
if (-not (Test-Path -LiteralPath $browser -PathType Leaf)) { throw 'The existing Playwright installation is missing.' }

New-Item -ItemType Directory -Path $output | Out-Null
$definitions | Set-Content -LiteralPath (Join-Path $output 'peer-definitions.txt') -Encoding Ascii
$overrides = @{
    FABRIC_CHANNEL_NAME = 'insurance-dev-lite-190'
    ONBOARDING_REPO_ROOT = $root
    ONBOARDING_RESULTS_DIR = $output
    ONBOARDING_RESUME_RUN = $ResumeRun
    DEBUG = ''
    PWDEBUG = ''
    PLAYWRIGHT_NO_COPY_PROMPT = '1'
    PW_TEST_HTML_REPORT_OPEN = 'never'
    NODE_DEBUG = ''
}
$previous = @{}
foreach ($name in $overrides.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $overrides[$name], 'Process')
}
try {
    & node $browser test --config (Join-Path $web 'playwright.onboarding.config.ts')
    if ($LASTEXITCODE -ne 0) { throw "Dev-lite onboarding rehearsal failed. Evidence: $output" }
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
Write-Output "Dev-lite onboarding rehearsal passed. Evidence: $output"
