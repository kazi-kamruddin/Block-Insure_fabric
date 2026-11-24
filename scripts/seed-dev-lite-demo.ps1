[CmdletBinding()]
param()
# Seeds a freshly deployed, empty LevelDB dev-lite ledger with the realistic
# demonstration set in apps/web/e2e/demo-seed.spec.ts: four partners, five
# health plans, five customers with accounts and policies, and three claims.
# Start the app first, without -Email, so codes stay on screen:
#   .\scripts\dev-lite-app.ps1 -TwoOracles -Onboarding
# The spec refuses a ledger that already has packages; it never resets anything.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root 'apps/web'
$health = Invoke-RestMethod 'http://127.0.0.1:3219/api/fabric/health' -TimeoutSec 30
if ($health.channel -ne 'insurance-dev-lite-190' -or $health.schemaVersion -ne 15) {
    throw 'Start the LevelDB dev-lite app first.'
}
$relative = 'data/dev-lite/demo-seed/' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
& git -C $root -c "safe.directory=$($root.Replace('\', '/'))" check-ignore -q -- "$relative/report.json"
if ($LASTEXITCODE -ne 0) { throw 'The seed evidence directory is not git-ignored.' }
$output = Join-Path $root $relative
New-Item -ItemType Directory -Path $output | Out-Null
$env:FABRIC_CHANNEL_NAME = 'insurance-dev-lite-190'
$env:SEED_RESULTS_DIR = $output
$env:PLAYWRIGHT_NO_COPY_PROMPT = '1'
try {
    # Windows PowerShell turns native stderr (Node warnings) into errors under 'Stop'.
    $ErrorActionPreference = 'Continue'
    & node (Join-Path $web 'node_modules/@playwright/test/cli.js') test --config (Join-Path $web 'playwright.seed.config.ts')
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($exitCode) { throw "Demonstration seed failed. Evidence: $output" }
} finally {
    Remove-Item Env:SEED_RESULTS_DIR -ErrorAction SilentlyContinue
}
Write-Output "Demonstration ledger seeded. Summary: $output\seed-summary.json"
