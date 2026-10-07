// PRIOR ART: scripts/lib/derge-tengyur.mjs — parses the Esukhia volumes and already knows which
// Tohoku texts each SIDE belongs to (sideTexts); it stops at the side and attaches no catalogue
// facts. scripts/works-catalog/ingest-bdrc.mjs reads BDRC JSON-LD into the Supabase works catalog at
// the WORK level (WA → works row) and never sees the outline that places a text in a volume.
// scripts/lib/contents-works.mjs derives constituent works FROM chapters; this builds the chapters.
//
// tengyur-catalogue — pure helpers for the Derge Tengyur text lists (#6145, layer 1).
//
// Two independent inputs, joined on the Tohoku number:
//   1. OUR pages: the Esukhia text stored as `ocr.data` keeps `{D####}` where each text BEGINS, and
//      the importer copied the ids per side to `ocr.text_edition.tohoku`. That gives every text its
//      opening page in OUR page numbering — the page a reader is sent to.
//   2. BDRC's outline of the Derge Tengyur (bdr:O23703, CC0) and the rKTs work records behind it
//      (adm:metadataLegal bda:LD_rKTs_CC0): titles, colophon, author and translator agents, the
//      Indic parallel work (IAST title), and BDRC's own volume/image location for the text.
// BDRC's location is not used to place anything; it is the cross-check on (1).
//
// No DB, no network.

/** Lower-case ASCII skeleton of a name or title: diacritics, punctuation and spaces dropped. */
export function fold(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[ṃṁ]/g, 'm').replace(/ḥ/g, 'h')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "D1109" / "D7a" — the Esukhia/rKTs form of a Tohoku id. */
export const TOH_RE = /\{(D[0-9]+[a-z]?(?:-[0-9a-z]+)*)\}/g;

/** Tohoku ids opening on one page, from its stored text (in order), falling back to the importer's copy. */
export function pageTohoku(page) {
  const fromText = [...String(page?.ocr?.data || '').matchAll(TOH_RE)].map((m) => m[1]);
  if (fromText.length) return fromText;
  return Array.isArray(page?.ocr?.text_edition?.tohoku) ? [...page.ocr.text_edition.tohoku] : [];
}

/** Does the page's text OPEN with this marker (nothing but whitespace/apparatus before it)? */
export function opensPage(page, toh) {
  const t = String(page?.ocr?.data || '');
  const i = t.indexOf(`{${toh}}`);
  if (i < 0) return false;
  return t.slice(0, i).replace(/[\s#\\]/g, '') === '';
}

/**
 * Per-volume text list from the volume's pages (sorted by page_number).
 * Each text: { toh, startPage, startPageId, endPage, continued }.
 *  - A text ends on the page before the next text opens when that one opens at the top of its page,
 *    otherwise on the page where the next one opens (the two share the page).
 *  - A volume whose first text page carries no marker begins inside the previous volume's last text:
 *    that text is listed with `continued: true` (pass it as `carriedToh`).
 *  - Pages with no stored text after the last text are not counted into its range.
 *  - `inject` (Map page_number → toh[]) places texts whose marker sits on a side we hold no page for
 *    (a title side, e.g. vol. 102 f. 201a, the Madhyamakāvatāra): they open at the TOP of that page.
 */
export function volumeTexts(pages, { carriedToh = null, inject = new Map() } = {}) {
  const withText = pages.filter((p) => String(p?.ocr?.data || '').trim());
  const out = [];
  const seen = new Set();
  const first = withText[0];
  const opensTop = (p, toh) => (inject.get(p.page_number) || []).includes(toh) || opensPage(p, toh);
  const idsOn = (p) => [...(inject.get(p.page_number) || []), ...pageTohoku(p)];
  if (first && carriedToh && !(idsOn(first).length && opensTop(first, idsOn(first)[0]))) {
    out.push({ toh: carriedToh, startPage: first.page_number, startPageId: first.id, continued: true });
    seen.add(carriedToh);
  }
  for (const p of withText) {
    for (const toh of idsOn(p)) {
      if (seen.has(toh)) continue; // a marker repeated on one page is one opening
      seen.add(toh);
      const prev = out[out.length - 1];
      if (prev && prev.endPage == null) prev.endPage = opensTop(p, toh) ? p.page_number - 1 : p.page_number;
      out.push({ toh, startPage: p.page_number, startPageId: p.id, continued: false, ...(inject.get(p.page_number)?.includes(toh) ? { opening_side_not_held: true } : {}) });
    }
  }
  const lastPage = withText.length ? withText[withText.length - 1].page_number : null;
  for (const t of out) {
    if (t.endPage == null) t.endPage = lastPage;
    if (t.endPage < t.startPage) t.endPage = t.startPage;
  }
  return out;
}

/**
 * The titles a text gives itself at its opening: "རྒྱ་གར་སྐད་དུ། <Sanskrit>། བོད་སྐད་དུ། <Tibetan>།".
 * Read from OUR stored text (the Esukhia transcription of the block), so the eye-check against the
 * woodblock checks exactly what is written. Returns nulls where the formula is absent (most texts
 * composed in Tibet, and many short ritual texts, have none).
 */
export function openingTitles(text, toh) {
  let t = String(text || '');
  const i = t.indexOf(`{${toh}}`);
  if (i >= 0) t = t.slice(i + toh.length + 2);
  t = t.slice(0, 600).replace(/\(([^,()]*),[^()]*\)/g, '$1').replace(/[[\]#\\]/g, '').replace(/\{D[^}]*\}/g, '').replace(/\n/g, '');
  const clean = (s) => (s || '').replace(/^[\s།༄༅]+|[\s།་]+$/gu, '').trim() || null;
  const skt = t.match(/རྒྱ་གར་སྐད་དུ[།\s]*([^།]+)།/u);
  const bo = t.match(/བོད་སྐད་དུ[།\s]*([^།]+)།/u);
  return { sa_bo: clean(skt?.[1]), bo: clean(bo?.[1]) };
}

// ── BDRC JSON-LD ────────────────────────────────────────────────────────────────────────────────

const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const idOf = (v) => (v && typeof v === 'object' ? v['@id'] : v) || null;
const lit = (v, lang) => arr(v).find((x) => x && x['@language'] === lang)?.['@value'] ?? null;

/**
 * Outline graph (purl.bdrc.io/graph/O23703.jsonld) → Map Tohoku id → part facts.
 * BDRC writes the Tohoku number as a `bdr:KaTenSiglaD` identifier on each text part.
 */
export function parseOutline(graphDoc) {
  const g = new Map(arr(graphDoc['@graph']).map((x) => [x['@id'], x]));
  const out = new Map();
  for (const x of g.values()) {
    if (idOf(x.partType) !== 'bdr:PartTypeText') continue;
    const ids = arr(x['bf:identifiedBy']).map((r) => g.get(idOf(r))).filter(Boolean);
    const sig = ids.find((i) => i['@type'] === 'bdr:KaTenSiglaD');
    if (!sig) continue;
    const toh = sig['rdf:value'];
    const titles = arr(x.hasTitle).map((r) => g.get(idOf(r))).filter(Boolean);
    const loc = g.get(idOf(x.contentLocation)) || {};
    const num = (v) => (v == null ? null : Number(v['@value'] ?? v));
    const rec = {
      toh,
      part: x['@id'].replace(/^bdr:/, ''),
      work: idOf(x.instanceOf)?.replace(/^bdr:/, '') || null,
      title_ewts: lit(x['skos:prefLabel'], 'bo-x-ewts'),
      title_sa_ewts: titles.map((t) => lit(t['rdfs:label'], 'sa-x-ewts')).find(Boolean) || null,
      colophon_ewts: lit(x.colophon, 'bo-x-ewts'),
      location: { volume: num(loc.contentLocationVolume), page: num(loc.contentLocationPage), endPage: num(loc.contentLocationEndPage), endVolume: num(loc.contentLocationEndVolume) },
    };
    if (out.has(toh)) (out.get(toh).dups ||= []).push(rec.part); else out.set(toh, rec);
  }
  return out;
}

/** A work/person resource doc (purl.bdrc.io/resource/X.jsonld) → its main node and the graph map. */
export function resourceNode(doc, rid) {
  const g = new Map(arr(doc['@graph'] ?? [doc]).map((x) => [x['@id'], x]));
  return { node: g.get(`bdr:${rid}`) || null, g };
}

/** Work → { creators: [{ agent, role }], parallels: [WA…], iast: [..] } */
export function parseWork(doc, rid) {
  const { node, g } = resourceNode(doc, rid);
  if (!node) return null;
  const creators = arr(node.creator).map((r) => g.get(idOf(r))).filter(Boolean)
    .map((c) => ({ agent: idOf(c.agent)?.replace(/^bdr:/, ''), role: idOf(c.role)?.replace(/^bdr:/, '') }))
    .filter((c) => c.agent);
  return {
    creators,
    parallels: arr(node.workHasParallelsIn).map((r) => idOf(r)?.replace(/^bdr:/, '')).filter(Boolean),
    language: idOf(node.language)?.replace(/^bdr:/, '') || null,
    // BDRC sometimes files a Tibetan EWTS string under sa-x-iast (WA23226, the Mūlamadhyamakakārikā,
    // has "dbu ama rtsa ba shes rab/" first): an EWTS shad "/" marks it, so those are skipped.
    iast: [...arr(node['skos:prefLabel']), ...arr(node['skos:altLabel'])]
      .filter((x) => x?.['@language'] === 'sa-x-iast').map((x) => x['@value']).filter((v) => v && !v.includes('/')),
    sameAs: arr(node['owl:sameAs']).map(idOf).filter(Boolean),
  };
}

/** Person → { iast, ewts, iastOther[] } */
export function parsePerson(doc, rid) {
  const { node, g } = resourceNode(doc, rid);
  if (!node) return null;
  const names = arr(node.personName).map((r) => g.get(idOf(r))).filter(Boolean);
  return {
    iast: lit(node['skos:prefLabel'], 'sa-x-iast'),
    ewts: lit(node['skos:prefLabel'], 'bo-x-ewts'),
    iastOther: names.map((n) => lit(n['rdfs:label'], 'sa-x-iast')).filter(Boolean),
    sameAs: arr(node['owl:sameAs']).map(idOf).filter(Boolean),
  };
}

/** "prajñā-nāma-mūlamadhyamakakārikā" → "Prajñā-nāma-mūlamadhyamakakārikā" (no other change). */
export function displayIast(s) {
  if (!s) return null;
  const t = String(s).trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** EWTS name with BDRC's trailing shad removed: "las kyi rdo rje/" → "las kyi rdo rje". */
export const ewtsName = (s) => (s ? String(s).replace(/[\s/_]+$/, '').trim() : null);

// BDRC creator roles (bdr:R0ER…), labels as BDRC gives them.
export const AUTHOR_ROLES = new Set(['R0ER0019', 'R0ER0014', 'R0ER0025']);
export const TRANSLATOR_ROLES = new Set(['R0ER0026', 'R0ER0020', 'R0ER0018', 'R0ER0023', 'R0ER0022']);

/**
 * Thesaurus match for one person, deterministic and refusing on ambiguity.
 * `index` maps a folded name → Set of author _ids (built from canonical_name, variants, aliases).
 * A key shorter than 6 letters is never matched on (bare short names collide — author-identity.md).
 */
export function matchAuthor(person, index) {
  const keys = [...new Set([person.iast, ...(person.iastOther || [])].filter(Boolean).map(fold))].filter((k) => k.length >= 6);
  const hits = new Map();
  for (const k of keys) for (const id of index.get(k) || []) hits.set(id, (hits.get(id) || []).concat(k));
  if (hits.size !== 1) return { author_id: null, reason: hits.size ? `ambiguous: ${[...hits.keys()].join(', ')}` : 'no thesaurus entry', keys };
  const [[id, via]] = [...hits];
  return { author_id: id, via, keys };
}

/** Build the folded-name index over `authors` docs. Tombstones (merged_into) and non-persons are skipped. */
export function buildAuthorIndex(docs) {
  const index = new Map();
  const add = (k, id) => { if (!k || k.length < 6) return; if (!index.has(k)) index.set(k, new Set()); index.get(k).add(id); };
  for (const d of docs) {
    if (d.merged_into || d.is_person === false) continue;
    const forms = [d.canonical_name, ...(d.variants || []), ...(d.aliases || [])]
      .filter((s) => typeof s === 'string')
      .map((s) => s.replace(/\([^)]*\)/g, '').trim()) // "Nagarjuna (attr.)" → "Nagarjuna"
      .filter((s) => s && !/[;&]| and /.test(s)); // compounds name several people
    for (const f of forms) add(fold(f), d._id);
  }
  return index;
}

/**
 * Folded match keys for one text (read by src/lib/search/canon-texts.ts, which matches every query
 * word as a SUBSTRING of some key): whole strings and their words, for the Sanskrit and EWTS titles
 * and every author/translator name, plus the Tohoku number as "toh3824" and "3824".
 */
export function searchKeys({ toh, title_sa, title_ewts, people = [] }) {
  const keys = new Set();
  const add = (s) => {
    if (!s) return;
    const whole = fold(s); if (whole.length >= 3) keys.add(whole);
    for (const w of String(s).split(/[\s\-/_]+/)) { const f = fold(w); if (f.length >= 3) keys.add(f); }
  };
  add(title_sa); add(title_ewts);
  for (const p of people) { add(p.name); add(p.name_ewts); }
  const n = String(toh || '').replace(/^D/, '');
  if (n) { keys.add(`toh${n.toLowerCase()}`); keys.add(n.toLowerCase()); }
  return [...keys];
}
