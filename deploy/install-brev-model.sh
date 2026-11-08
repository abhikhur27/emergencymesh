#!/usr/bin/env bash
set -euo pipefail
deadline="${1:?UTC deadline required}"
runtime_root="${RESCUEMESH_MODEL_ROOT:-$HOME/workspace/rescuemesh-model}"
test "$(date -u -d "$deadline" +%s)" -gt "$(date -u +%s)" || { printf 'Deadline has passed.\n' >&2; exit 1; }
test "$(uname -m)" = x86_64 || { printf 'Pinned runtime requires amd64.\n' >&2; exit 1; }
command -v nvidia-smi >/dev/null
command -v ss >/dev/null;command -v flock >/dev/null
gpu_mib=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -n 1 | tr -d ' ')
test "$gpu_mib" -ge 45000 || { printf 'The approved30B build requires the selected48GB GPU.\n' >&2; exit 1; }
mkdir -p "$runtime_root/tools/ollama" "$runtime_root/downloads" "$runtime_root/models"
chmod 0700 "$runtime_root"
free_kib=$(df -Pk "$runtime_root" | awk 'NR==2 {print $4}')
test "$free_kib" -ge 40000000 || { printf 'At least40GB free storage is required.\n' >&2; exit 1; }
if ! command -v zstd >/dev/null; then
  if test "$(id -u)" = 0; then apt-get update -qq && apt-get install -y -qq zstd;
  else sudo -n apt-get update -qq && sudo -n apt-get install -y -qq zstd; fi
fi
archive="$runtime_root/downloads/ollama-0.40.15-linux-amd64.tar.zst"
expected=628c018404a4206493efd38e46251c154ede5141b8b8dc85c659b3b027c47379
if ! test -f "$archive" || ! printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status; then
  curl --fail --location --silent --show-error --connect-timeout 10 --max-time 1800 -H 'Accept: application/octet-stream' --output "$archive.part" https://api.github.com/repos/ollama/ollama/releases/assets/715495290
  printf '%s  %s\n' "$expected" "$archive.part" | sha256sum --check --status
  mv -f -- "$archive.part" "$archive"
fi
if ! test -x "$runtime_root/tools/ollama/bin/ollama"; then tar --zstd -xf "$archive" -C "$runtime_root/tools/ollama"; fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if test "$script_dir/run-brev-model.sh" != "$runtime_root/run-brev-model.sh"; then cp -- "$script_dir/run-brev-model.sh" "$runtime_root/run-brev-model.sh"; fi
chmod 0700 "$runtime_root/run-brev-model.sh"
if ! test -f "$runtime_root/owner.pid" || ! kill -0 "$(cat "$runtime_root/owner.pid")" 2>/dev/null; then
  nohup bash "$runtime_root/run-brev-model.sh" "$runtime_root" "$deadline" >"$runtime_root/owner.log" 2>&1 </dev/null &
  printf '%s\n' "$!" >"$runtime_root/owner.pid"
fi
ready=false
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:11434/api/version >"$runtime_root/ollama-version.json"; then ready=true;break;fi
  sleep 2
done
test "$ready" = true || { printf 'Owned Ollama failed its startup check.\n' >&2; exit 1; }
kill -0 "$(cat "$runtime_root/owner.pid")" 2>/dev/null || { printf 'Owned model controller exited; refusing another server as its replacement.\n' >&2; exit 1; }
curl --fail --silent --show-error --max-time 1800 -H 'Content-Type: application/json' --data '{"model":"nemotron-3-nano:30b","stream":false}' http://127.0.0.1:11434/api/pull >"$runtime_root/model-pull.json"
curl --fail --silent --show-error http://127.0.0.1:11434/api/tags >"$runtime_root/model-tags.json"
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader >"$runtime_root/gpu.txt"
printf 'Pinned local-weight Nemotron30B ready on remote loopback11434.\n'
cat "$runtime_root/ollama-version.json"
