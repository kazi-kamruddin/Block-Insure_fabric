[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Start','Status','Stop','StopWorker','RestartWorker')][string]$Action,
    [ValidateRange(1,3)][int]$Worker,
    [switch]$Onboarding,
    [switch]$Collections,
    [switch]$ReadOnly
)

$ErrorActionPreference = 'Stop'
$definition = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'profiles/dev-lite-190.json') | ConvertFrom-Json
$root = if ($definition.repoRoot) { $definition.repoRoot } else { Split-Path -Parent $PSScriptRoot }
$state = Join-Path $root 'data/dev-lite'
$logs = Join-Path $state 'logs/r2-demo'
$runPath = Join-Path $logs 'run.json'
$appScript = Join-Path $PSScriptRoot 'dev-lite-app.ps1'
$project = 'block-insure-dev-lite'
$peers = 'insurer','hospital','auditor','bank','oracle'
$baseServices = @('orderer') + @($peers | ForEach-Object { "peer-$_" })
$requiredServices = $baseServices + @('insurance-chaincode')
$knownServices = $requiredServices + @('ca-insurer')
$directPorts = $definition.r2Demo.directAdapterPorts
$mirrorPorts = $definition.r2Demo.mirrorAdapterPorts
$businessFloor = $definition.r2Demo.writeMemoryFloorMb

if (($Action -in @('StopWorker','RestartWorker')) -ne [bool]$Worker) { throw 'Specify -Worker only with StopWorker or RestartWorker.' }
if (($Onboarding -or $Collections -or $ReadOnly) -and $Action -ne 'Start') { throw '-Onboarding, -Collections and -ReadOnly apply only to Start.' }
if ($ReadOnly -and ($Onboarding -or $Collections)) { throw '-ReadOnly cannot be used with -Onboarding or -Collections.' }

function Get-Containers {
    $lines = @(& docker ps --all --no-trunc --filter "label=com.docker.compose.project=$project" --format '{{.ID}}|{{.Names}}|{{.State}}')
    if ($LASTEXITCODE) { throw 'Could not inspect the local Docker engine.' }
    $containers = @{}
    foreach ($line in $lines) {
        if ($line -match '^([a-f0-9]{64})\|block-insure-dev-lite-([a-z-]+)-1\|([a-z]+)$' -and $Matches[2] -in $knownServices) {
            $containers[$Matches[2]] = @{ Id = $Matches[1]; State = $Matches[3] }
        }
    }
    return $containers
}

function Get-AvailableMemory {
    return [int][math]::Floor((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
}

function Write-RunReceipt($Record) {
    $Record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $runPath -Encoding Ascii
}

function Start-OwnedContainer([string]$Service, $Record) {
    $container = (Get-Containers)[$Service]
    if (-not $container -or $container.State -notin @('created','exited')) { throw "Expected the stopped retained dev-lite $Service container." }
    $Record.Containers += [pscustomobject]@{ Service = $Service; Id = $container.Id }
    Write-RunReceipt $Record
    & docker start $container.Id | Out-Null
    if ($LASTEXITCODE) { throw "Could not start dev-lite $Service." }
}

function Start-Ccaas($Runtime, $Record) {
    $imageId = & docker image inspect $Runtime.image --format '{{.Id}}'
    if ($LASTEXITCODE -or $imageId -notmatch '^sha256:[a-f0-9]{64}$') { throw 'The pinned ccaas image is absent from the local cache.' }
    if (-not (Get-Containers)[$Runtime.service]) {
        $savedId = $env:DEV_LITE_CCAAS_PACKAGE_ID
        $savedData = $env:DEV_LITE_DATA_DIR
        $savedProject = $env:DEV_LITE_COMPOSE_PROJECT
        try {
            $env:DEV_LITE_CCAAS_PACKAGE_ID = $Runtime.packageId
            $env:DEV_LITE_DATA_DIR = 'dev-lite'
            $env:DEV_LITE_COMPOSE_PROJECT = $project
            & docker compose --project-name $project --file (Join-Path $root 'network/compose/compose-dev-lite.yaml') --profile ccaas `
                create --no-build --no-recreate --pull never $Runtime.service | Out-Null
            if ($LASTEXITCODE) { throw 'Could not create the pinned ccaas service from the cached image.' }
        } finally {
            $env:DEV_LITE_CCAAS_PACKAGE_ID = $savedId
            $env:DEV_LITE_DATA_DIR = $savedData
            $env:DEV_LITE_COMPOSE_PROJECT = $savedProject
        }
    }
    $existing = (Get-Containers)[$Runtime.service]
    if (-not $existing) { throw 'The ccaas service container is missing.' }
    $environment = @(& docker inspect --type container --format '{{range .Config.Env}}{{println .}}{{end}}' $existing.Id)
    if ($LASTEXITCODE -or "CHAINCODE_ID=$($Runtime.packageId)" -notin $environment) {
        throw 'The retained ccaas container is bound to a different package ID.'
    }
    $containerImage = & docker inspect --type container --format '{{.Image}}' $existing.Id
    if ($LASTEXITCODE -or $containerImage -ne $imageId) { throw 'The retained ccaas container uses a different image.' }
    Start-OwnedContainer $Runtime.service $Record
}

function Start-Adapter([bool]$Mirror, $Record, $Secrets) {
    $arguments = @('services/integrations/source-adapters/server.mjs','--r1-only','--serve-existing')
    $direct = Join-Path $state 'source-adapters'
    if ($Mirror) {
        $name = 'mirror'
        $ports = $mirrorPorts
        $arguments += @('--root',(Join-Path $state 'source-adapters-mirror'),'--mirror-from',$direct)
    } else {
        $name = 'publisher'
        $ports = $directPorts
        $arguments += @('--root',$direct)
        if (-not $Record.ReadOnly) { $arguments += '--publish-medical' }
    }
    $arguments += @('--port-his',"$($ports[0])",'--port-regulator',"$($ports[1])",'--port-receipt',"$($ports[2])")
    $tokenNames = 'ORACLE_ADAPTER_TOKEN_ORACLE1','ORACLE_ADAPTER_TOKEN_ORACLE2','ORACLE_ADAPTER_TOKEN_ORACLE3','ORACLE_REGISTRY_API_TOKEN'
    $saved = @{}
    try {
        foreach ($setting in $tokenNames) {
            $saved[$setting] = [Environment]::GetEnvironmentVariable($setting, 'Process')
            [Environment]::SetEnvironmentVariable($setting, $Secrets.$setting, 'Process')
        }
        $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff')
        $childJson = & node (Join-Path $PSScriptRoot 'start-background-node.mjs') --directory $root `
            --stdout (Join-Path $logs "$stamp-$name.out.log") --stderr (Join-Path $logs "$stamp-$name.err.log") -- @arguments
        if ($LASTEXITCODE) { throw "Could not start the R2 $name process." }
        $child = Get-Process -Id ($childJson | ConvertFrom-Json).id
        $Record.Adapters += [pscustomobject]@{ Name = $name; Id = $child.Id; Started = $child.StartTime.ToUniversalTime().Ticks.ToString() }
        Write-RunReceipt $Record
    } finally {
        foreach ($setting in $saved.Keys) { [Environment]::SetEnvironmentVariable($setting, $saved[$setting], 'Process') }
    }
    $wait = [Diagnostics.Stopwatch]::StartNew()
    while ($wait.Elapsed.TotalSeconds -lt 30 -and -not $child.HasExited) {
        if (@($ports | Where-Object { Get-HttpHealth "http://127.0.0.1:$_/health" }).Count -eq $ports.Count) { return }
        Start-Sleep -Seconds 1
    }
    throw "R2 $name health is unavailable. Inspect its local log."
}

function Get-HttpHealth([string]$Url) {
    try { return Invoke-RestMethod $Url -TimeoutSec 2 } catch { return $null }
}

function Read-TimingProfile {
    $result = & node (Join-Path $PSScriptRoot 'dev-lite-peer-preflight.mjs') --timing-profile-only
    if ($LASTEXITCODE -eq 0) { return $result | ConvertFrom-Json }
    return $null
}

function Stop-Run($Record) {
    $failed = $false
    if ($Record.AppStarted) {
        try { & $appScript -R2Demo -Stop } catch { $failed = $true; Write-Warning 'Could not stop every tracked web or Oracle process.' }
    }
    foreach ($item in $Record.Adapters) {
        if ($item.Id -notmatch '^\d+$' -or $item.Started -notmatch '^\d+$') { $failed = $true; continue }
        $process = Get-Process -Id ([int]$item.Id) -ErrorAction SilentlyContinue
        if ($process -and $process.ProcessName -eq 'node' -and $process.StartTime.ToUniversalTime().Ticks -eq [long]$item.Started) {
            try { Stop-Process -InputObject $process } catch { $failed = $true; Write-Warning "Could not stop the tracked R2 $($item.Name)." }
        }
    }
    $containers = Get-Containers
    for ($index = $Record.Containers.Count - 1; $index -ge 0; $index--) {
        $item = $Record.Containers[$index]
        if ($item.Service -notin $knownServices -or $item.Id -notmatch '^[a-f0-9]{64}$') { $failed = $true; continue }
        $current = $containers[$item.Service]
        if ($current -and $current.Id -eq $item.Id -and $current.State -in @('running','restarting','paused')) {
            & docker stop --timeout 10 $item.Id | Out-Null
            if ($LASTEXITCODE) { $failed = $true; Write-Warning "Could not stop tracked dev-lite $($item.Service)." }
        }
    }
    if ($failed) { throw 'Some R2 resources still need cleanup. The run receipt is retained.' }
    Remove-Item -LiteralPath $runPath
}

function Show-Status {
    $containers = Get-Containers
    $running = @($knownServices | Where-Object { $containers[$_] -and $containers[$_].State -eq 'running' })
    $ports = @($definition.webPort,3311,3312,3313) + @($directPorts) + @($mirrorPorts)
    $listening = @(Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique)
    $web = if ($definition.webPort -in $listening) { Get-HttpHealth "http://127.0.0.1:$($definition.webPort)/api/fabric/health" }
    $workers = @(1..3 | Where-Object {
        $port = 3310 + $_
        $health = if ($port -in $listening) { Get-HttpHealth "http://127.0.0.1:$port/health" }
        $health.status -in @('ONLINE','PROCESSING') -and $health.oracleId -eq "oracle$_"
    } | ForEach-Object { "oracle$_" })
    $adapters = @((@($directPorts) + @($mirrorPorts)) | Where-Object { $_ -in $listening -and (Get-HttpHealth "http://127.0.0.1:$_/health").status -eq 'ONLINE' })
    $timing = if ('insurance-chaincode' -in $running -and 'peer-insurer' -in $running) { Read-TimingProfile }
    $available = Get-AvailableMemory
    $missing = @($requiredServices | Where-Object { $_ -notin $running })
    $healthy = -not $missing.Count -and $web.channel -eq $definition.channel -and $web.schemaVersion -eq $definition.schemaVersion -and
        $workers.Count -eq 3 -and $adapters.Count -eq 6 -and $timing -and (Test-Path -LiteralPath $runPath)
    [pscustomobject]@{
        Status = if ($healthy) { 'HEALTHY' } elseif ($running.Count -or $workers.Count -or $adapters.Count -or $web) { 'PARTIAL' } else { 'STOPPED' }
        Channel = $definition.channel
        ExpectedSequence = $definition.expectedSequence
        TimingProfile = if ($timing) { "$($timing.profile) (revision $($timing.revision))" } else { 'unavailable' }
        Containers = $running -join ', '
        Workers = $workers -join ', '
        AdapterListeners = "$($adapters.Count)/6"
        Web = if ($web.channel -eq $definition.channel -and $web.schemaVersion -eq $definition.schemaVersion) { "http://127.0.0.1:$($definition.webPort)" } else { 'unavailable' }
        AvailableMemoryMB = $available
        BusinessWriteFloorMB = $businessFloor
        BusinessMemoryReady = $available -ge $businessFloor
    } | Format-List
}

if ($Action -eq 'Status') { Show-Status; return }
if ($Action -eq 'Stop' -and -not (Test-Path -LiteralPath $runPath)) { Write-Output 'No R2 demo run is recorded.'; return }

New-Item -ItemType Directory -Path $logs -Force | Out-Null
$operationLock = [IO.File]::Open((Join-Path $logs 'operation.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
    if ($Action -ne 'Start') {
        if (-not (Test-Path -LiteralPath $runPath)) { throw 'No R2 demo run is recorded.' }
        $record = Get-Content -Raw -LiteralPath $runPath | ConvertFrom-Json
        if ($Action -eq 'Stop') { Stop-Run $record; Write-Output 'Stopped the tracked R2 demo.'; return }
        if (-not $record.AppStarted) { throw 'The R2 application did not reach its startup stage.' }
        & $appScript -R2Demo -Stop -Worker $Worker
        if ($Action -eq 'RestartWorker') { & $appScript -R2Demo -Production -Worker $Worker -ReadOnly:([bool]$record.ReadOnly) }
        return
    }

    if (Test-Path -LiteralPath $runPath) { throw 'An R2 demo run is already recorded. Use Status or Stop.' }
    if (@(Get-ChildItem -LiteralPath (Join-Path $logs 'apps') -Filter '*.pid.json' -File -ErrorAction SilentlyContinue).Count) {
        throw 'Application PID receipts exist without an R2 demo run receipt.'
    }
    $runtimeJson = & node (Join-Path $PSScriptRoot 'r2-demo-runtime.mjs')
    if ($LASTEXITCODE) { throw 'The active R2 profile or package did not pass its identity check.' }
    $runtime = $runtimeJson | ConvertFrom-Json
    if (-not (Test-Path -LiteralPath (Join-Path $root 'apps/web/.next/standalone/server.js') -PathType Leaf)) {
        throw 'Build the production web app offline before starting the demo.'
    }
    $foreign = @(& docker ps --filter 'label=com.docker.compose.service=orderer' --format '{{.Names}}')
    if ($LASTEXITCODE -or $foreign.Count) { throw 'The R2 demo needs exclusive use of Fabric. Check running orderers and the Docker engine.' }
    $existing = Get-Containers
    $requested = if ($Onboarding) { $knownServices } else { $requiredServices }
    if (@($requested | Where-Object { $existing[$_] -and $existing[$_].State -notin @('exited','created') }).Count) {
        throw 'A required dev-lite service is already running outside this R2 demo.'
    }
    $ports = @($definition.webPort,3311,3312,3313) + @($directPorts) + @($mirrorPorts)
    if (@(Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue).Count) { throw 'An R2 application or adapter port is occupied.' }
    $secrets = Get-Content -Raw -LiteralPath (Join-Path $state 'app-secrets.json') | ConvertFrom-Json
    foreach ($name in 'ORACLE_ADAPTER_TOKEN_ORACLE1','ORACLE_ADAPTER_TOKEN_ORACLE2','ORACLE_ADAPTER_TOKEN_ORACLE3','ORACLE_REGISTRY_API_TOKEN') {
        if (-not $secrets.$name) { throw "The retained adapter setting $name is missing." }
    }
    if ((Get-AvailableMemory) -lt $businessFloor) { throw "Full R2 startup requires $businessFloor MB available." }
    $record = [pscustomobject]@{ Containers = @(); Adapters = @(); AppStarted = $false; ReadOnly = [bool]$ReadOnly }
    Write-RunReceipt $record
    try {
        foreach ($service in $baseServices) { Start-OwnedContainer $service $record }
        $gossipWait = [Diagnostics.Stopwatch]::StartNew()
        do {
            & wsl.exe -d Ubuntu --cd $root --exec bash network/scripts/read-dev-lite-gossip.sh $definition.channel
            if ($LASTEXITCODE -eq 0) {
                & wsl.exe -d Ubuntu --cd $root --exec bash network/scripts/read-dev-lite-gossip.sh $definition.channel insurer auditor
            }
            if ($LASTEXITCODE -eq 0) { break }
            if ($LASTEXITCODE -eq 2) { throw 'The retained discovery configuration is incomplete.' }
            if ($gossipWait.Elapsed.TotalSeconds -ge 60) { throw 'Private-data peers did not converge within the gossip wait.' }
            Start-Sleep -Seconds 2
        } while ($true)
        if ((Get-AvailableMemory) -lt $definition.r2Demo.lifecycleMemoryFloorMb) { throw 'Available memory is below the lifecycle readback floor.' }
        & wsl.exe -d Ubuntu --cd $root --exec bash network/scripts/read-dev-lite-sequence.sh $definition.channel $definition.chaincodeName `
            $runtime.packageId "$($runtime.sequence)" $definition.chaincodeVersion
        if ($LASTEXITCODE) { throw 'Five-peer committed definition and package readback failed.' }
        Start-Ccaas $runtime $record
        $runtimeWait = [Diagnostics.Stopwatch]::StartNew()
        do {
            $timing = Read-TimingProfile
            if ($timing) { break }
            if ($runtimeWait.Elapsed.TotalSeconds -ge 40) { throw 'The ccaas service did not answer the timing profile read.' }
            Start-Sleep -Seconds 2
        } while ($true)
        if ($Onboarding) { Start-OwnedContainer 'ca-insurer' $record }
        Start-Adapter $false $record $secrets
        Start-Adapter $true $record $secrets
        $record.AppStarted = $true
        Write-RunReceipt $record
        & $appScript -R2Demo -Production -Collections:$Collections -ReadOnly:$ReadOnly
        Show-Status
    } catch {
        $startupError = $_
        try { Stop-Run $record } catch { Write-Warning 'Startup cleanup could not stop every tracked resource. Run Status and Stop.' }
        throw $startupError
    }
} finally {
    $operationLock.Dispose()
}
