$ErrorActionPreference='Stop'
. "$PSScriptRoot/candidate-profile.ps1"
function Assert($Condition,$Message) { if(-not $Condition){throw $Message} }
$candidate=Get-CandidateProfile (Split-Path -Parent $PSScriptRoot)
Assert ($candidate.Channel -eq 'insurance-workflow-alignment-20261108' -and $candidate.Sequence -eq 4) 'Candidate selection changed.'
$start=[datetime]::UtcNow
$record=@{id=123;startTimeUtcTicks=$start.Ticks}
$inspect={param($processId) [pscustomobject]@{ProcessName='node';StartTime=$start}}
Assert (Test-CandidateProcess $record $inspect) 'Original process was not recognized.'
$wrongTime={param($processId) [pscustomobject]@{ProcessName='node';StartTime=$start.AddSeconds(1)}}
Assert (-not(Test-CandidateProcess $record $wrongTime)) 'Reused PID was adopted.'
$wrongName={param($processId) [pscustomobject]@{ProcessName='unrelated';StartTime=$start}}
Assert (-not(Test-CandidateProcess $record $wrongName)) 'Unrelated process was adopted.'
Assert (-not(Test-CandidateProcess $record {param($processId) $null})) 'Stopped process reported running.'
$temporary=Join-Path $candidate.Root '.local-reference/candidate-profile-tests'
New-Item -ItemType Directory -Force -Path $temporary | Out-Null
$recordsPath=Join-Path $temporary 'records.json'
'[{"id":123,"name":"first"},{"id":456,"name":"second"}]' | Set-Content -LiteralPath $recordsPath
$decoded=@(Read-CandidateRecords $recordsPath)
Assert ($decoded.Count -eq 2 -and $decoded[0].id -eq 123 -and $decoded[1].id -eq 456) 'JSON records were nested instead of enumerated.'
$missing=$false
try { Get-CandidateSecrets (Join-Path $temporary 'missing.json') | Out-Null } catch { $missing=$_.ToString().Contains('Do not regenerate') }
Assert $missing 'Missing original secrets did not fail safely.'
$invalid=Join-Path $temporary 'invalid.json'
'{"AUTH_SECRET":"short"}' | Set-Content -LiteralPath $invalid
$failed=$false
try { Get-CandidateSecrets $invalid | Out-Null } catch { $failed=$_.ToString().Contains('too short') }
Assert $failed 'Invalid secret configuration was accepted.'
$secrets=@{AUTH_SECRET=('a'*40);OTP_SECRET=('b'*40);ORACLE_REGISTRY_API_TOKEN=('c'*40)}
$env:FABRIC_CHANNEL_NAME='insurance-channel'
$env:ORACLE_ID='oracle3'
$env:ORACLE_MODEL_HASH='inherited-wrong-profile'
$env:EMAIL_GATEWAY_URL='https://external.invalid/never-send'
$env:FABRIC_ORACLE_HOST_PORT='23051'
$restore=@{}
Set-CandidateEnvironment $candidate $secrets -Restore $restore
Assert ($env:FABRIC_CHANNEL_NAME -eq $candidate.Channel) 'Inherited main channel was retained.'
Assert ($null -eq $env:ORACLE_ID -and $null -eq $env:ORACLE_MODEL_HASH) 'Role-specific profile inherited the wrong Oracle settings.'
Assert ($env:EMAIL_GATEWAY_URL.Trim() -eq '') 'External email provider leaked into local profile.'
Assert ($env:FABRIC_ORACLE_PEER_ENDPOINT -eq 'localhost:23051') 'Oracle Gateway ignored a configured alternate port.'
Assert ($env:WORKFLOW_OPERATION_ROOT -eq (Join-Path $candidate.Root 'data/workflow-operations-alignment-20261108')) 'Journal root changed.'
Assert ($env:AUTH_SECRET -eq $secrets.AUTH_SECRET -and $env:OTP_SECRET -eq $secrets.OTP_SECRET) 'Existing custody secrets changed.'
Assert ($env:EVENT_WORKER_SECRET.Length -eq 64 -and $env:BANKING_WORKER_SECRET.Length -eq 64) 'Worker credentials not initialized.'
Restore-CandidateEnvironment $restore
Assert ($env:FABRIC_CHANNEL_NAME -eq 'insurance-channel' -and $env:ORACLE_ID -eq 'oracle3') 'Candidate configuration leaked into its caller.'
Assert ($env:EMAIL_GATEWAY_URL -eq 'https://external.invalid/never-send') 'Caller delivery settings were changed.'
Assert ($env:FABRIC_ORACLE_HOST_PORT -eq '23051') 'Oracle host port was changed by candidate setup.'
'PASSED: candidate boundaries, stale PID denial, missing/invalid secret recovery, preserved roots and external delivery isolation.'
