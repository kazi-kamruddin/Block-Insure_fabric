[CmdletBinding()]
param([switch]$SkipPremium, [switch]$SkipDeadline, [switch]$SkipBankPayout)
# Run the evening before a demo, with the network and app running
# (.\scripts\dev-lite-app.ps1). It adds new synthetic records only:
#  - Premium: policies starting tomorrow whose first premiums are EFT mandates,
#    approved and due on demo day, one well funded and one under-funded (live
#    collection, bounce and retry), plus one already paid by OTP.
#  - Deadline: a finally rejected claim whose cover can be returned live.
#  - Bank payout: a fresh routine claim, then the same stay claimed again on
#    the same policy, referred as a duplicate, approved by the panel and left
#    as an Insurer-authorized payout waiting for the Bank.
# Cover is never backdated, so nothing here can be prepared with past dates.
# The IDs are written to data/dev-lite/demo-staging/<stamp>/summary.json.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root 'apps/web'
$browser = Join-Path $web 'node_modules/@playwright/test/cli.js'
$health = Invoke-RestMethod 'http://127.0.0.1:3219/api/fabric/health'
if ($health.channel -ne 'insurance-dev-lite-190' -or $health.schemaVersion -ne 15) { throw 'Start the dev-lite app first.' }
$out = Join-Path $root ('data/dev-lite/demo-staging/' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $out -Force | Out-Null
$summary = [ordered]@{ stagedAt = [DateTime]::UtcNow.ToString('o') }
$env:FABRIC_CHANNEL_NAME = 'insurance-dev-lite-190'

function Find-Receipt([string]$Directory, [string]$Name) {
    $files = @(Get-ChildItem -LiteralPath $Directory -Filter $Name -File -Recurse)
    if ($files.Count -ne 1) { throw "Expected one $Name under $Directory" }
    Get-Content -LiteralPath $files[0].FullName -Raw | ConvertFrom-Json
}

if (-not $SkipPremium) {
    $env:PREMIUM_STAGE_ONLY = 'true'
    $env:PLAYWRIGHT_OUTPUT_DIR = Join-Path $out 'premium'
    & node $browser test --config (Join-Path $web 'playwright.premium.config.ts')
    if ($LASTEXITCODE) { throw "Premium staging failed. Evidence: $env:PLAYWRIGHT_OUTPUT_DIR" }
    Remove-Item Env:PREMIUM_STAGE_ONLY
    $summary.premium = Find-Receipt $env:PLAYWRIGHT_OUTPUT_DIR 'premium-result.json'
}

$medicalConfig = Join-Path $web 'playwright.medical.config.ts'
$env:DEV_LITE_ACTIVATE = 'false'
$env:MEDICAL_BENCHMARK_EXISTS = 'true'
$env:MEDICAL_FINAL_PAYMENT = 'false'
if (-not $SkipDeadline) {
    $env:MEDICAL_DEADLINE_LIVE = 'true'; $env:MEDICAL_REVIEW_LIVE = 'false'; $env:DEV_LITE_DUPLICATE_REVIEW = 'false'
    $env:PLAYWRIGHT_OUTPUT_DIR = Join-Path $out 'deadline'
    $before = Get-Date
    & node $browser test --config $medicalConfig
    if ($LASTEXITCODE) { throw "Deadline staging failed. Evidence: $env:PLAYWRIGHT_OUTPUT_DIR" }
    $summary.deadline = @{ evidence = $env:PLAYWRIGHT_OUTPUT_DIR; note = 'Load the newest REJECTED claim of Policyholder One; it offers Return reserved cover to the policy.'; after = $before.ToUniversalTime().ToString('o') }
}
if (-not $SkipBankPayout) {
    $env:MEDICAL_DEADLINE_LIVE = 'false'; $env:MEDICAL_REVIEW_LIVE = 'false'
    if (-not $env:MEDICAL_PRIOR_CLAIM_ID) {
        # The duplicate must repeat a stay on a policy that is still paid, so
        # settle a fresh routine claim first and reuse its policy.
        $env:DEV_LITE_DUPLICATE_REVIEW = 'false'; $env:MEDICAL_FINAL_PAYMENT = 'true'; $env:MEDICAL_BENCHMARK_EXISTS = 'false'
        $env:PLAYWRIGHT_OUTPUT_DIR = Join-Path $out 'routine'
        & node $browser test --config $medicalConfig
        if ($LASTEXITCODE) { throw "Routine staging failed. Evidence: $env:PLAYWRIGHT_OUTPUT_DIR" }
        $env:MEDICAL_PRIOR_CLAIM_ID = (Find-Receipt $env:PLAYWRIGHT_OUTPUT_DIR 'routine-result.json').claimId
        $env:MEDICAL_FINAL_PAYMENT = 'false'; $env:MEDICAL_BENCHMARK_EXISTS = 'true'
    }
    $summary.priorClaimId = $env:MEDICAL_PRIOR_CLAIM_ID
    $env:DEV_LITE_DUPLICATE_REVIEW = 'true'
    $env:MEDICAL_STOP_BEFORE_BANK = 'true'
    $env:PLAYWRIGHT_OUTPUT_DIR = Join-Path $out 'bank-payout'
    & node $browser test --config $medicalConfig
    if ($LASTEXITCODE) { throw "Bank payout staging failed. Evidence: $env:PLAYWRIGHT_OUTPUT_DIR" }
    Remove-Item Env:MEDICAL_STOP_BEFORE_BANK
    $summary.bankPayout = Find-Receipt $env:PLAYWRIGHT_OUTPUT_DIR 'authorized-result.json'
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $out 'summary.json') -Encoding utf8
Write-Output "Demo staging complete. Summary: $(Join-Path $out 'summary.json')"
Get-Content -LiteralPath (Join-Path $out 'summary.json')
