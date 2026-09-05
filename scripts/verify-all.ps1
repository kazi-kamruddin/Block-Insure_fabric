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
$resultsRoot = Join-Path $projectRoot "verification-results"
$reportPath = Join-Path $resultsRoot "latest.json"
$results = [System.Collections.Generic.List[object]]::new()
$startedAt = [DateTimeOffset]::UtcNow

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
    [pscustomobject]@{
        schemaVersion = 1
        status = $Status
        startedAt = $startedAt.ToString("o")
        completedAt = [DateTimeOffset]::UtcNow.ToString("o")
        gitCommit = (git -c "safe.directory=$gitSafeRoot" -C $projectRoot rev-parse --short HEAD).Trim()
        results = $results
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
}

try {
    Push-Location $webRoot
    Invoke-VerificationStep "Web lint" { npm run lint }
    Invoke-VerificationStep "Web type check" { npm run typecheck }
    Invoke-VerificationStep "Web unit tests" { npm run test }
    if (-not $SkipAudit) {
        Invoke-VerificationStep "Dependency audit" { npm audit --audit-level=high }
    }
    Invoke-VerificationStep "Production build" { npm run build }
    Pop-Location

    if (-not $SkipNetwork) {
        $wslProjectRoot = (& wsl.exe -d Ubuntu -- wslpath -a $projectRoot).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $wslProjectRoot) {
            throw "Could not resolve the project path inside Ubuntu WSL"
        }
        Invoke-VerificationStep "Go chaincode suite" {
            wsl.exe -d Ubuntu -- bash -lc "cd '$wslProjectRoot' && bash chaincode/insurance-contract/scripts/test.sh"
        }
        Invoke-VerificationStep "Fabric network and contract" {
            wsl.exe -d Ubuntu -- bash -lc "cd '$wslProjectRoot' && bash network/scripts/network.sh verify"
        }
    }

    if (-not $SkipBrowser) {
        Push-Location $webRoot
        Invoke-VerificationStep "Browser and live workflow suite" { npm run test:e2e }
        Pop-Location
    }

    Save-VerificationReport "passed"
    Write-Host "`nAll selected verification steps passed." -ForegroundColor Green
    Write-Host "Report: $reportPath"
}
catch {
    if ((Get-Location).Path -ne $projectRoot) {
        while ((Get-Location).Path -ne $projectRoot -and (Get-Location).Path.Length -ge $projectRoot.Length) {
            Pop-Location
        }
    }
    Save-VerificationReport "failed"
    Write-Error "Verification failed. Report: $reportPath`n$($_.Exception.Message)"
    exit 1
}
