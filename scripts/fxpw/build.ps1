param([switch]$Bootstrap, [switch]$Release)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (Test-Path -LiteralPath (Join-Path $repo '.tools\cargo\bin\cargo.exe')) {
    $env:CARGO_HOME = Join-Path $repo '.tools\cargo'
    $env:RUSTUP_HOME = Join-Path $repo '.tools\rustup'
    $env:PATH = "$env:CARGO_HOME\bin;$env:PATH"
}
if (-not (Get-Command deno -ErrorAction SilentlyContinue)) {
    $denoPath = & npm exec --yes --package=deno -- deno eval 'console.log(Deno.execPath())'
    if ($LASTEXITCODE -ne 0) { throw 'Could not locate Deno.' }
    $env:PATH = "$(Split-Path ($denoPath | Select-Object -Last 1));$env:PATH"
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw 'Install Rust MSVC with rustup first.' }

# Native MSVC libraries are needed even though the project links with rust-lld.
$vcRoot = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC'
$msvc = Get-ChildItem -LiteralPath $vcRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
$sdk = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Lib') -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if ($msvc -and $sdk) {
    $env:PATH = "$($msvc.FullName)\bin\Hostx64\x64;$sdkRoot\bin\$($sdk.Name)\x64;$env:PATH"
    $env:LIB = "$($msvc.FullName)\lib\x64;$($sdk.FullName)\ucrt\x64;$($sdk.FullName)\um\x64;$env:LIB"
    $env:INCLUDE = "$($msvc.FullName)\include;$sdkRoot\Include\$($sdk.Name)\ucrt;$sdkRoot\Include\$($sdk.Name)\shared;$sdkRoot\Include\$($sdk.Name)\um;$sdkRoot\Include\$($sdk.Name)\winrt;$env:INCLUDE"
}
Push-Location $repo
try {
    $wslHelper = Join-Path $repo 'src\static\tools\wsl\WslControl.exe'
    & (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe') /nologo /target:winexe /platform:x64 /r:System.Web.Extensions.dll ('/out:'+$wslHelper) (Join-Path $repo 'src\static\tools\wsl\WslControl.cs')
    if ($LASTEXITCODE -ne 0) { throw 'WSL control helper compilation failed.' }
    if ($Bootstrap) {
        & deno task --cwd libs/core build
        if ($LASTEXITCODE -ne 0) { throw 'Core library generation failed.' }
        & npm install --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    if ($Release) {
        $keyRoot = Join-Path $env:LOCALAPPDATA 'fxpw-seelen\signing'
        New-Item -ItemType Directory -Path $keyRoot -Force | Out-Null
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        & icacls.exe $keyRoot /inheritance:r /grant:r ('*'+$sid+':(OI)(CI)F') '*S-1-5-18:(OI)(CI)F' *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Could not protect local signing directory.' }
        $private = Join-Path $keyRoot 'seelen-release.key'
        $passwordFile = Join-Path $keyRoot 'seelen-release.password'
        if (-not (Test-Path -LiteralPath $private)) {
            $random = New-Object byte[] 32
            $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
            $rng.GetBytes($random)
            $rng.Dispose()
            $keyPassword = [Convert]::ToBase64String($random)
            [IO.File]::WriteAllText($passwordFile,$keyPassword)
            & node.exe (Join-Path $repo 'node_modules\@tauri-apps\cli\tauri.js') signer generate --ci --password $keyPassword --write-keys $private *> (Join-Path $keyRoot 'generation.log')
            if ($LASTEXITCODE -ne 0) { throw 'Local signing key generation failed.' }
        }
        $env:TAURI_SIGNING_PRIVATE_KEY = [IO.File]::ReadAllText($private).Trim()
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [IO.File]::ReadAllText($passwordFile)
        $env:FXPW_SIGNING_PUBLIC_KEY = [IO.File]::ReadAllText($private+'.pub').Trim()
        & npm run build:ui -- --production
    } else {
        & npm run build:ui
    }
    if ($LASTEXITCODE -ne 0) { throw 'UI build failed.' }
    if ($Release) {
        & cargo build --release -p seelen-ui -p sluhk --features seelen-ui/custom-protocol
    } else {
        & cargo build -p seelen-ui -p sluhk --features seelen-ui/custom-protocol
    }
    if ($LASTEXITCODE -ne 0) { throw 'Native build failed.' }
} finally {
    if ($Release) {
        Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY,Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD,Env:FXPW_SIGNING_PUBLIC_KEY -ErrorAction SilentlyContinue
    }
    Pop-Location
}
Write-Output $(if ($Release) { 'Built target/release with local bundle signature.' } else { 'Built target/debug. Start with scripts/fxpw/start.ps1 -Sensors.' })
