// ASSEMBLE (#7119): build each page's OCR text from its leaf reads — the warning first, then the four half-leaves
// in reading order (upper-left, upper-right, <leaf-break/>, lower-left, lower-right), row by row.
// Writes pages/<page>.json {page, text, methods, leaves:{t|b:{method, read ids, works}}, prompts:[hash]}.
//   node assemble.mjs <first> <last>
import fs from 'node:fs';
import path from 'node:path';
import { HERE, boxes } from './lib.mjs';
import { WORKS } from './locate.mjs';

// ── the reader-facing method statements. Numbers: scripts/eval/experiments/2026-10-21-whish147-malayalam-palm-leaf-opus.md
const ANCHOR_RATE = 'In a test on the verse text of 9 leaves of this manuscript (Oct 2026), AI reviewers found 25 of 36 planted differences between leaf and edition (69%, 95% CI 53–82%) and marked none falsely as certain; a third went unflagged, so where nothing is marked the leaf may still differ. The commentaries were not part of that test.';
// Corrected by the parent session's row-by-row re-score (#7119 inbox, 2026-10-22 21:07): the 2026-10-21 at-chance CER
// was a scoring artifact; Fable half-leaf free reads pool at CER 0.51 (7 leaves, range 0.45–0.58).
const FREE_RATE = 'Where a published text exists, such reads of this manuscript differed from it in about half of all characters (7 leaves, Oct 2026), so read this as a rough guide to the words, not a transcription.';
const FLUENT = (which) => `The reading of the ${which.length > 1 ? 'upper and lower leaves is' : `${which[0]} is`} long and fluent; on a commentary leaf the model may be supplying a remembered text rather than reading the leaf.`;
<<<<<<< HEAD
const LAYOUT = 'Each leaf is given as its left and right halves; rows do not line up across the string holes (‖), so read each half’s rows on their own.';
=======
// Physical-row layout (#7119 inbox, 23:13): each row reads straight across both string holes.
export const LAYOUT = 'The leaf has two string holes; each numbered row reads straight across both of them (‖ marks a hole).';
export const LAYOUT_HALVES = 'Each leaf is given as its left and right halves; rows do not line up across the string holes (‖), so read each half’s rows on their own.';
>>>>>>> origin/job-whish147-best
const TAIL = 'Not checked by a scholar; report errors with the feedback button.';
const LABEL = {
  sk: 'the Sāṅkhyakārikā (GRETIL e-text)',
  jm: 'Śaṅkara’s Jayamaṅgalā (GRETIL e-text of H. Sarma’s edition, Calcutta 1926)',
  tk: 'Vācaspati Miśra’s Tattvakaumudī (a machine transcription of Tārānātha Tarkavācaspati’s printed edition, Calcutta)',
  dipika: 'Annambhaṭṭa’s Tarkasaṃgrahadīpikā (GRETIL e-text)',
  ts: 'Annambhaṭṭa’s Tarkasaṃgraha (GRETIL e-text)',
};
export const workLabel = (w) => LABEL[w];

export function warningFor(leaves) {
  const anchored = Object.values(leaves).filter((l) => l.method === 'edition-anchored');
  const free = Object.values(leaves).filter((l) => l.method === 'free-read');
  const name = { t: 'upper leaf', b: 'lower leaf' };
  const parts = [];
  if (anchored.length) {
    const works = [...new Set(anchored.flatMap((l) => l.works))];
    const which = free.length ? `The ${Object.entries(leaves).filter(([, l]) => l.method === 'edition-anchored').map(([k]) => name[k] || k).join(' and ')}: machine` : 'Machine';
    parts.push(`${which} transcription (Claude Opus 5.5, Oct 2026), anchored to the published text of ${works.map(workLabel).join(' and ')}. Where the model matched the leaf, the edition’s words are given; differences it saw clearly are written as on the leaf, doubtful ones as “edition-word [leaf: …?]”, and [illegible] marks what it could not match. ${ANCHOR_RATE}`);
  }
  if (free.length) {
    const which = anchored.length ? `The ${Object.entries(leaves).filter(([, l]) => l.method === 'free-read').map(([k]) => name[k] || k).join(' and ')}: best-effort` : 'Best-effort';
    parts.push(`${which} machine reading by Claude Fable 5.1 (Oct 2026), in IAST transliteration, with no published text to check against. ${FREE_RATE}`);
    const fluent = Object.entries(leaves).filter(([, l]) => l.method === 'free-read' && l.fluent).map(([k]) => name[k] || k);
    if (fluent.length) parts.push(FLUENT(fluent));
  }
  const blank = Object.entries(leaves).filter(([, l]) => l.method === 'no-text').map(([k]) => name[k] || k);
  if (blank.length) parts.push(`The ${blank.join(' and ')}: no writing found by the machine check.`);
  if (!anchored.length && !free.length) return `${parts.join(' ')} ${TAIL}`;
  return `${parts.join(' ')} ${LAYOUT} ${TAIL}`;
}

/** Rows of one half from a collation reply ("TEXT p01" … "TEXT p02" … "DIFFERENCES"). */
function collationRows(reply) {
  const sec = (name, until) => {
    const m = reply.match(new RegExp(`^TEXT ${name}\\s*$([\\s\\S]*?)^(?:${until})`, 'm'));
    return m ? m[1] : null;
  };
  const rows = (s) => (s || '').split('\n').map((l) => l.match(/^ROW\s+(\d+)\s*\|\s*(.*)$/)).filter(Boolean).map((m) => ({ n: Number(m[1]), text: m[2].trim() }));
  const diffs = [...(reply.split(/^DIFFERENCES\s*$/m)[1] || '').matchAll(/^-\s*(p0[12])\s*ROW\s*(\d+)\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*(certain|uncertain)/gm)]
    .map((m) => ({ half: m[1], row: Number(m[2]), ed: m[3].trim(), leaf: m[4].trim(), kind: m[5] }));
  const L = rows(sec('p01', 'TEXT p02')), R = rows(sec('p02', 'DIFFERENCES|NOTE'));
  // Mark the uncertain differences in the row text the way the page promises, where the model left the edition's
  // word bare; a certain difference the model left unapplied is applied.
  for (const d of diffs) {
    const row = (d.half === 'p01' ? L : R).find((r) => r.n === d.row);
    if (!row || !d.ed || /^[—–-]$/.test(d.ed)) continue;
    const leafWord = d.leaf.replace(/\?$/, '').trim();
    if (d.kind === 'uncertain' && !row.text.includes('[leaf:') && row.text.includes(d.ed)) row.text = row.text.replace(d.ed, `${d.ed} [leaf: ${leafWord}?]`);
    else if (d.kind === 'certain' && leafWord && !row.text.includes(leafWord) && row.text.includes(d.ed)) row.text = row.text.replace(d.ed, leafWord);
  }
  const note = (reply.match(/^NOTE\s*\|\s*(.*)$/m) || [])[1] || '';
  return { L, R, diffs, note, ok: L.length + R.length > 0 };
}
const tidy = (t) => t.replace(/\b(left|right) (of|side of) (the )?(string[- ])?hole:\s*/gi, '').replace(/\s*‖\s*/g, ' ‖ ').trim();
/**
 * A free read that found no connected text: fewer than 5 distinct tokens of 4+ letters once [illegible] and
 * bracketed notes are removed (68-tL came back as "[illegible] ca [illegible] ca …" on all 11 rows). Such a half is
 * shown as one [illegible] line; the syllable guesses stay in reads/free/ for the record.
 */
export function distinctWords(rows) {
  const toks = rows.map((r) => r.text).join(' ').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').split(/[\s|‖/·.,;:—–-]+/).filter((t) => [...t.normalize('NFC')].filter((c) => /\p{L}/u.test(c)).length >= 4);
  return new Set(toks).size;
}
export function noConnectedText(rows) { return distinctWords(rows) < 5; }
const NO_TEXT_LINE = '[illegible: the machine reading found no connected words on this half]';
const freeRows = (reply) => reply.split('\n').map((l) => l.match(/^ROW\s+(\d+)\s*\|\s*(.*)$/)).filter(Boolean).map((m) => ({ n: Number(m[1]), text: m[2].trim() }));

const read = (stage, id) => {
  const f = path.join(HERE, 'reads', stage, `${id}.txt`), m = path.join(HERE, 'reads', stage, `${id}.meta.json`);
  if (!fs.existsSync(m)) return null;
  const meta = JSON.parse(fs.readFileSync(m, 'utf8'));
  return meta.ok ? { text: fs.readFileSync(f, 'utf8'), meta } : { text: '', meta };
};

// Page 3 is the contents leaf: an English list and the same list in Malayalam, a large hand that Opus read from the
// image on the live OCR prompt in #7106 (scripts/eval/results/whish147-palm-leaf-opus-2026-10-21/page3-contents-leaf.txt).
// It is reused, not re-read; its condition note moves from <warning> to <meta> so the method statement leads.
export const CONTENTS_READ = '../whish147-palm-leaf-opus-2026-10-21/page3-contents-leaf.txt';
const CONTENTS_WARNING = 'Machine transcription of the contents leaf (Claude Opus 5.5 reading the image directly, Oct 2026): an English list on the upper leaf and the same list in Malayalam on the lower leaf. This large hand was legible to the model, unlike the Sanskrit leaves; <unclear> marks words it was unsure of. Not checked by a scholar; report errors with the feedback button.';
function contentsPage() {
  const raw = fs.readFileSync(path.join(HERE, CONTENTS_READ), 'utf8');
  const cond = (raw.match(/<warning>([\s\S]*?)<\/warning>/) || [])[1];
  const body = raw.replace(/<warning>[\s\S]*?<\/warning>\n?/, '').replace(/^---$/m, '<leaf-break/>');
  const text = `<warning>${CONTENTS_WARNING}</warning>\n${body.trim()}${cond ? `\n<meta>${cond.trim()}</meta>` : ''}\n`;
  return { page: 3, text, warning: CONTENTS_WARNING, methods: ['contents-leaf-read'], leaves: { contents: { method: 'contents-leaf-read', model: 'claude-opus-5-5', read: CONTENTS_READ, read_site: 'scripts/batch/claude-ocr.mjs (#7106), live OCR prompt v19.1' } }, prompts: [] };
}

export function assemble(n, loc) {
  if (n === 3) return contentsPage();
  const B = boxes();
  const leafNames = Object.keys(B[n]?.leaves || {});
  const leaves = {}, blocks = [], prompts = [], skips = [];
  const label = { t: 'Upper leaf', b: 'Lower leaf' };
  for (const leaf of leafNames) {
    const key = `${n}-${leaf}`, l = loc[key];
    const lab = label[leaf] || `Leaf ${leaf.replace('l', '')}`;
    const loc_r = read('locate', key);
    if (loc_r) prompts.push(loc_r.meta.prompt_hash);
    const c = l?.work ? read('collate', key) : null;
    const cr = c?.meta.ok ? collationRows(c.text) : null;
    if (cr?.ok) {
      const ex = JSON.parse(fs.readFileSync(path.join(HERE, 'reads', 'collate', `${key}.excerpt.json`), 'utf8'));
      prompts.push(c.meta.prompt_hash);
      leaves[leaf] = { method: 'edition-anchored', works: ex.works, excerpt: ex, locate: key, collate: key, span: { work: l.work, start: l.start, end: l.end }, differences: cr.diffs.length, certain: cr.diffs.filter((d) => d.kind === 'certain').length, note: cr.note, model: c.meta.model };
      blocks.push(`**${lab}, left half**\n\n${cr.L.map((r) => `${r.n}. ${tidy(r.text)}`).join('\n')}\n\n**${lab}, right half**\n\n${cr.R.map((r) => `${r.n}. ${tidy(r.text)}`).join('\n')}`);
    } else if (l?.status === 'not-text') {
      leaves[leaf] = { method: 'no-text', works: [], locate: key, model: loc_r?.meta.model, note: (loc_r?.text.match(/^NOTE\s*\|\s*(.*)$/m) || [])[1] || '' };
      blocks.push(`**${lab}**\n\n[no writing: the machine check found this leaf blank or not part of the text]`);
    } else {
      const halves = ['L', 'R'].map((h) => read('free', `${key}${h}`));
      if (halves.some((h) => !h?.meta.ok)) { skips.push(`${key}: ${halves.map((h) => h ? h.meta.error_class || 'ok' : 'no read').join('/')}`); blocks.push(null); continue; }
      halves.forEach((h) => prompts.push(h.meta.prompt_hash));
      const rows = halves.map((h) => freeRows(h.text));
      leaves[leaf] = { method: 'free-read', works: [], locate: loc_r ? key : null, free: [`${key}L`, `${key}R`], located: false, locate_why: l?.why ?? l?.status ?? null, model: halves[0].meta.model, notes: halves.map((h) => (h.text.match(/^NOTE\s*\|\s*(.*)$/m) || [])[1] || '') };
      const show = rows.map((rs) => (noConnectedText(rs) ? NO_TEXT_LINE : rs.map((r) => `${r.n}. ${tidy(r.text)}`).join('\n')));
      leaves[leaf].fluent = distinctWords(rows.flat()) >= 40;
      leaves[leaf].collapsed_halves = rows.map((rs, i) => (noConnectedText(rs) ? ['L', 'R'][i] : null)).filter(Boolean);
      blocks.push(`**${lab}, left half**\n\n${show[0]}\n\n**${lab}, right half**\n\n${show[1]}`);
    }
  }
  if (skips.length || !blocks.length) return { page: n, skip: skips.join('; ') || 'no leaves found on the scan' };
  const warning = warningFor(leaves);
  const text = `<warning>${warning}</warning>\n<language>Sanskrit</language>\n<script>handwritten</script>\n<page-type>text</page-type>\n\n${blocks.join('\n\n<leaf-break/>\n\n')}\n`;
  const methods = [...new Set(Object.values(leaves).map((l) => l.method))];
  return { page: n, text, warning, methods, leaves, prompts: [...new Set(prompts)] };
}

export function loadLocate() {
  const loc = {};
  for (const f of fs.readdirSync(HERE).filter((f) => /^locate-.*\.json$/.test(f))) Object.assign(loc, JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8')));
  return loc;
}

async function main() {
  const [a, b] = process.argv.slice(2).map(Number);
  const loc = loadLocate();
  fs.mkdirSync(path.join(HERE, 'pages'), { recursive: true });
  for (let n = a; n <= b; n++) {
    const r = assemble(n, loc);
    fs.writeFileSync(path.join(HERE, 'pages', `${n}.json`), JSON.stringify(r, null, 1));
    console.log(n, r.skip ? `SKIP ${r.skip}` : `${r.methods.join('+')} ${r.text.length} chars`);
  }
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
