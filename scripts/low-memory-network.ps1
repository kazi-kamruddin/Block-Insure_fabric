[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("Start", "Status")]
    [string]$Action = "Status"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$composeCa = Join-Path $projectRoot "network/compose/compose-ca.yaml"
$composeNetwork = Join-Path $projectRoot "network/compose/compose-network.yaml"
$organizations = @("insurer", "hospital", "auditor", "bank", "oracle")
$coreContainers = @(
    "orderer.blockinsure.test",
    "couchdb.insurer.blockinsure.test", "couchdb.hospital.blockinsure.test",
    "couchdb.auditor.blockinsure.test", "couchdb.bank.blockinsure.test",
    "couchdb.oracle.blockinsure.test"
) + @($organizations | ForEach-Object { "peer0.$_.blockinsure.test" })

function Get-RunningNames {
    $names = @(& docker ps --format "{{.Names}}")
    if ($LASTEXITCODE -ne 0) { throw "Docker could not list running containers." }
    return $names
}

function Invoke-ComposeUp {
    param([Parameter(Mandatory)][string[]]$Services)
    & docker compose -f $composeCa -f $composeNetwork up -d @Services
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose could not start: $($Services -join ', ')." }
}

function Stop-LegacyRuntimes {
    param([Parameter(Mandatory)][string]$Organization)
    $prefix = "dev-peer0.$Organization.blockinsure.test-insurance-contract_"
    $legacy = @(Get-RunningNames | Where-Object {
        $_.StartsWith($prefix) -and -not $_.Contains("_1.4.1-hardening-")
    })
    if ($legacy.Count -eq 0) { return }
    & docker stop --timeout 2 $legacy | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not stop legacy chaincode runtimes for $Organization." }
    Write-Host "Stopped $($legacy.Count) legacy $Organization chaincode runtimes."
}

function Assert-Runtime {
    $running = @(Get-RunningNames)
    $missing = @($coreContainers | Where-Object { $_ -notin $running })
    if ($missing.Count -gt 0) { throw "Missing Fabric runtime containers: $($missing -join ', ')." }
    foreach ($organization in $organizations) {
        $prefix = "dev-peer0.$organization.blockinsure.test-insurance-contract_1.4.1-hardening-"
        if (@($running | Where-Object { $_.StartsWith($prefix) }).Count -ne 1) {
            throw "Current hardening chaincode is not running on $organization peer."
        }
    }
    $legacy = @($running | Where-Object {
        $_.StartsWith("dev-peer0.") -and -not $_.Contains("_1.4.1-hardening-")
    })
    if ($legacy.Count -gt 0) { throw "Legacy chaincode runtimes are still running: $($legacy.Count)." }
    Write-Host "Low-memory Fabric runtime ready: 11 transaction services and 5 hardening chaincode runtimes." -ForegroundColor Green
    Write-Host "CAs are stopped; existing enrolled identities are required."
}

if ($Action -eq "Start") {
    $identityRoot = Join-Path $projectRoot "network/organizations"
    if (-not (Test-Path -LiteralPath (Join-Path $identityRoot "ordererOrganizations/blockinsure.test")) -or
        -not (Test-Path -LiteralPath (Join-Path $identityRoot "peerOrganizations/oracle.blockinsure.test"))) {
        throw "Preserved Fabric identities are missing. This script will not bootstrap or reset them."
    }
    & docker info --format "Docker {{.ServerVersion}} is ready"
    if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not ready." }

    $cas = @(Get-RunningNames | Where-Object { $_.StartsWith("ca.") -and $_.EndsWith(".blockinsure.test") })
    if ($cas.Count -gt 0) {
        & docker stop --timeout 5 $cas | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not stop unneeded Fabric CAs." }
    }

    Invoke-ComposeUp @("orderer", "couchdb-insurer", "couchdb-hospital", "couchdb-auditor", "couchdb-bank", "couchdb-oracle")
    foreach ($organization in $organizations) {
        Invoke-ComposeUp @("peer-$organization")
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Stop-LegacyRuntimes $organization
            $prefix = "dev-peer0.$organization.blockinsure.test-insurance-contract_1.4.1-hardening-"
            if (@(Get-RunningNames | Where-Object { $_.StartsWith($prefix) }).Count -eq 1) { break }
            Start-Sleep -Seconds 1
        }
    }
    foreach ($organization in $organizations) { Stop-LegacyRuntimes $organization }
}

Assert-Runtime
