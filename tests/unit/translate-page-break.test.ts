/**
 * Page-break devices (#5103): the split-word join, the catchword mark, the next-page lookahead and
 * the prompt rule, each behind its own switch in buildTranslationPrompt and OFF by default.
 *
 * Every fixture is the foot and head of a real seam from the 63-seam fidelity draw (EXPERIMENTS.md
 * 2026-09-25 late), cut down to the lines that matter. Each piece has a NEGATIVE CONTROL: the same
 * input with that piece switched off must leave the text as production sends it — so a test here
 * is red when its piece is disabled, and a future "simplification" that drops one is noticed.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { resolvePageBreak, lookaheadSnippet, overlapLength, maskApparatus, LOOKAHEAD_CLAUSE } from '../../scripts/lib/page-break-devices.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { buildTranslationPrompt, PAGE_BREAK_FIX, PAGE_BREAK_RULE } from '../../scripts/lib/translate-core.mjs';

const HEAD = '<language>German</language>\n<page-type>text</page-type>\n<page-num>17</page-num>\n<header>Vorrede.</header>\n\n';

// j111 — Apologia (1675): "Augspur-" | "gischen Confession"
const J111_N = 'wie böse Leuthe ihn wollen zumessen / sondern ist be-\nständig geblieben bey der Evangelischen Augspur-\n\n<vocab>GOTT, Vatter</vocab>';
const J111_X = `${HEAD}gischen Confession/ darunter er zu Görlitz commu-\nniciret/ und auch darauff gestorben/ welches künff-\ntig in seinem Leben zu lesen seyn wird.`;
// j050 — Brevis notitia (1782): OCR merged the catchword into the fragment: "Damna-" | "mnatur"
const J050_N = 'tantum Bulla illud damnans ceu omni execratione digna prostituebatur. Damna-\n\n<vocab>Quesnellus, Bulla</vocab>';
const J050_X = '<language>Latin</language>\n<page-num>73</page-num>\n<sig>E 5</sig>\n\nmnatur ab Episcopis hæc instructio; ipse ad concilium & dandam rationem evocatur. Soanenius initio tergiversatus.';
// j110 — "Alterum est" | "est insigne": the catchword sits in the body
const J110_N = 'Gratiam victricem unice extollant: & sic alia plura. Alterum est\n\n<vocab>Jansenism, Quesnel</vocab>';
const J110_X = '<language>Latin</language>\n<page-num>65</page-num>\n<meta>catchword: tis</meta>\n\nest insigne veritatis testimonium ab ipsomet datum. Quesnellus a nepote suo interrogatus.';
// j090 — "Episcopo-⏎rum" | "rum constantia": a catchword that completes the split word
const J090_N = 'Cum enim passim tam vigili Episcopo-\n\nrum\n\n<vocab>Cornelius Jansenius</vocab>';
const J090_X = '<language>Latin</language>\n<page-num>25</page-num>\n\nrum constantia, quam fevera Regis jussione ad subscriptionem urgerentur, plurimorum rigida Moralis labem passa est.';
// j075 — "Gri-⏎chischen" | "Griechischen gefraget": the whole word repeated on the next page
const J075_N = 'und wann man dieselbe Namen nicht gewust/hat er nach den Gri-\nchischen\n\n<vocab>Jakob Böhme</vocab>';
const J075_X = `${HEAD}Griechischen gefraget. Und da je der Medicus mit\nFleiß einen unrechten Namen angegeben.`;
// j046 — "cum nihil" | "hil impetrare": OCR merged the catchword "hil" into "nihil"
const J046_N = 'Placuerunt hæc Cætui, sed non Noaillio; qui, cum nihil\n\n<vocab>Noaillius</vocab>';
const J046_X = '<language>Latin</language>\n<page-num>49</page-num>\n<meta>catchword: quis</meta>\n\nhil impetrare posset, facta secessione cum novem aliis Episcopis a congressibus abstinuit.';
// j079 — "exspiravit.⏎Anony-" | "Anonymus continuator": the catchword is the first syllable
const J079_N = 'accepto e Quesnelli manibus viatico 8. Augusti 1694. exspiravit.\n\nAnony-\n\n<vocab>Quesnellus</vocab>';
const J079_X = '<language>Latin</language>\n<meta>catchword: Lege</meta>\n\nAnonymus continuator Brietii in Appendice folidum quinquennium ejus vitæ addit.';
// j012 — the catchword is only in the tag; the body does not repeat it
const J012_N = 'ziehe deine Zuhörer zum wahren Chriſtenthum /\nGottſeeligen Leben und ſteter Buſſe / und führe\n\n<meta>catchword: auch</meta>\n\n<vocab>Vorrede</vocab>';
const J012_X = `${HEAD}auch selbst ein exemplarisch Leben / gehe deinen Zu-\nhörern mit guten Exempeln vor / so hastu ein gut Gewissen.`;
// j103 — an ordinary mid-sentence break with no device
const J103_N = '(quæ metonymicè caro & sanguis Christi propter significationem appellantur) ipsa tamen caro\n\n<vocab>Danaeus</vocab>';
const J103_X = '<language>Latin</language>\n<header>EPISTOLA</header>\n<meta>catchword: Panis</meta>\n\nChristi naturam illam suâ, neque mutat, neque amittit, quæ sanè est spiritualis.';

describe('resolvePageBreak — the devices at a real break', () => {
  it('joins a split word onto the page where it begins and drops the fragment from the next (j111)', () => {
    const r = resolvePageBreak(J111_N, J111_X);
    expect(r.kind).toBe('split');
    expect(r.joined).toBe('Augspurgischen');
    expect(r.ocrN).toContain('Evangelischen Augspurgischen\n');
    expect(r.ocrNext).not.toMatch(/gischen Confession/);
    expect(r.ocrNext).toMatch(/<header>Vorrede\.<\/header>\n\nConfession\//);
  });

  it('negative control: with splitWords off the fragment and the hyphen stay where production sends them', () => {
    const r = resolvePageBreak(J111_N, J111_X, { splitWords: false });
    expect(r.kind).toBeNull();
    expect(r.ocrN).toBe(J111_N);
    expect(r.ocrNext).toBe(J111_X);
  });

  it('resolves an OCR that merged the catchword into the fragment by the longest overlap (j050, j037)', () => {
    expect(overlapLength('Damna', 'mnatur')).toBe(3);
    expect(overlapLength('auctorita', 'toritate')).toBe(6);
    expect(overlapLength('Augspur', 'gischen')).toBe(0);
    const r = resolvePageBreak(J050_N, J050_X);
    expect(r.joined).toBe('Damnatur');
    expect(r.ocrN).toContain('prostituebatur. Damnatur');
    expect(r.ocrNext).toMatch(/<sig>E 5<\/sig>\n\nab Episcopis/);
  });

  it('removes a trailing catchword from the body and names it (j110)', () => {
    const r = resolvePageBreak(J110_N, J110_X);
    expect(r.kind).toBe('catchword');
    expect(r.catchword).toBe('est');
    expect(r.removedFromN).toBe('est');
    expect(r.ocrN).toContain('Alterum\n\n<vocab>');
    expect(r.ocrNext).toBe(J110_X);   // the next page keeps its first word
  });

  it('negative control: with catchwords off the catchword is sent as text (j110)', () => {
    const r = resolvePageBreak(J110_N, J110_X, { catchwords: false });
    expect(r.kind).toBeNull();
    expect(r.ocrN).toBe(J110_N);
  });

  it('removes a catchword that is the first syllable of the next word, hyphen or not (j079, j029)', () => {
    const r = resolvePageBreak(J079_N, J079_X);
    expect(r.kind).toBe('catchword');
    expect(r.removedFromN).toBe('Anony--'.slice(0, 6));
    expect(r.ocrN).toMatch(/exspiravit\.\n\n<vocab>/);
    expect(r.ocrNext).toContain('Anonymus continuator');
    // j029: the OCR read "ente" where the printer set "entſ-"; the tag agreeing with the last word,
    // and the next page opening with a one-letter variant of it, is what decides.
    const s = resolvePageBreak('<meta>catchword: ente</meta>\n\nwerde nicht ein Philosophus / so sind wir ente\n\n<vocab>x</vocab>', `${HEAD}entschieden/er darff mir nicht die alten Secten auffdringen.`);
    expect(s.removedFromN).toBe('ente');
    expect(s.ocrN).toContain('so sind wir\n\n<vocab>');
  });

  it('a catchword that completes the split word: joined onto this page, removed from the next (j090)', () => {
    const r = resolvePageBreak(J090_N, J090_X);
    expect(r.kind).toBe('split+catchword');
    expect(r.joined).toBe('Episcoporum');
    expect(r.ocrN).toContain('vigili Episcoporum\n');
    expect(r.ocrN).not.toMatch(/\nrum\n/);
    expect(r.ocrNext).toMatch(/<page-num>25<\/page-num>\n\nconstantia,/);
  });

  it('a whole word repeated after its catchword completed it: kept here, dropped from the next (j075)', () => {
    const r = resolvePageBreak(J075_N, J075_X);
    expect(r.kind).toBe('split+catchword');
    expect(r.joined).toBe('Griechischen');
    expect(r.ocrN).toContain('nach den Griechischen\n');
    expect(r.ocrNext).toMatch(/<header>Vorrede\.<\/header>\n\ngefraget\. Und/);
  });

  it('a catchword OCR merged into the last word: the next page loses its duplicate (j046)', () => {
    const r = resolvePageBreak(J046_N, J046_X);
    expect(r.kind).toBe('merged-catchword');
    expect(r.ocrN).toBe(J046_N);
    expect(r.ocrNext).toMatch(/<meta>catchword: quis<\/meta>\n\nimpetrare posset/);
  });

  it('a tagged catchword the body does not repeat is named, and nothing is edited (j012)', () => {
    const r = resolvePageBreak(J012_N, J012_X);
    expect(r.kind).toBeNull();
    expect(r.catchword).toBe('auch');
    expect(r.ocrN).toBe(J012_N);
    expect(r.ocrNext).toBe(J012_X);
  });

  it('leaves an ordinary mid-sentence break alone, and the next page\'s own catchword tag is not this page\'s (j103)', () => {
    const r = resolvePageBreak(J103_N, J103_X);
    expect(r.kind).toBeNull();
    expect(r.catchword).toBeNull();
    expect(r.ocrN).toBe(J103_N);
    expect(r.ocrNext).toBe(J103_X);
  });

  it('a two-letter word is not stripped as a catchword without a hyphen or the tag agreeing ("in" | "interea")', () => {
    const r = resolvePageBreak('quod dixit in\n\n<vocab>x</vocab>', '<language>Latin</language>\n\ninterea venit.');
    expect(r.kind).toBeNull();
  });

  it('finds the body\'s last word behind margins and vocab, not the apparatus (j002, j037)', () => {
    const masked = maskApparatus('iis solis, quibus\n\n<margin>Genef. 17.</margin>\n<vocab>a, b</vocab>');
    expect(masked.replace(/\s+/g, ' ').trim()).toBe('iis solis, quibus');
    const r = resolvePageBreak('delegauit iis solis, quibus\n\n<margin>Genef. 17.</margin>\n<vocab>a</vocab>', '<language>Latin</language>\n<header>AD ECCLES.</header>\n\nquibus prædicandi verbi Euangelici munus dedit?');
    expect(r.removedFromN).toBe('quibus');
    expect(r.ocrN).toMatch(/iis solis,\n\n<margin>/);
  });

  it('is silent on an empty side', () => {
    expect(resolvePageBreak('', J111_X).kind).toBeNull();
    expect(resolvePageBreak(J111_N, '<language>Latin</language>').kind).toBeNull();
  });
});

describe('lookaheadSnippet — the next page\'s opening as context', () => {
  it('takes the first sentence past the minimum, apparatus off', () => {
    const s = lookaheadSnippet(J046_X);
    expect(s).toBe('hil impetrare posset, facta secessione cum novem aliis Episcopis a congressibus abstinuit.');
    expect(s).not.toContain('catchword');
  });
  it('caps a run-on page at a word boundary with an ellipsis', () => {
    const s = lookaheadSnippet('<language>Latin</language>\n\n' + 'verbum '.repeat(200));
    expect(s.length).toBeLessThanOrEqual(402);
    expect(s.endsWith(' …')).toBe(true);
  });
  it('is empty for a page with no prose', () => {
    expect(lookaheadSnippet('<language>Latin</language>\n<page-num>3</page-num>')).toBe('');
  });
  it('the clause-length variant stops at the first clause boundary past a short minimum', () => {
    const s = lookaheadSnippet(J046_X, LOOKAHEAD_CLAUSE);
    expect(s).toBe('hil impetrare posset,');
    // negative control: the sentence-length default runs on to the full stop
    expect(lookaheadSnippet(J046_X)).toMatch(/abstinuit\.$/);
    const p = buildTranslationPrompt({ prompts, book, ocrText: J111_N, nextOcrText: J111_X, pageBreak: { ...PAGE_BREAK_FIX, lookahead: 'clause' } }).prompt;
    expect(p).toContain('The next page opens');
    expect(p).toContain('Confession/ darunter er zu Görlitz commu- niciret/');
    expect(p).not.toContain('gestorben');
  });
});

// ── the prompt builder ──────────────────────────────────────────────────────────────────────────
const prompts = {
  translation: { text: 'Translate from {source_language} to {target_language}.', ref: { id: 't', name: 'Standard', version: 13, content_hash: 'h' } },
  english: { text: 'Modernize.', ref: { id: 'e', name: 'English', version: 2, content_hash: 'h' } },
};
const book = { title: 'Apologia', author: 'J. B.', published: '1675', language: 'German' };
const PREV_TR = 'The previous page in English. <summary>s</summary>';

describe('buildTranslationPrompt — the pageBreak option', () => {
  it('is byte-identical to production when the option is absent, whatever neighbours are passed', () => {
    const plain = buildTranslationPrompt({ prompts, book, ocrText: J111_N, previousTranslation: PREV_TR }).prompt;
    const withNeighbours = buildTranslationPrompt({ prompts, book, ocrText: J111_N, previousTranslation: PREV_TR, prevOcrText: J012_N, nextOcrText: J111_X }).prompt;
    expect(withNeighbours).toBe(plain);
    expect(plain).toContain('**Text to translate:**\n' + J111_N);
    expect(plain).not.toContain('Page breaks');
    expect(plain).not.toContain('next page opens');
    expect(buildTranslationPrompt({ prompts, book, ocrText: J111_N, previousTranslation: PREV_TR }).pageBreak).toBeNull();
  });

  it('with the fix on: joins the split word, notes it, adds the rule and the lookahead, keeps continuity last', () => {
    const { prompt, pageBreak } = buildTranslationPrompt({ prompts, book, ocrText: J111_N, previousTranslation: PREV_TR, nextOcrText: J111_X, pageBreak: PAGE_BREAK_FIX });
    expect(prompt).toContain('Evangelischen Augspurgischen\n');
    expect(prompt).toContain('**At the page break:** This page ends with the word «Augspurgischen»');
    expect(prompt).not.toContain('The catchword «gischen»');   // the tag's word is that word's second half, not a device to warn about
    expect(prompt).toContain(PAGE_BREAK_RULE);
    expect(prompt).toContain('**The next page opens (source, for context only');
    expect(prompt).toContain('Confession/ darunter er zu Görlitz');
    expect(prompt).not.toContain('gischen Confession');
    expect(prompt.indexOf('**Previous page translation for continuity:**')).toBeGreaterThan(prompt.indexOf('The next page opens'));
    expect(pageBreak).toMatchObject({ kind: 'split', joined: 'Augspurgischen', lookahead: true });
  });

  it('the NEXT page, given the previous page\'s OCR, loses the fragment and is told where the word went', () => {
    const { prompt, pageBreak } = buildTranslationPrompt({ prompts, book, ocrText: J111_X, previousTranslation: PREV_TR, prevOcrText: J111_N, pageBreak: PAGE_BREAK_FIX });
    expect(prompt).toContain('<header>Vorrede.</header>\n\nConfession/');
    expect(prompt).not.toContain('gischen Confession');
    expect(prompt).toContain('The word «Augspurgischen» was split across the break from the previous page and is translated there');
    expect(pageBreak.headJoined).toBe('Augspurgischen');
  });

  it('names a catchword as a device and removes it from the text (j110), and names a tag-only one (j012)', () => {
    const a = buildTranslationPrompt({ prompts, book, ocrText: J110_N, nextOcrText: J110_X, pageBreak: PAGE_BREAK_FIX }).prompt;
    expect(a).toContain('Alterum\n\n<vocab>');
    expect(a).toContain('The catchword «est» at the foot of this page is a printer\'s device');
    const b = buildTranslationPrompt({ prompts, book, ocrText: J012_N, nextOcrText: J012_X, pageBreak: PAGE_BREAK_FIX }).prompt;
    expect(b).toContain('The catchword «auch»');
    expect(b).toContain('**Text to translate:**\n' + J012_N);
  });

  // ── one negative control per piece: the same call with only that switch off ──
  it('negative control — splitWords off: the fragment is sent as production sends it, the rest still applies', () => {
    const { prompt } = buildTranslationPrompt({ prompts, book, ocrText: J111_N, nextOcrText: J111_X, pageBreak: { ...PAGE_BREAK_FIX, splitWords: false } });
    expect(prompt).toContain('Augspur-\n');
    expect(prompt).not.toContain('Augspurgischen');
    expect(prompt).toContain(PAGE_BREAK_RULE);
    expect(prompt).toContain('The next page opens');
  });

  it('negative control — catchwords off: the catchword stays in the text and is not named', () => {
    const { prompt } = buildTranslationPrompt({ prompts, book, ocrText: J110_N, nextOcrText: J110_X, pageBreak: { ...PAGE_BREAK_FIX, catchwords: false } });
    expect(prompt).toContain('Alterum est\n');
    expect(prompt).not.toContain('The catchword');
    expect(prompt).toContain(PAGE_BREAK_RULE);
  });

  it('negative control — lookahead off: no next-page section, the edits and rule still there', () => {
    const { prompt, pageBreak } = buildTranslationPrompt({ prompts, book, ocrText: J111_N, nextOcrText: J111_X, pageBreak: { ...PAGE_BREAK_FIX, lookahead: false } });
    expect(prompt).not.toContain('The next page opens');
    expect(prompt).not.toContain('Confession/ darunter');
    expect(prompt).toContain('Augspurgischen');
    expect(prompt).toContain(PAGE_BREAK_RULE);
    expect(pageBreak.lookahead).toBe(false);
  });

  it('negative control — rule off: no rule line, the edits and lookahead still there', () => {
    const { prompt } = buildTranslationPrompt({ prompts, book, ocrText: J111_N, nextOcrText: J111_X, pageBreak: { ...PAGE_BREAK_FIX, rule: false } });
    expect(prompt).not.toContain('**Page breaks:**');
    expect(prompt).toContain('Augspurgischen');
    expect(prompt).toContain('The next page opens');
  });

  it('a plain break gets the rule and the lookahead and no note (j103)', () => {
    const { prompt, pageBreak } = buildTranslationPrompt({ prompts, book, ocrText: J103_N, nextOcrText: J103_X, pageBreak: PAGE_BREAK_FIX });
    expect(prompt).not.toContain('**At the page break:**');
    expect(prompt).toContain('Christi naturam illam suâ');
    expect(prompt).toContain('**Text to translate:**\n' + J103_N);
    expect(pageBreak.kind).toBeNull();
  });
});
