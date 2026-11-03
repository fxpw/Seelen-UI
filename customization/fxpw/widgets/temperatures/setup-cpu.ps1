param([switch]$Elevated)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$cache = Join-Path $repo '.tools'
$state = Join-Path $env:LOCALAPPDATA 'fxpw-seelen\sensors'
$helper = Join-Path $state 'collector'
$cpuFile = Join-Path $state 'cpu.json'
$resultFile = Join-Path $state 'cpu-setup-result.json'
$zip = Join-Path $cache 'LibreHardwareMonitor-0.9.6.zip'
$installer = Join-Path $cache 'PawnIO_setup-2.2.0.exe'
$taskName = 'fxpw-SeelenCpuSensors'
$zipHash = '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001'
$installerHash = '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032'
New-Item -ItemType Directory -Path $cache,$state,$helper -Force | Out-Null

function Assert-Hash([string]$Path, [string]$Expected) {
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
        throw "Download checksum mismatch: $Path"
    }
}

if (-not $Elevated) {
    if (-not (Test-Path -LiteralPath $zip)) {
        Invoke-WebRequest 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip' -OutFile $zip
    }
    if (-not (Test-Path -LiteralPath $installer)) {
        Invoke-WebRequest 'https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe' -OutFile $installer
    }
    Assert-Hash $zip $zipHash
    Assert-Hash $installer $installerHash
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=namazso.eu') {
        throw 'PawnIO installer signature did not match its publisher.'
    }
    $powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $install = Start-Process -FilePath $powershell -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"'+$PSCommandPath+'"'), '-Elevated'
    )
    if (Test-Path -LiteralPath $resultFile) { Get-Content -LiteralPath $resultFile }
    if ($install.ExitCode -ne 0) { throw 'CPU collector setup failed; see cpu-setup-result.json in the local sensors directory.' }
    return
}

try {
    if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'The CPU collector requires administrator rights to access PawnIO.'
    }
    Assert-Hash $zip $zipHash
    Assert-Hash $installer $installerHash
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    $exe = Join-Path $helper 'fxpw-cpu-sensors.exe'
    if ($existing) {
        if ($existing.Actions.Execute -ne $exe) { throw 'Existing task points to an unexpected executable.' }
        Stop-ScheduledTask -InputObject $existing
        Start-Sleep -Milliseconds 500
    }
    $expanded = Join-Path $cache 'lhm-0.9.6'
    Expand-Archive -LiteralPath $zip -DestinationPath $expanded -Force
    Get-ChildItem -LiteralPath $expanded -Filter '*.dll' | Copy-Item -Destination $helper -Force
    Copy-Item -LiteralPath (Join-Path $expanded 'LibreHardwareMonitor.exe.config') -Destination ($exe+'.config') -Force
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $compiler /nologo /target:winexe /platform:x64 /r:System.Web.Extensions.dll ('/r:'+(Join-Path $helper 'LibreHardwareMonitorLib.dll')) ('/out:'+$exe) (Join-Path $PSScriptRoot 'CpuCollector.cs')
    if ($LASTEXITCODE -ne 0) { throw 'CPU collector compilation failed.' }

    $rebootRequired = $false
    if (-not (Get-CimInstance Win32_SystemDriver -Filter "Name='PawnIO'")) {
        $driver = Start-Process -FilePath $installer -ArgumentList @('-install','-silent') -WindowStyle Hidden -Wait -PassThru
        if ($driver.ExitCode -notin @(0,3010)) { throw "PawnIO installation failed: exit $($driver.ExitCode)" }
        $rebootRequired = $driver.ExitCode -eq 3010
    }
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute $exe -Argument ('"'+$cpuFile+'"') -WorkingDirectory $helper
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $snapshot = $null
    do {
        Start-Sleep -Milliseconds 500
        if (Test-Path -LiteralPath $cpuFile) {
            $snapshot = Get-Content -LiteralPath $cpuFile -Raw | ConvertFrom-Json
            $age = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $snapshot.sampledAt
            if ($age -ge 0 -and $age -lt 10000 -and $snapshot.temperature -gt 0) { break }
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    $ready = $null -ne $snapshot -and $age -ge 0 -and $age -lt 10000 -and $snapshot.temperature -gt 0
    [IO.File]::WriteAllText($resultFile,(@{ready=$ready;rebootRequired=$rebootRequired;task=$taskName;cpu=$snapshot} | ConvertTo-Json -Depth 8))
    if (-not $ready) { throw 'Collector started but has no fresh CPU temperature. Check the local collector log or rebootRequired.' }
} catch {
    [IO.File]::WriteAllText($resultFile,(@{ready=$false;error=$_.Exception.Message;rebootRequired=$rebootRequired} | ConvertTo-Json -Depth 4))
    exit 1
}
