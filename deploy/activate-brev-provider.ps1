$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -ne 'ABHIONEMILLION'){throw 'Desktop only'}
$root='C:/Users/abhim/Documents/rescuemesh-runtime';$node=Join-Path $root 'tools/node/node-v24.22.2-win-x64/node.exe'
$checkFile=Join-Path $root '.private/brev-model-check.json';$gpuFile=Join-Path $root '.private/brev-gpu-verification.json'
$check=Get-Content -LiteralPath $checkFile -Raw|ConvertFrom-Json;$gpu=Get-Content -LiteralPath $gpuFile -Raw|ConvertFrom-Json
if(-not $check.synthetic -or $check.model.hosting -ne 'brev' -or $check.model.model -ne 'nemotron-3-nano:30b' -or $check.plan.source -ne 'nemotron-tools' -or $check.model.successfulToolCalls -lt 2 -or $check.realServicesContacted -ne $false){throw 'Actual synthetic Brev application tool verification is required'}
if(-not $gpu.privateSshVerified -or $gpu.gpuMemoryMiB -lt 45000 -or $gpu.loadedVramBytes -le 0 -or $gpu.model -ne 'nemotron-3-nano:30b'){throw 'Actual remote GPU and private SSH verification is required'}
if([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($check.at) -gt [TimeSpan]::FromMinutes(30)){throw 'Brev model verification is stale'}
foreach($name in @('RescueMesh-BrevGuard-20261108','RescueMesh-BrevCleanup-20261108')){$task=Get-ScheduledTask -TaskName $name -ErrorAction Stop;if(-not $task.Settings.Enabled){throw 'Brev lifecycle task is disabled'}}
$status=& $node (Join-Path $root 'brev-lifecycle.mjs') status (Join-Path $root '.private/brev-instance.json')
if($LASTEXITCODE -ne 0){throw 'Authenticated Brev instance check failed'}
$status=$status|ConvertFrom-Json
if($status.state -ne 'present' -or $status.instanceId -ne $gpu.instanceId){throw 'Verified GPU and approved instance identities differ'}
$version=Invoke-RestMethod http://127.0.0.1:11435/api/version -TimeoutSec 10
$tags=Invoke-RestMethod http://127.0.0.1:11435/api/tags -TimeoutSec 10
if(-not @($tags.models|Where-Object {$_.name -eq 'nemotron-3-nano:30b' -and $_.digest -eq $gpu.modelDigest}).Count){throw 'Forwarded model digest differs from verified remote GPU'}
$capability=& $node --input-type=module -e "const m=await import('file:///C:/Users/abhim/Documents/rescuemesh-runtime/supervisor/src/config.mjs');console.log(typeof m.inferenceSettings==='function')"
if($LASTEXITCODE -ne 0 -or $capability.Trim() -ne 'true'){throw 'Deploy provider-aware supervisor source before activation'}
$configFile=Join-Path $root 'supervisor-data/config.json';$old=Get-Content -LiteralPath $configFile -Raw|ConvertFrom-Json;$config=@{};$old.PSObject.Properties|ForEach-Object{$config[$_.Name]=$_.Value}
$config['inference']=[ordered]@{provider='brev';model='nemotron-3-nano:30b';baseUrl='http://127.0.0.1:11435';verifiedAt=$check.at;instanceId=$gpu.instanceId;transport='private-ssh-forward'}
[IO.File]::WriteAllText(($configFile+'.new'),($config|ConvertTo-Json -Depth 20),(New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath ($configFile+'.new') -Destination $configFile -Force
$revision=Join-Path $root 'supervisor-revision.txt';$oldRevision=[IO.File]::ReadAllText($revision).Split('|')[0]
[IO.File]::WriteAllText($revision,($oldRevision+'|brev-config|'+[DateTime]::UtcNow.ToString('o')),(New-Object Text.UTF8Encoding($false)))
[pscustomobject]@{configured=$true;provider='brev';model='nemotron-3-nano:30b';transport='private-ssh-forward';ollamaVersion=$version.version;restartRequested=$true;verifiedAt=$check.at}|ConvertTo-Json -Compress
