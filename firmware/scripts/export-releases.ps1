$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$core = if ($env:PLATFORMIO_CORE_DIR) { $env:PLATFORMIO_CORE_DIR } else { Join-Path $env:USERPROFILE '.platformio' }
$bootApp = Join-Path $core 'packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin'
if (-not (Test-Path -LiteralPath $bootApp)) { throw 'Build the firmware first: boot_app0.bin is missing.' }
$sourcePaths = @('platformio.ini', 'include/mesh_protocol.h', 'include/device_identity.h', 'include/status_screen.h', 'src/main.cpp')
$sources = @{}
foreach ($relative in $sourcePaths) { $sources[$relative] = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $project $relative)).Hash.ToLowerInvariant() }
foreach ($role in @('companion', 'relay', 'hub')) {
  $built = Join-Path $project ".pio/build/$role"
  $release = Join-Path $project "releases/$role"
  foreach ($name in @('bootloader.bin', 'partitions.bin', 'firmware.bin')) {
    if (-not (Test-Path -LiteralPath (Join-Path $built $name))) { throw "Missing $role/$name; build all target environments first." }
  }
  New-Item -ItemType Directory -Force -Path $release | Out-Null
  foreach ($name in @('bootloader.bin', 'partitions.bin', 'firmware.bin')) { Copy-Item -LiteralPath (Join-Path $built $name) -Destination (Join-Path $release $name) -Force }
  Copy-Item -LiteralPath $bootApp -Destination (Join-Path $release 'boot_app0.bin') -Force
  $offsets = [ordered]@{'bootloader.bin'='0x1000';'partitions.bin'='0x8000';'boot_app0.bin'='0xe000';'firmware.bin'='0x10000'}
  $files = @()
  $checksums = @()
  foreach ($name in $offsets.Keys) {
    $path = Join-Path $release $name
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    $files += [ordered]@{file=$name;offset=$offsets[$name];bytes=(Get-Item -LiteralPath $path).Length;sha256=$hash}
    $checksums += "$hash  $name"
  }
  $manifest = [ordered]@{
    formatVersion=1;role=$role;protocolVersion=1;firmwareRevision='rescuemesh-oled-v3';bleEnabled=($role -eq 'companion');board='LILYGO T3 LoRa32 V1.6.1 standard ESP32/SX1276';
    frequencyMHz=915;region=1;keyId=1;phy='SF7/BW125kHz/CR4-5/sync0x12/CRC/preamble8/10dBm';
    flashMode='dio';flashFrequency='40m';flashSize='4MB';platform='espressif32@6.13.0';
    exportedAtUtc=[DateTime]::UtcNow.ToString('o');physicalFlashVerified=$false;radioLinkVerified=$false;phonePowerVerified=$false;
    sourceSha256=$sources;files=$files
  }
  [IO.File]::WriteAllText((Join-Path $release 'manifest.json'), ($manifest | ConvertTo-Json -Depth 7) + "`n", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $release 'checksums.sha256'), ($checksums -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
  Write-Output "Exported $role ($($files.Count) images with SHA256 manifest)."
}
