param([string]$ConfigFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.emergency/bridge.json'))
$ErrorActionPreference = 'Stop'
$bridgeConfig = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
$bridgeDeadline = [DateTimeOffset]::Parse($bridgeConfig.untilUtc).UtcDateTime
if ($bridgeDeadline -le [DateTime]::UtcNow) { exit 0 }
if ($bridgeConfig.hostName -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]+$' -or $bridgeConfig.userName -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Invalid SSH destination' }
if (-not (Test-Path -LiteralPath $bridgeConfig.identityFile)) { throw 'SSH identity file missing' }
$bridgePrivate = Split-Path (Resolve-Path -LiteralPath $ConfigFile).Path -Parent
$bridgeStateFile = Join-Path $bridgePrivate 'bridge-state.json'
$bridgeStopFile = Join-Path $bridgePrivate 'bridge.stop'
$bridgeState = [ordered]@{ownerPid=$PID;startedAt=[DateTime]::UtcNow.ToString('o');untilUtc=$bridgeDeadline.ToString('o');state='starting';sshPid=$null;localPorts=@(27018,4782);cleanupComplete=$false;lastExitCode=$null}
function Save-BridgeState { [IO.File]::WriteAllText($bridgeStateFile,($bridgeState|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false)) }
$bridgeChild=$null
$bridgeLock=$null
try {
  $bridgeLock=[IO.File]::Open((Join-Path $bridgePrivate 'bridge-owner.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  Save-BridgeState
  $bridgeDelay=2
  while ([DateTime]::UtcNow -lt $bridgeDeadline -and -not (Test-Path -LiteralPath $bridgeStopFile)) {
    if (Get-NetTCPConnection -State Listen -LocalPort 27018,4782 -ErrorAction SilentlyContinue) { throw 'Bridge ports already occupied; no duplicate started' }
    $bridgeArgs=@('-N','-i',('"'+$bridgeConfig.identityFile+'"'),'-p',"$($bridgeConfig.port)",'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-L','127.0.0.1:27018:127.0.0.1:27018','-L','127.0.0.1:4782:127.0.0.1:4782',"$($bridgeConfig.userName)@$($bridgeConfig.hostName)")
    $bridgeChild=Start-Process -FilePath 'ssh.exe' -ArgumentList $bridgeArgs -WindowStyle Hidden -RedirectStandardOutput (Join-Path $bridgePrivate 'bridge.stdout.log') -RedirectStandardError (Join-Path $bridgePrivate 'bridge.stderr.log') -PassThru
    $bridgeState.sshPid=$bridgeChild.Id; $bridgeState.state='running'; Save-BridgeState
    while (-not $bridgeChild.HasExited -and [DateTime]::UtcNow -lt $bridgeDeadline -and -not (Test-Path -LiteralPath $bridgeStopFile)) { Start-Sleep -Seconds 2; $bridgeChild.Refresh() }
    if (-not $bridgeChild.HasExited) { Stop-Process -Id $bridgeChild.Id -Force -ErrorAction SilentlyContinue }
    $bridgeChild.WaitForExit(); $bridgeState.lastExitCode=$bridgeChild.ExitCode; $bridgeState.state='waiting'; Save-BridgeState
    if ([DateTime]::UtcNow -lt $bridgeDeadline -and -not (Test-Path -LiteralPath $bridgeStopFile)) { Start-Sleep -Seconds $bridgeDelay; $bridgeDelay=[Math]::Min(30,$bridgeDelay*2) }
  }
  $bridgeState.state='stopped'
} catch { $bridgeState.state='failed'; $bridgeState.error=$_.Exception.Message }
finally {
  if ($null -ne $bridgeChild) { $bridgeChild.Refresh(); if (-not $bridgeChild.HasExited) { Stop-Process -Id $bridgeChild.Id -Force -ErrorAction SilentlyContinue } }
  if ($null -ne $bridgeLock) { $bridgeLock.Dispose() }
  $bridgeState.cleanupComplete=$true; $bridgeState.endedAt=[DateTime]::UtcNow.ToString('o'); Save-BridgeState
}
