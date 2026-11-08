param([string]$Until='2026-11-10T05:00:00Z')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$runtimeRoot='C:/Users/abhim/Documents/rescuemesh-runtime'
$privateRoot=Join-Path $runtimeRoot '.private'
$ollamaExe=Join-Path $runtimeRoot 'tools/ollama/ollama.exe'
$mongoExe=Join-Path $runtimeRoot 'tools/mongodb/mongodb-win32-x86_64-windows-8.0.34/bin/mongod.exe'
$deadline=[DateTimeOffset]::Parse($Until).UtcDateTime
$stateFile=Join-Path $runtimeRoot 'providers-state.json'
$stopFile=Join-Path $privateRoot 'services.stop'
$started=[DateTime]::UtcNow
$ollamaProcess=$null
$mongoProcess=$null
$lock=$null
$failed=$false
$state=[ordered]@{host=$env:COMPUTERNAME;ownerPid=$PID;startedAt=$started.ToString('o');expiresAt=$deadline.ToString('o');state='starting';ollamaPid=$null;mongoPid=$null;ownsOllama=$false;ownsMongo=$false;ollamaPort=11434;mongoPort=27018;cleanupComplete=$false;task='RescueMesh-Providers-20261108';error=$null;updatedAt=$null}
function Save-State {$state.updatedAt=[DateTime]::UtcNow.ToString('o');[IO.File]::WriteAllText($stateFile,($state|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))}
function Stop-Owned($process){if($null -ne $process){$process.Refresh();if(-not $process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}}}
function Start-Ollama {
  $env:OLLAMA_HOST='127.0.0.1:11434';$env:OLLAMA_MODELS=Join-Path $runtimeRoot 'models';$env:OLLAMA_NO_CLOUD='true';$env:OLLAMA_CONTEXT_LENGTH='4096';$env:OLLAMA_KEEP_ALIVE='0';$env:OLLAMA_NUM_PARALLEL='1';$env:OLLAMA_MAX_LOADED_MODELS='1';$env:OLLAMA_MAX_QUEUE='8'
  $script:ollamaProcess=Start-Process -FilePath $ollamaExe -ArgumentList @('serve') -WorkingDirectory $runtimeRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $privateRoot 'ollama.stdout.log') -RedirectStandardError (Join-Path $privateRoot 'ollama.stderr.log') -PassThru
  $state.ollamaPid=$ollamaProcess.Id;$state.ownsOllama=$true
}
function Start-Mongo {
  $script:mongoProcess=Start-Process -FilePath $mongoExe -ArgumentList @('--bind_ip','127.0.0.1','--port','27018','--dbpath',(Join-Path $privateRoot 'mongo-data'),'--auth','--logpath',(Join-Path $privateRoot 'mongod.log'),'--logappend','--quiet') -WorkingDirectory $runtimeRoot -WindowStyle Hidden -PassThru
  $state.mongoPid=$mongoProcess.Id;$state.ownsMongo=$true
}
try {
  if($env:COMPUTERNAME -ne 'ABHIONEMILLION'){throw 'Desktop only'}
  if([DateTime]::UtcNow -ge $deadline){$state.state='deadline-passed';Save-State;exit 0}
  New-Item -ItemType Directory -Path $privateRoot -Force|Out-Null
  New-Item -ItemType Directory -Path (Join-Path $privateRoot 'mongo-data') -Force|Out-Null
  $lock=[IO.File]::Open((Join-Path $privateRoot 'services.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  if(Test-Path -LiteralPath $stopFile){$state.state='stop-requested';Save-State;exit 0}
  if(Get-NetTCPConnection -State Listen -LocalPort 11434 -ErrorAction SilentlyContinue){$state.ownsOllama=$false}else{Start-Ollama}
  if(Get-NetTCPConnection -State Listen -LocalPort 27018 -ErrorAction SilentlyContinue){throw 'Mongo port occupied; refusing duplicate owner'}else{Start-Mongo}
  $state.state='running';Save-State
  while([DateTime]::UtcNow -lt $deadline -and -not(Test-Path -LiteralPath $stopFile)){
    if($null -ne $ollamaProcess){$ollamaProcess.Refresh();if($ollamaProcess.HasExited){Start-Sleep -Seconds 3;Start-Ollama;Save-State}}
    if($null -ne $mongoProcess){$mongoProcess.Refresh();if($mongoProcess.HasExited){Start-Sleep -Seconds 3;Start-Mongo;Save-State}}
    Start-Sleep -Seconds 2
  }
  $state.state=if([DateTime]::UtcNow -ge $deadline){'expired'}else{'stopped'}
} catch {$failed=$true;$state.state='failed';$state.error=$_.Exception.Message}
finally {
  Stop-Owned $mongoProcess
  if($null -ne $ollamaProcess){$ownedChildren=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($ollamaProcess.Id)" -ErrorAction SilentlyContinue | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith((Split-Path $ollamaExe),[StringComparison]::OrdinalIgnoreCase) -and $_.CreationDate.ToUniversalTime() -ge $started});foreach($child in $ownedChildren){Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue}}
  Stop-Owned $ollamaProcess
  if($null -ne $lock){$lock.Dispose()}
  $state.cleanupComplete=$true;Save-State
  if([DateTime]::UtcNow -ge $deadline){try{Disable-ScheduledTask -TaskName 'RescueMesh-Providers-20261108' -ErrorAction Stop|Out-Null}catch{}}
}
if($failed){exit 1}
