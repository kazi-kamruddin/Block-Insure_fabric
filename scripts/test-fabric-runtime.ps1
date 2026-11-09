$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/fabric-runtime.ps1"
$peer = 'peer0.insurer.blockinsure.test'
$legacy = 'dev-peer0.insurer.blockinsure.test-insurance-contract_1.4.0-hash'
$selected = 'dev-peer0.insurer.blockinsure.test-insurance-contract_1.6.0-xgb-alignment-hash'
$unrelated = 'dev-peer0.other.example-insurance-contract_1.4.0-hash'
function Assert-True($value, $message) { if (-not $value) { throw $message } }
$unwanted = @(Get-UnselectedFabricRuntime -Names @($legacy, $selected, $unrelated) -Organizations @('insurer') -Version '1.6.0-xgb-alignment')
Assert-True ($unwanted.Count -eq 1 -and $unwanted[0] -eq $legacy) 'Selected or unrelated runtime was targeted.'
$clock = @{ now = 0; stopped = @(); emitted = @{} }
Wait-FabricRuntimeStable -Required @($peer) -CoreOnly -MinimumSeconds 40 -QuietSeconds 15 -TimeoutSeconds 100 `
    -Now { $clock.now } -Pause { $clock.now++ } -Sample {
        $names = @($peer, $unrelated)
        foreach ($time in @(3, 25, 39)) {
            if ($clock.now -ge $time -and -not $clock.emitted.ContainsKey($time)) { $names += $legacy; $clock.emitted[$time] = $true }
        }
        @{ Names = $names; AvailableBytes = 256MB }
    } -StopRuntime { param($names) $clock.stopped += $names }
Assert-True ($clock.now -ge 54 -and $clock.stopped.Count -eq 3) 'Late runtime did not reset the quiet interval.'
$clock.now = 0
$failed = $false
try { Wait-FabricRuntimeStable -Required @($peer) -CoreOnly -MinimumSeconds 40 -TimeoutSeconds 45 -Now { $clock.now } -Pause { $clock.now++ } -Sample { @{ Names = @($peer, $legacy); AvailableBytes = 256MB } } -StopRuntime { param($names) } }
catch { $failed = $_.ToString().Contains('did not stabilize') }
Assert-True $failed 'Continuous delayed launches were declared ready.'
$failed = $false
try { Wait-FabricRuntimeStable -Required @($peer) -Sample { @{ Names = @($peer); AvailableBytes = 64MB } } -StopRuntime { param($names) } }
catch { $failed = $_.ToString().Contains('available memory') }
Assert-True $failed 'Low-memory launch was declared ready.'
Write-Output 'PASSED: delayed starts, quiet-window reset, timeout, memory floor and unrelated/selected runtime isolation.'
