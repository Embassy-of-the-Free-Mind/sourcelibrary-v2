'use client';

import { useState } from 'react';
import { TranslationEdition } from '@/lib/types';
import { BookMarked, ChevronDown, ChevronUp, ExternalLink, Copy, Check, Calendar, FileText, Users, Hash, Sparkles, Loader2, Eye } from 'lucide-react';
import Link from 'next/link';
import { books } from '@/lib/api-client';

interface EditionsPanelProps {
  bookId: string;
  editions: TranslationEdition[];
  onDoiAdded?: (editionId: string, doi: string) => void;
}

export default function EditionsPanel({ bookId, editions: initialEditions, onDoiAdded }: EditionsPanelProps) {
  const [editions, setEditions] = useState(initialEditions);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [addingDoiFor, setAddingDoiFor] = useState<string | null>(null);
  const [doiInput, setDoiInput] = useState('');
  const [isSavingDoi, setIsSavingDoi] = useState(false);
  const [isMintingDoi, setIsMintingDoi] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  if (!editions || editions.length === 0) {
    return null;
  }

  const currentEdition = editions.find(e => e.status === 'published') || editions.find(e => e.status === 'draft');
  const previousEditions = editions.filter(e => e.status === 'superseded');

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const generateCitation = (edition: TranslationEdition, pageNumber?: number) => {
    const year = edition.published_at ? new Date(edition.published_at).getFullYear() : new Date().getFullYear();
    const doi = edition.doi ? ` https://doi.org/${edition.doi}` : '';
    const page = pageNumber ? `, p. ${pageNumber}` : '';
    const author = edition.citation.original_author || 'Anonymous';
    // Scholarly convention: original author first, translator credited
    return `${author}. ${edition.citation.original_title}, trans. Source Library (${year}), v${edition.version}${page}.${doi}`;
  };

  const generateBibtex = (edition: TranslationEdition) => {
    const year = edition.published_at ? new Date(edition.published_at).getFullYear() : new Date().getFullYear();
    const author = edition.citation.original_author || 'Anonymous';

    // `language` is the language we translated FROM, which on a translated
    // edition is not the language of the work. BibTeX has no field for the chain,
    // so when the two differ the note states it — otherwise a citation for our
    // English←French←Arabic Muqaddimah reads as though the work were French.
    // Absent on editions minted before #3959; those keep reading as minted.
    const work = edition.citation.work_language;
    const source = edition.citation.original_language;
    const note = work && source
      ? `AI-assisted translation from ${source}; the work was written in ${work}`
      : 'AI-assisted translation';

    return `@book{sourcelibrary_${year}_${edition.id.slice(0, 8)},
  author       = {${author}},
  title        = {${edition.citation.original_title}},
  translator   = {{Source Library}},
  year         = ${year},
  publisher    = {Source Library},
  edition      = {${edition.version}},
  note         = {${note}},${edition.doi ? `
  doi          = {${edition.doi}},
  url          = {https://doi.org/${edition.doi}},` : ''}
  language     = {${source || 'unknown'}}${work ? `,
  origlanguage = {${work}}` : ''}
}`;
  };

  const handleMintDoi = async (editionId: string) => {
    setIsMintingDoi(true);
    setMintError(null);

    try {
      const data = await books.editions.mintDoi(bookId, editionId);

      // Update local state — DOI minting publishes the edition
      setEditions(prev => prev.map(e => {
        if (e.id === editionId) {
          return { ...e, status: 'published' as const, published_at: new Date(), doi: data.doi, doi_url: data.doi_url, zenodo_id: data.zenodo_id, zenodo_url: data.zenodo_url };
        }
        // Supersede previously published editions
        if (e.status === 'published') {
          return { ...e, status: 'superseded' as const };
        }
        return e;
      }));
      onDoiAdded?.(editionId, data.doi);
    } catch (error) {
      setMintError(error instanceof Error ? error.message : 'Failed to mint DOI');
    } finally {
      setIsMintingDoi(false);
    }
  };

  const handleSaveDoi = async (editionId: string) => {
    if (!doiInput.trim()) return;

    setIsSavingDoi(true);
    try {
      const doi = doiInput.trim().replace(/^https?:\/\/doi\.org\//, '');
      const data = await books.editions.updateFields(bookId, editionId, {
        doi,
        doi_url: `https://doi.org/${doi}`,
      });

      setEditions(prev => prev.map(e =>
        e.id === editionId ? { ...e, doi, doi_url: `https://doi.org/${doi}` } : e
      ));
      onDoiAdded?.(editionId, doi);
      setAddingDoiFor(null);
      setDoiInput('');
    } catch (error) {
      console.error('Error saving DOI:', error);
    } finally {
      setIsSavingDoi(false);
    }
  };

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return 'Unknown';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="bg-white rounded-lg border border-stone-200">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-stone-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <BookMarked className="w-5 h-5 text-accent-rust" />
          <div className="text-left">
            <h3 className="font-semibold text-stone-900">Published Editions</h3>
            <p className="text-sm text-stone-500">
              {currentEdition ? (
                <>
                  {currentEdition.status === 'draft' ? 'Draft' : 'Current'}: v{currentEdition.version}
                  {currentEdition.doi && ` • DOI: ${currentEdition.doi}`}
                </>
              ) : (
                'No published editions'
              )}
            </p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-stone-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-stone-400" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-stone-200 p-6 space-y-6">
          {/* Current Edition */}
          {currentEdition && (
            <div className="space-y-4">
              <h4 className="font-medium text-stone-900 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${currentEdition.status === 'draft' ? 'bg-amber-400' : 'bg-status-success'}`} />
                {currentEdition.status === 'draft' ? 'Draft Edition' : 'Current Edition'}
              </h4>

              <div className="bg-stone-50 rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium text-stone-900">
                      Version {currentEdition.version}
                      {currentEdition.version_label && (
                        <span className="text-stone-500 font-normal ml-2">
                          ({currentEdition.version_label})
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-stone-500 mt-1">
                      {currentEdition.citation.title}
                    </div>
                  </div>
                  {currentEdition.doi ? (
                    <div className="flex items-center gap-2">
                      <a
                        href={currentEdition.doi_url || `https://doi.org/${currentEdition.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-3 py-1 bg-accent-gold/15 text-accent-gold-dark rounded-full text-sm hover:bg-accent-gold/25 transition-colors"
                      >
                        DOI: {currentEdition.doi}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      {currentEdition.zenodo_url && (
                        <a
                          href={currentEdition.zenodo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-stone-500 hover:text-stone-700"
                        >
                          Zenodo
                        </a>
                      )}
                    </div>
                  ) : addingDoiFor === currentEdition.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={doiInput}
                        onChange={(e) => setDoiInput(e.target.value)}
                        placeholder="10.5281/zenodo.12345"
                        className="px-3 py-1 text-sm border border-stone-300 rounded-lg w-48 focus:outline-none focus:ring-2 focus-visible:ring-accent-rust"
                      />
                      <button
                        onClick={() => handleSaveDoi(currentEdition.id)}
                        disabled={isSavingDoi}
                        className="px-3 py-1 bg-accent-gold/80 text-white rounded-lg text-sm hover:bg-accent-rust disabled:opacity-50"
                      >
                        {isSavingDoi ? '...' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setAddingDoiFor(null); setDoiInput(''); }}
                        className="px-2 py-1 text-stone-500 hover:text-stone-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/book/${bookId}/edition/${currentEdition.id}/review`}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-accent-gold to-accent-rust/80 text-white rounded-lg text-sm font-medium hover:from-accent-rust hover:to-accent-rust/90 transition-all shadow-sm"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Review & Publish
                      </Link>
                      <button
                        onClick={() => setAddingDoiFor(currentEdition.id)}
                        className="px-2 py-1 text-xs text-stone-500 hover:text-stone-700"
                      >
                        or enter DOI
                      </button>
                    </div>
                  )}
                </div>

                {/* Mint error */}
                {mintError && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    {mintError}
                  </div>
                )}

                {/* Metadata grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm pt-2">
                  <div className="flex items-center gap-2 text-stone-600">
                    <Calendar className="w-4 h-4 text-stone-400" />
                    {formatDate(currentEdition.published_at)}
                  </div>
                  <div className="flex items-center gap-2 text-stone-600">
                    <FileText className="w-4 h-4 text-stone-400" />
                    {currentEdition.page_count} pages
                  </div>
                  <div className="flex items-center gap-2 text-stone-600">
                    <Users className="w-4 h-4 text-stone-400" />
                    {currentEdition.contributors.length} contributors
                  </div>
                  <div className="flex items-center gap-2 text-stone-600">
                    <Hash className="w-4 h-4 text-stone-400" />
                    {currentEdition.license}
                  </div>
                </div>

                {/* Contributors */}
                {currentEdition.contributors.length > 0 && (
                  <div className="pt-2">
                    <div className="text-xs text-stone-500 uppercase tracking-wide mb-1">Contributors</div>
                    <div className="flex flex-wrap gap-2">
                      {currentEdition.contributors.map((c, i) => (
                        <span
                          key={i}
                          className={`px-2 py-1 text-xs rounded-full ${
                            c.type === 'ai'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {c.name}
                          <span className="opacity-70 ml-1">({c.role})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Citation */}
                <div className="pt-2 border-t border-stone-200 mt-3">
                  <div className="text-xs text-stone-500 uppercase tracking-wide mb-2">Cite this translation</div>
                  <div className="bg-white rounded border border-stone-200 p-3 text-sm text-stone-700 font-mono">
                    {generateCitation(currentEdition)}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => copyToClipboard(generateCitation(currentEdition), 'citation')}
                      className="flex items-center gap-1 px-3 py-1 text-xs text-stone-600 hover:bg-stone-100 rounded transition-colors"
                    >
                      {copiedId === 'citation' ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
                      Copy Citation
                    </button>
                    <button
                      onClick={() => copyToClipboard(generateBibtex(currentEdition), 'bibtex')}
                      className="flex items-center gap-1 px-3 py-1 text-xs text-stone-600 hover:bg-stone-100 rounded transition-colors"
                    >
                      {copiedId === 'bibtex' ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
                      Copy BibTeX
                    </button>
                  </div>
                </div>

                {/* Changelog */}
                {currentEdition.changelog && (
                  <div className="pt-2">
                    <div className="text-xs text-stone-500 uppercase tracking-wide mb-1">Changelog</div>
                    <p className="text-sm text-stone-600">{currentEdition.changelog}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Previous Editions */}
          {previousEditions.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium text-stone-700">Previous Editions</h4>
              {previousEditions.map((edition) => (
                <div
                  key={edition.id}
                  className="border border-stone-200 rounded-lg p-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-stone-700">v{edition.version}</span>
                      {edition.version_label && (
                        <span className="text-stone-500 ml-2">({edition.version_label})</span>
                      )}
                      <span className="text-stone-400 ml-2">• {formatDate(edition.published_at)}</span>
                    </div>
                    {edition.doi && (
                      <a
                        href={edition.doi_url || `https://doi.org/${edition.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-rust hover:text-accent-rust flex items-center gap-1"
                      >
                        {edition.doi}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <div className="text-stone-500 mt-1">
                    {edition.page_count} pages • {edition.license}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Hash info */}
          {currentEdition && (
            <div className="text-xs text-stone-400 pt-2 border-t border-stone-100">
              Content hash: {currentEdition.content_hash.slice(0, 16)}...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
