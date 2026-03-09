'use client';

import { useState } from 'react';

interface MetadataFormProps {
  initialMetadata: {
    title: string | null;
    author: string | null;
    language: string | null;
    year: number | null;
    ocr_text?: string;
  };
  titlePagePreview: string;
  onConfirm: (metadata: { title: string; author: string; language: string; year: string }) => void;
  onRetake: () => void;
  isCreating?: boolean;
}

export default function MetadataForm({
  initialMetadata,
  titlePagePreview,
  onConfirm,
  onRetake,
  isCreating = false,
}: MetadataFormProps) {
  const [title, setTitle] = useState(initialMetadata.title || '');
  const [author, setAuthor] = useState(initialMetadata.author || '');
  const [language, setLanguage] = useState(initialMetadata.language || '');
  const [year, setYear] = useState(initialMetadata.year?.toString() || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onConfirm({
      title: title.trim(),
      author: author.trim() || 'Unknown',
      language: language.trim() || 'Unknown',
      year: year.trim() || 'Unknown',
    });
  };

  return (
    <div className="space-y-5 max-w-md mx-auto">
      <h1 className="font-serif text-xl text-primary">Confirm Book Details</h1>

      {titlePagePreview && (
        <div className="rounded-lg overflow-hidden border border-border-light">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={titlePagePreview}
            alt="Title page preview"
            className="w-full max-h-64 object-contain bg-warm"
          />
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Title" value={title} onChange={setTitle} required />
        <Field label="Author" value={author} onChange={setAuthor} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Language" value={language} onChange={setLanguage} />
          <Field label="Year" value={year} onChange={setYear} />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onRetake}
            disabled={isCreating}
            className="flex-1 py-3 border border-border-medium rounded-lg text-secondary text-sm font-medium disabled:opacity-50"
          >
            Retake
          </button>
          <button
            type="submit"
            disabled={!title.trim() || isCreating}
            className="flex-1 py-3 bg-accent-rust text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {isCreating ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating...
              </span>
            ) : (
              'Start Scanning'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, required }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        className="w-full px-3 py-2.5 border border-border-medium rounded-lg text-primary bg-white text-sm focus:outline-none focus:border-accent-rust/40"
      />
    </div>
  );
}
