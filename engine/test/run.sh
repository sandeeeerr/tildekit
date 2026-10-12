#!/bin/bash
# Runs every engine test on Node. The push check calls this before it asks about a push that changes engine/.
cd "$(dirname "$0")" && exec node --test "*.test.ts"
