$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -ne 'ABHIONEMILLION'){throw 'Desktop only'}
$root='C:/Users/abhim/Documents/rescuemesh-runtime';$node=Join-Path $root 'tools/node/node-v24.22.2-win-x64/node.exe';$script=Join-Path $root 'brev-lifecycle.mjs';$privatePlan=Join-Path $root '.private/brev-instance.json'
$auth=& wsl.exe -d Ubuntu --exec bash /mnt/c/Users/abhim/Documents/rescuemesh-runtime/check-brev-auth.sh
if($LASTEXITCODE -ne 0){throw 'Approved durable authentication is required before promising deadline deletion'}
$validated=& $node $script plan $privatePlan
if($LASTEXITCODE -ne 0){throw 'Brev credit/deadline plan validation failed'}
$plan=$validated|ConvertFrom-Json
$authority=Get-Content -LiteralPath $privatePlan -Raw|ConvertFrom-Json
if(-not $authority.cleanupAuthorityVerifiedUntil -or [DateTimeOffset]::Parse($authority.cleanupAuthorityVerifiedUntil) -lt [DateTimeOffset]::Parse($plan.deleteAt)){throw 'Cleanup authority lifetime is not verified through deletion time; do not start billed compute on a short-lived login alone'}
# This must establish authenticated visibility of the exact approved instance.
$verified=& $node $script status $privatePlan
if($LASTEXITCODE -ne 0){throw 'Brev authenticated instance verification failed'}
$status=$verified|ConvertFrom-Json
if($status.state -ne 'present'){throw 'The approved instance is absent; no controller will be started'}
$guard='RescueMesh-BrevGuard-20261108';$cleanup='RescueMesh-BrevCleanup-20261108'
foreach($name in @($guard,$cleanup)){if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue){throw 'Task exists; inspect owned task before replacing'}}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType S4U -RunLevel Limited
$guardSettings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 2) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$cleanupSettings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 100 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$guardAction=New-ScheduledTaskAction -Execute $node -Argument "$script watch $privatePlan" -WorkingDirectory $root
$cleanupAction=New-ScheduledTaskAction -Execute $node -Argument "$script cleanup $privatePlan" -WorkingDirectory $root
$deleteAt=[DateTimeOffset]::Parse($plan.deleteAt).LocalDateTime
$guardTask=New-ScheduledTask -Action $guardAction -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $principal -Settings $guardSettings -Description 'RescueMesh exact-instance Brev credit guard and privateSSH forward; never creates compute.'
$cleanupTask=New-ScheduledTask -Action $cleanupAction -Trigger (New-ScheduledTaskTrigger -Once -At $deleteAt) -Principal $principal -Settings $cleanupSettings -Description 'Explicitly approved disposableBrevVM deletion at earlier deadline or creditbudget; exactownedinstance only.'
Register-ScheduledTask -TaskName $cleanup -InputObject $cleanupTask|Out-Null
Register-ScheduledTask -TaskName $guard -InputObject $guardTask|Out-Null
Start-ScheduledTask -TaskName $guard
Start-Sleep -Seconds 3
$receipt=foreach($name in @($guard,$cleanup)){$task=Get-ScheduledTask -TaskName $name;$info=$task|Get-ScheduledTaskInfo;[pscustomobject]@{name=$name;state=[string]$task.State;enabled=$task.Settings.Enabled;nextRun=if($info.NextRunTime){$info.NextRunTime.ToUniversalTime().ToString('o')}else{$null};lastResult=$info.LastTaskResult;workingDirectory=$task.Actions.WorkingDirectory;filesPresent=(Test-Path $script) -and (Test-Path $node) -and (Test-Path $privatePlan)}}
$result=[ordered]@{host=$env:COMPUTERNAME;checkedAt=[DateTime]::UtcNow.ToString('o');deleteAt=$plan.deleteAt;estimatedMaximumUsd=$plan.estimatedMaximumUsd;instanceId=$plan.instanceId;tasks=@($receipt)}
[IO.File]::WriteAllText((Join-Path $root 'brev-task-verification.json'),($result|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
$result|ConvertTo-Json -Depth 5 -Compress
