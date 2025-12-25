'use client';

import { useState } from 'react';
import { TranslationEdition } from '@/lib/types';
import { BookMarked, ChevronDown, ChevronUp, ExternalLink, Copy, Check, Calendar, FileText, Users, Hash, Sparkles, Loader2, Eye } from 'lucide-react';
import Link from 'next/link';

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

  const currentEdition = editions.find(e => e.status === 'published');
  const previousEditions = editions.filter(e => e.status === 'superseded');

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const generateCitation = (edition: TranslationEdition) => {
    const year = edition.published_at ? new Date(edition.published_at).getFullYear() : new Date().getFullYear();
    const doi = edition.doi ? ` https://doi.org/${edition.doi}` : '';
    return `Source Library. (${year}). ${edition.citation.title} (Version ${edition.version}).${doi}`;
  };

  const generateBibtex = (edition: TranslationEdition) => {
    const year = edition.published_at ? new Date(edition.published_at).getFullYear() : new Date().getFullYear();
    const aiContributors = edition.contributors.filter(c => c.type === 'ai').map(c => c.name).join(' and ');
    const humanContributors = edition.contributors.filter(c => c.type === 'human').map(c => c.name).join(' and ');
    const author = ['{Source Library}', aiContributors, humanContributors].filter(Boolean).join(' and ');

    return `@misc{sourcelibrary_${year}_${edition.id.slice(0, 8)},
  author       = {${author}},
  title        = {${edition.citation.title}},
  year         = ${year},
  version      = {${edition.version}},${edition.doi ? `
  doi          = {${edition.doi}},
  url          = {https://doi.org/${edition.doi}}` : ''}
}`;
  };

  const handleMintDoi = async (editionId: string) => {
    setIsMintingDoi(true);
    setMintError(null);

    try {
      const response = await fetch(`/api/books/${bookId}/editions/mint-doi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edition_id: editionId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to mint DOI');
      }

      // Update local state
      setEditions(prev => prev.map(e =>
        e.id === editionId
          ? { ...e, doi: data.doi, doi_url: data.doi_url, zenodo_id: data.zenodo_id, zenodo_url: data.zenodo_url }
          : e
      ));
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
      const response = await fetch(`/api/books/${bookId}/editions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edition_id: editionId,
          doi,
          doi_url: `https://doi.org/${doi}`,
        }),
      });

      if (response.ok) {
        setEditions(prev => prev.map(e =>
          e.id === editionId ? { ...e, doi, doi_url: `https://doi.org/${doi}` } : e
        ));
        onDoiAdded?.(editionId, doi);
        setAddingDoiFor(null);
        setDoiInput('');
      }
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
          <BookMarked className="w-5 h-5 text-amber-600" />
          <div className="text-left">
            <h3 className="font-semibold text-stone-900">Published Editions</h3>
            <p className="text-sm text-stone-500">
              {currentEdition ? (
                <>
                  Current: v{currentEdition.version}
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
                <div className="w-2 h-2 rounded-full bg-green-500" />
                Current Edition
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
                        className="flex items-center gap-1 px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-sm hover:bg-amber-200 transition-colors"
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
                        className="px-3 py-1 text-sm border border-stone-300 rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <button
                        onClick={() => handleSaveDoi(currentEdition.id)}
                        disabled={isSavingDoi}
                        className="px-3 py-1 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600 disabled:opacity-50"
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
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-sm font-medium hover:from-amber-600 hover:to-orange-600 transition-all shadow-sm"
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
                      {copiedId === 'citation' ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                      Copy Citation
                    </button>
                    <button
                      onClick={() => copyToClipboard(generateBibtex(currentEdition), 'bibtex')}
                      className="flex items-center gap-1 px-3 py-1 text-xs text-stone-600 hover:bg-stone-100 rounded transition-colors"
                    >
                      {copiedId === 'bibtex' ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
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
                        className="text-amber-600 hover:text-amber-700 flex items-center gap-1"
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
