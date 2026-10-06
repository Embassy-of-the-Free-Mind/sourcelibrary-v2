// #6012: header → manifest fields, one function per source. Reads the TEI header only (a string).
// PRIOR ART: none in the repo for DTA or TCP headers; #5126's CAMENA header scrape was a job-local Python
// file (/data/scratch latin-5126/camena-meta.py) and kept title, author, bibl and year only.
import { decodeEntities } from './lib.mjs';

const clean = (s) => (s == null ? null : decodeEntities(String(s).replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() || null);
const first = (s, re) => { const m = s.match(re); return m ? clean(m[1]) : null; };
const all = (s, re) => [...s.matchAll(re)].map((m) => clean(m[1])).filter(Boolean);
const yearOf = (s) => { const m = String(s || '').match(/(?<!\d)(1[4-9]\d\d)(?!\d)/); return m ? Number(m[1]) : null; };
const block = (s, tag) => { const m = s.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'i')); return m ? m[0] : ''; };

export function metaDta(h) {
  const src = block(h, 'sourceDesc') || h;
  const full = block(src, 'biblFull') || src;
  const persons = [...(block(full, 'titleStmt') || full).matchAll(/<author>([\s\S]*?)<\/author>/g)].map((m) => {
    const sur = first(m[1], /<surname>([\s\S]*?)<\/surname>/), fore = first(m[1], /<forename>([\s\S]*?)<\/forename>/);
    return { name: sur ? `${sur}${fore ? ', ' + fore : ''}` : clean(m[1]), gnd: (m[1].match(/d-nb\.info\/gnd\/([0-9X-]+)/) || [])[1] || null };
  });
  const ms = block(src, 'msIdentifier');
  const pub = block(full, 'publicationStmt');
  const date = first(pub, /<date[^>]*type="publication"[^>]*>([\s\S]*?)<\/date>/) || first(pub, /<date[^>]*>([\s\S]*?)<\/date>/);
  const titles = [...(block(full, 'titleStmt') || '').matchAll(/<title(\s[^>]*)?>([\s\S]*?)<\/title>/g)].map((m) => ({ a: m[1] || '', t: clean(m[2]) })).filter((x) => x.t);
  const tOf = (type) => titles.filter((x) => new RegExp(`type="${type}"`).test(x.a)).map((x) => x.t).join(' ') || null;
  return {
    title: [tOf('main'), tOf('sub')].filter(Boolean).join('. ') || titles[0]?.t || null,
    volume: tOf('volume') || first(full, /<biblScope[^>]*unit="volume"[^>]*>([\s\S]*?)<\/biblScope>/),
    author: persons.map((p) => p.name).filter(Boolean).join('; ') || null,
    year: yearOf(date), date_raw: date,
    place: first(pub, /<pubPlace>([\s\S]*?)<\/pubPlace>/), printer: first(pub, /<publisher>([\s\S]*?)<\/publisher>/),
    language: all(h, /<language ident="([^"]+)"/g).filter((v, i, a) => a.indexOf(v) === i).join(',') || 'deu',
    citation: first(src, /<bibl[^>]*>([\s\S]*?)<\/bibl>/),
    licence_target: (h.match(/<licence target="([^"]+)"/) || [])[1] || null,
    classes: all(h, /<classCode[^>]*>([\s\S]*?)<\/classCode>/g),
    ids: {
      dta_dirname: first(h, /<idno type="DTADirName">([\s\S]*?)<\/idno>/), dta_id: first(h, /<idno type="DTAID">([\s\S]*?)<\/idno>/),
      dta_urn: first(block(h, 'publicationStmt'), /<idno type="URN">([\s\S]*?)<\/idno>/), url: first(h, /<idno type="URLWeb">([\s\S]*?)<\/idno>/),
      author_gnd: persons.map((p) => p.gnd).filter(Boolean),
      holding_library: first(ms, /<repository>([\s\S]*?)<\/repository>/), shelfmark: first(ms, /<idno type="shelfmark">([\s\S]*?)<\/idno>/),
      catalogue_url: first(ms, /<idno type="URLCatalogue">([\s\S]*?)<\/idno>/), images_url: first(ms, /<idno type="URLImages">([\s\S]*?)<\/idno>/),
      images_urn: first(ms, /<idno type="URN">([\s\S]*?)<\/idno>/), vd: all(src, /<idno type="(?:VD1[678]|vd1[678])">([\s\S]*?)<\/idno>/g),
    },
  };
}

export function metaCamena(h, coll, file) {
  // Two header dialects: bare <title> / type='short', and the validated one with TEIform="…" on every tag.
  const title = first(h, /<title(?![^>]*\stype=)[^>]*>([\s\S]*?)<\/title>/);
  const short = first(h, /<title[^>]*\stype=['"]short['"][^>]*>([\s\S]*?)<\/title>/);
  const bibl = first(block(h, 'sourceDesc'), /<bibl[^>]*>([\s\S]*?)<\/bibl>/) || first(block(h, 'sourceDesc'), /<p[^>]*>([\s\S]*?)<\/p>/);
  const note = (t) => first(h, new RegExp(`<note[^>]*\\stype=["']${t}["'][^>]*>([\\s\\S]*?)</note>`));
  const place = (bibl || '').split(':')[0].trim();
  return {
    title: title || short, title_short: short,
    author: first(h, /<author[^>]*>([\s\S]*?)<\/author>/), year: yearOf(bibl) || yearOf(short), date_raw: bibl,
    place: place && place.length < 40 ? place : null, printer: null, language: 'lat', citation: bibl, collection: coll,
    ids: { camena_file: `${coll}/${file}`, camena_pathname: note('pathname'), camena_href: note('href'), camena_html: note('filename'), camena_srcfile: note('srcfile') },
  };
}

/** TCP P4 header (<HEADER>…</HEADER>, upper-case tags). `name` is the member path, e.g. A0/A00002.P4.xml. */
export function metaTcp(h, name) {
  const tcp = (name.match(/([ABEKNS]\d{5})/) || [])[1] || first(h, /<IDNO TYPE="DLPS">([\s\S]*?)<\/IDNO>/i);
  const src = block(h, 'SOURCEDESC') || h;
  const idno = (t) => all(h, new RegExp(`<IDNO TYPE="${t}">([\\s\\S]*?)</IDNO>`, 'gi'));
  const stc = idno('stc');
  const avail = first(h, /<AVAILABILITY>([\s\S]*?)<\/AVAILABILITY>/i);
  const date = first(src, /<DATE>([\s\S]*?)<\/DATE>/i);
  const estc = stc.map((s) => (s.match(/ESTC\s+([A-Z]\d+)/i) || [])[1]).filter(Boolean);
  return {
    title: first(src, /<TITLE(?:\s[^>]*)?>([\s\S]*?)<\/TITLE>/i) || first(h, /<TITLE(?:\s[^>]*)?>([\s\S]*?)<\/TITLE>/i),
    author: all(src, /<AUTHOR>([\s\S]*?)<\/AUTHOR>/gi).join('; ') || null, year: yearOf(date), date_raw: date,
    place: first(src, /<PUBPLACE>([\s\S]*?)<\/PUBPLACE>/i), printer: first(src, /<PUBLISHER>([\s\S]*?)<\/PUBLISHER>/i),
    language: all(h, /<LANGUAGE ID="([^"]+)"/gi).join(',') || first(h, /<LANGUSAGE ID="([^"]+)"/i) || 'eng',
    subjects: all(h, /<TERM[^>]*>([\s\S]*?)<\/TERM>/gi).slice(0, 12),
    availability: avail,
    ids: { tcp, stc: stc.filter((s) => !/ESTC/i.test(s) || /STC|Wing/i.test(s)), estc, eebo_citation: idno('eebo citation')[0] || null, proquest: idno('proquest')[0] || null, vid: idno('vid')[0] || null },
  };
}
