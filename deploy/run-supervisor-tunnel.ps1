param(
  [string]$Until='2026-11-10T05:00:00Z',
  [string]$ProtectedPath='/api/state'
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -ne 'ABHIONEMILLION'){throw 'Desktop only'}
if(-not $ProtectedPath.StartsWith('/api/')){throw 'A protected API path is required'}
$runtimeRoot='C:/Users/abhim/Documents/rescuemesh-runtime'
$privateRoot=Join-Path $runtimeRoot '.private'
$exe='C:/Program Files (x86)/cloudflared/cloudflared.exe'
$deadline=[DateTimeOffset]::Parse($Until).UtcDateTime
$configFile=Join-Path $privateRoot 'quick-tunnel.yml'
$outLog=Join-Path $privateRoot 'supervisor-tunnel.stdout.log'
$errLog=Join-Path $privateRoot 'supervisor-tunnel.stderr.log'
$stateFile=Join-Path $runtimeRoot 'supervisor-public.json'
$stopFile=Join-Path $privateRoot 'supervisor-tunnel.stop'
$lock=$null;$process=$null
$state=[ordered]@{host=$env:COMPUTERNAME;ownerPid=$PID;cloudflaredPid=$null;url=$null;state='waiting-for-authenticated-application';expiresAt=$deadline.ToString('o');updatedAt=$null;origin='http://127.0.0.1:4782';protectedPath=$ProtectedPath;anonymousDenied=$false;cleanupComplete=$false}
function Save-State {$state.updatedAt=[DateTime]::UtcNow.ToString('o');[IO.File]::WriteAllText($stateFile,($state|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))}
function Read-Shared-Log($path){
  if(-not(Test-Path -LiteralPath $path)){return ''}
  $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  $reader=New-Object IO.StreamReader($stream)
  try{return $reader.ReadToEnd()}finally{$reader.Dispose();$stream.Dispose()}
}
function Application-Requires-Authentication {
  try{$null=Invoke-WebRequest -Uri ('http://127.0.0.1:4782'+$ProtectedPath) -UseBasicParsing -TimeoutSec 5;return $false}
  catch{if($null -ne $_.Exception.Response){return [int]$_.Exception.Response.StatusCode -eq 401};return $false}
}
try{
  New-Item -ItemType Directory -Path $privateRoot -Force|Out-Null
  $lock=[IO.File]::Open((Join-Path $privateRoot 'supervisor-tunnel.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  # An isolated empty configuration avoids reading the other tunnel owner's ingress.
  [IO.File]::WriteAllText($configFile,('{}'+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
  Save-State
  while([DateTime]::UtcNow -lt $deadline -and -not(Test-Path -LiteralPath $stopFile)){
    if(-not(Application-Requires-Authentication)){Start-Sleep -Seconds 3;continue}
    $state.anonymousDenied=$true;$state.state='starting';$state.url=$null;Save-State
    $process=Start-Process -FilePath $exe -ArgumentList @('tunnel','--config',$configFile,'--no-autoupdate','--metrics','127.0.0.1:0','--loglevel','info','--url','http://127.0.0.1:4782') -WorkingDirectory $runtimeRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    $state.cloudflaredPid=$process.Id;Save-State
    while([DateTime]::UtcNow -lt $deadline -and -not(Test-Path -LiteralPath $stopFile)){
      $process.Refresh();if($process.HasExited){break}
      if(-not $state.url){
        $match=[regex]::Match(((Read-Shared-Log $outLog)+(Read-Shared-Log $errLog)),'https://[a-z0-9-]+\.trycloudflare\.com')
        if($match.Success){$state.url=$match.Value;$state.state='running';Save-State}
      }
      Start-Sleep -Seconds 2
    }
    $process.Refresh();if(-not $process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}
    $process=$null;$state.cloudflaredPid=$null;$state.url=$null;$state.state='waiting-for-authenticated-application';Save-State
    if([DateTime]::UtcNow -lt $deadline){Start-Sleep -Seconds 3}
  }
  $state.state=if([DateTime]::UtcNow -ge $deadline){'expired'}else{'stopped'}
}finally{
  if($null -ne $process){$process.Refresh();if(-not $process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}}
  if($null -ne $lock){$lock.Dispose()}
  $state.cloudflaredPid=$null;$state.url=$null;$state.cleanupComplete=$true;Save-State
}
