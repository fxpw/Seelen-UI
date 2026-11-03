param([switch]$Sensors, [ValidateSet('installed','debug','release')][string]$Mode='installed')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtime = if ($Mode -eq 'installed') { Join-Path $env:LOCALAPPDATA 'fxpw-seelen\app' } else { Join-Path $repo ('target\'+$Mode) }
if ($Mode -eq 'installed' -and -not (Test-Path -LiteralPath (Join-Path $runtime 'seelen-ui.exe'))) { $runtime = Join-Path $repo 'target\debug' }
foreach ($file in @('seelen-ui.exe', 'slu-service.exe', 'slu.exe', 'sluhk.dll', 'static\widgets')) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtime $file))) {
        throw "Missing $file. Build the fork first; see documentation/fxpw/README.md."
    }
}
$running = Get-Process -Name 'seelen-ui' -ErrorAction SilentlyContinue
if ($running -and $running.Path -ne (Join-Path $runtime 'seelen-ui.exe')) {
    throw 'Another Seelen executable is running. Exit it before starting the fork.'
}
if (-not $running) {
    Start-Process -FilePath (Join-Path $runtime 'seelen-ui.exe') -WorkingDirectory $runtime -WindowStyle Hidden | Out-Null
}
if ($Sensors) {
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 500
        try { $null = Invoke-RestMethod 'http://127.0.0.1:37074/ping' -TimeoutSec 2; $ready=$true } catch { $ready=$false }
    } while (-not $ready -and [DateTime]::UtcNow -lt $deadline)
    if (-not $ready) { throw 'Seelen did not initialize its local API in time.' }
    & (Join-Path $repo 'customization\fxpw\widgets\install.ps1') -RuntimeDirectory $runtime
}
Write-Output "Fork started from $runtime"
