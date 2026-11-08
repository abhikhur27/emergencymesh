$ErrorActionPreference = 'Stop'
$commands = @(Get-Command ollama,mongod,mongosh,brev,cloudflared,node -ErrorAction SilentlyContinue | Select-Object Name,Source)
$services = @(Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'mongo|cloudflare|ollama' } | Select-Object Name,Status,StartType)
$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(ollama|mongod|mongosh|brev|cloudflared|llama-server)\.exe$' } | ForEach-Object { [PSCustomObject]@{name=$_.Name;pid=$_.ProcessId;path=$_.ExecutablePath;cloudflareTokenArgument=($_.Name -eq 'cloudflared.exe' -and $_.CommandLine -match '--token')} })
$configPaths = @('C:/Users/abhim/.cloudflared/config.yml','C:/Users/abhim/.cloudflared/config.yaml','C:/ProgramData/cloudflared/config.yml','C:/ProgramData/cloudflared/config.yaml')
$ingress = @()
foreach($file in $configPaths){if(Test-Path -LiteralPath $file){$lines=Get-Content -LiteralPath $file;foreach($line in $lines){if($line -match '^\s*-?\s*(hostname|service):\s*(.+)$'){$ingress += [PSCustomObject]@{file=$file;kind=$Matches[1];value=$Matches[2].Trim()}}}}}
$credentialLocations=@('C:/Users/abhim/.brev','C:/Users/abhim/.config/brev','C:/Users/abhim/AppData/Roaming/brev','C:/Users/abhim/.cloudflared','C:/Program Files/MongoDB/Server') | ForEach-Object { [PSCustomObject]@{path=$_;exists=(Test-Path -LiteralPath $_)} }
$secretPresence=@()
foreach($file in @('C:/Users/abhim/Documents/lifeorganizer/.env','C:/Users/abhim/Documents/ChatGPT/hackutd/emergency-mesh/hub/.env','C:/Users/abhim/Documents/ChatGPT/hackutd/emergency-mesh/supervisor/.env')){if(Test-Path -LiteralPath $file){foreach($line in Get-Content -LiteralPath $file){if($line -match '^\s*(MONGO[A-Z_]*|ATLAS[A-Z_]*|BREV[A-Z_]*|CLOUDFLARE[A-Z_]*)\s*=\s*(.+)$'){$secretPresence += [PSCustomObject]@{file=$file;name=$Matches[1];nonempty=(-not [string]::IsNullOrWhiteSpace($Matches[2]))}}}}}
$ollama=@{reachable=$false}
try{$version=Invoke-RestMethod 'http://127.0.0.1:11434/api/version' -TimeoutSec 3;$tags=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3;$ollama=@{reachable=$true;version=$version.version;models=@($tags.models | Select-Object name,size,digest)}}catch{}
$ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in @(11434,27017,27018,4782)} | Select-Object LocalAddress,LocalPort,OwningProcess)
[PSCustomObject]@{host=$env:COMPUTERNAME;commands=$commands;services=$services;processes=$processes;ingress=$ingress;credentialLocations=$credentialLocations;secretPresence=$secretPresence;environmentNames=@(Get-ChildItem Env: | Where-Object {$_.Name -match 'MONGO|ATLAS|BREV|CLOUDFLARE|OLLAMA'} | Select-Object -ExpandProperty Name);ollama=$ollama;ports=$ports} | ConvertTo-Json -Depth 7
