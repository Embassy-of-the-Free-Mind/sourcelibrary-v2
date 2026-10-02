/**
 * PRIOR ART: scripts/eval/results/note-facts-full-2026-10-02-5624/raw/candidate-filter.py (PR #5640)
 * — the #5624 cue filter, ported here verbatim so the lane picks the same notes the fact-check
 * judged; it only listed candidates and never typed or matched a claim.
 * scripts/lib/translit-skeleton.mjs `skeletonMatch` — reused (not rebuilt) to ask "is this
 * romanised name on this Tibetan/Greek page"; it has no glossary. scripts/lib/translation-text-repair.mjs
 * — the repair door the lane's stage-4 edits will go through; it extracts nothing.
 * `git grep -il glossary` found no Tibetan↔Sanskrit table in the repo (the 84000 TEI lives only
 * on the Hetzner box under /root/tibetan-reocr, CC BY-NC-ND), and no claim store.
 *
 * Translation-note fact-check lane, stages 1–2 (#5647). Pure functions only: no database, no
 * network, no files. The scripts that use them:
 *   scripts/maintenance/build-tib-skt-table.mjs   reference table (kept on the box, out of git)
 *   scripts/maintenance/note-claims-extract.mjs   stage 1: notes → `note_claims` rows
 *   scripts/maintenance/note-claims-match.mjs     stage 2: rows → match / conflict / no-entry
 *   scripts/eval/note-claims-validate-5647.mjs    agreement with the 359 #5624 verdicts
 *
 * The lane removes errors; it never certifies. `match` means "a reference table agrees", not
 * "verified": there is no public badge, and stage 2 writes nothing outside `note_claims`.
 */
import { skeletonMatch } from './translit-skeleton.mjs';
import { stripMarkupTags } from './strip-markup-tags.mjs';
import { contentHash } from './write-provenance.mjs';

// Bump `version` when parsing changes: the extractor re-extracts every row made by another version.
export const EXTRACTOR = { name: 'note-claims-extract', version: 3, cue_filter: '5624-v1' };
export const MATCHER = { name: 'note-claims-match', version: 1 };

// ---------------------------------------------------------------------------------------------
// Stage 1 — the #5624 cue filter (raw/candidate-filter.py, verbatim)

export const CUE = /(century|\b1[0-9]{3}\b|founder|founded|author|composed|disciple|teacher|student of|king|emperor|monastery|identified|refers to|known as|i\.e\.|is the|was a|lineage|tradition of|translated by|translator|attributed|Tibetan name|Sanskrit|father|mother|son of|born)/;
const CAPITALISED = /[A-Z][a-zāīūṛṣśṇḍṭñ]+/;

/**
 * Every <note> on the page, with the #5624 candidate decision. `index` is the note's ordinal
 * among ALL notes on the page, so it is stable whatever the filter decides.
 */
export function pageNotes(text) {
  const out = [];
  const re = /<note>([\s\S]*?)<\/note>/g;
  let m;
  let index = 0;
  while ((m = re.exec(String(text || '')))) {
    const note = m[1].trim();
    const candidate = !note.toLowerCase().startsWith('original')
      && note.length >= 40
      && CUE.test(note)
      && CAPITALISED.test(note.slice(1));
    out.push({ index, offset: m.index, note, candidate });
    index++;
  }
  return out;
}

/** The ≤80 characters of running text before the note — what the note glosses. */
export function noteAnchor(text, offset) {
  const before = String(text || '').slice(Math.max(0, offset - 400), offset);
  return stripMarkupTags(before.replace(/<(note|gloss|term|margin)>[\s\S]*?<\/\1>/g, ' ')).replace(/\s+/g, ' ').trim().slice(-80);
}

// ---------------------------------------------------------------------------------------------
// Claim typing

const DESCRIPTION = /\b(dhara[nṇ][iī]s?|mantras?|transliterat\w*|phonetic\w*|seed syllables?|syllables|invocations?|incantations?)\b/i;
const KIND_TESTS = [
  ['date', /\b(1[0-9]{3}|[0-9]{1,2}(st|nd|rd|th)[- ]century|century|centuries)\b/i],
  ['attribution', /\b(author|composed|translated by|translator|attributed|founded|founder|written by|compiled)\b/i],
  ['identification', /\b(refers? to|referring to|identified|known as|i\.e\.|is the|was a|disciple|teacher|student of|father|mother|son of|born|king|emperor|incarnation|lineage|personal name|another name|epithet|title for|name of|name for)\b/i],
  ['place', /\b(monastery|kingdom|region|city|mountain|river|located)\b/i],
];
const PRIORITY = ['sanskrit-equivalent', 'attribution', 'date', 'identification', 'place', 'other', 'description'];

// Words that follow "Sanskrit" when the note is describing, not naming.
const NOT_A_TERM = /^(dharani|dhāraṇī|mantra|passage|syllable|verse|invocation|term|terms|text|style|alphabet|name|word|words|phrase|phonetics|transliteration|original|title|language|grammar|form|equivalent|letters?|script|sound|is|was|for|of|in|and|or|as|the|a|an|this|these|that|likely|probably|possibly|perhaps|here|meaning|literally|which|it|its)\b/i;
// "A or B", "A/B" offer one referent two ways (alternatives); "A and B", "A, B", "A; B" are
// separate claims. The errors #5624 found were mostly in the first shape.
const GROUP_SPLIT = /\s*,\s*|\s+and\s+|\s*;\s*/;
const ALT_SPLIT = /\s+or\s+|\s*\/\s*/;

function cleanTerm(s) {
  return String(s || '').replace(/[*"“”‘’'`«»()[\]]/g, (c) => (c === '’' || c === "'" ? "'" : ' '))
    .replace(/\s+/g, ' ').trim().replace(/[.:,;]+$/, '').trim();
}

/**
 * The Sanskrit forms a note asserts ("Sanskrit: X", "Skt. X or Y"), as groups: each group is
 * one claim, its members the alternatives offered for it.
 */
export function parseSanskritGroups(note) {
  const groups = [];
  const re = /\b(?:Sanskrit|Skt\.?)(\s*(?::|=|-|—)\s*|\s+)([^;.()]*(?:\.[^\s;][^;.()]*)*)/g;
  let m;
  while ((m = re.exec(note))) {
    const hasColon = /[:=\-—]/.test(m[1]);
    const body = m[2].trim();
    if (!body) continue;
    let stop = false;
    for (const part of body.split(GROUP_SPLIT)) {
      const alts = [];
      for (const raw of part.split(ALT_SPLIT)) {
        const t = cleanTerm(raw);
        if (!t || t.length < 3) continue;
        if (NOT_A_TERM.test(t)) { if (!hasColon) stop = true; break; }
        if (t.split(' ').length > 6) continue;
        if (!hasColon && !/^[A-ZĀĪŪṚṢŚṆḌṬÑ]/.test(t)) { stop = true; break; } // "Sanskrit dharani for …" describes
        alts.push(t);
      }
      if (alts.length) groups.push([...new Set(alts)]);
      if (stop) break;
    }
  }
  return groups;
}

/** Flat list of every Sanskrit form the note asserts. */
export function parseSanskrit(note) {
  return [...new Set(parseSanskritGroups(note).flat())];
}

/** The Tibetan (Wylie) form a note quotes, or null. */
export function parseWylie(note) {
  const pats = [
    /\bTibetan(?: name)?\s*:\s*\*?([^;*(),]+?)\*?\s*(?:[;,()]|$)/,
    /\bterm\s*:\s*"([^"]+)"/,
    /\btransliteration\s*:\s*"([^",]+)/,
    /\bWylie\s*:\s*\*?([^;*()]+?)\*?\s*(?:;|\(|$)/,
  ];
  for (const re of pats) {
    const m = note.match(re);
    if (m) {
      const w = cleanTerm(m[1]);
      if (w && /^[A-Za-z' -]+$/.test(w) && w.length >= 2) return w;
    }
  }
  return null;
}

/** Type one candidate note. One row per note; `claim_kind` is the most checkable kind. */
export function typeNote(note) {
  const sanskrit = parseSanskrit(note);
  const wylie = parseWylie(note);
  const kinds = [];
  if (sanskrit.length) kinds.push('sanskrit-equivalent');
  for (const [k, re] of KIND_TESTS) if (re.test(note)) kinds.push(k);
  if (!kinds.length) kinds.push(DESCRIPTION.test(note) ? 'description' : 'other');
  else if (kinds.length === 1 && kinds[0] === 'identification' && DESCRIPTION.test(note) && !CAPITALISED.test(note.replace(/\b(Sanskrit|Tibetan|Buddha|Om|OM)\b/g, '').slice(1))) kinds.splice(0, 1, 'description');
  kinds.sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
  const years = [...note.matchAll(/\b(1[0-9]{3})\b/g)].map((x) => Number(x[1]));
  return { claim_kind: kinds[0], kinds, sanskrit, sanskrit_groups: parseSanskritGroups(note), wylie, years };
}

// ---------------------------------------------------------------------------------------------
// Page-content claims: names in <summary>, <keywords> and markdown headings (#5632 A09/A14)

const SENTENCE_STOP = new Set(('The This These Those That It Its He She They His Her Their A An In On At As After Before When While Here There Then Thus '
  + 'Page Chapter Book Volume Part Section Text Folio Continuation Continues Continued Describes Discusses Explains Lists Concludes Introduces '
  + 'Begins Ends Contains Presents Provides Includes Details Outlines Records Narrates Recounts Teaches Instructions Verses Prose Colophon '
  + 'Further Furthermore Also Finally First Second Third One Two Three Title Index Table Notes Note English Tibetan Sanskrit Chinese Latin Greek '
  + 'Buddhist Buddhism Dharma Sutra Sūtra Tantra Lord Blessed Venerable Great Noble Holy King Queen God Gods Goddess Buddha Buddhas Bodhisattva Bodhisattvas').split(' '));

function properSpans(text) {
  const spans = [];
  const sentences = String(text || '').split(/(?<=[.!?:])\s+/);
  for (const s of sentences) {
    const re = /[A-ZĀĪŪṚṢŚṆḌṬÑ][\p{L}'’-]+(?:\s+(?:of\s+|de\s+|von\s+)?[A-ZĀĪŪṚṢŚṆḌṬÑ][\p{L}'’-]+)*/gu;
    let m;
    while ((m = re.exec(s))) {
      let span = m[0];
      const words = span.split(/\s+/);
      if (m.index === 0 && words.length === 1) continue; // sentence-initial single word: unknowable
      while (words.length && SENTENCE_STOP.has(words[0])) words.shift();
      while (words.length && SENTENCE_STOP.has(words[words.length - 1])) words.pop();
      if (!words.length) continue;
      span = words.join(' ');
      if (span.replace(/[^\p{L}]/gu, '').length < 4) continue;
      spans.push(span);
    }
  }
  return [...new Set(spans)];
}

/** Names asserted by the page-level apparatus. Rows: { source_tag, name, kind }. */
export function pageContentClaims(text) {
  const t = String(text || '');
  const out = [];
  for (const m of t.matchAll(/<summary>([\s\S]*?)<\/summary>/g)) {
    for (const name of properSpans(m[1])) out.push({ source_tag: 'summary', name, kind: 'page-name' });
  }
  for (const m of t.matchAll(/<keywords>([\s\S]*?)<\/keywords>/g)) {
    for (const k of m[1].split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
      if (!/^[A-ZĀĪŪṚṢŚṆḌṬÑ]/.test(k) || SENTENCE_STOP.has(k) || k.replace(/[^\p{L}]/gu, '').length < 4) continue;
      out.push({ source_tag: 'keywords', name: k, kind: 'page-name' });
    }
  }
  for (const m of t.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const h = stripMarkupTags(m[1]);
    for (const name of properSpans(h)) out.push({ source_tag: 'heading', name, kind: 'page-name' });
    for (const n of h.matchAll(/\b([0-9]{2,4})\b/g)) out.push({ source_tag: 'heading', name: n[1], kind: 'page-number' });
  }
  const seen = new Set();
  return out.filter((r) => { const k = `${r.source_tag}|${r.kind}|${r.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The translation's running text: tags with their content removed for apparatus, kept for inline. */
export function translationBody(text) {
  return stripMarkupTags(String(text || '')
    .replace(/<(note|summary|keywords|meta|warning|vocab|detected-images|image-desc)>[\s\S]*?<\/\1>/g, ' ')
    .replace(/^#{1,6}\s+.*$/gm, ' '));
}

// ---------------------------------------------------------------------------------------------
// Keys for comparison only — never stored as a display value (non-latin-text-operations.md)

export function stripMarks(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
}

/** Wylie lookup key: lowercase, one apostrophe, hyphens as syllable breaks, no shad. */
export function wylieKey(s) {
  return String(s || '').toLowerCase().replace(/[’‘`ʼ]/g, "'").replace(/[*"“”]/g, '')
    .replace(/[-‐‑–—_]+/g, ' ').replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
}
const FINAL_PARTICLE = /\s(pa|po|ba|bo|ma|mo)$/;
/** Looser Wylie key: drops a final nominal particle ("blo gros brtan pa" → "blo gros brtan"). */
export function wylieStem(s) {
  const k = wylieKey(s);
  return k.split(' ').length > 1 ? k.replace(FINAL_PARTICLE, '') : k;
}

/**
 * Sanskrit comparison key: marks off, lowercase, no separators, the common English
 * romanisations folded onto IAST (sh/ṣ/ś → s, ch → c, ṛ/ri → r, w → v), final visarga and
 * nominative -m/-ḥ off. Applied to BOTH sides, so a lossy fold only ever widens a match.
 */
export function sktKey(s) {
  let k = stripMarks(s).toLowerCase().replace(/[^a-z]/g, '');
  k = k.replace(/sh/g, 's').replace(/ch/g, 'c').replace(/ri/g, 'r').replace(/w/g, 'v').replace(/(.)\1+/g, '$1');
  if (k.length > 4) k = k.replace(/[hm]$/, '');
  return k;
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length; const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Same Sanskrit word, allowing spelling variants and inflection — not a different referent. */
// "Yamadeva" names the god of the Yāma heaven; "Sukhāvatīloka" the realm itself.
const SUFFIX = /(deva|devi|loka|raja|raj|lokadhatu)$/;

export function sktSame(a, b) {
  const x = sktKey(a); const y = sktKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.replace(SUFFIX, ''); const ys = y.replace(SUFFIX, '');
  if ((xs !== x || ys !== y) && xs.length >= 3 && ys.length >= 3 && xs === ys) return true;
  const min = Math.min(x.length, y.length);
  if (min >= 5 && (x.startsWith(y) || y.startsWith(x)) && Math.abs(x.length - y.length) <= 2) return true;
  const tol = min >= 10 ? 2 : min >= 6 ? 1 : 0;
  return tol > 0 && lev(x, y) <= tol;
}

/** Group a list of Sanskrit forms into distinct referents. */
export function sktClusters(forms) {
  const clusters = [];
  for (const f of forms) {
    const c = clusters.find((cl) => cl.some((g) => sktSame(g, f)));
    if (c) c.push(f); else clusters.push([f]);
  }
  return clusters;
}

// ---------------------------------------------------------------------------------------------
// Reference table (built by build-tib-skt-table.mjs; rows { w, wylie, skt, type, src, licence, ref, att })

/** Sources whose disagreement may produce a `conflict`. Rangjung Yeshe glosses names in plain
 *  English-or-Sanskrit without marking which, so it can confirm a claim but never refute one. */
export const CONFLICT_SOURCES = new Set(['84000-tei', '84000-steinert', 'mahavyutpatti-dila']);

export function indexTable(rows) {
  const byW = new Map(); const byStem = new Map(); const bySkt = new Map();
  const push = (m, k, r) => { if (!k) return; let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(r); };
  for (const r of rows) {
    push(byW, wylieKey(r.wylie), r);
    push(byStem, wylieStem(r.wylie), r);
    push(bySkt, sktKey(r.skt), r);
  }
  return { byW, byStem, bySkt, size: rows.length };
}

function lookupWylie(table, w) {
  return table.byW.get(wylieKey(w)) || table.byStem.get(wylieStem(w)) || [];
}

/**
 * One claim group against the rows its Tibetan anchor resolves to.
 *   all alternatives in the table          → match (unless the name has two referents there)
 *   none, or one of an "A or B" pair, not  → conflict, if an authoritative source holds the anchor
 *   only Rangjung Yeshe holds the anchor   → no-entry (it can confirm, never refute)
 *   anchored through the page, not the note → never conflict (see below)
 */
function decideGroup(group, rows, anchorHow = 'note-tibetan') {
  const matched = group.filter((s) => rows.some((r) => sktSame(s, r.skt)));
  const authoritative = rows.filter((r) => CONFLICT_SOURCES.has(r.src));
  const clusters = sktClusters(authoritative.map((r) => r.skt));
  const named = rows.some((r) => r.type === 'person' || r.type === 'place');
  if (matched.length === group.length) {
    // A name the table gives two different referents for cannot be settled by the table.
    if (named && clusters.length > 1) return { status: 'no-entry', reason: 'ambiguous-name', matched, referents: clusters.length };
    return { status: 'match', reason: 'table-agrees', matched, referents: clusters.length };
  }
  if (!authoritative.length) return { status: 'no-entry', reason: 'match-only-source-disagrees', matched };
  // Anchored through the page by one alternative: the other may be a synonym written with
  // different Tibetan ("Indra/Shakra"), so only the note's own Tibetan can refute an alternative.
  if (anchorHow === 'page-tibetan') return { status: 'no-entry', reason: 'page-anchor-cannot-refute', matched };
  // A table that knows the Tibetan only as a NAME cannot refute a lowercase TERM reading
  // (chos 'byung: Dharmākara the bodhisattva vs dharmodaya, "source of phenomena").
  if (authoritative.every((r) => r.type === 'person' || r.type === 'place') && group.every((g) => /^[a-zāīūṛṣśṇḍṭñṃḥ]/.test(g))) {
    return { status: 'no-entry', reason: 'name-table-vs-term-claim', matched };
  }
  const authMissing = group.filter((s) => !authoritative.some((r) => sktSame(s, r.skt)));
  if (!authMissing.length) return { status: 'match', reason: 'table-agrees', matched, referents: clusters.length };
  return { status: 'conflict', reason: matched.length ? 'alternative-not-in-table' : 'table-disagrees', matched, missing: authMissing, referents: clusters.length };
}

/** A Tibetan form of one of `group`'s Sanskrit names that occurs on the page, or null. */
function pageAnchor(group, table, ocrText) {
  if (!ocrText) return null;
  for (const s of group) {
    const tried = new Set();
    for (const r of table.bySkt.get(sktKey(s)) || []) {
      const w = wylieKey(r.wylie);
      if (tried.has(w) || w.replace(/[^a-z]/g, '').length < 4) continue;
      tried.add(w);
      const hit = skeletonMatch(w, ocrText);
      if (hit.matched && hit.script === 'Tibetan') return { how: 'page-tibetan', wylie: r.wylie, via: s, tier: hit.tier };
    }
  }
  return null;
}

// Loanwords too generic to be what a gloss identifies a term AS.
const GENERIC = new Set(['dharma', 'dharmas', 'buddha', 'buddhas', 'bodhisattva', 'bodhisattvas', 'sangha', 'tathagata', 'arhat', 'sutra', 'sutras',
  'tantra', 'tantras', 'mantra', 'mantras', 'dharani', 'karma', 'nirvana', 'samsara', 'mahayana', 'vajra', 'yoga', 'yogi', 'deva', 'devas',
  'naga', 'nagas', 'yaksha', 'brahmin', 'brahman', 'brahma', 'guru', 'lama', 'dakini', 'shramana', 'bhikshu', 'bhikkhu', 'prajnaparamita']);

/**
 * Capitalised names in the note that the authoritative sources know as Sanskrit, grouped the
 * way the note offers them. These are IMPLICIT equivalence claims (term: "Me-skyes" … "referring
 * to Jivaka"), counted only when the note quotes the Tibetan it glosses: a name a note merely
 * mentions next to a page word is not a claim about that word (measured on the 359: "Indra/Shakra"
 * — two names of one god — and "Dharma or Sambhogakaya" both read as false conflicts). They may
 * produce a conflict, never a match.
 */
export function implicitSanskritGroups(note, table, explicit = []) {
  const known = (t) => {
    const k = sktKey(t);
    return k.length >= 5 && (table.bySkt.get(k) || []).some((r) => CONFLICT_SOURCES.has(r.src));
  };
  const skip = new Set(explicit.map(sktKey));
  const NAME = /[A-ZĀĪŪṚṢŚṆḌṬÑ][a-zāīūṛṣśṇḍṭñṃḥ]{3,}(?:[ -][A-ZĀĪŪṚṢŚṆḌṬÑ][a-zāīūṛṣśṇḍṭñṃḥ]{3,})?/g;
  const groups = [];
  for (const part of String(note || '').split(/[,;:.()]|\s+and\s+|\s+-\s+/)) {
    const alts = [];
    for (const piece of part.split(ALT_SPLIT)) {
      for (const m of piece.matchAll(NAME)) {
        const name = m[0];
        // "Jyotiṣka (not Jīvaka)" rejects the name; it does not claim it
        if (/\b(not|nor|rather than|instead of|unlike)\s+$/i.test(piece.slice(0, m.index))) continue;
        const cand = known(name) ? name : (name.includes(' ') && known(name.split(/[ -]/)[0]) ? name.split(/[ -]/)[0] : null);
        if (cand && !skip.has(sktKey(cand)) && !GENERIC.has(stripMarks(cand).toLowerCase().replace(/sh/g, 's'))) { alts.push(cand); break; }
      }
    }
    if (alts.length) groups.push([...new Set(alts)]);
  }
  return groups;
}

/**
 * Stage 2(a): a note's Sanskrit equivalences against the table. Each claim group is anchored to
 * a Tibetan form, in order of trust:
 *   1. the Tibetan the note itself quotes ("Tibetan: X", term: "X");
 *   2. a table Tibetan form of one of the group's names that occurs in the page OCR
 *      (skeletonMatch, ≥4 consonants);
 * and decided against every table row for that anchor. No anchor → no-entry.
 * Note status: any conflict → conflict; else every explicit group matched → match; else no-entry.
 */
export function matchSanskritClaim(claim, table, ocrText, note = '') {
  const explicit = claim.sanskrit_groups || (claim.sanskrit || []).map((s) => [s]);
  const noteRows = claim.wylie ? lookupWylie(table, claim.wylie) : [];
  const implicit = note && claim.wylie ? implicitSanskritGroups(note, table, explicit.flat()) : [];
  if (!explicit.length && !implicit.length) return { status: 'no-entry', reason: 'no-sanskrit-parsed' };
  const results = [];
  for (const [kind, groups] of [['explicit', explicit], ['implicit', implicit]]) {
    for (const group of groups) {
      let anchor = null; let rows = [];
      if (noteRows.length) { anchor = { how: 'note-tibetan', wylie: claim.wylie }; rows = noteRows; } else {
        anchor = pageAnchor(group, table, ocrText);
        if (anchor) rows = lookupWylie(table, anchor.wylie);
      }
      if (!anchor || !rows.length) { results.push({ kind, group, status: 'no-entry', reason: claim.wylie ? 'tibetan-not-in-table' : 'no-anchor-on-page' }); continue; }
      const d = decideGroup(group, rows, anchor.how);
      if (kind === 'implicit' && d.status === 'match') { d.status = 'no-entry'; d.reason = 'implicit-agrees'; }
      results.push({ kind, group, anchor, ...d, evidence: rows.slice(0, 12).map((r) => ({ src: r.src, wylie: r.wylie, skt: r.skt, type: r.type, ref: r.ref })) });
    }
  }
  const conflict = results.find((r) => r.status === 'conflict');
  const exp = results.filter((r) => r.kind === 'explicit');
  let status = 'no-entry';
  let lead = results.find((r) => r.status === 'no-entry' && r.reason !== 'implicit-agrees') || results[0];
  if (conflict) { status = 'conflict'; lead = conflict; } else if (exp.length && exp.every((r) => r.status === 'match')) { status = 'match'; lead = exp[0]; }
  return { status, reason: lead.reason, anchor: lead.anchor, evidence: lead.evidence || [], groups: results.map(({ evidence, ...r }) => r) };
}

// ---------------------------------------------------------------------------------------------
// Stage 2(b): page-content names against the page's own OCR

function fold(s) {
  return stripMarks(s).toLowerCase().replace(/[’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const CJK_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CJK_UNIT = { 十: 10, 百: 100, 千: 1000 };
/** Every number written on the page, Arabic or Chinese numerals (卷一百四十九 → 149). */
export function pageNumbers(text) {
  const nums = new Set();
  const t = String(text || '').replace(/[\u0F20-\u0F29]/g, (d) => String(d.codePointAt(0) - 0x0f20)); // Tibetan digits
  for (const m of t.matchAll(/[0-9]+/g)) nums.add(Number(m[0]));
  for (const m of t.matchAll(/[〇零一二两兩三四五六七八九十百千]+/g)) {
    let total = 0; let cur = 0; let digitsOnly = '';
    for (const ch of m[0]) {
      if (ch in CJK_DIGIT) { cur = CJK_DIGIT[ch]; digitsOnly += CJK_DIGIT[ch]; } else { total += (cur || 1) * CJK_UNIT[ch]; cur = 0; digitsOnly = null; }
    }
    nums.add(total + cur);
    if (digitsOnly && digitsOnly.length > 1) nums.add(Number(digitsOnly));
  }
  return nums;
}

/**
 * The OCR without its apparatus: an <image-desc> or <warning> is the reading model's own English
 * about the page, not the page, so a name found there (or English letters counted there) proves
 * nothing. Measured: the first stage-2 run's apparatus conflicts sat on diagram pages whose OCR
 * was mostly an English <image-desc>.
 */
export function ocrPageText(ocrText) {
  return stripMarkupTags(String(ocrText || '')
    .replace(/<(image-desc|warning|meta|scan-quality|language|script|page-type|detected-images|vocab|note|lang)\b[^>]*>[\s\S]*?<\/\1>/g, ' '));
}

/**
 * Is the page's OCR mostly in a script that writes a name the way the translation spells it
 * (Latin, Greek, Cyrillic)? Only there can a name's ABSENCE be evidence. Measured on the
 * Tibetan run (2026-10-02): 7,343 apparatus names "absent" from Tibetan pages, top of the list
 * Dzogchen, Vinaya, Padmasambhava, Perfection of Wisdom — names Tibetan writes as rdzogs chen,
 * 'dul ba, padma 'byung gnas, shes rab kyi pha rol tu phyin pa. Not errors.
 */
export function nameBearingScript(ocrText) {
  const t = stripMarkupTags(String(ocrText || ''));
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (!letters) return false;
  const named = (t.match(/[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/gu) || []).length;
  return named / letters >= 0.6;
}

/**
 * A name or number from <summary>/<keywords>/a heading against the page.
 *   match     the OCR has it (substring after folding, or the transliteration skeleton);
 *             or, where the OCR's script cannot be romanised (Han, Kana), the translation body has it
 *   conflict  the OCR is mostly Latin/Greek/Cyrillic, and neither it nor the translation body has it
 *   no-entry  too short to judge, no OCR, or the name is in the book's own title/author
 *             (a running head names the BOOK, which the page need not print)
 */
export function matchPageClaim(claim, ocrText, translationText, bookNames = []) {
  // The OCR of a diagram is the reading model's prose about it, not text the page prints.
  if (/<page-type>\s*(diagram|illustration|image|blank|cover)\s*<\/page-type>/i.test(String(ocrText || ''))) return { status: 'no-entry', reason: 'diagram-page' };
  const ocr = ocrPageText(ocrText);
  if (ocr.trim().length < 80) return { status: 'no-entry', reason: 'no-ocr' };
  if (claim.kind === 'page-number') {
    const n = Number(claim.name);
    const nums = pageNumbers(ocr.replace(/<page-num>[\s\S]*?<\/page-num>/g, ' '));
    if (nums.has(n)) return { status: 'match', reason: 'number-on-page' };
    if (!nums.size) return { status: 'no-entry', reason: 'no-numbers-on-page' };
    // Tibetan (and most scripts) spell a chapter number in words; only Latin/Greek/Cyrillic
    // numerals and Chinese numerals (parsed above) make a missing number evidence.
    const han = (ocr.match(/\p{Script=Han}/gu) || []).length / Math.max(1, (ocr.match(/\p{L}/gu) || []).length) >= 0.6;
    if (!han && !nameBearingScript(ocr)) return { status: 'no-entry', reason: 'ocr-script-not-number-bearing' };
    return { status: 'conflict', reason: 'number-not-on-page', page_numbers: [...nums].slice(0, 12) };
  }
  const name = claim.name;
  const f = fold(name);
  if (f.length < 4) return { status: 'no-entry', reason: 'too-short' };
  if (bookNames.some((b) => ` ${fold(b)} `.includes(` ${f} `))) return { status: 'no-entry', reason: 'book-title-name' };
  const fo = ` ${fold(ocr)} `;
  if (fo.includes(` ${f} `) || fo.includes(` ${f}`)) return { status: 'match', reason: 'ocr-latin' };
  const parts = f.split(' ').filter((w) => w.length >= 4);
  if (parts.length > 1 && parts.every((w) => fo.includes(` ${w}`))) return { status: 'match', reason: 'ocr-latin-words' };
  const sk = skeletonMatch(name, ocr);
  if (sk.matched) return { status: 'match', reason: `ocr-${sk.script}-${sk.tier}` };
  const body = ` ${fold(translationBody(translationText))} `;
  const inBody = body.includes(` ${f}`) || (parts.length > 1 && parts.every((w) => body.includes(` ${w}`)));
  if (inBody) return { status: 'match', reason: sk.uncovered ? 'body-ocr-uncovered' : 'body-only' };
  if (!nameBearingScript(ocr)) return { status: 'no-entry', reason: 'ocr-script-not-name-bearing' };
  return { status: 'conflict', reason: 'name-not-on-page' };
}

// ---------------------------------------------------------------------------------------------
// Row construction

/** The hash the claim rows are keyed to: the page's stamped one, else computed the same way. */
export function translationHash(translation) {
  return translation?.content_hash || contentHash(translation?.data || '');
}

/**
 * Stage-1 rows for one page. `page` carries { id, book_id, page_number, translation }.
 * Note rows use the #5624 candidate filter; page-content rows are every name/number in the
 * page apparatus.
 */
export function claimRowsForPage(page, now = new Date()) {
  const t = page.translation || {};
  const text = t.data || '';
  const hash = translationHash(t);
  const common = {
    page_id: page.id,
    book_id: page.book_id,
    page_number: page.page_number,
    translation_hash: hash,
    translation_model: t.model || null,
    translation_prompt_version: t.prompt_version || null,
    translated_at: t.updated_at || null,
    extractor: EXTRACTOR,
    extracted_at: now,
  };
  const rows = [];
  for (const n of pageNotes(text)) {
    if (!n.candidate) continue;
    const typed = typeNote(n.note);
    rows.push({
      _id: `${page.id}:note:${n.index}`,
      ...common,
      source_tag: 'note',
      note_index: n.index,
      note: n.note,
      anchor: noteAnchor(text, n.offset),
      claim_kind: typed.claim_kind,
      kinds: typed.kinds,
      claim: { sanskrit: typed.sanskrit, sanskrit_groups: typed.sanskrit_groups, wylie: typed.wylie, years: typed.years },
    });
  }
  pageContentClaims(text).forEach((c, i) => {
    rows.push({
      _id: `${page.id}:${c.source_tag}:${i}`,
      ...common,
      source_tag: c.source_tag,
      note: c.name,
      claim_kind: c.kind,
      kinds: [c.kind],
      claim: { name: c.name },
    });
  });
  return rows;
}

/** Stage 2 for one stored row. `bookNames`: the book's title, display/English title and author. */
export function matchRow(row, table, ocrText, translationText, bookNames = []) {
  if (row.source_tag === 'note') {
    const res = matchSanskritClaim(row.claim, table, ocrText, row.note);
    if (res.reason === 'no-sanskrit-parsed' && row.claim_kind !== 'sanskrit-equivalent') return { status: 'no-entry', reason: `kind-${row.claim_kind}-not-in-v1-tables` };
    return res;
  }
  return matchPageClaim({ kind: row.claim_kind, name: row.claim?.name ?? row.note }, ocrText, translationText, bookNames);
}
