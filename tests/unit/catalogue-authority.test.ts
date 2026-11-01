/**
 * Catalogue authority parsing (#7660 stage 0).
 *
 * Each case is a record shape met in production on 2026-10-28: the parser must
 * read the author the HOLDING LIBRARY names, by role, and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { parseBsbManifest, parseMetsMods, authorOf, gndOf, vdIdsOf, recordUrlFor } from '../../scripts/lib/catalogue-authority.mjs';

const bsb = {
  metadata: [
    { label: [{ '@language': 'en', '@value': 'By' }], value: 'Praeside Avgvstino Leysero ... Dispvtabit Ioannes Gottlob Pvschervs' },
    { label: [{ '@language': 'en', '@value': 'Creator' }], value: 'Leyser, Augustin von, 1683-1752 -- (GND: <a href="https://d-nb.info/gnd/100867367">100867367</a>)' },
    { label: [{ '@language': 'en', '@value': 'Contributor' }], value: 'Puscher, Johann Gottlob, 1711- -- (GND: <a href="https://d-nb.info/gnd/130176117">130176117</a>)' },
    { label: [{ '@language': 'en', '@value': 'Identifier' }], value: 'VD18 15001849' },
  ],
};

// e-rara: the deceased of a funeral sermon (hnr) and the printer (prt) sit beside the author.
const erara = `<mets:mets><mets:dmdSec ID="md1"><mets:mdWrap><mets:xmlData><mods:mods>
<mods:name type="personal" usage="primary" authority="gnd" valueURI="http://d-nb.info/gnd/12891534x"><mods:displayForm>Gernler, Theodor</mods:displayForm><mods:namePart type="date">1670-1722</mods:namePart><mods:role><mods:roleTerm authority="marcrelator" type="code">aut</mods:roleTerm></mods:role></mods:name>
<mods:name type="personal" valueURI="http://d-nb.info/gnd/1172858764"><mods:displayForm>Raillard, Andreas</mods:displayForm><mods:role><mods:roleTerm type="code">hnr</mods:roleTerm></mods:role></mods:name>
<mods:name type="personal"><mods:displayForm>Lüdi, Friedrich</mods:displayForm><mods:role><mods:roleTerm type="code">prt</mods:roleTerm></mods:role></mods:name>
<mods:relatedItem type="host"><mods:name type="personal"><mods:displayForm>Series, Editor</mods:displayForm><mods:role><mods:roleTerm type="code">aut</mods:roleTerm></mods:role></mods:name></mods:relatedItem>
</mods:mods></mets:xmlData></mets:mdWrap></mets:dmdSec></mets:mets>`;

// Göttingen nests a <mods:mods> inside <mods:extension>, BEFORE the name.
const goettingen = `<mets:mets><mets:dmdSec ID="DMDLOG_0000"><mods:mods xmlns:mods="x">
<mods:extension><mods:mods><mods:originInfo><mods:place>Jena</mods:place></mods:originInfo></mods:mods></mods:extension>
<mods:name authority="gnd" type="personal" valueURI="http://d-nb.info/gnd/121557030"><mods:role><mods:roleTerm authority="marcrelator" type="code">aut</mods:roleTerm></mods:role><mods:namePart type="family">Hermann</mods:namePart><mods:namePart type="given">Johann Hieronymus</mods:namePart></mods:name>
</mods:mods></mets:dmdSec><mets:dmdSec ID="DMDLOG_0001"><mods:mods><mods:name type="personal"><mods:displayForm>Chapter, Author</mods:displayForm><mods:role><mods:roleTerm type="code">aut</mods:roleTerm></mods:role></mods:name></mods:mods></mets:dmdSec></mets:mets>`;

describe('catalogue authority parsers', () => {
  it('reads BSB Creator with its GND id and dates, and keeps contributors apart', () => {
    const r = parseBsbManifest(bsb);
    expect(r.names[0]).toMatchObject({ name: 'Leyser, Augustin von', dates: '1683-1752', gnd: '100867367', primary: true });
    expect(r.names[1]).toMatchObject({ name: 'Puscher, Johann Gottlob', gnd: '130176117', primary: false });
    expect(authorOf(r.names).name?.gnd).toBe('100867367');
    expect(r.ids.vd18).toBe('15001849');
  });

  it('takes only the aut role from e-rara, never the honoured dead, the printer or a host item', () => {
    const r = parseMetsMods(erara);
    expect(r.names.map((n) => n.name)).toEqual(['Gernler, Theodor', 'Raillard, Andreas', 'Lüdi, Friedrich']);
    expect(authorOf(r.names).name).toMatchObject({ name: 'Gernler, Theodor', gnd: '12891534X' });
  });

  it('reads past a nested mods:mods and stops at the first dmdSec', () => {
    const r = parseMetsMods(goettingen);
    expect(r.names).toHaveLength(1);
    expect(authorOf(r.names).name).toMatchObject({ name: 'Hermann, Johann Hieronymus', gnd: '121557030' });
  });

  it('refuses a record that names two authors, and one that names none by role', () => {
    const two = [{ name: 'A', roles: ['aut'] }, { name: 'B', roles: ['aut'] }];
    expect(authorOf(two)).toEqual({ name: null, reason: 'several-authors' });
    expect(authorOf([{ name: 'Printer', roles: ['prt'] }]).reason).toBe('no-author-role');
  });

  it('takes an e-rara primary name that carries no role as the main entry', () => {
    expect(authorOf([{ name: 'Chiampell, Durich', roles: [], role_text: [], primary: true }, { name: 'Froschauer', roles: ['prt'] }]).name?.name).toBe('Chiampell, Durich');
  });

  it('extracts GND ids and VD numbers in their published shapes', () => {
    expect(gndOf('(DE-588)16247579-2')).toBe('16247579-2');
    expect(vdIdsOf('VD 16 H 5722, Vischer L 1')).toEqual({ vd16: 'H 5722' });
    expect(vdIdsOf('VD17 1:636088U')).toEqual({ vd17: '1:636088U' });
    // The project label beside the category label is not a number.
    expect(vdIdsOf('Projekt VD18 digital Kategorie VD18 VD18 digital')).toEqual({});
    expect(vdIdsOf('Projekt VD18 digital VD18-Nummer 10471634')).toEqual({ vd18: '10471634' });
  });

  it('builds the record URL per provider', () => {
    expect(recordUrlFor({ image_source: { provider: 'erara', iiif_manifest: 'https://www.e-rara.ch/i3f/v21/1594809/manifest' } })?.url).toContain('identifier=1594809');
    expect(recordUrlFor({ image_source: { provider: 'sbb', iiif_manifest: 'https://content.staatsbibliothek-berlin.de/dc/PPN73360000X/manifest' } })).toEqual({ url: 'https://content.staatsbibliothek-berlin.de/dc/PPN73360000X/manifest', kind: 'sbb-manifest' });
    expect(recordUrlFor({ image_source: { provider: 'ia_microfilm', iiif_manifest: 'x' } })).toBeNull();
  });
});
