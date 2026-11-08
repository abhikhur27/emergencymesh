#!/usr/bin/env bash
set -euo pipefail
test "$(uname -s)" = Linux || { printf 'Linux or desktop WSL is required.\n' >&2; exit 1; }
test "$(uname -m)" = x86_64 || { printf 'This pinned archive is amd64 only.\n' >&2; exit 1; }
version=0.6.337
expected=99bf8383618903ab411a91605a43b2e2f5a333781860bd6743ba44bfc4920d4f
tool_root="${XDG_DATA_HOME:-$HOME/.local/share}/rescuemesh-tools/brev/$version"
archive="$tool_root/brev-cli_${version}_linux_amd64.tar.gz"
mkdir -p "$tool_root/bin"
if test "$#" -gt 0; then
  printf '%s  %s\n' "$expected" "$1" | sha256sum --check --status
  cp -- "$1" "$archive"
fi
if ! test -f "$archive" || ! printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status; then
  curl --fail --location --silent --show-error --connect-timeout 10 --max-time 180 --retry 2 --retry-delay 2 --retry-max-time 180 --output "$archive.part" "https://github.com/brevdev/brev-cli/releases/download/v$version/brev-cli_${version}_linux_amd64.tar.gz"
  printf '%s  %s\n' "$expected" "$archive.part" | sha256sum --check --status
  mv -f -- "$archive.part" "$archive"
fi
printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status
if ! test -f "$tool_root/bin/brev"; then
  tar -xzf "$archive" -C "$tool_root/bin" -- brev
fi
test -f "$tool_root/bin/brev" && ! test -L "$tool_root/bin/brev"
chmod 0755 "$tool_root/bin/brev"
"$tool_root/bin/brev" --version
printf 'Verified official Brev CLI: %s\nSHA256: %s\n' "$tool_root/bin/brev" "$expected"
