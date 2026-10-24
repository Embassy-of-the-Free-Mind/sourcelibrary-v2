// PRIOR ART: scripts/eval/results/florentine-compare-6865/judge-build.mjs (paired A/B packets with the page image);
// this one blinds THREE arms per page and adds the published reference, for judge.mjs.
// Build the judge packet: per sample page, the Nahuatl column (the last <column-break/> segment, summary/keywords
// stripped) of three arms, labels X/Y/Z shuffled per page by a seeded hash, plus the reference English and the OCR.
//   node build-packet.mjs SAMPLE.json REFDIR twopass:DIRTPL opus:DIRTPL draft:DIRTPL OUT_PACKET.json OUT_KEY.json
// DIRTPL may hold {vol}; reads are <dir>/<page_id>.txt. SAMPLE rows carry ocr_nah (the stored OCR's last column segment). The key (label -> arm) stays with the builder.
import fs from 'node:fs'; import crypto from 'node:crypto';
const [SAMPLE, REFDIR, ...rest] = process.argv.slice(2);
const [KEYOUT, PACKETOUT] = [rest.pop(), rest.pop()];
const arms = rest.map((a) => a.split(/:(.*)/s).slice(0, 2));
const sample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
const nah = (t) => { const s = t.replace(/<(summary|keywords)>[\s\S]*?<\/\1>/g, '').trim(); const p = s.split('<column-break/>'); return p[p.length - 1].trim(); };
const md = (t) => t.replace(/^\[\^[^\]]+\]:.*$/gm, '').replace(/\[\^[^\]]+\]/g, '').replace(/&#8221;|&#8220;/g, '"').replace(/&#8230;/g, '…').replace(/\n{3,}/g, '\n\n').trim();
const packet = [], key = [];
for (const x of sample) {
  const ref = JSON.parse(fs.readFileSync(`${REFDIR}/${x.page_id}.json`, 'utf8'));
  const texts = arms.map(([name, tpl]) => [name, nah(fs.readFileSync(`${tpl.replace('{vol}', x.vol)}/${x.page_id}.txt`, 'utf8'))]);
  const order = texts.map((t, i) => [crypto.createHash('sha256').update(`${x.page_id}:${t[0]}:6865`).digest().readUInt32BE(0), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  const labels = ['X', 'Y', 'Z'];
  const k = `${x.vol}:${x.page_number}`;
  packet.push({ key: k, image_url: `https://media.getty.edu/iiif/image/${x.getty_uuid}/full/!2400,2400/0/default.jpg`, ocr_nahuatl: x.ocr_nah, reference: md(ref.eng), arms: Object.fromEntries(order.map((i, j) => [labels[j], texts[i][1]])) });
  key.push({ key: k, page_id: x.page_id, codex_book: x.codex_book, folio: x.folio, labels: Object.fromEntries(order.map((i, j) => [labels[j], texts[i][0]])) });
}
fs.writeFileSync(PACKETOUT, JSON.stringify(packet)); fs.writeFileSync(KEYOUT, JSON.stringify(key, null, 1));
console.log(packet.length, 'pages;', Object.entries(key.reduce((a, k) => { a[k.labels.X] = (a[k.labels.X] || 0) + 1; return a; }, {})).map(([a, n]) => `${a} as X ${n}`).join(', '));
