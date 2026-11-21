#!/bin/bash
# only my own: kill headless chrome with qa-chrome- profiles (my cdp.mjs) whose launcher node is gone or forced; remove /tmp profile dirs not used by any running process
FORCE=$1
for p in $(pgrep -f "chrome.*--headless.*user-data-dir=/tmp/qa-chrome-"); do kill -9 $p 2>/dev/null; done
sleep 1
inuse=$(pgrep -af "user-data-dir=/tmp/" | grep -o "user-data-dir=/tmp/[^ ]*" | sed 's#user-data-dir=##' | sort -u)
for d in /tmp/qa-chrome-* /tmp/smoke-chrome-*; do [ -d "$d" ] || continue; echo "$inuse" | grep -qx "$d" || rm -rf "$d"; done
true
