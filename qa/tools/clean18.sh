#!/bin/bash
# own only: kill my headless chrome (qa-chrome- profiles from cdp.mjs); remove my /tmp/qa-chrome-* dirs not in use. smoke-chrome dirs handled per-run in runq18.sh (only ones created by my run)
for p in $(pgrep -f "chrome.*--headless.*user-data-dir=/tmp/qa-chrome-"); do kill -9 $p 2>/dev/null; done
sleep 1
inuse=$(pgrep -af "user-data-dir=/tmp/" | grep -o "user-data-dir=/tmp/[^ ]*" | sed 's#user-data-dir=##' | sort -u)
for d in /tmp/qa-chrome-*; do [ -d "$d" ] || continue; echo "$inuse" | grep -qx "$d" || rm -rf "$d"; done
true
