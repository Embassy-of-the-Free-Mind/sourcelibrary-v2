import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Standards & Interoperability - Source Library',
  description:
    'Source Library implements IIIF, Dublin Core, W3C Web Annotations, DOI, and open license standards to ensure interoperability and long-term preservation.',
  alternates: {
    canonical: '/about/standards',
  },
};

export default function StandardsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Standards & Interoperability"
          subtitle="No lock-in, no proprietary formats, no authentication required. Every book, transcription, and translation is published using open standards."
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-12">
          Source Library is built on the principle that knowledge infrastructure should outlast any single platform.
          We use the same open standards trusted by the world&apos;s great libraries and archives, ensuring that
          every text we digitize remains accessible, citable, and interoperable — regardless of what happens to us.
        </p>

        {/* IIIF */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-4">
          IIIF — The Language of Digital Libraries
        </h2>

        <p className="text-secondary mb-6">
          The <a href="https://iiif.io/api/presentation/3.0/" target="_blank" rel="noopener noreferrer">International Image Interoperability Framework</a> is
          the standard that connects digital libraries worldwide. Every book in Source Library publishes a
          IIIF Presentation 3.0 manifest — a structured description of the book&apos;s pages, images, metadata,
          and text layers that any compatible viewer can load directly.
        </p>

        <p className="text-secondary mb-8">
          This means our books can be opened in <a href="https://projectmirador.org/" target="_blank" rel="noopener noreferrer">Mirador</a>,
          Universal Viewer, or any IIIF-compatible application without any special integration.
          Researchers can compare our manuscripts side-by-side with holdings from the British Library,
          the BnF, or the Bavarian State Library — all speaking the same language.
        </p>

        <div className="bg-warm rounded-xl border border-border-light p-6 mb-6">
          <p className="text-sm font-sans text-muted uppercase tracking-wide mb-3">What a manifest includes</p>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-primary font-medium mb-1">Page images</p>
              <p className="text-secondary text-[15px]">Images from Internet Archive, Gallica, BSB, e-rara, and Wellcome — archived for long-term availability</p>
            </div>
            <div>
              <p className="text-primary font-medium mb-1">Text annotations</p>
              <p className="text-secondary text-[15px]">OCR transcriptions and English translations as W3C Web Annotations, loaded on demand</p>
            </div>
            <div>
              <p className="text-primary font-medium mb-1">Table of contents</p>
              <p className="text-secondary text-[15px]">Chapter structures mapped to IIIF Range resources for navigation</p>
            </div>
            <div>
              <p className="text-primary font-medium mb-1">Rich metadata</p>
              <p className="text-secondary text-[15px]">Author, date, publisher, language, USTC numbers, DOIs, and links to source institutions</p>
            </div>
          </div>
        </div>

        <p className="text-muted text-sm mb-16">
          Try it: <a href="https://sourcelibrary.org/api/iiif/c87fadfa-1543-44b9-a138-573c144246e6/manifest" target="_blank" rel="noopener noreferrer" className="text-accent-rust">view the manifest for Musaeum Hermeticum</a>
        </p>

        {/* W3C Web Annotations */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-4">
          Text as Annotation
        </h2>

        <p className="text-secondary mb-6">
          OCR transcriptions and English translations are not stored as opaque blobs — they&apos;re published as <a href="https://www.w3.org/TR/annotation-model/" target="_blank" rel="noopener noreferrer">W3C Web Annotations</a> that
          link text to the specific page image it was derived from. Each annotation carries a BCP 47 language
          tag — <em>la</em> for Latin, <em>de</em> for German, <em>en</em> for English — making the content
          machine-readable and linguistically explicit.
        </p>

        <p className="text-secondary mb-16">
          Because annotations are referenced from the manifest rather than inlined, even a 900-page book
          loads instantly — text is fetched only for the pages being viewed.
        </p>

        {/* Dublin Core */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-4">
          Provenance & Dublin Core
        </h2>

        <p className="text-secondary mb-6">
          Every book stores <a href="https://www.dublincore.org/specifications/dublin-core/dcmi-terms/" target="_blank" rel="noopener noreferrer">Dublin Core</a> metadata
          preserving the chain of custody from physical book to digital archive to Source Library.
          When we import a book from the Internet Archive or the Bibliothèque nationale de France,
          the original institution&apos;s identifiers, source URLs, and rights statements are recorded
          alongside the digitized content.
        </p>

        <div className="border-l-4 border-accent-gold pl-6 mb-16">
          <p className="text-secondary italic">
            The provenance of a digital text is as important as the provenance of a manuscript.
            A transcription without attribution to its source is scholarship built on sand.
          </p>
        </div>

        {/* Licensing */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-4">
          Open Licensing
        </h2>

        <p className="text-secondary mb-6">
          Image rights are expressed as machine-readable <a href="https://spdx.org/licenses/" target="_blank" rel="noopener noreferrer">SPDX identifiers</a>,
          mapped to Creative Commons and RightsStatements.org URIs in IIIF manifests.
          Most of our collection is public domain or CC0 — free to use without restriction.
        </p>

        <div className="bg-warm rounded-xl border border-border-light overflow-hidden mb-16">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-medium">
                <th className="text-left py-3 px-5 text-sm font-sans font-medium text-muted uppercase tracking-wide">License</th>
                <th className="text-left py-3 px-5 text-sm font-sans font-medium text-muted uppercase tracking-wide">What it means</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light">
                <td className="py-3 px-5 font-medium text-primary">Public Domain</td>
                <td className="py-3 px-5">No restrictions. Use freely for any purpose.</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 px-5 font-medium text-primary">CC0</td>
                <td className="py-3 px-5">Creator has waived all rights. Treat as public domain.</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 px-5 font-medium text-primary">CC BY 4.0</td>
                <td className="py-3 px-5">Free to use with attribution to the source institution.</td>
              </tr>
              <tr>
                <td className="py-3 px-5 font-medium text-primary">In Copyright</td>
                <td className="py-3 px-5">Rights reserved by the holding institution. Access only.</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* DOI */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-4">
          Citable Scholarship
        </h2>

        <p className="text-secondary mb-6">
          Published scholarly editions receive Digital Object Identifiers through <a href="https://zenodo.org/" target="_blank" rel="noopener noreferrer">Zenodo</a>,
          enabling permanent citation. A DOI means the edition can be referenced in footnotes, indexed by
          Google Scholar, and discovered through library catalogs — anchoring digital editions in the
          infrastructure of academic scholarship.
        </p>

        <div className="bg-warm rounded-xl border border-border-light p-6 mb-16">
          <p className="text-sm font-sans text-muted uppercase tracking-wide mb-4">Citation formats</p>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted mb-1">Inline</p>
              <p className="text-primary">(Author Year, p. N)</p>
            </div>
            <div className="border-t border-border-light pt-4">
              <p className="text-sm text-muted mb-1">Footnote</p>
              <p className="text-primary text-[15px]">Author, <em>Title</em>, trans. Source Library (Year), Page. DOI: 10.5281/zenodo.xxxxx</p>
            </div>
          </div>
        </div>

        {/* Source Institutions */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-4">
          Source Institutions
        </h2>

        <p className="text-secondary mb-8">
          Source Library imports from IIIF-enabled digital libraries worldwide.
          Original provenance is always preserved, and images are archived to ensure
          long-term availability independent of any single institution.
        </p>

        <div className="grid md:grid-cols-5 gap-4 mb-16">
          {[
            { name: 'Internet Archive', detail: 'San Francisco' },
            { name: 'Gallica', detail: 'Bibliothèque nationale de France' },
            { name: 'BSB / MDZ', detail: 'Bayerische Staatsbibliothek' },
            { name: 'e-rara', detail: 'Swiss university libraries' },
            { name: 'Wellcome', detail: 'Wellcome Collection, London' },
          ].map((inst) => (
            <div key={inst.name} className="bg-warm rounded-xl border border-border-light p-5 text-center">
              <p className="font-medium text-primary">{inst.name}</p>
              <p className="text-muted text-sm mt-1">{inst.detail}</p>
            </div>
          ))}
        </div>

        {/* Links */}
        <div className="flex flex-wrap gap-4 pt-8 border-t border-border-light">
          <Link
            href="/developers"
            className="px-5 py-2.5 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors"
          >
            API & MCP Server
          </Link>
          <Link
            href="/about"
            className="px-5 py-2.5 bg-white border border-border-medium text-secondary rounded-full hover:bg-warm transition-colors"
          >
            About Source Library
          </Link>
          <Link
            href="/"
            className="px-5 py-2.5 bg-white border border-border-medium text-secondary rounded-full hover:bg-warm transition-colors"
          >
            Browse the Library
          </Link>
        </div>
      </div>
    </ContentPageLayout>
  );
}
