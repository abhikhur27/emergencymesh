#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$OutputPath = '',
    [switch]$SourceOnly,
    [switch]$BundleModel
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($SourceOnly -and $BundleModel) { throw 'SourceOnly and BundleModel are mutually exclusive.' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$meshRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$iosRoot = [System.IO.Path]::GetFullPath((Join-Path $meshRoot 'ios'))
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $filename = if ($SourceOnly) { 'RescueMesh-Mac-SourceOnly.zip' } elseif ($BundleModel) { 'RescueMesh-Mac-Offline.zip' } else { 'RescueMesh-Mac.zip' }
    $OutputPath = Join-Path $meshRoot ('dist/' + $filename)
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$null = New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($OutputPath))

$modelPath = 'EmergencyMesh/TemocModel/qwen2.5-1.5b-instruct-q4_k_m.gguf'
$modelBytes = [long]1117320736
$modelHash = '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e'
$runtimeArchivePath = 'TemocRuntime/llama-b5046-xcframework.zip'
$runtimeArchiveBytes = [long]74944281
$runtimeArchiveHash = 'c19be78b5f00d8d29a25da41042cb7afa094cbf6280a225abe614b03b20029ab'

# Explicit source allowlist. Never copy the Windows-extracted Vendor tree: its
# macOS symlinks may be ordinary text files. Preserve the official ZIP instead.
$appSources = @(
    'EmergencyMesh/EmergencyMeshApp.swift',
    'EmergencyMesh/Models.swift',
    'EmergencyMesh/WireCodec.swift',
    'EmergencyMesh/SecureStore.swift',
    'EmergencyMesh/BLETransport.swift',
    'EmergencyMesh/LocationService.swift',
    'EmergencyMesh/AppModel.swift',
    'EmergencyMesh/ContentView.swift',
    'EmergencyMesh/TemocChatModel.swift',
    'EmergencyMesh/TemocHistory.swift',
    'EmergencyMesh/TemocModelFiles.swift',
    'EmergencyMesh/TemocSafety.swift',
    'EmergencyMesh/TemocView.swift'
)
$testSources = @(
    'EmergencyMeshTests/WireCodecTests.swift',
    'EmergencyMeshTests/TemocSafetyTests.swift'
)
$runtimeSources = @(
    'TemocRuntime/Sources/TemocRuntime/TemocEngine.swift',
    'TemocRuntime/Sources/TemocSmokeCheck/TemocSmokeCheck.swift'
)
$required = $appSources + $testSources + $runtimeSources + @(
    'EmergencyMesh/Info.plist',
    'EmergencyMesh/TemocModel/README.md',
    'EmergencyMesh/TemocModel/manifest.json',
    'EmergencyMeshTests/golden-v1.json',
    'EmergencyMeshTests/followup-v1.json',
    'EmergencyMesh.xcodeproj/project.pbxproj',
    'EmergencyMesh.xcodeproj/xcshareddata/xcschemes/EmergencyMesh.xcscheme',
    'TemocRuntime/Package.swift',
    'TemocRuntime/LLAMA-LICENSE.txt',
    'TemocRuntime/QWEN-LICENSE.txt',
    'TemocRuntime/llama-b5046-reference.h',
    'TemocRuntime/verification.json',
    'scripts/check-mac.sh',
    'scripts/create-project.mjs',
    'scripts/prepare-mac.sh',
    'README.md',
    'verification.json',
    '.gitignore',
    'design/rescuemesh-phone.png',
    'design/temoc-target.png',
    'design/README.md'
)
if ($BundleModel) { $required += $modelPath }
if (-not $SourceOnly) { $required += $runtimeArchivePath }

$entries = [System.Collections.Generic.List[object]]::new()
$paths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
function Add-Payload([string]$Relative, [string]$Source) {
    $full = [System.IO.Path]::GetFullPath($Source)
    if (-not $full.StartsWith($meshRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Payload escaped the project directory: $Relative" }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Required Mac payload is missing: $Relative" }
    $item = Get-Item -LiteralPath $full
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Payload must be a regular file: $Relative" }
    $parent = $item.Directory
    while ($null -ne $parent -and $parent.FullName -ne $meshRoot) {
        if (($parent.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Payload parent must not be a junction/symlink: $Relative" }
        $parent = $parent.Parent
    }
    if ($Relative.Contains('\') -or $Relative.StartsWith('/') -or $Relative.Split('/').Contains('..')) { throw "Unsafe payload path: $Relative" }
    if (-not $paths.Add($Relative)) { throw "Duplicate payload path: $Relative" }
    $entries.Add([pscustomobject]@{ path = $Relative; source = $full })
}
foreach ($relative in $required) {
    $source = [System.IO.Path]::GetFullPath((Join-Path $iosRoot $relative))
    if (-not $source.StartsWith($iosRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Source escaped the iOS directory: $relative" }
    Add-Payload $relative $source
}

# The reviewed native catalog may contain only JSON metadata and PNG/PDF art.
$assetRoot = Join-Path $iosRoot 'EmergencyMesh/RescueMesh.xcassets'
if (-not (Test-Path -LiteralPath $assetRoot -PathType Container)) { throw 'RescueMesh.xcassets is required.' }
foreach ($asset in Get-ChildItem -LiteralPath $assetRoot -Recurse -File) {
    $relative = [System.IO.Path]::GetRelativePath($iosRoot, $asset.FullName).Replace('\', '/')
    if ($relative -notmatch '\.(json|png|pdf)$') { throw "Unexpected native asset type: $relative" }
    Add-Payload $relative $asset.FullName
}

# Fail closed on new Swift files until the project and allowlist are reviewed.
# Package.swift is a manifest, not an app/runtime source file.
$actualSwift = @(Get-ChildItem -LiteralPath (Join-Path $iosRoot 'EmergencyMesh'), (Join-Path $iosRoot 'EmergencyMeshTests'), (Join-Path $iosRoot 'TemocRuntime/Sources') -Recurse -File -Filter '*.swift' | ForEach-Object { [System.IO.Path]::GetRelativePath($iosRoot, $_.FullName).Replace('\', '/') } | Sort-Object)
$expectedSwift = @($appSources + $testSources + $runtimeSources | Sort-Object)
if (@(Compare-Object -ReferenceObject $expectedSwift -DifferenceObject $actualSwift -CaseSensitive).Count -ne 0) { throw 'Swift source set changed. Review and update the project and Mac packaging allowlist.' }
Add-Payload 'MAC-HANDOFF.md' (Join-Path $meshRoot 'docs/MAC-HANDOFF.md')
Add-Payload 'docs/TEMOC.md' (Join-Path $meshRoot 'docs/TEMOC.md')

$modelMetadata = Get-Content -LiteralPath (Join-Path $iosRoot 'EmergencyMesh/TemocModel/manifest.json') -Raw | ConvertFrom-Json
if ($modelMetadata.filename -cne [System.IO.Path]::GetFileName($modelPath) -or $modelMetadata.bytes -ne $modelBytes -or $modelMetadata.sha256 -cne $modelHash -or $modelMetadata.revision -cne '91cad51170dc346986eccefdc2dd33a9da36ead9') { throw 'The public model manifest differs from the pinned dependency.' }

$project = Get-Content -LiteralPath (Join-Path $iosRoot 'EmergencyMesh.xcodeproj/project.pbxproj') -Raw
foreach ($relative in ($appSources + $testSources)) {
    $filename = [System.IO.Path]::GetFileName($relative)
    if (-not $project.Contains('path = ' + $filename + ';')) { throw "Swift source is missing from Xcode project: $filename" }
}
if (-not $project.Contains('XCLocalSwiftPackageReference') -or -not $project.Contains('TemocRuntime')) { throw 'Xcode project must reference the local TemocRuntime Swift package.' }
[xml]$plist = Get-Content -LiteralPath (Join-Path $iosRoot 'EmergencyMesh/Info.plist') -Raw
if ($plist.OuterXml -notmatch '<key>CFBundleDisplayName</key>\s*<string>RescueMesh</string>') { throw 'Installed app display name must be RescueMesh.' }
[xml]$scheme = Get-Content -LiteralPath (Join-Path $iosRoot 'EmergencyMesh.xcodeproj/xcshareddata/xcschemes/EmergencyMesh.xcscheme') -Raw
if ($scheme.OuterXml -notmatch 'BlueprintName="EmergencyMesh"' -or $scheme.OuterXml -notmatch 'BlueprintName="EmergencyMeshTests"') { throw 'Shared app and test scheme targets are required.' }
$fixtureHash = (Get-FileHash -LiteralPath (Join-Path $iosRoot 'EmergencyMeshTests/golden-v1.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$hubFixtureHash = (Get-FileHash -LiteralPath (Join-Path $meshRoot 'hub/fixtures/golden-v1.json') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($fixtureHash -ne $hubFixtureHash) { throw 'The iOS golden fixture differs from the public hub fixture.' }
$followupFixtureHash = (Get-FileHash -LiteralPath (Join-Path $iosRoot 'EmergencyMeshTests/followup-v1.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$hubFollowupFixtureHash = (Get-FileHash -LiteralPath (Join-Path $meshRoot 'hub/fixtures/followup-v1.json') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($followupFixtureHash -ne $hubFollowupFixtureHash) { throw 'The iOS follow-up fixture differs from the public hub fixture.' }

# File hashes and ZIP read-back are streamed; no GGUF-sized byte array.
$manifestFiles = @($entries | Sort-Object path | ForEach-Object {
    [ordered]@{ path = $_.path; bytes = (Get-Item -LiteralPath $_.source).Length; sha256 = (Get-FileHash -LiteralPath $_.source -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$pins = @()
if ($BundleModel) { $pins += @{ path = $modelPath; bytes = $modelBytes; sha256 = $modelHash } }
if (-not $SourceOnly) { $pins += @{ path = $runtimeArchivePath; bytes = $runtimeArchiveBytes; sha256 = $runtimeArchiveHash } }
foreach ($pin in $pins) {
    $payload = @($manifestFiles | Where-Object { $_.path -ceq $pin.path })
    if ($payload.Count -ne 1 -or $payload[0].bytes -ne $pin.bytes -or $payload[0].sha256 -cne $pin.sha256) { throw "Pinned dependency failed verification: $($pin.path)" }
}
if (-not $SourceOnly) {
    # Verify Unix symlink metadata before embedding the original official ZIP.
    $vendorZip = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $iosRoot $runtimeArchivePath))
    try {
        foreach ($link in @('Headers', 'Modules', 'Resources', 'llama', 'Versions/Current')) {
            $member = $vendorZip.GetEntry('build-apple/llama.xcframework/macos-arm64_x86_64/llama.framework/' + $link)
            if ($null -eq $member -or (($member.ExternalAttributes -shr 16) -band 0xF000) -ne 0xA000) { throw "Official runtime archive lost symlink metadata: $link" }
        }
    } finally { $vendorZip.Dispose() }
}
$manifest = [ordered]@{
    product = 'RescueMesh'
    format = 'unsigned Xcode source handoff'
    schema = 2
    packageMode = $(if ($SourceOnly) { 'source-only' } elseif ($BundleModel) { 'offline-bundled' } else { 'download-once' })
    generatedAt = [DateTime]::UtcNow.ToString('o')
    payloadFiles = $manifestFiles.Count
    appSwiftFiles = $appSources.Count
    testSwiftFiles = $testSources.Count
    runtimeSwiftFiles = $runtimeSources.Count
    nativeBuildExecutedByPackager = $false
    nativeReceiptPath = 'verification.json'
    fixtureIsPublicSynthetic = $true
    model = [ordered]@{ bundled = [bool]$BundleModel; installation = $(if ($BundleModel) { 'bundled' } else { 'one-time in-app download or explicit import' }); path = $modelPath; bytes = $modelBytes; sha256 = $modelHash; revision = '91cad51170dc346986eccefdc2dd33a9da36ead9' }
    runtime = [ordered]@{ officialArchiveBundled = -not $SourceOnly; path = $runtimeArchivePath; bytes = $runtimeArchiveBytes; sha256 = $runtimeArchiveHash; preparation = 'bash scripts/prepare-mac.sh --open'; vendorTreeRepackedOnWindows = $false }
    files = $manifestFiles
}
$manifestBytes = [System.Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Depth 8) + "`n")
$prefix = 'RescueMesh-Mac/'
$temporary = $OutputPath + '.tmp-' + [guid]::NewGuid().ToString('N')
try {
    $stream = [System.IO.File]::Open($temporary, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            foreach ($entry in ($entries | Sort-Object path)) {
                # Quantized model bytes and the official ZIP need no recompression.
                $level = if ($entry.path -eq $modelPath -or $entry.path -eq $runtimeArchivePath) { [System.IO.Compression.CompressionLevel]::NoCompression } else { [System.IO.Compression.CompressionLevel]::Optimal }
                $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $entry.source, $prefix + $entry.path, $level)
            }
            $manifestEntry = $archive.CreateEntry($prefix + 'MANIFEST.json')
            $manifestStream = $manifestEntry.Open()
            try { $manifestStream.Write($manifestBytes, 0, $manifestBytes.Length) } finally { $manifestStream.Dispose() }
        } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }

    $verify = [System.IO.Compression.ZipFile]::OpenRead($temporary)
    try {
        if ($verify.Entries.Count -ne $manifestFiles.Count + 1) { throw 'Archive file count does not match its manifest.' }
        $manifestEntry = $verify.GetEntry($prefix + 'MANIFEST.json')
        if ($null -eq $manifestEntry -or $manifestEntry.Length -ne $manifestBytes.Length) { throw 'Archive manifest is missing or truncated.' }
        $reader = [System.IO.StreamReader]::new($manifestEntry.Open(), [System.Text.UTF8Encoding]::new($false))
        try { $manifestText = $reader.ReadToEnd() } finally { $reader.Dispose() }
        if ($manifestText -cne [System.Text.Encoding]::UTF8.GetString($manifestBytes)) { throw 'Archive manifest read-back differs from the generated manifest.' }
        $readBack = $manifestText | ConvertFrom-Json -AsHashtable
        if ($readBack.schema -ne 2 -or $readBack.files.Count -ne $manifestFiles.Count) { throw 'Archive manifest schema or file count is invalid.' }
        $expectedByPath = [System.Collections.Generic.Dictionary[string,object]]::new([System.StringComparer]::Ordinal)
        foreach ($file in $readBack.files) { $expectedByPath.Add($file.path, $file) }
        $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $verify.Entries) {
            if (-not $seen.Add($entry.FullName) -or $entry.FullName.Contains('\') -or $entry.FullName.Split('/').Contains('..') -or -not $entry.FullName.StartsWith($prefix, [System.StringComparison]::Ordinal)) { throw 'Unsafe or duplicate archive path.' }
            if ($entry.FullName -match '(^|/)(\.emergency|\.supervisor|\.private|node_modules|\.build|DerivedData|xcuserdata|runtime|logs|Vendor)(/|$)' -or $entry.FullName -match '(?i)(token|credential|\.env)(\.|/|$)') { throw 'A private/runtime/unreviewed Vendor path entered the archive.' }
            if ($entry.FullName -eq $prefix + 'MANIFEST.json') { continue }
            $relative = $entry.FullName.Substring($prefix.Length)
            if (-not $expectedByPath.ContainsKey($relative)) { throw "Unexpected archive payload: $relative" }
            $expected = $expectedByPath[$relative]
            if ($entry.Length -ne $expected.bytes) { throw "Archive payload size mismatch: $relative" }
            $payload = $entry.Open()
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try { $actualHash = [Convert]::ToHexString($sha.ComputeHash($payload)).ToLowerInvariant() } finally { $sha.Dispose(); $payload.Dispose() }
            if ($actualHash -cne $expected.sha256) { throw "Payload hash mismatch: $relative" }
        }
    } finally { $verify.Dispose() }
    # Same-directory replacement occurs only after the complete ZIP passed.
    # PowerShell converts $null to an empty string for this .NET string argument;
    # NullString preserves the actual null required for an absent backup path.
    if ([System.IO.File]::Exists($OutputPath)) { [System.IO.File]::Replace($temporary, $OutputPath, [NullString]::Value) }
    else { [System.IO.File]::Move($temporary, $OutputPath) }
} finally {
    if (Test-Path -LiteralPath $temporary -PathType Leaf) { Remove-Item -LiteralPath $temporary -Force }
}

[ordered]@{
    zip = $OutputPath
    packageMode = $manifest.packageMode
    sha256 = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    bytes = (Get-Item -LiteralPath $OutputPath).Length
    fileCount = $manifestFiles.Count + 1
    payloadFiles = $manifestFiles.Count
    appSwiftFiles = $appSources.Count
    testSwiftFiles = $testSources.Count
    runtimeSwiftFiles = $runtimeSources.Count
    modelBundled = [bool]$BundleModel
    officialRuntimeArchiveBundled = -not $SourceOnly
    validatedManifestReadBack = $true
    validatedPayloadHashes = $true
    fixtureSha256 = $fixtureHash
    nativeBuildExecutedByPackager = $false
} | ConvertTo-Json
