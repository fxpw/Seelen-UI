$ErrorActionPreference = 'Stop'
$state = Join-Path $env:LOCALAPPDATA 'fxpw-seelen\sensors'
$configFile = Join-Path $state 'bridge.json'
$before = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
$bridge = (Resolve-Path (Join-Path $PSScriptRoot 'bridge.mjs')).Path
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$($before.pid)"
if ($process) {
    if ($process.Name -ne 'node.exe' -or $process.CommandLine -notmatch [regex]::Escape($bridge)) {
        throw 'Sensor PID does not belong to this bridge; it was not stopped.'
    }
    Stop-Process -Id $before.pid -ErrorAction Stop
}
$node = (Get-Command node.exe).Source
Start-Process -FilePath $node -ArgumentList @(('"'+$bridge+'"'),'--reuse-config') -WindowStyle Hidden -RedirectStandardError (Join-Path $state 'bridge-error.log') | Out-Null
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
    Start-Sleep -Milliseconds 300
    try {
        $current = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
        if ($current.pid -eq $before.pid) { continue }
        if ($current.port -ne $before.port -or $current.token -ne $before.token) { throw 'Endpoint changed unexpectedly.' }
        $metrics = Invoke-RestMethod -Uri ('http://127.0.0.1:'+$current.port+'/metrics') -Headers @{Authorization=('Bearer '+$current.token)} -TimeoutSec 2
        [pscustomobject]@{Ready=$true;Cpu=$metrics.cpu;Gpu=$metrics.gpu;ExistingWidgetEndpointPreserved=$true} | ConvertTo-Json -Depth 5
        return
    } catch {
        if ($_.Exception.Message -eq 'Endpoint changed unexpectedly.') { throw }
    }
} while ([DateTime]::UtcNow -lt $deadline)
throw 'Sensor bridge did not return; see the local bridge-error.log.'
