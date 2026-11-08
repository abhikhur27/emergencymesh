#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p .native
c++ -std=c++17 -Wall -Wextra -Werror mesh-hop.cpp -o .native/mesh-hop
node --test pipeline.test.mjs
