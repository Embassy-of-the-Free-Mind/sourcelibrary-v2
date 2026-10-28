// Conceptual histories (#7623). Server-only: the data files are written by
// scripts/maintenance/import-concept-histories.mjs and read here at build time.
// index.json is small and imported directly; the essays and claims of each
// concept are separate files loaded with a dynamic import, so one route never
// bundles the other concepts' megabytes. Never import this from a client component.
import index from './content/index.json';

export type ClaimSource = { l: string; loc?: string; q?: string; qo?: string; u?: string; np?: 1 };
export type Claim = { id: string; s: string; d: string; k: string; p?: 1; src: ClaimSource[] };
export type Essay = { slug: string; title: string; md: string };
export type Audit = { n: number; rejected: number; pct: number; lo: number; hi: number; date: string; corrected?: boolean };
export type KeepTerm = { term: string; translit?: string; lang?: string; gloss?: string; avoid: string[]; evidence?: string };
export type Concept = {
  slug: string; title: string; question: string; map: string | null;
  essays: { slug: string; title: string }[];
  keepTerms: KeepTerm[]; domains: string[];
  counts: { verified: number; partial: number; dropped: number; essays: number };
  audit: Audit | null;
};

export const HISTORIES = index as { generated: string; audit: { all: Audit; judge: { caught: number; planted: number; pct: number; lo: number; hi: number } }; concepts: Concept[] };
export const conceptBySlug = (slug: string) => HISTORIES.concepts.find((c) => c.slug === slug);

export async function loadEssays(slug: string): Promise<Essay[]> {
  return (await import(`./content/${slug}-essays.json`)).default as Essay[];
}
export async function loadClaims(slug: string): Promise<Claim[]> {
  return (await import(`./content/${slug}-claims.json`)).default as Claim[];
}

export const fmt = (n: number) => n.toLocaleString('en-US');
export const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const claimsHref = (c: string, d: string) => `/explore/histories/${c}/claims/${d}`;
export const domainLabel = (d: string) => d.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** The quality statement for one concept (quality-statements.md: what was measured, by whom, when, on how much). */
export function qualityStatement(c: Concept): string {
  const { all, judge } = HISTORIES.audit;
  const made = `The claims were drafted by AI (Claude) from the library’s pages, and each quote was matched against its page when the claim was written.`;
  const audited = HISTORIES.concepts.filter((x) => x.audit).length;
  const allLine = `Across the ${audited} audited histories, ${all.rejected} of ${all.n} were rejected (${all.pct}%, ${all.lo}–${all.hi}%). In a test, the reviewer caught ${judge.caught} of ${judge.planted} deliberately planted errors.`;
  const notChecked = `Partly verified claims and the essays themselves were not audited, and no scholar has reviewed them yet.`;
  const a = c.audit;
  if (!a) return `${made} This history has not been audited yet. ${allLine} ${notChecked}`;
  const fixed = a.corrected === false
    ? 'The rejected claims have not yet been corrected.'
    : 'The rejected claims were corrected or withdrawn before publication.';
  return `${made} On ${day(a.date)}, AI reviewers (Claude Opus as judge, each rejection confirmed by a second Opus reading after a Gemini read) checked a random sample of ${a.n} verified claims against the pages they cite: ${a.n - a.rejected} held and ${a.rejected} were rejected as overstated, misattributed or not on the cited page (${a.pct}%; 95% interval ${a.lo}–${a.hi}%). ${fixed} A sample of ${a.n} gives a wide interval. ${allLine} ${notChecked}`;
}
