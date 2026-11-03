$ErrorActionPreference = 'Stop'
# Also supports a running older bridge: it calls this file every 30 seconds.
$cpuFile = Join-Path $env:LOCALAPPDATA 'fxpw-seelen\sensors\cpu.json'
if (Test-Path -LiteralPath $cpuFile) {
    try {
        $cpu = Get-Content -LiteralPath $cpuFile -Raw | ConvertFrom-Json
        $age = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $cpu.sampledAt
        if ($age -ge 0 -and $age -lt 10000 -and $cpu.temperature -gt 0 -and -not $cpu.error) {
            $cpu | Select-Object temperature,source,name,provider,sampledAt | ConvertTo-Json -Compress
            return
        }
    } catch {}
}
$sensors = @()
foreach ($sensorNamespace in @('root\LibreHardwareMonitor','root\OpenHardwareMonitor')) {
    try {
        $sensors = @(Get-CimInstance -Namespace $sensorNamespace -ClassName Sensor -ErrorAction Stop | Where-Object SensorType -eq 'Temperature')
        if ($sensors.Count -gt 0) { break }
    } catch {
        # Absence of the optional hardware provider is an unavailable sensor, not a zero reading.
    }
}
$cpuSensors = @($sensors | Where-Object { $_.Identifier -match '/(intelcpu|amdcpu|cpu)/' -and $_.Value -is [ValueType] })
$temperature = $null
$source = $null
if ($cpuSensors.Count -gt 0) {
    $packageSensor = $cpuSensors | Where-Object Name -Match 'Package|Tctl|Tdie' | Select-Object -First 1
    if ($packageSensor) { $temperature = [double]$packageSensor.Value; $source = [string]$packageSensor.Identifier }
    else { $temperature = [double](($cpuSensors | Measure-Object Value -Maximum).Maximum); $source = 'maximum CPU temperature sensor' }
}
[pscustomobject]@{temperature=$temperature;source=$source} | ConvertTo-Json -Compress
