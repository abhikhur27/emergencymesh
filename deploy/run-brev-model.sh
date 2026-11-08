#!/usr/bin/env bash
set -euo pipefail
runtime_root="${1:?Owned model directory required}"
deadline="${2:?UTC deadline required}"
deadline_epoch=$(date -u -d "$deadline" +%s)
test "$deadline_epoch" -gt "$(date -u +%s)" || exit 0
command -v ss >/dev/null;command -v flock >/dev/null
exec 9>"$runtime_root/model.lock"
flock -n 9 || { printf 'Owned model process already exists.\n' >&2; exit 1; }
if ss -ltnH '( sport = :11434 )' | grep -q .; then
  printf 'Port11434 is occupied; refusing to replace another owner.\n' >&2; exit 1
fi
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_MODELS="$runtime_root/models"
export OLLAMA_NO_CLOUD=true
export OLLAMA_CONTEXT_LENGTH=4096
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_MAX_QUEUE=8
export OLLAMA_KEEP_ALIVE=5m
model_pid=''
cleanup(){
  if test -n "$model_pid" && kill -0 "$model_pid" 2>/dev/null; then
    kill -TERM -- "$model_pid" 2>/dev/null || true
    wait "$model_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 0' TERM INT
while test "$(date -u +%s)" -lt "$deadline_epoch"; do
  "$runtime_root/tools/ollama/bin/ollama" serve >>"$runtime_root/ollama.stdout.log" 2>>"$runtime_root/ollama.stderr.log" &
  model_pid=$!
  printf '%s\n' "$model_pid" >"$runtime_root/ollama.pid"
  while kill -0 "$model_pid" 2>/dev/null && test "$(date -u +%s)" -lt "$deadline_epoch"; do sleep 2; done
  cleanup;model_pid=''
  if test "$(date -u +%s)" -lt "$deadline_epoch"; then sleep 3; fi
done
printf 'Model process deadline reached; compute deletion is separately owned by the desktop Brev guard.\n'
