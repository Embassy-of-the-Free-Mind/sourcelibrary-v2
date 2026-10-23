import type { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import './partners.css';

// Lab-facing overview of the corpus (Derek, 2026-10-23). The copy was drafted and edited by
// Derek in a review artifact; figures were measured 2026-10-23 (ops: outreach/2026-10-23-market-value.md).
// Static on purpose: the numbers are a dated snapshot, stated as such on the page.

export const metadata: Metadata = {
  title: 'For AI Partners | Source Library',
  description:
    'A digital archive of 129,000 books in more than fifty languages, over 20,000 of them translated into English, each translation set beside its original page.',
  alternates: { canonical: '/partners' },
  robots: { index: false, follow: true },
};

export default function PartnersPage() {
  return (
    <>
      <SiteHeader variant="light" />
      <div className="slp">
      <section className="hero">
        <div className="wrap">
          <div>
            <p className="eyebrow">A Wisdom Frontiers project</p>
            <h1>The world's <em>wisdom</em>, translated beside the original page</h1>
            <p>A digital archive of 129,000 books in more than fifty languages, over 20,000 of them transcribed and translated into English, with every translation set opposite the page from which it was made, so that any line may be verified at its source.</p>
          </div>
          <figure>
            <img src="/partners/ottoman-celestial.jpg" alt="Ottoman celestial map, 1583: the zodiac and planetary spheres held by angels" />
            <figcaption><a href="/book/art-ottoman-celestial-map">Ottoman celestial map, 1583 · Source Library</a></figcaption>
          </figure>
        </div>
      </section>

      <nav className="pillars" aria-label="What the corpus is">
        <div className="wrap">
          <ol>
            <li><a href="#collected"><strong>Collected</strong><span>129,000 books from 30+ libraries</span></a></li>
            <li><a href="#transcribed"><strong>Transcribed</strong><span>9.4M pages in the original script</span></a></li>
            <li><a href="#translated"><strong>Translated</strong><span>5.7M pages into English</span></a></li>
            <li><a href="#reviewed"><strong>Community-reviewed</strong><span>Scholars and 1,465 volunteers</span></a></li>
            <li><a href="#rights"><strong>Rights cleared</strong><span>Checked book by book</span></a></li>
            <li><a href="#available"><strong>Immediately available</strong><span>Streaming API and MCP</span></a></li>
          </ol>
        </div>
      </nav>

      <section className="band dark">
        <div className="wrap why">
          <div>
            <p className="eyebrow">The untranslated record</p>
            <h2>Much of the world's written wisdom has never been translated</h2>
            <p>The translation of ancient texts in fifteenth-century Florence helped give rise to the Renaissance. Yet 90% of Renaissance Latin itself has never been translated, and the gaps in Chinese, Sanskrit, Tibetan, Arabic and Hebrew are wider still.</p>


          </div>
          <figure style={{ margin: '0' }}>
            <div className="frame"><img src="/partners/hero.jpg" alt="An early printed Latin page naming Marsilio Ficino and Pico della Mirandola" /></div>
            <figcaption className="cap" style={{ color: 'var(--night-muted)' }}>An early printed page naming Marsilio Ficino and Giovanni Pico della Mirandola.</figcaption>
          </figure>
        </div>
      </section>

      <section className="proof" id="collected">
        <div className="wrap pf">
          <h2 className="pword">Collected</h2>
          <div>
            <p className="lede">Assembled from more than thirty of the world's great libraries, and catalogued by work, edition and author.</p>
            <table className="ledger">
              <tr><td>Books digitally archived</td><td className="n">129,166</td></tr>
              <tr><td>Public on the site</td><td className="n">58,531</td></tr>
              <tr><td>Readable in English</td><td className="n">20,203</td></tr>
              <tr><td>Page images held</td><td className="n">28.9M</td></tr>
              <tr><td>Ritman Library books, found only here</td><td className="n">2,347</td></tr>
            </table>
            <p className="note">30.7 TB of scans. Counted 23 October 2026.</p>
          </div>
        </div>
      </section>

      <section className="proof alt" id="transcribed">
        <div className="wrap pf">
          <h2 className="pword">Transcribed</h2>
          <div>
            <p className="lede">9.4 million pages transcribed in their original language and script. Latin and classical Chinese predominate, alongside German, French, Italian, Greek, Hebrew, Arabic, Syriac, Sanskrit, Tibetan and Yucatec Maya.</p>
            <p>Each page is annotated where the reading is difficult, and indexed by the people, places and ideas it names, so that a single idea may be traced across books, centuries and languages.</p>
          </div>
        </div>
      </section>

      <section className="proof" id="translated">
        <div className="wrap pf">
          <h2 className="pword">Translated</h2>
          <div>
            <p className="lede">5.7 million pages in English, each aligned with its original. Of these books, 4,561 appear in English for the first time.</p>
            <h3 style={{ marginTop: '8px' }}>Translated pages, by century</h3>
            <p className="note" style={{ marginBottom: '18px' }}>By date of the book.</p>
            <div className="bar"><span>before 1400</span><i style={{ width: '17%' }}></i><span>0.17M</span></div>
            <div className="bar"><span>1400s</span><i style={{ width: '40%' }}></i><span>0.4M</span></div>
            <div className="bar"><span>1500s</span><i style={{ width: '100%' }}></i><span>1.0M</span></div>
            <div className="bar"><span>1600s</span><i style={{ width: '90%' }}></i><span>0.9M</span></div>
            <div className="bar"><span>1700s</span><i style={{ width: '90%' }}></i><span>0.9M</span></div>
            <div className="bar"><span>1800s</span><i style={{ width: '90%' }}></i><span>0.9M</span></div>
            <div className="bar"><span>1900–1930</span><i style={{ width: '50%' }}></i><span>0.5M</span></div>
          </div>
        </div>
      </section>

      <section className="proof alt" id="reviewed">
        <div className="wrap pf">
          <h2 className="pword">Community-reviewed</h2>
          <div>
            <p className="lede">The most demanding material is reviewed by scholars; the Mayanist David Stuart has recently examined our Yucatec Maya readings. A further 1,465 volunteers correct pages, and readers report what they find.</p>
            <p>Translations are tested against published human translations in fourteen languages, and error rates are published.</p>
            <div className="photos">
              <img src="/partners/embassy.jpg" alt="The Embassy of the Free Mind, Amsterdam" />
              <img src="/partners/bibliotheca.jpg" alt="Guests in the Bibliotheca Philosophica Hermetica" />
            </div>
            <p className="cap">The Embassy of the Free Mind, Amsterdam, home of the Ritman Library.</p>
          </div>
        </div>
      </section>

      <section className="proof" id="rights">
        <div className="wrap pf">
          <h2 className="pword">Rights cleared</h2>
          <div>
            <p className="lede">The original texts are in the public domain. Each book's date and imprint are examined, and any work of uncertain status is withheld.</p>
            <p>Translations, notes and indexes are original to Source Library and published under a Creative Commons share-alike licence. Other uses may be licensed directly.</p>
          </div>
        </div>
      </section>

      <section className="proof alt" id="available">
        <div className="wrap pf">
          <h2 className="pword">Immediately available</h2>
          <div>
            <p className="lede">The public corpus is available now through our streaming API and MCP server, with a stable citation link for every passage. It comprises some 18 billion tokens, of which 11.5 billion are transcription and translation aligned to the page.</p>
            <p>A sample of ten books, with scans, transcriptions, translations and notes, is available on request. Representative works include Robert Fludd's <a href="/book/history-of-both-worlds-macrocosm-fludd">History of the Two Worlds</a> (1617); Athanasius Kircher's <a href="/book/mundus-subterraneus-kircher">Mundus Subterraneus</a> (1678); the <a href="/book/imperial-collection-of-mathematical-essentials-vol-2">Collected Essentials of Mathematics</a> commissioned by the Kangxi emperor (1723); Kamalākara's <a href="/book/siddhanta-tattva-viveka-bhatta">Discernment of the Principles of Astronomy</a> (1658), a Sanskrit treatise that takes issue with Bhāskara; and the <a href="/book/collected-works-of-the-8th-gyalwang-drukpa-kunzik-chokyi-1768-1822">collected works</a> of the eighth Gyalwang Drukpa (1768–1822). A description of <a href="/dataset">the dataset</a> is also available.</p>
          </div>
        </div>
      </section>

      <section className="band dark">
        <div className="wrap">
          <p className="eyebrow">The remaining work</p>
          <h2>19.6 million pages remain to be read</h2>
          <p className="narrow">They are scanned, catalogued and ready for transcription and translation.</p>
          <div className="progress" role="img" aria-label="Of 28.9 million scanned pages: 5.7 million translated, 3.7 million transcribed, 19.6 million waiting">
            <i className="seg tr" style={{ flex: 5.7 }}></i><i className="seg tc" style={{ flex: 3.7 }}></i><i className="seg wt dk" style={{ flex: 19.6 }}></i>
          </div>
          <div className="legend dk">
            <span><i className="sw tr"></i><b>5.7M</b> translated into English</span>
            <span><i className="sw tc"></i><b>3.7M</b> transcribed, awaiting translation</span>
            <span><i className="sw wt dk"></i><b>19.6M</b> scanned, waiting to be read</span>
          </div>
          <div className="offer dk">
            <div><h3>An open release</h3><p>A partner's support would fund the reading of the remaining pages and their release to the public, as AI laboratories have done for other major libraries.</p></div>
            <div><h3>Early access</h3><p>The partner receives each release in advance, together with held-back test sets and scholarly review in the languages of its choosing.</p></div>
            <div><h3>Acknowledgement</h3><p>The partner is credited on each release, alongside the Embassy of the Free Mind and the contributing libraries.</p></div>
          </div>
        </div>
      </section>

      <section className="summary">
        <div className="wrap">
          <div className="letter">
            <p className="eyebrow">Summary</p>
            <p>Source Library is the largest library of translated historical sources: a digital archive of 129,000 books in more than fifty languages, over 20,000 of them readable in English, each translation set beside its original page. Among them are 4,561 books translated into English for the first time, and 2,347 from the Ritman Library in Amsterdam, available nowhere else online.</p>
            <p>Source Library is a non-profit project of Wisdom Frontiers and the Embassy of the Free Mind. We welcome conversations with partners who wish to see the remaining 19.6 million pages read and released.</p>
            <p className="sig">Derek Lomas<span>Founder, Source Library</span></p>
            <p className="addr">derek@sourcelibrary.org</p>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <span><span className="tri" aria-hidden="true" style={{ marginRight: '8px', verticalAlign: '-1px' }}></span>Source Library is a Wisdom Frontiers project, with the <a href="https://embassyofthefreemind.com">Embassy of the Free Mind</a>, Amsterdam.</span>
          <span><a href="https://sourcelibrary.org">sourcelibrary.org</a> · <a href="https://wisdomfrontiers.org">wisdomfrontiers.org</a></span>
        </div>
      </footer>
      </div>
    </>
  );
}
