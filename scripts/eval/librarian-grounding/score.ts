/**
 * Librarian grounding eval (#5904) — scoring half. Reads results/<label>.jsonl
 * written by run.ts and counts, per answer, from the text the reader sees:
 *
 *   uncitedClaims   prose paragraphs / list items that state facts (a number, a
 *                   quotation, or a proper name past the sentence start) and carry
 *                   no /book/ link at all.
 *   quotes          quoted spans of 3+ words and blockquotes, checked against the
 *                   SUPPORT SET: every page the answer cites, every source card the
 *                   turn retrieved, and the ±1 neighbours of each cited page.
 *                   `exact` = folded substring (per ellipsis fragment); `near` = 80%+
 *                   of its words on one page (a paraphrase in quote marks);
 *                   `unsupported` = neither.
 *   numbers         numerals and number words outside links/page refs, checked
 *                   against the same support set (digit or word form). Years
 *                   (1000–2099) are reported apart from quantities.
 *   captionErrors   an embedded image whose caption (alt + the italic line under it)
 *                   does not name the image's own book, links a different book, or
 *                   names a person/thing found nowhere in the image's own book title,
 *                   author, gallery description or page text.
 *
 * PRIOR ART: scripts/lib/page-terms-parse.mjs verifyQuote — tiered quote check for
 * translation notes against OCR; it needs a single page and its own romanisation
 * tables, and is about notes, not answers. Its lesson is kept: a quote is checked
 * per ellipsis fragment and diacritics/long-s are folded (src/lib/align-text.ts
 * normalizeNeedle). This scorer is deliberately separate from the fixer in
 * src/lib/embassy/grounding.ts — it uses the reader's support set (what the answer
 * links + the sources panel), not the fixer's internal retrieval set, so it cannot
 * simply agree with the code it measures.
 *
 * Usage:
 *   npx tsx --env-file=/root/sourcelibrary/.env.production.local \
 *     scripts/eval/librarian-grounding/score.ts --label=before [--verbose] [--pre]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { normalizeNeedle } from '@/lib/align-text';
import { applyCitationFixes, applyImageRemovals } from '@/lib/embassy/citation-fixes';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const label = arg('label');
if (!label) throw new Error('--label=<name> is required');
const verbose = process.argv.includes('--verbose');
// --pre: score the answer WITHOUT the grounding edits (link fixes and image
// removals still applied) — separates what the prompt/tool changes did from
// what the post-generation pass did.
const pre = process.argv.includes('--pre');

const fold = (s: string) => normalizeNeedle(s).replace(/\s+/g, ' ');
const words = (s: string) => (fold(s).match(/[\p{L}\p{N}]+/gu) ?? []);

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};
const WORD_FOR = Object.fromEntries(Object.entries(NUMBER_WORDS).map(([w, n]) => [n, w]));

/** Markdown links → their text; bare URLs removed. */
function stripLinks(s: string): string {
  return s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ');
}

const BOOK_LINK = /sourcelibrary\.org(?:\/es)?\/book\/([a-z0-9-]+)(?:(?:\/page-number\/|\/page\/|\?page=)(\d+))?/g;

interface Unit { kind: 'prose' | 'quote' | 'caption'; text: string; raw: string; embedUrl?: string }

function units(answer: string): Unit[] {
  const out: Unit[] = [];
  const text = answer.split(/\n---\n\*A note on sourcing/)[0];
  const blocks = text.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (!t) { i++; continue; }
      if (/^#{1,6}\s/.test(t) || /^-{3,}$/.test(t)) { i++; continue; }
      const embed = t.match(/^!\[([^\]]*)\]\(\s*([^\s)]+)/);
      if (embed) {
        let caption = embed[1];
        let raw = line;
        const next = lines[i + 1]?.trim();
        if (next && /^[*_][^*\s]/.test(next)) { caption += ' ' + next; raw += '\n' + lines[i + 1]; i++; }
        out.push({ kind: 'caption', text: caption, raw, embedUrl: embed[2] });
        i++;
        continue;
      }
      if (t.startsWith('>')) {
        const q: string[] = [];
        const raw: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          raw.push(lines[i]);
          const body = lines[i].trim().replace(/^>\s?/, '');
          if (!/^[—–-]\s/.test(body.trim())) q.push(body);
          i++;
        }
        const quote = stripLinks(q.join(' ')).replace(/^[\s"“”«»*_]+|[\s"“”«»*_]+$/g, '');
        // The grounding pass's own "quotation removed" note is not a quotation.
        if (quote.trim() && !/^A quotation stood here that I could not find/.test(quote.trim())) out.push({ kind: 'quote', text: quote, raw: raw.join('\n') });
        continue;
      }
      // A list item, or a run of non-list lines, is one claim unit.
      if (/^(?:[*+-]|\d+\.)\s+/.test(t)) {
        out.push({ kind: 'prose', text: t, raw: line });
        i++;
        continue;
      }
      const run: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(?:[*+-]|\d+\.)\s+|^>|^!\[|^#{1,6}\s/.test(lines[i].trim())) { run.push(lines[i]); i++; }
      if (run.length) out.push({ kind: 'prose', text: run.join(' '), raw: run.join('\n') });
      else i++;
    }
  }
  return out;
}

const SKIP_PROSE = /^(?:Saved to your research notebook|You might (?:explore|follow|also)|If you(?:'d| would) like)/i;

function quotedSpans(s: string): string[] {
  const plain = stripLinks(s);
  const spans: string[] = [];
  for (const m of plain.matchAll(/["“«]([^"”»]{3,400})["”»]/g)) {
    if (m[1].trim().split(/\s+/).length >= 3) spans.push(m[1].trim());
  }
  return spans;
}

/** Numbers in a unit, minus page references, list markers, ordinals and centuries. */
function numbersIn(s: string): Array<{ token: string; value: number; year: boolean }> {
  let plain = stripLinks(s)
    .replace(/["“«][^"”»]*["”»]/g, ' ') // numbers inside a quote are checked as the quote
    .replace(/\b(?:pages?|pp?\.|vol(?:ume)?s?\.?|nos?\.|fol(?:io)?s?\.?|ff?\.|chapter|ch\.|book|part|plate|fig(?:ure)?\.?|psalm|tome)\s*[\divxlc]+(?:\s*[–-]\s*\d+)?/gi, ' ')
    .replace(/^\s*(?:\d+\.|[*+-])\s+/, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\b/gi, ' ');
  plain = plain.replace(/\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\b/gi, ' ');
  const out: Array<{ token: string; value: number; year: boolean }> = [];
  for (const m of plain.matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![\w])/g)) {
    const value = Number(m[1].replace(/,/g, ''));
    out.push({ token: m[1], value, year: Number.isInteger(value) && value >= 1000 && value <= 2099 && !m[1].includes(',') });
  }
  for (const m of plain.toLowerCase().matchAll(/\b([a-z]+)\b/g)) {
    if (m[1] in NUMBER_WORDS) out.push({ token: m[1], value: NUMBER_WORDS[m[1]], year: false });
  }
  return out;
}

function hasProperName(s: string): boolean {
  const plain = stripLinks(s).replace(/[*_`]/g, '');
  for (const sentence of plain.split(/(?<=[.!?:;])\s+/)) {
    const toks = sentence.trim().split(/\s+/).slice(1);
    if (toks.some(t => /^[("'“]?\p{Lu}\p{Ll}{2,}/u.test(t) && !/^(?:I|The|This|These|That|English|Latin|French|German|Greek|Hebrew)$/.test(t))) return true;
  }
  return false;
}

interface PageText { key: string; folded: string; wordSet: Set<string> }

async function main() {
  const rows = fs.readFileSync(path.join(HERE, 'results', `${label}.jsonl`), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');

  const slugCache = new Map<string, { id: string; title: string; author: string; slug: string } | null>();
  async function bookBySlug(slug: string) {
    if (slugCache.has(slug)) return slugCache.get(slug)!;
    const b = await books.findOne({ $or: [{ slug }, { slug_aliases: slug }, { id: slug }] }, { projection: { id: 1, title: 1, display_title: 1, author: 1, slug: 1 } });
    const v = b ? { id: b.id as string, title: `${b.display_title || ''} ${b.title || ''}`, author: (b.author || '') as string, slug: (b.slug || b.id) as string } : null;
    slugCache.set(slug, v);
    return v;
  }
  const bookById = new Map<string, { id: string; title: string; author: string; slug: string } | null>();
  async function bookFromId(id: string) {
    if (bookById.has(id)) return bookById.get(id)!;
    const b = await books.findOne({ id }, { projection: { id: 1, title: 1, display_title: 1, author: 1, slug: 1 } });
    const v = b ? { id, title: `${b.display_title || ''} ${b.title || ''}`, author: (b.author || '') as string, slug: (b.slug || id) as string } : null;
    bookById.set(id, v);
    return v;
  }
  const pageCache = new Map<string, PageText | null>();
  async function loadPages(keys: Array<[string, number]>): Promise<PageText[]> {
    const missing = keys.filter(([b, p]) => !pageCache.has(`${b}:${p}`));
    const byBook = new Map<string, number[]>();
    for (const [b, p] of missing) byBook.set(b, [...(byBook.get(b) ?? []), p]);
    for (const [b, ps] of byBook) {
      const docs = await pages.find({ book_id: b, page_number: { $in: ps } }, { projection: { page_number: 1, 'translation.data': 1, 'ocr.data': 1 } }).toArray();
      for (const p of ps) pageCache.set(`${b}:${p}`, null);
      for (const d of docs) {
        // Stored text carries markup (<term>, <gloss>, a <note> mid-sentence);
        // read it with tags stripped AND with annotation elements dropped, or a
        // faithful quote cannot match its own page.
        const raw = `${d.translation?.data ?? ''}\n${d.ocr?.data ?? ''}`;
        const text = `${raw.replace(/<\/?[a-z][a-z-]*(?:\s[^>]*)?\/?>/gi, ' ')}\n${raw.replace(/<(note|margin|meta|summary|keywords|vocab|header|page-num|page-type|language|lang|sig|folio|warning|image-desc|scan-quality|script|columns)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, ' ').replace(/<\/?[a-z][a-z-]*(?:\s[^>]*)?\/?>/gi, ' ')}`;
        const folded = fold(text);
        pageCache.set(`${b}:${d.page_number}`, { key: `${b}:${d.page_number}`, folded, wordSet: new Set(folded.match(/[\p{L}\p{N}]+/gu) ?? []) });
      }
    }
    return keys.map(([b, p]) => pageCache.get(`${b}:${p}`)).filter((x): x is PageText => !!x);
  }

  const totals = { answers: 0, claimUnits: 0, uncitedClaims: 0, quotes: 0, quotesExact: 0, quotesNear: 0, quotesUnsupported: 0, numbers: 0, numbersUnsupported: 0, quantities: 0, quantitiesUnsupported: 0, years: 0, yearsUnsupported: 0, images: 0, captionErrors: 0, promptTokens: 0, cost: 0, errors: 0 };
  const perQ: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    if (row.error) { totals.errors++; perQ.push({ id: row.id, error: row.error }); continue; }
    totals.answers++;
    totals.promptTokens += row.usage?.promptTokens ?? 0;
    totals.cost += row.cost ?? 0;
    const answer: string = pre ? applyImageRemovals(applyCitationFixes(row.raw, row.fixes ?? []), row.removals ?? []) : row.final;

    // Support set: cited pages (±1) + source cards.
    const keys: Array<[string, number]> = [];
    for (const m of answer.matchAll(BOOK_LINK)) {
      if (!m[2]) continue;
      const b = await bookBySlug(m[1]);
      if (!b) continue;
      const p = Number(m[2]);
      keys.push([b.id, p - 1], [b.id, p], [b.id, p + 1]);
    }
    for (const s of row.sources ?? []) if (s.pageNumber) keys.push([s.book_id, s.pageNumber]);
    const support = await loadPages(keys);

    const flags: string[] = [];
    let uncited = 0, claimUnits = 0, qs = 0, qExact = 0, qNear = 0, qBad = 0, nums = 0, numBad = 0, quant = 0, quantBad = 0, yrs = 0, yrBad = 0, imgs = 0, capErr = 0;

    const quoteVerdict = (quote: string): 'exact' | 'near' | 'unsupported' => {
      // [brackets] inside a quotation are the quoter's insertion, not the page's words.
      const frags = quote.split(/\s*(?:\.{3,}|…|\[\.\.\.\])\s*/).map(f => f.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()).filter(f => f.length >= 4);
      if (frags.length && frags.every(f => { const ff = fold(f); return support.some(p => p.folded.includes(ff)); })) return 'exact';
      const ws = [...new Set(words(quote).filter(w => w.length >= 3))];
      if (ws.length && support.some(p => ws.filter(w => p.wordSet.has(w)).length / ws.length >= 0.8)) return 'near';
      return 'unsupported';
    };
    const numberSupported = (n: { token: string; value: number }) => {
      const digits = String(n.value);
      const forms = [digits, n.token.toLowerCase()];
      if (WORD_FOR[n.value]) forms.push(WORD_FOR[n.value]);
      return support.some(p => forms.some(f => new RegExp(`(?<![\\p{L}\\p{N}])${f.replace(/[.]/g, '\\.')}(?![\\p{L}\\p{N}])`, 'u').test(p.folded) || (/^\d{4,}$/.test(digits) && p.folded.includes(digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')))));
    };

    for (const u of units(answer)) {
      if (u.kind === 'quote') {
        qs++;
        const v = quoteVerdict(u.text);
        if (v === 'exact') qExact++; else if (v === 'near') qNear++; else { qBad++; flags.push(`QUOTE✗ ${u.text.slice(0, 140)}`); }
        continue;
      }
      if (u.kind === 'caption') {
        imgs++;
        const url = u.embedUrl!;
        let book: { id: string; title: string; author: string; slug: string } | null = null;
        let page: number | null = null;
        let description = '';
        const m = url.match(/\/archived\/([a-f0-9]{24})\/(\d+)\./);
        if (m) { book = await bookFromId(m[1]); page = Number(m[2]); }
        const g = await db.collection('gallery_images').findOne({ image_url: url }, { projection: { book_id: 1, page_number: 1, description: 1, museum_description: 1 }, maxTimeMS: 5000 }).catch(() => null);
        if (g) { book = book ?? await bookFromId(g.book_id); page = page ?? g.page_number; description = `${g.description ?? ''} ${g.museum_description ?? ''}`; }
        if (!book) {
          // A standalone artwork is its own `books` record; its image is image_display.
          const art = await books.findOne({ image_display: url }, { projection: { id: 1, title: 1, display_title: 1, author: 1, slug: 1, summary: 1, description: 1 }, maxTimeMS: 10000 }).catch(() => null);
          if (art) {
            book = { id: art.id, title: `${art.display_title || ''} ${art.title || ''}`, author: (art.author || '') as string, slug: (art.slug || art.id) as string };
            description = `${typeof art.summary === 'string' ? art.summary : ''} ${typeof art.description === 'string' ? art.description : ''}`;
          }
        }
        if (!book) { flags.push(`CAPTION? unresolvable image ${url}`); continue; }
        const own = (await loadPages(page ? [[book.id, page]] : []))[0];
        const ownWords = new Set([...words(`${book.title} ${book.author} ${description}`), ...(own?.wordSet ?? [])]);
        const linkedSlugs = [...u.raw.matchAll(BOOK_LINK)].map(x => x[1]);
        const linked = await Promise.all(linkedSlugs.map(bookBySlug));
        const titleWords = words(book.title).filter(w => w.length >= 4);
        const capWords = words(u.text);
        const titleHits = titleWords.filter(w => capWords.includes(w));
        const namesOwn = linked.some(b => b?.id === book!.id)
          || titleHits.length >= 2 || titleHits.some(w => w.length >= 6);
        const linksOther = linked.some(b => b && b.id !== book!.id);
        // A relationship assertion: the caption ties the picture to the QUESTION's
        // subject (a name the reader asked about) when nothing in the picture's own
        // record — title, author, gallery description, page text — mentions it. The
        // Khunrath athanor captioned as Drebbel's oven (#5904) is the shape.
        const topic = new Set((String(row.q).match(/(?<=\s)\p{Lu}[\p{L}]{3,}/gu) ?? []).map(n => fold(n)));
        const strangers = [...new Set((stripLinks(u.text).replace(/[*_]/g, ' ').match(/\p{Lu}[\p{L}]{3,}/gu) ?? [])
          .map(n => fold(n))
          .filter(n => topic.has(n) && !ownWords.has(n)))];
        const bad = !namesOwn || linksOther || strangers.length > 0;
        if (bad) { capErr++; flags.push(`CAPTION✗ ${!namesOwn ? '[no own book] ' : ''}${linksOther ? '[links other book] ' : ''}${strangers.length ? `[ties to ${strangers.join(',')}] ` : ''}${u.text.slice(0, 160)}`); }
        continue;
      }
      if (SKIP_PROSE.test(stripLinks(u.text).replace(/^[*\s]+/, ''))) continue;
      const quotes = quotedSpans(u.text);
      const numbers = numbersIn(u.text);
      const factual = quotes.length > 0 || numbers.length > 0 || hasProperName(u.text);
      if (factual) {
        claimUnits++;
        if (!/sourcelibrary\.org(?:\/es)?\/book\//.test(u.raw)) { uncited++; flags.push(`UNCITED ${stripLinks(u.text).slice(0, 140)}`); }
      }
      for (const q of quotes) {
        qs++;
        const v = quoteVerdict(q);
        if (v === 'exact') qExact++; else if (v === 'near') qNear++; else { qBad++; flags.push(`QUOTE✗ "${q.slice(0, 140)}"`); }
      }
      for (const n of numbers) {
        nums++;
        const ok = numberSupported(n);
        if (n.year) { yrs++; if (!ok) yrBad++; } else { quant++; if (!ok) quantBad++; }
        if (!ok) { numBad++; flags.push(`NUMBER✗ ${n.token}${n.year ? ' (year)' : ''} in: ${stripLinks(u.text).slice(0, 120)}`); }
      }
    }
    totals.claimUnits += claimUnits; totals.uncitedClaims += uncited; totals.quotes += qs; totals.quotesExact += qExact; totals.quotesNear += qNear; totals.quotesUnsupported += qBad;
    totals.numbers += nums; totals.numbersUnsupported += numBad; totals.quantities += quant; totals.quantitiesUnsupported += quantBad; totals.years += yrs; totals.yearsUnsupported += yrBad; totals.images += imgs; totals.captionErrors += capErr;
    perQ.push({ id: row.id, claimUnits, uncited, quotes: qs, quotesUnsupported: qBad, quotesNear: qNear, quantities: quant, quantitiesUnsupported: quantBad, years: yrs, yearsUnsupported: yrBad, images: imgs, captionErrors: capErr, promptTokens: row.usage?.promptTokens, flags });
  }
  await client.close();

  console.log(`\n== ${label}${pre ? ' (pre-grounding)' : ''} ==`);
  console.log('id'.padEnd(20), 'claims uncited  quotes(✗/near)  qty(✗)  yrs(✗)  img(✗)  prompt');
  for (const q of perQ) {
    if (q.error) { console.log(String(q.id).padEnd(20), 'ERROR', q.error); continue; }
    console.log(String(q.id).padEnd(20), `${q.claimUnits}`.padStart(6), `${q.uncited}`.padStart(7), `${q.quotes}(${q.quotesUnsupported}/${q.quotesNear})`.padStart(15), `${q.quantities}(${q.quantitiesUnsupported})`.padStart(7), `${q.years}(${q.yearsUnsupported})`.padStart(7), `${q.images}(${q.captionErrors})`.padStart(7), `${q.promptTokens}`.padStart(7));
    if (verbose) for (const f of q.flags as string[]) console.log('    ', f);
  }
  console.log('\nTOTALS', JSON.stringify({ ...totals, cost: Number(totals.cost.toFixed(3)) }));
  fs.writeFileSync(path.join(HERE, 'results', `${label}${pre ? '.pre' : ''}.score.json`), JSON.stringify({ label, pre, totals, perQ }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
