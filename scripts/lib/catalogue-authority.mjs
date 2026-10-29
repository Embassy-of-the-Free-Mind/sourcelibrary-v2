// PRIOR ART: scripts/iiif-discovery/lib/manifest-store.mjs — fetches and stores whole manifests (page URLs, raw JSON) but
// reads no names from them; scripts/catalog-coverage/harvest-erara-catalog.mjs — keeps the FIRST personal namePart of an
// e-rara record with no role and no GND, which is why its `author` is so often the printer ("Apiarius, Offizin, Bern").
// scripts/lib/bib-record.mjs — MARC from LoC SRU, a different source and shape. None reads the libraries' own author
// AUTHORITY (GND id, role code, life dates) out of the records we already link to.
/**
 * Who does the HOLDING LIBRARY say wrote this book? (#7660 stage 0)
 *
 * BSB, e-rara, SBB and Göttingen catalogue their prints against the GND, and the
 * records we already link to (image_source.iiif_manifest, or the METS beside it)
 * carry that authority: a heading, life dates, a GND id and a MARC relator code.
 * That answers "who is this?" with an identifier instead of a string, which is
 * exactly what name matching cannot do — two "Müller, Johann" headings with
 * different GND ids are two people, and one GND id under two spellings is one.
 *
 * Every parser returns names as
 *   { name, dates, gnd, type: 'personal'|'corporate', roles: [marc relator codes], role_text: [..], primary }
 * plus edition ids (VD16/17/18) where the record names them. Pure functions; the
 * harvester (scripts/maintenance/harvest-catalogue-authority.mjs) does the I/O.
 *
 * ROLE IS THE POINT. e-rara lists the deceased of a funeral sermon (`hnr`) and the
 * printer (`prt`) beside the author in the same "Autor, Beteiligte" field; only the
 * METS role code tells them apart. `authorOf()` takes only `aut`/`cre` (or BSB's
 * Creator slot, which is the record's 100 field) and refuses a record that names
 * more than one.
 */

const decode = (s) => String(s ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/\s+/g, ' ').trim();

/** The GND id inside a URI or "(DE-588)" identifier, or null. */
export function gndOf(s) {
  const m = String(s ?? '').match(/(?:d-nb\.info\/gnd\/|\(DE-588\)|GND:\s*(?:<a[^>]*>)?)\s*([0-9X-]{6,12})/i);
  return m ? m[1].toUpperCase() : null;
}

/** VD16/VD17/VD18 numbers named anywhere in a record's text. */
export function vdIdsOf(text) {
  const out = {};
  const t = decode(text);
  // (?!VD): "Projekt = VD18 digital" next to "Kategorie VD18" read the label itself as the number.
  for (const m of t.matchAll(/\bVD\s?(16|17|18)(?:-Nummer)?[\s:]+(?!VD)((?:[A-Z]{1,3}\s?\d+)|(?:\d+:\d+[A-Z]?)|(?:\d{8}))/g)) {
    const k = `vd${m[1]}`;
    if (!out[k]) out[k] = m[2].replace(/\s+/g, ' ').trim();
  }
  return out;
}

const label = (l) => {
  if (Array.isArray(l)) return l.map((x) => (typeof x === 'string' ? x : x?.['@value'] ?? '')).join('|');
  if (l && typeof l === 'object') return Object.values(l).flat().join('|');
  return String(l ?? '');
};
const values = (v) => (Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'string' ? x : x?.['@value'] ?? '')).filter(Boolean);

/**
 * BSB / MDZ IIIF manifest. `Creator` (Urheber) is the MARC 100, `Contributor`
 * (Beteiligt) the 700s; each value reads "Leyser, Augustin von, 1683-1752 -- (GND: <a…>100867367</a>)".
 */
export function parseBsbManifest(manifest) {
  const names = [];
  let statement = null;
  let text = '';
  for (const m of manifest?.metadata || []) {
    const l = label(m.label);
    for (const raw of values(m.value)) {
      text += ` ${raw}`;
      if (/\bBy\b|\bVon\b/.test(l) && !statement) statement = decode(raw);
      const creator = /\bCreator\b|Urheber/.test(l);
      const contributor = /\bContributor\b|Beteiligt/.test(l);
      if (!creator && !contributor) continue;
      const [head] = raw.split(' -- ');
      const h = decode(head);
      const dm = h.match(/^(.*?),\s*((?:ca\.\s*)?\d{3,4}\??\s*-\s*(?:ca\.\s*)?(?:\d{3,4})?\??|\d{1,2}\.\s*Jh\.)$/);
      names.push({
        name: (dm ? dm[1] : h).trim(), dates: dm ? dm[2].replace(/\s+/g, '') : null, gnd: gndOf(raw),
        type: null, roles: creator ? ['cre'] : [], role_text: [creator ? 'Creator' : 'Contributor'], primary: creator,
      });
    }
  }
  return { names, statement, ids: vdIdsOf(text) };
}

/**
 * SBB IIIF manifest. Its METS (the only other place) takes 7-8 s a record to generate
 * and carried no GND id in any sample, so the manifest's own slots are read:
 * `Autor` (author), `Herausgeber` (editor), `Weitere Person` (other), VD numbers.
 */
export function parseSbbManifest(manifest) {
  const names = [];
  let text = '';
  const ROLE = { Autor: 'aut', Herausgeber: 'edt', 'Weitere Person': 'oth' };
  for (const m of manifest?.metadata || []) {
    const l = label(m.label).trim();
    for (const raw of values(m.value)) {
      text += ` ${l} ${raw}`;
      if (!ROLE[l]) continue;
      // "Moritz Wilhelm <Sachsen-Merseburg, Herzog>": the qualifier is the identity, not a tag.
      const n = decode(String(raw).replace(/<(?!\/?a\b)([^<>]+)>/g, '($1)'));
      if (!n || names.some((x) => x.name === n && x.roles[0] === ROLE[l])) continue;
      names.push({ name: n, dates: null, gnd: gndOf(raw), type: /<|\b(?:Herzog|König|Kurfürst)\b/.test(n) ? null : 'personal', roles: [ROLE[l]], role_text: [l], primary: l === 'Autor' });
    }
  }
  return { names, ids: vdIdsOf(text) };
}

/**
 * The FIRST <mods:mods> of a METS document (the record of the item itself; later
 * dmdSecs describe volumes and chapters), parsed for names and VD ids.
 */
export function parseMetsMods(xml) {
  const s = String(xml ?? '');
  // The first dmdSec, not the first </mods:mods>: Göttingen nests a <mods:mods> inside
  // <mods:extension>, and cutting at its close dropped every name after it.
  const sec = s.search(/<mets:dmdSec[\s>]/);
  const start = s.indexOf('<mods:mods', sec < 0 ? 0 : sec);
  if (start < 0) return { names: [], ids: {} };
  const close = sec < 0 ? -1 : s.indexOf('</mets:dmdSec>', start);
  // A relatedItem (a host volume, a series) carries ITS names, not this book's.
  const mods = s.slice(start, close < 0 ? undefined : close).replace(/<mods:relatedItem\b[\s\S]*?<\/mods:relatedItem>/g, ' ');
  const names = [];
  for (const m of mods.matchAll(/<mods:name\b([^>]*)>([\s\S]*?)<\/mods:name>/g)) {
    const attrs = m[1], body = m[2];
    const part = (type) => decode((body.match(new RegExp(`<mods:namePart[^>]*type="${type}"[^>]*>([\\s\\S]*?)</mods:namePart>`)) || [])[1]);
    const display = decode((body.match(/<mods:displayForm>([\s\S]*?)<\/mods:displayForm>/) || [])[1]);
    const bare = [...body.matchAll(/<mods:namePart(?![^>]*type=)[^>]*>([\s\S]*?)<\/mods:namePart>/g)].map((x) => decode(x[1])).filter(Boolean);
    const family = part('family'), given = part('given');
    const name = display || (family ? `${family}${given ? `, ${given}` : ''}` : bare.join('. '));
    if (!name) continue;
    names.push({
      name,
      dates: part('date') || null,
      gnd: gndOf((attrs.match(/valueURI="([^"]+)"/) || [])[1]) || gndOf((body.match(/<mods:nameIdentifier[^>]*>([^<]+)</) || [])[1]),
      type: (attrs.match(/type="(personal|corporate|conference|family)"/) || [])[1] || null,
      roles: [...body.matchAll(/<mods:roleTerm[^>]*type="code"[^>]*>([^<]+)</g)].map((x) => x[1].trim().toLowerCase()),
      role_text: [...body.matchAll(/<mods:roleTerm[^>]*type="text"[^>]*>([^<]+)</g)].map((x) => decode(x[1])),
      primary: /usage="primary"/.test(attrs),
    });
  }
  const ids = vdIdsOf(mods.replace(/<mods:identifier[^>]*type="vd(16|17|18)"[^>]*>([^<]+)</g, ' VD$1 $2 '));
  return { names, ids };
}

const AUTHOR_CODES = new Set(['aut', 'cre']);

/**
 * The one name the record calls the author, or null with a reason.
 * Returns { name, reason } where reason is null when name is set.
 */
export function authorOf(names) {
  let au = (names || []).filter((n) => n.roles?.some((r) => AUTHOR_CODES.has(r)) || /^(Verfasser|Creator|Autor|Author)$/i.test(n.role_text?.[0] || ''));
  // e-rara marks the main entry (MARC 100) usage="primary" and often gives it no role at all.
  if (!au.length) au = (names || []).filter((n) => n.primary && !n.roles?.length && !n.role_text?.length);
  if (au.length === 1) return { name: au[0], reason: null };
  if (au.length > 1) return { name: null, reason: 'several-authors' };
  return { name: null, reason: names?.length ? 'no-author-role' : 'no-names' };
}

/**
 * The raw descriptive record kept beside the parsed names (Derek, 2026-10-28: raw harvested metadata is kept per
 * book): a manifest's `metadata` + `seeAlso` + `label`, or the METS record's first dmdSec as XML. Small by design —
 * never the canvases.
 */
export function rawRecord(kind, text) {
  if (kind === 'mets') {
    const s = String(text ?? '');
    const sec = s.search(/<mets:dmdSec[\s>]/);
    const end = sec < 0 ? -1 : s.indexOf('</mets:dmdSec>', sec);
    return { format: 'mets-dmdsec-xml', xml: sec < 0 ? s.slice(0, 20000) : s.slice(sec, end < 0 ? sec + 20000 : end + 14) };
  }
  const m = typeof text === 'string' ? JSON.parse(text) : text;
  return { format: 'iiif-manifest-metadata', label: m?.label ?? null, metadata: m?.metadata ?? null, seeAlso: m?.seeAlso ?? null, related: m?.related ?? null };
}

/** Which record to fetch for a book, by provider. Returns { url, kind } or null. */
export function recordUrlFor(book) {
  const p = book?.image_source?.provider;
  const m = book?.image_source?.iiif_manifest || '';
  if (p === 'bsb' || p === 'mdz') return /digitale-sammlungen\.de/.test(m) ? { url: m, kind: 'bsb-manifest' } : null;
  if (p === 'erara' || p === 'e-rara') {
    const id = (m.match(/\/i3f\/v\d+\/(\d+)\/manifest/) || [])[1];
    return id ? { url: `https://www.e-rara.ch/oai?verb=GetRecord&metadataPrefix=mets&identifier=${id}`, kind: 'mets' } : null;
  }
  if (p === 'sbb') return /staatsbibliothek-berlin\.de/.test(m) ? { url: m, kind: 'sbb-manifest' } : null;
  if (p === 'goettingen') {
    const ppn = (m.match(/\/(PPN[0-9X_]+)\/manifest/i) || [])[1];
    return ppn ? { url: `https://gdz.sub.uni-goettingen.de/mets/${ppn}.mets.xml`, kind: 'mets' } : null;
  }
  return null;
}
