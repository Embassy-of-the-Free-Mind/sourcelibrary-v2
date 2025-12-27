'use client';

import { useState } from 'react';
import { X, FileText, Languages, Clock, User, Cpu, Tag, BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { Page } from '@/lib/types';

interface PageMetadataPanelProps {
  page: Page;
  onClose: () => void;
}

// Extract metadata tags from text (supports both XML and bracket syntax)
function extractMetadataFromText(text: string): {
  language?: string;
  pageNumber?: string;
  folio?: string;
  vocabulary: string[];
  keywords: string[];
  summary?: string;
  meta: string[];
  warning?: string;
} {
  const result = {
    vocabulary: [] as string[],
    keywords: [] as string[],
    meta: [] as string[],
  } as ReturnType<typeof extractMetadataFromText>;

  if (!text) return result;

  // XML syntax
  const langMatch = text.match(/<lang>([\s\S]*?)<\/lang>/i);
  if (langMatch) result.language = langMatch[1].trim();

  const pageNumMatch = text.match(/<page-num>([\s\S]*?)<\/page-num>/i);
  if (pageNumMatch) result.pageNumber = pageNumMatch[1].trim();

  const folioMatch = text.match(/<folio>([\s\S]*?)<\/folio>/i);
  if (folioMatch) result.folio = folioMatch[1].trim();

  const warningMatch = text.match(/<warning>([\s\S]*?)<\/warning>/i);
  if (warningMatch) result.warning = warningMatch[1].trim();

  const summaryMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryMatch) result.summary = summaryMatch[1].trim();

  // Extract vocab
  const vocabMatches = text.matchAll(/<vocab>([\s\S]*?)<\/vocab>/gi);
  for (const match of vocabMatches) {
    const terms = match[1].split(',').map(t => t.trim()).filter(Boolean);
    result.vocabulary.push(...terms);
  }

  // Extract keywords
  const keywordMatches = text.matchAll(/<keywords>([\s\S]*?)<\/keywords>/gi);
  for (const match of keywordMatches) {
    const terms = match[1].split(',').map(t => t.trim()).filter(Boolean);
    result.keywords.push(...terms);
  }

  // Extract meta notes
  const metaMatches = text.matchAll(/<meta>([\s\S]*?)<\/meta>/gi);
  for (const match of metaMatches) {
    result.meta.push(match[1].trim());
  }

  // Fallback to bracket syntax
  if (!result.language) {
    const bracketLang = text.match(/\[\[language:\s*([\s\S]*?)\]\]/i);
    if (bracketLang) result.language = bracketLang[1].trim();
  }

  if (!result.pageNumber) {
    const bracketPage = text.match(/\[\[page\s*number:\s*([\s\S]*?)\]\]/i);
    if (bracketPage) result.pageNumber = bracketPage[1].trim();
  }

  if (!result.summary) {
    const bracketSummary = text.match(/\[\[summary:\s*([\s\S]*?)\]\]/i);
    if (bracketSummary) result.summary = bracketSummary[1].trim();
  }

  if (result.vocabulary.length === 0) {
    const bracketVocab = text.matchAll(/\[\[vocabulary:\s*(.*?)\]\]/gi);
    for (const match of bracketVocab) {
      const terms = match[1].split(',').map(t => t.trim()).filter(Boolean);
      result.vocabulary.push(...terms);
    }
  }

  if (result.keywords.length === 0) {
    const bracketKeywords = text.matchAll(/\[\[keywords:\s*(.*?)\]\]/gi);
    for (const match of bracketKeywords) {
      const terms = match[1].split(',').map(t => t.trim()).filter(Boolean);
      result.keywords.push(...terms);
    }
  }

  return result;
}

function formatDate(date: Date | string | undefined): string {
  if (!date) return 'Unknown';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function MetadataSection({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-stone-200 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-stone-50 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-stone-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-stone-400" />
        )}
        <Icon className="w-4 h-4 text-stone-500" />
        <span className="font-medium text-stone-700">{title}</span>
      </button>
      {isOpen && <div className="px-4 pb-4 space-y-2">{children}</div>}
    </div>
  );
}

function MetadataRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="text-stone-500 min-w-[100px] shrink-0">{label}:</span>
      <span className={`text-stone-800 ${mono ? 'font-mono text-xs' : ''}`}>
        {value || <span className="text-stone-400 italic">Not available</span>}
      </span>
    </div>
  );
}

function TagList({ tags, color = 'stone' }: { tags: string[]; color?: 'stone' | 'amber' | 'purple' }) {
  if (tags.length === 0) return <span className="text-stone-400 italic text-sm">None</span>;

  const colorClasses = {
    stone: 'bg-stone-100 text-stone-700',
    amber: 'bg-amber-100 text-amber-800',
    purple: 'bg-purple-100 text-purple-800',
  };

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag, i) => (
        <span
          key={i}
          className={`px-2 py-0.5 rounded-full text-xs ${colorClasses[color]}`}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

export default function PageMetadataPanel({ page, onClose }: PageMetadataPanelProps) {
  const ocrMeta = extractMetadataFromText(page.ocr?.data || '');
  const translationMeta = extractMetadataFromText(page.translation?.data || '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-stone-50">
          <h2 className="font-semibold text-stone-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-stone-500" />
            Page {page.page_number} Metadata
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-stone-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1">
          {/* Warning if present */}
          {ocrMeta.warning && (
            <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              <strong>Quality Warning:</strong> {ocrMeta.warning}
            </div>
          )}

          {/* Summary if present */}
          {translationMeta.summary && (
            <div className="mx-4 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
              <strong>Summary:</strong> {translationMeta.summary}
            </div>
          )}

          {/* OCR Section */}
          <MetadataSection title="OCR Data" icon={BookOpen}>
            <MetadataRow
              label="Language"
              value={ocrMeta.language || page.ocr?.language}
            />
            <MetadataRow
              label="Model"
              value={page.ocr?.model}
              mono
            />
            <MetadataRow
              label="Source"
              value={
                page.ocr?.source === 'manual' ? (
                  <span className="text-amber-600">Manual edit</span>
                ) : (
                  <span className="text-green-600">AI generated</span>
                )
              }
            />
            <MetadataRow
              label="Updated"
              value={formatDate(page.ocr?.updated_at)}
            />
            {page.ocr?.edited_by && (
              <MetadataRow
                label="Edited by"
                value={page.ocr.edited_by}
              />
            )}
            {ocrMeta.pageNumber && (
              <MetadataRow
                label="Page #"
                value={ocrMeta.pageNumber}
              />
            )}
            {ocrMeta.folio && (
              <MetadataRow
                label="Folio"
                value={ocrMeta.folio}
              />
            )}
            {ocrMeta.meta.length > 0 && (
              <div className="mt-2">
                <span className="text-sm text-stone-500">Notes:</span>
                <ul className="mt-1 text-sm text-stone-700 list-disc list-inside">
                  {ocrMeta.meta.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            {ocrMeta.vocabulary.length > 0 && (
              <div className="mt-2">
                <span className="text-sm text-stone-500 block mb-1">Vocabulary:</span>
                <TagList tags={ocrMeta.vocabulary} color="purple" />
              </div>
            )}
          </MetadataSection>

          {/* Translation Section */}
          <MetadataSection title="Translation Data" icon={Languages}>
            <MetadataRow
              label="Language"
              value={page.translation?.language}
            />
            <MetadataRow
              label="Model"
              value={page.translation?.model}
              mono
            />
            <MetadataRow
              label="Source"
              value={
                page.translation?.source === 'manual' ? (
                  <span className="text-amber-600">Manual edit</span>
                ) : (
                  <span className="text-green-600">AI generated</span>
                )
              }
            />
            <MetadataRow
              label="Updated"
              value={formatDate(page.translation?.updated_at)}
            />
            {page.translation?.edited_by && (
              <MetadataRow
                label="Edited by"
                value={page.translation.edited_by}
              />
            )}
            {translationMeta.keywords.length > 0 && (
              <div className="mt-2">
                <span className="text-sm text-stone-500 block mb-1">Keywords:</span>
                <TagList tags={translationMeta.keywords} color="amber" />
              </div>
            )}
          </MetadataSection>

          {/* Page Info Section */}
          <MetadataSection title="Page Info" icon={FileText} defaultOpen={false}>
            <MetadataRow label="Page ID" value={page.id} mono />
            <MetadataRow label="Book ID" value={page.book_id} mono />
            <MetadataRow
              label="Created"
              value={formatDate(page.created_at)}
            />
            <MetadataRow
              label="Updated"
              value={formatDate(page.updated_at)}
            />
            {page.read_count !== undefined && (
              <MetadataRow label="Read count" value={page.read_count} />
            )}
            {page.edit_count !== undefined && (
              <MetadataRow label="Edit count" value={page.edit_count} />
            )}
          </MetadataSection>

          {/* Processing Info Section */}
          <MetadataSection title="Processing Details" icon={Cpu} defaultOpen={false}>
            <MetadataRow
              label="OCR prompt"
              value={page.ocr?.prompt_name || 'default'}
            />
            <MetadataRow
              label="Translation prompt"
              value={page.translation?.prompt_name || 'default'}
            />
            {page.summary && (
              <>
                <MetadataRow
                  label="Summary model"
                  value={page.summary.model}
                  mono
                />
                <MetadataRow
                  label="Summary updated"
                  value={formatDate(page.summary.updated_at)}
                />
              </>
            )}
            {page.modernized && (
              <>
                <MetadataRow
                  label="Modernized model"
                  value={page.modernized.model}
                  mono
                />
                <MetadataRow
                  label="Modernized updated"
                  value={formatDate(page.modernized.updated_at)}
                />
              </>
            )}
          </MetadataSection>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-stone-200 bg-stone-50 text-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
