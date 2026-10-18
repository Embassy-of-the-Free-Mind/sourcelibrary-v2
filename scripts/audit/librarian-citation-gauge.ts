/**
 * Standing weekly gauge (#6946): how many Librarian page links land on a page that does not say the
 * thing they are attached to. Samples real readers' first turns from the last 7 days, rebuilds the pages
 * each answer cites and read (whole page text, from Mongo), and has Opus judges (`claude -p` on the
 * subscription — never an API, never agy, no Gemini) label every page link with the #6946 instrument.
 *
 * One JSON line per run → /var/log/sourcelibrary/librarian-quality.jsonl; one row appended to the
 * markdown table beside it (librarian-quality.md). Not into the repo: this runs from the shared main
 * checkout, which is git-pulled hourly and must stay clean.
 * ntfy (sourcelibrary-uptime) and a comment on #6946 ONLY on a change of state: the wrong-page rate
 * 10 points or more above the median of the previous 4 runs (state `high`), or back under it (`ok`).
 *
 * Sampling: threads of type `chat` created in the window; the first human message and the AI reply after
 * it. Skipped: short-circuited replies (greeting, keepalive ping, duplicate, replay), replayed answers
 * (`cachedFrom`), answers with no page link, and any question that carries personal data (an email
 * address, a phone number, "my name is" / "me llamo"). Seeded by the run date, so a re-run picks the same
 * turns. At most 25 Opus calls per run (20 packets + retries).
 *
 * Usage (weekly cron on l7a, infrastructure/l7a-crontab):
 *   npx tsx --env-file=/root/sourcelibrary/.env.production.local scripts/audit/librarian-citation-gauge.ts \
 *     [--n=20] [--days=7] [--dry-run]   (dry run: judges and prints, writes no log, sends nothing)
 *
 * PRIOR ART: scripts/eval/librarian-citations-6946/ (the instrument: packet.ts, JUDGE-PROMPT.md,
 * judge-driver.sh — this runs it on live turns instead of a replay); scripts/audit/search-probe.mjs (the
 * JSONL-log + ntfy-on-state-change pattern, reused); scripts/eval/librarian-speed-6904/build-packets.ts
 * (whole-page packets; a page cut short reads as "does not say it").
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { findPageLinks } from '@/lib/embassy/citation-pages';
import { loadSupportPages, resolveBookIds } from '@/lib/embassy/librarian';
import { judgePacket, tallyLabels } from '../eval/librarian-citations-6946/packet';

const arg = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const DRY = process.argv.includes('--dry-run');
const N = Number(arg('n', '20'));
const DAYS = Number(arg('days', '7'));
const MAX_OPUS_CALLS = 25;
const PARALLEL = 4;
const LOG = '/var/log/sourcelibrary/librarian-quality.jsonl';
const TABLE = '/var/log/sourcelibrary/librarian-quality.md';
const NTFY = 'https://ntfy.sh/sourcelibrary-uptime';
const ISSUE = '6946';
const RISE = 0.10;
const TRAILING = 4;
const JUDGE_MODEL = 'opus (claude -p, subscription)';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PROMPT = fs.readFileSync(path.join(HERE, '../eval/librarian-citations-6946/JUDGE-PROMPT.md'), 'utf8');
const CLAUDE = process.env.CLAUDE_BIN || path.join(os.homedir(), '.local/bin/claude');

/** Personal data in a question: the turn is not sent anywhere. */
const PERSONAL = [
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /(?:\+?\d[\d\s().-]{8,}\d)/,
  /\b(?:my name is|i am called|me llamo|mi nombre es|je m'appelle|ich heiße|mijn naam is)\b/i,
];

type Turn = { threadId: string; question: string; answer: string; sources: Array<{ bookId?: string; pageNumber?: number; bookSlug?: string }>; lang: 'en' | 'es' };

function seededShuffle<T>(xs: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1e9) / 1e9; };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

async function sampleTurns(): Promise<{ turns: Turn[]; eligible: number; threads: number; skipped: Record<string, number> }> {
  const db = await getDb();
  const since = new Date(Date.now() - DAYS * 864e5);
  const threads = await db.collection('embassy_threads')
    .find({ type: 'chat', createdAt: { $gte: since } }).project({ _id: 1, lang: 1 }).toArray();
  const skipped: Record<string, number> = { no_reply: 0, short_circuit: 0, replayed: 0, no_page_link: 0, personal_data: 0 };
  const eligible: Turn[] = [];
  for (const t of seededShuffle(threads, new Date().toISOString().slice(0, 10))) {
    const msgs = await db.collection('embassy_messages')
      .find({ threadId: t._id as ObjectId }).sort({ createdAt: 1 }).limit(4)
      .project({ authorType: 1, content: 1, sources: 1, shortCircuit: 1, cachedFrom: 1 }).toArray();
    const qi = msgs.findIndex(m => m.authorType === 'human');
    const a = qi >= 0 ? msgs.slice(qi + 1).find(m => m.authorType === 'ai') : undefined;
    if (!a) { skipped.no_reply++; continue; }
    if (a.shortCircuit) { skipped.short_circuit++; continue; }
    if (a.cachedFrom) { skipped.replayed++; continue; }
    const question = String(msgs[qi].content ?? '');
    const answer = String(a.content ?? '');
    if (findPageLinks(answer).length === 0) { skipped.no_page_link++; continue; }
    if (PERSONAL.some(re => re.test(question))) { skipped.personal_data++; continue; }
    eligible.push({ threadId: String(t._id), question, answer, sources: (a.sources ?? []) as Turn['sources'], lang: t.lang === 'es' ? 'es' : 'en' });
    if (eligible.length >= N) break;
  }
  return { turns: eligible, eligible: eligible.length, threads: threads.length, skipped };
}

/** The pages the answer cites, their neighbours (a quotation runs over the break) and the pages it read. */
async function pagesFor(t: Turn) {
  const links = findPageLinks(t.answer);
  const ids = await resolveBookIds([...new Set(links.map(l => l.slug))], t.sources.filter(s => s.bookId).map(s => ({ book_id: s.bookId!, bookSlug: s.bookSlug })) as never);
  const keys = new Set<string>();
  for (const l of links) {
    const id = ids.get(l.slug);
    if (!id) continue;
    for (const p of [l.page, l.page - 1, l.page + 1]) if (p >= 1) keys.add(`${id}:${p}`);
  }
  for (const s of t.sources) if (s.bookId && s.pageNumber) keys.add(`${s.bookId}:${s.pageNumber}`);
  return loadSupportPages([...keys], t.lang);
}

let opusCalls = 0;
function judge(packet: string): Promise<Array<{ id: string; label: string }> | null> {
  return new Promise(resolve => {
    const attempt = (left: number) => {
      if (opusCalls >= MAX_OPUS_CALLS) return resolve(null);
      opusCalls++;
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY; // the subscription, never the API
      const child = execFile(CLAUDE, ['-p', '--model', 'opus', '--allowedTools', ''], { cwd: os.tmpdir(), env, timeout: 15 * 60e3, maxBuffer: 8 << 20 }, (err, stdout) => {
        const m = String(stdout ?? '').match(/\{"links".*\}/g);
        try { if (m) return resolve(JSON.parse(m[m.length - 1]).links ?? null); } catch { /* retry */ }
        if (/usage limit|hit your limit|limit reached/i.test(String(stdout) + String(err ?? ''))) return resolve(null);
        if (left > 0) return setTimeout(() => attempt(left - 1), 20e3);
        resolve(null);
      });
      child.stdin?.end(`${PROMPT}${packet}`);
    };
    attempt(1);
  });
}

async function ntfy(title: string, body: string, priority: string) {
  await fetch(NTFY, { method: 'POST', headers: { Title: title, Priority: priority, Tags: 'books' }, body, signal: AbortSignal.timeout(10000) }).catch(() => {});
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

async function main() {
  const t0 = Date.now();
  const { turns, threads, skipped } = await sampleTurns();
  const results: Array<{ threadId: string; links: number; labels: Array<{ label: string }> | null }> = [];
  const queue = [...turns];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const pages = await pagesFor(t);
      const { md, links } = judgePacket(t.question, t.answer, pages);
      const labels = await judge(md);
      results.push({ threadId: t.threadId, links: links.length, labels: labels ? links.map(l => ({ label: labels.find(x => x.id === l.id)?.label ?? 'unlabelled' })) : null });
    }
  }));
  const judged = results.filter(r => r.labels);
  const tally = tallyLabels(judged.map(r => r.labels!));

  const history: Array<{ wrong_page_rate: number | null; state?: string }> = fs.existsSync(LOG)
    ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const prior = history.filter(h => typeof h.wrong_page_rate === 'number').slice(-TRAILING).map(h => h.wrong_page_rate as number);
  const base = median(prior);
  const rate = tally.wrongPageRate;
  // Too few runs to have a baseline, or too few judged turns this run: no verdict, no alert.
  const state = rate === null || judged.length < 10 ? 'unjudged' : base === null ? 'ok' : rate >= base + RISE ? 'high' : 'ok';
  const prevState = [...history].reverse().find(h => h.state === 'ok' || h.state === 'high')?.state ?? 'ok';

  const line = {
    ts: new Date().toISOString(), window_days: DAYS, threads_in_window: threads, skipped,
    n_turns: judged.length, n_unjudged: results.length - judged.length, n_links: tally.judged, counts: tally.counts,
    wrong_page_rate: rate === null ? null : +rate.toFixed(4), wrong_fact_rate: tally.wrongFactRate === null ? null : +tally.wrongFactRate.toFixed(4),
    answers_with_wrong_page: tally.answersWrongPage, trailing_median: base === null ? null : +base.toFixed(4), state,
    judge_model: JUDGE_MODEL, opus_calls: opusCalls, ms: Date.now() - t0, sample: results.map(r => r.threadId),
  };
  console.log(JSON.stringify(line));
  if (DRY) return;

  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(line) + '\n');
  if (!fs.existsSync(TABLE)) {
    fs.writeFileSync(TABLE, '# Librarian page links — weekly gauge (#6946)\n\nWrong-page = the link lands on a page that does not say it (other page + no page). Opus judges, whole pages.\n\n| run (UTC) | turns | links | wrong-page | wrong fact | answers with a wrong-page link | trailing median | state |\n|---|---:|---:|---:|---:|---:|---:|---|\n');
  }
  const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
  fs.appendFileSync(TABLE, `| ${line.ts.slice(0, 16)} | ${line.n_turns} | ${line.n_links} | ${pct(line.wrong_page_rate)} | ${pct(line.wrong_fact_rate)} | ${line.answers_with_wrong_page}/${line.n_turns} | ${pct(line.trailing_median)} | ${state} |\n`);

  if ((state === 'ok' || state === 'high') && state !== prevState) {
    const body = `Wrong-page rate ${pct(rate)} of ${tally.judged} page links in ${judged.length} Librarian answers (last ${DAYS} days); trailing ${TRAILING}-run median ${pct(base)}. ${tally.answersWrongPage}/${judged.length} answers have at least one. Log: ${LOG} on l7a. #${ISSUE}`;
    if (state === 'high') await ntfy('Librarian links: wrong-page rate UP', body, 'high');
    else await ntfy('Librarian links: wrong-page rate back to normal', body, 'low');
    await new Promise<void>(res => execFile('gh', ['issue', 'comment', ISSUE, '--body', `**Weekly citation gauge — state ${prevState} → ${state}.** ${body}`], () => res()));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
