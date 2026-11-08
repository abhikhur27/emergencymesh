[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Destination,
    [switch]$Preview
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd([IO.Path]::DirectorySeparatorChar)
$destinationRoot = [IO.Path]::GetFullPath($Destination).TrimEnd([IO.Path]::DirectorySeparatorChar)
if ($destinationRoot -eq $sourceRoot -or $destinationRoot.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $sourceRoot.StartsWith($destinationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Public checkout must be separate from the source tree.' }
if (-not (Test-Path -LiteralPath (Join-Path $destinationRoot '.git') -PathType Container)) { throw 'Destination must be the existing public Git checkout.' }
$remote = (& git -C $destinationRoot config --get remote.origin.url).Trim()
if ($LASTEXITCODE -ne 0 -or $remote -notmatch '^(https://github\.com/abhikhur27/emergencymesh(?:\.git)?|git@github\.com:abhikhur27/emergencymesh\.git)$') { throw 'Destination is not the expected RescueMesh public repository.' }

$extensions = @('.md','.js','.mjs','.cjs','.json','.html','.css','.svg','.swift','.pbxproj','.xcscheme','.plist','.xcworkspacedata','.xcsettings','.h','.cpp','.ini','.ps1','.sh','.png','.jpg','.jpeg','.pdf','.fcstd','.stl','.step','.stp','.3mf','.txt','.yml','.yaml','.ts','.tsx','.wav','.mp4')
$blockedSegments = @('node_modules','.emergency','.supervisor','.private','.pio','.native','.build','.git','.venv','DerivedData','xcuserdata','Vendor','TemocModel','dist','runtime','logs','private','receipts','releases','artifacts')
$fixedFiles = @('README.md','firmware/README.md','firmware/platformio.ini','firmware/verification.json','hub/README.md','hub/DESIGN.md','hub/package.json','hub/package-lock.json','supervisor/README.md','supervisor/package.json','supervisor/package-lock.json','supervisor/.env.example')
$publicDocs = @('ARCHITECTURE.md','PROTOCOL.md','DEMO.md','VERIFICATION.md','device-security.md','MAC-HANDOFF.md','cad-install.md','runtime-setup.md','OPERATING-20261108.md','map-sources.md','brev-verification-20261108.json','TEMOC.md','TECHSTACK.md','second-companion-flash-20261108.json')
$publicBrevSupport = @('check-brev-auth.sh','install-brev-cli.sh','install-brev-model.sh','run-brev-model.sh','brev-provider-plan.md')
$publicHardware = @('README.md','cad-recipe.json','enclosure-preview.png','RescueMesh-enclosure.FCStd','RescueMesh-enclosure.step','BasePrint.stl','LidPrint.stl','AdapterPrint.stl')
$currentDesign = @('RESCUEMESH.md','FULL-STORYBOARD.md','REFERENCES.md','CURRENT.json','design.tokens.json','rescuemesh-phone.png','rescuemesh-ecsw.png','rescuemesh-supervisor.png','rescuemesh-login.png','rescuemesh-oled.png')
function Test-PublicPath([string]$Relative) {
    if ($Relative -in @('ios/EmergencyMesh/TemocModel/README.md','ios/EmergencyMesh/TemocModel/manifest.json','.github/workflows/ios-verify.yml')) { return $true }
    $segments = $Relative.Split('/')
    foreach ($segment in $segments) { if ($blockedSegments -contains $segment -or $segment.StartsWith('.emergency') -or $segment.StartsWith('.supervisor')) { return $false } }
    $leaf = $segments[-1]
    if ($leaf -match '^(phone-profile|hub-profile|profile|operator-token|ecsw-hub-token)' -or $leaf -match '\.(bin|zip|log|key|pem|p12|pfx|mobileprovision|provisionprofile|xcuserstate)$' -or $leaf -match '\.FCStd[0-9]+$') { return $false }
    if ($leaf.StartsWith('.env') -and $Relative -ne 'supervisor/.env.example') { return $false }
    if ($fixedFiles -contains $Relative) { return $true }
    if ($Relative -match '^firmware/(src|include|test|scripts)/') { return $true }
    if ($Relative -match '^(hub|supervisor)/(src|public|tests|fixtures|scripts)/') { return $true }
    if ($Relative -match '^(ios|integration|scripts)/') { return $true }
    if ($Relative -match '^deploy/[^/]+\.(ps1|mjs)$') { return $true }
    if ($Relative -match '^deploy/([^/]+)$' -and $publicBrevSupport -contains $Matches[1]) { return $true }
    if ($Relative -match '^regions/[^/]+\.json$') { return $true }
    if ($Relative -match '^docs/([^/]+)$' -and $publicDocs -contains $Matches[1]) { return $true }
    if ($Relative -match '^hardware/([^/]+)$' -and $publicHardware -contains $Matches[1]) { return $true }
    if ($Relative -match '^design/2026-11-07/([^/]+)$' -and $currentDesign -contains $Matches[1]) { return $true }
    if ($Relative -match '^design/2026-11-07/journey/(RescueMesh-Storyboard\.html|app\.js|style\.css|index\.html)$') { return $true }
    if ($Relative -match '^demo/rescuemesh-tactile/(README\.md|BRIEF\.md|package\.json|package-lock\.json|tsconfig\.json|remotion\.config\.ts)$') { return $true }
    if ($Relative -match '^demo/rescuemesh-tactile/src/[A-Za-z0-9_/-]+\.(ts|tsx)$') { return $true }
    if ($Relative -match '^demo/rescuemesh-tactile/scripts/(generate-audio|render-final|verify-output)\.mjs$') { return $true }
    if ($Relative -match '^demo/rescuemesh-tactile/public/(brand/rescuemesh-(mark|wordmark)\.png|audio/(tactile-score\.wav|synthesis\.json)|product/turntable\.mp4)$') { return $true }
    return $false
}
$selected = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | Where-Object {
    $relative = [IO.Path]::GetRelativePath($sourceRoot, $_.FullName).Replace('\','/')
    -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and (Test-PublicPath $relative) -and ($extensions -contains $_.Extension.ToLowerInvariant() -or $_.Name -in @('.gitignore','.env.example'))
} | Sort-Object FullName)
if ($selected.Count -lt 50) { throw 'Unexpectedly small source selection; export refused.' }
if (@($selected | Where-Object Length -gt 10MB).Count) { throw 'Selected source contains a file over10MiB; review it before public export.' }

# Exact private-value checks never print the values. Public test keys are not
# treated as live secrets; comparison values come only from ignored local state.
$privateValues = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
function Add-PrivateValue($Value) {
    if ($Value -is [string] -and $Value.Length -ge 16 -and $Value.Length -le 4096 -and $Value -notmatch '[\r\n]') {
        $null = $privateValues.Add($Value)
        if ($Value -match '^[a-fA-F0-9]{64}$') { $null = $privateValues.Add([Convert]::ToBase64String([Convert]::FromHexString($Value))) }
        if ($Value -match '^mongodb(?:\+srv)?://') {
            try { $credentialPart = ([uri]$Value).UserInfo.Split(':', 2); if ($credentialPart.Count -eq 2) { Add-PrivateValue ([uri]::UnescapeDataString($credentialPart[1])) } } catch { throw 'Private MongoDB URI could not be inspected.' }
        }
    }
}
function Read-PrivateObject($Value, [bool]$Sensitive = $false) {
    if ($null -eq $Value) { return }
    if ($Value -is [string]) { if ($Sensitive) { Add-PrivateValue $Value }; return }
    if ($Value -is [Collections.IDictionary]) { foreach ($key in $Value.Keys) { Read-PrivateObject $Value[$key] ($Sensitive -or $key -match '(?i)(keyhex|keyring|master|token|password|secret|cookie|sessionid|csrf|mongouri|bearer)') }; return }
    if ($Value -is [Collections.IEnumerable]) { foreach ($entry in $Value) { Read-PrivateObject $entry $Sensitive }; return }
    if ($Value -is [pscustomobject]) { foreach ($property in $Value.PSObject.Properties) {
        Read-PrivateObject $property.Value ($Sensitive -or $property.Name -match '(?i)(keyhex|wrappedkey|keyring|master|token|password|secret|cookie|sessionid|csrf|mongouri|bearer)')
        if ($property.Name -match '(?i)(token|password|secret)file$' -and $property.Value -is [string]) {
            $secretFile = [IO.Path]::GetFullPath((Join-Path $currentPrivateRoot $property.Value))
            if ((Test-Path -LiteralPath $secretFile -PathType Leaf) -and (Get-Item -LiteralPath $secretFile).Length -le 16KB) { Add-PrivateValue ([IO.File]::ReadAllText($secretFile).Trim()) }
        }
    } }
}
foreach ($privateRoot in @((Join-Path $sourceRoot 'hub/.emergency'), (Join-Path $sourceRoot 'supervisor/.supervisor'))) {
    if (-not (Test-Path -LiteralPath $privateRoot -PathType Container)) { continue }
    $currentPrivateRoot = $privateRoot
    foreach ($file in Get-ChildItem -LiteralPath $privateRoot -File) {
        if ($file.Name -match '(?i)(token|password|secret).*\.txt$') { Add-PrivateValue ([IO.File]::ReadAllText($file.FullName).Trim()) }
        elseif ($file.Extension -eq '.json' -and $file.Name -notmatch 'incidents|case|state|receipt') { try { Read-PrivateObject (ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($file.FullName))) } catch { throw 'A private JSON credential source could not be parsed; export refused.' } }
    }
}
foreach ($envFile in @((Join-Path $sourceRoot 'hub/.env'), (Join-Path $sourceRoot 'supervisor/.env'))) {
    if (Test-Path -LiteralPath $envFile -PathType Leaf) { foreach ($line in [IO.File]::ReadAllLines($envFile)) { if ($line -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+)$') { Add-PrivateValue ($Matches[1].Trim().Trim('"').Trim("'")) } } }
}
if ($privateValues.Count -eq 0) { throw 'No ignored local credential values found for exact-value comparison; export refused.' }
function Assert-NoPrivateValues([string]$Path, [string]$Relative) {
    $text = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($Path))
    foreach ($value in $privateValues) { if ($text.Contains($value, [StringComparison]::Ordinal)) { throw "Exact local credential detected in public candidate: $Relative (value withheld)" } }
    if ($text -match '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_]{20,}') { throw "Credential marker detected in public candidate: $Relative (value withheld)" }
}
foreach ($file in $selected) { Assert-NoPrivateValues $file.FullName ([IO.Path]::GetRelativePath($sourceRoot, $file.FullName)) }

$changed = 0
foreach ($file in $selected) {
    $relative = [IO.Path]::GetRelativePath($sourceRoot, $file.FullName)
    $target = [IO.Path]::GetFullPath((Join-Path $destinationRoot $relative))
    if (-not $target.StartsWith($destinationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Destination escaped the intended checkout.' }
    if ((Test-Path -LiteralPath $target -PathType Leaf) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) { continue }
    $changed++
    if (-not $Preview) { $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)); [IO.File]::Copy($file.FullName, $target, $true) }
}
if (-not $Preview) {
    $ignoreFile = Join-Path $destinationRoot '.gitignore'
    $ignoreText = if (Test-Path -LiteralPath $ignoreFile) { [IO.File]::ReadAllText($ignoreFile) } else { '' }
    if (-not $ignoreText.Contains('# RescueMesh source-only export boundary')) {
        $ignoreBoundary = @'

# RescueMesh source-only export boundary
**/.supervisor*/
**/.private/
**/runtime/
**/logs/
**/profiles/
**/raw-radio/
**/deploy/receipts/
**/ecsw-hub-token*
**/device-registry*.json
**/operator-auth*.json
**/identity-store*.json
**/runtime.json
**/bridge.json
!**/.env.example
'@
        [IO.File]::WriteAllText($ignoreFile, $ignoreText.TrimEnd() + "`n" + $ignoreBoundary + "`n", [Text.UTF8Encoding]::new($false))
    }
    if (-not ([IO.File]::ReadAllText($ignoreFile)).Contains('# Temoc local model/runtime binaries')) {
        [IO.File]::AppendAllText($ignoreFile, "`n# Temoc local model/runtime binaries`n**/*.gguf`n**/*.gguf.part`nios/TemocRuntime/Vendor/`nios/TemocRuntime/*.zip`n", [Text.UTF8Encoding]::new($false))
    }
    # Existing files are preserved. Never mirror-delete another author's source.
    $publicFiles = @(Get-ChildItem -LiteralPath $destinationRoot -Recurse -File -Force | Where-Object { -not $_.FullName.StartsWith((Join-Path $destinationRoot '.git') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) })
    foreach ($file in $publicFiles) { Assert-NoPrivateValues $file.FullName ([IO.Path]::GetRelativePath($destinationRoot, $file.FullName)) }
}
[ordered]@{ preview = [bool]$Preview; sourceFiles = $selected.Count; changedFiles = $changed; sourceBytes = ($selected | Measure-Object Length -Sum).Sum; exactPrivateComparisons = $privateValues.Count; credentialScan = 'clear'; maximumSelectedBytes = ($selected | Measure-Object Length -Maximum).Maximum; existingFilesDeleted = 0; committed = $false; pushed = $false } | ConvertTo-Json
