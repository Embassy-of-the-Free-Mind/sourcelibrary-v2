import { describe, expect, it } from 'vitest';
import { getPageImageUrl } from '@/lib/page-image-url';
import { r2PageIdentity } from '@/lib/r2-page-identity';
// @ts-expect-error untyped script module
import { readerServesDisplay } from '../../scripts/lib/reader-display.mjs';

const P = 'https://images.sourcelibrary.org/pages/b1';
const A = 'https://images.sourcelibrary.org/archived/b1';

// #4406: the backfill's sibling is only worth writing if the reader then serves it. A `-marked` key the
// identity rule did not know sent the pilot's 70 siblings back to an unmarked proxy resize of the master.
describe('a marked sibling is the same page image', () => {
  it.each([
    [`${P}/0002-marked.jpg`, `${P}/0002.jpg`],
    [`${P}/0002-marked.jpg`, `${A}/2.jpg`],
    [`${P}/0003-full-marked.jpg`, `${P}/0003-full.jpg`],
    [`${P}/sp1a2b-marked.jpg`, `${P}/sp1a2b.jpg`],
  ])('%s is %s', (variant, source) => {
    expect(r2PageIdentity(variant)).toBe(r2PageIdentity(source));
  });

  it('still tells two different pages apart', () => {
    expect(r2PageIdentity(`${P}/0002-marked.jpg`)).not.toBe(r2PageIdentity(`${P}/0003.jpg`));
  });
});

describe('readerServesDisplay agrees with the reader', () => {
  const display = `${P}/0002-marked.jpg`;
  it.each([
    ['master moved aside', { display_photo: display, archived_photo: `${P}/0002.jpg`, photo: 'https://ia.example/2.jpg' }],
    ['archived master', { display_photo: `${P}/0002.jpg`, archived_photo: `${A}/2.jpg` }],
    ['split half', { display_photo: `${P}/sp1a-marked.jpg`, photo: `${P}/sp1a.jpg`, split_from_spread: true }],
    ['split, display still the spread', { display_photo: `${P}/0002.jpg`, photo: `${P}/sp1a.jpg`, split_from_spread: true }],
    ['old-era crop', { display_photo: `${P}/0002.jpg`, cropped_photo: `${P}/c1.jpg`, archived_photo: `${A}/2.jpg` }],
    ['crop coordinates', { display_photo: `${P}/0002.jpg`, archived_photo: `${A}/2.jpg`, crop: { xStart: 0, xEnd: 500 } }],
    ['display of another page', { display_photo: `${P}/0009.jpg`, archived_photo: `${A}/2.jpg` }],
    ['restored plate', { display_photo: `${P}/c1-d.jpg`, cropped_photo: `${P}/c1.jpg`, plate_whole: { display: { url: `${P}/c1-d.jpg`, of: `${P}/c1.jpg` } } }],
  ])('%s', (_name, page) => {
    expect(readerServesDisplay(page)).toBe(getPageImageUrl(page as never, 'display') === page.display_photo);
  });
});
