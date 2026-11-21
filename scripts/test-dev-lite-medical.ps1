[CmdletBinding()]
param([switch]$Activate, [switch]$CouchDB)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root 'apps/web'
$profile = if ($CouchDB) { 'dev-lite-couchdb' } else { 'dev-lite' }
$orderers = @(& docker ps --filter 'label=com.docker.compose.service=orderer' --format '{{.ID}}')
if ($LASTEXITCODE -ne 0 -or $orderers.Count -ne 1) {
    throw 'Expected exactly one active Fabric orderer before running a medical rehearsal.'
}
$selectedOrderers = @(& docker ps --filter 'label=com.docker.compose.service=orderer' `
    --filter "label=com.docker.compose.project=block-insure-$profile" --format '{{.ID}}')
if ($LASTEXITCODE -ne 0 -or $selectedOrderers.Count -ne 1 -or $selectedOrderers[0] -ne $orderers[0]) {
    throw "Expected only the block-insure-$profile orderer before running a medical rehearsal."
}
$health = Invoke-RestMethod 'http://127.0.0.1:3219/api/fabric/health'
if ($health.channel -ne 'insurance-dev-lite-190' -or $health.schemaVersion -ne 15) {
    throw 'Dev-lite medical health must confirm its channel and schema.'
}
$output = Join-Path $root ("data/$profile/medical-rehearsal/" + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff'))
$env:FABRIC_CHANNEL_NAME = 'insurance-dev-lite-190'
$env:DEV_LITE_ACTIVATE = if ($Activate) { 'true' } else { 'false' }
$env:MEDICAL_FINAL_PAYMENT = 'true'
$env:MEDICAL_REVIEW_LIVE = 'false'
$env:MEDICAL_DEADLINE_LIVE = 'false'
$env:DEV_LITE_DUPLICATE_REVIEW = 'false'
# The routine journey records the realistic BDT 50,000-120,000 benchmark for
# its service category, or reuses the identical range an earlier run recorded.
$env:MEDICAL_BENCHMARK_EXISTS = 'false'
$env:PLAYWRIGHT_OUTPUT_DIR = Join-Path $output 'routine'
$browser = Join-Path $web 'node_modules/@playwright/test/cli.js'
$config = Join-Path $web 'playwright.medical.config.ts'
& node $browser test --config $config
if ($LASTEXITCODE) { throw "Routine rehearsal failed. Evidence: $env:PLAYWRIGHT_OUTPUT_DIR" }

$receipts = @(Get-ChildItem -LiteralPath $env:PLAYWRIGHT_OUTPUT_DIR -Filter routine-result.json -File -Recurse)
if ($receipts.Count -ne 1) { throw 'Expected one routine settlement receipt.' }
$env:MEDICAL_PRIOR_CLAIM_ID = (Get-Content -LiteralPath $receipts[0].FullName -Raw | ConvertFrom-Json).claimId
$env:DEV_LITE_ACTIVATE = 'false'
$env:MEDICAL_FINAL_PAYMENT = 'false'
$env:MEDICAL_REVIEW_LIVE = 'true'
$env:MEDICAL_BENCHMARK_EXISTS = 'true'
$env:PLAYWRIGHT_OUTPUT_DIR = Join-Path $output 'appeal'
& node $browser test --config $config
if ($LASTEXITCODE) { throw "Appeal rehearsal failed. Evidence: $env:PLAYWRIGHT_OUTPUT_DIR" }

$env:MEDICAL_REVIEW_LIVE = 'false'
$env:DEV_LITE_DUPLICATE_REVIEW = 'true'
$env:PLAYWRIGHT_OUTPUT_DIR = Join-Path $output 'duplicate'
& node $browser test --config $config
if ($LASTEXITCODE) { throw "Duplicate rehearsal failed. Evidence: $env:PLAYWRIGHT_OUTPUT_DIR" }
Write-Output "Dev-lite medical rehearsals passed. Evidence: $output"
