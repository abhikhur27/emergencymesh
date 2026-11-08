$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$output = Join-Path $project '.pio/native-tests'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio C++ tools, or run scripts/test-native.sh with a native C++ compiler.' }
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'Visual Studio x64 C++ compiler is required.' }
$devcmd = Join-Path $installation 'Common7/Tools/VsDevCmd.bat'
$envLines = & $env:ComSpec /d /c "call `"$devcmd`" -no_logo -arch=x64 >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'C++ environment setup failed.' }
foreach ($line in $envLines) { if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') } }
foreach ($test in @('protocol', 'device_identity', 'status_screen')) {
  & cl.exe /nologo /EHsc /std:c++17 /W4 /WX "/I$project/include" "$project/test/test_$test.cpp" "/Fo$output/$test.obj" "/Fe$output/$test-tests.exe"
  if ($LASTEXITCODE -ne 0) { throw "Native $test test compilation failed." }
  & "$output/$test-tests.exe"
  if ($LASTEXITCODE -ne 0) { throw "Native $test tests failed." }
}
