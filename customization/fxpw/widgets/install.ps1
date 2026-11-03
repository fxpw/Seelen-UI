param([string]$RuntimeDirectory = (Join-Path $PSScriptRoot '..\..\..\target\debug'))
$ErrorActionPreference = 'Stop'
$runtime = (Resolve-Path -LiteralPath $RuntimeDirectory).Path
$slu = Join-Path $runtime 'slu.exe'
if (-not (Test-Path -LiteralPath $slu)) { throw 'Build and start the fork before loading its widgets.' }
$pluginDir = Join-Path $env:LOCALAPPDATA 'fxpw-seelen\sensors\plugin'
$stateDir = Join-Path $env:LOCALAPPDATA 'fxpw-seelen\sensors'
New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$configPath = Join-Path $stateDir 'bridge.json'
$bridgeAvailable = $false
if (Test-Path -LiteralPath $configPath) {
    try {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        $null = Invoke-RestMethod -Uri ('http://127.0.0.1:'+$config.port+'/metrics') -Headers @{Authorization=('Bearer '+$config.token)} -TimeoutSec 2
        $bridgeAvailable = $true
    } catch {}
}
if (-not $bridgeAvailable) {
    $nodePath = Join-Path $runtime 'sensors\node.exe'
    if (-not (Test-Path -LiteralPath $nodePath)) { $nodePath = (Get-Command node.exe).Source }
    $bridgePath = Join-Path $PSScriptRoot 'temperatures\bridge.mjs'
    $bridgeArgs = @('"'+$bridgePath+'"')
    if (Test-Path -LiteralPath $configPath) { $bridgeArgs += '--reuse-config' }
    Start-Process -FilePath $nodePath -ArgumentList $bridgeArgs -WindowStyle Hidden -RedirectStandardError (Join-Path $stateDir 'bridge-error.log') | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
        try {
            $config = Get-Content -LiteralPath $configPath -Raw -ErrorAction Stop | ConvertFrom-Json
            $null = Invoke-RestMethod -Uri ('http://127.0.0.1:'+$config.port+'/metrics') -Headers @{Authorization=('Bearer '+$config.token)} -TimeoutSec 1
            $bridgeAvailable = $true
            break
        } catch {}
    }
    if (-not $bridgeAvailable) { throw 'Temperature bridge did not start; see its local error log.' }
}
$template = (Join-Path $PSScriptRoot 'temperatures\template.js').Replace('\','/')
$tooltip = (Join-Path $PSScriptRoot 'temperatures\tooltip.js').Replace('\','/')
$manifest = @"
id: "@fxpw/temperatures"
metadata:
  displayName:
    en: "CPU and GPU temperatures"
  description:
    en: "Actual hardware readings; unavailable sensors are shown as a dash."
icon: FaThermometerHalf
target: "@seelen/fancy-toolbar"
plugin:
  scopes: []
  template: !include "$template"
  tooltip: !include "$tooltip"
  remoteData:
    metrics:
      url: "http://127.0.0.1:$($config.port)/fxpw-temperatures/label"
      requestInit:
        headers:
          Authorization: "Bearer $($config.token)"
      updateIntervalSeconds: 5
"@
[System.IO.File]::WriteAllText((Join-Path $pluginDir 'metadata.yml'),$manifest)
& $slu resource load plugin $pluginDir
if ($LASTEXITCODE -ne 0) { throw 'Could not load temperatures plugin' }
# WSL is bundled in the fork. Do not enable unrelated plugins here: their global
# enable events can insert status icons into the user's manually arranged panels.
$metrics = Invoke-RestMethod -Uri ('http://127.0.0.1:'+$config.port+'/metrics') -Headers @{Authorization=('Bearer '+$config.token)}
[pscustomobject]@{Gpu=$metrics.gpu;Cpu=$metrics.cpu;BridgeRunning=$true} | ConvertTo-Json -Depth 4 -Compress
