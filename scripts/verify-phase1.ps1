[CmdletBinding()]
param([switch]$TimeoutOnly)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$experimentChannel = "insurance-phase1-20260926"
$experimentBlock = Join-Path $projectRoot "network/channel-artifacts/$experimentChannel.block"
if (-not (Test-Path -LiteralPath $experimentBlock -PathType Leaf)) {
    throw "Missing experiment channel. First run: wsl.exe -d Ubuntu -- bash network/scripts/create-phase1-channel.sh"
}

$env:FABRIC_CHANNEL_NAME = $experimentChannel
$env:ORACLE_STATE_ROOT = Join-Path $projectRoot "data/oracle-phase1"
$env:EVENT_PROJECTION_ROOT = Join-Path $projectRoot "data/events-phase1"
$env:EVIDENCE_STORAGE_ROOT = Join-Path $projectRoot "data/evidence-phase1"
$env:PLAYWRIGHT_OUTPUT_DIR = Join-Path $projectRoot "verification-results/phase1-playwright"

if ($TimeoutOnly) {
    $env:ORACLE_E2E_SCENARIO = "timeout"
    Push-Location (Join-Path $projectRoot "apps/web")
    try {
        & npx playwright test --grep "@oracle-timeout"
        if ($LASTEXITCODE -ne 0) { throw "Phase 1 timeout browser case exited with code $LASTEXITCODE" }
    }
    finally { Pop-Location }
} else {
    & (Join-Path $PSScriptRoot "verify-all.ps1")
}
