#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
# batch28 ②：在 dist 副本里注入样例，DIST= 跑 check-prod-hooks；scratch 跑完删除，不改快照 dist
G=${QA_DIR}/snap-fcd796a/game; X=${QA_DIR}/scratch-b28-hooks; rm -rf $X; cp -a $G/dist $X
J=$(ls $X/static/index-*.js); cp $J $X/orig.js
run() { cp $X/orig.js $J; printf '\n;(function(){%s})();\n' "$2" >> $J; (cd $G && DIST=$X node --import ./scripts/register-ts-paths.mjs scripts/check-prod-hooks.mjs >/tmp/b28h.out 2>&1); rc=$?; echo "$1 | expect $3 | rc $rc | $(grep -m1 -oE '(location\[|方括号|切 / 解析|URL 对象|document\.URL|location\.toString|读非白名单|变量传参|其它用法)[^：:]*' /tmp/b28h.out)"; }
run clean '' 0
# 上次 4 种
run 'loc[`search`]' 'var q=location[`search`];' 1
run 'href.split(?)' 'var q=location.href.split(`?`)[1];' 1
run 'newURL.search' 'var q=new URL(location.href).search;' 1
run 'document.URL' 'var q=document.URL;' 1
# 变体
run "window.location['search']" "var q=window.location['search'];" 1
run 'globalThis.location["href"]' 'var q=globalThis.location["href"].split("?");' 1
run 'href.slice(indexOf)' 'var h=location.href;var q=location.href.slice(location.href.indexOf("?"));' 1
run 'href.match' 'var m=location.href.match(/quality=(\w+)/);' 1
run 'href.replace' 'var q=location.href.replace(/^[^?]*/,"");' 1
run 'stored-URL.search' 'var u=new URL(location.href);var q=u.search.slice(1);' 1
run 'stored-location.search' 'var l=location;var q=l.search;' 1
run 'document.documentURI' 'var q=document.documentURI.split("?");' 1
run 'document.baseURI' 'var q=document.baseURI;' 1
run "document['URL']" "var q=document['URL'];" 1
run 'location.toString()' 'var q=location.toString().split("?");' 1
run 'spaced' 'var q=location . href . split ( "?" );' 1
# 可能的漏网（记录，不预设）
run 'destructure {search}=location' 'var {search:s}=location;' '?'
run 'stored-href.split' 'var h=location.href;var q=h.split("?")[1];' '?'
run 'String(location).split' 'var q=String(location).split("?")[1];' '?'
run 'template ${location}' 'var q=`${location}`.split("?")[1];' '?'
run 'location.hash' 'var q=location.hash.slice(1);' '?'
run 'nav-timing name' 'var q=performance.getEntriesByType("navigation")[0].name.split("?")[1];' '?'
# 不该误报
run 'newURL(e,location.href)' 'var u=new URL("a.glb",location.href);' 0
run 'String#search()' 'var i="image/jpeg".search(/^image\/jpe?g$/);' 0
run 'String#search spaced' 'var i=n.search (/x/);' 0
run 'const a=location.href' 'var a=location.href;' 0
run 'research/searchable' 'var x={};x.research=1;x.searchable=2;' 0
run 'location.pathname' 'var p=location.pathname;' 0
rm -rf $X /tmp/b28h.out
