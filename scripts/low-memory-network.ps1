[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("Start", "Status")]
    [string]$Action = "Status",
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9.-]{0,79}$')]
    [string]$ChaincodeVersion = "1.4.1-hardening",
    [switch]$CoreOnly,
    [ValidateRange(30,120)][int]$StabilizationSeconds = 40,
    [ValidateRange(10,60)][int]$QuietSeconds = 15,
    [ValidateRange(128,2048)][int]$MinimumGuestAvailableMiB = 128,
    [string]$EvidencePath
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot/fabric-runtime.ps1"
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
    $text = Invoke-FabricDocker -Arguments @('ps', '--format', '{{.Names}}')
    if ($text) { $text -split '\r?\n' }
}

function Invoke-ComposeUp {
    param(
        [Parameter(Mandatory)][string[]]$Services,
        [switch]$NoDependencies
    )
    $arguments = @("-f", $composeCa, "-f", $composeNetwork, "up", "-d")
    if ($NoDependencies) { $arguments += "--no-deps" }
    $arguments += $Services
    Invoke-FabricDocker -Arguments (@('compose') + $arguments) | Out-Null
}

function Get-RuntimeSample {
    $names = @(Get-RunningNames)
    $memory = Invoke-FabricDocker -Arguments @('exec', 'orderer.blockinsure.test', 'cat', '/proc/meminfo')
    $match = [regex]::Match($memory, '(?m)^MemAvailable:\s+(\d+)\s+kB')
    if (-not $match.Success) { throw 'Cannot measure guest memory; refusing readiness.' }
    [pscustomobject]@{ Names = $names; AvailableBytes = [long]$match.Groups[1].Value * 1024 }
}

function Stop-UnselectedRuntimes {
    param([string[]]$Names)
    if ($Names.Count) {
        Invoke-FabricDocker -Arguments (@('stop', '--timeout', '1') + $Names) | Out-Null
        Write-Host "Stopped $($Names.Count) unselected Fabric runtimes; retained containers and state."
    }
}

function Wait-SelectedRuntime {
    param([string[]]$Required)
    Wait-FabricRuntimeStable -Sample { Get-RuntimeSample } -StopRuntime { param($names) Stop-UnselectedRuntimes $names } `
        -Required $Required -Organizations $organizations -Version $ChaincodeVersion -CoreOnly:$CoreOnly `
        -MinimumSeconds $StabilizationSeconds -QuietSeconds $QuietSeconds -MinimumAvailableBytes ($MinimumGuestAvailableMiB * 1MB) `
        -Observe { param($sample)
            if ($EvidencePath) { Add-Content -LiteralPath $EvidencePath -Value ($sample | ConvertTo-Json -Depth 4 -Compress) }
        }
}

function Assert-Runtime {
    $sample = Get-RuntimeSample
    $running = @($sample.Names)
    $missing = @($coreContainers | Where-Object { $_ -notin $running })
    if ($missing.Count -gt 0) { throw "Missing Fabric runtime containers: $($missing -join ', ')." }
    $unwanted = @(Get-UnselectedFabricRuntime -Names $running -Organizations $organizations -Version $ChaincodeVersion -CoreOnly:$CoreOnly)
    if ($unwanted.Count) { throw "Unselected Fabric runtimes still running: $($unwanted -join ', ')." }
    if ($sample.AvailableBytes -lt ($MinimumGuestAvailableMiB * 1MB)) { throw 'Insufficient Fabric guest memory for readiness.' }
    if ($CoreOnly) {
        Write-Host "Fabric core ready: 11 transaction services; no chaincode runtimes; guest available $([math]::Round($sample.AvailableBytes / 1MB)) MiB." -ForegroundColor Green
        return
    }
    foreach ($organization in $organizations) {
        $prefix = "dev-peer0.$organization.blockinsure.test-insurance-contract_${ChaincodeVersion}-"
        if (@($running | Where-Object { $_.StartsWith($prefix) }).Count -ne 1) {
            throw "Selected chaincode is not running on $organization peer."
        }
    }
    $legacy = @($running | Where-Object {
        $_.StartsWith("dev-peer0.") -and -not $_.Contains("_${ChaincodeVersion}-")
    })
    if ($legacy.Count -gt 0) { throw "Legacy chaincode runtimes are still running: $($legacy.Count)." }
    Write-Host "Low-memory Fabric runtime ready: 11 transaction services and 5 selected chaincode runtimes." -ForegroundColor Green
    Write-Host "CAs are stopped; existing enrolled identities are required."
}

if ($Action -eq "Start") {
    $identityRoot = Join-Path $projectRoot "network/organizations"
    if (-not (Test-Path -LiteralPath (Join-Path $identityRoot "ordererOrganizations/blockinsure.test")) -or
        -not (Test-Path -LiteralPath (Join-Path $identityRoot "peerOrganizations/oracle.blockinsure.test"))) {
        throw "Preserved Fabric identities are missing. This script will not bootstrap or reset them."
    }
    Invoke-FabricDocker -Arguments @('info', '--format', 'Docker {{.ServerVersion}} is ready') | Write-Host
    $initialNames = @(Get-RunningNames)
    if ($EvidencePath) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent ([IO.Path]::GetFullPath($EvidencePath))) | Out-Null
        Add-Content -LiteralPath $EvidencePath -Value (@{ event = 'start'; initialNames = $initialNames; coreOnly = [bool]$CoreOnly; version = $ChaincodeVersion } | ConvertTo-Json -Compress)
    }

    $cas = @(Get-RunningNames | Where-Object { $_ -match '^ca\.(insurer|hospital|auditor|bank|oracle)\.blockinsure\.test$' })
    if ($cas.Count -gt 0) {
        Invoke-FabricDocker -Arguments (@('stop', '--timeout', '5') + $cas) | Out-Null
    }

    Stop-UnselectedRuntimes @(Get-UnselectedFabricRuntime -Names $initialNames -Organizations $organizations -Version $ChaincodeVersion -CoreOnly:$CoreOnly)
    try {
        Invoke-ComposeUp @("orderer", "couchdb-insurer", "couchdb-hospital", "couchdb-auditor", "couchdb-bank", "couchdb-oracle")
        $required = @($coreContainers | Where-Object { $_ -notlike 'peer0.*' })
        foreach ($organization in $organizations) {
            Invoke-ComposeUp @("peer-$organization") -NoDependencies
            $required += "peer0.$organization.blockinsure.test"
            # Drain late launches before adding another peer, including CoreOnly.
            Wait-SelectedRuntime -Required $required
            Write-Host "Startup stabilized after $organization peer."
        }
        Wait-SelectedRuntime -Required $coreContainers
        Assert-Runtime
    } catch {
        $failure = $_
        try {
            $owned = @(Get-RunningNames | Where-Object { $_ -in $coreContainers -and $_ -notin $initialNames })
            if ($owned.Count) { Invoke-FabricDocker -Arguments (@('stop', '--timeout', '5') + $owned) | Out-Null }
        } catch { Write-Warning "Could not stop task-started core services: $_" }
        throw $failure
    }
}
else { Assert-Runtime }
