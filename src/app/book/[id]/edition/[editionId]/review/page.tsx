'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  BookOpen,
  CheckCircle,
  AlertCircle,
  Edit3,
  Eye,
  Download,
  ExternalLink,
  RefreshCw,
  Award,
  Loader2,
  Save
} from 'lucide-react';
import { TranslationEdition, Book } from '@/lib/types';
import ReactMarkdown from 'react-markdown';

interface PageProps {
  params: Promise<{ id: string; editionId: string }>;
}

interface EditionData {
  book: Book;
  edition: TranslationEdition;
  pageCount: number;
  translatedCount: number;
}

type ReviewSection = 'overview' | 'introduction' | 'methodology' | 'preview' | 'approve';

export default function EditionReviewPage({ params }: PageProps) {
  const { id: bookId, editionId } = use(params);

  const [data, setData] = useState<EditionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ReviewSection>('overview');

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editedIntro, setEditedIntro] = useState('');
  const [editedMethodology, setEditedMethodology] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // DOI minting state
  const [isMinting, setIsMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  useEffect(() => {
    fetchEditionData();
  }, [bookId, editionId]);

  const fetchEditionData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch book with editions
      const bookRes = await fetch(`/api/books/${bookId}`);
      if (!bookRes.ok) throw new Error('Failed to fetch book');
      const book = await bookRes.json();

      // Find the edition
      const edition = book.editions?.find((e: TranslationEdition) => e.id === editionId);
      if (!edition) throw new Error('Edition not found');

      // Get page counts
      const pagesRes = await fetch(`/api/books/${bookId}/pages?limit=1`);
      const pagesData = await pagesRes.json();

      setData({
        book,
        edition,
        pageCount: pagesData.total || edition.page_count,
        translatedCount: edition.page_count,
      });

      // Initialize edit fields
      setEditedIntro(edition.front_matter?.introduction || '');
      setEditedMethodology(edition.front_matter?.methodology || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load edition');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFrontMatter = async () => {
    if (!data) return;
    setIsSaving(true);

    try {
      const response = await fetch(`/api/books/${bookId}/editions/${editionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          front_matter: {
            ...data.edition.front_matter,
            introduction: editedIntro,
            methodology: editedMethodology,
          },
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to save');
      }

      // Refresh data
      await fetchEditionData();
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleMintDoi = async () => {
    if (!data) return;
    setIsMinting(true);
    setMintError(null);

    try {
      const response = await fetch(`/api/books/${bookId}/editions/mint-doi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edition_id: editionId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to mint DOI');
      }

      // Refresh to show DOI
      await fetchEditionData();
    } catch (err) {
      setMintError(err instanceof Error ? err.message : 'Failed to mint DOI');
    } finally {
      setIsMinting(false);
    }
  };

  const handleDownloadEpub = () => {
    window.open(`/api/books/${bookId}/download?format=scholarly`, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-stone-600">
          <Loader2 className="w-6 h-6 animate-spin" />
          Loading edition...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-stone-600">{error || 'Edition not found'}</p>
          <Link href={`/book/${bookId}`} className="text-amber-600 hover:underline mt-2 inline-block">
            Back to book
          </Link>
        </div>
      </div>
    );
  }

  const { book, edition } = data;
  const hasDoi = !!edition.doi;
  const hasFrontMatter = !!(edition.front_matter?.introduction || edition.front_matter?.methodology);

  const sections: { id: ReviewSection; label: string; icon: React.ReactNode; status: 'complete' | 'pending' | 'warning' }[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <FileText className="w-4 h-4" />,
      status: 'complete'
    },
    {
      id: 'introduction',
      label: 'Introduction',
      icon: <BookOpen className="w-4 h-4" />,
      status: edition.front_matter?.introduction ? 'complete' : 'warning'
    },
    {
      id: 'methodology',
      label: 'Methodology',
      icon: <FileText className="w-4 h-4" />,
      status: edition.front_matter?.methodology ? 'complete' : 'warning'
    },
    {
      id: 'preview',
      label: 'Preview EPUB',
      icon: <Eye className="w-4 h-4" />,
      status: 'pending'
    },
    {
      id: 'approve',
      label: hasDoi ? 'Published' : 'Approve & Publish',
      icon: hasDoi ? <CheckCircle className="w-4 h-4" /> : <Award className="w-4 h-4" />,
      status: hasDoi ? 'complete' : 'pending'
    },
  ];

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href={`/book/${bookId}`}
                className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Book
              </Link>
              <div className="h-6 w-px bg-stone-200" />
              <div>
                <h1 className="text-lg font-semibold text-stone-900">Edition Review</h1>
                <p className="text-sm text-stone-500">v{edition.version} — {edition.version_label || 'Draft'}</p>
              </div>
            </div>

            {hasDoi && (
              <a
                href={edition.doi_url || `https://doi.org/${edition.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-sm font-medium"
              >
                <CheckCircle className="w-4 h-4" />
                DOI: {edition.doi}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* Sidebar Navigation */}
          <nav className="w-64 flex-shrink-0">
            <div className="bg-white rounded-xl border border-stone-200 p-4 sticky top-24">
              <h2 className="text-sm font-semibold text-stone-900 mb-4">Review Sections</h2>
              <ul className="space-y-1">
                {sections.map((section) => (
                  <li key={section.id}>
                    <button
                      onClick={() => setActiveSection(section.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        activeSection === section.id
                          ? 'bg-amber-100 text-amber-800'
                          : 'text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      <span className={
                        section.status === 'complete' ? 'text-green-600' :
                        section.status === 'warning' ? 'text-amber-600' : 'text-stone-400'
                      }>
                        {section.icon}
                      </span>
                      <span className="flex-1 text-left">{section.label}</span>
                      {section.status === 'complete' && (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      )}
                      {section.status === 'warning' && (
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          {/* Main Content */}
          <main className="flex-1 min-w-0">
            {/* Overview Section */}
            {activeSection === 'overview' && (
              <div className="bg-white rounded-xl border border-stone-200 p-6">
                <h2 className="text-xl font-semibold text-stone-900 mb-6">Edition Overview</h2>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm text-stone-500">Book Title</label>
                      <p className="font-medium text-stone-900">{book.display_title || book.title}</p>
                    </div>
                    <div>
                      <label className="text-sm text-stone-500">Author</label>
                      <p className="font-medium text-stone-900">{book.author}</p>
                    </div>
                    <div>
                      <label className="text-sm text-stone-500">Original Language</label>
                      <p className="font-medium text-stone-900">{book.language}</p>
                    </div>
                    <div>
                      <label className="text-sm text-stone-500">Original Published</label>
                      <p className="font-medium text-stone-900">{book.published}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="text-sm text-stone-500">Edition Version</label>
                      <p className="font-medium text-stone-900">v{edition.version}</p>
                    </div>
                    <div>
                      <label className="text-sm text-stone-500">Pages Translated</label>
                      <p className="font-medium text-stone-900">{edition.page_count} pages</p>
                    </div>
                    <div>
                      <label className="text-sm text-stone-500">License</label>
                      <p className="font-medium text-stone-900">{edition.license}</p>
                    </div>
                    <div>
                      <label className="text-sm text-stone-500">Content Hash</label>
                      <p className="font-mono text-xs text-stone-600 break-all">{edition.content_hash}</p>
                    </div>
                  </div>
                </div>

                {/* Contributors */}
                <div className="mt-6 pt-6 border-t border-stone-200">
                  <h3 className="text-sm font-semibold text-stone-900 mb-3">Contributors</h3>
                  <div className="flex flex-wrap gap-2">
                    {edition.contributors.map((c, i) => (
                      <span
                        key={i}
                        className={`px-3 py-1 rounded-full text-sm ${
                          c.type === 'ai'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {c.name} ({c.role})
                      </span>
                    ))}
                  </div>
                </div>

                {/* Checklist */}
                <div className="mt-6 pt-6 border-t border-stone-200">
                  <h3 className="text-sm font-semibold text-stone-900 mb-3">Publication Checklist</h3>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2 text-sm">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-stone-700">All pages translated ({edition.page_count} pages)</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      {hasFrontMatter ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                      )}
                      <span className="text-stone-700">Front matter generated</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      {hasDoi ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-stone-300" />
                      )}
                      <span className="text-stone-700">DOI minted</span>
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {/* Introduction Section */}
            {activeSection === 'introduction' && (
              <div className="bg-white rounded-xl border border-stone-200 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-stone-900">Introduction</h2>
                  <div className="flex items-center gap-2">
                    {!hasDoi && (
                      <button
                        onClick={() => setIsEditing(!isEditing)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                        {isEditing ? 'Cancel' : 'Edit'}
                      </button>
                    )}
                    {isEditing && (
                      <button
                        onClick={handleSaveFrontMatter}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-4 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50"
                      >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Changes
                      </button>
                    )}
                  </div>
                </div>

                {edition.front_matter?.introduction ? (
                  isEditing ? (
                    <textarea
                      value={editedIntro}
                      onChange={(e) => setEditedIntro(e.target.value)}
                      className="w-full h-[600px] p-4 border border-stone-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  ) : (
                    <div className="prose prose-stone max-w-none">
                      <ReactMarkdown>{edition.front_matter.introduction}</ReactMarkdown>
                    </div>
                  )
                ) : (
                  <div className="text-center py-12">
                    <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                    <p className="text-stone-600 mb-4">No introduction generated yet.</p>
                    <button
                      onClick={async () => {
                        const res = await fetch(`/api/books/${bookId}/front-matter`, { method: 'POST' });
                        if (res.ok) fetchEditionData();
                      }}
                      className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                    >
                      <RefreshCw className="w-4 h-4 inline mr-2" />
                      Generate Introduction
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Methodology Section */}
            {activeSection === 'methodology' && (
              <div className="bg-white rounded-xl border border-stone-200 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-stone-900">Translation Methodology</h2>
                  <div className="flex items-center gap-2">
                    {!hasDoi && (
                      <button
                        onClick={() => setIsEditing(!isEditing)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                        {isEditing ? 'Cancel' : 'Edit'}
                      </button>
                    )}
                    {isEditing && (
                      <button
                        onClick={handleSaveFrontMatter}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-4 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50"
                      >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Changes
                      </button>
                    )}
                  </div>
                </div>

                {edition.front_matter?.methodology ? (
                  isEditing ? (
                    <textarea
                      value={editedMethodology}
                      onChange={(e) => setEditedMethodology(e.target.value)}
                      className="w-full h-[600px] p-4 border border-stone-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  ) : (
                    <div className="prose prose-stone max-w-none">
                      <ReactMarkdown>{edition.front_matter.methodology}</ReactMarkdown>
                    </div>
                  )
                ) : (
                  <div className="text-center py-12">
                    <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                    <p className="text-stone-600">No methodology section generated yet.</p>
                  </div>
                )}
              </div>
            )}

            {/* Preview Section */}
            {activeSection === 'preview' && (
              <div className="bg-white rounded-xl border border-stone-200 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-stone-900">EPUB Preview</h2>
                  <button
                    onClick={handleDownloadEpub}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download Scholarly EPUB
                  </button>
                </div>

                {/* EPUB Structure Preview */}
                <div className="border border-stone-200 rounded-lg overflow-hidden">
                  <div className="bg-stone-100 px-4 py-2 border-b border-stone-200">
                    <span className="text-sm font-medium text-stone-700">EPUB Contents</span>
                  </div>
                  <div className="p-4 space-y-2">
                    {[
                      { name: 'Title Page', desc: 'Book title, author, edition info, DOI badge' },
                      { name: 'Copyright & License', desc: `${edition.license} license, contributors` },
                      { name: 'Introduction', desc: edition.front_matter?.introduction ? 'Historical context & author biography' : '(Not generated)' },
                      { name: 'Methodology', desc: edition.front_matter?.methodology ? 'OCR & translation process' : '(Not generated)' },
                      { name: `Translation (${edition.page_count} pages)`, desc: 'Facsimile images with English translation' },
                      { name: 'Summary', desc: 'Book summary (if indexed)' },
                      { name: 'Glossary', desc: 'Vocabulary index (if generated)' },
                      { name: 'Index', desc: 'Keywords, people, concepts (if indexed)' },
                      { name: 'Colophon', desc: 'Edition info, citation, content hash' },
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-3 py-2 border-b border-stone-100 last:border-0">
                        <span className="text-stone-400 font-mono text-sm w-6">{i + 1}.</span>
                        <div>
                          <p className="font-medium text-stone-900">{item.name}</p>
                          <p className="text-sm text-stone-500">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <strong>Tip:</strong> Download and open the EPUB in an e-reader app (Apple Books, Calibre)
                    to review the final formatting before minting the DOI.
                  </p>
                </div>
              </div>
            )}

            {/* Approve Section */}
            {activeSection === 'approve' && (
              <div className="bg-white rounded-xl border border-stone-200 p-6">
                <h2 className="text-xl font-semibold text-stone-900 mb-6">
                  {hasDoi ? 'Edition Published' : 'Approve & Mint DOI'}
                </h2>

                {hasDoi ? (
                  <div className="text-center py-8">
                    <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                    <h3 className="text-2xl font-bold text-stone-900 mb-2">DOI Minted Successfully</h3>
                    <p className="text-stone-600 mb-6">
                      This edition is now permanently published and citable.
                    </p>

                    <div className="bg-stone-50 rounded-lg p-6 max-w-md mx-auto text-left">
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm text-stone-500">DOI</label>
                          <p className="font-mono text-stone-900">{edition.doi}</p>
                        </div>
                        <div>
                          <label className="text-sm text-stone-500">DOI URL</label>
                          <a
                            href={edition.doi_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-600 hover:underline flex items-center gap-1"
                          >
                            {edition.doi_url}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <div>
                          <label className="text-sm text-stone-500">Zenodo Record</label>
                          <a
                            href={edition.zenodo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-600 hover:underline flex items-center gap-1"
                          >
                            View on Zenodo
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                      <div className="flex gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-amber-800">Important: This action is permanent</p>
                          <p className="text-sm text-amber-700 mt-1">
                            Once a DOI is minted, the content cannot be changed. Only new versions can be created.
                            Please review all sections carefully before proceeding.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Pre-flight checklist */}
                    <div className="border border-stone-200 rounded-lg p-4 mb-6">
                      <h3 className="font-medium text-stone-900 mb-3">Pre-flight Checklist</h3>
                      <ul className="space-y-2">
                        <li className="flex items-center gap-2 text-sm">
                          <input type="checkbox" className="rounded border-stone-300" id="check1" />
                          <label htmlFor="check1" className="text-stone-700">
                            I have reviewed the Introduction for accuracy
                          </label>
                        </li>
                        <li className="flex items-center gap-2 text-sm">
                          <input type="checkbox" className="rounded border-stone-300" id="check2" />
                          <label htmlFor="check2" className="text-stone-700">
                            I have reviewed the Methodology section
                          </label>
                        </li>
                        <li className="flex items-center gap-2 text-sm">
                          <input type="checkbox" className="rounded border-stone-300" id="check3" />
                          <label htmlFor="check3" className="text-stone-700">
                            I have downloaded and previewed the EPUB
                          </label>
                        </li>
                        <li className="flex items-center gap-2 text-sm">
                          <input type="checkbox" className="rounded border-stone-300" id="check4" />
                          <label htmlFor="check4" className="text-stone-700">
                            All contributor information is correct
                          </label>
                        </li>
                        <li className="flex items-center gap-2 text-sm">
                          <input type="checkbox" className="rounded border-stone-300" id="check5" />
                          <label htmlFor="check5" className="text-stone-700">
                            The license ({edition.license}) is appropriate
                          </label>
                        </li>
                      </ul>
                    </div>

                    {mintError && (
                      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
                        {mintError}
                      </div>
                    )}

                    <div className="flex justify-center">
                      <button
                        onClick={handleMintDoi}
                        disabled={isMinting}
                        className="flex items-center gap-3 px-8 py-4 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 text-lg font-medium"
                      >
                        {isMinting ? (
                          <>
                            <Loader2 className="w-6 h-6 animate-spin" />
                            Minting DOI...
                          </>
                        ) : (
                          <>
                            <Award className="w-6 h-6" />
                            Approve & Mint DOI
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
