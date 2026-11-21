// 复制风灯 GLB，只把 -collider 节点从场景树上摘掉（其它不动），生成「缺 -collider 的 puzzleCritical」用例
import { readFileSync, writeFileSync } from 'node:fs';
const [src, dst] = process.argv.slice(2);
const b = readFileSync(src);
const jsonLen = b.readUInt32LE(12);
const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
const rest = b.subarray(20 + jsonLen);
const idx = json.nodes.findIndex((n) => /-collider$/.test(n.name ?? ''));
if (idx < 0) throw new Error('no collider');
for (const n of json.nodes) if (n.children) n.children = n.children.filter((c) => c !== idx);
for (const s of json.scenes) s.nodes = s.nodes.filter((c) => c !== idx);
console.log('removed node', idx, json.nodes[idx].name, 'puzzleCritical root extras:', JSON.stringify(json.nodes.find((n) => n.extras?.puzzleCritical)?.extras));
let js = Buffer.from(JSON.stringify(json), 'utf8');
const pad = (4 - (js.length % 4)) % 4; js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
const head = Buffer.alloc(20); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + js.length + rest.length, 8);
head.writeUInt32LE(js.length, 12); head.write('JSON', 16);
writeFileSync(dst, Buffer.concat([head, js, rest]));
