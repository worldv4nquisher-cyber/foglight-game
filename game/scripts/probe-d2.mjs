// batch17 D2 复现：冷启动（每次新 profile）直进 ?scene=s3，记录 menu 组 missing / loadFailures / 被取消的请求
// 用法：PROBE_RUNS=10 [PROBE_FLAGS=--disable-extensions] node scripts/probe-d2.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const RUNS = Number(process.env.PROBE_RUNS ?? 10);
const extraFlags = (process.env.PROBE_FLAGS ?? '').split(' ').filter(Boolean);
const query = process.env.PROBE_QUERY ?? 'smoke=1&debug=1&art=1&scene=s3';
const chromePath = process.env.CHROME ?? '/usr/bin/google-chrome';
const MENU = ['ui-title-logo','ui-title-logo-svg','ui-panel-frame','ui-button-primary','ui-button-secondary','ui-icon-interact','ui-icon-hint-lantern','ui-icon-journal','ui-icon-read','ui-icon-settings','ui-icon-app-512','ui-illust-loading','sfx-ui-back','sfx-ui-confirm','sfx-ui-journal','mus-menu','font-sans','font-serif'];
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'silent' });
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const results = [];
for (let run = 1; run <= RUNS; run++) {
  const profile = mkdtempSync(join(tmpdir(), 'probe-d2-chrome-'));
  const chrome = spawn(chromePath, ['--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=960,540','--remote-debugging-port=0',`--user-data-dir=${profile}`, ...extraFlags, 'about:blank'], { stdio: ['ignore','ignore','pipe'] });
  const rec = { run, canceled: [], failed: [], missing: [], loadFailures: [], err: null };
  try {
    const wsUrl = await new Promise((res, rej) => { let b=''; const t=setTimeout(()=>rej(new Error('chrome 启动超时')),30000); chrome.stderr.on('data',(d)=>{b+=d; const m=/DevTools listening on (ws:\/\/\S+)/.exec(b); if(m){clearTimeout(t);res(m[1]);}}); });
    const ws = new WebSocket(wsUrl); await new Promise((r)=>ws.addEventListener('open',r,{once:true}));
    let id=1; const pend=new Map(); const ls=[];
    ws.addEventListener('message',(ev)=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);if(m.error) p.rej(new Error(m.error.message)); else p.res(m.result);} else if(m.method) for(const l of ls) l(m);});
    const send=(method,params={},sessionId)=>new Promise((res,rej)=>{const i=id++;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params,...(sessionId?{sessionId}:{})}));});
    const { targetId } = await send('Target.createTarget',{url:'about:blank'});
    const { sessionId } = await send('Target.attachToTarget',{targetId,flatten:true});
    const reqs = new Map(); let t0 = null;
    ls.push((m)=>{ if(m.sessionId!==sessionId) return;
      if(m.method==='Network.requestWillBeSent'){ t0 ??= m.params.timestamp; reqs.set(m.params.requestId,{url:m.params.request.url,t:m.params.timestamp}); }
      if(m.method==='Network.responseReceived'){ const r=reqs.get(m.params.requestId); if(r) r.status=m.params.response.status; }
      if(m.method==='Network.loadingFailed'){ const r=reqs.get(m.params.requestId)??{}; const e={url:(r.url??'').replace(base,''),status:r.status??null,errorText:m.params.errorText,canceled:!!m.params.canceled,tSent:+((r.t-t0)||0).toFixed(3),tFail:+(m.params.timestamp-t0).toFixed(3)}; (e.canceled?rec.canceled:rec.failed).push(e); }
    });
    await send('Network.enable',{},sessionId); await send('Runtime.enable',{},sessionId); await send('Page.enable',{},sessionId);
    await send('Network.setCacheDisabled',{cacheDisabled:true},sessionId);
    // PROBE_ABORT=1：确定性注入取消（Fetch.failRequest Aborted）——音频第 1 次请求、图片第 2 次请求（<img>.decode 那次）各掐一次，模拟冷启动那批取消
    rec.injected = [];
    if (process.env.PROBE_ABORT) {
      const seen = new Map();
      ls.push(async (m)=>{ if(m.sessionId!==sessionId||m.method!=='Fetch.requestPaused') return;
        const u=m.params.request.url; const n=(seen.get(u)??0)+1; seen.set(u,n);
        const isAudio=/\/audio\/(sfx\/sfx-ui-|music\/mus-menu)/.test(u); const isImg=/\/ui\/ui-(icon|illust-loading)/.test(u);
        if((isAudio&&n===1)||(isImg&&n===2)){ rec.injected.push(u.split('/').pop()+'#'+n); await send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'Aborted'},sessionId).catch(()=>{}); }
        else await send('Fetch.continueRequest',{requestId:m.params.requestId},sessionId).catch(()=>{}); });
      await send('Fetch.enable',{patterns:[{urlPattern:'*/assets/art/audio/*'},{urlPattern:'*/assets/art/ui/*'}]},sessionId);
    }
    const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true},sessionId); return r.result.value;};
    await send('Page.navigate',{url:`${base}?${query}`},sessionId);
    const tStart=Date.now();
    let st=null;
    while(Date.now()-tStart<240000){ await new Promise((r)=>setTimeout(r,500));
      st=await ev(`(()=>{const g=globalThis.__game; if(!g||!g.assets) return null; return {menu:g.assets.isGroupLoaded('menu'), scene:g.scenes?.current?.name??null};})()`).catch(()=>null);
      if(st&&st.menu&&st.scene&&st.scene!=='boot') break; }
    rec.state=st; rec.bootMs=Date.now()-tStart;
    rec.missing=await ev(`${JSON.stringify(MENU)}.filter((k)=>__game.assets.isMissing(k))`).catch((e)=>String(e));
    rec.loadFailures=await ev(`(__game.assets.loadFailures??[]).map((f)=>({...f,wall:Math.round(f.wall)}))`).catch(()=>null);
    ws.close();
  } catch(e){ rec.err=String(e); }
  chrome.kill('SIGKILL'); await new Promise((r)=>setTimeout(r,800));
  rmSync(profile,{recursive:true,force:true});
  rec.load = (await import('node:os')).loadavg()[0].toFixed(1);
  results.push(rec);
  console.log(`#${run} load ${rec.load} boot ${rec.bootMs}ms menuMissing=${JSON.stringify(rec.missing)} injected=${rec.injected.length} canceled=${rec.canceled.length} [${rec.canceled.map((c)=>c.url.split('/').pop()+'@'+c.tFail).join(' ')}] loadFailures=${JSON.stringify(rec.loadFailures)} ${rec.err??''}`);
}
writeFileSync(process.env.PROBE_OUT ?? '/tmp/probe-d2.json', JSON.stringify(results,null,1));
await server.close();
process.exit(0);
