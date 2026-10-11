import { describe, it, expect } from 'vitest';
import { applyGroundingEdits } from '@/lib/embassy/citation-fixes';
import { isNotebookClaim, mergeNotebookClaimEdits, notebookClaimEdits } from '@/lib/embassy/notebook-claims';

// The chat loop calls notebookClaimEdits only when add_to_notebook did NOT
// succeed this turn; with a save it passes the grounding edits through.
function strip(text: string, saved: boolean): string {
  return saved ? text : applyGroundingEdits(text, notebookClaimEdits(text));
}

const CLAIM = 'Saved to your research notebook — the *Research notebook* button under the message box on this page opens it.';

describe('notebook claim stripping (#6255)', () => {
  const answer = `Drebbel built a submarine for James I.\n\n${CLAIM}\n\nYou might also look at his *Elementen*.`;

  it('turn with no save → the claim is removed, the rest kept', () => {
    const out = strip(answer, false);
    expect(out).not.toMatch(/notebook/i);
    expect(out).toBe('Drebbel built a submarine for James I.\n\n\nYou might also look at his *Elementen*.');
  });

  it('turn with a save → the claim is kept (negative control)', () => {
    expect(strip(answer, true)).toBe(answer);
  });

  it('removes a claim sentence inside a paragraph without eating its neighbours', () => {
    const text = `He describes the furnace on page 12. I have saved these findings to your research notebook. The athanor follows.`;
    expect(strip(text, false)).toBe('He describes the furnace on page 12. The athanor follows.');
    const tail = `He describes the furnace on page 12. ${CLAIM}`;
    expect(strip(tail, false)).toBe('He describes the furnace on page 12.');
  });

  it('recognises the claim variants seen in embassy_messages', () => {
    for (const s of [
      CLAIM,
      '**Saved to your research notebook** — the *Research notebook* button under the message box on this page opens it.',
      "I've added these key findings to your research notebook.",
      'I have added the "Three Great Inventions" passage to your notebook.',
      'Guardado en tu cuaderno de investigación — el botón *Research notebook* debajo del cuadro de mensaje en esta página lo abre.',
      'El botón *Cuaderno de investigación* debajo del cuadro de mensaje en esta página lo abre.',
      'Para finalizar, he guardado estos regímenes en su cuaderno de investigación.',
      '已保存至您的研究笔记本 —— 页面上消息框下的“Research notebook”按钮即可打开。',
      '— *Research notebook* butonu üzerinden inceleyebilirsiniz.',
      'Deze beelden zijn opgeslagen in uw **Research notebook** (de knop onder het tekstvak).',
      'He guardado las enseñanzas de [Eliphas Levi](https://sourcelibrary.org/author/eliphas-levi) sobre el **Equilibrio Mágico** en tu cuaderno.',
      '已为您将关于“影之存在”的意识特征记录在研究笔记本中。',
    ]) expect(isNotebookClaim(s), s).toBe(true);
  });

  it('leaves prose about other notebooks alone', () => {
    for (const s of [
      "To ground these images, you might include Leonardo's own words from his notebooks.",
      '— *[The Notebooks of Leonardo da Vinci](https://sourcelibrary.org/book/the-notebooks-of-leonardo-da-vinci-richter)*.',
      'Para Erasmo, el cuaderno de notas (o *commonplace book*) era una herramienta de estudio.',
      'Newton kept a notebook of chemical experiments.',
    ]) expect(isNotebookClaim(s), s).toBe(false);
  });

  it('drops a claim edit that overlaps a grounding edit, keeps document order', () => {
    const text = `A fact. ${CLAIM}\nB fact.`;
    const claims = notebookClaimEdits(text);
    const later = { find: 'B fact.', replace: 'B fact (p. 3).', at: text.indexOf('B fact.') };
    expect(mergeNotebookClaimEdits([later], claims).map(e => e.at)).toEqual([claims[0].at, later.at]);
    const overlapping = { find: text.slice(0, 20), replace: 'X', at: 0 };
    expect(mergeNotebookClaimEdits([overlapping], claims)).toEqual([overlapping]);
  });
});
