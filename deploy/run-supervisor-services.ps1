param([string]$Until='2026-11-10T05:00:00Z')
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -ne 'ABHIONEMILLION'){throw 'Desktop only'}
$root='C:/Users/abhim/Documents/rescuemesh-runtime';$private=Join-Path $root '.private';$app=Join-Path $root 'supervisor';$data=Join-Path $root 'supervisor-data'
$node=Join-Path $root 'tools/node/node-v24.22.2-win-x64/node.exe';$deadline=[DateTimeOffset]::Parse($Until).UtcDateTime
$stateFile=Join-Path $root 'supervisor-state.json';$publicFile=Join-Path $root 'supervisor-public.json';$revisionFile=Join-Path $root 'supervisor-revision.txt';$stopFile=Join-Path $private 'supervisor.stop'
$nodeProcess=$null;$tunnelProcess=$null;$lock=$null;$failed=$false;$revision='';$publicOrigin=$null
$state=[ordered]@{host=$env:COMPUTERNAME;ownerPid=$PID;nodePid=$null;tunnelOwnerPid=$null;state='starting';expiresAt=$deadline.ToString('o');updatedAt=$null;application=$app;dataDirectory=$data;nodeVersion='24.22.2';port=4782;publicOrigin=$null;restartCount=0;anonymousDenied=$false;cleanupComplete=$false;error=$null}
function Save-State {$state.updatedAt=[DateTime]::UtcNow.ToString('o');[IO.File]::WriteAllText($stateFile,($state|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))}
function Stop-Owned($process){if($null -ne $process){$process.Refresh();if(-not $process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}}}
function Start-App {
  $mongo=Get-Content -LiteralPath (Join-Path $private 'mongo-supervisor.json') -Raw|ConvertFrom-Json
  $env:MONGODB_URI=$mongo.mongoUri;$env:MONGODB_DATABASE=$mongo.mongoDatabase;$env:OLLAMA_HOST='http://127.0.0.1:11434';$env:OLLAMA_MODEL='nemotron-3-nano:4b';$env:RESCUEMESH_MODEL_TIMEOUT_MS='150000'
  if($publicOrigin){$env:RESCUEMESH_SUPERVISOR_PUBLIC_ORIGIN=$publicOrigin}else{Remove-Item Env:RESCUEMESH_SUPERVISOR_PUBLIC_ORIGIN -ErrorAction SilentlyContinue}
  $script:nodeProcess=Start-Process -FilePath $node -ArgumentList @('src/cli.mjs','start','--data',$data,'--until',$Until,'--simulate-towns') -WorkingDirectory $app -WindowStyle Hidden -RedirectStandardOutput (Join-Path $private 'supervisor.stdout.log') -RedirectStandardError (Join-Path $private 'supervisor.stderr.log') -PassThru
  Remove-Item Env:MONGODB_URI -ErrorAction SilentlyContinue
  $state.nodePid=$nodeProcess.Id;$state.publicOrigin=$publicOrigin;$state.restartCount++;$state.state='running';Save-State
}
try{
  if([DateTime]::UtcNow -ge $deadline){$state.state='expired';Save-State;exit 0}
  $lock=[IO.File]::Open((Join-Path $private 'supervisor.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  if(Test-Path -LiteralPath $stopFile){$state.state='stop-requested';Save-State;exit 0}
  if(Get-NetTCPConnection -State Listen -LocalPort 4782 -ErrorAction SilentlyContinue){throw 'Supervisor port occupied; refusing duplicate ownership'}
  if(Test-Path -LiteralPath $revisionFile){$revision=[IO.File]::ReadAllText($revisionFile).Trim()}
  Start-App
  Remove-Item -LiteralPath (Join-Path $private 'supervisor-tunnel.stop') -Force -ErrorAction SilentlyContinue
  $tunnelProcess=Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'run-supervisor-tunnel.ps1'),'-Until',$Until) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $private 'supervisor-tunnel-owner.stdout.log') -RedirectStandardError (Join-Path $private 'supervisor-tunnel-owner.stderr.log') -PassThru
  $state.tunnelOwnerPid=$tunnelProcess.Id;Save-State
  while([DateTime]::UtcNow -lt $deadline -and -not(Test-Path -LiteralPath $stopFile)){
    $nextRevision=if(Test-Path -LiteralPath $revisionFile){[IO.File]::ReadAllText($revisionFile).Trim()}else{$revision}
    $nextOrigin=$publicOrigin
    if(Test-Path -LiteralPath $publicFile){try{$published=Get-Content -LiteralPath $publicFile -Raw|ConvertFrom-Json;if($published.state -eq 'running' -and $published.url -match '^https://[a-z0-9-]+\.trycloudflare\.com$'){$nextOrigin=$published.url}}catch{}}
    $nodeProcess.Refresh()
    if($nodeProcess.HasExited -or $nextRevision -ne $revision -or $nextOrigin -ne $publicOrigin){Stop-Owned $nodeProcess;$revision=$nextRevision;$publicOrigin=$nextOrigin;Start-Sleep -Seconds 2;Start-App}
    $tunnelProcess.Refresh()
    if($tunnelProcess.HasExited){$state.state='tunnel-owner-exited';Save-State;throw 'Owned tunnel controller exited'}
    try{$null=Invoke-WebRequest http://127.0.0.1:4782/api/state -UseBasicParsing -TimeoutSec 3;$state.anonymousDenied=$false}catch{if($null -ne $_.Exception.Response){$state.anonymousDenied=[int]$_.Exception.Response.StatusCode -eq 401}}
    Save-State;Start-Sleep -Seconds 5
  }
  $state.state=if([DateTime]::UtcNow -ge $deadline){'expired'}else{'stopped'}
}catch{$failed=$true;$state.state='failed';$state.error=$_.Exception.Message}
finally{
  Stop-Owned $nodeProcess
  # Ask the tunnel controller to release only its own child before forcing its owner.
  [IO.File]::WriteAllText((Join-Path $private 'supervisor-tunnel.stop'),'stop')
  if($null -ne $tunnelProcess){$null=$tunnelProcess.WaitForExit(10000);Stop-Owned $tunnelProcess}
  $state.nodePid=$null;$state.tunnelOwnerPid=$null;$state.cleanupComplete=$true;Save-State
  if($null -ne $lock){$lock.Dispose()}
  if([DateTime]::UtcNow -ge $deadline){try{Disable-ScheduledTask -TaskName 'RescueMesh-Supervisor-20261108' -ErrorAction Stop|Out-Null}catch{}}
}
if($failed){exit 1}
