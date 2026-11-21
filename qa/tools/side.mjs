const ws = new WebSocket(process.argv[2]);
const expr = process.argv[3];
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, timeout: 5000 } }));
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) { console.log(JSON.stringify(d.result?.result?.value ?? d)); process.exit(0); } };
setTimeout(() => { console.log('SIDE_TIMEOUT'); process.exit(0); }, 10000);
