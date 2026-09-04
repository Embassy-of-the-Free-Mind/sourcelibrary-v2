/**
 * Queue up "go look at this page and tell us if anything is wrong" tasks.
 *
 * This is the cheap end of the volunteer system. A task is a URL, a question,
 * and a label — no component, no schema change, no deploy. Adding a new kind of
 * check means adding a CAMPAIGN below, or handing this script a JSON file.
 *
 *   node scripts/maintenance/build-page-check-candidates.mjs --list
 *   node scripts/maintenance/build-page-check-candidates.mjs blog
 *   node scripts/maintenance/build-page-check-candidates.mjs blog --apply
 *   node scripts/maintenance/build-page-check-candidates.mjs --file tasks.json --apply
 *
 * A JSON file is an array of { url, prompt?, label?, campaign?, item_id? }.
 *
 * DESIGN NOTE. The volunteer's real answer is the free-text note; the two
 * verdict buttons exist so the queue can drain visibly. Without a "looks right"
 * click there is no way to distinguish a page nobody has opened from a page
 * somebody checked and found fine, and the whole pool would look untouched
 * forever. Coverage is the thing a rating buys here, not judgment.
 */
import { MongoClient } from 'mongodb';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const QUEUE = 'page-check';
const SITE = 'https://sourcelibrary.org';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argOf = (n, d) => args.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const fileIdx = args.indexOf('--file');
const FILE = fileIdx >= 0 ? args[fileIdx + 1] : null;
const named = args.find(a => !a.startsWith('--') && a !== FILE);

/**
 * Campaigns. Each returns rows; keep them small and specific — "check this
 * blog post for errors" is answerable, "review the site" is not.
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/**
 * Turn a defect MARKER into a campaign.
 *
 * Most live OCR defects have a fingerprint that the public search index can
 * already find — the text a reader sees is indexed, so a bug that reaches the
 * reader is searchable by definition. This walks a set of probes, collects the
 * page hits, and hands each one to a volunteer as "go and look".
 *
 * Why the public search API and not Mongo or Supabase: an `ilike '%marker%'`
 * over `page_translations` has no index to use and times out, and a regex over
 * `pages` (19.1M docs) is a full collection scan. The search index is the one
 * place this lookup is cheap — and it is also, by construction, exactly the set
 * of pages a reader could stumble on.
 *
 * `perBook` keeps one bad book from filling the queue: three pages is enough to
 * confirm a pattern, and the volunteer is asked to note whether the rest of the
 * book looks the same.
 */
async function markerCampaign({
  probes, prompt, label, campaign, idPrefix, perBook = 3,
  confirm = () => true,
}) {
  const byPage = new Map();
  const perBookCount = new Map();
  let rejected = 0;

  for (const probe of probes) {
    const res = await fetch(
      `${SITE}/api/search?q=${encodeURIComponent(probe)}&limit=50`,
      { headers: { 'User-Agent': UA } },
    );
    if (!res.ok) {
      console.warn(`  probe "${probe}" → HTTP ${res.status} (skipped)`);
      continue;
    }
    const data = await res.json();
    const hits = (data.results ?? []).filter(r => r.type === 'page' && r.page_id && r.slug);
    console.warn(`  probe "${probe}" → ${data.total} total, ${hits.length} page hits`);
    for (const h of hits) {
      if (byPage.has(h.page_id)) continue;
      // A search hit is a candidate, not a confirmation: a probe word can match
      // an ordinary sentence. `confirm` looks at the indexed snippet — the text
      // a reader actually sees — so a volunteer is never sent to a page where
      // there is nothing to find. Sending someone to look at a false positive
      // spends the one thing this system is short of.
      if (!confirm(h)) { rejected++; continue; }
      const n = perBookCount.get(h.book_id) ?? 0;
      if (n >= perBook) continue;
      perBookCount.set(h.book_id, n + 1);
      byPage.set(h.page_id, {
        item_id: `${idPrefix}:${h.page_id}`,
        url: `${SITE}/book/${h.slug}/page/${h.page_id}`,
        label,
        campaign,
        prompt: `${prompt}\n\nThis is page ${h.page_number} of “${h.title}”.`,
      });
    }
    // The edge bot-limiter allows ~10 requests a minute; probes are few, so a
    // short pause is cheaper than being throttled halfway through a build.
    await new Promise(r => setTimeout(r, 3000));
  }
  if (rejected) console.warn(`  ${rejected} hit(s) rejected: the snippet showed no defect`);
  return [...byPage.values()];
}

const CAMPAIGNS = {
  blog: {
    describe: 'Every blog post, read for factual and typographic errors',
    build() {
      const dir = path.join(process.cwd(), 'src/app/blog');
      return readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort()
        .map(slug => ({
          item_id: `blog:${slug}`,
          url: `${SITE}/blog/${slug}`,
          label: 'the post',
          campaign: 'Blog posts',
          prompt:
            'Read this post. Does anything look wrong — a date, a name, a claim about a book, ' +
            'a broken link, a typo? Quotations especially: they should match the source exactly.',
        }));
    },
  },
  es: {
    describe: 'The Spanish pages, read by someone who reads Spanish',
    build() {
      return [
        { slug: '', label: 'the Spanish homepage' },
        { slug: 'support', label: 'the Spanish support page' },
      ].map(p => ({
        item_id: `es:${p.slug || 'home'}`,
        url: `${SITE}/es${p.slug ? '/' + p.slug : ''}`,
        label: p.label,
        campaign: 'Spanish pages',
        prompt:
          'Read this page as a Spanish speaker. Does the Spanish read naturally, and does ' +
          'anything still appear in English that should not?',
      }));
    },
  },

  // ── Campaigns pointed at live, open defects ──────────────────────────────
  // These exist so volunteer minutes land on something the tracker is actually
  // trying to close, rather than on a generic "is this scan blurry". Each names
  // its issue in the campaign label, so an answer can be carried back to it.
  'tex-greek': {
    describe: 'Greek printed as LaTeX code in the text readers see (#4580)',
    build: () =>
      markerCampaign({
        idPrefix: 'tex',
        label: 'the page',
        campaign: 'Greek rendered as LaTeX (#4580)',
        // Six fingerprints of the same failure: the model draws the SHAPE of a
        // Greek word as maths notation instead of transcribing it as Greek.
        probes: ['varsigma', 'mathrm', 'overline', 'varepsilon', 'lambda\\', 'begin{aligned}'],
        // A literal backslash in running prose is essentially always TeX. This
        // is what separates a page that PRINTS \varsigma from a translation that
        // happens to discuss the word "overline".
        confirm: h => typeof h.snippet === 'string' && h.snippet.includes('\\'),
        prompt:
          'The transcription on this page may show LaTeX code — things like \\alpha, ' +
          '$\\varsigma$ or \\overline{} — where the book actually prints Greek letters. ' +
          'Compare the text with the scan beside it. Is code standing in for Greek? ' +
          'If you read Greek, the useful extra is what the word should say. And please ' +
          'note whether the rest of the book does the same thing, or only this page.',
      }),
  },

  /**
   * The one task no machine can do for us.
   *
   * Everything else in this file is a defect a script could in principle find:
   * a marker in the text, a script that does not match the folio. Translation
   * FIDELITY is different in kind. Asking a model whether a translation is
   * faithful, when the same model family produced the transcription AND the
   * translation, measures agreement with itself — it is circular, and it is
   * exactly how 529 Tibetan books came to carry invented scripture that read
   * fluently all the way through. A person who reads Latin is not replaceable
   * here by a better prompt.
   *
   * SAMPLING. Stratified RANDOM within a language, never self-selected. This is
   * the "panel" lane of .claude/docs/community-quality-review-design.md and its
   * whole purpose is a number that generalises: "how good is our Latin on the
   * books enthusiasts happen to like" is not a corpus statistic. Volunteers who
   * want to pick their own text are welcome to — through the feedback widget on
   * any page — but those answers belong to the other lane and must not be mixed
   * into this pool.
   *
   * WHY ~35 PAGES PER LANGUAGE. Every corpus-wide quality claim we publish
   * currently rests on 32 human-verified anchor pages, and the calibration
   * scorecard refuses to fit a stratum below five. About 35 judgments buys ±10%
   * for a language at 95% confidence; ~140 buys ±5%. Say the small number out
   * loud — everyone assumes this work is unbounded, and it is the boundedness
   * that makes people start.
   *
   *   node scripts/maintenance/build-page-check-candidates.mjs translations \
   *     --language=Latin --n=40 [--apply]
   */
  translations: {
    describe: 'Spot-check a translation against its original (--language=, --n=)',
    async build() {
      const language = argOf('language', 'Latin');
      const n = parseInt(argOf('n', '40'), 10);
      if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI required to build this campaign');
        process.exit(1);
      }
      const client = new MongoClient(process.env.MONGODB_URI);
      await client.connect();
      const db = client.db('bookstore');

      // `language` is the EDITION's language — the script actually on the page,
      // which is what a reader will be comparing against. See
      // .claude/docs/invariants/language-fields.md.
      const books = await db.collection('books')
        .find(
          { language, visible: true, pages_count: { $gt: 0 }, pages_ocr: { $gt: 0 } },
          { projection: { id: 1, title: 1, slug: 1, published: 1, author: 1 } },
        )
        .limit(600)
        .toArray();
      console.warn(`  ${books.length} live ${language} books with transcription`);

      const rows = [];
      const shuffled = books.sort(() => Math.random() - 0.5);
      for (const b of shuffled) {
        if (rows.length >= n) break;
        const bookId = b.id ?? String(b._id);
        // One page per book: pages within a book are one observation, not many
        // (memory: lesson_sample_one_page_per_book). A book that reads well on
        // page 40 tells you little extra about page 41.
        const [page] = await db.collection('pages')
          .aggregate([
            {
              $match: {
                book_id: bookId,
                'ocr.data': { $type: 'string', $ne: '' },
                'translation.data': { $type: 'string', $ne: '' },
              },
            },
            { $sample: { size: 1 } },
            { $project: { page_number: 1 } },
          ])
          .toArray();
        if (!page) continue;
        rows.push({
          queue: 'translation-check',
          item_id: `trans:${language}:${page._id}`,
          url: `${SITE}/book/${b.slug ?? bookId}/page/${page._id}`,
          label: 'the page',
          language,
          campaign: `Translation check — ${language}`,
          prompt:
            `You read ${language}. This page shows the scan, our transcription of it, ` +
            'and our English. Two separate questions, in this order: does the ' +
            'transcription match what is actually on the page, and does the English ' +
            'match the original?' +
            (b.title ? `\n\nThis is “${b.title}”${b.published ? `, ${b.published}` : ''}.` : ''),
        });
      }
      await client.close();
      return rows;
    },
  },
};

if (args.includes('--list') || (!named && !FILE)) {
  console.log('Campaigns:');
  for (const [k, c] of Object.entries(CAMPAIGNS)) console.log(`  ${k.padEnd(8)} ${c.describe}`);
  console.log('\nOr: --file tasks.json  (array of { url, prompt?, label?, campaign?, item_id? })');
  process.exit(0);
}

let rows;
if (FILE) {
  const raw = JSON.parse(readFileSync(FILE, 'utf8'));
  if (!Array.isArray(raw)) { console.error('The file must contain an array.'); process.exit(1); }
  rows = raw.map((r, i) => {
    if (!r.url) { console.error(`Row ${i} has no url.`); process.exit(1); }
    return {
      item_id: r.item_id || `file:${r.url}`,
      url: r.url,
      label: r.label || 'the page',
      campaign: r.campaign || path.basename(FILE, '.json'),
      prompt: r.prompt || 'Have a look at this page. Is anything wrong with it?',
    };
  });
} else {
  const c = CAMPAIGNS[named];
  if (!c) { console.error(`Unknown campaign "${named}". Try --list.`); process.exit(1); }
  rows = await c.build();
}

console.log(`${rows.length} task(s)`);
for (const r of rows.slice(0, 3)) console.log(`  ${r.item_id}\n    ${r.url}\n    ${r.prompt.slice(0, 90)}...`);
if (rows.length > 3) console.log(`  ... and ${rows.length - 3} more`);

if (!APPLY) { console.log('\nDry run. Re-run with --apply to queue these.'); process.exit(0); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const col = client.db('bookstore').collection('review_candidates');
let inserted = 0, updated = 0;
const queuesTouched = new Set();
for (const r of rows) {
  // A campaign may target a queue other than page-check — `translations` goes to
  // `translation-check`, whose verdicts separate the transcription layer from
  // the translation layer. Default stays page-check so every existing campaign
  // and every --file run behaves exactly as before.
  const queue = r.queue ?? QUEUE;
  queuesTouched.add(queue);
  // (queue, item_id) is uniquely indexed — re-running must refresh the prompt,
  // not duplicate the task or throw.
  const res = await col.updateOne(
    { queue, item_id: r.item_id },
    {
      $set: { payload: r, stratum: { campaign: r.campaign, language: r.language } },
      $setOnInsert: { queue, item_id: r.item_id, is_gold: false, created_at: new Date() },
    },
    { upsert: true },
  );
  if (res.upsertedCount) inserted++; else if (res.modifiedCount) updated++;
}
for (const q of queuesTouched) {
  console.log(`\ninserted ${inserted}, updated ${updated}, ${q} pool now ${await col.countDocuments({ queue: q })}`);
}
await client.close();
