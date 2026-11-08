$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -ne 'ABHIONEMILLION'){throw 'Desktop only'}
$root='C:/Users/abhim/Documents/rescuemesh-runtime';$app=Join-Path $root 'supervisor';$data=Join-Path $root 'supervisor-data';$node=Join-Path $root 'tools/node/node-v24.22.2-win-x64/node.exe'
New-Item -ItemType Directory -Path $data -Force|Out-Null
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $data /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Supervisor private ACL failed'}
Push-Location $app
try{& $node src/cli.mjs provision --data $data;if($LASTEXITCODE -ne 0){throw 'Supervisor provision failed'}}finally{Pop-Location}
$name='RescueMesh-Supervisor-20261108'
if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue){throw 'Task already exists; inspect ownership before updating'}
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:/Users/abhim/Documents/rescuemesh-runtime/run-supervisor-services.ps1 -Until 2026-11-10T05:00:00Z' -WorkingDirectory $root
$trigger=New-ScheduledTaskTrigger -AtStartup
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType S4U -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 2) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$task=New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'RescueMesh regional supervisor, three simulated towns and isolated HTTPS tunnel; expires2026-11-10T05:00Z.'
Register-ScheduledTask -TaskName $name -InputObject $task|Out-Null
Start-ScheduledTask -TaskName $name
Start-Sleep -Seconds 4
$installed=Get-ScheduledTask -TaskName $name;$info=Get-ScheduledTaskInfo -TaskName $name
[pscustomobject]@{host=$env:COMPUTERNAME;task=$name;state=[string]$installed.State;enabled=$installed.Settings.Enabled;lastTaskResult=$info.LastTaskResult;lastRun=$info.LastRunTime;nextRun=$info.NextRunTime;workingDirectory=$installed.Actions.WorkingDirectory;expiresAt='2026-11-10T05:00:00Z'}|ConvertTo-Json -Compress
