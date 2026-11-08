[CmdletBinding()]
param(
    [string]$OutputPath = ""
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$meshRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$iosRoot = Join-Path $meshRoot 'ios'
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $meshRoot 'dist/RescueMesh-Mac.zip'
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$null = New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($OutputPath))

# Explicit public source allowlist. Runtime directories and credentials cannot enter
# the archive through a broad recursive workspace copy.
$required = @(
    'EmergencyMesh/EmergencyMeshApp.swift',
    'EmergencyMesh/Models.swift',
    'EmergencyMesh/WireCodec.swift',
    'EmergencyMesh/SecureStore.swift',
    'EmergencyMesh/BLETransport.swift',
    'EmergencyMesh/LocationService.swift',
    'EmergencyMesh/AppModel.swift',
    'EmergencyMesh/ContentView.swift',
    'EmergencyMesh/Info.plist',
    'EmergencyMeshTests/WireCodecTests.swift',
    'EmergencyMeshTests/golden-v1.json',
    'EmergencyMesh.xcodeproj/project.pbxproj',
    'EmergencyMesh.xcodeproj/xcshareddata/xcschemes/EmergencyMesh.xcscheme',
    'scripts/check-mac.sh',
    'scripts/create-project.mjs',
    'README.md',
    'verification.json',
    '.gitignore',
    'design/rescuemesh-phone.png',
    'design/README.md'
)
$entries = [System.Collections.Generic.List[object]]::new()
foreach ($relative in $required) {
    $source = [System.IO.Path]::GetFullPath((Join-Path $iosRoot $relative))
    if (-not $source.StartsWith($iosRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Source escaped the iOS source directory: $relative"
    }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Required Mac payload is missing: $relative" }
    $entries.Add([pscustomobject]@{ path = $relative; source = $source })
}

# Include native asset catalogs if the iOS owner adds them; never collect arbitrary
# adjacent files. All source Swift files must match the reviewed nine-file project.
$assetRoot = Join-Path $iosRoot 'EmergencyMesh/Assets.xcassets'
if (Test-Path -LiteralPath $assetRoot -PathType Container) {
    foreach ($asset in Get-ChildItem -LiteralPath $assetRoot -Recurse -File) {
        $relative = [System.IO.Path]::GetRelativePath($iosRoot, $asset.FullName).Replace('\', '/')
        if ($relative -notmatch '\.(json|png|jpg|jpeg|pdf|svg|heic)$') { throw "Unexpected native asset type: $relative" }
        $entries.Add([pscustomobject]@{ path = $relative; source = $asset.FullName })
    }
}
$swiftSources = @(Get-ChildItem -LiteralPath (Join-Path $iosRoot 'EmergencyMesh'), (Join-Path $iosRoot 'EmergencyMeshTests') -Recurse -File -Filter '*.swift')
if ($swiftSources.Count -ne 9 -or @($entries | Where-Object { $_.path.EndsWith('.swift') }).Count -ne 9) {
    throw 'Expected exactly nine reviewed Swift source files. Update the packaging allowlist if the project intentionally changes.'
}
$handoff = Join-Path $meshRoot 'docs/MAC-HANDOFF.md'
if (-not (Test-Path -LiteralPath $handoff -PathType Leaf)) { throw 'docs/MAC-HANDOFF.md is required.' }
$entries.Add([pscustomobject]@{ path = 'MAC-HANDOFF.md'; source = $handoff })

$project = Get-Content -LiteralPath (Join-Path $iosRoot 'EmergencyMesh.xcodeproj/project.pbxproj') -Raw
foreach ($swift in $swiftSources) {
    if (-not $project.Contains('path = ' + $swift.Name + ';')) { throw "Swift source is missing from Xcode project: $($swift.Name)" }
}
[xml]$plist = Get-Content -LiteralPath (Join-Path $iosRoot 'EmergencyMesh/Info.plist') -Raw
if ($plist.OuterXml -notmatch '<key>CFBundleDisplayName</key>\s*<string>RescueMesh</string>') { throw 'Installed app display name must be RescueMesh.' }
[xml]$scheme = Get-Content -LiteralPath (Join-Path $iosRoot 'EmergencyMesh.xcodeproj/xcshareddata/xcschemes/EmergencyMesh.xcscheme') -Raw
if ($scheme.OuterXml -notmatch 'BlueprintName="EmergencyMesh"' -or $scheme.OuterXml -notmatch 'BlueprintName="EmergencyMeshTests"') { throw 'Shared app and test scheme targets are required.' }
$fixtureHash = (Get-FileHash -LiteralPath (Join-Path $iosRoot 'EmergencyMeshTests/golden-v1.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$hubFixtureHash = (Get-FileHash -LiteralPath (Join-Path $meshRoot 'hub/fixtures/golden-v1.json') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($fixtureHash -ne $hubFixtureHash) { throw 'The iOS golden fixture differs from the public hub fixture.' }

$manifestFiles = @($entries | Sort-Object path | ForEach-Object {
    [ordered]@{ path = $_.path; bytes = (Get-Item -LiteralPath $_.source).Length; sha256 = (Get-FileHash -LiteralPath $_.source -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$manifest = [ordered]@{
    product = 'RescueMesh'
    format = 'unsigned Xcode source handoff'
    schema = 1
    generatedAt = [DateTime]::UtcNow.ToString('o')
    payloadFiles = $manifestFiles.Count
    swiftFiles = 9
    nativeXcodeBuildVerified = $false
    xctestExecutedOnMac = $false
    fixtureIsPublicSynthetic = $true
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
                $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $entry.source, $prefix + $entry.path, [System.IO.Compression.CompressionLevel]::Optimal)
            }
            $manifestEntry = $archive.CreateEntry($prefix + 'MANIFEST.json')
            $manifestStream = $manifestEntry.Open()
            try { $manifestStream.Write($manifestBytes, 0, $manifestBytes.Length) } finally { $manifestStream.Dispose() }
        } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }

    # Read the actual ZIP, enforce forward-slash portable filenames and inspect
    # every decompressed payload hash instead of treating ZIP creation as success.
    $verify = [System.IO.Compression.ZipFile]::OpenRead($temporary)
    try {
        if ($verify.Entries.Count -ne $manifestFiles.Count + 1) { throw 'Archive file count does not match its manifest.' }
        $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
        foreach ($entry in $verify.Entries) {
            if (-not $seen.Add($entry.FullName) -or $entry.FullName.Contains('\') -or $entry.FullName.Contains('..') -or -not $entry.FullName.StartsWith($prefix)) { throw 'Unsafe or duplicate archive path.' }
            if ($entry.FullName -match '(^|/)(\.emergency|\.supervisor|\.private|node_modules|\.build|DerivedData|xcuserdata|runtime|logs)(/|$)' -or $entry.FullName -match '(?i)(token|credential|\.env)(\.|/|$)') { throw 'A private/runtime path entered the archive.' }
            if ($entry.FullName -eq $prefix + 'MANIFEST.json') { continue }
            $relative = $entry.FullName.Substring($prefix.Length)
            $expected = @($manifestFiles | Where-Object { $_.path -ceq $relative })
            if ($expected.Count -ne 1 -or $entry.Length -ne $expected[0].bytes) { throw "Unexpected archive payload: $relative" }
            $payload = $entry.Open()
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try { $actualHash = [Convert]::ToHexString($sha.ComputeHash($payload)).ToLowerInvariant() } finally { $sha.Dispose(); $payload.Dispose() }
            if ($actualHash -cne $expected[0].sha256) { throw "Payload hash mismatch: $relative" }
        }
    } finally { $verify.Dispose() }
    Move-Item -LiteralPath $temporary -Destination $OutputPath -Force
} finally {
    if (Test-Path -LiteralPath $temporary -PathType Leaf) { Remove-Item -LiteralPath $temporary -Force }
}

[ordered]@{
    zip = $OutputPath
    sha256 = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    bytes = (Get-Item -LiteralPath $OutputPath).Length
    fileCount = $manifestFiles.Count + 1
    payloadFiles = $manifestFiles.Count
    swiftFiles = 9
    validatedPayloadHashes = $true
    fixtureSha256 = $fixtureHash
    nativeXcodeBuildVerified = $false
} | ConvertTo-Json
