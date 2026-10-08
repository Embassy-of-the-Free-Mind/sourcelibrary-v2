/**
 * One decision queue for Derek (#6258): the pure half — card building, ordering,
 * and the shape of a recorded answer. No I/O here, so every rule is unit-tested
 * (tests/unit/decision-queue.test.ts); the fetchers live in
 * decision-queue-sources.ts and the page in /platform/admin/decisions.
 *
 * PRIOR ART: scripts/maintenance/safe-merge.sh — the merge checks a PR card's
 * Default defers to (this file only decides what the card SAYS; the Hetzner
 * drainer runs safe-merge.sh itself). The ops DECISIONS-PENDING.md is read by
 * the `/decisions` terminal command on Derek's laptop, which has no code in this
 * repo to reuse; src/app/shared/[slug]/route.ts is the existing ops-repo reader.
 *
 * Three sources, one card shape:
 *   pr      — open PRs labelled tier:hold (Default = queue a safe-merge)
 *   ops     — rows of the private ops repo's DECISIONS-PENDING.md (answers recorded)
 *   session — stuck background sessions (stage 2; read-only placeholder today)
 */
import { createHash } from 'crypto';

export type DecisionSource = 'pr' | 'ops' | 'session';
export type DecisionChoice = 'default' | 'other' | 'skip';

export interface DecisionCard {
  /** Stable across page loads; an answer is keyed to it. */
  id: string;
  source: DecisionSource;
  question: string;
  /** The recommended answer, as the row or PR states it. */
  defaultLabel: string;
  /** What pressing Default will actually do, in plain words. */
  defaultDoes: string;
  /** False when Default would do nothing useful (PR not mergeable): the button skips instead. */
  defaultActionable: boolean;
  evidence: { label: string; url: string }[];
  /** Set when the card cannot be decided on a phone; the UI says so and offers Skip. */
  needsDesk?: string;
  /** Short context lines (cost, what is ready, PR size). */
  details: string[];
  /** ISO date the decision was raised (PR opened, row added). */
  raisedAt: string | null;
  /** Dollars at stake when the row states them; 0 when unknown. */
  costUsd: number;
  /** Source-specific reference the answer carries to whoever acts on it. */
  ref: { pr?: number; headSha?: string; section?: string; line?: number };
  /** A previous answer that failed to act (refused merge); shown on the card. */
  lastAttempt?: string;
}

export const OPS_REPO = 'Embassy-of-the-Free-Mind/sourcelibrary-ops';
export const OPS_FILE = 'DECISIONS-PENDING.md';
export const CODE_REPO = 'Embassy-of-the-Free-Mind/sourcelibrary-v2';

/** A PR bigger than this is not read on a phone. */
const DESK_FILES = 15;
const DESK_LINES = 400;

export function cardId(source: DecisionSource, key: string): string {
  return `${source}:${createHash('sha1').update(key).digest('hex').slice(0, 16)}`;
}

// ── Source A: tier:hold PRs ─────────────────────────────────────────────────

/** The GraphQL fields the page fetches per PR (see decision-queue-sources.ts). */
export interface HoldPr {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  isDraft: boolean;
  baseRefName: string;
  headRefOid: string;
  mergeable: string; // MERGEABLE | CONFLICTING | UNKNOWN
  mergeStateStatus: string; // CLEAN | BLOCKED | UNSTABLE | DIRTY | BEHIND | UNKNOWN | ...
  labels: string[];
  additions: number;
  deletions: number;
  changedFiles: number;
  author: string | null;
  body?: string | null;
  /** Names of finished checks that did not pass, Vercel set aside (see failingChecksOf). Absent = not fetched. */
  failingChecks?: string[];
}

/** One entry of a commit's check rollup, as GitHub GraphQL returns it (CheckRun or StatusContext). */
export interface CheckNode {
  name?: string | null;
  conclusion?: string | null;
  context?: string | null;
  state?: string | null;
}

/**
 * The checks safe-merge.sh would refuse on: finished and not passing. Vercel is
 * set aside exactly as safe-merge.sh and auto-merge.mjs do (previews are opt-in,
 * so a red Vercel check is not gating). A check still running is not a failure.
 */
export function failingChecksOf(nodes: CheckNode[]): string[] {
  const failed = new Set<string>();
  const passed = new Set<string>();
  for (const n of nodes) {
    const name = n.name ?? n.context ?? '';
    if (!name || name === 'Vercel') continue;
    const verdict = (n.conclusion ?? n.state ?? '').toUpperCase();
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'CANCELLED', 'STARTUP_FAILURE'].includes(verdict)) failed.add(name);
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(verdict)) passed.add(name);
  }
  // A check that ran twice on one commit (a label event re-triggers `tier`, and the
  // concurrency group cancels the first run) shows a cancelled run beside a passing
  // one. On 2026-10-08 that was 24 of 74 held PRs: it is not a failure.
  return [...failed].filter((name) => !passed.has(name)).sort();
}

/**
 * Why safe-merge.sh would refuse this PR right now, mirroring its `judge()`
 * gates that can be read without running it. Null = it would proceed to merge.
 * UNSTABLE is let through, as safe-merge.sh does when Vercel is the only
 * non-passing check; the drainer's real run decides the rest.
 */
export function prMergeBlocker(pr: HoldPr): string | null {
  if (pr.isDraft) return 'it is a draft';
  if (pr.labels.includes('blocked')) return 'it carries the `blocked` label';
  if (pr.baseRefName !== 'main') return `it is stacked on ${pr.baseRefName}; merge its parent first`;
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') return 'it has merge conflicts';
  if (pr.mergeStateStatus === 'BEHIND') return 'it is behind main';
  if (pr.mergeStateStatus === 'BLOCKED') return 'a required check is failing or still running';
  // safe-merge.sh refuses a PR with a finished, failed check, so a merge tap would
  // only bounce: the PR is its author's to fix before it is Derek's to decide (#6280).
  // CLEAN is GitHub's own verdict and safe-merge.sh takes it before reading any check.
  if (pr.failingChecks?.length && pr.mergeStateStatus !== 'CLEAN') {
    return `${pr.failingChecks.length === 1 ? 'a check is' : 'checks are'} failing (${pr.failingChecks.slice(0, 4).join(', ')})`;
  }
  return null;
}

function previewUrlFrom(body: string | null | undefined): string | null {
  const m = (body || '').match(/https:\/\/[a-z0-9-]+\.vercel\.app[^\s)>\]]*/i);
  return m ? m[0] : null;
}

export function prCard(pr: HoldPr): DecisionCard {
  const blocker = prMergeBlocker(pr);
  const size = pr.additions + pr.deletions;
  const sha = pr.headRefOid.slice(0, 7);
  const evidence = [{ label: `PR #${pr.number}`, url: pr.url }, { label: 'Files', url: `${pr.url}/files` }];
  const preview = previewUrlFrom(pr.body);
  if (preview) evidence.push({ label: 'Preview', url: preview });
  const unknown = pr.mergeable === 'UNKNOWN' || pr.mergeStateStatus === 'UNKNOWN';
  return {
    // Keyed to the head commit: a new push is a new decision.
    id: cardId('pr', `${pr.number}@${pr.headRefOid}`),
    source: 'pr',
    question: `Merge #${pr.number}: ${pr.title}?`,
    defaultLabel: blocker ? 'Not now' : 'Merge',
    defaultDoes: blocker
      ? `Nothing to merge yet: ${blocker}. Default skips this card for a day.`
      : `Queues a squash-merge of ${sha} for the Hetzner drainer, which runs safe-merge.sh: entities interlock, CLEAN mergeable${unknown ? ' (GitHub is still computing it)' : ''}, stacked PRs retargeted first. It refuses if anyone pushes after you answer. Merging deploys production.`,
    defaultActionable: !blocker,
    evidence,
    needsDesk: pr.changedFiles > DESK_FILES || size > DESK_LINES
      ? `${pr.changedFiles} files, +${pr.additions} −${pr.deletions}: read the diff at a desk`
      : undefined,
    details: [
      `${pr.changedFiles} files · +${pr.additions} −${pr.deletions} · ${pr.mergeStateStatus.toLowerCase()}`,
      ...(pr.author ? [`by ${pr.author}`] : []),
      ...(pr.labels.filter((l) => l !== 'tier:hold').length
        ? [`labels: ${pr.labels.filter((l) => l !== 'tier:hold').join(', ')}`] : []),
    ],
    raisedAt: pr.createdAt,
    costUsd: 0,
    ref: { pr: pr.number, headSha: pr.headRefOid },
  };
}

// ── Source B: the ops DECISIONS-PENDING.md ─────────────────────────────────

/** Sections that are not pending decisions. */
const NOT_PENDING = /^(done\b|running now)/i;

function stripMd(s: string): string {
  return s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

function boldSpans(s: string): string[] {
  return [...s.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1].trim());
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

const RECO = /^(recommended(?: default)?|default)\s*:\s*/i;

/** Largest dollar figure in a cell ("≈ $72 realtime, $35 over" → 72). */
export function parseCostUsd(s: string): number {
  let max = 0;
  for (const m of s.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|K)?/g)) {
    const v = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

function sectionDate(heading: string): string | null {
  const m = heading.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function evidenceFrom(text: string, line: number): { label: string; url: string }[] {
  const out = [{ label: 'Ops row', url: `https://github.com/${OPS_REPO}/blob/main/${OPS_FILE}#L${line}` }];
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?<![\w/])#(\d{3,5})\b/g)) {
    if (seen.has(m[1]) || seen.size >= 4) continue;
    seen.add(m[1]);
    out.push({ label: `#${m[1]}`, url: `https://github.com/${CODE_REPO}/issues/${m[1]}` });
  }
  for (const m of text.matchAll(/\b(handoffs\/[\w./-]+\.md)\b/g)) {
    out.push({ label: m[1].split('/').pop()!, url: `https://github.com/${OPS_REPO}/blob/main/${m[1]}` });
    break;
  }
  return out;
}

/**
 * Cards from the ops file. A pending row is a table data row or a top-level
 * bullet under a `## ` section that is not `Done …` or `Running now …`.
 * Rows already marked DECIDED are skipped. The text before the first `## ` is
 * the file's rules, not decisions.
 */
export function parseOpsDecisions(markdown: string): DecisionCard[] {
  const cards: DecisionCard[] = [];
  let section: string | null = null;
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const h = raw.match(/^##\s+(.*)$/);
    if (h) { section = h[1].trim(); continue; }
    if (!section || NOT_PENDING.test(section)) continue;

    let lead: string; // the cell or bullet carrying the decision
    let rest: string[] = [];
    if (raw.startsWith('|')) {
      const cells = raw.split('|').slice(1, -1).map((c) => c.trim());
      if (!cells.length || /^-+$/.test(cells[0].replace(/[: ]/g, '')) || /^decision$/i.test(cells[0])) continue;
      [lead, ...rest] = cells;
    } else if (raw.startsWith('- ')) {
      lead = raw.slice(2);
    } else {
      continue;
    }
    if (/^\*\*decided\b/i.test(lead) || !lead.trim()) continue;

    const spans = boldSpans(lead);
    const first = spans[0] ?? '';
    // "**Default: X**", or "Recommended default: **X**" with the keyword outside the bold.
    const reco = spans.find((s) => RECO.test(s))
      ?? lead.match(/(?:recommended(?: default)?|default)\s*:\s*\*\*(.+?)\*\*/i)?.[1]
      ?? null;
    const sectionTitle = section.replace(/\s*\(.*\)\s*$/, '');
    let question: string;
    let defaultLabel: string;
    if (reco && reco !== first) {
      // "**Switch on X** … **Default: yes.**" — the first bold is the question.
      question = stripMd(first);
      defaultLabel = stripMd(reco.replace(RECO, ''));
    } else if (first && !reco && first.endsWith('?')) {
      // A bold question with no recommendation; the file's rules say this should not exist.
      question = stripMd(first);
      defaultLabel = '';
    } else {
      // "**Recommended: X.** details…" or "**Approve X**": the file's rule is that every
      // row OPENS with its recommended option in bold, so the row is its own default
      // and the section names the question.
      question = sectionTitle;
      defaultLabel = stripMd((first || '').replace(RECO, ''));
    }
    const body = stripMd(lead.replace(/\*\*(.+?)\*\*/, ''));
    const [ready = '', cost = '', where = ''] = rest;
    const details = [
      ...(body && body !== question ? [truncate(body, 280)] : []),
      ...(ready ? [`Ready: ${truncate(stripMd(ready), 200)}`] : []),
      ...(cost ? [`Cost: ${truncate(stripMd(cost), 120)}`] : []),
    ];
    const text = `${lead} ${rest.join(' ')}`;
    const long = stripMd(text).length > 1200;
    cards.push({
      id: cardId('ops', `${section}\n${stripMd(first || lead).slice(0, 160)}`),
      source: 'ops',
      question: truncate(question, 200),
      defaultLabel: defaultLabel ? truncate(defaultLabel, 240) : '(no recommendation in the row)',
      defaultDoes: 'Records your answer here, with your name and the time. The ops file is not edited yet (stage 2); a session moves the row to Done from this record.',
      defaultActionable: Boolean(defaultLabel),
      evidence: evidenceFrom(`${text} ${where}`, lineNo),
      needsDesk: long ? 'Long row: read it in full at the ops link first' : undefined,
      details,
      raisedAt: sectionDate(section),
      costUsd: parseCostUsd(`${cost} ${lead}`),
      ref: { section, line: lineNo },
    });
  }
  return cards;
}

// ── Ordering and filtering ─────────────────────────────────────────────────

/**
 * Oldest and most expensive first: one day of age weighs the same as $10 at
 * stake (the spend floor). A card with no date sorts as raised today.
 */
export function cardPriority(card: DecisionCard, now: Date): number {
  const raised = card.raisedAt ? Date.parse(card.raisedAt) : NaN;
  const ageDays = Number.isFinite(raised) ? Math.max(0, (now.getTime() - raised) / 86_400_000) : 0;
  return ageDays + card.costUsd / 10;
}

export function sortCards(cards: DecisionCard[], now: Date): DecisionCard[] {
  return [...cards].sort((a, b) => cardPriority(b, now) - cardPriority(a, now) || a.id.localeCompare(b.id));
}

// ── Answers ───────────────────────────────────────────────────────────────

export const ANSWERS_COLLECTION = 'decision_answers';
/** A skipped card comes back after this long. */
export const SKIP_HOURS = 24;

/**
 * queued   — waiting for the Hetzner drainer (PR actions)
 * recorded — kept as the record; nothing in this system acts on it (ops rows, skips)
 * acting   — claimed by a drainer run (a run that dies here is turned into `failed` after 30 min)
 * done     — the drainer acted (merged / commented + blocked)
 * refused  — safe-merge.sh or a drainer guard refused; the card comes back with the reason
 * failed   — the drainer errored; the card comes back with the error
 */
export type AnswerStatus = 'queued' | 'recorded' | 'acting' | 'done' | 'refused' | 'failed';

export interface DecisionAnswer {
  card_id: string;
  source: DecisionSource;
  choice: DecisionChoice;
  /** Free text for Other; empty otherwise. */
  text: string;
  /** What the card said when answered, so the record reads without the card. */
  question: string;
  default_label: string;
  ref: DecisionCard['ref'];
  answered_by: string;
  answered_at: Date;
  status: AnswerStatus;
  /** Skip only: when the card reappears. */
  skip_until?: Date;
  /** Set by the drainer. */
  acted_at?: Date;
  result?: string;
}

export interface AnswerInput {
  card: Pick<DecisionCard, 'id' | 'source' | 'question' | 'defaultLabel' | 'defaultActionable' | 'ref'>;
  choice: DecisionChoice;
  text?: string;
}

/** Validate an answer and build the document to insert. Throws on a bad answer. */
export function buildAnswer(input: AnswerInput, answeredBy: string, now: Date): DecisionAnswer {
  const { card } = input;
  if (!answeredBy) throw new Error('an answer needs a signed-in answerer');
  if (!['pr', 'ops', 'session'].includes(card.source)) throw new Error(`unknown source ${card.source}`);
  if (!/^(pr|ops|session):[0-9a-f]{16}$/.test(card.id) || !card.id.startsWith(`${card.source}:`)) {
    throw new Error(`bad card id ${card.id}`);
  }
  if (!['default', 'other', 'skip'].includes(input.choice)) throw new Error(`unknown choice ${input.choice}`);
  const text = (input.text ?? '').trim();
  if (input.choice === 'other' && !text) throw new Error('Other needs a written answer');
  if (text.length > 4000) throw new Error('answer is longer than 4000 characters');
  if (card.source === 'session') throw new Error('sessions are read-only until the laptop sync exists');
  if (card.source === 'pr') {
    if (!Number.isInteger(card.ref.pr) || (card.ref.pr as number) <= 0) throw new Error('PR card without a PR number');
    if (!/^[0-9a-f]{40}$/.test(card.ref.headSha ?? '')) throw new Error('PR card without the head sha it was judged at');
  }

  // A Default that cannot act (PR not mergeable) is a skip, said plainly in the record.
  const choice: DecisionChoice = input.choice === 'default' && !card.defaultActionable ? 'skip' : input.choice;
  const status: AnswerStatus = choice === 'skip' ? 'recorded'
    : card.source === 'pr' ? 'queued'
      : 'recorded';
  return {
    card_id: card.id,
    source: card.source,
    choice,
    text: choice === 'other' ? text : '',
    question: card.question,
    default_label: card.defaultLabel,
    ref: card.ref,
    answered_by: answeredBy,
    answered_at: now,
    status,
    ...(choice === 'skip' ? { skip_until: new Date(now.getTime() + SKIP_HOURS * 3_600_000) } : {}),
  };
}

/**
 * Remove answered cards; surface refusals. The latest answer per card wins.
 * A skip hides the card until skip_until; a refused or failed action brings it
 * back with the reason; anything else hides it.
 */
export function applyAnswers(
  cards: DecisionCard[],
  answers: Pick<DecisionAnswer, 'card_id' | 'choice' | 'status' | 'answered_at' | 'skip_until' | 'result'>[],
  now: Date,
): DecisionCard[] {
  const latest = new Map<string, (typeof answers)[number]>();
  for (const a of answers) {
    const prev = latest.get(a.card_id);
    if (!prev || new Date(a.answered_at) > new Date(prev.answered_at)) latest.set(a.card_id, a);
  }
  const out: DecisionCard[] = [];
  for (const c of cards) {
    const a = latest.get(c.id);
    if (!a) { out.push(c); continue; }
    if (a.status === 'refused' || a.status === 'failed') {
      out.push({ ...c, lastAttempt: `Last answer ${a.status}: ${a.result || 'no reason recorded'}` });
      continue;
    }
    if (a.choice === 'skip' && a.skip_until && new Date(a.skip_until) <= now) out.push(c);
  }
  return out;
}
