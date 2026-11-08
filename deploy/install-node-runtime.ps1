$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -ne 'ABHIONEMILLION'){throw 'Desktop only'}
$root='C:/Users/abhim/Documents/rescuemesh-runtime'
$version='24.22.2';$asset="node-v$version-win-x64.zip"
$sha='ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2'
$archive=Join-Path $root "downloads/$asset"
$destination=Join-Path $root 'tools/node'
if(-not(Test-Path -LiteralPath $archive)){& curl.exe --fail --location --silent --show-error --output $archive "https://nodejs.org/dist/v$version/$asset";if($LASTEXITCODE -ne 0){throw 'Node download failed'}}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha){throw 'Official Node archive checksum mismatch'}
if(-not(Test-Path -LiteralPath (Join-Path $destination "node-v$version-win-x64/node.exe"))){Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force}
$exe=Join-Path $destination "node-v$version-win-x64/node.exe"
$actual=& $exe --version
if($actual -ne "v$version"){throw 'Node version verification failed'}
$receipt=[ordered]@{host=$env:COMPUTERNAME;checkedAt=[DateTime]::UtcNow.ToString('o');version=$actual;sha256=$sha;source="https://nodejs.org/dist/v$version/$asset";exe=$exe;systemNodeReplaced=$false}
[IO.File]::WriteAllText((Join-Path $root 'node-verification.json'),($receipt|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
$receipt|ConvertTo-Json -Compress
