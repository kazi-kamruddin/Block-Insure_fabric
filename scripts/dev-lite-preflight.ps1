[CmdletBinding()]
param([switch]$Ledger)
# Read-only checks before a dev-lite demo. Changes nothing.
# -Ledger also reads the committed chaincode sequence from all five peers
# (the network must be up).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$state = Join-Path $root 'data/dev-lite'
$results = [Collections.Generic.List[object]]::new()
function Report([string]$Check, [string]$Status, [string]$Detail) { $results.Add([pscustomobject]@{ Check = $Check; Status = $Status; Detail = $Detail }) }

try {
    $null = & docker info --format '{{.ServerVersion}}' 2>$null
    if ($LASTEXITCODE) { throw 'docker info failed' }
    Report 'Docker Desktop' 'PASS' 'Engine is reachable'
} catch { Report 'Docker Desktop' 'FAIL' 'Start Docker Desktop and wait for "Engine running"' }

$projects = @(& docker ps --filter 'label=com.docker.compose.service=orderer' --format '{{.Names}}' 2>$null)
$foreign = @($projects | Where-Object { $_ -and $_ -notlike 'block-insure-dev-lite-orderer*' })
if ($foreign.Count) { Report 'Other Fabric networks' 'FAIL' "Stop these first: $($foreign -join ', ')" }
else { Report 'Other Fabric networks' 'PASS' $(if ($projects.Count) { 'Only dev-lite is running' } else { 'None running' }) }

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

$busy = @(Get-NetTCPConnection -LocalPort 3219,3311,3312,3313,3330 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique)
if ($busy.Count) { Report 'App ports' 'WARN' "Already in use: $($busy -join ', ') (an app may already be running)" } else { Report 'App ports' 'PASS' '3219, 3311-3313 and 3330 are free' }

$os = Get-CimInstance Win32_OperatingSystem
$freeMb = [int]($os.FreePhysicalMemory / 1024)
Report 'Free memory' $(if ($freeMb -ge 2500) { 'PASS' } elseif ($freeMb -ge 1500) { 'WARN' } else { 'FAIL' }) "$freeMb MB free; close browsers and chat apps if below 2500 MB"
foreach ($drive in 'C','E') {
    $free = [math]::Round((Get-PSDrive $drive).Free / 1GB, 1)
    Report "Disk $drive" $(if ($free -ge 5) { 'PASS' } else { 'WARN' }) "$free GB free"
}
$emailConfig = Join-Path $state 'email-gateway.json'
Report 'Brevo email (optional)' $(if (Test-Path -LiteralPath $emailConfig) { 'PASS' } else { 'INFO' }) $(if (Test-Path -LiteralPath $emailConfig) { 'Configured; start the app with -Email' } else { 'Not configured; OTP codes appear on screen' })

if ($Ledger) {
    $lines = @(& wsl.exe -d Ubuntu --cd $root --exec bash network/scripts/read-dev-lite-sequence.sh 2>$null)
    $sequences = @($lines | Where-Object { $_ -match 'Sequence: (\d+)' } | ForEach-Object { [int]($_ -replace '.*Sequence: (\d+).*', '$1') })
    if ($sequences.Count -eq 5 -and @($sequences | Select-Object -Unique).Count -eq 1) { Report 'Chaincode on five peers' 'PASS' "1.9.0 sequence $($sequences[0]) on all five" }
    else { Report 'Chaincode on five peers' 'FAIL' "Read back: $($lines -join ' | ')" }
}

$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
if (@($results | Where-Object Status -eq 'FAIL').Count) { exit 1 }
