#!/bin/bash
# $1 tag $2 SMOKE_ONLY $3 QUERY $4 maxtries ; waits for mem>=1500 & no other smoke; retries only on renderer crash
for t in $(seq 1 ${4:-3}); do
  for w in $(seq 1 90); do a=$(free -m | awk '/Mem:/{print $7}'); pgrep -f "smoke-browser.mjs" >/dev/null || { [ "$a" -ge 1500 ] && break; }; sleep 10; done
  echo "try $t $(date +%T) avail $a" >> logs/q18-$1.mine.tries
  ./runq18.sh $1 "$2" "$3"; cp logs/q18-$1.log logs/q18-$1-mine$t.log
  grep -q "targetCrashed" logs/q18-$1.log || break
done
echo GATEDONE >> logs/q18-$1.mine.tries
