// PRIOR ART: scripts/eval/paddle-table-6388/mkreview.mjs — the cross-review request builder (reviewer of the other
// family, image + read, review-prompt there). Changed for the pilot: the review prompt also judges an <image-desc>-only
// read (review-prompt-pilot.txt), and the 5 planted controls are INVENTED LINES (a prose line from another book's page),
// not duplicated rows. Parses the Opus sentinel reply; a read that does not parse is reported, not reviewed.
// Usage (cwd = scratch): node mkreview.mjs <sample.json> <reads.jsonl> <out.jsonl>
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const P = fs.readFileSync(path.join(HERE, 'review-prompt-pilot.txt'), 'utf8');
const [, , SAMPLE, READS, OUT] = process.argv;
const S = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
const last = new Map(); for (const l of fs.readFileSync(READS, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.text) last.set(r.uid, r); }
export function parseRead(t) {
  const m = String(t || '').match(/===LAYOUT===\s*([a-z]+)[\s\S]*?===TRANSCRIPTION===\s*\n([\s\S]*?)\n?===END===/);
  return m ? { layout: m[1], body: m[2].trim() } : null;
}
const han = (s) => (s.match(/\p{Script=Han}/gu) || []).length;
const h = (s) => crypto.createHash('sha256').update('6388-pilot:' + s).digest('hex');
const real = [], unparsed = [];
for (const s of S) { const r = last.get(s.uid); const p = r && parseRead(r.text); if (!p) { unparsed.push(s.uid); continue; } real.push({ uid: s.uid, base: s.uid, image: s.image, text: p.body, layout: p.layout }); }
// Controls: 5 reads with a body (not drawing-only), seeded; plant ONE line of prose from a different book's Paddle text
// (a line of ≥ 10 Han characters with no repeated character run), in the middle of the body.
const donors = S.flatMap((s) => s.paddle.split('\n').map((l) => l.replace(/<[^>]+>/g, '').trim()).filter((l) => han(l) >= 10 && han(l) <= 24 && !/(.)\1/u.test(l)).map((l) => ({ bid: s.bid, l })));
const bodies = real.filter((r) => han(r.text.replace(/<image-desc>[\s\S]*?<\/image-desc>/g, '')) >= 40).sort((a, b) => (h(a.uid) < h(b.uid) ? -1 : 1)).slice(0, 5);
const controls = bodies.map((r, i) => {
  const bid = S.find((s) => s.uid === r.uid).bid;
  const d = donors.filter((x) => x.bid !== bid && !r.text.includes(x.l.slice(0, 4))).sort((a, b) => (h(i + a.l) < h(i + b.l) ? -1 : 1))[0];
  const lines = r.text.split('\n'); const body = lines.map((l, k) => [l, k]).filter(([l]) => han(l) >= 3 && !/^</.test(l));
  const k = body[Math.floor(body.length / 2)][1];
  return { uid: `ctl${i + 1}_${r.uid}`, base: r.uid, image: r.image, inserted: d.l, donor_book: d.bid, text: [...lines.slice(0, k + 1), d.l, ...lines.slice(k + 1)].join('\n'), control: true };
});
const all = [...real, ...controls].sort((a, b) => (h('o' + a.uid) < h('o' + b.uid) ? -1 : 1));
fs.writeFileSync(OUT, all.map((r) => JSON.stringify({ uid: r.uid, image: r.image, prompt: P.replace('{{TEXT}}', r.text) + '\n\nThe page image is attached:' })).join('\n') + '\n');
fs.writeFileSync(OUT.replace('.jsonl', '-controls.json'), JSON.stringify(controls.map(({ text, ...c }) => c), null, 1));
fs.writeFileSync(OUT.replace('.jsonl', '-parsed.json'), JSON.stringify(real.map(({ text, ...r }) => ({ ...r, han: han(text), body_han: han(text.replace(/<image-desc>[\s\S]*?<\/image-desc>/g, '').replace(/<[^>]+>/g, '')) })), null, 1));
console.log(OUT, all.length, 'real', real.length, 'unparsed', unparsed.length, unparsed.join(','), '| controls', controls.map((c) => c.uid + ' ' + c.inserted).join(' | '));
