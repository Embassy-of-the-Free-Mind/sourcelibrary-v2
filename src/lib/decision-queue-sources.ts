/**
 * One decision queue (#6258): the I/O half — reads the three sources and the
 * recorded answers. Card rules live in decision-queue.ts.
 *
 * PRIOR ART: src/app/shared/[slug]/route.ts — the existing private-ops-repo
 * reader (same GITHUB_TOKEN, same contents API); this adds a GraphQL read of
 * tier:hold PRs beside it. Neither writes to GitHub: PR actions are queued in
 * Mongo for the Hetzner drainer (scripts/maintenance/decision-answers-drain.mjs).
 */
import type { Db } from 'mongodb';
import {
  ANSWERS_COLLECTION, CODE_REPO, OPS_FILE, OPS_REPO,
  applyAnswers, parseOpsDecisions, prCard, sortCards,
  type DecisionAnswer, type DecisionCard, type HoldPr,
} from './decision-queue';

const UA = 'sourcelibrary-decision-queue';

const HOLD_PRS_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    issueCount
    nodes { ... on PullRequest {
      number title url createdAt isDraft baseRefName headRefOid mergeable mergeStateStatus
      additions deletions changedFiles body
      author { login }
      labels(first: 20) { nodes { name } }
    } }
  }
}`;

/** At most 100 (one search page); `total` says when there are more. */
export async function fetchHoldPrs(token: string): Promise<{ prs: HoldPr[]; total: number }> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ query: HOLD_PRS_QUERY, variables: { q: `repo:${CODE_REPO} is:pr is:open label:tier:hold` } }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`GitHub GraphQL: ${json.errors[0].message}`);
  type Node = Omit<HoldPr, 'labels' | 'author'> & { labels: { nodes: { name: string }[] }; author: { login: string } | null };
  const prs = (json.data.search.nodes as Node[])
    .filter((n) => typeof n?.number === 'number')
    .map((n) => ({ ...n, labels: n.labels.nodes.map((l) => l.name), author: n.author?.login ?? null }));
  return { prs, total: json.data.search.issueCount as number };
}

export async function fetchOpsMarkdown(token: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${OPS_REPO}/contents/${OPS_FILE}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw', 'User-Agent': UA },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`ops file: GitHub ${res.status}`);
  return res.text();
}

export interface QueueSnapshot {
  cards: DecisionCard[];
  /** One line per source that could not be read; shown on the page, never swallowed. */
  errors: string[];
  counts: { pr: number; ops: number; answeredToday: number };
}

/** Every pending card from every readable source, answered ones removed, in priority order. */
export async function loadQueue(db: Db, now = new Date()): Promise<QueueSnapshot> {
  const errors: string[] = [];
  const token = process.env.GITHUB_TOKEN;
  let prCards: DecisionCard[] = [];
  let opsCards: DecisionCard[] = [];
  if (!token) {
    errors.push('GITHUB_TOKEN is not set here: no PRs and no ops rows can be read.');
  } else {
    const [prs, ops] = await Promise.allSettled([fetchHoldPrs(token), fetchOpsMarkdown(token)]);
    if (prs.status === 'fulfilled') {
      prCards = prs.value.prs.map(prCard);
      if (prs.value.total > prs.value.prs.length) {
        errors.push(`Showing ${prs.value.prs.length} of ${prs.value.total} tier:hold PRs (one search page).`);
      }
    }
    else errors.push(`tier:hold PRs could not be read: ${(prs.reason as Error).message}`);
    if (ops.status === 'fulfilled') opsCards = parseOpsDecisions(ops.value);
    else errors.push(`${OPS_FILE} could not be read: ${(ops.reason as Error).message}`);
  }

  const all = [...prCards, ...opsCards];
  const answers = await db.collection<DecisionAnswer>(ANSWERS_COLLECTION)
    .find({ card_id: { $in: all.map((c) => c.id) } })
    .project<Pick<DecisionAnswer, 'card_id' | 'choice' | 'status' | 'answered_at' | 'skip_until' | 'result'>>(
      { _id: 0, card_id: 1, choice: 1, status: 1, answered_at: 1, skip_until: 1, result: 1 })
    .toArray();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const answeredToday = await db.collection(ANSWERS_COLLECTION).countDocuments({ answered_at: { $gte: startOfDay } });

  const open = applyAnswers(all, answers, now);
  return {
    cards: sortCards(open, now),
    errors,
    counts: {
      pr: open.filter((c) => c.source === 'pr').length,
      ops: open.filter((c) => c.source === 'ops').length,
      answeredToday,
    },
  };
}
