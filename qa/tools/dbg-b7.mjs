import { open } from './b7lib.mjs';
const { page, ev, url, done } = await open(5303);
console.log(url('?debug=1'));
await page.goto(url('?debug=1'));
await new Promise(r => setTimeout(r, 5000));
console.log(await ev('location.href + " | " + document.title + " | " + document.body.innerText.slice(0,200)'));
await done?.();
process.exit(0);
