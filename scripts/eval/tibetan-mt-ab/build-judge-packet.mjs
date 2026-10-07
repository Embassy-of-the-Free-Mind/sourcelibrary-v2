#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-batch-shadow-judge.mjs --packet — blinded packet + key kept
// apart, seeded shuffle, a same-arm (A/A) pair inside the same packet so the judge's tie rate is
// measured where it is used. It compares two lanes at a page SEAM; here three engines are ranked
// on a whole page against a human reference and an image, and a positive control (the reference
// itself as a candidate) is added — so the packet shape differs, the discipline is copied.
/** Blinded judge packet for the Tibetan translation A/B (#4742): per page the image, the Yigdzin source, the 84000 reference and the shuffled candidates; positive control and same-arm pairs inside; key written separately. */
/**
 *   node scripts/eval/tibetan-mt-ab/build-judge-packet.mjs --data <dir> --arms <dir> --out <dir> [--seed 4742]
 *
 * <dir>/ids-final.txt, yig/, img/, refs-final.json   (the sample)
 * <arms>/gemini/<model>/<id>.json  <arms>/mitra/<id>.json   (the arm outputs, copied down)
 *
 * Writes <out>/packet.jsonl (one page per line, labels T1..Tn shuffled per page with the seed),
 * <out>/key.json (page → label → arm; the judges never see it), <out>/packet-summary.txt.
 * Controls (recorded in the key):
 *   positive   one page carries a 4th candidate that IS the 84000 reference window — must score 5/5
 *   same-arm   on SAME_ARM_PAGES pages one engine's output appears twice under two labels — the
 *              judge's tie rate on those pairs is its noise floor; read it before the result
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const DATA = opt('data'); const ARMS = opt('arms'); const OUT = opt('out'); const SEED = Number(opt('seed', 4742));
if (!DATA || !ARMS || !OUT) { console.error('--data, --arms, --out required'); process.exit(1); }

// --engines name=dir,name=dir (dirs relative to --arms) overrides the 09-25 trio; --src <dir> reads the
// source from <dir>/<id>.txt instead of yig/mtab-yig-<id>.txt (2026-10-01: current pages.ocr.data).
const ENGINE_SPEC = opt('engines', 'flash=gemini/gemini-3-flash-preview,lite=gemini/gemini-3.1-flash-lite,mitra=mitra');
const ENGINES = Object.fromEntries(ENGINE_SPEC.split(',').map((kv) => kv.split('=')).map(([name, dir]) => [name, (id) => path.join(ARMS, dir, `${id}.json`)]));
const SRC = opt('src', null);
// --positive-control <id> / --same-arm id,id,… / --generic --language <name> (#5606): other samples,
// one packet per language, no page image, the line carries {language, work, located, reference_source,
// coverage_note} instead of the Tibetan {image, toh, reference_sides, source_lines}. Defaults = #4742.
const POSITIVE_CONTROL_PAGE = opt('positive-control', '69e7abdd5f1a22ab19a9fade_00002'); // Toh 552, two-side reference window (tight)
const SAME_ARM_PAGES = opt('same-arm', '69e7ab535f1a22ab19a96a78_00266,69e7ab365f1a22ab19a94b87_00537,69e7abe75f1a22ab19aa00d4_00566,69e7aaeb5f1a22ab19a8f91f_00432').split(',');
const GENERIC = args.includes('--generic'); const LANGUAGE = opt('language', null);
const sha = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);

// mulberry32 — deterministic, recorded seed
let s = SEED >>> 0;
const rnd = () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const ids = fs.readFileSync(path.join(DATA, 'ids-final.txt'), 'utf8').trim().split('\n').map((l) => { const [b, p] = l.trim().split(/\s+/); return `${b}_${String(p).padStart(5, '0')}`; });
const refs = JSON.parse(fs.readFileSync(path.join(DATA, 'refs-final.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
const key = { seed: SEED, positive_control_page: POSITIVE_CONTROL_PAGE, same_arm_pages: {}, pages: {}, text_hash: {} };
const lines = [];
const summary = [];
for (const id of ids) {
  const cands = [];
  for (const [arm, f] of Object.entries(ENGINES)) {
    const j = JSON.parse(fs.readFileSync(f(id), 'utf8'));
    // generic: a refusal (RECITATION/SAFETY → empty text) is shown as what it is, not as a blank page (#5581)
    const text = (j.text || '').trim() || (GENERIC && j.finishReason && j.finishReason !== 'STOP' ? `[no translation returned: the model refused (finishReason ${j.finishReason})]` : '');
    cands.push({ arm, text });
  }
  // generic: the control candidate is the located span only — lines marked [context] lie outside the page
  if (id === POSITIVE_CONTROL_PAGE) cands.push({ arm: 'reference', text: refs[id].text.replace(/⟦F\.[^⟧]*⟧/g, '').split('\n').filter((l) => !(GENERIC && l.startsWith('[context]'))).join('\n').replace(/[ \t]+/g, ' ').trim() });
  if (SAME_ARM_PAGES.includes(id)) {
    const names = Object.keys(ENGINES); const dup = names[Math.floor(rnd() * names.length)];
    cands.push({ arm: `${dup}#dup`, text: cands.find((c) => c.arm === dup).text });
    key.same_arm_pages[id] = dup;
  }
  shuffle(cands);
  const labels = cands.map((_, i) => `T${i + 1}`);
  key.pages[id] = Object.fromEntries(labels.map((l, i) => [l, cands[i].arm]));
  // pin exactly what the judge read (eval-design §8): a regenerated packet cannot silently differ
  key.text_hash[id] = Object.fromEntries(labels.map((l, i) => [l, sha(cands[i].text)]));
  const source = fs.readFileSync(SRC ? path.join(SRC, `${id}.txt`) : path.join(DATA, 'yig', `mtab-yig-${id}.txt`), 'utf8').trim();
  if (GENERIC) {
    lines.push(JSON.stringify({ id, language: LANGUAGE, work: refs[id].title_en, located: refs[id].toh, reference_source: refs[id].sides,
      coverage_note: refs[id].coverage_note, source, reference: refs[id].text, n: cands.length,
      translations: Object.fromEntries(labels.map((l, i) => [l, cands[i].text])) }));
    summary.push(`${id} n=${cands.length} ${cands.map((c) => `${c.arm}:${c.text.length}`).join(' ')}`);
    continue;
  }
  // Yigdzin drops one manuscript line on some two-leaf pages (peer finding, 2026-09-25): count the
  // lines so the judge can attribute a one-line omission to the source, not to an engine
  const sourceLines = source.split('\n').filter((l) => l.trim()).length;
  const sourceNote = sourceLines === 13 ? 'two-leaf page with 13 lines where the book has 14: one manuscript line is probably missing from the OCR (source defect, not a translation omission)' : undefined;
  lines.push(JSON.stringify({
    id,
    image: path.resolve(DATA, 'img', `${id}.jpg`),
    source_lines: sourceLines,
    ...(sourceNote ? { source_note: sourceNote } : {}),
    text_title: refs[id].title_en,
    toh: refs[id].toh,
    reference_sides: refs[id].sides,
    source,
    reference: refs[id].text,
    n: cands.length,
    translations: Object.fromEntries(labels.map((l, i) => [l, cands[i].text])),
  }));
  summary.push(`${id} ${refs[id].toh} n=${cands.length} ${cands.map((c) => `${c.arm}:${c.text.length}`).join(' ')}`);
}
fs.writeFileSync(path.join(OUT, 'packet.jsonl'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));
fs.writeFileSync(path.join(OUT, 'packet-summary.txt'), summary.join('\n') + '\n');
console.log(`${lines.length} pages → ${OUT}/packet.jsonl; key in key.json (seed ${SEED}); positive control ${POSITIVE_CONTROL_PAGE}; same-arm on ${Object.keys(key.same_arm_pages).length} pages`);
