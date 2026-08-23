// "Eight Circles" — a PDF booklet of the eight playa-gift designs, one page
// each: the disc, its citation, and a paragraph on why it matters. Reuses the
// 2000px transparent discs in playa-gifts/stickers/.
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/jdietz/Documents/GitHub/dev/sourcelibrary-v2';
const OUTDIR = join(ROOT, 'esoteric-geometries-out');
const STICKERS = join(OUTDIR, 'playa-gifts', 'stickers');

const CREAM = '#f6f1e7';
const DARK = '#1a1612';
const INK = '#2b241c';
const FADED = '#7a7062';

const DESIGNS = [
  {
    key: 'apian-volvelle-1540',
    title: 'The Emperor\u2019s Astronomy',
    credit: 'Peter Apian \u00b7 Ingolstadt, 1540',
    url: 'sourcelibrary.org/gallery/image/6990688d249ce014347d6ecb-0',
    text: 'From Peter Apian\u2019s Astronomicum Caesareum, printed for Emperor Charles V and often called the most spectacular scientific book ever produced. This circle is a volvelle: layered paper discs that actually rotated on a thread axis, letting the reader compute planetary positions, eclipses, and horoscopes by hand. It is essentially a Renaissance analog computer disguised as art \u2014 proof that before electronics, calculation itself could be a luxury object, hand-colored and crowned with a little handle.',
  },
  {
    key: 'fludd-microcosmus-man-1617',
    title: 'The Microcosmic Man',
    credit: 'Robert Fludd, Utriusque Cosmi Historia \u00b7 Oppenheim, 1617',
    url: 'sourcelibrary.org/gallery/image/69904dd77d19f3f2aac1d579-0',
    text: 'The frontispiece of Fludd\u2019s \u201cHistory of Both Worlds\u201d shows a Vitruvian-style human figure spread inside nested celestial spheres. It is the single most famous image of the microcosm\u2013macrocosm doctrine: the idea that the human body is a scale model of the universe, and the universe a scaled-up body, so that studying one reveals the other. Every \u201ccosmic human\u201d image since \u2014 up through Alex Grey \u2014 is downstream of this engraving.',
  },
  {
    key: 'eye-of-providence-1715',
    title: 'The Eye of Providence',
    credit: 'Jacob Boehme, Der Weg zu Christo \u00b7 1715',
    url: 'sourcelibrary.org/gallery/image/69c8352e6c6f3cc53c84e7f1-0',
    text: 'From \u201cThe Way to Christ\u201d by Jacob Boehme, the shoemaker-mystic of G\u00f6rlitz whose visions of divine light in a pewter dish reshaped Western mysticism. The all-seeing eye sits at the center of a celestial sphere, crowned by a dove and ringed by an ouroboros \u2014 the divine gaze embedded in, not above, the cosmos. This rendering predates the eye\u2019s more familiar careers on the Masonic seal and the dollar bill; here it is still pure contemplative theology.',
  },
  {
    key: 'rosicrucian-seal-1785',
    title: 'The Rosicrucian Wheel',
    credit: 'Geheime Figuren der Rosenkreuzer \u00b7 Altona, 1785',
    url: 'sourcelibrary.org/gallery/image/69d38fa347cb16327c2b8a34-0',
    text: 'From the \u201cSecret Symbols of the Rosicrucians,\u201d the great late compendium of Rosicrucian cosmology. The wheel maps creation as concentric rings running from the zodiac at the rim down through Natura, Elementa, and Chaos to the hexagram medallion at the bullseye, where the word CHAOS itself is spelled around a central sun. It reads as a diagram you fall into: the entire ordered universe collapsing ring by ring toward the primordial state it emerged from.',
  },
  {
    key: 'sibley-magic-wheel-1820',
    title: 'The Pentacle of Venus',
    credit: 'Ebenezer Sibley, Key to the Mysteries of Magic \u00b7 c. 1820',
    url: 'sourcelibrary.org/gallery/image/69b418b72b0edf3eaa2ddbbf-0',
    text: 'Sibley was a physician-astrologer working the seam where Enlightenment science met ceremonial magic, and this hand-colored pentacle is a working talisman design, not an illustration \u2014 concentric rings of planetary characters and celestial stars meant to concentrate Venusian influence. It captures the moment occultism went commercial and encyclopedic in England, a direct ancestor of the Golden Dawn\u2019s diagrams seventy years later.',
  },
  {
    key: 'tibetan-mandala-1927',
    title: 'The Great Mandala of the Peaceful Deities',
    credit: 'Bardo Thodol, ed. W. Y. Evans-Wentz \u00b7 1927',
    url: 'sourcelibrary.org/gallery/image/6953c95577f38f6761bde8e1-0',
    text: 'From the \u201cTibetan Book of the Dead\u201d: a map of the visions a consciousness encounters in the first days after death \u2014 the forty-two peaceful deities arranged in concentric courts, to be recognized as projections of one\u2019s own mind rather than external gods. The 1927 English edition introduced this material to the West, where Jung wrote a commentary on it and, decades later, it became the template for the first psychedelic guidebooks.',
  },
  {
    key: 'crown-chakra-1927',
    title: 'Sahasrara \u2014 the Crown Chakra',
    credit: 'C. W. Leadbeater, The Chakras \u00b7 1927',
    url: 'sourcelibrary.org/gallery/image/69c86fb06c6f3cc53c85712f-0',
    text: 'From the Theosophical Society book that effectively created the modern Western image of the chakra system. This plate is the sahasrara, the \u201cthousand-petaled lotus\u201d at the crown of the head, painted as a radiant color-wheel of petals. Nearly every chakra poster, yoga-studio mural, and visionary painting of energy bodies since 1927 copies its color scheme from these plates \u2014 the missing link between Tantric diagram and psychedelic art.',
  },
  {
    key: 'observable-universe-2012',
    title: 'The Observable Universe',
    credit: 'Pablo Carlos Budassi \u00b7 2012, CC BY-SA',
    url: 'sourcelibrary.org/gallery/image/artwork-69e5379f5917566bf878f297-0',
    text: 'Budassi\u2019s logarithmic map compresses 93 billion light-years into a single disc: the Sun at center, then the solar system, the Milky Way, cosmic web filaments, and the cosmic microwave background at the rim, each ring representing exponentially more space. Built from Princeton logarithmic sky-map data, it is the one genuinely contemporary image in the set \u2014 and it quietly completes the sequence: the same concentric-cosmos diagram Fludd and the Rosicrucians drew, redrawn with actual data, four centuries later.',
  },
];

const SIZE = 2000;
async function flatten(discPath, hex) {
  const rgb = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  return sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: rgb } })
    .composite([{ input: discPath }]).jpeg({ quality: 92 }).toBuffer();
}

const PAGE_W = 612, PAGE_H = 792;
const pdfPath = join(OUTDIR, 'eight-circles.pdf');
const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false, info: {
  Title: 'Eight Circles \u2014 Source Library',
  Author: 'Source Library',
  Subject: 'Eight concentric cosmologies, 1540\u20132012',
} });
doc.pipe(createWriteStream(pdfPath));

// Cover
{
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(DARK);
  const cover = await flatten(join(STICKERS, 'rosicrucian-seal-1785.png'), DARK);
  const dw = 360;
  doc.image(cover, (PAGE_W - dw) / 2, 130, { width: dw });
  doc.font('Helvetica').fontSize(10).fillColor('#b9ad98')
    .text('S O U R C E   L I B R A R Y', 0, 64, { width: PAGE_W, align: 'center', characterSpacing: 2 });
  doc.font('Times-Roman').fontSize(34).fillColor('#f0e9da')
    .text('Eight Circles', 60, 540, { width: PAGE_W - 120, align: 'center' });
  doc.font('Times-Italic').fontSize(13).fillColor('#b9ad98')
    .text('Eight versions of the same gesture \u2014 putting everything in nested circles \u2014\nfrom Renaissance astronomy through alchemy, occultism, and Buddhist cosmology\nto modern astrophysics. 1540\u20132012.', 60, 592, { width: PAGE_W - 120, align: 'center', lineGap: 2 });
  doc.font('Helvetica').fontSize(9).fillColor('#8a7f6c')
    .text('sourcelibrary.org', 0, PAGE_H - 50, { width: PAGE_W, align: 'center' });
}

// One page per design
let n = 0;
for (const d of DESIGNS) {
  n++;
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(CREAM);
  doc.font('Helvetica').fontSize(8).fillColor(FADED)
    .text(`EIGHT CIRCLES \u00b7 ${n} OF ${DESIGNS.length}`, 0, 42, { width: PAGE_W, align: 'center', characterSpacing: 1.5 });
  const flat = await flatten(join(STICKERS, `${d.key}.png`), CREAM);
  const dw = 400;
  doc.image(flat, (PAGE_W - dw) / 2, 72, { width: dw });
  let y = 72 + dw + 24;
  doc.font('Times-Bold').fontSize(17).fillColor(INK)
    .text(d.title, 76, y, { width: PAGE_W - 152, align: 'center' });
  y = doc.y + 4;
  doc.font('Times-Italic').fontSize(11).fillColor(INK)
    .text(d.credit, 76, y, { width: PAGE_W - 152, align: 'center' });
  y = doc.y + 14;
  doc.font('Times-Roman').fontSize(10.5).fillColor('#3a332a')
    .text(d.text, 86, y, { width: PAGE_W - 172, align: 'justify', lineGap: 2.5 });
  doc.font('Helvetica').fontSize(7.5).fillColor(FADED)
    .text(d.url, 0, PAGE_H - 44, { width: PAGE_W, align: 'center' });
}

doc.end();
await new Promise(res => doc.on('end', res));
await new Promise(res => setTimeout(res, 400));
console.log('wrote', pdfPath, `(cover + ${n} pages)`);
