import provenance from '@/data/carbon-ledger/provenance.json';

export type Footnote = (typeof provenance.footnotes)[number];

export const footnotes: Footnote[] = provenance.footnotes;

export function findFootnote(id: number): Footnote | undefined {
  return footnotes.find((f) => f.id === id);
}
