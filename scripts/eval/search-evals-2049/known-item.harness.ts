/**
 * Keyword known-item test (#2049, eval check 4): can a reader who types a few words they read on a
 * page get that page back in the top 10? Random live pages, stratified by language and script; a
 * distinctive 3–5 word run from the page's own text (OCR for the original-language strata,
 * translation for the English one; the `pages_search` index maps both). Each phrase goes, unquoted
 * as a reader types it, to the Atlas page lane (the route's main stage, `buildPageSearchStage`, top
 * 25, then the route's hidden/non-live drop) and to the keyword service (`POST /lane`, k 25).
 *
 * Three arms per page: `random` (a random qualifying run), `distinctive` (the run whose words are
 * longest, i.e. rarest; for Han and Tibetan the same random run), and `quoted` (the distinctive run in
 * double quotes, which both lanes read as a phrase). Scored per arm: rank of the source page
 * (strict), and rank of the first page whose text prints the phrase (lenient — a duplicate scan or
 * another edition printing the same words is a fair answer). Hit@10 and MRR (over the top 25).
 *
 * PRIOR ART: scripts/eval/keyword-lane-parity/parity.harness.ts — the same two lanes, but on logged
 * queries scored against each other; it has no ground truth. This one has the source page as the
 * truth, and samples pages, not queries.
 *
 *   OUT=$JOB_SCRATCH/known-item.jsonl KEYWORD_SEARCH_URL=… KEYWORD_SEARCH_TOKEN=… \
 *     node --env-file=/root/sourcelibrary/.env.production.local node_modules/.bin/vitest run \
 *     --config scripts/eval/search-evals-2049/vitest.config.mts known-item
 *
 * Env: OUT (required), SEED (default 2049), QUOTAS (JSON, default below), SAMPLE_FROM (a previous
 * OUT: re-run exactly its pages and their random phrases). Reads prod Mongo and the
 * service; writes nothing to any store. The phrases stay in OUT (scratch), not in the repo.
 */
import { test } from 'vitest';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

/** Stratum → the book languages it draws from, the text field, and the script the phrase must be in. */
const STRATA: Record<string, { langs: string[]; field: 'ocr' | 'translation'; script: RegExp }> = {
  english_translation: { langs: ['Latin', 'German', 'French', 'Italian', 'Dutch', 'Greek', 'Chinese', 'Arabic', 'Hebrew', 'Tibetan', 'Sanskrit'], field: 'translation', script: /^\p{Script=Latin}+$/u },
  latin_script: { langs: ['Latin', 'German', 'French', 'Italian', 'Dutch', 'Spanish', 'English', 'Latin-German', 'Portuguese', 'Polish'], field: 'ocr', script: /^\p{Script=Latin}+$/u },
  greek: { langs: ['Greek', 'Ancient Greek', 'Greek-Latin', 'Greek/Latin'], field: 'ocr', script: /^[\p{Script=Greek}\p{M}]+$/u },
  cyrillic: { langs: ['Russian', 'Church Slavonic', 'Old Church Slavonic', 'Bulgarian', 'Serbian', 'Ukrainian'], field: 'ocr', script: /^[\p{Script=Cyrillic}\p{M}]+$/u },
  han: { langs: ['Chinese', 'Classical Chinese', 'Japanese'], field: 'ocr', script: /^\p{Script=Han}+$/u },
  tibetan: { langs: ['Tibetan'], field: 'ocr', script: /^[\p{Script=Tibetan}]+$/u },
  arabic: { langs: ['Arabic', 'Persian', 'Ottoman Turkish', 'Judeo-Arabic and Hebrew'], field: 'ocr', script: /^[\p{Script=Arabic}\p{M}]+$/u },
  hebrew: { langs: ['Hebrew', 'Hebrew and Aramaic', 'Hebrew and Judeo-Arabic', 'Yiddish'], field: 'ocr', script: /^[\p{Script=Hebrew}\p{M}]+$/u },
};
const QUOTAS: Record<string, number> = JSON.parse(process.env.QUOTAS
  || '{"english_translation":60,"latin_script":60,"greek":30,"cyrillic":30,"han":40,"tibetan":30,"arabic":25,"hebrew":25}');

/** Function words a reader would not pick as the distinctive part of a phrase (Latin-script strata). */
const STOP = new Set(('a an and are as at be but by de del della der des di die das du ein eine el en est et for from has have he her his i il in is it la le les los of on or que qui quod sed she so that the their them there they this to und von was we were which who will with zu ad cum non per ut aut enim sunt ex vel').split(' '));

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Collapse whitespace; lowercase; for the "does this page print the phrase" check. */
const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();

/**
 * A distinctive run from `text`, or null. Spaced scripts: 3–5 consecutive words separated only by
 * spaces (no punctuation inside the run, so it reads as a phrase), every word ≥ 3 letters and not a
 * function word, at least two of ≥ 5. Han: 5 consecutive Han characters. Tibetan: 4 syllables,
 * joined by the tsheg as printed.
 */
function pickPhrase(text: string, stratum: string, rnd: () => number, mode: 'random' | 'distinctive' = 'random'): string | null {
  const cands: string[] = [];
  if (stratum === 'han') {
    for (const m of text.matchAll(/\p{Script=Han}{5,}/gu)) {
      const run = m[0];
      for (let i = 0; i + 5 <= run.length; i += 5) cands.push(run.slice(i, i + 5));
    }
  } else if (stratum === 'tibetan') {
    for (const m of text.matchAll(/(?:\p{Script=Tibetan}+?་){3}\p{Script=Tibetan}+/gu)) {
      const syl = m[0].split('་').filter(Boolean);
      if (syl.length >= 4 && syl.every((s) => /^[ཀ-ྼ]+$/u.test(s))) cands.push(syl.slice(0, 4).join('་'));
    }
  } else {
    const { script } = STRATA[stratum];
    const minLen = stratum === 'latin_script' || stratum === 'english_translation' ? 4 : 3;
    // Runs of words joined by single spaces only.
    for (const m of text.matchAll(/[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)+/gu)) {
      const ws = m[0].split(' ');
      for (let i = 0; i + 4 <= ws.length; i++) {
        const n = 3 + Math.floor(rnd() * 3); // 3–5 words
        const w = ws.slice(i, i + n);
        if (w.length < 3) continue;
        if (!w.every((x) => script.test(x) && [...x].length >= minLen && !STOP.has(x.toLowerCase()))) continue;
        if (w.filter((x) => [...x].length >= 5).length < 2) continue;
        cands.push(w.join(' '));
      }
    }
  }
  if (cands.length === 0) return null;
  if (mode === 'distinctive' && stratum !== 'han' && stratum !== 'tibetan') {
    // Long words are rare words: the run whose shortest word is longest, then the longest run.
    const key = (c: string) => { const ls = c.split(' ').map((w) => [...w].length); return Math.min(...ls) * 1000 + ls.reduce((a, b) => a + b, 0); };
    const best = Math.max(...cands.map(key));
    const top = cands.filter((c) => key(c) === best);
    return top[Math.floor(rnd() * top.length)];
  }
  return cands[Math.floor(rnd() * cands.length)];
}

test('keyword known-item', async () => {
  const OUT = process.env.OUT;
  if (!OUT) throw new Error('set OUT=<file>');
  const URL_ = process.env.KEYWORD_SEARCH_URL, TOKEN = process.env.KEYWORD_SEARCH_TOKEN;
  if (!URL_ || !TOKEN) throw new Error('set KEYWORD_SEARCH_URL / KEYWORD_SEARCH_TOKEN');
  const { buildPageSearchStage, NON_CONTENT_PAGE_TYPES } = await import('@/lib/atlas-search');
  const { stripEditorialWrappers } = await import('@/lib/strip-editorial-wrappers');
  const { getReadDb } = await import('@/lib/mongodb');
  const db = await getReadDb();
  const rnd = mulberry(+(process.env.SEED || 2049));

  const LIVE = { visible: true, pages_count: { $gt: 0 }, hidden: { $ne: true } };
  const clean = (s: string) => stripEditorialWrappers(s || '').replace(/<[^>]{1,40}>/g, ' ');
  const fieldOf = (stratum: string) => (STRATA[stratum].field === 'ocr' ? 'ocr.data' : 'translation.data');
  const textOf = (stratum: string, page: any) => clean(STRATA[stratum].field === 'ocr' ? page?.ocr?.data : page?.translation?.data);

  // ---- the sample: random live pages per stratum, or the pages of a previous OUT ----
  type Pick = { stratum: string; language: string; book_id: string; page_number: number; random: string };
  const picks: Pick[] = [];
  if (process.env.SAMPLE_FROM) {
    for (const l of readFileSync(process.env.SAMPLE_FROM, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(l);
      picks.push({ stratum: r.stratum, language: r.language, book_id: r.book_id, page_number: r.page_number, random: r.arms?.random?.phrase ?? r.phrase });
    }
  } else {
    for (const [stratum, want] of Object.entries(QUOTAS)) {
      const books = await db.collection('books').aggregate([
        { $match: { ...LIVE, language: { $in: STRATA[stratum].langs } } },
        { $sample: { size: want * 6 } },
        { $project: { _id: 0, id: 1, language: 1 } },
      ]).toArray();
      let got = 0;
      for (const b of books) {
        if (got >= want) break;
        const [page] = await db.collection('pages').aggregate([
          { $match: { book_id: b.id, page_number: { $gt: 0 }, page_type: { $nin: NON_CONTENT_PAGE_TYPES }, [fieldOf(stratum)]: { $type: 'string' } } },
          { $sample: { size: 1 } },
          { $project: { _id: 0, book_id: 1, page_number: 1, [fieldOf(stratum)]: 1 } },
        ], { maxTimeMS: 20000 }).toArray();
        const text = textOf(stratum, page);
        if (text.length < 200) continue;
        const phrase = pickPhrase(text, stratum, rnd);
        if (!phrase) continue;
        got++;
        picks.push({ stratum, language: b.language, book_id: page.book_id, page_number: page.page_number, random: phrase });
      }
      console.log(`${stratum}: ${got}/${want} (${books.length} books drawn)`);
    }
  }
  writeFileSync(OUT, '');

  const atlasLane = async (q: string) => {
    const t = performance.now();
    try {
      const rows = await db.collection('pages').aggregate([
        buildPageSearchStage(q),
        { $match: { page_number: { $gt: 0 }, page_type: { $nin: NON_CONTENT_PAGE_TYPES } } },
        { $limit: 25 },
        { $project: { _id: 0, id: 1, book_id: 1, page_number: 1 } },
      ], { maxTimeMS: 8000 }).toArray() as any[];
      const ms = Math.round(performance.now() - t);
      // The route drops pages of books that are not live at its join.
      const live = new Set((await db.collection('books').find({ id: { $in: [...new Set(rows.map((p) => p.book_id))] }, ...LIVE }).project({ _id: 0, id: 1 }).toArray()).map((x) => x.id));
      return { rows: rows.filter((p) => live.has(p.book_id)).map((p) => ({ id: p.id, book_id: p.book_id, page_number: p.page_number })), n_raw: rows.length, ms, error: null as string | null, server_ms: null as number | null };
    } catch (e) { return { rows: [], n_raw: 0, ms: Math.round(performance.now() - t), error: String((e as Error).message).slice(0, 120), server_ms: null }; }
  };
  const svcLane = async (q: string) => {
    const t = performance.now();
    try {
      const r = await fetch(`${URL_.replace(/\/+$/, '')}/lane`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ query: q, k: 25, book_ids: null, variants: [], topic_words: [], variant_k: 10, rollup: null }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return { rows: [], n_raw: 0, ms: Math.round(performance.now() - t), error: `HTTP ${r.status}`, server_ms: null };
      const j = await r.json();
      return { rows: (j.main as any[]).map((p) => ({ id: p.page_id, book_id: p.book_id, page_number: p.page_number })), n_raw: j.main.length, ms: Math.round(performance.now() - t), error: null, server_ms: j.server_ms ?? null };
    } catch (e) { return { rows: [], n_raw: 0, ms: Math.round(performance.now() - t), error: String((e as Error).message).slice(0, 120), server_ms: null }; }
  };

  for (const [i, pk] of picks.entries()) {
    const [page] = await db.collection('pages').find({ book_id: pk.book_id, page_number: pk.page_number }, { projection: { _id: 0, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
    const distinctive = pickPhrase(textOf(pk.stratum, page), pk.stratum, rnd, 'distinctive') || pk.random;
    const arms: Record<string, string> = { random: pk.random, distinctive, quoted: `"${distinctive}"` };
    const out: Record<string, unknown> = {};
    for (const [arm, q] of Object.entries(arms)) {
      const [a, s] = [await atlasLane(q), await svcLane(q)];
      // Lenient: a returned page that prints the phrase (a duplicate scan, another edition) counts.
      const ids = [...new Set([...a.rows, ...s.rows].map((p) => p.id))];
      const docs = await db.collection('pages').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
      const np = norm(q.replace(/^"|"$/g, ''));
      const prints = new Set(docs.filter((d) => norm(clean(d.ocr?.data || '')).includes(np) || norm(clean(d.translation?.data || '')).includes(np)).map((d) => d.id));
      const isSrc = (x: { book_id: string; page_number: number }) => x.book_id === pk.book_id && x.page_number === pk.page_number;
      const rank = (xs: { id: string; book_id: string; page_number: number }[], lenient: boolean) => { const k = xs.findIndex((x) => isSrc(x) || (lenient && prints.has(x.id))); return k < 0 ? null : k + 1; };
      const side = (r: typeof a) => ({ n: r.rows.length, n_raw: r.n_raw, rank: rank(r.rows, false), rank_lenient: rank(r.rows, true), ms: r.ms, server_ms: r.server_ms, error: r.error });
      out[arm] = { phrase: q, atlas: side(a), svc: side(s) };
    }
    appendFileSync(OUT, JSON.stringify({ stratum: pk.stratum, language: pk.language, field: STRATA[pk.stratum].field, book_id: pk.book_id, page_number: pk.page_number, arms: out }) + '\n');
    if (i % 25 === 0) console.log(`${i + 1}/${picks.length}`);
  }
});
