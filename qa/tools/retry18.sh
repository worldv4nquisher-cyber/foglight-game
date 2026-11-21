#!/bin/bash
# $1 tag $2 only $3 query ; retry on OOM crash up to 4 tries
for n in 1 2 3 4; do
  for i in $(seq 1 60); do a=$(free -m | awk '/Mem/{print $7}'); [ $a -gt 4000 ] && break; sleep 10; done
  echo "try $n $(date +%T) avail $a" >> logs/q18-$1.tries
  ./runq18.sh "$1" "$2" "$3"
  cp logs/q18-$1.log logs/q18-$1-try$n.log
  grep -q "渲染进程崩溃" logs/q18-$1.log || break
done
