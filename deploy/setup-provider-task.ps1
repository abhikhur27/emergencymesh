$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$runtimeRoot='C:/Users/abhim/Documents/rescuemesh-runtime'
$privateRoot=Join-Path $runtimeRoot '.private'
if($env:COMPUTERNAME -ne 'ABHIONEMILLION'){throw 'Desktop only'}
New-Item -ItemType Directory -Path $privateRoot -Force|Out-Null
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $privateRoot /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Private ACL failed'}
$bootstrap=Join-Path $runtimeRoot 'tools/bootstrap-node'
New-Item -ItemType Directory -Path $bootstrap -Force|Out-Null
$package=@{name='rescuemesh-provider-bootstrap';version='1.0.0';private=$true;type='module'}|ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $bootstrap 'package.json'),$package,(New-Object Text.UTF8Encoding($false)))
Push-Location $bootstrap
try{& npm.cmd install mongodb@7.8.0 --ignore-scripts --no-audit --no-fund --save-exact;if($LASTEXITCODE -ne 0){throw 'Driver installation failed'}}finally{Pop-Location}
$name='RescueMesh-Providers-20261108'
if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue){throw 'Task already exists; root must inspect ownership before updating'}
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:/Users/abhim/Documents/rescuemesh-runtime/run-provider-services.ps1 -Until 2026-11-10T05:00:00Z' -WorkingDirectory $runtimeRoot
$trigger=New-ScheduledTaskTrigger -AtStartup
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType S4U -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 2) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$task=New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'RescueMesh owned loopback provider services; fixed deadline 2026-11-10T05:00Z; no other jobs modified.'
Register-ScheduledTask -TaskName $name -InputObject $task | Out-Null
Start-ScheduledTask -TaskName $name
Start-Sleep -Seconds 4
$installed=Get-ScheduledTask -TaskName $name
$info=Get-ScheduledTaskInfo -TaskName $name
[PSCustomObject]@{host=$env:COMPUTERNAME;task=$name;state=[string]$installed.State;enabled=$installed.Settings.Enabled;lastRunTime=$info.LastRunTime;nextRunTime=$info.NextRunTime;lastTaskResult=$info.LastTaskResult;workingDirectory=$installed.Actions.WorkingDirectory;until='2026-11-10T05:00:00Z'}|ConvertTo-Json -Depth 4
