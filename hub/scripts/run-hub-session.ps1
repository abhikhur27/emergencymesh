param([string]$UntilUtc = '2026-11-10T05:00:00Z', [string]$SerialPort = 'COM10')
$ErrorActionPreference = 'Stop'
$hubRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$privateRoot = Join-Path $hubRoot '.emergency'
$nodeExecutable = (Get-Command node.exe).Source
$ollamaExecutable = Join-Path $env:LOCALAPPDATA 'Programs/Ollama/ollama.exe'
$deadline = [DateTime]::Parse($UntilUtc).ToUniversalTime()
if ($deadline -le [DateTime]::UtcNow -or $deadline -gt [DateTime]::UtcNow.AddDays(3)) { throw 'Session deadline must be within the next three days.' }
$lock = [IO.File]::Open((Join-Path $privateRoot 'session.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
$ownerProcess = $null; $ollamaProcess = $null; $started = [DateTime]::UtcNow
$receipt = [ordered]@{ wrapperPid=$PID; startedAt=$started.ToString('o'); untilUtc=$deadline.ToString('o'); workingDirectory=$hubRoot; serialPort=$SerialPort; state='starting'; childPid=$null; ownsOllama=$false; ollamaPid=$null; scheduledTask=$false; awakeWhileRunning=$false; cleanupComplete=$false }
function Save-OwnerReceipt { [IO.File]::WriteAllText((Join-Path $privateRoot 'session-wrapper.json'), ($receipt|ConvertTo-Json), (New-Object Text.UTF8Encoding($false))) }
try {
    if (Get-NetTCPConnection -LocalPort 4781 -State Listen -ErrorAction SilentlyContinue) { throw 'Receiver port is occupied. Refusing a duplicate owner.' }
    if (-not (Test-Path -LiteralPath (Join-Path $privateRoot 'config.json'))) { throw 'Private receiver configuration is missing.' }
    $config = [ordered]@{untilUtc=$deadline.ToString('o');serialPort=$SerialPort;revision=1;paused=$false}
    [IO.File]::WriteAllText((Join-Path $privateRoot 'session-config.json'), ($config|ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath (Join-Path $privateRoot 'session.stop')) { Remove-Item -LiteralPath (Join-Path $privateRoot 'session.stop') }
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class RescueMeshAwake { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags); }'
    [void][RescueMeshAwake]::SetThreadExecutionState(2147483649)
    $receipt.awakeWhileRunning=$true
    if (-not (Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue)) {
        $env:OLLAMA_HOST='127.0.0.1:11434';$env:OLLAMA_NO_CLOUD='true';$env:OLLAMA_CONTEXT_LENGTH='4096';$env:OLLAMA_KEEP_ALIVE='5m';$env:OLLAMA_MAX_QUEUE='4'
        $ollamaProcess=Start-Process -FilePath $ollamaExecutable -ArgumentList @('serve') -WorkingDirectory $hubRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $privateRoot 'session-ollama.stdout.log') -RedirectStandardError (Join-Path $privateRoot 'session-ollama.stderr.log') -PassThru
        $receipt.ownsOllama=$true;$receipt.ollamaPid=$ollamaProcess.Id
    }
    $ready=$false
    for($i=0;$i -lt 40;$i++) { try { $tags=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2; $ready=@($tags.models|Where-Object name -eq 'nemotron-3-nano:4b').Count -eq 1;if($ready){break} } catch {};Start-Sleep -Milliseconds 250 }
    if(-not $ready){throw 'The verified local Nemotron model is unavailable.'}
    while([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath (Join-Path $privateRoot 'session.stop'))) {
        $ownerProcess=Start-Process -FilePath $nodeExecutable -ArgumentList @((Join-Path $PSScriptRoot 'run-hub-owner.mjs')) -WorkingDirectory $hubRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $privateRoot 'session-owner.stdout.log') -RedirectStandardError (Join-Path $privateRoot 'session-owner.stderr.log') -PassThru
        $receipt.childPid=$ownerProcess.Id;$receipt.state='running';Save-OwnerReceipt
        while([DateTime]::UtcNow -lt $deadline -and -not $ownerProcess.WaitForExit(1000)) {
            [void][RescueMeshAwake]::SetThreadExecutionState(2147483649)
            if($null -ne $ollamaProcess){$ollamaProcess.Refresh();if($ollamaProcess.HasExited){$ollamaProcess=Start-Process -FilePath $ollamaExecutable -ArgumentList @('serve') -WorkingDirectory $hubRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $privateRoot 'session-ollama.stdout.log') -RedirectStandardError (Join-Path $privateRoot 'session-ollama.stderr.log') -PassThru;$receipt.ollamaPid=$ollamaProcess.Id;Save-OwnerReceipt}}
        }
        if(-not $ownerProcess.HasExited){[IO.File]::WriteAllText((Join-Path $privateRoot 'session.stop'),'deadline');[void]$ownerProcess.WaitForExit(25000)}
        if([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath (Join-Path $privateRoot 'session.stop'))){$receipt.state='restarting-owner';Save-OwnerReceipt;Start-Sleep -Seconds 10}
    }
    $receipt.state='ended'
} catch { $receipt.state='failed';$receipt.error=$_.Exception.Message }
finally {
    if($null -ne $ownerProcess){
        # Inspect owned children before stopping the owner. PID, parent, creation time and
        # immutable-release path must all match; a reused or unrelated PID is never killed.
        $ownedChildren=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($ownerProcess.Id)"|Where-Object {$_.Name -eq 'node.exe' -and $_.CreationDate.ToUniversalTime() -ge $started -and $_.CommandLine -like "*$privateRoot*releases*"})
        $ownerProcess.Refresh();if(-not $ownerProcess.HasExited){Stop-Process -Id $ownerProcess.Id -Force -ErrorAction SilentlyContinue}
        foreach($child in $ownedChildren){$current=Get-CimInstance Win32_Process -Filter "ProcessId=$($child.ProcessId)" -ErrorAction SilentlyContinue;if($null -ne $current -and $current.ParentProcessId -eq $ownerProcess.Id -and $current.CreationDate -eq $child.CreationDate){Stop-Process -Id $current.ProcessId -Force -ErrorAction SilentlyContinue}}
    }
    if($null -ne $ollamaProcess){$ollamaProcess.Refresh();if(-not $ollamaProcess.HasExited){$children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($ollamaProcess.Id)"|Where-Object {$_.Name -in @('ollama.exe','llama-server.exe') -and $_.CreationDate.ToUniversalTime() -ge $started});foreach($child in $children){Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue};Stop-Process -Id $ollamaProcess.Id -Force -ErrorAction SilentlyContinue}}
    if('RescueMeshAwake' -as [type]){[void][RescueMeshAwake]::SetThreadExecutionState(2147483648)}
    $receipt.cleanupComplete=$true;$receipt.endedAt=[DateTime]::UtcNow.ToString('o');Save-OwnerReceipt;$lock.Dispose()
}
