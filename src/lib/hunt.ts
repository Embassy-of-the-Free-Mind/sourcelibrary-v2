/**
 * The Trithemian hunt (#8150 slice 3): answer checking and progress, with no database.
 *
 * PRIOR ART: src/lib/hunt-payloads.ts — loads the riddles into the colophon (slice 2); this module
 * checks answers to them. src/lib/provenance.ts — the same key signs marks; here it signs progress
 * under a separate HMAC domain, so a progress token can never be passed off as a mark or the reverse.
 * No other answer-checking or puzzle code exists (git grep answer_hash, riddle, puzzle).
 *
 * The repo is public and the riddles are the game, so neither the riddles nor their answers are
 * here. A clue in `hunt_clues` stores a random salt and the sha256 of each accepted answer, salted.
 *
 * Progress is a signed token the reader's browser keeps: which steps of a chain they have solved.
 * No account and no cookie. The solvers' page accepts a token only when every step is in it, so
 * a reader who found the last riddle first cannot sign without solving the other six.
 */
import crypto from 'crypto';

/** One answer, reduced to what a reader can be expected to agree on: letters and digits only. */
export function normalizeAnswer(raw: string): string {
  return raw
    .normalize('NFKD') // ſ → s, accents split off
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/[^a-z0-9]+/g, '');
}

export function hashAnswer(salt: string, raw: string): string {
  return crypto.createHash('sha256').update(`${salt}:${normalizeAnswer(raw)}`).digest('hex');
}

export function answerMatches(clue: { answer_salt?: unknown; answer_hashes?: unknown }, raw: string): boolean {
  if (typeof clue.answer_salt !== 'string' || !Array.isArray(clue.answer_hashes)) return false;
  if (!normalizeAnswer(raw)) return false;
  const got = Buffer.from(hashAnswer(clue.answer_salt, raw), 'hex');
  return clue.answer_hashes.some((h) => {
    if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) return false;
    return crypto.timingSafeEqual(got, Buffer.from(h, 'hex'));
  });
}

// ── progress tokens ──────────────────────────────────────────────────────────

export interface HuntProgress {
  chain: string;
  steps: number[];
  /** Random per run, fixed at the first solve. The solvers' ledger keys on it: one signature per run. */
  run: string;
  started: number;
}

const DOMAIN = 'trithemian-hunt-progress-v1';
export const MAX_STEPS = 32;

function key(): string | null {
  return process.env.PROVENANCE_SECRET_KEY || null;
}

function sign(body: string, k: string): string {
  return crypto.createHmac('sha256', k).update(`${DOMAIN}\n${body}`).digest('base64url').slice(0, 32);
}

export function encodeProgress(p: HuntProgress): string | null {
  const k = key();
  if (!k) return null;
  const body = Buffer.from(JSON.stringify({ c: p.chain, s: p.steps, r: p.run, t: p.started })).toString('base64url');
  return `${body}.${sign(body, k)}`;
}

/** The progress a token proves, or null when it is missing, damaged or not ours. */
export function decodeProgress(token: unknown): HuntProgress | null {
  const k = key();
  if (!k || typeof token !== 'string' || token.length > 600) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body, k));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (typeof o.c !== 'string' || typeof o.r !== 'string' || !Array.isArray(o.s) || typeof o.t !== 'number') return null;
    const steps = o.s.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_STEPS);
    return { chain: o.c, steps: [...new Set<number>(steps)].sort((a, b) => a - b), run: o.r, started: o.t };
  } catch {
    return null;
  }
}

/** Add a solved step to a reader's progress, starting a new run when they have none for this chain. */
export function withSolvedStep(prior: HuntProgress | null, chain: string, step: number, now = Date.now()): HuntProgress {
  const base: HuntProgress =
    prior && prior.chain === chain
      ? prior
      : { chain, steps: [], run: crypto.randomBytes(9).toString('base64url'), started: now };
  return { ...base, steps: [...new Set([...base.steps, step])].sort((a, b) => a - b) };
}

export function isComplete(p: HuntProgress | null, chain: string, total: number): boolean {
  if (!p || p.chain !== chain || total < 1) return false;
  for (let s = 1; s <= total; s++) if (!p.steps.includes(s)) return false;
  return true;
}

/**
 * A name a solver offers for the public list. Letters (any script), spaces and a little
 * punctuation, at most 40 characters; anything else is refused rather than cleaned up.
 */
export function cleanSolverName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 40) return null;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(s)) return null;
  return s;
}

export const HUNT_SOLVERS_COLLECTION = 'hunt_solvers';
export const DEFAULT_CHAIN = 'trithemius';
