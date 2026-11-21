import { launch, sleep } from './cdp.mjs';
const { page, close } = await launch({});
const ev = [];
page.onEvent((m) => { if (/Network\.(requestWillBeSent|loadingFailed|responseReceived)$/.test(m.method)) { const p = m.params; if (m.method.endsWith('Sent') && !/woff2/.test(p.request.url)) return; ev.push([m.method.split('.')[1], p.requestId, p.request?.url?.split('/').pop() ?? '', p.errorText ?? '', p.canceled ?? '', p.blockedReason ?? '', p.corsErrorStatus ? JSON.stringify(p.corsErrorStatus) : '', p.response?.status ?? '', p.type ?? '']); } });
await page.send('Network.enable');
await page.goto('http://127.0.0.1:5248/?smoke=1'); await sleep(8000);
const ids = new Set(ev.filter(e => e[0] === 'requestWillBeSent').map(e => e[1]));
for (const e of ev) if (ids.has(e[1])) console.log(e.join(' | '));
close(); process.exit(0);
