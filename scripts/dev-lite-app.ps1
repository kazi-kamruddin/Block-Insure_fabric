[CmdletBinding()]
# -Collections starts the automatic EFT premium collection worker.
# -Email sends OTPs and Bank notices through the local Brevo connector, which
# needs data/<profile>/email-gateway.json (see tools/email-gateway/README.md).
# -Onboarding enables LevelDB dev-lite customer accounts and starts its Insurer CA.
param(
    [switch]$TwoOracles, [switch]$CouchDB, [switch]$Collections,
    [switch]$Email, [switch]$Onboarding, [switch]$Production, [switch]$Stop
)
$ErrorActionPreference = 'Stop'
if ($Onboarding -and $CouchDB) { throw '-Onboarding requires the LevelDB dev-lite profile.' }
$root = Split-Path -Parent $PSScriptRoot
$definition = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'profiles/dev-lite-190.json') | ConvertFrom-Json
if ($definition.repoRoot) { $root = $definition.repoRoot }
$profile = if ($CouchDB) { 'dev-lite-couchdb' } else { 'dev-lite' }
$state = Join-Path $root "data/$profile"
$web = Join-Path $root 'apps/web'
$workers = Join-Path $root 'services/oracle-worker'
$port = $definition.webPort
$oraclePorts = if ($TwoOracles) { @(3311,3312) } else { @(3311,3312,3313) }
$emailPort = 3330
$pidDirectory = Join-Path $state 'logs/pids'

function Stop-RecordedChild($Child) {
    $process = Get-Process -Id $Child.Id -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq 'node' -and
        $process.StartTime.ToUniversalTime().Ticks -eq [long]$Child.Started) {
        # Next dev may have a child server. Only stop the verified PID tree.
        & taskkill.exe /PID $Child.Id /T /F 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0 -and -not $process.HasExited) {
            throw "Could not stop dev-lite Node process $($Child.Id)."
        }
    }
}

if ($Stop) {
    $failed = 0
    foreach ($file in @(Get-ChildItem -LiteralPath $pidDirectory -Filter '*.pid.json' -File -ErrorAction SilentlyContinue)) {
        try {
            $child = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json
            if ($child.Id -notmatch '^\d+$' -or $child.Id -le 0 -or $child.Started -notmatch '^\d+$') {
                throw 'Invalid dev-lite PID receipt.'
            }
            Stop-RecordedChild $child
            Remove-Item -LiteralPath $file.FullName -ErrorAction SilentlyContinue
        } catch {
            $failed++
            Write-Warning "Could not clean up receipt $($file.Name)."
        }
    }
    if ($failed) { throw "Could not clean up $failed dev-lite PID receipt(s)." }
    return
}

$webArguments = @('node_modules/next/dist/bin/next','dev','--port',"$port",'--hostname','127.0.0.1')
if ($Production) {
    $server = Join-Path $web '.next/standalone/server.js'
    if (-not (Test-Path -LiteralPath $server -PathType Leaf)) {
        throw 'Standalone web build is missing. Stop Fabric and run npm --prefix apps/web run build before starting with -Production.'
    }
    $sourceDirectories = @('app', 'components', 'lib' | ForEach-Object { Join-Path $web $_ })
    $buildTime = (Get-Item -LiteralPath $server).LastWriteTimeUtc
    $newerSource = Get-ChildItem -LiteralPath $sourceDirectories -Recurse -File |
        Where-Object LastWriteTimeUtc -gt $buildTime | Select-Object -First 1
    if ($newerSource) {
        throw "Standalone web build is older than $($newerSource.Name). Stop Fabric and rebuild before starting with -Production."
    }
    $env:PORT = "$port"
    $env:HOSTNAME = '127.0.0.1'
    $webArguments = @('scripts/start-standalone.mjs')
}
$ownedPorts = @($port) + $oraclePorts + $(if ($Email) { @($emailPort) } else { @() })
if (@(Get-NetTCPConnection -LocalPort $ownedPorts -State Listen -ErrorAction SilentlyContinue).Count) {
    throw 'A dev-lite app or worker port already has an owner.'
}
if (-not (Test-Path -LiteralPath (Join-Path $state 'enrollment-complete'))) {
    throw "Enroll and deploy through network.sh --$profile before starting the app."
}
$onboardingCa = $null
if ($Onboarding) {
    $caContainers = @(& docker ps -a --no-trunc `
        --filter 'label=com.docker.compose.project=block-insure-dev-lite' `
        --filter 'label=com.docker.compose.service=ca-insurer' `
        --format '{{.ID}}|{{.Names}}|{{.State}}')
    if ($LASTEXITCODE -ne 0 -or $caContainers.Count -ne 1) {
        throw 'Expected exactly one existing LevelDB dev-lite Insurer CA.'
    }
    $ca = [regex]::Match($caContainers[0], '^(?<id>[0-9a-f]{64})\|block-insure-dev-lite-ca-insurer-1\|(?:exited|created)$')
    if (-not $ca.Success) { throw 'Expected the existing LevelDB dev-lite Insurer CA to be stopped.' }
    $onboardingCa = $ca.Groups['id'].Value
}
$secretPath = Join-Path $state 'app-secrets.json'
$secretNames = 'AUTH_SECRET','OTP_SECRET','ORACLE_REGISTRY_API_TOKEN','EVENT_WORKER_SECRET','FABRIC_MEDICAL_REVIEW_NOTE_KEY','FABRIC_MEDICAL_REVIEW_REASON_KEY','BANKING_WORKER_SECRET','EMAIL_GATEWAY_TOKEN'
if ($Onboarding) { $secretNames += 'CUSTOMER_WALLET_KEY','CUSTOMER_PII_KEY' }
$secret = [ordered]@{}
if (Test-Path -LiteralPath $secretPath) {
    try { $settings = Get-Content -LiteralPath $secretPath -Raw | ConvertFrom-Json }
    catch { throw 'Dev-lite app-secrets.json could not be read as JSON.' }
    if (-not ($settings -is [pscustomobject])) { throw 'Dev-lite app-secrets.json must contain a JSON object.' }
    foreach ($setting in $settings.PSObject.Properties) { $secret[$setting.Name] = $setting.Value }
}
# Existing secrets are never replaced; only newly introduced names are added.
$missing = @($secretNames | Where-Object { -not $secret.Contains($_) })
if ($missing.Count) {
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        foreach ($name in $missing) {
            $bytes = New-Object byte[] 32
            $rng.GetBytes($bytes)
            $secret[$name] = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
        }
    } finally { $rng.Dispose() }
    $secret | ConvertTo-Json | Set-Content -LiteralPath $secretPath -Encoding Ascii
}
foreach ($setting in $secret.GetEnumerator()) { Set-Item -LiteralPath "Env:$($setting.Key)" -Value $setting.Value }
$env:DEV_LITE_ONBOARDING = if ($Onboarding) { 'true' } else { 'false' }
if ($Onboarding) { $env:CUSTOMER_STATE_ROOT = $state }
$env:FABRIC_CHANNEL_NAME = $definition.channel
$env:FABRIC_CHAINCODE_NAME = $definition.chaincodeName
$env:FABRIC_EXPECTED_SCHEMA_VERSION = "$($definition.schemaVersion)"
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
$env:BANKING_COLLECTION_URL = "$env:APP_ORIGIN/api/internal/banking/collections"
$env:BANKING_BUSINESS_TIMEZONE = 'Asia/Dhaka'
if (-not $env:BANKING_COLLECTION_INTERVAL_MS) { $env:BANKING_COLLECTION_INTERVAL_MS = '60000' }
$emailConfig = Join-Path $state 'email-gateway.json'
if ($Email) {
    if (-not (Test-Path -LiteralPath $emailConfig)) { throw "-Email needs $emailConfig. See tools/email-gateway/README.md." }
    $env:EMAIL_GATEWAY_URL = "http://127.0.0.1:$emailPort/send"
    $env:EMAIL_GATEWAY_CONFIG = $emailConfig
    $env:EMAIL_GATEWAY_PORT = "$emailPort"
} else {
    # A blank gateway selects the on-screen demo delivery.
    $env:EMAIL_GATEWAY_URL = ' '
    $env:EMAIL_GATEWAY_TOKEN = ' '
}
$env:ORACLE_STATE_ROOT = Join-Path $state 'oracle'
$env:MEDICAL_REVIEW_REASON_ROOT = Join-Path $state 'review-reasons'
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
New-Item -ItemType Directory -Path $pidDirectory -Force | Out-Null
$children = [Collections.Generic.List[object]]::new()
$startedOnboardingCA = $false
function Launch([string]$Name, [string]$Directory, [string[]]$Arguments) {
    $receipt = & node (Join-Path $PSScriptRoot 'start-background-node.mjs') --directory $Directory --stdout (Join-Path $logs "$stamp-$Name.out.log") --stderr (Join-Path $logs "$stamp-$Name.err.log") -- @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Could not start dev-lite $Name" }
    $process = Get-Process -Id (($receipt | ConvertFrom-Json).id)
    $child = @{
        Id = $process.Id
        Started = $process.StartTime.ToUniversalTime().Ticks.ToString()
        PidPath = Join-Path $pidDirectory "$stamp-$Name.pid.json"
    }
    $children.Add($child)
    @{ Id = $child.Id; Started = $child.Started } | ConvertTo-Json -Compress |
        Set-Content -LiteralPath $child.PidPath -Encoding Ascii
}

try {
    if ($onboardingCa) {
        & docker start $onboardingCa | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not start the existing LevelDB dev-lite Insurer CA.' }
        $startedOnboardingCA = $true
    }
    if ($Email) {
        Launch 'email' $root @('tools/email-gateway/server.mjs')
        $emailReady = $false
        for ($attempt = 0; $attempt -lt 15; $attempt++) {
            try { if ((Invoke-RestMethod "http://127.0.0.1:$emailPort/health" -TimeoutSec 2).status -eq 'ONLINE') { $emailReady = $true; break } } catch {}
            Start-Sleep -Seconds 1
        }
        if (-not $emailReady) { throw 'The local email connector did not report ONLINE. Check its log under data/<profile>/logs.' }
    }
    Launch 'web' $web $webArguments
    $webPidPath = $children[$children.Count - 1].PidPath
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $health = Invoke-RestMethod "$env:APP_ORIGIN/api/fabric/health" -TimeoutSec 5
            if ($health.channel -eq $definition.channel -and $health.schemaVersion -eq $definition.schemaVersion) { $healthy = $true; break }
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
    if ($Collections) { Launch 'collections' $web @('scripts/process-premium-collections.mjs') }
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
    $extras = @($(if ($Collections) { 'automatic premium collection' }), $(if ($Email) { 'email delivery through Brevo' }), $(if ($Onboarding) { 'customer onboarding' })) | Where-Object { $_ }
    if ($extras.Count) { Write-Host "Also running: $($extras -join ', ')." }
    Write-Host "Dev-lite application is available at $env:APP_ORIGIN. Stop this controller to stop its processes."
    while (Test-Path -LiteralPath $webPidPath) { Start-Sleep -Seconds 2 }
} finally {
    try {
        foreach ($child in $children) {
            try {
                Stop-RecordedChild $child
                if (Test-Path -LiteralPath $child.PidPath) { Remove-Item -LiteralPath $child.PidPath -ErrorAction SilentlyContinue }
            } catch {
                Write-Warning "Could not clean up tracked dev-lite process $($child.Id). Use -Stop to retry."
            }
        }
    } finally {
        if ($startedOnboardingCA) {
            & docker stop $onboardingCa | Out-Null
            if ($LASTEXITCODE -ne 0) { Write-Warning 'Could not stop the Insurer CA started by this controller.' }
        }
    }
}
