[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("Start", "Status", "Stop")]
    [string]$Action = "Status"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:FABRIC_CHANNEL_NAME = "insurance-workflow-20261005"
$env:FABRIC_EXPECTED_SCHEMA_VERSION = "15"
$env:ORACLE_STATE_ROOT = Join-Path $projectRoot "data/oracle-workflow"
$env:EVENT_PROJECTION_ROOT = Join-Path $projectRoot "data/events-workflow"
$env:EVIDENCE_STORAGE_ROOT = Join-Path $projectRoot "data/evidence-workflow"

if ($Action -eq "Start") {
    & "$PSScriptRoot/low-memory-network.ps1" Start -ChaincodeVersion "1.5.1-workflow"
    if ($LASTEXITCODE -notin 0, $null) { throw "Workflow Fabric runtime failed to start." }
    $alreadyReady = $false
    try {
        $readiness = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health/ready" -TimeoutSec 3
        $fabric = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/fabric/health" -TimeoutSec 3
        $alreadyReady = $readiness.status -eq "ready" -and
            $fabric.channel -eq $env:FABRIC_CHANNEL_NAME -and
            $fabric.schemaVersion -eq 15
    }
    catch { $alreadyReady = $false }
    if ($alreadyReady) {
        Write-Host "Workflow demo is already healthy at http://localhost:3000." -ForegroundColor Green
    }
    else {
        & "$PSScriptRoot/demo-stack.ps1" Stop -ExistingNetwork
        & "$PSScriptRoot/demo-stack.ps1" Start -ExistingNetwork -LowMemory
    }
}
elseif ($Action -eq "Stop") {
    & "$PSScriptRoot/demo-stack.ps1" Stop -ExistingNetwork
}
else {
    & "$PSScriptRoot/low-memory-network.ps1" Status -ChaincodeVersion "1.5.1-workflow"
    & "$PSScriptRoot/demo-stack.ps1" Status -ExistingNetwork -LowMemory
}
