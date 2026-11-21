import { readFileSync, writeFileSync } from 'node:fs';
const [src, dst, mode] = process.argv.slice(2);
const b = readFileSync(src);
const jsonLen = b.readUInt32LE(12);
const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
const rest = b.subarray(20 + jsonLen);
const idx = json.nodes.findIndex((n) => /-collider$/.test(n.name ?? ''));
if (mode === 'rename') { json.nodes[idx].name = json.nodes[idx].name.replace(/-collider$/, '-collision'); }
else { // delete + remap
  const map = (i) => (i > idx ? i - 1 : i);
  json.nodes.splice(idx, 1);
  for (const n of json.nodes) if (n.children) n.children = n.children.filter((c) => c !== idx).map(map);
  for (const s of json.scenes) s.nodes = s.nodes.filter((c) => c !== idx).map(map);
  for (const sk of json.skins ?? []) { sk.joints = sk.joints.map(map); if (sk.skeleton !== undefined) sk.skeleton = map(sk.skeleton); }
  for (const a of json.animations ?? []) for (const c of a.channels) c.target.node = map(c.target.node);
}
let js = Buffer.from(JSON.stringify(json), 'utf8');
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const head = Buffer.alloc(20); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + js.length + rest.length, 8); head.writeUInt32LE(js.length, 12); head.write('JSON', 16);
writeFileSync(dst, Buffer.concat([head, js, rest]));
console.log(mode, 'ok');
