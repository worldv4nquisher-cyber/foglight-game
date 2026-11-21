#!/bin/bash
# wait until avail >= 1500 MB and no qa/smoke chrome of mine running (max 20 min)
for w in $(seq 1 120); do a=$(free -m | awk '/Mem:/{print $7}'); if ! pgrep -f "smoke-browser.mjs|user-data-dir=/tmp/qa-chrome-" >/dev/null && [ "$a" -ge 1500 ]; then echo "memgate ok $a $(date +%T)"; exit 0; fi; sleep 10; done; echo "memgate timeout $a"; exit 0
