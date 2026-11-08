$ErrorActionPreference = 'Stop'
$output = Join-Path $PSScriptRoot '.native'
[IO.Directory]::CreateDirectory($output) | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio C++ tools are required; use check.sh on Mac/Linux.' }
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'Visual Studio C++ compiler unavailable.' }
$devcmd = Join-Path $installation 'Common7/Tools/VsDevCmd.bat'
$envLines = & $env:ComSpec /d /c "call `"$devcmd`" -no_logo -arch=x64 >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'C++ environment initialization failed.' }
foreach ($line in $envLines) { if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') } }
& cl.exe /nologo /EHsc /std:c++17 /W4 /WX (Join-Path $PSScriptRoot 'mesh-hop.cpp') "/Fo$output/mesh-hop.obj" "/Fe$output/mesh-hop.exe"
if ($LASTEXITCODE -ne 0) { throw 'Integration adapter compilation failed.' }
& node --test (Join-Path $PSScriptRoot 'pipeline.test.mjs') (Join-Path $PSScriptRoot 'message-bridge.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Integration test failed.' }
