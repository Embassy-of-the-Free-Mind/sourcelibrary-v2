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
const fileIdx = args.indexOf('--file');
const FILE = fileIdx >= 0 ? args[fileIdx + 1] : null;
const named = args.find(a => !a.startsWith('--') && a !== FILE);

/**
 * Campaigns. Each returns rows; keep them small and specific — "check this
 * blog post for errors" is answerable, "review the site" is not.
 */
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
  rows = c.build();
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
for (const r of rows) {
  // (queue, item_id) is uniquely indexed — re-running must refresh the prompt,
  // not duplicate the task or throw.
  const res = await col.updateOne(
    { queue: QUEUE, item_id: r.item_id },
    {
      $set: { payload: r, stratum: { campaign: r.campaign } },
      $setOnInsert: { queue: QUEUE, item_id: r.item_id, is_gold: false, created_at: new Date() },
    },
    { upsert: true },
  );
  if (res.upsertedCount) inserted++; else if (res.modifiedCount) updated++;
}
console.log(`\ninserted ${inserted}, updated ${updated}, pool now ${await col.countDocuments({ queue: QUEUE })}`);
await client.close();
