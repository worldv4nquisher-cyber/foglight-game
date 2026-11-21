const ws = new WebSocket(process.argv[2]); let id = 0;
const send = (method, params) => new Promise(r => { const i = ++id; const h = (m) => { const d = JSON.parse(m.data); if (d.id === i) { ws.removeEventListener('message', h); r(d); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onopen = async () => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 }); await new Promise(r => setTimeout(r, 200)); await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 }); console.log('sent'); process.exit(0); };
setTimeout(() => process.exit(1), 8000);
