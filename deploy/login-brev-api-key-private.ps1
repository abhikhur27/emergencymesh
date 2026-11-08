$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -ne 'ABHIONEMILLION'){throw 'Desktop only'}
$file='C:/Users/abhim/Documents/rescuemesh-runtime/.private/brev-cli-api-key.txt'
$text=[IO.File]::ReadAllText($file).Trim();$key=$null
if($text -match '^brev\s+login\s+--api-key\s+["'']?(bak-[^\s"'']{16,512})["'']?(?:\s+--org-id\s+org-3LopzuIu7SGwsNHFYGk5ipxB4Ru)?\s*$'){$key=$Matches[1]}
elseif($text -match '^bak-[^\s"'']{16,512}$'){$key=$text}
else{throw 'Expected the explicitly approved Brev API key or exact standard login command'}
$captured=& wsl.exe -d Ubuntu --exec /home/abhim/.local/share/rescuemesh-tools/brev/0.6.337/bin/brev login --api-key $key 2>&1
$result=$LASTEXITCODE;$captured=$null
$key=$null;$text=$null
if($result -ne 0){throw 'Approved Brev key authentication failed'}
Write-Output 'Approved Brev organization key authenticated; secret values were not printed.'
