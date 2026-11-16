#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs `packet` — it writes the items, the wrong-page controls and the
// planted rows, but no same-output repeat, which paired-arm.mjs R4 needs for the noise floor. v3#26 added its 6 repeat
// rows by hand (no script in its results). This adds them to a finished packet, seeded, so a re-run gives the same rows.
/**
 * add-repeats.mjs --out=DIR [--per-cell=3]
 * For each cell, the first `per-cell` judged items in hash order, one route after another (stored, correction, read),
 * are put in the packet a second time under a new item id, with a key row of kind `repeat`. Idempotent.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out')), PER = Number(arg('per-cell') || 3);
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const packet = JSON.parse(fs.readFileSync(path.join(OUT, 'packet.json'), 'utf8'));
let key = JSON.parse(fs.readFileSync(path.join(OUT, 'key.json'), 'utf8')).filter((k) => k.kind !== 'repeat');
const byId = new Map(packet.items.map((it) => [it.id, it]));
packet.items = packet.items.filter((it) => !it.repeat_of);
const add = [];
for (const cell of [...new Set(key.map((k) => k.cell))]) {
  const rows = key.filter((k) => k.cell === cell && k.kind === 'item' && !k.unchanged).sort((a, b) => h(`repeat:${a.id}`).localeCompare(h(`repeat:${b.id}`)));
  const routes = [...new Set(rows.map((k) => k.route))], seenPage = new Set(), seenItem = new Set();
  for (let i = 0, n = 0; n < PER && i < PER * routes.length * 4; i++) {
    const k = rows.find((r) => r.route === routes[i % routes.length] && !seenPage.has(r.page_id) && !seenItem.has(r.judged_as));
    if (!k) continue;
    seenPage.add(k.page_id); seenItem.add(k.judged_as);
    const id = `j${h(`repeat:${k.judged_as}`).slice(0, 10)}`;
    packet.items.push({ ...byId.get(k.judged_as), id, repeat_of: k.judged_as });
    add.push({ ...k, id: `k${h(`repeat:${k.id}`).slice(0, 10)}`, judged_as: id, kind: 'repeat' });
    n++;
  }
}
packet.items.sort((a, b) => h(`order:${a.id}`).localeCompare(h(`order:${b.id}`)));
fs.writeFileSync(path.join(OUT, 'packet.json'), JSON.stringify(packet, null, 1));
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify([...key, ...add], null, 1));
console.log(`repeats: ${add.length} rows (${add.map((k) => `${k.cell}/${k.route}`).join(', ')})`);
