param([string]$RuntimeDirectory = (Join-Path $PSScriptRoot '..'), [switch]$Once)
$ErrorActionPreference = 'Stop'
$runtime = (Resolve-Path -LiteralPath $RuntimeDirectory).Path
$state = Join-Path $env:LOCALAPPDATA 'fxpw-seelen\sensors'
New-Item -ItemType Directory -Path $state -Force | Out-Null
$configFile = Join-Path $state 'bridge.json'
$log = Join-Path $state 'startup.log'
$ownsMutex = $false
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex = New-Object Threading.Mutex($true, ('Local\fxpw.Seelen.SensorSession.'+$sid), [ref]$ownsMutex)
if (-not $ownsMutex) { $mutex.Dispose(); exit 0 }
$loadedPid = 0
$lastLaunch = [DateTime]::MinValue
try {
    do {
        try {
            $config = $null
            $healthy = $false
            if (Test-Path -LiteralPath $configFile) {
                $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
                try {
                    $null = Invoke-RestMethod -Uri ('http://127.0.0.1:'+$config.port+'/metrics') -Headers @{Authorization=('Bearer '+$config.token)} -TimeoutSec 2
                    $healthy = $true
                } catch {}
            }
            if (-not $healthy -and ([DateTime]::UtcNow-$lastLaunch).TotalSeconds -gt 15) {
                $arguments = @(('"'+(Join-Path $runtime 'sensors\temperatures\bridge.mjs')+'"'))
                if ($config) { $arguments += '--reuse-config' }
                Start-Process -FilePath (Join-Path $runtime 'sensors\node.exe') -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardError (Join-Path $state 'bridge-error.log') | Out-Null
                $lastLaunch = [DateTime]::UtcNow
            }
            $app = Get-Process -Name seelen-ui -ErrorAction SilentlyContinue | Where-Object Path -EQ (Join-Path $runtime 'seelen-ui.exe') | Select-Object -First 1
            if ($healthy -and $app -and $app.Id -ne $loadedPid) {
                # The server starts after resources initialize, so loading the one
                # temperature plugin cannot race the initial resource scan.
                $null = Invoke-RestMethod 'http://127.0.0.1:37074/ping' -TimeoutSec 2
                & (Join-Path $runtime 'sensors\install.ps1') -RuntimeDirectory $runtime | Out-Null
                $loadedPid = $app.Id
                Add-Content -LiteralPath $log -Encoding UTF8 -Value ([DateTime]::UtcNow.ToString('o')+' temperatures attached to release app PID '+$loadedPid)
            }
        } catch {
            Add-Content -LiteralPath $log -Encoding UTF8 -Value ([DateTime]::UtcNow.ToString('o')+' '+$_.Exception.Message)
        }
        [IO.File]::WriteAllText((Join-Path $state 'session-state.json'),(@{
            pid=$PID;runtime=$runtime;sampledAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();bridgeHealthy=$healthy;attachedPid=$loadedPid
        } | ConvertTo-Json -Compress))
        if ($Once) { break }
        Start-Sleep -Seconds 5
    } while ($true)
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
