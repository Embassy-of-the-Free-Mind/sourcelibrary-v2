'use client';

import { useState } from 'react';
import { BookMarked, X, Plus, Trash2, ExternalLink } from 'lucide-react';
import { TranslationEdition, Contributor } from '@/lib/types';

interface PublishEditionButtonProps {
  bookId: string;
  bookTitle: string;
  translatedCount: number;
  totalPages: number;
  currentEdition?: TranslationEdition;
  onPublished?: (edition: TranslationEdition) => void;
}

const LICENSES = [
  { id: 'CC0-1.0', name: 'CC0 1.0 (Public Domain)', description: 'No rights reserved' },
  { id: 'CC-BY-4.0', name: 'CC BY 4.0', description: 'Attribution required' },
  { id: 'CC-BY-SA-4.0', name: 'CC BY-SA 4.0', description: 'Attribution + ShareAlike' },
  { id: 'CC-BY-NC-4.0', name: 'CC BY-NC 4.0', description: 'Attribution + NonCommercial' },
  { id: 'CC-BY-NC-SA-4.0', name: 'CC BY-NC-SA 4.0', description: 'Attribution + NC + ShareAlike' },
];

const CONTRIBUTOR_ROLES = [
  { id: 'translator', name: 'Translator' },
  { id: 'editor', name: 'Editor' },
  { id: 'reviewer', name: 'Reviewer' },
  { id: 'transcriber', name: 'Transcriber' },
];

export default function PublishEditionButton({
  bookId,
  bookTitle,
  translatedCount,
  totalPages,
  currentEdition,
  onPublished,
}: PublishEditionButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [versionLabel, setVersionLabel] = useState('');
  const [license, setLicense] = useState('CC-BY-4.0');
  const [changelog, setChangelog] = useState('');
  const [contributors, setContributors] = useState<Contributor[]>([]);

  // New contributor form
  const [newContributor, setNewContributor] = useState({
    name: '',
    role: 'editor' as Contributor['role'],
    orcid: '',
    affiliation: '',
  });

  const addContributor = () => {
    if (!newContributor.name.trim()) return;

    setContributors([
      ...contributors,
      {
        name: newContributor.name.trim(),
        role: newContributor.role,
        type: 'human',
        orcid: newContributor.orcid.trim() || undefined,
        affiliation: newContributor.affiliation.trim() || undefined,
      },
    ]);
    setNewContributor({ name: '', role: 'editor', orcid: '', affiliation: '' });
  };

  const removeContributor = (index: number) => {
    setContributors(contributors.filter((_, i) => i !== index));
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    setError(null);

    try {
      const response = await fetch(`/api/books/${bookId}/editions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version_label: versionLabel.trim() || undefined,
          license,
          contributors,
          changelog: changelog.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to publish edition');
      }

      onPublished?.(data.edition);
      setIsOpen(false);

      // Reset form
      setVersionLabel('');
      setChangelog('');
      setContributors([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish edition');
    } finally {
      setIsPublishing(false);
    }
  };

  const translationPercent = Math.round((translatedCount / totalPages) * 100);
  const isComplete = translatedCount === totalPages;

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg text-sm transition-colors"
        title="Publish a citable edition"
      >
        <BookMarked className="w-4 h-4" />
        Publish
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-stone-900">Publish Edition</h2>
                <p className="text-sm text-stone-500 mt-1">
                  Create a citable, versioned snapshot of the translation
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-stone-500" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Status */}
              <div className="bg-stone-50 rounded-lg p-4">
                <h3 className="font-medium text-stone-900 mb-2">{bookTitle}</h3>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${isComplete ? 'bg-green-500' : 'bg-amber-500'}`} />
                    <span className="text-stone-600">
                      {translatedCount} of {totalPages} pages translated ({translationPercent}%)
                    </span>
                  </div>
                </div>
                {currentEdition && (
                  <div className="mt-2 text-sm text-stone-500">
                    Current edition: v{currentEdition.version}
                    {currentEdition.doi && (
                      <a
                        href={currentEdition.doi_url || `https://doi.org/${currentEdition.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-amber-600 hover:text-amber-700 inline-flex items-center gap-1"
                      >
                        {currentEdition.doi}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Version Label */}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">
                  Version Label (optional)
                </label>
                <input
                  type="text"
                  value={versionLabel}
                  onChange={(e) => setVersionLabel(e.target.value)}
                  placeholder="e.g., First Edition, Revised, Complete"
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <p className="text-xs text-stone-500 mt-1">
                  Version number is assigned automatically (semver)
                </p>
              </div>

              {/* License */}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">
                  License <span className="text-red-500">*</span>
                </label>
                <select
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {LICENSES.map((lic) => (
                    <option key={lic.id} value={lic.id}>
                      {lic.name} — {lic.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Contributors */}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">
                  Human Contributors
                </label>
                <p className="text-xs text-stone-500 mb-3">
                  AI contributors are added automatically based on models used
                </p>

                {/* Existing contributors */}
                {contributors.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {contributors.map((c, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between bg-stone-50 rounded-lg px-3 py-2"
                      >
                        <div>
                          <span className="font-medium text-stone-900">{c.name}</span>
                          <span className="text-stone-500 text-sm ml-2">({c.role})</span>
                          {c.orcid && (
                            <a
                              href={`https://orcid.org/${c.orcid}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-amber-600 ml-2"
                            >
                              ORCID
                            </a>
                          )}
                        </div>
                        <button
                          onClick={() => removeContributor(i)}
                          className="p-1 hover:bg-stone-200 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4 text-stone-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add contributor form */}
                <div className="border border-stone-200 rounded-lg p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={newContributor.name}
                      onChange={(e) => setNewContributor({ ...newContributor, name: e.target.value })}
                      placeholder="Name"
                      className="px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <select
                      value={newContributor.role}
                      onChange={(e) =>
                        setNewContributor({
                          ...newContributor,
                          role: e.target.value as Contributor['role'],
                        })
                      }
                      className="px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      {CONTRIBUTOR_ROLES.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={newContributor.orcid}
                      onChange={(e) => setNewContributor({ ...newContributor, orcid: e.target.value })}
                      placeholder="ORCID (optional)"
                      className="px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <input
                      type="text"
                      value={newContributor.affiliation}
                      onChange={(e) =>
                        setNewContributor({ ...newContributor, affiliation: e.target.value })
                      }
                      placeholder="Affiliation (optional)"
                      className="px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <button
                    onClick={addContributor}
                    disabled={!newContributor.name.trim()}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" />
                    Add Contributor
                  </button>
                </div>
              </div>

              {/* Changelog */}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">
                  Changelog / Release Notes (optional)
                </label>
                <textarea
                  value={changelog}
                  onChange={(e) => setChangelog(e.target.value)}
                  rows={3}
                  placeholder="What's changed since the last version?"
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                />
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              {/* Info */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                <p className="font-medium mb-1">What happens when you publish:</p>
                <ul className="list-disc list-inside space-y-1 text-blue-700">
                  <li>A snapshot of all translated pages is saved</li>
                  <li>A content hash is generated for verification</li>
                  <li>Previous editions are marked as superseded</li>
                  <li>You can later add a DOI for formal citation</li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-white border-t border-stone-200 px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={isPublishing || translatedCount === 0}
                className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isPublishing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <BookMarked className="w-4 h-4" />
                    Publish Edition
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
