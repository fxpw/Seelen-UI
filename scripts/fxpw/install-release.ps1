param([switch]$Elevated)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$source = Join-Path $repo 'target\release'
$homeDir = Join-Path $env:LOCALAPPDATA 'fxpw-seelen'
$runtime = Join-Path $homeDir 'app'
$resultFile = Join-Path $homeDir 'release-install-result.json'
$workerTask = 'fxpw-SeelenSensors'
foreach ($name in @('seelen-ui.exe','slu-service.exe','slu.exe','sluhk.dll','SHA256SUMS','SHA256SUMS.sig','static\widgets','static\tools\wsl\WslControl.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $name))) { throw "Release is not complete: missing $name" }
}
if ((Get-Content -LiteralPath (Join-Path $source 'SHA256SUMS.sig') -Raw) -match 'NOT SIGNED') {
    throw 'Release bundle has no production signature.'
}
if (-not $Elevated) {
    $powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $install = Start-Process -FilePath $powershell -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
        '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated'
    )
    $install.WaitForExit()
    if (Test-Path -LiteralPath $resultFile) { Get-Content -LiteralPath $resultFile }
    if ($install.ExitCode -ne 0) { throw 'Release installation failed; see the local release-install-result.json.' }
    return
}
try {
    $admin = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Task installation needs elevation.' }
    $backup = Join-Path $homeDir ('backups\release-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $data = Join-Path $env:APPDATA 'com.seelen.seelen-ui'
    Copy-Item -LiteralPath (Join-Path $data 'settings.json') -Destination $backup
    foreach ($widget in @('seelen-fancy-toolbar','seelen-weg')) {
        Copy-Item -LiteralPath (Join-Path $data ('data\'+$widget)) -Destination (Join-Path $backup $widget) -Recurse
    }
    $worker = Get-ScheduledTask -TaskName $workerTask -ErrorAction SilentlyContinue
    if ($worker) { Stop-ScheduledTask -InputObject $worker; Start-Sleep -Seconds 1 }
    # Stopping the GUI launcher can leave its PowerShell child alive with the
    # sensors directory as its working directory, preventing a directory move.
    $workerStateFile = Join-Path $homeDir 'sensors\session-state.json'
    if (Test-Path -LiteralPath $workerStateFile) {
        $workerState = Get-Content -LiteralPath $workerStateFile -Raw | ConvertFrom-Json
        if ($workerState.pid -gt 0) {
            $workerProcess = Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$workerState.pid)
            $sessionScript = Join-Path $runtime 'sensors\session.ps1'
            $sessionArgument = '(?i)(?:^|\s)-File\s+"?'+[regex]::Escape($sessionScript)+'"?(?:\s|$)'
            if ($workerProcess -and $workerProcess.Name -eq 'powershell.exe' -and $workerProcess.CommandLine -match $sessionArgument) {
                $workerHandle = Get-Process -Id $workerProcess.ProcessId -ErrorAction SilentlyContinue
                if ($workerHandle) {
                    Stop-Process -InputObject $workerHandle
                    if (-not $workerHandle.WaitForExit(5000)) { throw 'The previous sensor worker did not stop.' }
                }
            }
        }
    }
    $allowedApps = @((Join-Path $repo 'target\debug\seelen-ui.exe'), (Join-Path $runtime 'seelen-ui.exe'))
    $apps = @(Get-Process -Name seelen-ui -ErrorAction SilentlyContinue)
    foreach ($app in $apps) { if ($app.Path -notin $allowedApps) { throw 'Another Seelen installation is active; it was not stopped.' } }
    foreach ($app in $apps) {
        $stopped = Start-Process -FilePath (Join-Path (Split-Path $app.Path) 'slu-service.exe') -ArgumentList stop -WindowStyle Hidden -Wait -PassThru
        if ($stopped.ExitCode -ne 0 -and (Get-Process -Name slu-service -ErrorAction SilentlyContinue)) { throw 'Could not stop the previous service.' }
        Stop-Process -Id $app.Id
    }
    $configFile = Join-Path $homeDir 'sensors\bridge.json'
    if (Test-Path -LiteralPath $configFile) {
        $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
        $bridgeProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($config.pid)"
        if ($bridgeProcess -and $bridgeProcess.Name -eq 'node.exe' -and (
            $bridgeProcess.CommandLine -match [regex]::Escape((Join-Path $repo 'customization\fxpw\widgets\temperatures\bridge.mjs')) -or
            $bridgeProcess.CommandLine -match [regex]::Escape((Join-Path $runtime 'sensors\temperatures\bridge.mjs'))
        )) { Stop-Process -Id $bridgeProcess.ProcessId }
    }
    Start-Sleep -Milliseconds 700
    if (Test-Path -LiteralPath $runtime) {
        $resolved = (Resolve-Path -LiteralPath $runtime).Path
        if ($resolved -ne (Join-Path $homeDir 'app')) { throw 'Unexpected deployment path.' }
        Move-Item -LiteralPath $resolved -Destination (Join-Path $backup 'app')
    }
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    foreach ($name in @('seelen-ui.exe','slu-service.exe','slu.exe','sluhk.dll','SHA256SUMS','SHA256SUMS.sig','static')) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination $runtime -Recurse
    }
    $sensorDir = Join-Path $runtime 'sensors'
    $temperatureDir = Join-Path $sensorDir 'temperatures'
    New-Item -ItemType Directory -Path $temperatureDir -Force | Out-Null
    Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $sensorDir 'node.exe')
    $nodeLicense = Join-Path (Split-Path (Get-Command node.exe).Source) 'LICENSE'
    if (Test-Path -LiteralPath $nodeLicense) { Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $sensorDir 'NODE-LICENSE.txt') }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sensor-session.ps1') -Destination (Join-Path $sensorDir 'session.ps1')
    Copy-Item -LiteralPath (Join-Path $repo 'customization\fxpw\widgets\install.ps1') -Destination $sensorDir
    foreach ($name in @('bridge.mjs','cpu-reading.mjs','format.mjs','sensors.ps1','template.js','tooltip.js')) {
        Copy-Item -LiteralPath (Join-Path $repo ('customization\fxpw\widgets\temperatures\'+$name)) -Destination $temperatureDir
    }
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $launcher = Join-Path $sensorDir 'fxpw-hidden-powershell.exe'
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $compiler /nologo /target:winexe /platform:x64 ('/out:'+$launcher) (Join-Path $PSScriptRoot 'HiddenPowerShell.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Hidden sensor launcher compilation failed.' }
    $action = New-ScheduledTaskAction -Execute $launcher -Argument ('"'+(Join-Path $sensorDir 'session.ps1')+'"') -WorkingDirectory $sensorDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $taskSettings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $workerTask -Action $action -Trigger $trigger -Principal $principal -Settings $taskSettings -Force | Out-Null
    $scheduler = New-Object -ComObject Schedule.Service
    $scheduler.Connect()
    try { $null = $scheduler.GetFolder('\Seelen') } catch { $null = $scheduler.GetFolder('\').CreateFolder('Seelen') }
    # Scheduler owns the resident processes, so closing the installer or terminal
    # cannot terminate them or leave the installer waiting for its descendants.
    $serviceAction = New-ScheduledTaskAction -Execute (Join-Path $runtime 'slu-service.exe') -Argument '--startup' -WorkingDirectory $runtime
    $servicePrincipal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    Register-ScheduledTask -TaskPath '\Seelen\' -TaskName 'Seelen UI Service' -Action $serviceAction -Trigger $trigger -Principal $servicePrincipal -Settings $taskSettings -Force | Out-Null
    Start-ScheduledTask -TaskPath '\Seelen\' -TaskName 'Seelen UI Service'
    Start-ScheduledTask -TaskName $workerTask
    $cpuTask = Get-ScheduledTask -TaskName fxpw-SeelenCpuSensors -ErrorAction SilentlyContinue
    if ($cpuTask -and -not (Test-Path -LiteralPath (Join-Path $homeDir 'sensors\cpu-disabled'))) {
        Enable-ScheduledTask -InputObject $cpuTask | Out-Null
        if ($cpuTask.State -ne 'Running') { Start-ScheduledTask -InputObject $cpuTask }
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Seelen UI fxpw.lnk'))
    $shortcut.TargetPath = Join-Path $runtime 'seelen-ui.exe'
    $shortcut.WorkingDirectory = $runtime
    $shortcut.Save()
    [IO.File]::WriteAllText($resultFile,(@{installed=$true;runtime=$runtime;backup=$backup;sensorsTask=$workerTask} | ConvertTo-Json))
} catch {
    [IO.File]::WriteAllText($resultFile,(@{installed=$false;error=$_.Exception.Message} | ConvertTo-Json))
    exit 1
}
