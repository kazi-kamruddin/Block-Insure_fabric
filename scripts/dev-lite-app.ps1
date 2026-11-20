[CmdletBinding()]
param([switch]$TwoOracles)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$state = Join-Path $root 'data/dev-lite'
$web = Join-Path $root 'apps/web'
$workers = Join-Path $root 'services/oracle-worker'
$port = 3219
$oraclePorts = if ($TwoOracles) { @(3311,3312) } else { @(3311,3312,3313) }
if (@(Get-NetTCPConnection -LocalPort (@($port) + $oraclePorts) -State Listen -ErrorAction SilentlyContinue).Count) {
    throw 'A dev-lite app or worker port already has an owner.'
}
if (-not (Test-Path -LiteralPath (Join-Path $state 'enrollment-complete'))) {
    throw 'Enroll and deploy through network.sh --dev-lite before starting the app.'
}
$secretPath = Join-Path $state 'app-secrets.json'
if (-not (Test-Path -LiteralPath $secretPath)) {
    $secret = @{}
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        foreach ($name in 'AUTH_SECRET','OTP_SECRET','ORACLE_REGISTRY_API_TOKEN','EVENT_WORKER_SECRET','FABRIC_MEDICAL_REVIEW_NOTE_KEY') {
            $bytes = New-Object byte[] 32
            $rng.GetBytes($bytes)
            $secret[$name] = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
        }
    } finally { $rng.Dispose() }
    $secret | ConvertTo-Json | Set-Content -LiteralPath $secretPath -Encoding Ascii
}
$settings = Get-Content -LiteralPath $secretPath -Raw | ConvertFrom-Json
foreach ($setting in $settings.PSObject.Properties) { Set-Item -LiteralPath "Env:$($setting.Name)" -Value $setting.Value }
$env:FABRIC_CHANNEL_NAME = 'insurance-dev-lite-190'
$env:FABRIC_CHAINCODE_NAME = 'insurance-contract'
$env:FABRIC_EXPECTED_SCHEMA_VERSION = '15'
$env:FABRIC_NETWORK_ROOT = $state
$env:FABRIC_MEDICAL_REVIEW_ENABLED = 'true'
$env:FABRIC_XGBOOST_ENABLED = 'true'
$env:FABRIC_ORACLE_PEER_ENDPOINT = 'localhost:31451'
$env:FABRIC_ORACLE_PEER_HOST_ALIAS = 'peer0.oracle.blockinsure.test'
$env:FABRIC_COMMIT_STATUS_DEADLINE_SECONDS = '90'
$env:FABRIC_ENDORSE_DEADLINE_SECONDS = '45'
$env:FABRIC_EVALUATE_DEADLINE_SECONDS = '20'
$env:FABRIC_EVENT_START_BLOCK = '0'
$env:ENABLE_DEMO_AUTH = 'true'
$env:SESSION_COOKIE_SECURE = 'false'
$env:APP_ORIGIN = "http://127.0.0.1:$port"
$env:ORACLE_REGISTRY_API_URL = "$env:APP_ORIGIN/api/public/oracle-registries"
$env:EVENT_SYNC_URL = "$env:APP_ORIGIN/api/internal/events/sync"
$env:EMAIL_GATEWAY_URL = ' '
$env:EMAIL_GATEWAY_TOKEN = ' '
$env:ORACLE_STATE_ROOT = Join-Path $state 'oracle'
$env:EVIDENCE_STORAGE_ROOT = Join-Path $state 'evidence'
$env:EVENT_PROJECTION_ROOT = Join-Path $state 'events'
$env:OTP_STATE_ROOT = Join-Path $state 'otp'
$env:WORKFLOW_OPERATION_ROOT = Join-Path $state 'journal'
$env:MEDICAL_FINDINGS_INVESTIGATOR = 'insurer-admin'
$env:MEDICAL_FINDINGS_ROOT = Join-Path $state 'research-findings'
$env:ORACLE_MODEL_VERSION = 'fabric-xgb-synthetic-v1'
$env:ORACLE_MODEL_HASH = '4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4'

$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff')
$logs = Join-Path $state 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$children = [Collections.Generic.List[object]]::new()
function Launch([string]$Name, [string]$Directory, [string[]]$Arguments) {
    $receipt = & node (Join-Path $PSScriptRoot 'start-background-node.mjs') --directory $Directory --stdout (Join-Path $logs "$stamp-$Name.out.log") --stderr (Join-Path $logs "$stamp-$Name.err.log") -- @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Could not start dev-lite $Name" }
    $process = Get-Process -Id (($receipt | ConvertFrom-Json).id)
    $children.Add(@{ Id = $process.Id; Started = $process.StartTime.ToUniversalTime().Ticks })
}

try {
    Launch 'web' $web @('node_modules/next/dist/bin/next','dev','--port',"$port",'--hostname','127.0.0.1')
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $health = Invoke-RestMethod "$env:APP_ORIGIN/api/fabric/health" -TimeoutSec 5
            if ($health.channel -eq $env:FABRIC_CHANNEL_NAME -and $health.schemaVersion -eq 15) { $healthy = $true; break }
        } catch {}
        Start-Sleep -Seconds 2
    }
    if (-not $healthy) { throw 'Dev-lite web health did not confirm the selected channel and schema.' }
    foreach ($workerPort in $oraclePorts) {
        $id = $workerPort - 3310
        $env:ORACLE_ID = "oracle$id"
        $env:ORACLE_LABEL = "Dev-lite Oracle $id"
        $env:ORACLE_HEALTH_PORT = "$workerPort"
        $env:ORACLE_REGISTRY_PATH = "registry/oracle$id-v1.json"
        Launch "oracle$id" $workers @('src/index.mjs')
    }
    Launch 'events' $web @('scripts/sync-events.mjs')
    $online = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $ready = @($oraclePorts | Where-Object {
            try { (Invoke-RestMethod "http://127.0.0.1:$_/health" -TimeoutSec 2).status -eq 'ONLINE' }
            catch { $false }
        })
        if ($ready.Count -eq $oraclePorts.Count) { $online = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $online) { throw 'Dev-lite Oracle readiness did not confirm every selected worker.' }
    Write-Host "Dev-lite application is available at $env:APP_ORIGIN. Stop this controller to stop its processes."
    while ($true) { Start-Sleep -Seconds 2 }
} finally {
    foreach ($child in $children) {
        $process = Get-Process -Id $child.Id -ErrorAction SilentlyContinue
        if ($process -and $process.ProcessName -eq 'node' -and $process.StartTime.ToUniversalTime().Ticks -eq $child.Started) {
            Stop-Process -Id $child.Id
        }
    }
}
