$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$projectRoot=Split-Path $PSScriptRoot
$source=Join-Path $projectRoot 'supervisor'
$privateArtifacts=Join-Path $projectRoot 'artifacts/private'
New-Item -ItemType Directory -Path $privateArtifacts -Force|Out-Null
$archive=Join-Path $privateArtifacts 'supervisor-source.tar.gz'
& tar.exe -czf $archive -C $source package.json package-lock.json src public scripts tests README.md .env.example
if($LASTEXITCODE -ne 0){throw 'Supervisor source archive failed'}
$key='C:/Users/abhim/.ssh/openclaw_abhi_onemillion_ed25519'
$remote='abhim@abhionemillion.tail4547be.ts.net'
& scp -i $key -o BatchMode=yes $archive "${remote}:C:/Users/abhim/Documents/rescuemesh-runtime/downloads/supervisor-source.tar.gz"
if($LASTEXITCODE -ne 0){throw 'Supervisor source transfer failed'}
$script=@'
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$root='C:/Users/abhim/Documents/rescuemesh-runtime'
if($env:COMPUTERNAME -ne 'ABHIONEMILLION'){throw 'Unexpected deployment host'}
& tar.exe -xzf "$root/downloads/supervisor-source.tar.gz" -C "$root/supervisor"
if($LASTEXITCODE -ne 0){throw 'Supervisor extraction failed'}
$revision=(Get-FileHash "$root/downloads/supervisor-source.tar.gz" -Algorithm SHA256).Hash
[IO.File]::WriteAllText("$root/supervisor-revision.txt.new",$revision)
Move-Item -LiteralPath "$root/supervisor-revision.txt.new" -Destination "$root/supervisor-revision.txt" -Force
[pscustomobject]@{host=$env:COMPUTERNAME;deployedAt=[DateTime]::UtcNow.ToString('o');revision=$revision;application="$root/supervisor";privateDataPreserved=$true;restart='Owned runner observes revision within5 seconds'}|ConvertTo-Json -Compress
'@
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
& ssh -i $key -o BatchMode=yes -o ConnectTimeout=10 $remote powershell.exe -NoProfile -EncodedCommand $encoded
if($LASTEXITCODE -ne 0){throw 'Supervisor deployment failed'}
