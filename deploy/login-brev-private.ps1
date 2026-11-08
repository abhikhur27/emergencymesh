$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -ne 'ABHIONEMILLION'){throw 'Desktop only'}
$file='C:/Users/abhim/Documents/rescuemesh-runtime/.private/brev-cli-login.txt'
$inputText=[IO.File]::ReadAllText($file).Trim()
$token=$null
if($inputText -match '^brev\s+login\s+--token\s+["'']?([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["'']?\s*$'){$token=$Matches[1]}
elseif($inputText -match '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'){$token=$inputText}
else{throw 'Private file must contain the existing CLI login JWT or its exact standard login command'}
& wsl.exe -d Ubuntu --exec /home/abhim/.local/share/rescuemesh-tools/brev/0.6.337/bin/brev login --token $token
$token=$null;$inputText=$null
if($LASTEXITCODE -ne 0){throw 'Brev user authentication failed'}
Write-Output 'Brev user authentication completed; token values were not printed.'
