import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Source Libraries — Source Library',
  description:
    'The 40+ digital libraries, archives, and manuscript repositories that Source Library draws from, with IIIF status, collection highlights, and access notes.',
  alternates: { canonical: '/about/sources' },
};

type Status = 'live' | 'ready' | 'limited' | 'blocked' | 'planned';

interface SourceLibrary {
  name: string;
  country: string;
  route?: string;
  iiif: string;
  status: Status;
  holdings: string;
  highlights: string;
  notes?: string;
}

const statusLabel: Record<Status, { text: string; color: string }> = {
  live: { text: 'Live', color: 'bg-emerald-100 text-emerald-800' },
  ready: { text: 'Route Ready', color: 'bg-blue-100 text-blue-800' },
  limited: { text: 'Limited', color: 'bg-amber-100 text-amber-800' },
  blocked: { text: 'Blocked', color: 'bg-red-100 text-red-800' },
  planned: { text: 'Planned', color: 'bg-stone-100 text-stone-600' },
};

const sources: SourceLibrary[] = [
  // === ACTIVE IMPORT PIPELINES ===
  {
    name: 'Internet Archive',
    country: 'USA',
    route: '/api/import/ia',
    iiif: 'Custom API',
    status: 'live',
    holdings: '40M+ items',
    highlights: 'Broadest single source. PG/PL, MGH, CSEL, Teubner, Loeb pre-1929. Fallback chain starts here.',
  },
  {
    name: 'Gallica (BnF)',
    country: 'France',
    route: '/api/import/gallica',
    iiif: 'v2',
    status: 'limited',
    holdings: '~10M digitized',
    highlights: '7,000 Arabic MSS, 6,000 Persian MSS, Greek MSS (Coislin, Suppl. grec), French manuscripts.',
    notes: 'Bot protection (Altcha) added 2025. SRU search may be blocked from automated clients.',
  },
  {
    name: 'Bodleian Library, Oxford',
    country: 'UK',
    route: '/api/import/bodleian',
    iiif: 'v2',
    status: 'live',
    holdings: '1,003 Greek MSS digitized',
    highlights: 'MS Barocci, Canon. Gr., Laud Gr. collections. JSON search API (best discovery tool). 104 Byzantine Greek MSS.',
  },
  {
    name: 'BSB Munich (MDZ)',
    country: 'Germany',
    route: '/api/import/mdz',
    iiif: 'v2',
    status: 'live',
    holdings: '860+ Cod.graec.',
    highlights: 'Cod.graec. (Greek MSS), incunabula, early printed books. No search API — manual catalog discovery.',
  },
  {
    name: 'British Library',
    country: 'UK',
    route: '/api/import/bl',
    iiif: 'v3',
    status: 'limited',
    holdings: '~150M items total',
    highlights: 'Harley, Sloane, Cotton, Royal MSS. Greek, Latin, Arabic, Hebrew. Alchemical, magical, scientific MSS.',
    notes: 'Post-2023 cyberattack: most older MSS return 403. Polonsky Pre-1200 items work. 54 esoteric MSS catalogued, awaiting recovery.',
  },
  {
    name: 'Vatican Apostolic Library',
    country: 'Vatican',
    route: '/api/import/vatlib',
    iiif: 'v2',
    status: 'limited',
    holdings: '7,000+ Vat.gr. MSS',
    highlights: 'Vat.gr.1102 (Plethon Nomoi), Bessarion autographs, Codex Vaticanus. Palatinus graecus series.',
    notes: 'Aggressive rate limiting (429 after ~30 requests). Manual one-at-a-time imports. Search requires session cookies.',
  },
  {
    name: 'Cambridge University Library',
    country: 'UK',
    route: '/api/import/cambridge',
    iiif: 'v2',
    status: 'live',
    holdings: '~8M items',
    highlights: 'Cairo Geniza fragments, Newton papers, medieval MSS.',
  },
  {
    name: 'Austrian National Library (ONB)',
    country: 'Austria',
    route: '/api/import/onb',
    iiif: 'v2',
    status: 'live',
    holdings: '~300 Greek MSS',
    highlights: 'Cod. phil. gr., Cod. theol. gr. series. Habsburg collections. No search API — manual catalog.',
  },
  {
    name: 'HAB Wolfenb\u00fcttel',
    country: 'Germany',
    route: '/api/import/hab',
    iiif: 'v2',
    status: 'live',
    holdings: '~12,000 MSS',
    highlights: 'Herzog August collection. Alchemical, Rosicrucian, early modern German texts.',
  },
  {
    name: 'Staatsbibliothek zu Berlin',
    country: 'Germany',
    route: '/api/import/sbb',
    iiif: 'v2',
    status: 'live',
    holdings: '~3M digitized pages',
    highlights: 'Diez (Arabic/Persian/Turkish), Hamilton (Italian humanist), Phillipps collections.',
  },
  {
    name: 'e-rara (Swiss libraries)',
    country: 'Switzerland',
    route: '/api/import/e-rara',
    iiif: 'v2',
    status: 'live',
    holdings: '~80,000 prints',
    highlights: 'Swiss rare books. Paracelsus, Gesner, early scientific printing.',
  },
  {
    name: 'Wellcome Collection',
    country: 'UK',
    route: '/api/import/wellcome',
    iiif: 'v2',
    status: 'live',
    holdings: '~40,000 items',
    highlights: 'History of medicine, alchemy, herbals, anatomical atlases.',
  },
  {
    name: 'Library of Congress',
    country: 'USA',
    route: '/api/import/loc',
    iiif: 'Custom API',
    status: 'live',
    holdings: '~170M items',
    highlights: 'Chinese rare books, maps, early American imprints. Custom JSON API (not standard IIIF).',
  },
  {
    name: 'Europeana',
    country: 'EU',
    route: '/api/import/europeana',
    iiif: 'Aggregator',
    status: 'live',
    holdings: '~50M items',
    highlights: 'Aggregates metadata from thousands of European institutions. Extracts IIIF manifests from providers.',
  },
  {
    name: 'Yale Beinecke Library',
    country: 'USA',
    route: '/api/import/yale',
    iiif: 'v3',
    status: 'live',
    holdings: '~1M items',
    highlights: 'Voynich Manuscript (MS 408), alchemical MSS, Osborn Collection, early printed books.',
  },
  {
    name: 'Harvard Houghton Library',
    country: 'USA',
    route: '/api/import/harvard',
    iiif: 'v2',
    status: 'live',
    holdings: '~500,000 items',
    highlights: 'Islamic Heritage Project, medieval codices, printing history, incunabula.',
  },
  {
    name: 'Penn Schoenberg Collection',
    country: 'USA',
    route: '/api/import/penn',
    iiif: 'v2',
    status: 'live',
    holdings: '~400 MSS',
    highlights: 'LJS medieval scientific manuscripts. Also hosts OPenn (51K MSS from 30+ institutions, CC0).',
  },
  {
    name: 'Huntington Library',
    country: 'USA',
    route: '/api/import/huntington',
    iiif: 'v2',
    status: 'live',
    holdings: '~11M items',
    highlights: 'Ellesmere Chaucer, early English MSS, Burndy Library (history of science).',
  },
  {
    name: 'Getty Research Institute',
    country: 'USA',
    route: '/api/import/getty',
    iiif: 'v3',
    status: 'live',
    holdings: '~1.4M items',
    highlights: 'Alchemical manuscripts, emblem books, art historical archives.',
  },
  {
    name: 'Kyoto University RMDA',
    country: 'Japan',
    route: '/api/import/kyoto',
    iiif: 'v3',
    status: 'live',
    holdings: '~10,000 items',
    highlights: 'Japanese rare books, natural history, Nakai architectural plans, Meiji-era materials.',
  },
  {
    name: 'NDL Japan',
    country: 'Japan',
    route: '/api/import/iiif',
    iiif: 'v2',
    status: 'live',
    holdings: '~350,000 digitized',
    highlights: 'Japanese classical texts, Go/shogi, Buddhist texts. Via generic IIIF route.',
  },
  {
    name: 'Embassy of the Free Mind',
    country: 'Netherlands',
    route: '/api/import/pdf',
    iiif: 'PDF',
    status: 'live',
    holdings: '~25,000 items',
    highlights: 'Core collection. Bibliotheca Philosophica Hermetica: Hermetica, alchemy, Kabbalah, Rosicrucianism.',
  },

  // === NEEDS API KEY / REGISTRATION ===
  {
    name: 'National Library of Israel',
    country: 'Israel',
    iiif: 'v2 (gated)',
    status: 'planned',
    holdings: '~5M items',
    highlights: 'Dead Sea Scrolls digital, Maimonides, Kabbalah MSS, Cairo Geniza.',
    notes: 'IIIF infrastructure exists at iiif.nli.org.il but returns 403. Needs institutional API access.',
  },
  {
    name: 'Korean National Library',
    country: 'South Korea',
    iiif: 'None',
    status: 'planned',
    holdings: '~11M items',
    highlights: 'Joseon dynasty texts, Buddhist printing (Tripitaka Koreana), medical texts.',
    notes: 'Has XML Open API requiring registration. No IIIF — proprietary viewer.',
  },
  {
    name: 'Trove (NLA Australia)',
    country: 'Australia',
    iiif: 'None',
    status: 'planned',
    holdings: '1,000+ partner institutions',
    highlights: 'Aggregates Australian collections. API v3 available with free registration.',
    notes: 'API v2 deprecated (410 Gone). Register at trove.nla.gov.au.',
  },
  {
    name: 'Jagiellonian Library, Krakow',
    country: 'Poland',
    iiif: 'None (OAI-PMH)',
    status: 'planned',
    holdings: '~4M items',
    highlights: 'Copernicus De Revolutionibus holograph (BJ MS 10000). OAI-PMH confirmed working, no auth.',
    notes: 'PDFs/DJVU available. OAI harvest ready to go.',
  },
  {
    name: 'VHMML (Hill Museum)',
    country: 'USA (global MSS)',
    iiif: 'v2 (gated)',
    status: 'planned',
    holdings: '~350,000 MSS',
    highlights: 'Ethiopian Ge\u2019ez manuscripts, Syriac, Arabic, Armenian from 500+ partner libraries worldwide.',
    notes: 'JSON metadata CC BY 4.0. Registration required. Contact help@vhmml.org for bulk access.',
  },

  // === INVESTIGATED — NOT VIABLE (yet) ===
  {
    name: 'Marciana Library, Venice',
    country: 'Italy',
    iiif: 'None',
    status: 'blocked',
    holdings: '~13,000 MSS',
    highlights: 'Bessarion\u2019s 482 Greek MSS (donated 1468). ContentDM-based, no IIIF, no API.',
    notes: 'Partial Europeana records exist. The most important undigitized Byzantine collection.',
  },
  {
    name: 'Qatar Digital Library',
    country: 'Qatar',
    iiif: 'None (blocked)',
    status: 'blocked',
    holdings: '~25,000 items',
    highlights: 'Arabic scientific MSS, India Office Records. Partnership with British Library.',
    notes: 'Blocks all automated access (403). Manual PDF download only.',
  },
  {
    name: 'Leiden University',
    country: 'Netherlands',
    iiif: 'Islandora',
    status: 'blocked',
    holdings: '~200,000 items',
    highlights: 'Scaliger, Vossius collections. Largest Indonesian MS collection outside Indonesia. Golius Arabic.',
    notes: 'Bot protection blocks automated access. IIIF exists in Islandora but not publicly exposed.',
  },
  {
    name: 'BNE (Spain)',
    country: 'Spain',
    iiif: 'Unknown',
    status: 'blocked',
    holdings: '~30M items',
    highlights: 'Ramon Llull MSS, Arabic-Iberian translation tradition, colonial Americas.',
    notes: 'Server returned 503 during testing. Needs retry.',
  },
  {
    name: 'National Library of China',
    country: 'China',
    iiif: 'None',
    status: 'blocked',
    holdings: '~37M items',
    highlights: 'Chinese rare books (\u5584\u672c), Buddhist texts, Dunhuang manuscripts.',
    notes: 'Fully geo-blocked from outside China (HTTP 000 on all endpoints).',
  },
  {
    name: 'Russian National Library',
    country: 'Russia',
    iiif: 'None',
    status: 'blocked',
    holdings: '~36M items',
    highlights: 'Greek MSS (Codex Sinaiticus portions), Slavonic MSS, early printed books.',
    notes: 'No IIIF, no documented API. Digital access restricted to on-premises since 2022.',
  },
  {
    name: 'S\u00fcleymaniye Library, Istanbul',
    country: 'Turkey',
    iiif: 'None',
    status: 'blocked',
    holdings: '~70,000 MSS',
    highlights: 'Largest Ottoman/Islamic manuscript library. Arabic, Persian, Turkish.',
    notes: 'yazmalar.gov.tr covers 300K pages from 60+ Turkish libraries but has SSL errors and no IIIF.',
  },
  {
    name: 'Mount Athos',
    country: 'Greece',
    iiif: 'None',
    status: 'blocked',
    holdings: '~45,000 MSS',
    highlights: 'Richest surviving concentration of Byzantine manuscripts. Great Lavra, Vatopedi, Iviron.',
    notes: 'No public digital access. Digital Athos Project announced but not launched.',
  },
  {
    name: 'Royal Danish Library (KB)',
    country: 'Denmark',
    iiif: 'None',
    status: 'blocked',
    holdings: '~30M items',
    highlights: 'Tycho Brahe papers, Nordic medieval MSS, Arnam\u00e6gnean Collection.',
    notes: 'No IIIF. Proprietary image service at img.kb.dk.',
  },
  {
    name: 'NYPL',
    country: 'USA',
    iiif: 'v2 (gated)',
    status: 'blocked',
    holdings: '~900,000 digitized',
    highlights: 'Medieval MSS, Hebrew MSS, early printed books, Berg Collection.',
    notes: 'Incapsula WAF blocks automated access. Free API token available but not tested.',
  },
  {
    name: 'Morgan Library',
    country: 'USA',
    iiif: 'None',
    status: 'blocked',
    holdings: '~350,000 items',
    highlights: 'Gutenberg Bible, medieval MSS, illuminated books, Coptic bindings.',
    notes: 'Custom proprietary viewer. No IIIF found.',
  },

  // === SE ASIAN / GLOBAL ===
  {
    name: 'DREAMSEA (via HMML)',
    country: 'Indonesia / SE Asia',
    iiif: 'Likely (HMML)',
    status: 'planned',
    holdings: '16+ Indonesian sites',
    highlights: 'SE Asian MSS: Javanese, Malay, Lontara, Khmer, Lao, Thai, Burmese scripts. Palm-leaf and paper.',
    notes: 'Open access, purpose-built for endangered SE Asian MSS. Contact: dreamsea.mss@gmail.com',
  },
  {
    name: 'BL Endangered Archives',
    country: 'UK (global)',
    iiif: 'v3 (via BL)',
    status: 'limited',
    holdings: 'Hundreds of projects',
    highlights: 'Myanmar parabaik, Cambodia palm-leaf, Philippines Baybayin, Vietnam Cham, Timbuktu.',
    notes: 'Uses BL IIIF infrastructure. Same cyberattack limitations as BL main.',
  },
  {
    name: 'Perpustakaan Nasional RI',
    country: 'Indonesia',
    iiif: 'None',
    status: 'blocked',
    holdings: 'Unknown',
    highlights: 'Naskah Nusantara: Javanese, Malay, Batak, Bugis manuscripts. Palm-leaf MSS.',
    notes: 'khastanah.perpusnas.go.id — connection refused during testing.',
  },
  {
    name: 'NPM Taiwan',
    country: 'Taiwan',
    iiif: 'None',
    status: 'blocked',
    holdings: '~700,000 items',
    highlights: 'Chinese calligraphy, paintings, rare books, bronzes.',
    notes: 'Open Data portal but download-only, no live API or IIIF.',
  },
  {
    name: 'Waseda University',
    country: 'Japan',
    iiif: 'Unknown',
    status: 'planned',
    holdings: '~300,000 items',
    highlights: 'Japanese classical texts, Chinese classics in Japanese editions (Kotenseki).',
    notes: '404 on manifest patterns tried. Needs deeper investigation.',
  },
];

export default function SourcesPage() {
  const live = sources.filter(s => s.status === 'live');
  const limited = sources.filter(s => s.status === 'limited');
  const ready = sources.filter(s => s.status === 'ready');
  const planned = sources.filter(s => s.status === 'planned');
  const blocked = sources.filter(s => s.status === 'blocked');

  const renderTable = (items: SourceLibrary[]) => (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="w-full text-sm border-collapse min-w-[800px]">
        <thead>
          <tr className="border-b-2 border-stone-300">
            <th className="text-left py-2 pr-3 font-semibold text-stone-700">Library</th>
            <th className="text-left py-2 pr-3 font-semibold text-stone-700">Country</th>
            <th className="text-left py-2 pr-3 font-semibold text-stone-700">IIIF</th>
            <th className="text-left py-2 pr-3 font-semibold text-stone-700">Holdings</th>
            <th className="text-left py-2 font-semibold text-stone-700">Key Collections</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s, i) => (
            <tr key={i} className="border-b border-stone-200 align-top">
              <td className="py-2.5 pr-3 font-medium text-stone-900">
                {s.name}
                {s.route && (
                  <span className="block text-xs text-stone-400 font-mono mt-0.5">{s.route}</span>
                )}
              </td>
              <td className="py-2.5 pr-3 text-stone-600">{s.country}</td>
              <td className="py-2.5 pr-3">
                <span className="inline-block px-1.5 py-0.5 rounded text-xs bg-stone-100 text-stone-600 font-mono">
                  {s.iiif}
                </span>
              </td>
              <td className="py-2.5 pr-3 text-stone-600 whitespace-nowrap">{s.holdings}</td>
              <td className="py-2.5 text-stone-600">
                {s.highlights}
                {s.notes && (
                  <span className="block text-xs text-stone-400 mt-1">{s.notes}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Source Libraries"
          subtitle={`${sources.length} institutions surveyed across ${new Set(sources.map(s => s.country)).size} countries`}
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-12">
          Source Library draws from {live.length + limited.length} digital libraries worldwide, with
          import pipelines connecting directly to their IIIF image servers. Every page image is
          sourced from the holding institution, with full provenance recorded.
        </p>

        <h2 className="text-2xl text-primary mt-12 mb-4">
          Active Pipelines
          <span className="text-base font-normal text-stone-400 ml-3">{live.length} libraries</span>
        </h2>
        <p className="text-secondary mb-6">
          Fully automated import. Provide an identifier, get a book with page images.
        </p>
        {renderTable(live)}

        {limited.length > 0 && (
          <>
            <h2 className="text-2xl text-primary mt-12 mb-4">
              Limited Access
              <span className="text-base font-normal text-stone-400 ml-3">{limited.length} libraries</span>
            </h2>
            <p className="text-secondary mb-6">
              Route works but access is restricted by rate limiting, post-cyberattack recovery, or bot protection.
            </p>
            {renderTable(limited)}
          </>
        )}

        {planned.length > 0 && (
          <>
            <h2 className="text-2xl text-primary mt-12 mb-4">
              Planned
              <span className="text-base font-normal text-stone-400 ml-3">{planned.length} libraries</span>
            </h2>
            <p className="text-secondary mb-6">
              IIIF or API confirmed but requires registration, API keys, or further development.
            </p>
            {renderTable(planned)}
          </>
        )}

        {blocked.length > 0 && (
          <>
            <h2 className="text-2xl text-primary mt-12 mb-4">
              Not Yet Accessible
              <span className="text-base font-normal text-stone-400 ml-3">{blocked.length} libraries</span>
            </h2>
            <p className="text-secondary mb-6">
              Investigated but currently blocked by technical barriers, geo-restrictions, or lack of digital infrastructure.
              We monitor these and build pipelines as access opens.
            </p>
            {renderTable(blocked)}
          </>
        )}

        <div className="mt-16 pt-8 border-t border-border-light">
          <h2 className="text-2xl text-primary mb-4">How It Works</h2>
          <p className="text-secondary mb-4">
            Most of the world&apos;s great research libraries now serve high-resolution page images
            via <strong>IIIF</strong> (International Image Interoperability Framework), an open
            standard that lets any institution share digitized materials in a consistent format.
          </p>
          <p className="text-secondary mb-8">
            Source Library connects to these IIIF servers directly. When we import a book, we
            fetch the manifest (a structured list of pages), record the provenance, and build
            our OCR and translation pipeline on top of the original images. We never re-host
            images unnecessarily &mdash; we link to the source.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/about"
              className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
            >
              About Source Library
            </Link>
            <Link
              href="/about/processing"
              className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
            >
              How Processing Works
            </Link>
            <Link
              href="/about/standards"
              className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
            >
              Standards & Interoperability
            </Link>
          </div>
        </div>
      </div>
    </ContentPageLayout>
  );
}
