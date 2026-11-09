function Get-UnselectedFabricRuntime {
    param([string[]]$Names, [string[]]$Organizations, [string]$Version, [switch]$CoreOnly)
    foreach ($name in $Names) {
        foreach ($organization in $Organizations) {
            $prefix = "dev-peer0.$organization.blockinsure.test-insurance-contract_"
            if ($name.StartsWith($prefix, [StringComparison]::Ordinal)) {
                if ($CoreOnly -or -not $name.StartsWith("${prefix}${Version}-", [StringComparison]::Ordinal)) { $name }
                break
            }
        }
    }
}

function Wait-FabricRuntimeStable {
    param(
        [Parameter(Mandatory)][scriptblock]$Sample, [Parameter(Mandatory)][scriptblock]$StopRuntime,
        [Parameter(Mandatory)][string[]]$Required,
        [string[]]$Organizations = @('insurer', 'hospital', 'auditor', 'bank', 'oracle'),
        [string]$Version, [switch]$CoreOnly,
        [int]$MinimumSeconds = 40, [int]$QuietSeconds = 15, [int]$TimeoutSeconds = 150,
        [long]$MinimumAvailableBytes = 134217728,
        [scriptblock]$Now = { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0 },
        [scriptblock]$Pause = { Start-Sleep -Seconds 1 }, [scriptblock]$Observe = { param($snapshot) }
    )
    $start = & $Now
    $quietSince = $null
    while ($true) {
        $sampled = & $Sample
        $seconds = & $Now
        $unwanted = @(Get-UnselectedFabricRuntime -Names $sampled.Names -Organizations $Organizations -Version $Version -CoreOnly:$CoreOnly)
        & $Observe ([ordered]@{ elapsedSeconds = [math]::Round($seconds - $start, 1); availableBytes = $sampled.AvailableBytes; unwanted = $unwanted; names = @($sampled.Names) })
        if ($unwanted.Count) {
            & $StopRuntime $unwanted
            $quietSince = $null
        } else {
            if ($sampled.AvailableBytes -lt $MinimumAvailableBytes) { throw "Fabric guest available memory is below $MinimumAvailableBytes bytes; refusing to add load." }
            $missing = @($Required | Where-Object { $_ -notin $sampled.Names })
            if ($missing.Count) { $quietSince = $null }
            elseif ($null -eq $quietSince) { $quietSince = $seconds }
            if ($null -ne $quietSince -and ($seconds - $start) -ge $MinimumSeconds -and ($seconds - $quietSince) -ge $QuietSeconds) { return }
        }
        if (($seconds - $start) -ge $TimeoutSeconds) { throw "Fabric runtime did not stabilize within $TimeoutSeconds seconds; readiness is not established." }
        & $Pause
    }
}

function Invoke-FabricDocker {
    param([Parameter(Mandatory)][string[]]$Arguments, [int]$TimeoutSeconds = 45)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = (Get-Command docker -ErrorAction Stop).Source
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    if ($null -ne $info.PSObject.Properties['ArgumentList']) {
        foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    } else {
        # Windows PowerShell 5.1 uses .NET Framework without ArgumentList.
        $quoted = foreach ($argument in $Arguments) {
            '"' + ([regex]::Replace([regex]::Replace($argument, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1')) + '"'
        }
        $info.Arguments = $quoted -join ' '
    }
    $process = [Diagnostics.Process]::Start($info)
    try {
        $output = $process.StandardOutput.ReadToEndAsync()
        $errors = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) { $process.Kill(); throw "Docker command timed out: $($Arguments[0])." }
        $stdout = $output.GetAwaiter().GetResult()
        $stderr = $errors.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw "Docker command failed: $stderr" }
        return $stdout.Trim()
    } finally { $process.Dispose() }
}
