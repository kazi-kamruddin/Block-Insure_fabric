[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("Preflight", "Start", "Status", "Stop", "CleanBootstrap")]
    [string]$Action = "Status",
    [ValidateSet("Baseline", "Conflict", "Oracle2Unavailable")]
    [string]$OracleScenario = "Baseline",
    [switch]$ConfirmReset,
    [switch]$Development,
    [switch]$KeepNetwork
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $projectRoot "apps/web"
$oracleRoot = Join-Path $projectRoot "services/oracle-worker"
$stateRoot = Join-Path $projectRoot "data/demo-stack"
$logRoot = Join-Path $stateRoot "logs"
$processPath = Join-Path $stateRoot "processes.json"

function Resolve-WslProjectRoot {
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        $resolved = (& wsl.exe -d Ubuntu -- wslpath -a $projectRoot 2>$null).Trim()
        if ($LASTEXITCODE -eq 0 -and $resolved) { return $resolved }
        if ($attempt -lt 5) { Start-Sleep -Seconds 2 }
    }
    throw "Ubuntu WSL could not resolve the project path after 5 attempts."
}

function Invoke-NetworkScript {
    param([Parameter(Mandatory)][string]$Command)
    $maximumAttempts = if ($Command -in "network.sh up", "network.sh verify") { 5 } else { 1 }
    for ($attempt = 1; $attempt -le $maximumAttempts; $attempt++) {
        $wslRoot = Resolve-WslProjectRoot
        & wsl.exe -d Ubuntu -- bash -lc "cd '$wslRoot' && bash network/scripts/$Command"
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0) { return }
        if ($attempt -lt $maximumAttempts) {
            Write-Warning "network/scripts/$Command failed with exit code $exitCode (attempt $attempt/$maximumAttempts); retrying the idempotent operation."
            Start-Sleep -Seconds 2
        }
    }
    throw "network/scripts/$Command failed with exit code $exitCode after $maximumAttempts attempt(s)"
}

function Test-HttpHealth {
    param([Parameter(Mandatory)][string]$Url)
    try {
        $response = Invoke-RestMethod -Uri $Url -TimeoutSec 3
        return $null -ne $response
    }
    catch { return $false }
}

function Read-ManagedProcesses {
    if (-not (Test-Path -LiteralPath $processPath)) { return @() }
    return @(Get-Content -LiteralPath $processPath -Raw | ConvertFrom-Json)
}

function Test-ManagedProcess {
    param([Parameter(Mandatory)]$Record)
    $process = Get-Process -Id ([int]$Record.id) -ErrorAction SilentlyContinue
    if (-not $process -or $process.ProcessName -notmatch "^(node|npm)$") { return $false }
    return $process.StartTime.ToUniversalTime().Ticks -eq [long]$Record.startTimeUtcTicks
}

function Start-ManagedProcess {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string[]]$Arguments
    )
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $stdout = Join-Path $logRoot "$Name.out.log"
    $stderr = Join-Path $logRoot "$Name.err.log"
    $process = Start-Process -FilePath $nodePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
    return [pscustomobject]@{
        name = $Name
        id = $process.Id
        startTimeUtcTicks = $process.StartTime.ToUniversalTime().Ticks
        workingDirectory = $WorkingDirectory
        stdout = $stdout
        stderr = $stderr
    }
}

function Invoke-Preflight {
    Write-Host "Checking Docker Desktop, WSL, source dependencies, and local configuration..." -ForegroundColor Cyan
    & docker info --format "Docker {{.ServerVersion}} is ready"
    if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not ready." }
    & node --version
    & npm --version
    $wslRoot = Resolve-WslProjectRoot
    & wsl.exe -d Ubuntu -- bash -lc "cd '$wslRoot' && test -x network/.fabric/fabric-samples/bin/peer && test -x network/.fabric/fabric-samples/bin/configtxgen && command -v jq >/dev/null"
    if ($LASTEXITCODE -ne 0) { throw "Fabric CLI tools or jq are unavailable in the existing WSL workspace." }
    if (-not (Test-Path -LiteralPath (Join-Path $webRoot ".env.local"))) { throw "apps/web/.env.local is missing." }
    if (-not (Test-Path -LiteralPath (Join-Path $webRoot "node_modules"))) { throw "apps/web dependencies are missing." }
    if (-not $Development -and -not (Test-Path -LiteralPath (Join-Path $webRoot ".next/standalone/server.js"))) {
        throw "The standalone web build is missing. Run npm run build in apps/web or use -Development."
    }
    $oracleMsp = Join-Path $projectRoot "network/organizations/peerOrganizations/oracle.blockinsure.test"
    if (-not (Test-Path -LiteralPath $oracleMsp)) {
        Write-Warning "The preserved ledger predates OracleMSP. Start will refuse to reset it; use CleanBootstrap -ConfirmReset only when you deliberately want a clean showcase ledger."
    }
    Write-Host "Preflight passed." -ForegroundColor Green
}

function Start-DemoStack {
    Invoke-Preflight
    Invoke-NetworkScript "network.sh up"
    $existing = Read-ManagedProcesses
    if ($existing.Count -gt 0 -and ($existing | Where-Object { Test-ManagedProcess $_ }).Count -gt 0) {
        throw "Managed demo processes are already running. Use Status or Stop first."
    }
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    $webArguments = if ($Development) { @("node_modules/next/dist/bin/next", "dev") } else { @("scripts/start-standalone.mjs") }
    if ($OracleScenario -eq "Oracle2Unavailable" -and (Test-HttpHealth "http://127.0.0.1:3302/health")) {
        throw "Oracle 2 is already running outside this managed stack. Stop it before demonstrating unavailability."
    }
    $oracle2Environment = if ($OracleScenario -eq "Conflict") { ".env.oracle2-conflict.example" } else { ".env.oracle2.example" }
    $records = @(
        Start-ManagedProcess "web" $webRoot $webArguments
    )
    $records | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $processPath -Encoding utf8

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(45)
    do {
        $webHealthy = (Test-ManagedProcess $records[0]) -and
            (Test-HttpHealth "http://127.0.0.1:3000/api/health") -and
            (Test-HttpHealth "http://127.0.0.1:3000/api/fabric/health")
        if (-not $webHealthy) { Start-Sleep -Seconds 1 }
    } until ($webHealthy -or [DateTimeOffset]::UtcNow -ge $deadline)
    if (-not $webHealthy) {
        if (Test-ManagedProcess $records[0]) { Stop-Process -Id ([int]$records[0].id) -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $processPath) { Remove-Item -LiteralPath $processPath -Force }
        throw "The web application and Fabric gateway did not become healthy within 45 seconds. The web process was stopped; inspect data/demo-stack/logs."
    }

    $records += Start-ManagedProcess "event-worker" $webRoot @("scripts/sync-events.mjs")
    $records += Start-ManagedProcess "oracle1" $oracleRoot @("src/index.mjs", "--env=.env.oracle1.example")
    if ($OracleScenario -ne "Oracle2Unavailable") {
        $records += Start-ManagedProcess "oracle2" $oracleRoot @("src/index.mjs", "--env=$oracle2Environment")
    }
    $records | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $processPath -Encoding utf8

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(45)
    do {
        $healthy = ($records | Where-Object { Test-ManagedProcess $_ }).Count -eq $records.Count -and
            (Test-HttpHealth "http://127.0.0.1:3301/health") -and
            ($OracleScenario -eq "Oracle2Unavailable" -or (Test-HttpHealth "http://127.0.0.1:3302/health")) -and
            ($OracleScenario -eq "Oracle2Unavailable" -or (Test-HttpHealth "http://127.0.0.1:3000/api/health/ready"))
        if (-not $healthy) { Start-Sleep -Seconds 1 }
    } until ($healthy -or [DateTimeOffset]::UtcNow -ge $deadline)
    if (-not $healthy) {
        foreach ($record in $records) {
            if (Test-ManagedProcess $record) { Stop-Process -Id ([int]$record.id) -ErrorAction SilentlyContinue }
        }
        if (Test-Path -LiteralPath $processPath) { Remove-Item -LiteralPath $processPath -Force }
        throw "The workers did not become healthy within 45 seconds. Started processes were stopped; inspect data/demo-stack/logs."
    }
    Write-Host "Demo stack is healthy at http://127.0.0.1:3000 (Oracle scenario: $OracleScenario)." -ForegroundColor Green
}

function Stop-DemoStack {
    foreach ($record in Read-ManagedProcesses) {
        if (Test-ManagedProcess $record) { Stop-Process -Id ([int]$record.id) -ErrorAction Stop }
    }
    if (Test-Path -LiteralPath $processPath) { Remove-Item -LiteralPath $processPath -Force }
    if (-not $KeepNetwork) { Invoke-NetworkScript "network.sh down" }
    Write-Host "Managed application services stopped$(if ($KeepNetwork) { '; Fabric retained and running' } else { '; Fabric containers stopped with ledger volumes retained' })." -ForegroundColor Green
}

function Show-DemoStatus {
    $records = Read-ManagedProcesses
    if ($records.Count -eq 0) { Write-Host "No managed process registry exists." }
    foreach ($record in $records) {
        Write-Host ("{0,-14} PID {1,-7} {2}" -f $record.name, $record.id, $(if (Test-ManagedProcess $record) { "RUNNING" } else { "STOPPED" }))
    }
    foreach ($url in @("http://127.0.0.1:3000/api/health/live", "http://127.0.0.1:3000/api/health/ready", "http://127.0.0.1:3000/api/fabric/health", "http://127.0.0.1:3301/health", "http://127.0.0.1:3302/health")) {
        Write-Host ("{0,-52} {1}" -f $url, $(if (Test-HttpHealth $url) { "HEALTHY" } else { "UNAVAILABLE" }))
    }
    & docker ps --filter "network=block-insure" --format "table {{.Names}}`t{{.Status}}"
}

function Clear-CleanShowcaseState {
    $dataRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "data"))
    foreach ($name in "events", "oracle", "evidence", "demo-stack") {
        $candidate = [System.IO.Path]::GetFullPath((Join-Path $dataRoot $name))
        if ([System.IO.Path]::GetDirectoryName($candidate) -ne $dataRoot) {
            throw "Refusing to clear a showcase path outside the project data directory: $candidate"
        }
        if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Recurse -Force }
    }
}

switch ($Action) {
    "Preflight" { Invoke-Preflight }
    "Start" { Start-DemoStack }
    "Status" { Show-DemoStatus }
    "Stop" { Stop-DemoStack }
    "CleanBootstrap" {
        if (-not $ConfirmReset) { throw "CleanBootstrap destroys only this project's local Fabric ledger/identities and ignored demo runtime data. Re-run with -ConfirmReset after deliberate approval." }
        if ((Read-ManagedProcesses | Where-Object { Test-ManagedProcess $_ }).Count -gt 0) { throw "Stop the managed demo processes before clean bootstrap." }
        Invoke-Preflight
        Invoke-NetworkScript "network.sh reset"
        Clear-CleanShowcaseState
        Invoke-NetworkScript "network.sh up"
        Invoke-NetworkScript "deploy-chaincode.sh"
        Invoke-NetworkScript "seed-showcase.sh"
        Start-DemoStack
    }
}
