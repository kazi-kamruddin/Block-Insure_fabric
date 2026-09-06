[CmdletBinding()]
param(
    [switch]$SkipNetwork,
    [switch]$SkipBrowser,
    [switch]$SkipAudit
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$gitSafeRoot = $projectRoot.Replace("\", "/")
$webRoot = Join-Path $projectRoot "apps/web"
$oracleRoot = Join-Path $projectRoot "services/oracle-worker"
$resultsRoot = Join-Path $projectRoot "verification-results"
$reportPath = Join-Path $resultsRoot "latest.json"
$results = [System.Collections.Generic.List[object]]::new()
$startedAt = [DateTimeOffset]::UtcNow
$startedOracleWorkers = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

function Invoke-VerificationStep {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Action
    )

    Write-Host "`n==> $Name" -ForegroundColor Cyan
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        & $Action
        if ($LASTEXITCODE -notin 0, $null) {
            throw "$Name exited with code $LASTEXITCODE"
        }
        $results.Add([pscustomobject]@{
            name = $Name
            status = "passed"
            durationSeconds = [Math]::Round($timer.Elapsed.TotalSeconds, 3)
        })
    }
    catch {
        $results.Add([pscustomobject]@{
            name = $Name
            status = "failed"
            durationSeconds = [Math]::Round($timer.Elapsed.TotalSeconds, 3)
            message = $_.Exception.Message
        })
        throw
    }
}

function Save-VerificationReport {
    param([string]$Status)

    New-Item -ItemType Directory -Path $resultsRoot -Force | Out-Null
    $gitStatus = @(git -c "safe.directory=$gitSafeRoot" -C $projectRoot status --porcelain=v1 --untracked-files=normal)
    [pscustomobject]@{
        schemaVersion = 2
        status = $Status
        startedAt = $startedAt.ToString("o")
        completedAt = [DateTimeOffset]::UtcNow.ToString("o")
        gitCommit = (git -c "safe.directory=$gitSafeRoot" -C $projectRoot rev-parse --short HEAD).Trim()
        gitBranch = (git -c "safe.directory=$gitSafeRoot" -C $projectRoot branch --show-current).Trim()
        gitDirty = $gitStatus.Count -gt 0
        options = [pscustomobject]@{
            networkIncluded = -not $SkipNetwork
            browserIncluded = -not $SkipBrowser
            auditIncluded = -not $SkipAudit
        }
        runtime = [pscustomobject]@{
            node = (node --version).Trim()
            npm = (npm --version).Trim()
            powerShell = $PSVersionTable.PSVersion.ToString()
        }
        results = $results
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
}

function Get-OracleHealth {
    param([Parameter(Mandatory)][int]$Port)
    try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3 }
    catch { return $null }
}

function Get-WebHealth {
    try { return Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 3 }
    catch { return $null }
}

function Resolve-WslProjectRoot {
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        $resolved = (& wsl.exe -d Ubuntu -- wslpath -a $projectRoot 2>$null).Trim()
        if ($LASTEXITCODE -eq 0 -and $resolved) { return $resolved }
        if ($attempt -lt 5) { Start-Sleep -Seconds 2 }
    }
    throw "Could not resolve the project path inside Ubuntu WSL after 5 attempts"
}

function Invoke-WslVerification {
    param(
        [Parameter(Mandatory)][string]$ProjectRoot,
        [Parameter(Mandatory)][string]$Command
    )
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        & wsl.exe -d Ubuntu -- bash -lc "cd '$ProjectRoot' && $Command"
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0) { return }
        if ($attempt -lt 3) {
            Write-Warning "WSL verification command failed with exit code $exitCode (attempt $attempt/3); retrying the read-only/idempotent operation."
            Start-Sleep -Seconds 2
        }
    }
    throw "WSL verification command failed with exit code $exitCode after 3 attempts"
}

function Ensure-OracleWorker {
    param(
        [Parameter(Mandatory)][string]$OracleId,
        [Parameter(Mandatory)][int]$Port,
        [Parameter(Mandatory)][string]$EnvironmentFile
    )
    if (Get-OracleHealth $Port) { return }
    $logRoot = Join-Path $resultsRoot "oracle-workers"
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    $process = Start-Process -FilePath (Get-Command node).Source `
        -ArgumentList @("src/index.mjs", "--env=$EnvironmentFile") -WorkingDirectory $oracleRoot `
        -RedirectStandardOutput (Join-Path $logRoot "$OracleId.out.log") `
        -RedirectStandardError (Join-Path $logRoot "$OracleId.err.log") `
        -WindowStyle Hidden -PassThru
    $startedOracleWorkers.Add($process)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 500
        $health = Get-OracleHealth $Port
    } until ($health -or $process.HasExited -or [DateTimeOffset]::UtcNow -ge $deadline)
    if (-not $health) { throw "$OracleId did not expose health on port $Port. Inspect verification-results/oracle-workers." }
}

function Stop-StartedOracleWorkers {
    foreach ($process in $startedOracleWorkers) {
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
    }
    $startedOracleWorkers.Clear()
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(10)
    while (((Get-OracleHealth 3301) -or (Get-OracleHealth 3302)) -and [DateTimeOffset]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }
}

function Assert-IsolatedBrowserRuntime {
    if ($SkipBrowser) { return }
    $occupied = @()
    if (Get-WebHealth) { $occupied += "web:3000" }
    if (Get-OracleHealth 3301) { $occupied += "oracle1:3301" }
    if (Get-OracleHealth 3302) { $occupied += "oracle2:3302" }
    if ($occupied.Count -gt 0) {
        throw "Browser verification requires isolated application ports for baseline/conflict/timeout scenarios. Stop managed services while retaining Fabric first: .\\scripts\\demo-stack.ps1 -Action Stop -KeepNetwork. Occupied: $($occupied -join ', ')"
    }
}

try {
    Assert-IsolatedBrowserRuntime
    Push-Location $webRoot
    Invoke-VerificationStep "Web lint" { npm run lint }
    Invoke-VerificationStep "Web type check" { npm run typecheck }
    Invoke-VerificationStep "Web unit tests" { npm run test }
    Invoke-VerificationStep "Event worker syntax" { npm run check:worker }
    if (-not $SkipAudit) {
        Invoke-VerificationStep "Dependency audit" { npm audit --audit-level=high }
    }
    Invoke-VerificationStep "Production build" { npm run build }
    Pop-Location

    Push-Location $oracleRoot
    Invoke-VerificationStep "Oracle worker syntax" { npm run check }
    Invoke-VerificationStep "Oracle worker unit tests" { npm run test }
    Pop-Location

    if (-not $SkipNetwork) {
        $wslProjectRoot = Resolve-WslProjectRoot
        Invoke-VerificationStep "Go chaincode suite" {
            Invoke-WslVerification $wslProjectRoot "bash chaincode/insurance-contract/scripts/test.sh"
        }
        Invoke-VerificationStep "Fabric network and contract" {
            Invoke-WslVerification $wslProjectRoot "bash network/scripts/network.sh verify"
        }
        Invoke-VerificationStep "Oracle worker supervision and health" {
            Ensure-OracleWorker "oracle1" 3301 ".env.oracle1.example"
            Ensure-OracleWorker "oracle2" 3302 ".env.oracle2.example"
            foreach ($port in 3301, 3302) {
                $health = Get-OracleHealth $port
                if (-not $health -or $health.status -notin "ONLINE", "PROCESSING") { throw "Oracle health on port $port is not operational." }
            }
        }
        if (-not $SkipBrowser) { Stop-StartedOracleWorkers }
    }

    if (-not $SkipBrowser) {
        Push-Location $webRoot
        Invoke-VerificationStep "Browser and live workflow suite" { npm run test:e2e }
        Invoke-VerificationStep "Live Oracle conflict fallback" {
            $previousScenario = $env:ORACLE_E2E_SCENARIO
            try {
                $env:ORACLE_E2E_SCENARIO = "conflict"
                npx playwright test --grep "@oracle-conflict"
            }
            finally { $env:ORACLE_E2E_SCENARIO = $previousScenario }
        }
        Invoke-VerificationStep "Live Oracle timeout fallback" {
            $previousScenario = $env:ORACLE_E2E_SCENARIO
            try {
                $env:ORACLE_E2E_SCENARIO = "timeout"
                npx playwright test --grep "@oracle-timeout"
            }
            finally { $env:ORACLE_E2E_SCENARIO = $previousScenario }
        }
        Pop-Location
    }

    Save-VerificationReport "passed"
    Stop-StartedOracleWorkers
    Write-Host "`nAll selected verification steps passed." -ForegroundColor Green
    Write-Host "Report: $reportPath"
}
catch {
    Stop-StartedOracleWorkers
    if ((Get-Location).Path -ne $projectRoot) {
        while ((Get-Location).Path -ne $projectRoot -and (Get-Location).Path.Length -ge $projectRoot.Length) {
            Pop-Location
        }
    }
    Save-VerificationReport "failed"
    Write-Error "Verification failed. Report: $reportPath`n$($_.Exception.Message)"
    exit 1
}
