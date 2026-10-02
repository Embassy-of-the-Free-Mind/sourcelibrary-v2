// PRIOR ART: /root/tibetan-eval/kanjur_align.py (#4523, Hetzner, not in the repo) — the syllable
// tokenizer and Needleman-Wunsch identity are ported from it so the numbers are comparable; it does
// RETRIEVAL over the whole Kangyur from an unknown page, whereas here the folio is already claimed
// (BDRC canvas label) and the question is only "is the claim right?", so retrieval is replaced by a
// bounded offset search. scripts/works-catalog/import-cbeta-text.mjs writes a scholarly e-text as
// `ocr.data` but has no images to align against. scripts/lib/ndl-koten-lane.mjs is the
// page-provenance shape (`ocr.source`, `ocr.content_hash`, human-edit guard) this follows.
//
// derge-tengyur — pure helpers for the Derge canon imports: the Tengyur (#5497, BDRC W23703 scans)
// and the Kangyur (#5665, BDRC W4CZ5369 scans), each aligned folio-for-folio to the Esukhia digital
// edition (public domain). Both e-texts share one format (`[1b.3]` markers, `{D…}` Tohoku
// boundaries), so one parser and one alignment instrument serve both; what differs per canon is the
// constant data in CANONS.
//
// No DB, no network. The importer is scripts/import/derge-tengyur-import.mjs (--canon=kangyur).

import { createHash } from 'node:crypto';

export const TSHEG = '་';
// Tibetan punctuation / marks + whitespace, treated as syllable separators (kanjur_align.py PUNCT_RE).
const PUNCT_RE = /[\u0F01-\u0F0A\u0F0D-\u0F17\u0F1A-\u0F1F\u0F3A-\u0F3D\u0FBE-\u0FCF\s]+/gu;
// Esukhia editorial markup: (error,correction) keeps the first reading — the woodblock's; {D123}
// Tohoku boundaries (the Kangyur adds sub-texts, {D1-1}); [X] doubt marks; # peydurma note points.
// Stripped for SCORING only.
const TOHOKU_SRC = 'D[0-9a-z]+(?:-[0-9a-z]+)*';
const MARKUP_RE = new RegExp(`\\{${TOHOKU_SRC}\\}|[[\\]#]`, 'g');
const TOHOKU_RE = new RegExp(`\\{(${TOHOKU_SRC})\\}`, 'g');

/** NFC-normalised Tibetan syllables, editorial markup removed (scoring only — never stored). */
export function syllables(text) {
  let t = String(text || '').normalize('NFC');
  t = t.replace(/\(([^,()]*),[^()]*\)/g, '$1').replace(MARKUP_RE, ' ');
  t = t.replace(PUNCT_RE, TSHEG);
  return t.split(TSHEG).filter((s) => s && /[\u0F40-\u0FBC]/u.test(s));
}

/**
 * Needleman-Wunsch on syllable arrays (match 2, mismatch -1, gap -1, as kanjur_align.py).
 * Returns matches / len(a): the share of the READ that the reference accounts for.
 */
export function nwIdentity(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return 0;
  // Score-only DP with a parallel match-count DP along the chosen path (no traceback matrix).
  let prevS = new Int32Array(m + 1), prevM = new Int32Array(m + 1);
  let curS = new Int32Array(m + 1), curM = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prevS[j] = -j;
  for (let i = 1; i <= n; i++) {
    curS[0] = -i; curM[0] = 0;
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      const eq = ai === b[j - 1];
      const d = prevS[j - 1] + (eq ? 2 : -1);
      const u = prevS[j] - 1;
      const l = curS[j - 1] - 1;
      if (d >= u && d >= l) { curS[j] = d; curM[j] = prevM[j - 1] + (eq ? 1 : 0); }
      else if (u >= l) { curS[j] = u; curM[j] = prevM[j]; }
      else { curS[j] = l; curM[j] = curM[j - 1]; }
    }
    [prevS, curS] = [curS, prevS];
    [prevM, curM] = [curM, prevM];
  }
  return prevM[m] / n;
}

/**
 * Parse one Esukhia volume file into ordered page sides.
 * Markers: `[1b]` opens a side, `[1b.3]` is line 3 of it; `[355xa]` is a repeated folio number.
 * @returns {{ label: string, folio: number, side: 'a'|'b', dup: boolean, lines: string[], tohoku: string[] }[]}
 */
export function parseVolume(raw) {
  const pages = [];
  let cur = null;
  const open = (label) => {
    const m = label.match(/^(\d+)(x?)([ab])$/);
    if (!m) throw new Error(`derge-tengyur: unparseable folio marker [${label}]`);
    cur = { label, folio: Number(m[1]), side: m[3], dup: m[2] === 'x', lines: [], tohoku: [] };
    pages.push(cur);
  };
  for (const rawLine of String(raw).replace(/^\uFEFF/, '').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    const m = line.match(/^\[(\d+x?[ab])(?:\.(\d+))?\](.*)$/);
    if (!m) {
      // A continuation line without a marker belongs to the current side.
      if (!cur) throw new Error('derge-tengyur: text before the first folio marker');
      cur.lines.push(line);
      continue;
    }
    const [, label, lineNo, rest] = m;
    if (!cur || cur.label !== label) open(label);
    if (lineNo != null || rest.trim()) cur.lines.push(rest);
  }
  for (const p of pages) {
    for (const l of p.lines) for (const t of l.matchAll(TOHOKU_RE)) p.tohoku.push(t[1]);
  }
  return pages;
}

/**
 * The text stored for one side. Lines are kept as the block's lines; the `[1b.3]` markers become
 * line breaks; Esukhia's editorial markup ({D…}, (x,y), [x], #) is kept verbatim — it is the
 * edition's apparatus and the Tohoku markers are the text boundaries. A `#` that would open a line
 * is backslash-escaped so the Markdown reader does not render the line as a heading.
 */
export function pageText(page) {
  return page.lines.map((l) => l.replace(/^#/, '\\#')).join('\n').normalize('NFC').trim();
}

export const sha16 = (t) => createHash('sha256').update(t || '').digest('hex').slice(0, 16);

/** BDRC canvas label ("2a", "img. 5", …) → folio label or null. */
export function canvasFolioLabel(canvas) {
  const labels = Array.isArray(canvas?.label) ? canvas.label : [canvas?.label];
  for (const l of labels) {
    const v = typeof l === 'string' ? l : (l?.['@language'] === 'en' ? l['@value'] : null);
    if (typeof v === 'string' && /^\d+[ab]$/.test(v.trim())) return v.trim();
  }
  return null;
}

/**
 * Claim a text side for every canvas by its BDRC folio label, walking both sequences forward
 * (folio numbering can restart at 1a inside a volume, and a repeated folio is `NNNxa` in the text).
 * Returns, per canvas, the index into `pages` or null. A label that does not occur within the next
 * LOOKAHEAD sides is left unclaimed rather than searched for globally — a global search on a
 * restarting numbering would match the wrong run.
 */
export function claimByLabel(canvasLabels, pages, LOOKAHEAD = 6) {
  const norm = (p) => `${p.folio}${p.side}`;
  const out = [];
  let ptr = 0;
  for (const lab of canvasLabels) {
    if (!lab) { out.push(null); continue; }
    let hit = null;
    for (let k = ptr; k < Math.min(pages.length, ptr + LOOKAHEAD); k++) {
      if (norm(pages[k]) === lab) { hit = k; break; }
    }
    out.push(hit);
    if (hit != null) ptr = hit + 1;
  }
  return out;
}

/**
 * Score one image read against the claimed side and every side within ±SPAN of it.
 * `measured_shift` is the shift (in text sides) that scores best; `control` is the best score among
 * WRONG sides at distance ≥ 2 (neighbours ±1 can legitimately share a run of text at a page break)
 * plus one far side — the wrong-folio control.
 *
 * When nothing in the window reaches `floor`, the read is scored against EVERY side of the volume
 * (`global_best`): a read that matches a side far away is evidence of misalignment, while a read
 * that matches no side anywhere is evidence only that the reader failed on this image.
 */
export function scoreRead(readText, pages, claimed, { span = 6, far = null, floor = 0.4 } = {}) {
  const read = syllables(readText);
  const sylCache = new Map();
  const sylOf = (i) => { if (!sylCache.has(i)) sylCache.set(i, syllables(pages[i].lines.join(' '))); return sylCache.get(i); };
  const byShift = {};
  for (let d = -span; d <= span; d++) {
    const i = claimed + d;
    if (i < 0 || i >= pages.length) continue;
    byShift[d] = nwIdentity(read, sylOf(i));
  }
  const shifts = Object.keys(byShift).map(Number);
  const best = shifts.reduce((a, b) => (byShift[b] > byShift[a] ? b : a), 0);
  const ctrl = shifts.filter((d) => Math.abs(d) >= 2).map((d) => byShift[d]);
  let farScore = null;
  if (far != null && far >= 0 && far < pages.length) { farScore = nwIdentity(read, sylOf(far)); ctrl.push(farScore); }
  const r4 = (x) => Math.round(x * 1000) / 1000;
  let globalBest = null;
  if (byShift[best] < floor && read.length > 0) {
    let gi = 0, gs = -1;
    for (let i = 0; i < pages.length; i++) {
      if (sylOf(i).length === 0) continue;
      const v = nwIdentity(read, sylOf(i));
      if (v > gs) { gs = v; gi = i; }
    }
    globalBest = { shift: gi - claimed, side: pages[gi].label, identity: r4(gs) };
  }
  return {
    read_syllables: read.length,
    claimed_syllables: sylOf(claimed).length,
    identity: r4(byShift[0] ?? 0),
    measured_shift: best,
    best_identity: r4(byShift[best]),
    control: r4(ctrl.length ? Math.max(...ctrl) : 0),
    far_control: farScore == null ? null : r4(farScore),
    global_best: globalBest,
    by_shift: Object.fromEntries(shifts.map((d) => [d, r4(byShift[d])])),
  };
}

/**
 * Volume verdict (rules v2, 2026-10-01).
 *
 * A sample is INFORMATIVE when the read matches some side at ≥ informativeFloor — in the ±6 window,
 * or anywhere in the volume. An uninformative read (the reader failed: measured on v3 f. 89a, where
 * Yigdzin returned `ཨུན་ཨུ་+་ཊ་…` for a clean page that matches its side by eye) says nothing about
 * alignment and is excluded; the caller draws replacement samples.
 *
 * An informative sample is ALIGNED when its best side is the claimed one (shift 0) and it beats the
 * wrong-folio control by ≥ minMargin. The v1 rule also demanded identity ≥ 0.6 at the claimed side;
 * that floor measured the READER, not the alignment (v4 f. 208b: 0.594 at shift 0 against a 0.149
 * control), so the floor is now the informativeness floor and the margin carries the decision.
 *
 * The volume passes only if it has ≥ minScored informative samples and every one is aligned. Any
 * informative sample whose best side is elsewhere refuses the volume.
 *
 * v3 (2026-10-01): a NEAR-VERBATIM read (≥ verbatimIdentity at the claimed side) is also aligned when
 * it beats every wrong side by ≥ verbatimMargin. Formulaic commentary repeats whole runs from folio
 * to folio, so a wrong side two leaves away can legitimately share most of the page: v84 f. 18b read
 * 0.998 at its side against 0.812 two sides off (a ~75-syllable gap), and the flat 0.25 margin
 * refused a volume whose every informative read picked shift 0.
 *
 * v4 (2026-10-01): a WEAK read — best at shift 0 but not clearing the control — is INCONCLUSIVE, not
 * a refusal: it does not point anywhere else, it just cannot discriminate. It triggers the second
 * sampling round like an uninformative read, and the volume needs ≥ minScored ALIGNED reads and no
 * misaligned one. Measured on v139 f. 115b (Abhidharma prose on the four wheel-turning kings, which
 * repeats with a period of two sides): 0.785 at shift 0, 0.732 at shift +2; by eye all seven line
 * starts are 115b's and not 116b's.
 */
export const ALIGN_RULES = Object.freeze({ version: 4, informativeFloor: 0.4, minMargin: 0.25, verbatimIdentity: 0.9, verbatimMargin: 0.1, minScored: 4, minReadSyllables: 40 });

export function sampleClass(score, rules = ALIGN_RULES) {
  if (!score || score.read_syllables < rules.minReadSyllables) return 'uninformative';
  const g = score.global_best;
  if (score.best_identity < rules.informativeFloor && !(g && g.identity >= rules.informativeFloor)) return 'uninformative';
  if (score.best_identity < rules.informativeFloor && g) return g.shift === 0 ? 'weak' : 'misaligned';
  if (score.measured_shift !== 0) return 'misaligned';
  const margin = score.identity - score.control;
  if (margin >= rules.minMargin) return 'aligned';
  return score.identity >= rules.verbatimIdentity && margin >= rules.verbatimMargin ? 'aligned' : 'weak';
}

export function volumeVerdict(samples, rules = ALIGN_RULES) {
  const cls = samples.map((s) => ({ s, c: sampleClass(s.score, rules) }));
  const aligned = cls.filter((x) => x.c === 'aligned');
  const reasons = [];
  if (aligned.length < rules.minScored) reasons.push(`only ${aligned.length} aligned reads (need ${rules.minScored})`);
  for (const { s, c } of cls) {
    if (c !== 'misaligned') continue;
    const sc = s.score;
    reasons.push(`canvas ${s.canvas} (${s.label}) best matches shift ${sc.global_best && sc.best_identity < rules.informativeFloor ? sc.global_best.shift : sc.measured_shift}`);
  }
  const tag = (x) => `${x.s.canvas} (${x.s.label})`;
  return {
    pass: reasons.length === 0,
    scored: aligned.length,
    uninformative: cls.filter((x) => x.c === 'uninformative').map(tag),
    weak: cls.filter((x) => x.c === 'weak').map(tag),
    reasons,
  };
}

/**
 * Where in the volume does this read belong? Scores the read against every side and returns the
 * best side index, its identity, and the runner-up identity at a side ≥ 2 away (the control).
 * Used where BDRC's manifest carries no folio labels (I1441 = vol. 125 has only "img. N"), so the
 * canvas → side offset must be MEASURED from the reads rather than claimed by a label.
 */
export function locateRead(readText, pages) {
  const read = syllables(readText);
  const scores = pages.map((p) => (p.lines.length ? nwIdentity(read, syllables(p.lines.join(' '))) : 0));
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  const control = Math.max(0, ...scores.filter((_, i) => Math.abs(i - best) >= 2));
  const r4 = (x) => Math.round(x * 1000) / 1000;
  return { read_syllables: read.length, index: best, side: pages[best]?.label ?? null, identity: r4(scores[best] ?? 0), control: r4(control) };
}

/**
 * The offset (side index − canvas index) a set of located reads agrees on, or null with a reason.
 * Every informative read (identity ≥ informativeFloor, margin over its control ≥ minMargin, or the
 * v3 near-verbatim allowance) must give the SAME offset — a missing or extra image part-way through
 * the volume would split them, and an index mapping across such a break would be wrong after it.
 */
export function agreedOffset(located, rules = ALIGN_RULES) {
  const ok = located.filter(({ loc }) => loc.read_syllables >= rules.minReadSyllables && loc.identity >= rules.informativeFloor
    && (loc.identity - loc.control >= rules.minMargin || (loc.identity >= rules.verbatimIdentity && loc.identity - loc.control >= rules.verbatimMargin)));
  if (ok.length < rules.minScored - 1) return { offset: null, reason: `only ${ok.length} reads located with confidence (need ${rules.minScored - 1})` };
  const offs = [...new Set(ok.map(({ canvas, loc }) => loc.index - canvas))];
  if (offs.length !== 1) return { offset: null, reason: `located reads disagree on the offset: ${offs.join(', ')}` };
  return { offset: offs[0], reason: null, located: ok.length };
}

// ── Per-canon constants (#5665 generalised the Tengyur importer rather than copying it) ──────────

const ESUKHIA_PD = 'This work is a mechanical reproduction of a Public Domain work, and as such is also in the Public Domain.';
const CONVENTIONS = 'Esukhia markup kept verbatim: {D####} opens the text with that Tohoku number; (x,y) = (reading of the blocks, suggested correction); [x] = doubtful or untranscribable; # = a peydurma note point. Folio line markers [2a.1] became line breaks; a line-initial # is escaped as \\# for the Markdown reader.';

/**
 * What differs between the two canons. `scanVolumeFor(vol)` maps an e-text volume to the scan
 * volume whose manifest says "volume N"; the alignment check verifies the pairing either way.
 */
export const CANONS = Object.freeze({
  tengyur: Object.freeze({
    key: 'tengyur', issue: 5497, nVolumes: 213, etext: '/root/derge-tengyur', work: '/root/tengyur-5497',
    importer: 'script:derge-tengyur-import', campaign: 'tengyur-5497', pipeline: 'derge-tengyur-import-5497',
    textSource: 'esukhia-derge-tengyur', editionName: 'Esukhia digital Derge Tengyur', repo: 'https://github.com/Esukhia/derge-tengyur',
    licence: 'public domain — "mechanical reproduction of a public-domain work" (Esukhia README)', licenceQuote: ESUKHIA_PD,
    conventions: CONVENTIONS,
    hold: { reason: 'tengyur-import-5497', issue: 5497, release: 'a draft English translation of the Derge Tengyur is approved as a separate, priced decision (#5497: translation NOT approved at import)' },
    bdrcInstance: 'MW23703', bdrcScans: 'W23703', volumeField: 'derge_tengyur_volume',
    titleBo: 'བསྟན་འགྱུར། སྡེ་དགེ།', titleEn: 'Derge Tengyur', slug: 'derge-tengyur-vol',
    year: 1982,
    published: 'Delhi: Delhi Karmapae Choedhey, Gyalwae Sungrab Partun Khang, 1982–1985 (reproduced from clear prints of the 18th-century Derge blocks, carved 1737–1744)',
    publisher: 'Delhi Karmapae Choedhey, Gyalwae Sungrab Partun Khang', place: 'Delhi',
    describe: (vol, ig) => `Volume ${vol} of 213 of the Derge Tengyur (sde dge bstan 'gyur), the canonical Tibetan collection of translated Indian treatises and commentaries. Scans: BDRC W23703, image group ${ig}. Page text: the Esukhia digital Derge Tengyur (public domain), aligned folio by folio to the scan.`,
    // tbrc volume numbers 1317-1531 (BDRC note on MW23703); I1519 and I1520 are not volumes of W23703
    // (the manifest service answers 500; measured 2026-10-01), so volumes 203–213 are I1521–I1531.
    imageGroupFor: (vol) => `I${1317 + vol - 1 + (vol > 202 ? 2 : 0)}`,
    scanVolumeFor: (vol) => vol,
    eighty4000: false,
    claimMode: 'label', readSize: '1600,', redInk: false,
  }),
  kangyur: Object.freeze({
    key: 'kangyur', issue: 5665, nVolumes: 103, etext: '/mnt/HC_Volume_105839809/esukhia-derge-kangyur', work: '/mnt/HC_Volume_105839809/kangyur-5665',
    importer: 'script:derge-kangyur-import', campaign: 'kangyur-5665', pipeline: 'derge-kangyur-import-5665',
    textSource: 'esukhia-derge-kangyur', editionName: 'Esukhia digital Derge Kangyur', repo: 'https://github.com/Esukhia/derge-kangyur',
    licence: 'public domain — "mechanical reproduction of a public-domain work" (Esukhia README)', licenceQuote: ESUKHIA_PD,
    conventions: CONVENTIONS,
    hold: { reason: 'kangyur-import', issue: 5665, release: 'a draft English translation of the Derge Kangyur is approved as a separate, priced decision that skips the texts 84000 has published or has in progress (#5665)' },
    bdrcInstance: 'MW4CZ5369', bdrcScans: 'W4CZ5369', volumeField: 'derge_kangyur_volume',
    titleBo: 'བཀའ་འགྱུར། སྡེ་དགེ།', titleEn: 'Derge Kangyur', slug: 'derge-kangyur-vol',
    year: 1733,
    published: 'Derge: Derge Parkhang, blocks carved 1729–1733 (Library of Congress copy, scanned by BDRC)',
    publisher: 'Derge Parkhang', place: 'Derge',
    describe: (vol, ig) => `Volume ${vol} of 103 of the Derge Kangyur (sde dge bka' 'gyur), the canonical Tibetan collection of the Buddha's word translated from Indian languages. Scans: BDRC W4CZ5369 (the Library of Congress copy of the Derge blocks), image group ${ig}. Page text: the Esukhia digital Derge Kangyur (public domain), which transcribes this copy, aligned folio by folio to the scan.`,
    // The image groups of W4CZ5369 are not sequential (I1KG9127…); the importer resolves them from
    // BDRC's instanceHasVolume list by each manifest's own "volume N" label.
    imageGroupFor: null,
    // Esukhia README: the e-text follows W22084's volume order, and "in W4CZ5369 … vol. 102 was
    // swapped with vol. 100".
    scanVolumeFor: (vol) => ({ 100: 102, 102: 100 })[vol] ?? vol,
    eighty4000: true,
    // Measured on vol. 1 (2026-10-02): W4CZ5369's canvas labels run one side off the leaves they show
    // (canvas "32b" carries side 32a: three reads located at side index = canvas index, identity
    // 0.47/0.33/0.93 against controls ≤ 0.27, and ~0.1 at the labelled side). So the claim is by
    // canvas INDEX with a per-volume measured offset, never by label; and the reader's page label
    // comes from the e-text side. The LoC copy is printed in RED ink: at 1600 px Yigdzin read 0–17
    // syllables a page; the full-size green channel, contrast-stretched, reads ~380.
    claimMode: 'index', readSize: 'max', redInk: true,
  }),
});

/** Section and volume letter from an Esukhia file name: "001_འདུལ་བ།_ཀ.txt" → ['འདུལ་བ།', 'ཀ']. */
export function volumeFileParts(file) {
  const [, section, letter] = String(file).replace(/\.txt$/, '').split('_');
  return [section, letter || null];
}

/**
 * The Tohoku texts each side belongs to: the text still running from the previous side, plus every
 * text that opens on this one. Esukhia marks only where a text BEGINS ({D1}, then sub-texts {D1-1});
 * a side in the middle of a text carries no marker of its own.
 * @returns {string[][]} per side, in order
 */
export function sideTexts(pages) {
  let running = null;
  return pages.map((p) => {
    const here = running ? [running] : [];
    for (const t of p.tohoku) if (!here.includes(t)) here.push(t);
    if (p.tohoku.length) running = p.tohoku[p.tohoku.length - 1];
    return here;
  });
}

/**
 * Parse the 84000 Reading Room catalogue (https://read.84000.co/section/lobby.json, a Next.js page
 * whose records sit in `self.__next_f.push` chunks) → Map 'toh1-1' → { status, pages }.
 * The parsing is the gap map's (scripts/catalog-coverage/canon-gap-map.mjs read84000), kept here
 * per record because the importer needs each text's status, not the totals.
 */
export function parse84000Lobby(html) {
  const chunks = [...String(html).matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => JSON.parse(`"${m[1]}"`)).join('');
  const recs = new Map();
  for (const m of chunks.matchAll(/\{"toh":"(toh[^"]+)","title":[\s\S]*?"num_pages":(\d+|null),[\s\S]*?"publication_status":"([^"]+)"/g)) {
    recs.set(m[1], { pages: m[2] === 'null' ? 0 : Number(m[2]), status: m[3] });
  }
  return recs;
}

/**
 * 84000's status for an Esukhia Tohoku id. 'D1-1' → 'toh1-1'; a sub-text 84000 does not list on its
 * own falls back to its parent ('D1-1' → 'toh1'). null when 84000 lists neither.
 */
export function status84000(dId, recs) {
  const toh = `toh${String(dId).replace(/^D/, '')}`;
  if (recs.has(toh)) return recs.get(toh).status;
  const parent = toh.replace(/-.*$/, '');
  return recs.has(parent) ? recs.get(parent).status : null;
}

/**
 * A side is left for 84000 when every text on it is Published or In Progress there. A parent id that
 * 84000 lists only through its sub-texts (Esukhia opens vol. 1 with {D1}{D1-1}; 84000 has toh1-1…
 * but no toh1) is a container, not a text, and does not count either way.
 */
export const LEAVE_TO_84000 = Object.freeze(['Published', 'In Progress']);
const parentsOf = new WeakMap();
export function sideLeftTo84000(texts, recs) {
  if (!parentsOf.has(recs)) parentsOf.set(recs, new Set([...recs.keys()].filter((k) => k.includes('-')).map((k) => k.replace(/-.*$/, ''))));
  const parents = parentsOf.get(recs);
  const isContainer = (t) => status84000(t, recs) == null && parents.has(`toh${String(t).replace(/^D/, '')}`);
  const real = texts.filter((t) => !isContainer(t));
  return real.length > 0 && real.every((t) => LEAVE_TO_84000.includes(status84000(t, recs)));
}
