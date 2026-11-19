[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('Start','Status','Stop')][string]$Action='Status',
    [switch]$AutomaticCollections,
    [switch]$KeepNetwork
)
$ErrorActionPreference='Stop'
. "$PSScriptRoot/fabric-runtime.ps1"
. "$PSScriptRoot/candidate-profile.ps1"
$candidate=Get-CandidateProfile (Split-Path -Parent $PSScriptRoot)
$restoreEnvironment=@{}
$processPath=Join-Path $candidate.StateRoot 'processes.json'
$networkPath=Join-Path $candidate.StateRoot 'network-ownership.json'
$organizations=@('insurer','hospital','auditor','bank','oracle')
$core=@('orderer.blockinsure.test') + @($organizations | ForEach-Object { "peer0.$_.blockinsure.test"; "couchdb.$_.blockinsure.test" })
$runtimeNames=@($organizations | ForEach-Object { "dev-peer0.$_.blockinsure.test-insurance-contract_$($candidate.Version)-$($candidate.PackageSha)" })
$allowed=@($core)+@($runtimeNames)

function Read-Records {
    Read-CandidateRecords $processPath
}
function Save-Records($records) { ConvertTo-Json -InputObject @($records) -Depth 5 | Set-Content -LiteralPath $processPath -Encoding utf8 }
function Stop-OwnedProcesses {
    $records=@(Read-Records)
    foreach($record in $records) {
        if ((Get-Process -Id ([int]$record.id) -ErrorAction SilentlyContinue) -and -not (Test-CandidateProcess $record)) {
            Write-Warning "Preserving reused PID for $($record.name); the original process ended and this PID is no longer owned."
        }
    }
    foreach($record in $records) { if(Test-CandidateProcess $record) { Stop-Process -Id ([int]$record.id) -ErrorAction Stop } }
    # Retain the registry as recovery/ownership evidence rather than deleting it.
}
function Read-Health([string]$Route,[int]$Port=$candidate.Port) {
    try { Invoke-RestMethod -Uri "http://127.0.0.1:$Port$Route" -TimeoutSec 4 } catch { $null }
}
function Get-Status {
    $records=@(Read-Records)
    $processes=@($records | ForEach-Object { [pscustomobject]@{ name=$_.name; id=$_.id; running=(Test-CandidateProcess $_) } })
    $fabric=Read-Health '/api/fabric/health'
    $ready=Read-Health '/api/health/ready'
    $workers=@(1..3 | ForEach-Object { Read-Health '/health' (3300+$_) })
    $healthy=$records.Count -ge 5 -and @($processes | Where-Object { -not $_.running }).Count -eq 0 -and
        $fabric.channel -eq $candidate.Channel -and $fabric.chaincode -eq $candidate.Chaincode -and
        $fabric.schemaVersion -eq $candidate.Schema -and $ready.status -eq 'ready' -and
        @($workers | Where-Object { $_.status -eq 'ONLINE' }).Count -eq 3
    [pscustomobject]@{ status=$(if($healthy){'READY'}else{'STOPPED_OR_NOT_READY'}); channel=$candidate.Channel; schema=$candidate.Schema;
        version=$candidate.Version; sequence=$candidate.Sequence; packageSha256=$candidate.PackageSha;
        url="http://127.0.0.1:$($candidate.Port)/workspace"; automaticCollections=(@($records | Where-Object { $_.name -eq 'banking-collection-worker' }).Count -gt 0);
        processes=$processes; ledger=$fabric; readiness=$ready; oracleStatuses=@($workers | ForEach-Object { $_.status }) }
}
function Save-NetworkOwnership([string[]]$InitiallyRunning) {
    $runningText=Invoke-FabricDocker -Arguments @('ps','--format','{{.Names}}')
    $running=@($runningText -split '\r?\n' | Where-Object { $_ })
    $old=@()
    if(Test-Path -LiteralPath $networkPath) { $old=@(Read-CandidateRecords $networkPath) }
    $new=@($running | Where-Object { $_ -in $allowed -and $_ -notin $InitiallyRunning } | ForEach-Object {
        [pscustomobject]@{ name=$_; containerId=(Invoke-FabricDocker -Arguments @('inspect','--format','{{.Id}}',$_)) }
    })
    $merged=@($old | Where-Object { $_.name -notin @($new | ForEach-Object { $_.name }) })+@($new)
    ConvertTo-Json -InputObject $merged -Depth 4 | Set-Content -LiteralPath $networkPath -Encoding utf8
}
function Stop-OwnedNetwork([string[]]$PreserveNames=@()) {
    if(-not(Test-Path -LiteralPath $networkPath)) { return }
    $records=@(Read-CandidateRecords $networkPath | Where-Object { $_.name -notin $PreserveNames })
    $inventory=Invoke-FabricDocker -Arguments @('ps','-a','--no-trunc','--format','{{.Names}} {{.ID}}')
    $ids=@{}
    foreach($line in ($inventory -split '\r?\n')) { if($line){$parts=$line -split ' ',2;$ids[$parts[0]]=$parts[1]} }
    foreach($record in $records) {
        if($record.name -notin $allowed) { throw 'Network ownership record contains an unrelated resource; preserve it for inspection.' }
        if($ids.ContainsKey($record.name) -and $ids[$record.name] -ne $record.containerId) { throw "Container $($record.name) changed ownership; preserving it." }
    }
    $names=@($records | Where-Object { $ids.ContainsKey($_.name) } | ForEach-Object { $_.name })
    if($names.Count) { Invoke-FabricDocker -Arguments (@('stop','--timeout','10')+$names) -TimeoutSeconds 45 | Write-Host }
}
function Start-CandidateProcess([string]$Name,[string]$Directory,[string[]]$Arguments) {
    $stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff')
    $logRoot=Join-Path $candidate.StateRoot 'logs'
    $out=Join-Path $logRoot "$stamp-$Name.out.log"
    $err=Join-Path $logRoot "$stamp-$Name.err.log"
    $launched=& node (Join-Path $PSScriptRoot 'start-background-node.mjs') --directory $Directory --stdout $out --stderr $err -- @Arguments
    if($LASTEXITCODE -ne 0){throw "Could not launch $Name; inspect its timestamped logs."}
    $started=$launched | ConvertFrom-Json
    $process=Get-Process -Id ([int]$started.id) -ErrorAction Stop
    [pscustomobject]@{name=$Name;id=$process.Id;startTimeUtcTicks=$process.StartTime.ToUniversalTime().Ticks;stdout=$out;stderr=$err}
}
function Start-Candidate {
    $secrets=Get-CandidateSecrets (Join-Path $candidate.StateRoot 'secrets.json')
    $webRoot=Join-Path $candidate.Root 'apps/web'
    if(-not(Test-Path -LiteralPath (Join-Path $webRoot '.next/standalone/server.js'))) { throw 'Build apps/web before candidate startup. Startup never rebuilds or redeploys.' }
    $archive=Join-Path $candidate.Root "network/channel-artifacts/insurance-contract_$($candidate.Version).tar.gz"
    if(-not(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $candidate.PackageSha) { throw 'Exact verified candidate archive missing or changed; do not redeploy to bypass this check.' }
    Push-Location $candidate.Root
    try { $audit=(& node (Join-Path $candidate.Root 'scripts/audit-source-package.mjs') $archive | ConvertFrom-Json) }
    finally { Pop-Location }
    if($LASTEXITCODE -ne 0 -or $audit.status -ne 'MATCHED') { throw 'Current chaincode source differs from the verified archive.' }
    Set-CandidateEnvironment $candidate $secrets -Restore $script:restoreEnvironment
    $status=Get-Status
    if($status.status -eq 'READY') {
        if([bool]$AutomaticCollections -ne [bool]$status.automaticCollections) { throw 'Candidate is already running with another collection mode. Stop it before changing modes.' }
        $status | ConvertTo-Json -Depth 6; return
    }
    Stop-OwnedProcesses
    foreach($port in @(3200,3301,3302,3303)) {
        if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is owned outside this candidate registry; preserve it." }
    }
    $initialText=Invoke-FabricDocker -Arguments @('ps','--format','{{.Names}}')
    $initial=@($initialText -split '\r?\n' | Where-Object { $_ })
    $otherFabric=@($initial | Where-Object { $_ -match '^ca\.' -or $_ -match '^dev-peer0\.' } | Where-Object { $_ -notin $runtimeNames })
    if($otherFabric.Count) { throw 'Another Fabric profile is running. Stop it through its own supervisor before candidate startup.' }
    if(@($allowed | Where-Object { $_ -notin $initial }).Count -gt 0) {
        $owned=@(Read-CandidateRecords $networkPath)
        foreach($name in @($initial | Where-Object { $_ -in $runtimeNames })) {
            $id=Invoke-FabricDocker -Arguments @('inspect','--format','{{.Id}}',$name)
            if(@($owned | Where-Object { $_.name -eq $name -and $_.containerId -eq $id }).Count -ne 1) {
                throw 'Partial startup includes an unowned candidate runtime. Preserve it and inspect its owner before running the cold-start guard.'
            }
        }
    }
    $records=@()
    try {
        # Drain historical cold-start launches before warming the verified package.
        if(@($allowed | Where-Object { $_ -notin $initial }).Count -gt 0) {
            & "$PSScriptRoot/low-memory-network.ps1" Start -CoreOnly -ChaincodeVersion $candidate.Version -EvidencePath (Join-Path $candidate.StateRoot 'startup.jsonl')
        }
        Save-NetworkOwnership $initial
        $verify=Invoke-FabricDocker -Arguments @('run','--rm','--memory=96m','--cpus=0.5','-e','GOMEMLIMIT=64MiB','-e','GOMAXPROCS=1','-e','FABRIC_ORACLE_HOST_PORT',
            '--mount',"type=bind,source=$($candidate.Root)/network/organizations,target=/organizations,readonly",
            '--mount',"type=bind,source=$($candidate.Root)/network/scripts/verify-candidate.sh,target=/verify.sh,readonly",
            'hyperledger/fabric-tools:2.5.16','sh','/verify.sh','--warm') -TimeoutSeconds 120
        $verify | Add-Content -LiteralPath (Join-Path $candidate.StateRoot 'package-verification.log')
        Wait-FabricRuntimeStable -Required $core -Version $candidate.Version -Sample {
            $names=(Invoke-FabricDocker -Arguments @('ps','--format','{{.Names}}')) -split '\r?\n'
            $memory=Invoke-FabricDocker -Arguments @('exec','orderer.blockinsure.test','cat','/proc/meminfo')
            $match=[regex]::Match($memory,'(?m)^MemAvailable:\s+(\d+)\s+kB')
            if(-not $match.Success){throw 'Cannot establish guest memory readiness.'}
            @{Names=$names;AvailableBytes=[long]$match.Groups[1].Value*1024}
        } -StopRuntime { param($names) Invoke-FabricDocker -Arguments (@('stop','--timeout','1')+$names) | Out-Null }
        & "$PSScriptRoot/low-memory-network.ps1" Status -ChaincodeVersion $candidate.Version
        Save-NetworkOwnership $initial
        $records+=Start-CandidateProcess 'web' $webRoot @('scripts/start-standalone.mjs'); Save-Records $records
        for($attempt=0;$attempt -lt 60;$attempt++) { if(Read-Health '/api/health/live'){break}; Start-Sleep -Milliseconds 500 }
        if(-not(Read-Health '/api/health/live')){throw 'Web startup failed; inspect timestamped candidate logs.'}
        foreach($n in 1..3) { $records+=Start-CandidateProcess "oracle$n" (Join-Path $candidate.Root 'services/oracle-worker') @('src/index.mjs',"--env=.env.oracle$n.example"); Save-Records $records }
        $records+=Start-CandidateProcess 'event-worker' $webRoot @('scripts/sync-events.mjs'); Save-Records $records
        if($AutomaticCollections) { $records+=Start-CandidateProcess 'banking-collection-worker' $webRoot @('scripts/process-premium-collections.mjs'); Save-Records $records }
        for($attempt=0;$attempt -lt 45;$attempt++) { $status=Get-Status; if($status.status -eq 'READY'){break}; Start-Sleep -Seconds 1 }
        if($status.status -ne 'READY'){throw 'Candidate dependencies did not reach readiness; inspect timestamped logs.'}
        $status | ConvertTo-Json -Depth 6
    } catch {
        $failure=$_
        try { Save-NetworkOwnership $initial; Stop-OwnedProcesses; Stop-OwnedNetwork -PreserveNames $initial } catch { Write-Warning 'Owned cleanup incomplete; retain registries and inspect before resuming.' }
        throw $failure
    }
}

New-Item -ItemType Directory -Force -Path (Join-Path $candidate.StateRoot 'logs') | Out-Null
$lock=$null
try {
    $lock=[IO.File]::Open((Join-Path $candidate.StateRoot 'launcher.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    switch($Action) {
        'Start' { Start-Candidate }
        'Status' { Get-Status | ConvertTo-Json -Depth 6 }
        'Stop' { Stop-OwnedProcesses; if(-not $KeepNetwork){Stop-OwnedNetwork}; Write-Output 'Candidate-owned services stopped; all ledger volumes, identities, evidence and checkpoints retained.' }
    }
} finally { if($lock){$lock.Dispose()}; Restore-CandidateEnvironment $restoreEnvironment }
