/**
 * Librarian citation fixer (#6946, stage 1) — gather every recorded answer into one replay set.
 *
 * Each item: the text the reader saw (the text the judges labelled), the whole pages read that turn
 * (support.json.gz of the run, rebuilt from Mongo by load-support.ts), the image records, and the pre-fix
 * per-link labels of that run's Opus judges, merged J1/J2 → J3 on a split (score-links.mjs merge), or J1
 * alone where only one judge ran (#6904 A, the dev set of #6956).
 *
 * The gauge's first run (2026-10-18 21:51 UTC, 20 live turns) kept no per-link labels: its turns are
 * rebuilt here from embassy_messages and the gauge's page set (cited ±1 + sources), with `before: null`;
 * label them with label-before.sh.
 *
 * PRIOR ART: scripts/eval/librarian-citations-6946/load-support.ts (the support pages, reused as stored);
 * scripts/eval/librarian-cite-ids-6946/score-links.mjs (the J1/J2/J3 merge); scripts/audit/librarian-citation-gauge.ts
 * (pagesFor: the gauge's page set, replicated for its turns).
 *
 * Usage:
 *   npx tsx --env-file=/root/sourcelibrary/.env.production.local scripts/eval/librarian-fixer-6946/build-items.ts --out=$JOB_SCRATCH/items.jsonl.gz
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { findPageLinks } from '@/lib/embassy/citation-pages';
import { loadSupportPages, resolveBookIds } from '@/lib/embassy/librarian';
import type { GroundingImage, GroundingPage } from '@/lib/embassy/grounding';

const arg = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const EVAL = path.join(HERE, '..');
const JOBS = '/data/scratch/sl/jobs';
const readMaybeGz = (f: string) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)) : fs.readFileSync(f)).toString('utf8');
const jsonl = (f: string) => readMaybeGz(f).split('\n').filter(Boolean).map(l => JSON.parse(l));

export type Label = { id: string; slug: string; page: number; label: string; j: string[] };
export interface Item {
  key: string; run: string; arm: string; qid: string; q: string; lang: 'en' | 'es'; text: string;
  pages: GroundingPage[]; images: GroundingImage[]; before: Label[] | null;
}

function labelsFrom(dir: string, tag: string, qid: string, links: Array<{ id: string; slug: string; page: number }>): Label[] | null {
  const read = (run: string) => {
    const f = path.join(dir, `${qid}-${tag}-${run}.json`);
    return fs.existsSync(f) ? new Map<string, string>((JSON.parse(fs.readFileSync(f, 'utf8')).links ?? []).map((l: { id: string; label: string }) => [l.id, l.label])) : null;
  };
  const [j1, j2, j3] = ['J1', 'J2', 'J3'].map(read);
  if (!j1) return null;
  return links.map(l => {
    const a = j1.get(l.id) ?? 'unlabelled';
    if (!j2) return { ...l, label: a, j: [a] };
    const b = j2.get(l.id) ?? 'unlabelled';
    if (a === b) return { ...l, label: a, j: [a, b] };
    const c = j3?.get(l.id);
    return { ...l, label: c ?? 'split', j: c ? [a, b, c] : [a, b] };
  });
}

const SOURCES: Array<{ run: string; arm: string; answers: string; support: string; labels: string; tag: string; main?: string }> = [
  { run: '6904', arm: 'B', answers: `${EVAL}/librarian-citations-6946/results/judge/before.jsonl.gz`, support: `${JOBS}/librarian-citations/support.json.gz`, labels: `${EVAL}/librarian-citations-6946/results/judge/out`, tag: 'before', main: `${EVAL}/librarian-speed-6904/results/main.jsonl.gz` },
  { run: '6904', arm: 'A', answers: `${JOBS}/librarian-citations/dev/before.jsonl`, support: `${JOBS}/librarian-citations/support.json.gz`, labels: `${EVAL}/librarian-citations-6946/results/dev/out`, tag: 'before', main: `${EVAL}/librarian-speed-6904/results/main.jsonl.gz` },
  ...['A', 'B', 'A2'].map(arm => ({ run: '6970', arm, answers: `${JOBS}/librarian-cite-prompt/answers-${arm}.jsonl`, support: `${JOBS}/librarian-cite-prompt/support.json.gz`, labels: `${EVAL}/librarian-cite-prompt-6946/results/links/out`, tag: arm, main: `${EVAL}/librarian-cite-prompt-6946/results/main.jsonl.gz` })),
  ...['A', 'B', 'C', 'A2'].map(arm => ({ run: '7021', arm, answers: `${JOBS}/librarian-cite-ids/answers-${arm}.jsonl`, support: `${JOBS}/librarian-cite-ids/support.json.gz`, labels: `${EVAL}/librarian-cite-ids-6946/results/links/out`, tag: arm, main: `${EVAL}/librarian-cite-ids-6946/results/main.jsonl.gz` })),
];

async function gaugeItems(): Promise<Item[]> {
  const first = JSON.parse(fs.readFileSync('/var/log/sourcelibrary/librarian-quality.jsonl', 'utf8').split('\n')[0]);
  const db = await getDb();
  const out: Item[] = [];
  for (const [n, threadId] of (first.sample as string[]).entries()) {
    const thread = await db.collection('embassy_threads').findOne({ _id: new ObjectId(threadId) }, { projection: { lang: 1 } });
    const msgs = await db.collection('embassy_messages').find({ threadId: new ObjectId(threadId) }).sort({ createdAt: 1 }).limit(4)
      .project({ authorType: 1, content: 1, sources: 1 }).toArray();
    const qi = msgs.findIndex(m => m.authorType === 'human');
    const a = msgs.slice(qi + 1).find(m => m.authorType === 'ai');
    if (!a) continue;
    const lang = thread?.lang === 'es' ? 'es' : 'en';
    const text = String(a.content ?? '');
    const sources = (a.sources ?? []) as Array<{ bookId?: string; pageNumber?: number; bookSlug?: string }>;
    const links = findPageLinks(text);
    const ids = await resolveBookIds([...new Set(links.map(l => l.slug))], sources.filter(s => s.bookId).map(s => ({ book_id: s.bookId!, bookSlug: s.bookSlug })) as never);
    const keys = new Set<string>();
    for (const l of links) {
      const id = ids.get(l.slug);
      if (id) for (const p of [l.page, l.page - 1, l.page + 1]) if (p >= 1) keys.add(`${id}:${p}`);
    }
    for (const s of sources) if (s.bookId && s.pageNumber) keys.add(`${s.bookId}:${s.pageNumber}`);
    const pages = await loadSupportPages([...keys], lang);
    out.push({ key: `gauge:G:g${String(n + 1).padStart(2, '0')}`, run: 'gauge', arm: 'G', qid: `g${String(n + 1).padStart(2, '0')}`, q: String(msgs[qi].content ?? ''), lang, text, pages, images: [], before: null });
  }
  return out;
}

async function main() {
  const items: Item[] = [];
  for (const s of SOURCES) {
    const support: Record<string, { pages: GroundingPage[]; images: GroundingImage[] }> = JSON.parse(readMaybeGz(s.support));
    const langs = new Map<string, string>();
    if (s.main) for (const r of jsonl(s.main)) langs.set(`${r.id}:${r.arm}`, r.lang);
    let n = 0, links = 0, unlabelled = 0;
    for (const r of jsonl(s.answers) as Array<{ key: string; q: string; text: string }>) {
      const qid = r.key.replace(/:.*/, '');
      const found = findPageLinks(r.text).map((l, i) => ({ id: `L${i + 1}`, slug: l.slug, page: l.page }));
      if (found.length === 0) continue;
      const sup = support[`${qid}:${s.arm}`];
      if (!sup) throw new Error(`no support for ${s.run} ${qid}:${s.arm}`);
      const before = labelsFrom(s.labels, s.tag, qid, found);
      if (!before) unlabelled++;
      items.push({
        key: `${s.run}:${s.arm}:${qid}`, run: s.run, arm: s.arm, qid, q: r.q, lang: langs.get(`${qid}:${s.arm}`) === 'es' ? 'es' : 'en',
        text: r.text, pages: sup.pages, images: sup.images ?? [], before,
      });
      n++; links += found.length;
    }
    console.log(`${s.run} ${s.arm}: ${n} answers with page links, ${links} links, ${unlabelled} without pre-fix labels`);
  }
  const g = await gaugeItems();
  console.log(`gauge: ${g.length} answers, ${g.reduce((x, i) => x + findPageLinks(i.text).length, 0)} links (labels: label-before.sh)`);
  items.push(...g);
  fs.writeFileSync(arg('out')!, zlib.gzipSync(items.map(i => JSON.stringify(i)).join('\n') + '\n'));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
