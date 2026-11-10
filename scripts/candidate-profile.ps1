function Get-CandidateProfile {
    param([Parameter(Mandatory)][string]$Root)
    [pscustomobject]@{
        Root = [IO.Path]::GetFullPath($Root)
        Channel = 'insurance-workflow-alignment-20261108'
        Chaincode = 'insurance-contract'
        Version = '1.6.3-xgb-alignment'
        Sequence = 4
        Schema = 15
        PackageSha = 'bc2a30f5b434c73649f765a31232892941ced4f617c7f5518cf399af8457c44a'
        Builder = 'block-insure/fabric-ccenv:2.5.16-go1.26.10'
        Port = 3200
        StateRoot = Join-Path $Root 'data/candidate-demo'
    }
}

function Read-CandidateRecords {
    param([Parameter(Mandatory)][string]$Path)
    if (Test-Path -LiteralPath $Path) {
        # Windows PowerShell5.1 emits a JSON array as one pipeline object.
        # Enumerate the decoded value explicitly for both supported shells.
        $decoded = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        foreach ($record in $decoded) { $record }
    }
}

function Test-CandidateProcess {
    param($Record, [scriptblock]$Inspect = { param($processId) Get-Process -Id $processId -ErrorAction SilentlyContinue })
    $process = & $Inspect ([int]$Record.id)
    if (-not $process) { return $false }
    return $process.ProcessName -eq 'node' -and
        $process.StartTime.ToUniversalTime().Ticks -eq [long]$Record.startTimeUtcTicks
}

function Get-CandidateSecrets {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw 'Candidate secrets are missing. Restore data/candidate-demo/secrets.json with the original AUTH_SECRET, OTP_SECRET and ORACLE_REGISTRY_API_TOKEN. Do not regenerate secrets for existing state.'
    }
    $secrets = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    foreach ($name in @('AUTH_SECRET', 'OTP_SECRET', 'ORACLE_REGISTRY_API_TOKEN')) {
        if ($secrets.$name -isnot [string] -or $secrets.$name.Length -lt 32) { throw "Candidate secret $name is missing or too short; restore its original value." }
    }
    return $secrets
}

function Set-CandidateEnvironment {
    param([Parameter(Mandatory)]$Candidate, [Parameter(Mandatory)]$Secrets, [hashtable]$Restore=@{})
    $profileKeys=@('ORACLE_ID','ORACLE_LABEL','ORACLE_HEALTH_PORT','ORACLE_REGISTRY_PATH','ORACLE_MODEL_VERSION','ORACLE_MODEL_HASH','FABRIC_EVENT_START_BLOCK')
    $values = @{
        FABRIC_CHANNEL_NAME=$Candidate.Channel; FABRIC_CHAINCODE_NAME=$Candidate.Chaincode
        FABRIC_EXPECTED_SCHEMA_VERSION=[string]$Candidate.Schema
        FABRIC_NETWORK_ROOT=(Join-Path $Candidate.Root 'network'); FABRIC_XGBOOST_ENABLED='true'
        FABRIC_ORACLE_PEER_ENDPOINT='localhost:13051'; FABRIC_ORACLE_PEER_HOST_ALIAS='peer0.oracle.blockinsure.test'
        FABRIC_CHAINCODE_BUILDER=$Candidate.Builder
        ORACLE_STATE_ROOT=(Join-Path $Candidate.Root 'data/oracle-alignment-20261108')
        EVIDENCE_STORAGE_ROOT=(Join-Path $Candidate.Root 'data/evidence-alignment-20261108')
        EVENT_PROJECTION_ROOT=(Join-Path $Candidate.Root 'data/events-alignment-20261108')
        OTP_STATE_ROOT=(Join-Path $Candidate.Root 'data/otp-alignment-20261108')
        WORKFLOW_OPERATION_ROOT=(Join-Path $Candidate.Root 'data/workflow-operations-alignment-20261108')
        ORACLE_REGISTRY_API_URL="http://127.0.0.1:$($Candidate.Port)/api/public/oracle-registries"
        AUTH_SECRET=$Secrets.AUTH_SECRET; OTP_SECRET=$Secrets.OTP_SECRET
        ORACLE_REGISTRY_API_TOKEN=$Secrets.ORACLE_REGISTRY_API_TOKEN
        ENABLE_DEMO_AUTH='true'; SESSION_COOKIE_SECURE='false'
        APP_ORIGIN="http://127.0.0.1:$($Candidate.Port)"; HOSTNAME='127.0.0.1'; PORT=[string]$Candidate.Port
        FABRIC_COMMIT_STATUS_DEADLINE_SECONDS='60'; FABRIC_EVALUATE_DEADLINE_SECONDS='15'
        NODE_OPTIONS='--max-old-space-size=192'
        # Explicit blank overrides keep private .env.local provider settings out
        # of this local-only rehearsal. No external email is sent by this profile.
        EMAIL_GATEWAY_URL=' '; EMAIL_GATEWAY_TOKEN=' '
        EVENT_SYNC_URL="http://127.0.0.1:$($Candidate.Port)/api/internal/events/sync"
        BANKING_COLLECTION_URL="http://127.0.0.1:$($Candidate.Port)/api/internal/banking/collections"
    }
    foreach ($name in @($profileKeys)+@($values.Keys)+@('EVENT_WORKER_SECRET','BANKING_WORKER_SECRET')) {
        $existing=Get-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
        $Restore[$name]=@{present=($null -ne $existing);value=$(if($existing){$existing.Value}else{$null})}
    }
    foreach ($name in $profileKeys) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
    foreach ($entry in $values.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process') }
    foreach ($name in @('EVENT_WORKER_SECRET','BANKING_WORKER_SECRET')) {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes("candidate/$name/" + $Secrets.AUTH_SECRET)) }
        finally { $sha.Dispose() }
        [Environment]::SetEnvironmentVariable($name, ([BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()), 'Process')
    }
}

function Restore-CandidateEnvironment {
    param([hashtable]$State)
    foreach ($entry in $State.GetEnumerator()) {
        if ($entry.Value.present) { Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value.value }
        else { Remove-Item -LiteralPath "Env:$($entry.Key)" -ErrorAction SilentlyContinue }
    }
}
