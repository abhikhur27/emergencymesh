$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$runtimeRoot='C:/Users/abhim/Documents/rescuemesh-runtime'
$resolvedRoot=[IO.Path]::GetFullPath($runtimeRoot)
function Assert-OwnedPath([string]$value){$full=[IO.Path]::GetFullPath($value);if(-not($full.StartsWith($resolvedRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)-or $full -eq $resolvedRoot)){throw 'Runtime path outside owner root'};return $full}
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $runtimeRoot 'downloads') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $runtimeRoot 'tools') -Force | Out-Null
$items=@(
  @{name='ollama';version='0.40.15';url='https://github.com/ollama/ollama/releases/download/v0.40.15/ollama-windows-amd64.zip';sha256='9ca74a7ab66ec86870b1eecac7df160df08dc4e3a291ab5d2d59bcf9310221c6'},
  @{name='mongodb';version='8.0.34';url='https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-8.0.34.zip';sha256='6b021a0864494e4decf278b36477a29eb36072432773e4e62c2f42c302630db0'}
)
$receipts=@()
foreach($item in $items){
  $archive=Assert-OwnedPath (Join-Path $runtimeRoot ('downloads/'+$item.name+'-'+$item.version+'.zip'))
  $destination=Assert-OwnedPath (Join-Path $runtimeRoot ('tools/'+$item.name))
  $correct=(Test-Path -LiteralPath $archive) -and ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -eq $item.sha256)
  if(-not $correct){Write-Output ('Downloading official '+$item.name+' '+$item.version);& curl.exe --fail --location --silent --show-error --output $archive $item.url;if($LASTEXITCODE -ne 0){throw ('Download failed for '+$item.name)}}
  $actual=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if($actual -ne $item.sha256){throw ('Checksum mismatch for '+$item.name)}
  Write-Output ('Verified '+$item.name+' '+$item.version)
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
  $receipts += [PSCustomObject]@{name=$item.name;version=$item.version;archive=$archive;destination=$destination;bytes=(Get-Item -LiteralPath $archive).Length;sha256=$actual}
}
$receipt=[PSCustomObject]@{host=$env:COMPUTERNAME;verifiedAt=[DateTime]::UtcNow.ToString('o');installed=$receipts;ollamaExe=@(Get-ChildItem -LiteralPath (Join-Path $runtimeRoot 'tools/ollama') -Filter ollama.exe -Recurse -File | Select-Object -ExpandProperty FullName);mongoExe=@(Get-ChildItem -LiteralPath (Join-Path $runtimeRoot 'tools/mongodb') -Filter mongod.exe -Recurse -File | Select-Object -ExpandProperty FullName)}
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runtimeRoot 'install-receipt.json') -Encoding UTF8
$receipt | ConvertTo-Json -Depth 5
