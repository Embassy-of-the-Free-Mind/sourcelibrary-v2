#!/usr/bin/env node
// #264 stage 2: turn located candidates + leaf-check verdicts into reference records (refs-lib.mjs writeRecord),
// and every drawn row a builder looked at into one coverage line (refs/coverage.jsonl), so a cell's coverage is
// counted from the rows tried, never from the rows that happened to work.
// PRIOR ART: scripts/eval/typed-refs-6012/eye-score.mjs (scores blind by-eye verdicts against machine claims, for
// #6012's book-level pairs; writes no record). This writes the §4.1 record per sealed frame row.
//   node scripts/eval/test-set-264/refs-write.mjs --source=kanripo --cands=FILE --leaf=DIR [--by="..."] [--at=ISO]
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, writeRecord, readFrame, REFS, wsNorm } from './refs-lib.mjs';
import { teiPages } from '../typed-refs-6012/lib.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const SOURCE = argOf('source');
const cands = readJsonl(argOf('cands')).filter((c) => !c.source || c.source === argOf('source'));
const LEAF = argOf('leaf');
const BY = argOf('by', 'claude-opus-5-5 subagents reading the page image (1100 px) against the reference head and tail; blind, 1 in 5 packets a planted neighbour leaf');
const AT = argOf('at', new Date().toISOString().slice(0, 10));
const frame = new Map(readFrame().map((r) => [r.row, r]));

// Per-source: licence, canonical rule, normalisation, error floor. Normalisation keeps every character the source
// typed and removes only its markup (eval-design §4: the raw text is kept beside it).
const SOURCES = {
  kanripo: {
    source: 'kanripo',
    licence: { licence: 'CC-BY-SA-4.0', holder: 'Kanripo project (kanripo GitHub organisation)', url: 'https://github.com/kanripo', note: 'stated on the organisation profile only; no repository carries its own licence (0/600, #5568)' },
    canonical: () => true, // Kanripo: canonical by source (cells.mjs canonicalFromSource), the Siku canon a model may recite
    memorization_risk: (c) => (/^KR1/.test(c.kr) ? 'high' : 'low'),
    norm: (raw) => raw.replace(/<[^>]*>/g, '').replace(/[¶\n\r\/()（）\s　]/g, '').normalize('NFC'),
    unit: { kind: 'page' },
    alignment: (c) => ({ method: `kanripo <pb> half-leaf located by char-bigram Dice of our stored reading (${c.loc.rule}; Dice ${c.loc.dice ?? 'n/a'}, runner-up ${c.loc.second ?? 'n/a'}); the reading only locates, the text is Kanripo's`, window_chars: null, overlap: c.loc.dice, guard: 'Dice >= 0.6 (all-juan search: and >= 0.15 over the runner-up)' }),
    revision: (c) => ({ commit: c.witness_sha, branch: 'WYG', fetched: '2026-11-13' }),
    url: (c) => c.source_url,
    unit_id: (c) => c.pb,
    edition: (c, ok) => ok
      ? { match: 'same-edition', evidence: 'Kanripo WYG transcribes the Wenyuange Siku Quanshu manuscript (#5568); the page image opens and ends where this <pb> half-leaf does' }
      : { match: 'same-work-other-edition', evidence: 'the page breaks of this scan do not fall on Kanripo WYG\'s <pb>: another Siku copy or a re-bound volume; not a leaf-level reference' },
    reference_error_rate: { per_1000_keying: 1.69, ci: [0.44, 3.15], per_1000_editorial: 6.11, n_pages: 30, by: '#6552 (2026-11-04-human-error-zh-6552.md)', at: '2026-11-04' },
  },
  dta: teiSource({
    source: 'dta',
    licence: (c) => ({ licence: /by-sa\/4\.0/.test(c.licence_target || '') ? 'CC-BY-SA-4.0' : (c.licence_target || 'unknown'), holder: 'Deutsches Textarchiv, Berlin-Brandenburgische Akademie der Wissenschaften', url: c.licence_target, note: 'licence as stated in the work\'s own TEI header <licence target>' }),
    edition: (c) => `DTA transcribes the copy ${c.edition_note || '(holding not stated)'}; #6012 aligned our scan to it page for page (same <pb> breaks, overlap ${c.loc?.overlap})`,
    revision: () => ({ release: 'dta_komplett 2026-02-10 (#6012 manifest); this page fetched from download_xml', fetched: '2026-11-13' }),
    reference_error_rate: null, // DTA publishes double-keying at 99.95% per character as its target; not measured on our pages
    error_note: 'not measured on our pages; DTA states a double-keying accuracy target of 99.95% per character',
    ocr_conventions: 'DTA keys long s (ſ) and superscript e (U+0364) as printed',
  }),
  'eebo-tcp': teiSource({
    source: 'eebo-tcp',
    licence: () => ({ licence: 'CC0-1.0', holder: 'Text Creation Partnership (EEBO-TCP Phase I; co-owned by its funding institutions)', url: 'https://creativecommons.org/publicdomain/zero/1.0/', note: 'Phase I text; licence as stated in the TEI header <availability>' }),
    edition: (c) => `EEBO-TCP keyed this text from the same microfilm (Wing/ESTC number of the Internet Archive microfilm scan = the TCP record, #6012); page located by its offset from the stretch #6012 aligned, confirmed by eye`,
    revision: () => ({ commit: 'github.com/textcreationpartnership master', fetched: '2026-11-13' }),
    reference_error_rate: null,
    error_note: 'not measured on our pages; TCP states a keying accuracy target of 1 error per 20,000 characters',
    ocr_conventions: 'TCP keys long s as s and marks illegible characters as <gap> (◊ here); a scorer must fold ſ→s on the engine side',
  }),
  wikisource: {
    source: 'wikisource', licence: null,
    licenceOf: (c) => ({ licence: 'CC-BY-SA-4.0', holder: `${c.host} contributors (page history of ${c.ws_page})`, url: 'https://creativecommons.org/licenses/by-sa/4.0/', note: 'Wikisource transcriptions are CC BY-SA 4.0 (the printed text itself is public domain)' }),
    canonical: () => false, memorization_risk: () => 'low', // stage 1 rule (cells.mjs canonicalFromSource): canonical by source; Wikisource is not one of them
    norm: (raw) => wsNorm(raw),
    unit: { kind: 'page' },
    alignment: (c) => ({ method: `Wikisource Page ${c.ws_page} (proofread level ${c.quality}); located by a phrase read on our page image, edition from the index metadata`, window_chars: null, overlap: null, guard: 'proofread level >= 3 and the page opens and closes where our image does' }),
    revision: (c) => ({ oldid: c.revid, timestamp: c.rev_ts, fetched: '2026-11-13' }),
    url: (c) => c.source_url, unit_id: (c) => c.ws_page,
    edition: (c, ok) => ok ? { match: 'same-edition', evidence: c.edition_note } : { match: 'unknown', evidence: 'leaf check did not confirm the page' },
    reference_error_rate: null, error_note: 'not measured for these pages; the pinned Wikisource set measured drift ~0.01% of characters (reference-error-rate.mjs, 2026-09-05), not keying error',
    conventions: 'Wikisource modernises typography by community convention (curly apostrophe, long s as s, ligatures expanded); a scorer folds these on both sides',
    normVersion: 'wikisource-clean-v1', normRule: 'wikitext → text with lib/wikisource-text.mjs cleanPageText() after resolving {{tiret}} (page-foot half + hyphen), {{tiret2}} (page-head half) and {{Corr}} (the printed reading, unless the transcriber marked it unreadable); header/footer noinclude out, footnote <ref> out',
  },
  // Coverage only: the Greek rows refs-greek.mjs screened out (other edition, other witness, no e-text) under one name.
  'greek-tei': { source: 'greek-tei' },
  // Coverage only: the last cells' rows refs-screen.mjs screened (Hebrew, Arabic, Cyrillic, Indic, Sanskrit, Tibetan).
  screen: { source: 'screen' },
  // he.wikisource: Dan Be'eri's Kaufmann-vocalised Mishnah, the text our born-digital PDF scan was typeset from.
  'he-wikisource': {
    source: 'he-wikisource', licence: null,
    licenceOf: (c) => ({ licence: 'CC-BY-SA-3.0', holder: `Dan Be'eri (edition) and ${c.host} contributors (page history of ${c.ws_page})`, url: 'https://creativecommons.org/licenses/by-sa/3.0/', note: 'licence of the PDF as stated on Commons (File:Mishna corrected Kaufman 00 WHOLE.pdf); the Wikisource text is CC BY-SA' }),
    canonical: () => true, memorization_risk: () => 'high', // the Mishnah: a text a model may recite
    // Keep every code point as typed (no NFC: it would reorder Hebrew points); expand the template's chapter-local
    // "משנה N" label into the heading the PDF prints, drop trailing spaces.
    norm: (raw) => raw.split('\n').map((l) => l.replace(/\s+$/u, '').replace(/^משנה (\S+)$/u, `מסכת יבמות פרק ד משנה $1`)).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    unit: { kind: 'page' },
    alignment: (c) => ({ method: `${c.ws_page} (revision ${c.revid}, ${c.rev_ts}); ${c.loc.rule}`, window_chars: null, overlap: null, guard: 'the revision precedes the PDF (2016-09-04 < 2017-02-20); the leaf check compares the pointing word by word on two crops' }),
    revision: (c) => ({ oldid: c.revid, timestamp: c.rev_ts, fetched: '2026-11-14' }),
    url: (c) => c.source_url, unit_id: (c) => `${c.ws_page} (Yevamot 4:4 end – 4:8 heading)`,
    edition: (c, ok) => ok ? { match: 'same-edition', evidence: c.edition_note } : { match: 'unknown', evidence: 'leaf check did not confirm the page' },
    reference_error_rate: null, error_note: 'not measured; the PDF was typeset from this text, so a keying error in it is printed on the page too (the reference can only drift by later wiki edits, excluded by pinning the earlier revision)',
    conventions: 'the PDF prints the template\'s headings "מסכת יבמות פרק ד משנה N" and the Albeck-style halakha letters; editorial notes in <…!> on the wiki page are not on this page',
    normVersion: 'he-wikisource-mishnah-v1', normRule: 'wikitext of the tractate page cut at the page\'s first line and last heading; "משנה N" expanded to the printed heading; trailing spaces out; no Unicode normalisation (Hebrew points kept in typed order)',
  },
  perseus: greekSource({ source: 'perseus', holder: 'Perseus Digital Library, Tufts University (canonical-greekLit)', risk: 'high' }),
  first1k: greekSource({ source: 'first1k', holder: 'Open Greek and Latin / First Thousand Years of Greek (Leipzig, Tufts, Harvard CHS)', risk: 'medium' }),
};

// Greek TEI (refs-greek.mjs): the <pb> page of the edition our scan is, cut with teiPages() after the other editions'
// page breaks (ed="alt", Paris 1624) are taken out. These editions print a translation column, an apparatus or
// footnotes the corpora did not key, so the record says what of the image the text covers (unit.covers/excludes).
function greekSource(o) {
  return {
    source: o.source, licence: null,
    licenceOf: (c) => ({ licence: /by-sa\/4\.0/.test(c.licence_target || '') ? 'CC-BY-SA-4.0' : (c.licence_target || 'unknown'), holder: o.holder, url: c.licence_target, note: 'licence as stated in the file\'s own TEI header <licence target>' }),
    canonical: () => true, // canonical by source (cells.mjs canonicalFromSource): Perseus and First1K texts a model may recite
    memorization_risk: () => o.risk,
    norm: (raw) => teiPages(raw).map((p) => [p.text, ...p.notes].filter(Boolean).join('\n')).filter(Boolean).join('\n'),
    unitOf: (c) => ({ kind: 'page', covers: c.covers, excludes: c.excludes }),
    alignment: (c) => ({ method: `${c.loc.rule} (score ${c.loc.score}, runner-up ${c.loc.second}); our reading only locates, the text and its page edges are the TEI's own <pb>`, window_chars: null, overlap: c.loc.score, guard: 'containment >= 0.5 and >= 0.2 over the runner-up; the leaf check confirms head and tail on the image' }),
    revision: (c) => ({ commit: c.commit, fetched: '2026-11-14' }),
    url: (c) => c.source_url, unit_id: (c) => `${c.file} pb ${c.pb}`,
    edition: (c, ok) => ok ? { match: 'same-edition', evidence: `${c.edition_note}; TEI <sourceDesc> read against our scan's title and imprint, and the TEI <pb> falls where our page does` } : { match: 'unknown', evidence: 'leaf check did not confirm the page' },
    reference_error_rate: null, error_note: 'not measured on our pages; keyed, or OCR corrected, by a human vendor before 2024 (made_by.by quotes the TEI header)',
    conventions: 'Perseus and First1K key a word broken across two pages whole on the first page (our image prints only its first half there, or only its second half at the head of the next); typographic apostrophe varies (ʼ, ’); editorial gaps as ◊',
    made_by: (c) => ({ kind: 'human', by: c.resp || `${o.source} keyers (the source's own transcription)` }),
    normVersion: `${o.source}-tei-pages-v1`, normRule: 'typed-refs-6012/lib.mjs teiPages() on the <pb> page after removing other editions\' page breaks (ed="alt", n="paris.*"); markup out, notes after the body; every typed character kept, no variant folding (a scorer folds)',
  };
}

// TEI sources (DTA, EEBO-TCP): candidates from refs-tei.mjs. The scorer text is teiPages() of the page's own TEI
// (forme work out: running head, signature, catchword; editorial <corr>/<reg>/<expan> out, the printed <sic>/<orig>
// kept; notes after the body because the encoding anchors them where the page does not print them).
function teiSource(o) {
  return {
    source: o.source, licence: null, licenceOf: o.licence,
    canonical: () => false, memorization_risk: () => 'low',
    norm: (raw) => teiPages(raw).map((p) => [p.text, ...p.notes].filter(Boolean).join('\n')).filter(Boolean).join('\n'),
    unit: { kind: 'page' },
    alignment: (c) => ({ method: c.loc.rule === '6012-aligned' ? `#6012 kgram-vote-v2 alignment of our stored reading to the TEI <pb> (vote share ${c.loc.vote_share}, edges ${c.loc.edges})` : `#6012 same-edition pair; <pb> at the same offset from our page ${c.loc.from_page} = pb ${c.loc.from_pb}`, window_chars: null, overlap: c.loc.overlap ?? null, guard: 'congruent page breaks (start and end on the TEI page) or the offset confirmed by the leaf check' }),
    revision: o.revision, url: (c) => c.source_url, unit_id: (c) => `${c.source_id} pb ${c.pb} ${c.facs}`,
    edition: (c, ok) => ok ? { match: 'same-edition', evidence: o.edition(c) } : { match: 'unknown', evidence: 'leaf check did not confirm the page' },
    reference_error_rate: o.reference_error_rate, error_note: o.error_note, conventions: o.ocr_conventions,
  };
}
const S = SOURCES[SOURCE];
if (!S) throw new Error(`unknown --source ${SOURCE}`);

const verdicts = new Map();
if (LEAF) {
  const key = new Map(readJsonl(path.join(LEAF, 'key.jsonl')).map((k) => [k.pid, k]));
  for (const v of readJsonl(path.join(LEAF, 'verdicts.jsonl'))) { const k = key.get(v.pid); if (k && !k.control) verdicts.set(k.row, v); }
}
const STATUS = { same: 'ok', shifted: 'shifted', different: 'shifted', 'cannot-tell': 'unchecked' };
const coverage = readJsonl(path.join(REFS, 'coverage.jsonl')).filter((c) => c.source !== SOURCE);
let written = 0, accepted = 0;
for (const c of cands) {
  const r = frame.get(c.row);
  if (!r) throw new Error(`candidate ${c.row} is not a frame row`);
  if (c.outcome !== 'located') { coverage.push({ row: c.row, frame_cell: r.frame_cell, source: SOURCE, outcome: c.outcome, why: c.why }); continue; }
  const v = verdicts.get(c.row);
  const status = v ? STATUS[v.verdict] : 'unchecked';
  const raw = c.raw;
  const rec = writeRecord({
    row: c.row, frame_cell: r.frame_cell, book_id: r.book_id, page_id: r.page_id, page_number: r.page_number, reserve: r.reserve,
    image_sha256: r.image?.sha256 ?? null,
    slug: `ts264-${c.row.slice(6)}-${SOURCE}`, source: S.source, source_url: S.url(c), source_unit: S.unit_id(c), source_revision: S.revision(c),
    licence: S.licenceOf ? S.licenceOf(c) : S.licence, unit: { ...(S.unitOf ? S.unitOf(c) : S.unit), chars: [...S.norm(raw)].length }, alignment: S.alignment(c),
    leaf_check: { status, by: v ? BY : null, at: v ? AT : null, note: v ? `${v.verdict}: seen "${v.head_seen}" … "${v.tail_seen}"; ${v.note || ''}`.slice(0, 400) : 'not checked' },
    edition: S.edition(c, status === 'ok'),
    canonical: S.canonical(c), memorization_risk: S.memorization_risk(c),
    made_by: S.made_by ? S.made_by(c) : { kind: 'human', by: `${S.source} typists (the source's own transcription)` }, own_output: false,
    reference_error_rate: S.reference_error_rate, ...(S.error_note ? { reference_error_note: S.error_note } : {}),
    normalisation: S.normVersion
      ? { version: S.normVersion, rule: S.normRule, conventions: S.conventions }
      : S.licenceOf
      ? { version: `${SOURCE}-tei-pages-v1`, rule: 'typed-refs-6012/lib.mjs teiPages(): forme work (running head, signature, catchword, page number) and editorial additions (corr, reg, expan, supplied) out, the printed sic/orig/abbr kept, notes after the body; every typed character kept, no variant folding (a scorer folds)', conventions: S.conventions }
      : { version: `${SOURCE}-norm-v1`, rule: 'source markup removed (tags, line and column marks, interlinear-note brackets); every typed character kept, no variant folding (a scorer folds)' },
  }, raw, S.norm(raw));
  written++; if (rec.accepted) accepted++;
  coverage.push({ row: c.row, frame_cell: r.frame_cell, source: SOURCE, outcome: rec.accepted ? 'accepted' : `rejected:${status}`, why: rec.accepted ? null : rec.leaf_check.note.slice(0, 160) });
}
coverage.sort((a, b) => (a.frame_cell + a.row).localeCompare(b.frame_cell + b.row));
fs.writeFileSync(path.join(REFS, 'coverage.jsonl'), coverage.map((c) => JSON.stringify(c)).join('\n') + '\n');
console.log(`${SOURCE}: ${written} records written, ${accepted} accepted; coverage lines ${coverage.filter((c) => c.source === SOURCE).length}`);
