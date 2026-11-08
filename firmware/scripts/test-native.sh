#!/usr/bin/env sh
set -eu
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$project/.pio/native-tests"
for test in protocol device_identity status_screen; do
  "${CXX:-c++}" -std=c++17 -Wall -Wextra -Werror -I"$project/include" "$project/test/test_$test.cpp" -o "$project/.pio/native-tests/$test-tests"
  "$project/.pio/native-tests/$test-tests"
done
