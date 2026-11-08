param(
  [Parameter(Mandatory=$true)][ValidateSet('companion','relay','hub')][string]$Role,
  [Parameter(Mandatory=$true)][string]$Port,
  [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$release = Join-Path $project "releases/$Role"
$manifest = Get-Content -LiteralPath (Join-Path $release 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.role -ne $Role -or $manifest.formatVersion -ne 1) { throw 'Unexpected release manifest.' }
foreach ($file in $manifest.files) {
  if ($file.file -notin @('bootloader.bin','partitions.bin','boot_app0.bin','firmware.bin')) { throw 'Unexpected image filename.' }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $release $file.file)).Hash.ToLowerInvariant()
  if ($hash -ne $file.sha256) { throw "Checksum mismatch: $($file.file)" }
}
Write-Output "Flashing $Role to $Port at915MHz. Confirmed hardware must be standard T3 LoRa32 V1.6.1 ESP32/SX1276 with matching antenna."
& $Python -m esptool --chip esp32 --port $Port --baud 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_freq 40m --flash_size 4MB 0x1000 (Join-Path $release 'bootloader.bin') 0x8000 (Join-Path $release 'partitions.bin') 0xe000 (Join-Path $release 'boot_app0.bin') 0x10000 (Join-Path $release 'firmware.bin')
if ($LASTEXITCODE -ne 0) { throw 'esptool flash failed.' }
