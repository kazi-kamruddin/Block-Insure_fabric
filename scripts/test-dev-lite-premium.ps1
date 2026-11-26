[CmdletBinding()]
param()
# Live dev-lite premium journey: bank linking, first premium by OTP, EFT
# mandates, automatic collection, an insufficient-funds bounce and a retry.
# Start the app first with .\scripts\dev-lite-app.ps1.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root 'apps/web'
$orderers = @(& docker ps --filter 'label=com.docker.compose.service=orderer' --format '{{.ID}}')
$selected = @(& docker ps --filter 'label=com.docker.compose.service=orderer' --filter 'label=com.docker.compose.project=block-insure-dev-lite' --format '{{.ID}}')
if ($LASTEXITCODE -ne 0 -or $orderers.Count -ne 1 -or $selected.Count -ne 1 -or $selected[0] -ne $orderers[0]) {
    throw 'Expected only the block-insure-dev-lite orderer before running the premium journey.'
}
$health = Invoke-RestMethod 'http://127.0.0.1:3219/api/fabric/health'
if ($health.channel -ne 'insurance-dev-lite-190' -or $health.schemaVersion -ne 15) {
    throw 'Dev-lite health must confirm its channel and schema.'
}
$env:FABRIC_CHANNEL_NAME = 'insurance-dev-lite-190'
$env:PLAYWRIGHT_OUTPUT_DIR = Join-Path $root ('data/dev-lite/premium-journey/' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff'))
& node (Join-Path $web 'node_modules/@playwright/test/cli.js') test --config (Join-Path $web 'playwright.premium.config.ts')
if ($LASTEXITCODE) { throw "Premium journey failed. Evidence: $env:PLAYWRIGHT_OUTPUT_DIR" }
Write-Output "Dev-lite premium journey passed. Evidence: $env:PLAYWRIGHT_OUTPUT_DIR"
