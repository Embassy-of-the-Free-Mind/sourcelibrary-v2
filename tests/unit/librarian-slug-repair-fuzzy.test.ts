import { describe, it, expect } from 'vitest';
import { distinctiveTokensAccounted, numbersAgree } from '@/lib/embassy/librarian';

// The slug resolver's third tier proposes candidates fuzzily; these two pure
// checks are what keep a proposal from becoming a wrong-book substitution.
// Cases are the real ones from the 195-slug probe behind #4704.

const tokens = (slug: string) => slug.split('-').filter(t => t.length >= 3);

describe('distinctiveTokensAccounted', () => {
  it('accepts a slug whose umlauts were dropped or expanded', () => {
    const cand = { title: 'Temporal. Dess weytberümpten M. Johan Künigspergers natürlicher kunst der Astronomei', author: 'Regiomontanus, Johannes' };
    expect(distinctiveTokensAccounted(tokens('temporal-dess-weytberuempten-johan-kuenigspergers-regiomontanus'), cand)).toBe(true);
  });

  it('accepts Latin inflection within two edits on long tokens', () => {
    const cand = { title: 'Mundus subterraneus, in XII libros digestus, quibus mundi subterranei fructus exponuntur', author: 'Kircher, Athanasius' };
    // athanasii→Athanasius (2 edits on a 9-letter token), kircheri→Kircher (1).
    expect(distinctiveTokensAccounted(tokens('athanasii-kircheri-mundi-subterranei-libros'), cand)).toBe(true);
    // A short token gets only one edit: "vitae" must not pass on "vita" + anything.
    expect(distinctiveTokensAccounted(['mundi'], { title: 'Mundus subterraneus' })).toBe(false);
  });

  it('rejects a same-author candidate that lacks a real title word', () => {
    // Gassendi's Life of Tycho shares six tokens with Brahe's own book but has
    // no "instauratae" — a wrong-book substitution the old tiers could make.
    const gassendi = { title: 'Tychonis Brahei equitis Dani astronomorum coryphaei vita', author: 'Gassendi, Pierre' };
    expect(distinctiveTokensAccounted(tokens('tichonis-brahe-equitis-dani-astronomorum-coryphaei-astronomiae-instauratae'), gassendi)).toBe(false);
  });

  it('rejects a commentary that names the work it is about', () => {
    const meder = { title: 'Iudicium theologicum de Fama et Confessione Fraternitatis Roseae Crucis', english_title: 'Theological Judgment on the Rosicrucian Brotherhood', author: 'Meder, David' };
    expect(distinctiveTokensAccounted(tokens('the-fame-and-confession-of-the-fraternity-of-the-rosie-cross'), meder)).toBe(false);
  });

  it('ignores short tokens so articles and particles never decide', () => {
    expect(distinctiveTokensAccounted(['der', 'und', 'von'], { title: 'Anything at all' })).toBe(true);
  });
});

describe('numbersAgree', () => {
  it('refuses a different shelfmark', () => {
    expect(numbersAgree('reg-lat-1266', { slug: 'hesychast-theological-treatises-reg-lat-1228', title: 'Lectures on Baths' })).toBe(false);
  });

  it('allows a candidate with no number, and a shared year', () => {
    expect(numbersAgree('atalanta-fugiens-1618-maier', { slug: 'atalanta-fleeing-maier', title: 'Atalanta Fleeing' })).toBe(true);
    expect(numbersAgree('de-umbris-idearum-1582-bruno', { slug: 'giordano-bruno-de-umbris-idearum-1582-first-edition-bruno', title: 'De Umbris Idearum (1582)' })).toBe(true);
  });
});
