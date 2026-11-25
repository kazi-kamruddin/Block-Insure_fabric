[CmdletBinding()]
param(
    [switch]$Ledger,
    [switch]$ClockOnly,
    [ValidateSet('insurer', 'hospital', 'auditor', 'bank', 'oracle')][string]$ClockPeer = 'insurer'
)
# Read-only checks before a dev-lite demo. Changes nothing.
# -Ledger requires ledger checks even when the dev-lite orderer is stopped.
# -ClockOnly checks the peer clock without evaluating chaincode.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$definition = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'profiles/dev-lite-190.json') | ConvertFrom-Json
if ($definition.repoRoot) { $root = $definition.repoRoot }
$state = Join-Path $root 'data/dev-lite'
$results = [Collections.Generic.List[object]]::new()
function Report([string]$Check, [string]$Status, [string]$Detail) { $results.Add([pscustomobject]@{ Check = $Check; Status = $Status; Detail = $Detail }) }

function Test-PeerClock([bool]$Required) {
    try {
        $peers = @(& docker ps --filter 'label=com.docker.compose.project=block-insure-dev-lite' --filter "label=com.docker.compose.service=peer-$ClockPeer" --format '{{.Names}}' 2>$null)
        if ($LASTEXITCODE -ne 0) { throw "Could not inspect the dev-lite $ClockPeer peer." }
        if ($peers.Count -eq 0 -and -not $Required) {
            Report 'Peer clock skew' 'INFO' 'Dev-lite peer is stopped; run -ClockOnly before live work.'
            return $true
        }
        if ($peers.Count -ne 1) { throw "Expected one running dev-lite $ClockPeer peer." }

        $before = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $value = & docker exec $peers[0] date '+%s%3N' 2>$null
        $after = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        if ($LASTEXITCODE -ne 0 -or "$value" -notmatch '^\d{13}$') { throw 'Could not read the peer UTC clock in milliseconds.' }
        $skewMs = [long]$value - ($before + ($after - $before) / 2)
        $withinLimit = [math]::Abs($skewMs) -le 5000
        $detail = 'Peer minus Windows UTC: {0:+0.000;-0.000;0.000} s (limit 5 s, sample round trip {1} ms)' -f ($skewMs / 1000), ($after - $before)
        Report 'Peer clock skew' $(if ($withinLimit) { 'PASS' } else { 'FAIL' }) $detail
        return $withinLimit
    } catch {
        Report 'Peer clock skew' 'FAIL' $_.Exception.Message
        return $false
    }
}

if ($ClockOnly) {
    $clockOk = Test-PeerClock $true
    $results | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
    if (-not $clockOk) { exit 1 }
    exit 0
}

try {
    $null = & docker info --format '{{.ServerVersion}}' 2>$null
    if ($LASTEXITCODE) { throw 'docker info failed' }
    Report 'Docker Desktop' 'PASS' 'Engine is reachable'
} catch { Report 'Docker Desktop' 'FAIL' 'Start Docker Desktop and wait for "Engine running"' }

$orderers = @(& docker ps --filter 'label=com.docker.compose.service=orderer' --format '{{.Names}}' 2>$null)
$devLiteOrderers = @(& docker ps --filter 'label=com.docker.compose.service=orderer' --filter 'label=com.docker.compose.project=block-insure-dev-lite' --format '{{.Names}}' 2>$null)
$foreign = @($orderers | Where-Object { $_ -and $devLiteOrderers -notcontains $_ })
if ($foreign.Count) { Report 'Other Fabric networks' 'FAIL' "Stop these first: $($foreign -join ', ')" }
else { Report 'Other Fabric networks' 'PASS' $(if ($devLiteOrderers.Count) { 'Only dev-lite is running' } else { 'None running' }) }
$clockOk = Test-PeerClock ($Ledger -or $devLiteOrderers.Count -gt 0)

$volumes = @(& docker volume ls --format '{{.Name}}' 2>$null)
$expected = 'orderer','peer-auditor','peer-bank','peer-hospital','peer-insurer','peer-oracle' | ForEach-Object { "block-insure-dev-lite_$_" }
$missing = @($expected | Where-Object { $volumes -notcontains $_ })
if ($missing.Count) { Report 'Ledger volumes' 'FAIL' "Missing: $($missing -join ', '). Do not bootstrap; restore from data/dev-lite/backups." }
else { Report 'Ledger volumes' 'PASS' 'All six dev-lite volumes exist' }

foreach ($file in 'enrollment-complete','app-secrets.json') {
    if (Test-Path -LiteralPath (Join-Path $state $file)) { Report "data/dev-lite/$file" 'PASS' 'Present' }
    else { Report "data/dev-lite/$file" $(if ($file -eq 'app-secrets.json') { 'WARN' } else { 'FAIL' }) 'Missing' }
}
$backups = @(Get-ChildItem -LiteralPath (Join-Path $state 'backups') -Directory -ErrorAction SilentlyContinue | Sort-Object Name)
if ($backups.Count) { Report 'Volume backup' 'PASS' "Latest: $($backups[-1].Name)" } else { Report 'Volume backup' 'WARN' 'No backup under data/dev-lite/backups' }

$ports = @($definition.webPort, 3311, 3312, 3313, 3330)
$busy = @(Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique)
if ($busy.Count) { Report 'App ports' 'WARN' "Already in use: $($busy -join ', ') (an app may already be running)" } else { Report 'App ports' 'PASS' "$($ports -join ', ') are free" }

$os = Get-CimInstance Win32_OperatingSystem
$freeMb = [int]($os.FreePhysicalMemory / 1024)
Report 'Free memory' $(if ($freeMb -ge 2500) { 'PASS' } elseif ($freeMb -ge 1500) { 'WARN' } else { 'FAIL' }) "$freeMb MB free; close browsers and chat apps if below 2500 MB"
foreach ($drive in @((Get-Item -LiteralPath $root).PSDrive.Name, $env:SystemDrive.TrimEnd(':')) | Select-Object -Unique) {
    $free = [math]::Round((Get-PSDrive $drive).Free / 1GB, 1)
    Report "Disk $drive" $(if ($free -ge 5) { 'PASS' } else { 'WARN' }) "$free GB free"
}
$emailConfig = Join-Path $state 'email-gateway.json'
Report 'Brevo email (optional)' $(if (Test-Path -LiteralPath $emailConfig) { 'PASS' } else { 'INFO' }) $(if (Test-Path -LiteralPath $emailConfig) { 'Configured; start the app with -Email' } else { 'Not configured; OTP codes appear on screen' })

if (($Ledger -or $devLiteOrderers.Count) -and -not $foreign.Count -and $clockOk) {
    $lines = @(& wsl.exe -d Ubuntu --cd $root --exec bash network/scripts/read-dev-lite-sequence.sh $definition.channel $definition.chaincodeName 2>$null)
    $gateway = & node (Join-Path $PSScriptRoot 'dev-lite-peer-preflight.mjs') | ConvertFrom-Json
    $expectedDefinition = "$($definition.channel) / $($definition.chaincodeVersion) / $($definition.expectedSequence)"
    foreach ($org in 'insurer','hospital','auditor','bank','oracle') {
        $peer = $gateway.peers.$org
        Report "$org Gateway evaluate" $(if ($peer -eq 'UP') { 'PASS' } else { 'FAIL' }) $(if ($peer -eq 'UP') { 'UP' } else { 'DOWN' })
        $observed = 'unavailable'
        $matchesDefinition = $false
        foreach ($line in $lines) {
            if ($line -match "^$org Version: ([^,]+), Sequence: (\d+)$") {
                $observed = "$($definition.channel) / $($Matches[1]) / $($Matches[2])"
                $matchesDefinition = $observed -eq $expectedDefinition
                break
            }
        }
        Report "$org committed definition" $(if ($matchesDefinition) { 'PASS' } else { 'FAIL' }) "Expected $expectedDefinition. Observed $observed."
    }
    Report 'Insurer oracleProofPrivateData read' $(if ($gateway.oracleProof -eq 'UP') { 'PASS' } else { 'FAIL' }) 'Seeded medical review facts for CLM-2026-000201'
    Report 'Medical write peer requirement' 'INFO' 'All three collection peers must be available for writes: the endorsing peer must disseminate to two other peers (requiredPeerCount=2).'
    $accounts = [ordered]@{'ACC-INS-PREM-7001' = 'Premium collection (**** 7001)'; 'ACC-INS-RSRV-7002' = 'Claims reserve (**** 7002)'}
    foreach ($id in $accounts.Keys) {
        $balance = $gateway.balances.PSObject.Properties[$id]
        if ($null -eq $balance) { Report $accounts[$id] 'FAIL' 'Balance unavailable' }
        else { Report $accounts[$id] 'PASS' ('BDT {0:N2}' -f ($balance.Value / 100)) }
    }
}

$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
if (@($results | Where-Object Status -eq 'FAIL').Count) { exit 1 }
