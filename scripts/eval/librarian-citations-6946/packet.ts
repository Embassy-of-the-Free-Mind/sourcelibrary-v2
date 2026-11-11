/**
 * Librarian citations (#6946) — the per-answer judge packet, shared by the eval (build-packets.ts) and
 * the standing weekly gauge (scripts/audit/librarian-citation-gauge.ts), so both read answers through
 * the same instrument.
 *
 * PRIOR ART: scripts/eval/librarian-speed-6904/build-packets.ts (pairwise packets with whole pages);
 * this is one answer, every page link marked ⟦Ln⟧ for a per-link label (JUDGE-PROMPT.md).
 */
import type { GroundingPage } from '@/lib/embassy/grounding';
import { findPageLinks } from '@/lib/embassy/citation-pages';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

/** Whole pages: a first #6904 pass cut pages at 2,500 characters and real quotations read as invented. */
const PAGE_CHARS = 20000;

export interface PacketLink { id: string; slug: string; page: number; at: number; text: string }

export function judgePacket(question: string, text: string, pages: GroundingPage[]): { md: string; links: PacketLink[] } {
  const found = findPageLinks(text);
  const links = found.map((l, i) => ({ id: `L${i + 1}`, slug: l.slug, page: l.page, at: l.start, text: l.label }));
  // Marker after each link, from the end so offsets hold.
  let marked = text;
  for (let i = found.length - 1; i >= 0; i--) marked = `${marked.slice(0, found[i].end)} ⟦L${i + 1}⟧${marked.slice(found[i].end)}`;
  const cited = new Set(links.map(l => `${l.slug} p.${l.page}`));
  const head = (p: GroundingPage) => `${p.bookSlug} p.${p.page}`;
  const ordered = [...pages].sort((a, b) => Number(cited.has(head(b))) - Number(cited.has(head(a))) || a.bookSlug.localeCompare(b.bookSlug) || a.page - b.page);
  const linkList = links.map(l => {
    const known = pages.some(p => p.bookSlug === l.slug && p.page === l.page);
    return `- ${l.id} → ${l.slug} p.${l.page}${known ? '' : ' (this page is NOT among the pages below)'}`;
  }).join('\n');
  const pageBlocks = ordered.map(p => {
    // Editorial wrappers (<meta>, <summary>…) describe the page, often its neighbours: never page text.
    const [tr, orig] = [p.parts?.[0] ?? p.text, p.parts?.[1] ?? ''].map(t => (t ? stripEditorialWrappers(t) : t));
    return `### ${head(p)} — ${p.bookTitle}\n\n**English translation:**\n\n${(tr || '(none)').slice(0, PAGE_CHARS)}${orig ? `\n\n**Original transcription:**\n\n${orig.slice(0, PAGE_CHARS)}` : ''}`;
  });
  const md = `## Question\n\n${question}\n\n## Answer\n\n${marked}\n\n## Links to label\n\n${linkList}\n\n## Pages the Librarian read (${pages.length})\n\n${pageBlocks.join('\n\n---\n\n') || '(none)'}\n`;
  return { md, links };
}

/** Labels counted the way score.mjs counts them: wrong-page = other + none; wrong_fact apart; missing out. */
export function tallyLabels(labelled: Array<Array<{ label: string }>>) {
  const counts: Record<string, number> = { cited: 0, other: 0, none: 0, wrong_fact: 0, missing: 0, unlabelled: 0 };
  let answersWrongPage = 0;
  for (const ls of labelled) {
    let wrong = false;
    for (const l of ls) {
      counts[l.label in counts ? l.label : 'unlabelled']++;
      if (l.label === 'other' || l.label === 'none') wrong = true;
    }
    if (wrong) answersWrongPage++;
  }
  const judged = counts.cited + counts.other + counts.none + counts.wrong_fact;
  return {
    counts, judged, answersWrongPage,
    wrongPage: counts.other + counts.none,
    wrongPageRate: judged ? (counts.other + counts.none) / judged : null,
    wrongFactRate: judged ? counts.wrong_fact / judged : null,
  };
}
