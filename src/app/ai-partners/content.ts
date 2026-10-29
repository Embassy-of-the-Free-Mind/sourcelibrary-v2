// Body of the AI-partners page (everything between the site header and footer).
// Plain HTML, no scripts: edit it here. Styles: ./ai-partners.css. Images: public/ai-partners/img/.
export const PARTNERS_HTML = `
<section class="hero">
  <div class="wrap">
    <div>
      <h1>Historical sources, <em>translated</em> beside the page</h1>
      <p>129,000 books in more than fifty languages. Over 20,000 are transcribed and translated into English, each translation set opposite the page it came from, so any line can be checked against the original.</p>
    </div>
    <figure>
      <img src="/ai-partners/img/fludd-empyrean.jpg" alt="Engraved circle of the heavens: a dark starry core, a ring of stars, and an outer band of flames">
      <figcaption><a href="https://sourcelibrary.org/book/69904dd67d19f3f2aac1d49d?page=140">Robert Fludd, <i>Utriusque cosmi historia</i>, 1617: the Empyrean heaven · Source Library</a></figcaption>
    </figure>
  </div>
</section>

<nav class="pillars" aria-label="What the corpus is">
  <div class="wrap">
    <ol>
      <li><a href="#v2-collected"><strong>Collected</strong><span>129,000 books from 30+ libraries</span></a></li>
      <li><a href="#v2-transcribed"><strong>Transcribed</strong><span>9.6M pages in the original script</span></a></li>
      <li><a href="#v2-translated"><strong>Translated</strong><span>5.7M pages into English</span></a></li>
      <li><a href="#v2-reviewed"><strong>Checked</strong><span>Language by language, with scholars</span></a></li>
      <li><a href="#v2-rights"><strong>Rights cleared</strong><span>Public-domain originals</span></a></li>
      <li><a href="#v2-available"><strong>Immediately available</strong><span>Streaming API and MCP</span></a></li>
    </ol>
  </div>
</nav>

<section class="band dark">
  <div class="wrap why">
    <div>
      <p class="eyebrow">The untranslated record</p>
      <h2>Most of it has never been translated</h2>
      <p>The translation of ancient texts in fifteenth-century Florence helped give rise to the Renaissance. Yet some nine in ten Latin works written in the Renaissance have never been translated into English. In our own library, most of the books we translate have no earlier English translation.</p>
      <p class="cap" style="color:var(--night-muted)">Measured against the Universal Short Title Catalogue: of Latin works composed and printed 1480–1620, 93% (91–95%) have no English translation on record, from a seeded random sample of 1,000 catalogue works, each searched for an English translation by AI search agents and not yet checked by a human panel. A second search of the same sample with a different model found 97% (95–98%); it missed some well-known translations, so we quote the lower figure. Debora Shuger’s estimate was roughly 90%. In our library: of a random sample of 995 books we have translated, from Latin, German, Chinese, Sanskrit and other languages, a search found no earlier English translation for 59% (56–62%), and only a partial one for another 7%. Searched October 2026.</p>
      
      
    </div>
    <figure style="margin:0">
      <div class="frame"><img src="/ai-partners/img/hero.jpg" alt="An early printed Latin page naming Marsilio Ficino and Pico della Mirandola"></div>
      <figcaption class="cap" style="color:var(--night-muted)">An early printed page naming Marsilio Ficino and Giovanni Pico della Mirandola.</figcaption>
    </figure>
  </div>
</section>

<section class="proof" id="v2-collected">
  <div class="wrap pf">
    <h2 class="pword">Collected</h2>
    <div>
      <p class="lede">Assembled from more than thirty libraries and catalogued by work, edition and author.</p>
      <table class="ledger">
        <tr><td>Books digitally archived</td><td class="n">129,166</td></tr>
        <tr><td>Public on the site</td><td class="n">70,874</td></tr>
        <tr><td>Readable in English</td><td class="n">21,502</td></tr>
        <tr><td>Page images held</td><td class="n">28.9M</td></tr>
        <tr><td>Images held: page scans, artworks and illustrations</td><td class="n">32 TB</td></tr>
        <tr><td>Ritman Library books, found only here</td><td class="n">2,347</td></tr>
      </table>
      <p class="note">Counted 28 October 2026.</p>
    </div>
  </div>
</section>

<section class="proof alt" id="v2-transcribed">
  <div class="wrap pf">
    <h2 class="pword">Transcribed</h2>
    <div>
      <p class="lede">9.6 million pages transcribed in their original language and script. Latin and classical Chinese predominate, alongside German, French, Italian, Greek, Hebrew, Arabic, Syriac, Sanskrit, Tibetan and Yucatec Maya.</p>
      <p>Each page is indexed by the people, places and ideas it names, so an idea can be followed from book to book.</p>
    </div>
  </div>
</section>

<section class="proof" id="v2-translated">
  <div class="wrap pf">
    <h2 class="pword">Translated</h2>
    <div>
      <p class="lede">5.7 million pages in English, each aligned with its original. Of these books, 6,043 appear in English for the first time.</p>
      <figure style="margin:8px 0 28px">
        <a href="https://sourcelibrary.org/book/siddhanta-tattva-viveka-bhatta/page/20"><img src="/ai-partners/img/reader-sanskrit.jpg" alt="A page of Kamalākara’s Siddhānta-tattva-viveka in the reader: the scan, the Sanskrit transcription and the English translation side by side, with notes on technical terms" style="width:100%;height:auto;display:block;border:1px solid rgba(0,0,0,.08)" loading="lazy" width="1440" height="808"></a>
        <figcaption class="cap">Scan, transcription and translation side by side: Kamalākara’s <em>Discernment of the Principles of Astronomy</em> (1658), on the lengths of the cosmic cycle. Notes explain technical terms and give the original word.</figcaption>
      </figure>
      <h3 style="margin-top:8px">Translated pages, by century</h3>
      <p class="note" style="margin-bottom:18px">By date of the book.</p>
      <div class="bar"><span>before 1400</span><i style="width:17%"></i><span>0.17M</span></div>
      <div class="bar"><span>1400s</span><i style="width:40%"></i><span>0.4M</span></div>
      <div class="bar"><span>1500s</span><i style="width:100%"></i><span>1.0M</span></div>
      <div class="bar"><span>1600s</span><i style="width:90%"></i><span>0.9M</span></div>
      <div class="bar"><span>1700s</span><i style="width:90%"></i><span>0.9M</span></div>
      <div class="bar"><span>1800s</span><i style="width:90%"></i><span>0.9M</span></div>
      <div class="bar"><span>1900–1930</span><i style="width:50%"></i><span>0.5M</span></div>
    </div>
  </div>
</section>

<section class="proof alt" id="v2-reviewed">
  <div class="wrap pf">
    <h2 class="pword">Checked</h2>
    <div>
      <p class="lede">Each language has its own scripts, abbreviations and habits, and models read some far better than others. So each one is worked out separately, and scholars who read it check the hard cases.</p>
      <table class="ledger">
        <tr><td>Yucatec Maya</td><td class="who">David Stuart</td></tr>
        <tr><td>Latin and Sanskrit</td><td class="who">Peter J. Forshaw</td></tr>
        <tr><td>Latin, and early printed books</td><td class="who">Paul Dijstelberge</td></tr>
      </table>
      <p>What they find goes back into how that language is read: which model, which instructions, and when a page needs a second reading. We have logged 427 experiments on reading and translation quality. Translations are tested against published human translations in fourteen languages, errors are sorted into 44 kinds, and the error rates are published.</p>
      <p>The record of that work comes with the text: several readings of the same page, how each was judged against the image, and each correction beside the reading it replaced. It shows where models fail on old books, and why. 1,535 people have offered to help, and readers report what they find.</p>
      <div class="photos">
        <img src="/ai-partners/img/embassy.jpg" alt="The Embassy of the Free Mind, Amsterdam">
        <img src="/ai-partners/img/bibliotheca.jpg" alt="Guests in the Bibliotheca Philosophica Hermetica">
      </div>
      <p class="cap">The Embassy of the Free Mind, Amsterdam, home of the Ritman Library.</p>
    </div>
  </div>
</section>

<section class="proof" id="v2-rights">
  <div class="wrap pf">
    <h2 class="pword">Rights cleared</h2>
    <div>
      <p class="lede">The original texts are in the public domain. A book whose status is uncertain is withheld from the public site; about 300 have been withheld so far.</p>
      <p>Translations, notes and indexes are original to Source Library and published under a Creative Commons share-alike licence. Other uses may be licensed directly.</p>
    </div>
  </div>
</section>

<section class="proof alt" id="v2-provenance">
  <div class="wrap pf">
    <h2 class="pword">Provenance</h2>
    <div>
      <p class="lede">Every page can be traced to the scan it was read from and the model that read it.</p>
      <p>Each book names the library that holds the original, with a link to its scan and, where the library gives one, its rights statement. Each transcription and translation records the model that produced it; since 28 September 2026 it also records the exact prompt, the settings, the run and the image or text it was made from, with a hash of the output. When a page is corrected or re-read, the earlier version is kept.</p>
      <table class="ledger">
        <tr><td>Public books that name the library holding the original</td><td class="n">70,968 of 70,970</td></tr>
        <tr><td>…with a link back to the original scan</td><td class="n">95%</td></tr>
        <tr><td>Transcribed pages that name the model that read them</td><td class="n">96%</td></tr>
        <tr><td>Translated pages that name the model that translated them</td><td class="n">99.5%</td></tr>
        <tr><td>Pages with the full record (prompt, settings, run, source): transcriptions, translations</td><td class="n">34%, 31%</td></tr>
        <tr><td>Earlier versions of pages kept</td><td class="n">3.8 million</td></tr>
        <tr><td>Books whose holding library states the scan's rights, recorded with where it was read</td><td class="n">42%</td></tr>
        <tr><td>Books with a rights record of any kind: stated, assumed at import, or the library is silent</td><td class="n">99.7%</td></tr>
        <tr><td>Books whose catalogue details cite their source</td><td class="n">70%</td></tr>
      </table>
      <p class="note">Measured 29 October 2026: books over all public books, pages from a random draw of 60,000. Pages read before 28 September carry the model and prompt version but not the full record. Another 32% of books are recorded as public domain by our importer's assumption rather than a library's statement; for 26% the library's manifest states nothing, or could not be read, and the record says so.</p>
    </div>
  </div>
</section>

<section class="proof" id="v2-available">
  <div class="wrap pf">
    <h2 class="pword">Immediately available</h2>
    <div>
      <p class="lede">The public corpus is available now through our streaming API and MCP server, with a stable citation link for every passage. It comprises about 21 billion tokens, three times the size of English Wikipedia: 15 billion in the original languages and 6 billion of English translation, each page aligned to its scan.</p>
      <p class="note">Measured 29 October 2026 with the o200k tokenizer over a random sample of 12,000 pages, multiplied by the exact counts of transcribed and translated pages; by the median page, about 14.5 billion. English Wikipedia’s articles hold about 5 billion words, some 6.5 billion tokens. In words the library is half as large again, 7.7 billion: Latin, Chinese and Sanskrit take more tokens per word than English.</p>
      <table class="ledger">
        <tr><td>Page views by readers, last 7 days</td><td class="n">103K</td></tr>
        <tr><td>Pages fetched by ChatGPT and Claude for their users, last 30 days</td><td class="n">1.8M</td></tr>
        <tr><td>Automated requests stopped at our network edge, per day</td><td class="n">~800K</td></tr>
        <tr><td>Bulk requests rate-limited by the site, last 30 days</td><td class="n">1.9M</td></tr>
      </table>
      <p class="note">Search engines and assistants acting for a user read freely. Training crawlers get the licence terms and a preview of each book. Counted 28 October 2026 from the site's logs; the edge figure is the average of 26–27 October (blocked, or challenged and not passed), from Cloudflare.</p>
      <p>A sample of ten books, with scans, transcriptions, translations and notes, is available on request. Representative works include Robert Fludd's <a href="https://sourcelibrary.org/book/history-of-both-worlds-macrocosm-fludd">History of the Two Worlds</a> (1617); Athanasius Kircher's <a href="https://sourcelibrary.org/book/mundus-subterraneus-kircher">Mundus Subterraneus</a> (1678); the <a href="https://sourcelibrary.org/book/imperial-collection-of-mathematical-essentials-vol-2">Collected Essentials of Mathematics</a> commissioned by the Kangxi emperor (1723); Kamalākara's <a href="https://sourcelibrary.org/book/siddhanta-tattva-viveka-bhatta">Discernment of the Principles of Astronomy</a> (1658), a Sanskrit treatise that takes issue with Bhāskara; and the <a href="https://sourcelibrary.org/book/collected-works-of-the-8th-gyalwang-drukpa-kunzik-chokyi-1768-1822">collected works</a> of the eighth Gyalwang Drukpa (1768–1822). A description of <a href="https://sourcelibrary.org/dataset">the dataset</a> is also available.</p>
    </div>
  </div>
</section>

<section class="band dark">
  <div class="wrap">
    <p class="eyebrow">The remaining work</p>
    <h2>19.3 million pages remain to be read</h2>
    <p class="narrow">They are scanned, catalogued and ready for transcription and translation.</p>
    <div class="progress" role="img" aria-label="Of 28.9 million scanned pages: 5.7 million translated, 3.9 million transcribed, 19.3 million waiting">
      <i class="seg tr" style="flex:5.7"></i><i class="seg tc" style="flex:3.9"></i><i class="seg wt dk" style="flex:19.3"></i>
    </div>
    <div class="legend dk">
      <span><i class="sw tr"></i><b>5.7M</b> translated into English</span>
      <span><i class="sw tc"></i><b>3.9M</b> transcribed, awaiting translation</span>
      <span><i class="sw wt dk"></i><b>19.3M</b> scanned, waiting to be read</span>
    </div>
    <div class="offer dk">
      <div><h3>An open release</h3><p>The reading is built and running. A partner's support would fund the remaining pages and their release to the public, as AI laboratories have done for other major libraries.</p></div>
      <div><h3>Early access</h3><p>The partner receives each release in advance, together with held-back test sets and scholarly review in the languages of its choosing.</p></div>
      <div><h3>Acknowledgement</h3><p>The partner is credited on each release, alongside the Embassy of the Free Mind and the contributing libraries.</p></div>
    </div>
  </div>
</section>

<section class="summary">
  <div class="wrap">
    <div class="letter">
      <p class="eyebrow">Summary</p>
      <p>Source Library is the largest library of translated historical sources: a digital archive of 129,000 books in more than fifty languages, over 20,000 of them readable in English, each translation set beside its original page. Among them are 6,043 books translated into English for the first time, and 2,347 from the Ritman Library in Amsterdam, available nowhere else online.</p>
      <p>Source Library is a non-profit project of Wisdom Frontiers and the Embassy of the Free Mind. We welcome conversations with partners who wish to see the remaining 19.3 million pages read and released.</p>
      <p class="sig">Derek Lomas<span>Founder, Source Library</span></p>
      <p class="addr">derek@sourcelibrary.org</p>
    </div>
  </div>
</section>
`;
