param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist' }
$bundleOutput = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($bundleOutput) | Out-Null
$allowedExtensions = @('.md','.js','.mjs','.json','.html','.css','.svg','.swift','.pbxproj','.xcscheme','.plist','.xcworkspacedata','.xcsettings','.h','.cpp','.ini','.ps1','.sh','.png','.jpg','.fcstd','.stl','.step','.stp','.3mf','.bin','.sha256','.csv','.txt','.yml','.yaml')
$files = @(Get-ChildItem -LiteralPath $projectRoot -Recurse -File | Where-Object {
    $relative = $_.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
    $segments = $relative.Split('/')
    $blocked = @('node_modules','.emergency','.pio','.native','.build','DerivedData','xcuserdata','dist','.git','.venv','private')
    $hasBlocked = $false
    foreach ($segment in $segments) { if ($blocked -contains $segment -or $segment.StartsWith('.emergency')) { $hasBlocked = $true; break } }
    $sourceAllowed = $relative -in @('README.md','.gitignore') -or
      $relative -match '^(ios|docs|hardware|integration|scripts)/' -or
      $relative -match '^firmware/(src|include|test|scripts|releases)/' -or
      $relative -in @('firmware/README.md','firmware/platformio.ini','firmware/verification.json','firmware/.gitignore') -or
      $relative -match '^hub/(src|public|tests|fixtures|scripts)/' -or
      $relative -in @('hub/README.md','hub/DESIGN.md','hub/.gitignore','hub/package.json','hub/package-lock.json')
    $sourceAllowed -and (-not $hasBlocked) -and (-not $_.FullName.StartsWith($bundleOutput + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) -and
      ($allowedExtensions -contains $_.Extension.ToLowerInvariant() -or $_.Name -eq '.gitignore') -and
      $_.Name -notmatch '^(\.env|profile|phone-profile|hub-profile|operator-token)' -and $_.Name -notmatch '\.FCStd[0-9]+$'
} | Sort-Object FullName)

function Write-Bundle([string]$Name, [System.IO.FileInfo[]]$Selected) {
    $zipPath = Join-Path $bundleOutput $Name
    # Only overwrite this script's explicit output filename, never a computed directory tree.
    $stream = [IO.File]::Open($zipPath, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
    try {
        foreach ($source in $Selected) {
            $relative = $source.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
            $entry = $archive.CreateEntry('EmergencyMesh/' + $relative, [IO.Compression.CompressionLevel]::Optimal)
            $inputStream = [IO.File]::OpenRead($source.FullName)
            $entryStream = $entry.Open()
            try { $inputStream.CopyTo($entryStream) } finally { $entryStream.Dispose(); $inputStream.Dispose() }
        }
    } finally { $archive.Dispose(); $stream.Dispose() }
    # Read back the actual archive; secrets/runtime directories must never be included.
    $readback = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $names = @($readback.Entries | ForEach-Object { $_.FullName })
        if ($names.Count -ne $Selected.Count -or ($names | Where-Object { $_ -match '/(node_modules|\.emergency[^/]*|\.pio|\.native|xcuserdata|private)/' })) { throw 'Archive verification failed' }
        if (-not ($names -contains 'EmergencyMesh/ios/EmergencyMesh.xcodeproj/project.pbxproj')) { throw 'Xcode project missing from archive' }
        if ($Name -eq 'EmergencyMesh-Demo.zip' -and -not ($names -contains 'EmergencyMesh/hub/public/app.js')) { throw 'Hub browser entry missing from archive' }
    } finally { $readback.Dispose() }
    [pscustomobject]@{ file=$Name; entries=$Selected.Count; bytes=(Get-Item -LiteralPath $zipPath).Length; sha256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() }
}

$macFiles = @($files | Where-Object {
    $r = $_.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
    $r.StartsWith('ios/') -or $r -in @('README.md','docs/PROTOCOL.md','docs/ARCHITECTURE.md','docs/DEMO.md','docs/VERIFICATION.md','hub/fixtures/golden-v1.json')
})
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'ios/EmergencyMesh.xcodeproj/project.pbxproj'))) { throw 'Wait for Xcode project before packaging' }
$receipts = @(Write-Bundle 'EmergencyMesh-Mac.zip' $macFiles; Write-Bundle 'EmergencyMesh-Demo.zip' $files)
$manifest = [pscustomobject]@{ createdAt=[DateTime]::UtcNow.ToString('o'); containsSecrets=$false; nativeBuildVerified=$false; artifacts=$receipts }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $bundleOutput 'manifest.json') -Encoding UTF8
$receipts | Format-Table -AutoSize
