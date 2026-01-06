'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  CheckCircle,
  Circle,
  ExternalLink,
  Copy,
  Search,
  Globe,
  BookOpen,
  Users,
  Mail,
  Megaphone,
  TrendingUp,
  FileText,
  Github,
  Twitter,
} from 'lucide-react';

interface DirectoryItem {
  name: string;
  url: string;
  category: 'academic' | 'digital-library' | 'esoteric' | 'mcp' | 'developer';
  status: 'submitted' | 'listed' | 'pending' | 'not-started';
  notes?: string;
  contactEmail?: string;
}

interface OutreachTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  audience: string;
}

const DIRECTORIES: DirectoryItem[] = [
  // Academic / Research
  {
    name: 'History of Hermetic Philosophy (UvA)',
    url: 'https://hermetica.uva.nl/online-resources/archives-libraries-collections.html',
    category: 'academic',
    status: 'not-started',
    notes: 'Major academic resource directory. Contact program coordinator.',
    contactEmail: 'hermetica@uva.nl',
  },
  {
    name: 'IAPSOP (International Association for Preservation of Spiritualist and Occult Periodicals)',
    url: 'https://iapsop.com/',
    category: 'academic',
    status: 'not-started',
    notes: 'Archive of spiritualist and occult periodicals',
  },
  {
    name: 'Esoteric Archives (Joseph Peterson)',
    url: 'https://www.esotericarchives.com/',
    category: 'esoteric',
    status: 'not-started',
    notes: 'Well-known grimoire and esoteric text archive',
  },
  {
    name: 'Hermetic Library',
    url: 'https://hermetic.com/',
    category: 'esoteric',
    status: 'not-started',
    notes: 'One of the oldest esoteric sites online (since 1996)',
  },
  {
    name: 'Alchemy Archive',
    url: 'https://www.alchemyarchive.org/',
    category: 'esoteric',
    status: 'not-started',
    notes: 'Alchemical manuscript and translation archive',
  },
  {
    name: 'Adam McLean Alchemy Website',
    url: 'https://www.alchemywebsite.com/',
    category: 'esoteric',
    status: 'not-started',
    notes: 'Thousands of alchemical texts and images',
  },
  // Digital Libraries
  {
    name: 'Wikipedia - Digital Library article',
    url: 'https://en.wikipedia.org/wiki/Digital_library',
    category: 'digital-library',
    status: 'not-started',
    notes: 'Add to external links section',
  },
  {
    name: 'Wikipedia - Hermeticism article',
    url: 'https://en.wikipedia.org/wiki/Hermeticism',
    category: 'academic',
    status: 'not-started',
    notes: 'Add as external resource if notable',
  },
  {
    name: 'Open Access Directory',
    url: 'https://oad.simmons.edu/oadwiki/Main_Page',
    category: 'digital-library',
    status: 'not-started',
    notes: 'Directory of open access repositories',
  },
  // MCP / Developer
  {
    name: 'MCP.so',
    url: 'https://mcp.so/server/source-library',
    category: 'mcp',
    status: 'listed',
    notes: 'Listed! https://mcp.so/server/source-library',
  },
  {
    name: 'mcpservers.org',
    url: 'https://mcpservers.org/',
    category: 'mcp',
    status: 'submitted',
    notes: 'Submitted manually',
  },
  {
    name: 'awesome-mcp-servers (GitHub)',
    url: 'https://github.com/punkpeye/awesome-mcp-servers/issues/1629',
    category: 'mcp',
    status: 'submitted',
    notes: 'Issue #1629 created',
  },
  {
    name: 'modelcontextprotocol/servers (GitHub)',
    url: 'https://github.com/modelcontextprotocol/servers/issues/3177',
    category: 'mcp',
    status: 'submitted',
    notes: 'Issue #3177 created',
  },
  // Search Engines
  {
    name: 'Google Search Console',
    url: 'https://search.google.com/search-console',
    category: 'developer',
    status: 'listed',
    notes: 'Sitemap submitted, 47k+ pages',
  },
  {
    name: 'Bing Webmaster Tools',
    url: 'https://www.bing.com/webmasters',
    category: 'developer',
    status: 'listed',
    notes: 'Verified, IndexNow integrated',
  },
  {
    name: 'Google Scholar',
    url: 'https://scholar.google.com/intl/en/scholar/inclusion.html',
    category: 'academic',
    status: 'not-started',
    notes: 'Register for academic indexing',
  },
];

const OUTREACH_TEMPLATES: OutreachTemplate[] = [
  {
    id: 'academic-directory',
    name: 'Academic Directory Listing',
    audience: 'Academic resource directories',
    subject: 'Source Library - Open Access Hermetic & Esoteric Text Translations',
    body: `Dear [Name/Team],

I'm writing to introduce Source Library (https://sourcelibrary.org), a new open-access digital library focused on digitizing and translating rare Hermetic, esoteric, and early modern philosophical texts.

Our collection includes over 1,200 works with AI-assisted translations, spanning:
- Alchemical treatises (Khunrath, Libavius, Sendivogius)
- Hermetic philosophy (Ficino, Agrippa, Fludd)
- Kabbalah and Christian mysticism
- Early scientific texts (Kepler, Paracelsus)

Key features:
- Full-text search across all translations
- Side-by-side original/translation view
- MCP server integration for AI research tools
- CC0 public domain licensing
- REST API for programmatic access

We believe Source Library would be a valuable addition to your resource directory. The entire collection is freely accessible with no registration required.

Would you be open to including us in [Directory Name]?

Best regards,
[Your name]
Source Library
https://sourcelibrary.org`,
  },
  {
    id: 'collaboration',
    name: 'Research Collaboration',
    audience: 'Academics, researchers',
    subject: 'Collaboration opportunity - AI-assisted historical text translation',
    body: `Dear Professor [Name],

I came across your work on [specific topic] and thought you might be interested in Source Library (https://sourcelibrary.org), a digital humanities project focused on making rare historical texts accessible through AI-assisted translation.

We've digitized and translated over 1,200 works in the Western esoteric tradition, including:
- [Relevant text 1 to their research]
- [Relevant text 2 to their research]

Our translations are generated using multimodal AI (Gemini) with human review, and the entire corpus is available under CC0 public domain licensing for research purposes.

I'd be happy to:
- Prioritize specific texts relevant to your research
- Provide bulk access to our translation data
- Discuss our methodology for AI-assisted translation of historical texts

Would you have time for a brief call to discuss potential collaboration?

Best regards,
[Your name]`,
  },
  {
    id: 'social-introduction',
    name: 'Social Media Introduction',
    audience: 'Twitter/Reddit communities',
    subject: 'N/A - Social post',
    body: `Introducing Source Library - 1,200+ rare Hermetic & alchemical texts, digitized and translated with AI.

Features:
- Full-text search across translations
- Side-by-side original/translation view
- MCP server for AI assistants
- REST API access
- CC0 public domain

No registration. No paywall. Just the sources.

https://sourcelibrary.org

#DigitalHumanities #Alchemy #Hermeticism #OpenAccess`,
  },
  {
    id: 'reddit-post',
    name: 'Reddit Introduction',
    audience: 'r/alchemy, r/hermeticism, r/occult',
    subject: 'Free resource: 1,200+ translated Hermetic & alchemical texts',
    body: `Hey everyone,

I've been working on Source Library (https://sourcelibrary.org), a free digital library of rare Hermetic, alchemical, and esoteric texts with AI-assisted translations.

**What's included:**
- Khunrath's Amphitheatrum Sapientiae Aeternae
- Agrippa's Opera (complete Latin works)
- Fludd's Utriusque Cosmi Historia
- Sendivogius, Libavius, Paracelsus
- Ficino's translations and commentaries
- Hundreds more...

**Features:**
- Side-by-side original/translation view
- Full-text search across all translations
- High-res page images from Archive.org, Gallica, MDZ
- No registration, no paywall

The translations are AI-generated (Gemini) from OCR of the original texts. They're not perfect scholarly editions, but they make these texts accessible for the first time in English.

Everything is CC0 public domain - use however you like.

Happy to answer questions or take requests for specific texts!`,
  },
];

const CATEGORY_LABELS: Record<DirectoryItem['category'], string> = {
  academic: 'Academic',
  'digital-library': 'Digital Library',
  esoteric: 'Esoteric',
  mcp: 'MCP/Developer',
  developer: 'Search/SEO',
};

const STATUS_COLORS: Record<DirectoryItem['status'], string> = {
  listed: 'text-green-500',
  submitted: 'text-amber-500',
  pending: 'text-blue-500',
  'not-started': 'text-stone-500',
};

export default function MarketingPage() {
  const [selectedCategory, setSelectedCategory] = useState<DirectoryItem['category'] | 'all'>('all');
  const [copiedTemplate, setCopiedTemplate] = useState<string | null>(null);

  const filteredDirectories = selectedCategory === 'all'
    ? DIRECTORIES
    : DIRECTORIES.filter(d => d.category === selectedCategory);

  const stats = {
    listed: DIRECTORIES.filter(d => d.status === 'listed').length,
    submitted: DIRECTORIES.filter(d => d.status === 'submitted').length,
    notStarted: DIRECTORIES.filter(d => d.status === 'not-started').length,
  };

  const copyToClipboard = (text: string, templateId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTemplate(templateId);
    setTimeout(() => setCopiedTemplate(null), 2000);
  };

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      {/* Header */}
      <header className="border-b border-stone-800 bg-stone-900">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-stone-400 hover:text-white">
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl font-semibold flex items-center gap-2">
                  <Megaphone className="w-5 h-5 text-amber-500" />
                  Marketing & Outreach
                </h1>
                <p className="text-sm text-stone-400">Directory listings, SEO, and outreach templates</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {/* SEO Status */}
        <section className="bg-stone-900 rounded-lg p-6 border border-stone-800">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-500" />
            SEO Status
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-stone-800 rounded-lg p-4">
              <p className="text-2xl font-bold text-green-500">48,546</p>
              <p className="text-sm text-stone-400">URLs in Sitemap</p>
            </div>
            <div className="bg-stone-800 rounded-lg p-4">
              <p className="text-2xl font-bold text-amber-500">~2</p>
              <p className="text-sm text-stone-400">Google Indexed</p>
            </div>
            <div className="bg-stone-800 rounded-lg p-4">
              <p className="text-2xl font-bold text-green-500">47,284</p>
              <p className="text-sm text-stone-400">Bing Submitted</p>
            </div>
            <div className="bg-stone-800 rounded-lg p-4">
              <p className="text-2xl font-bold text-green-500">Active</p>
              <p className="text-sm text-stone-400">IndexNow</p>
            </div>
          </div>
          <div className="mt-4 flex gap-4 text-sm">
            <a
              href="https://search.google.com/search-console"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:underline flex items-center gap-1"
            >
              Google Search Console <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://www.bing.com/webmasters"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:underline flex items-center gap-1"
            >
              Bing Webmaster Tools <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </section>

        {/* Directory Listings */}
        <section className="bg-stone-900 rounded-lg p-6 border border-stone-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <Globe className="w-5 h-5 text-sky-500" />
              Directory Listings
            </h2>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1 text-green-500">
                <CheckCircle className="w-4 h-4" />
                {stats.listed} Listed
              </span>
              <span className="flex items-center gap-1 text-amber-500">
                <Circle className="w-4 h-4" />
                {stats.submitted} Submitted
              </span>
              <span className="flex items-center gap-1 text-stone-500">
                <Circle className="w-4 h-4" />
                {stats.notStarted} Todo
              </span>
            </div>
          </div>

          {/* Category Filter */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                selectedCategory === 'all'
                  ? 'bg-sky-600 text-white'
                  : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
              }`}
            >
              All ({DIRECTORIES.length})
            </button>
            {(Object.keys(CATEGORY_LABELS) as DirectoryItem['category'][]).map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  selectedCategory === cat
                    ? 'bg-sky-600 text-white'
                    : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                }`}
              >
                {CATEGORY_LABELS[cat]} ({DIRECTORIES.filter(d => d.category === cat).length})
              </button>
            ))}
          </div>

          {/* Directory List */}
          <div className="space-y-3">
            {filteredDirectories.map((dir) => (
              <div
                key={dir.url}
                className="bg-stone-800 rounded-lg p-4 border border-stone-700"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={dir.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-white hover:text-sky-400 flex items-center gap-1"
                      >
                        {dir.name}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <span className="text-xs px-2 py-0.5 rounded bg-stone-700 text-stone-400">
                        {CATEGORY_LABELS[dir.category]}
                      </span>
                    </div>
                    {dir.notes && (
                      <p className="text-sm text-stone-400 mt-1">{dir.notes}</p>
                    )}
                    {dir.contactEmail && (
                      <a
                        href={`mailto:${dir.contactEmail}`}
                        className="text-xs text-sky-400 hover:underline mt-1 inline-flex items-center gap-1"
                      >
                        <Mail className="w-3 h-3" />
                        {dir.contactEmail}
                      </a>
                    )}
                  </div>
                  <div className={`flex items-center gap-1 text-sm ${STATUS_COLORS[dir.status]}`}>
                    {dir.status === 'listed' ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <Circle className="w-4 h-4" />
                    )}
                    <span className="capitalize">{dir.status.replace('-', ' ')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Outreach Templates */}
        <section className="bg-stone-900 rounded-lg p-6 border border-stone-800">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Mail className="w-5 h-5 text-violet-500" />
            Outreach Templates
          </h2>
          <div className="space-y-4">
            {OUTREACH_TEMPLATES.map((template) => (
              <div
                key={template.id}
                className="bg-stone-800 rounded-lg border border-stone-700 overflow-hidden"
              >
                <div className="p-4 border-b border-stone-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">{template.name}</h3>
                      <p className="text-sm text-stone-400">{template.audience}</p>
                    </div>
                    <button
                      onClick={() => copyToClipboard(template.body, template.id)}
                      className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-sm flex items-center gap-1"
                    >
                      {copiedTemplate === template.id ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  {template.subject !== 'N/A - Social post' && (
                    <p className="text-sm text-stone-300 mt-2">
                      <span className="text-stone-500">Subject:</span> {template.subject}
                    </p>
                  )}
                </div>
                <pre className="p-4 text-sm text-stone-300 whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">
                  {template.body}
                </pre>
              </div>
            ))}
          </div>
        </section>

        {/* Social Strategy */}
        <section className="bg-stone-900 rounded-lg p-6 border border-stone-800">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-pink-500" />
            Social & Community Outreach
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {/* Reddit */}
            <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
              <h3 className="font-medium flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-orange-500" />
                Reddit Communities
              </h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="https://reddit.com/r/alchemy" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
                    r/alchemy
                  </a>
                  <span className="text-stone-500 ml-2">~50k members</span>
                </li>
                <li>
                  <a href="https://reddit.com/r/hermeticism" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
                    r/hermeticism
                  </a>
                  <span className="text-stone-500 ml-2">~30k members</span>
                </li>
                <li>
                  <a href="https://reddit.com/r/occult" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
                    r/occult
                  </a>
                  <span className="text-stone-500 ml-2">~400k members</span>
                </li>
                <li>
                  <a href="https://reddit.com/r/DigitalHumanities" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
                    r/DigitalHumanities
                  </a>
                  <span className="text-stone-500 ml-2">~10k members</span>
                </li>
                <li>
                  <a href="https://reddit.com/r/ClaudeAI" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
                    r/ClaudeAI
                  </a>
                  <span className="text-stone-500 ml-2">MCP server announcement</span>
                </li>
              </ul>
            </div>

            {/* Twitter */}
            <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
              <h3 className="font-medium flex items-center gap-2 mb-3">
                <Twitter className="w-4 h-4 text-sky-500" />
                Twitter/X Strategy
              </h3>
              <ul className="space-y-2 text-sm text-stone-300">
                <li>Post high-quality gallery images with context</li>
                <li>Tag relevant academics and authors</li>
                <li>Use hashtags: #DigitalHumanities #Alchemy #Hermeticism</li>
                <li>Engage with esoteric/academic Twitter</li>
                <li>
                  <Link href="/admin/social" className="text-sky-400 hover:underline">
                    Social Media Admin →
                  </Link>
                </li>
              </ul>
            </div>

            {/* Academic */}
            <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
              <h3 className="font-medium flex items-center gap-2 mb-3">
                <BookOpen className="w-4 h-4 text-green-500" />
                Academic Platforms
              </h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="https://www.academia.edu/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
                    Academia.edu
                  </a>
                  <span className="text-stone-500 ml-2">Share methodology paper</span>
                </li>
                <li>
                  <a href="https://www.researchgate.net/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
                    ResearchGate
                  </a>
                  <span className="text-stone-500 ml-2">Connect with researchers</span>
                </li>
                <li>
                  <a href="https://orcid.org/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
                    ORCID
                  </a>
                  <span className="text-stone-500 ml-2">Register project</span>
                </li>
              </ul>
            </div>

            {/* Developer */}
            <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
              <h3 className="font-medium flex items-center gap-2 mb-3">
                <Github className="w-4 h-4 text-stone-300" />
                Developer Community
              </h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="https://news.ycombinator.com/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
                    Hacker News
                  </a>
                  <span className="text-stone-500 ml-2">Show HN post</span>
                </li>
                <li>
                  <a href="https://dev.to/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
                    Dev.to
                  </a>
                  <span className="text-stone-500 ml-2">MCP integration tutorial</span>
                </li>
                <li>
                  <a href="https://discord.gg/anthropic" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
                    Anthropic Discord
                  </a>
                  <span className="text-stone-500 ml-2">MCP showcase</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Quick Actions */}
        <section className="bg-stone-900 rounded-lg p-6 border border-stone-800">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Search className="w-5 h-5 text-amber-500" />
            Quick Links
          </h2>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://www.google.com/search?q=site%3Asourcelibrary.org"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-stone-800 hover:bg-stone-700 rounded-lg text-sm flex items-center gap-2"
            >
              <Search className="w-4 h-4" />
              Google site: search
            </a>
            <a
              href="/sitemap.xml"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-stone-800 hover:bg-stone-700 rounded-lg text-sm flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              View Sitemap
            </a>
            <a
              href="/robots.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-stone-800 hover:bg-stone-700 rounded-lg text-sm flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              View robots.txt
            </a>
            <a
              href="/llms.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-stone-800 hover:bg-stone-700 rounded-lg text-sm flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              View llms.txt
            </a>
            <a
              href="/developers"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-stone-800 hover:bg-stone-700 rounded-lg text-sm flex items-center gap-2"
            >
              <Globe className="w-4 h-4" />
              Developer Page
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
