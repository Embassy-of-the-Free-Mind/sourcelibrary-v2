// Body of the AI-partners page (everything between the site header and footer).
// Plain HTML, no scripts: edit it here. Styles: ./ai-partners.css. Images: public/ai-partners/img/.
export const PARTNERS_HTML = `
<section class="hero">
  <div class="wrap">
    <div>
      <h1>The world's largest library of <em>translated</em> historical sources</h1>
      <p>22,500 books in English, translated from more than fifty languages, most of them printed between 1450 and 1800. Each translation is set opposite the page it came from, so any line can be checked against the original. About half had never been in English before. Behind them stand 131,000 books with their page scans.</p>
      <p class="cta"><a class="primary" href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20sample%20and%20datasheet">Request a sample</a><a href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20AI%20partnership">Talk to us</a></p>
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
      <li><a href="#v2-collected"><strong>Collected</strong><span>131,000 books from 30+ libraries</span></a></li>
      <li><a href="#v2-transcribed"><strong>Transcribed</strong><span>9.6M pages in the original script</span></a></li>
      <li><a href="#v2-translated"><strong>Translated</strong><span>5.7M pages into English</span></a></li>
      <li><a href="#v2-reviewed"><strong>Checked</strong><span>Language by language, with scholars</span></a></li>
      <li><a href="#v2-rights"><strong>Rights</strong><span>Stated book by book</span></a></li>
      <li><a href="#v2-available"><strong>Available now</strong><span>Streaming API and MCP</span></a></li>
    </ol>
  </div>
</nav>

<section class="band dark">
  <div class="wrap why">
    <div>
      <p class="eyebrow">The untranslated record</p>
      <h2>Most Renaissance Latin has never been translated into English</h2>
      <p>The translation of ancient texts in fifteenth-century Florence helped give rise to the Renaissance. Yet some nine in ten Latin works written in the Renaissance have never been translated into English. In our own library, 11,357 books are the first English translation of their work, about half of all we have made readable in English. Half of them are Latin; the rest are from Chinese (1,946), German (1,447), Dutch, French, Greek, Tibetan and dozens of other languages.</p>
      <p class="cap" style="color:var(--night-muted)">Measured against the Universal Short Title Catalogue: of Latin works composed and printed 1480–1620, 93% (91–95%) have no English translation on record, from a seeded random sample of 1,000 catalogue works, each searched for an English translation by AI search agents and not yet checked by a human panel. A second search of the same sample with a different model found 97% (95–98%); it missed some well-known translations, so we quote the lower figure. Debora Shuger’s estimate was roughly 90%. In our library: every translated book is searched for an earlier English translation, one at a time, by an AI search agent that links any translation it finds; 25,007 books had been searched by 2 November 2026. A book is marked a first translation only when no earlier one is found, and 11,357 works carry that mark. Spot checks of 55 marked books by a second model: 50 held, none was refuted, 5 unclear.</p>
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
        <tr><td>Books held, with their page scans</td><td class="n">131,547</td></tr>
        <tr><td>Public on the site</td><td class="n">70,968</td></tr>
        <tr><td>Public and readable in English</td><td class="n">20,278</td></tr>
        <tr><td>Page images held</td><td class="n">29.8M</td></tr>
        <tr><td>Images held: page scans, artworks and illustrations</td><td class="n">32 TB</td></tr>
        <tr><td>Ritman Library books, found only here</td><td class="n">2,347</td></tr>
      </table>
      <p class="note">Counted 29 October 2026; duplicates, takedowns and catalogue-only records are excluded. A further 409,000 books printed before 1850 are catalogued from partner libraries, linked to their scans, and queued to be read; they are not counted above. Storage measured 28 October.</p>
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
      <p class="lede">5.7 million pages in English, each aligned with its original. Of these, 11,357 works appear in English for the first time.</p>
      <figure style="margin:8px 0 28px">
        <a href="https://sourcelibrary.org/book/siddhanta-tattva-viveka-bhatta/page/20"><img src="/ai-partners/img/reader-sanskrit.jpg" alt="A page of Kamalākara’s Siddhānta-tattva-viveka in the reader: the scan, the Sanskrit transcription and the English translation side by side, with notes on technical terms" style="width:100%;height:auto;display:block;border:1px solid rgba(0,0,0,.08)" loading="lazy" width="1440" height="808"></a>
        <figcaption class="cap">Scan, transcription and translation side by side: Kamalākara’s <em>Discernment of the Principles of Astronomy</em> (1658), on the lengths of the cosmic cycle. Notes explain technical terms and give the original word.</figcaption>
      </figure>
      <h3 style="margin-top:8px">Books readable in English, by date</h3>
      <p class="note" style="margin-bottom:18px">By the year the edition was printed, or the manuscript written, which is often later than the work was composed. The darker part of each bar is the books marked as first English translations. 4,168 books with no recorded date are not shown. Counted 2 November 2026.</p>
      <div class="bar"><span>before 1400</span><i class="st"><b style="width:5.0%"></b><s style="width:6.0%"></s></i><span>507</span></div>
      <div class="bar"><span>1400s</span><i class="st"><b style="width:12.8%"></b><s style="width:17.8%"></s></i><span>1,404</span></div>
      <div class="bar"><span>1500s</span><i class="st"><b style="width:39.7%"></b><s style="width:35.0%"></s></i><span>3,422</span></div>
      <div class="bar"><span>1600s</span><i class="st"><b style="width:72.0%"></b><s style="width:28.0%"></s></i><span>4,586</span></div>
      <div class="bar"><span>1700s</span><i class="st"><b style="width:31.3%"></b><s style="width:18.6%"></s></i><span>2,289</span></div>
      <div class="bar"><span>1800s</span><i class="st"><b style="width:14.5%"></b><s style="width:57.0%"></s></i><span>3,279</span></div>
      <div class="bar"><span>1900 on</span><i class="st"><b style="width:7.6%"></b><s style="width:55.3%"></s></i><span>2,884</span></div>
      <div class="legend" style="margin-top:14px"><span><i class="sw tr"></i>first English translation</span><span><i class="sw tc"></i>other books readable in English</span></div>
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
      <p>What they find goes back into how that language is read: which model, which instructions, and when a page needs a second reading. We have logged 427 experiments on reading and translation quality. Translations are tested against published human translations in fourteen languages, errors are sorted into 44 kinds, and the error rates are <a href="https://sourcelibrary.org/quality">published</a>.</p>
      <p class="note">Latin, two-fifths of the English pages: transcriptions differ from a published text of the same printing by a median 3.7% of characters (77 pages), most of it the long s read as f, and 86% of English pages were rated 4 or 5 of 5 by a model judge against a published human translation (71 pages). Figures for each language, with their samples, are on the <a href="https://sourcelibrary.org/quality">quality page</a>; as of 26 October 2026.</p>
      <p>The record of this work is kept with the text: several readings of the same page, how each was judged against the image, and each correction beside the reading it replaced. It shows where models fail on old books, and why. 1,535 people have offered to help, and readers report what they find.</p>
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
    <h2 class="pword">Rights</h2>
    <div>
      <p class="lede">The original texts are in the public domain. A book whose status is uncertain is withheld from the public site; about 300 have been withheld so far.</p>
      <p>For a training licence (counted 30 October 2026): <strong>text</strong> from 28,700 books, 4.9 million pages; <strong>images</strong> from 11,929 of them, 2.6 million pages, where the holding library permits commercial use of its scans. For 8,428 of the text books the library's scans carry non-commercial terms; that text is under legal review. Pages read or translated by Claude are excluded.</p>
      <p>Translations, notes and indexes are original to Source Library and published under a Creative Commons share-alike licence. Search, retrieval for a user and individual use are free; training at scale is licensed directly. The terms and the rate card are on the <a href="https://sourcelibrary.org/licensing">licensing page</a>.</p>
    </div>
  </div>
</section>

<section class="proof alt" id="v2-licence">
  <div class="wrap pf">
    <h2 class="pword">In a licence</h2>
    <div>
      <p class="lede">28,700 books with licensable text, 4.9 million pages. Books by language:</p>
      <table class="ledger">
        <tr><td>Latin <span class="note">· 1.99M pages</span></td><td class="n">15,629</td></tr>
        <tr><td>English, original editions <span class="note">· 0.71M pages</span></td><td class="n">2,763</td></tr>
        <tr><td>German <span class="note">· 0.57M pages</span></td><td class="n">2,707</td></tr>
        <tr><td>Chinese <span class="note">· 0.16M pages</span></td><td class="n">2,331</td></tr>
        <tr><td>Greek <span class="note">· 0.38M pages</span></td><td class="n">985</td></tr>
        <tr><td>French <span class="note">· 0.26M pages</span></td><td class="n">857</td></tr>
        <tr><td>Dutch <span class="note">· 0.12M pages</span></td><td class="n">565</td></tr>
        <tr><td>Italian <span class="note">· 0.14M pages</span></td><td class="n">561</td></tr>
        <tr><td>Sanskrit <span class="note">· 0.07M pages</span></td><td class="n">323</td></tr>
        <tr><td>Russian <span class="note">· 0.09M pages</span></td><td class="n">229</td></tr>
        <tr><td>Other languages <span class="note">· 0.37M pages</span></td><td class="n">1,750</td></tr>
        <tr class="total"><td>All</td><td class="n">28,700</td></tr>
      </table>
      <p class="note">Counted 30 October 2026, by the language of the edition. English editions are transcribed, not translated. Every other language comes with its English translation on most pages.</p>
      <p>Each page is one record: the scan (with its crop where the page shares an image), the transcription, the English translation, the book's title, author, date and language, the holding library and its rights statement, the model and prompt version that wrote the transcription and the translation, a hash of the text, and quality flags such as marginalia or a book not yet fully translated. A per-book manifest lists every book with its rights class and page counts, and a datasheet describes how the set was built and what it leaves out.</p>
      <p>Two samples are <a href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20sample%20and%20datasheet">available on request</a>: ten complete books with notes, and 5,000 pages with their scans drawn from 2,256 books in 111 languages, with the datasheet.</p>
    </div>
  </div>
</section>

<section class="proof" id="v2-provenance">
  <div class="wrap pf">
    <h2 class="pword">Provenance</h2>
    <div>
      <p class="lede">Every page can be traced to the scan it was read from and the model that read it.</p>
      <p>Each book names the library that holds the original, with a link to its scan and, where the library gives one, its rights statement. Each transcription and translation records the model that produced it; since 28 September 2026 it also records the exact prompt, the settings, the run and the image or text it was made from, with a hash of the output. When a page is corrected or re-read, the earlier version is kept.</p>
    </div>
  </div>
</section>

<section class="proof alt" id="v2-available">
  <div class="wrap pf">
    <h2 class="pword">Available now</h2>
    <div>
      <p class="lede">The public library is available now through our streaming API and <a href="https://sourcelibrary.org/developers">MCP server</a>, with a stable citation link for every passage. The whole corpus, public and held, comprises about 21 billion tokens, three times the size of English Wikipedia: 15 billion in the original languages and 6 billion of English translation, each page aligned to its scan.</p>
      <p class="note">Measured 29 October 2026 with the o200k tokenizer over a random sample of 12,000 pages, multiplied by the exact counts of transcribed and translated pages; by the median page, about 14.5 billion. English Wikipedia’s articles hold about 5 billion words, some 6.5 billion tokens. In words the library is half as large again, 7.7 billion: Latin, Chinese and Sanskrit take more tokens per word than English.</p>
      <table class="ledger">
        <tr><td>Page views by readers, last 7 days</td><td class="n">103K</td></tr>
        <tr><td>Pages fetched by ChatGPT and Claude for their users, last 7 days</td><td class="n">28K</td></tr>
        <tr><td>Library tool calls by Claude for its users through our MCP server, last 7 days</td><td class="n">35K</td></tr>
        <tr><td>Automated requests stopped at our network edge, per day</td><td class="n">~800K</td></tr>
        <tr><td>Bulk requests rate-limited by the site, last 30 days</td><td class="n">1.9M</td></tr>
      </table>
      <p class="note">Search engines and assistants acting for a user read freely. Training crawlers get the licence terms and a preview of each book. Counted 28 October 2026 from the site's logs; the assistant figures from Cloudflare's logs by user agent (ChatGPT-User, Claude-User), 26 October–1 November, not counting search-index crawlers such as OAI-SearchBot; the edge figure is the average of 26–27 October (blocked, or challenged and not passed), from Cloudflare.</p>
      <p>Representative works include Robert Fludd's <a href="https://sourcelibrary.org/book/history-of-both-worlds-macrocosm-fludd">History of the Two Worlds</a> (1617); Athanasius Kircher's <a href="https://sourcelibrary.org/book/mundus-subterraneus-kircher">Mundus Subterraneus</a> (1678); the <a href="https://sourcelibrary.org/book/imperial-collection-of-mathematical-essentials-vol-2">Collected Essentials of Mathematics</a> commissioned by the Kangxi emperor (1723); Kamalākara's <a href="https://sourcelibrary.org/book/siddhanta-tattva-viveka-bhatta">Discernment of the Principles of Astronomy</a> (1658), a Sanskrit treatise that takes issue with Bhāskara; and the <a href="https://sourcelibrary.org/book/collected-works-of-the-8th-gyalwang-drukpa-kunzik-chokyi-1768-1822">collected works</a> of the eighth Gyalwang Drukpa (1768–1822). A description of <a href="https://sourcelibrary.org/dataset">the dataset</a> is also available.</p>
    </div>
  </div>
</section>

<section class="band dark">
  <div class="wrap">
    <p class="eyebrow">The remaining work</p>
    <h2>20.2 million pages remain to be read</h2>
    <p class="narrow">They are scanned, catalogued and ready for transcription and translation. Behind them are 409,000 more books, some 87 million pages, catalogued from partner libraries and waiting to be copied in.</p>
    <div class="progress" role="img" aria-label="Of 29.8 million scanned pages: 5.7 million translated, 3.9 million transcribed, 20.2 million waiting">
      <i class="seg tr" style="flex:5.7"></i><i class="seg tc" style="flex:3.9"></i><i class="seg wt dk" style="flex:20.2"></i>
    </div>
    <div class="legend dk">
      <span><i class="sw tr"></i><b>5.7M</b> translated into English</span>
      <span><i class="sw tc"></i><b>3.9M</b> transcribed, awaiting translation</span>
      <span><i class="sw wt dk"></i><b>20.2M</b> scanned, waiting to be read</span>
    </div>
    <div class="offer dk">
      <div><h3>An open release</h3><p>The tools that read these pages work today. A partner's support would fund the remaining pages and their release to the public, as Microsoft and OpenAI did for Harvard's Institutional Books.</p></div>
      <div><h3>Early access</h3><p>The partner receives each release in advance, together with held-back test sets and scholarly review in the languages of its choosing.</p></div>
      <div><h3>Acknowledgement</h3><p>The partner is credited on each release, alongside the Embassy of the Free Mind and the contributing libraries.</p></div>
    </div>
  </div>
</section>

<section class="summary">
  <div class="wrap">
    <div class="letter">
      <p class="eyebrow">Summary</p>
      <p>Source Library is a digital library of translated historical sources: 131,000 books in more than fifty languages, over 20,000 of them readable in English, each translation set beside its original page. Among them are 11,357 works translated into English for the first time, and 2,347 from the Ritman Library in Amsterdam, available nowhere else online.</p>
      <p>Source Library is a non-profit project of Wisdom Frontiers and the Embassy of the Free Mind. We welcome conversations with partners who wish to see the remaining 20.2 million pages read and released.</p>
      <p class="sig">Derek Lomas<span>Founder, Source Library</span></p>
      <p class="addr"><a href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20AI%20partnership">derek@sourcelibrary.org</a></p>
      <p class="cta"><a class="primary" href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20sample%20and%20datasheet">Request a sample</a><a href="https://sourcelibrary.org/licensing">Licensing terms</a><a href="https://sourcelibrary.org/developers">API and MCP</a></p>
    </div>
  </div>
</section>
`;
