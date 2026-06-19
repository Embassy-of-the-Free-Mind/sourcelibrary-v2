import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Deep Time: The First Images — prototype · Source Library',
  description:
    'A prototype gallery of Palaeolithic art — the oldest surviving images and sculptures made by human hands.',
  robots: { index: false, follow: false },
};

/**
 * PROTOTYPE ONLY — not linked from any public surface, noindex.
 *
 * Question being explored: does Palaeolithic art ("the deep time of human
 * image-making") belong in Source Library, and if so does the `artwork`
 * content-type / gallery visual language carry it?
 *
 * Images are self-hosted on R2 under prototype/prehistoric-art/<id>.jpg,
 * mirrored from Don Hitchcock's donsmaps.com (photographs licensed CC BY 4.0;
 * attribution requested). Mirror script: scripts/_tmp_mirror_prehistoric.mjs.
 * The objects themselves are prehistoric → public domain. Third-party museum
 * house-rules on object images are a theoretical (low) risk, hence: not public.
 *
 * If this graduates to a real feature, these become hidden `content_type:
 * 'artwork'` DB entries sourced from museum open-access / Wikimedia (cleaner
 * provenance than a single personal site), with per-image credit. Don's Maps
 * stays the index/inspiration, not the import target.
 */

const R2 = 'https://images.sourcelibrary.org/prototype/prehistoric-art';
const imgUrl = (id: string) => `${R2}/${id}.jpg`;

type Artwork = {
  id: string;
  title: string;
  date: string;
  site: string;
  museum: string;
  medium: string;
  blurb: string;
};

const FIGURINES: Artwork[] = [
  {
    id: 'lion-man',
    title: 'The Lion Man (Löwenmensch)',
    date: 'c. 40,000 BP',
    site: 'Hohlenstein-Stadel, Germany',
    museum: 'Museum Ulm',
    medium: 'Mammoth ivory',
    blurb:
      'A standing figure with a lion’s head — the oldest known representation of a being that never existed. Roughly 300 hours of carving with a flint blade, made when the last ice age was at its coldest.',
  },
  {
    id: 'hohle-fels',
    title: 'Venus of Hohle Fels',
    date: 'c. 35,000–40,000 BP',
    site: 'Hohle Fels Cave, Germany',
    museum: 'Urgeschichtliches Museum, Blaubeuren',
    medium: 'Mammoth ivory',
    blurb:
      'The oldest undisputed depiction of a human being yet found. A carved ring in place of a head suggests it was worn as a pendant.',
  },
  {
    id: 'adorant',
    title: 'The Adorant (Worshipper)',
    date: 'c. 40,000 BP',
    site: 'Geißenklösterle, Germany',
    museum: 'Württembergisches Landesmuseum',
    medium: 'Carved ivory relief',
    blurb:
      'A tiny relief of a figure with raised arms. On the reverse, rows of incised notches may be one of the earliest attempts at a calendar or tally.',
  },
  {
    id: 'willendorf',
    title: 'Venus of Willendorf',
    date: 'c. 28,000 BP',
    site: 'Willendorf, Austria',
    museum: 'Naturhistorisches Museum, Vienna',
    medium: 'Oolitic limestone, traces of red ochre',
    blurb:
      'The most famous Palaeolithic figurine. The stone is not local — it travelled, or its maker did — and was once coloured with red ochre.',
  },
  {
    id: 'lespugue',
    title: 'Venus of Lespugue',
    date: 'c. 24,000–26,000 BP',
    site: 'Rideaux Cave, Lespugue, France',
    museum: 'Musée de l’Homme, Paris',
    medium: 'Tusk ivory',
    blurb:
      'Carved with a near-geometric symmetry that fascinated 20th-century artists — Picasso kept two casts of it in his studio.',
  },
  {
    id: 'dolni-vestonice',
    title: 'Venus of Dolní Věstonice',
    date: 'c. 25,000–29,000 BP',
    site: 'Dolní Věstonice, Moravia',
    museum: 'Pavilon Anthropos, Brno',
    medium: 'Fired clay',
    blurb:
      'Among the oldest known ceramics anywhere — fired more than ten thousand years before pottery vessels existed. A fingerprint of a child is baked into a nearby fragment.',
  },
  {
    id: 'brassempouy',
    title: 'The Lady of Brassempouy',
    date: 'c. 25,000 BP',
    site: 'Brassempouy, France',
    museum: 'Musée d’Archéologie Nationale',
    medium: 'Mammoth ivory',
    blurb:
      'One of the earliest realistic representations of a human face — a hood or hairstyle rendered in fine cross-hatching above calm, deliberate features.',
  },
  {
    id: 'laussel',
    title: 'Venus of Laussel',
    date: 'c. 22,000–27,000 BP',
    site: 'Laussel, Dordogne, France',
    museum: 'Musée d’Aquitaine, Bordeaux',
    medium: 'Limestone bas-relief',
    blurb:
      'A figure carved into a rock shelter wall, holding a crescent — possibly a horn — incised with thirteen marks, read by some as a lunar count.',
  },
  {
    id: 'menton',
    title: 'Venus of Menton',
    date: 'c. 23,000 BP',
    site: 'Barma Grande, Grimaldi',
    museum: 'Musée d’Archéologie Nationale',
    medium: 'Yellow steatite',
    blurb:
      'One of the Balzi Rossi figurines from the Italian–French Riviera caves — a series carved in soft, jewel-coloured stones.',
  },
  {
    id: 'double-venus',
    title: 'The Double Venus',
    date: 'c. 23,000 BP',
    site: 'Balzi Rossi, Italy',
    museum: 'Private collection',
    medium: 'Serpentine',
    blurb:
      'Two figures sharing a single body, carved from green serpentine — an early image of pairing, or of two states of one being.',
  },
  {
    id: 'hohle-phallus',
    title: 'The Hohle Fels Phallus',
    date: 'c. 28,000 BP',
    site: 'Hohle Fels Cave, Germany',
    museum: 'Urgeschichtliches Museum, Blaubeuren',
    medium: 'Polished siltstone',
    blurb:
      'A finely polished stone, reassembled from fragments — one of the oldest unambiguous representations of male anatomy, and possibly also a tool.',
  },
  {
    id: 'berekhat-ram',
    title: 'The Berekhat Ram Figure',
    date: 'c. 230,000+ BP',
    site: 'Berekhat Ram, Golan Heights',
    museum: 'Hebrew University of Jerusalem',
    medium: 'Modified volcanic pebble',
    blurb:
      'A pebble whose natural shape suggests a figure, deliberately enhanced with a few grooves — possibly made by Homo erectus, which would make it almost ten times older than anything else here.',
  },
];

const CAVE_PAINTINGS: Artwork[] = [
  {
    id: 'chauvet-horses',
    title: 'Panel of the Horses',
    date: 'c. 36,000 BP',
    site: 'Chauvet Cave, Ardèche, France',
    museum: 'In situ (UNESCO World Heritage)',
    medium: 'Charcoal on limestone',
    blurb:
      'Four horses’ heads drawn in overlapping profile, with stumping and shading to model the muzzles — perspective and volume tens of thousands of years before either was “invented.”',
  },
  {
    id: 'chauvet-handprints',
    title: 'Panel of Hand Prints',
    date: 'c. 36,000 BP',
    site: 'Chauvet Cave, Ardèche, France',
    museum: 'In situ (UNESCO World Heritage)',
    medium: 'Red ochre on limestone',
    blurb:
      'Hands pressed and stencilled onto the wall — the most direct trace any of these makers left: the print of a living hand, held up in the dark.',
  },
  {
    id: 'lascaux-bulls',
    title: 'The Hall of the Bulls',
    date: 'c. 17,300 BP',
    site: 'Lascaux, Dordogne, France',
    museum: 'In situ (closed; replica Lascaux IV)',
    medium: 'Ochre and manganese on limestone',
    blurb:
      'A frieze of aurochs, horses and stags wrapping a chamber, including the enigmatic spotted “unicorn.” One of the supreme achievements of ice-age painting.',
  },
  {
    id: 'lascaux-black-bull',
    title: 'The Great Black Bull',
    date: 'c. 17,300 BP',
    site: 'Lascaux (Axial Gallery), France',
    museum: 'In situ (closed; replica Lascaux IV)',
    medium: 'Manganese pigment on limestone',
    blurb:
      'At 3.7 metres long, the largest single figure at Lascaux — its body left as bare rock, its outline and head rendered in dense black.',
  },
  {
    id: 'lascaux-shaft',
    title: 'The Shaft Scene',
    date: 'c. 17,300 BP',
    site: 'Lascaux (the Well), France',
    museum: 'In situ (closed; replica Lascaux IV)',
    medium: 'Pigment on limestone',
    blurb:
      'A disembowelled bison, a bird-headed falling man, a spear, a rhinoceros — the most argued-over image in all of cave art, and a candidate for the oldest narrative scene.',
  },
  {
    id: 'altamira-ceiling',
    title: 'The Polychrome Ceiling',
    date: 'c. 15,000–22,000 BP',
    site: 'Altamira, Cantabria, Spain',
    museum: 'In situ (Museo de Altamira)',
    medium: 'Ochre, haematite and charcoal',
    blurb:
      'A herd of bison painted across a low ceiling, the artists using the rock’s natural bulges to give each animal a three-dimensional swell. Dismissed as a forgery when first published in 1880 — too good to be ancient.',
  },
  {
    id: 'altamira-bison',
    title: 'Polychrome Bison (detail)',
    date: 'c. 15,000–22,000 BP',
    site: 'Altamira, Cantabria, Spain',
    museum: 'In situ (Museo de Altamira)',
    medium: 'Ochre, haematite and charcoal',
    blurb:
      'A single curled bison from the great ceiling — pigment diluted to grade from deep red to soft brown, conjuring muscle and weight out of stone.',
  },
];

function Card({ a }: { a: Artwork }) {
  return (
    <figure className="group overflow-hidden rounded-xl bg-[#161412] ring-1 ring-white/10 transition-all hover:ring-white/25">
      <div className="relative aspect-[4/3] overflow-hidden bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imgUrl(a.id)}
          alt={a.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      </div>
      <figcaption className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-serif text-lg text-stone-100">{a.title}</h3>
          <span className="shrink-0 font-mono text-xs tabular-nums text-amber-300/70">
            {a.date}
          </span>
        </div>
        <p className="mt-1 text-xs text-stone-500">
          {a.site} · {a.medium}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-stone-400">{a.blurb}</p>
        <p className="mt-3 text-[11px] uppercase tracking-wide text-stone-600">
          {a.museum}
        </p>
      </figcaption>
    </figure>
  );
}

export default function PrehistoricArtPrototype() {
  return (
    <div className="min-h-screen bg-[#0d0c0b] text-stone-200">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
        {/* Prototype banner */}
        <div className="mb-10 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-200/80">
          <span className="font-semibold text-amber-200">Prototype</span> — not
          public, not indexed. Exploring whether Palaeolithic art belongs in
          Source Library. Images © Don Hitchcock,{' '}
          <a
            href="https://donsmaps.com"
            className="underline hover:text-amber-100"
            target="_blank"
            rel="noopener noreferrer"
          >
            donsmaps.com
          </a>
          , reused under CC BY 4.0.
        </div>

        {/* Header */}
        <header className="mb-12 max-w-2xl">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-stone-500">
            The deep time of human image-making
          </p>
          <h1 className="font-serif text-4xl leading-tight text-stone-100 sm:text-5xl">
            Deep Time: The First Images
          </h1>
          <p className="mt-5 text-base leading-relaxed text-stone-400">
            Before writing, before the city, before the wheel — people carved
            faces, bodies, and impossible beings from ivory and stone, and
            painted living animals across the walls of caves. These are among
            the oldest surviving works of human imagination, made across forty
            thousand years of the last ice age. Source Library is built around
            the read-and-quote experience of historical texts; this asks what it
            would mean to hold the images that came before any text at all.
          </p>
        </header>

        {/* Carved figures */}
        <section className="mb-16">
          <h2 className="mb-1 font-serif text-2xl text-stone-100">
            Carved figures
          </h2>
          <p className="mb-6 text-sm text-stone-500">
            Ivory, stone and fired clay — the oldest sculptures in the world.
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FIGURINES.map((a) => (
              <Card key={a.id} a={a} />
            ))}
          </div>
        </section>

        {/* Painted caves */}
        <section className="mb-4">
          <h2 className="mb-1 font-serif text-2xl text-stone-100">
            The painted caves
          </h2>
          <p className="mb-6 text-sm text-stone-500">
            Animals and signs drawn by firelight, deep underground.
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CAVE_PAINTINGS.map((a) => (
              <Card key={a.id} a={a} />
            ))}
          </div>
        </section>

        {/* Footer note */}
        <footer className="mt-14 border-t border-white/10 pt-6 text-sm text-stone-500">
          <p>
            All photographs by Don Hitchcock, mirrored with attribution under{' '}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              className="underline hover:text-stone-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              CC BY 4.0
            </a>{' '}
            from{' '}
            <a
              href="https://donsmaps.com"
              className="underline hover:text-stone-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              Don’s Maps
            </a>
            , a remarkable independent archive of Palaeolithic archaeology. The
            artefacts and paintings depicted are public domain by virtue of age.
          </p>
        </footer>
      </div>
    </div>
  );
}
