'use client';

import { useState, useEffect } from 'react';
import { X, Save, Loader2 } from 'lucide-react';

/**
 * BphCatalogueEditModal — cataloguer panel for Supabase `bph_works`.
 *
 * Mirrors BookEditModal in shape (modal overlay, save/cancel) but writes to
 * a different store (`bph_works` via /api/catalog/bph/[ubn]/edit) and exposes
 * the BPH-rich field set Paul Dijstelberge asked for in issue #1921 P2.
 *
 * Atlas `books` is NOT touched here — see the API route doc-comment. Sync
 * back to the digitised book document is out of scope for v1.
 *
 * Repeatable fields in BPH (e.g. variant_author) live as single text columns
 * in `bph_works`; the UI uses textareas and the convention "one per line".
 * Reshaping the table into sub-records is a follow-up (out of scope per
 * #1921 plan).
 */

export interface BphWorkEditable {
  ubn: string;
  // Bibliographic identity
  title?: string | null;
  parallel_title?: string | null;
  uniform_title?: string | null;
  author?: string | null;
  variant_author?: string | null;
  pseudonym?: string | null;
  editor?: string | null;
  variant_editor?: string | null;
  // Impressum
  place?: string | null;
  printer?: string | null;
  publisher?: string | null;
  variant_printer?: string | null;
  variant_publisher?: string | null;
  year?: number | null;
  // Physical
  bibliographic_format?: string | null;
  binding?: string | null;
  bound_with?: string | null;
  shelf_mark?: string | null;
  state_shelf_mark?: string | null;
  present_location?: string | null;
  object_size_cm?: string | null;
  number_of_copies?: number | null;
  // Content
  keywords?: string | null;
  language?: string | null;
  series_title?: string | null;
  volume_title?: string | null;
  bibliography?: string | null;
  remarks?: string | null;
  provenance?: string | null;
}

interface BphCatalogueEditModalProps {
  work: BphWorkEditable;
  onClose: () => void;
  onSave?: () => void;
}

export default function BphCatalogueEditModal({ work, onClose, onSave }: BphCatalogueEditModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedSummary, setSavedSummary] = useState<string | null>(null);

  // Form fields — initialise from the loaded row, treating null as empty so
  // the input is always controlled.
  const [title, setTitle] = useState(work.title ?? '');
  const [parallelTitle, setParallelTitle] = useState(work.parallel_title ?? '');
  const [uniformTitle, setUniformTitle] = useState(work.uniform_title ?? '');
  const [author, setAuthor] = useState(work.author ?? '');
  const [variantAuthor, setVariantAuthor] = useState(work.variant_author ?? '');
  const [pseudonym, setPseudonym] = useState(work.pseudonym ?? '');
  const [editor, setEditor] = useState(work.editor ?? '');
  const [variantEditor, setVariantEditor] = useState(work.variant_editor ?? '');

  const [place, setPlace] = useState(work.place ?? '');
  const [printer, setPrinter] = useState(work.printer ?? '');
  const [publisher, setPublisher] = useState(work.publisher ?? '');
  const [variantPrinter, setVariantPrinter] = useState(work.variant_printer ?? '');
  const [variantPublisher, setVariantPublisher] = useState(work.variant_publisher ?? '');
  const [year, setYear] = useState(work.year != null ? String(work.year) : '');

  const [bibliographicFormat, setBibliographicFormat] = useState(work.bibliographic_format ?? '');
  const [binding, setBinding] = useState(work.binding ?? '');
  const [boundWith, setBoundWith] = useState(work.bound_with ?? '');
  const [shelfMark, setShelfMark] = useState(work.shelf_mark ?? '');
  const [stateShelfMark, setStateShelfMark] = useState(work.state_shelf_mark ?? '');
  const [presentLocation, setPresentLocation] = useState(work.present_location ?? '');
  const [objectSizeCm, setObjectSizeCm] = useState(work.object_size_cm ?? '');
  const [numberOfCopies, setNumberOfCopies] = useState(work.number_of_copies != null ? String(work.number_of_copies) : '');

  const [keywords, setKeywords] = useState(work.keywords ?? '');
  const [language, setLanguage] = useState(work.language ?? '');
  const [seriesTitle, setSeriesTitle] = useState(work.series_title ?? '');
  const [volumeTitle, setVolumeTitle] = useState(work.volume_title ?? '');
  const [bibliography, setBibliography] = useState(work.bibliography ?? '');
  const [remarks, setRemarks] = useState(work.remarks ?? '');
  const [provenance, setProvenance] = useState(work.provenance ?? '');

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedSummary(null);

    try {
      const payload: Record<string, string | number | null> = {
        title, parallel_title: parallelTitle, uniform_title: uniformTitle,
        author, variant_author: variantAuthor, pseudonym,
        editor, variant_editor: variantEditor,
        place, printer, publisher,
        variant_printer: variantPrinter, variant_publisher: variantPublisher,
        year: year.trim() === '' ? null : year.trim(),
        bibliographic_format: bibliographicFormat,
        binding, bound_with: boundWith,
        shelf_mark: shelfMark, state_shelf_mark: stateShelfMark,
        present_location: presentLocation,
        object_size_cm: objectSizeCm,
        number_of_copies: numberOfCopies.trim() === '' ? null : numberOfCopies.trim(),
        keywords, language,
        series_title: seriesTitle, volume_title: volumeTitle,
        bibliography, remarks, provenance,
      };

      const res = await fetch(`/api/catalog/bph/${encodeURIComponent(work.ubn)}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      const updatedFields: string[] = Array.isArray(data?.updated) ? data.updated : [];
      if (updatedFields.length === 0) {
        setSavedSummary('No changes to save.');
      } else {
        setSavedSummary(`Updated ${updatedFields.length} field${updatedFields.length === 1 ? '' : 's'}.`);
      }
      onSave?.();
      // Close after a short success blip so the librarian sees confirmation.
      setTimeout(() => onClose(), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bph-cataloguer-modal-title"
        className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-stone-200 sticky top-0 bg-white z-10">
          <div>
            <h2 id="bph-cataloguer-modal-title" className="text-lg font-semibold text-stone-900">
              Edit cataloguer fields
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              BPH UBN <span className="font-mono">{work.ubn}</span> — writes Supabase <span className="font-mono">bph_works</span>
            </p>
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="p-1 hover:bg-stone-100 rounded">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* 1. Bibliographic identity */}
          <Section title="Bibliographic identity" subtitle="Preserve title-page spellings in the variant fields.">
            <Row>
              <Field2Col label="Short title">
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
              </Field2Col>
              <Field2Col label="Year">
                <input type="text" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 1695" className={inputCls} />
              </Field2Col>
            </Row>
            <Field label="Full title (transcription)" hint="Long-form title as printed.">
              <textarea value={parallelTitle} onChange={(e) => setParallelTitle(e.target.value)} rows={2} className={textareaCls} />
            </Field>
            <Field label="Variant title">
              <input type="text" value={uniformTitle} onChange={(e) => setUniformTitle(e.target.value)} className={inputCls} />
            </Field>
            <Row>
              <Field2Col label="Author (canonical)">
                <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} className={inputCls} />
              </Field2Col>
              <Field2Col label="Author (as on title page)" hint="One per line for multiple variants.">
                <textarea value={variantAuthor} onChange={(e) => setVariantAuthor(e.target.value)} rows={2} className={textareaCls} />
              </Field2Col>
            </Row>
            <Row>
              <Field2Col label="Pseudonym">
                <input type="text" value={pseudonym} onChange={(e) => setPseudonym(e.target.value)} className={inputCls} />
              </Field2Col>
              <Field2Col label="Editor / translator">
                <input type="text" value={editor} onChange={(e) => setEditor(e.target.value)} className={inputCls} />
              </Field2Col>
            </Row>
            <Field label="Editor (as on title page)" hint="One per line for multiple variants.">
              <textarea value={variantEditor} onChange={(e) => setVariantEditor(e.target.value)} rows={2} className={textareaCls} />
            </Field>
          </Section>

          {/* 2. Impressum */}
          <Section title="Impressum" subtitle="Place, printer, publisher — the imprint statement.">
            <Row>
              <Field2Col label="Place">
                <input type="text" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Amsterdam" className={inputCls} />
              </Field2Col>
              <Field2Col label="Printer">
                <input type="text" value={printer} onChange={(e) => setPrinter(e.target.value)} className={inputCls} />
              </Field2Col>
            </Row>
            <Row>
              <Field2Col label="Publisher">
                <input type="text" value={publisher} onChange={(e) => setPublisher(e.target.value)} className={inputCls} />
              </Field2Col>
              <Field2Col label="Printer (variant)">
                <input type="text" value={variantPrinter} onChange={(e) => setVariantPrinter(e.target.value)} className={inputCls} />
              </Field2Col>
            </Row>
            <Field label="Publisher (variant)">
              <input type="text" value={variantPublisher} onChange={(e) => setVariantPublisher(e.target.value)} className={inputCls} />
            </Field>
          </Section>

          {/* 3. Physical */}
          <Section title="Physical" subtitle="Collation formula, binding, location at BPH.">
            <Field label="Format (collation formula)" hint="e.g. In-4 : A-Ff⁴. Asterisks and other notation are preserved verbatim.">
              <input type="text" value={bibliographicFormat} onChange={(e) => setBibliographicFormat(e.target.value)} className={inputCls + ' font-mono'} />
            </Field>
            <Field label="Binding" hint="Free text — describe the physical binding.">
              <textarea value={binding} onChange={(e) => setBinding(e.target.value)} rows={2} className={textareaCls} />
            </Field>
            <Field label="Bound with">
              <input type="text" value={boundWith} onChange={(e) => setBoundWith(e.target.value)} className={inputCls} />
            </Field>
            <Row>
              <Field2Col label="Shelf mark">
                <input type="text" value={shelfMark} onChange={(e) => setShelfMark(e.target.value)} className={inputCls + ' font-mono'} />
              </Field2Col>
              <Field2Col label="State Collection shelf mark">
                <input type="text" value={stateShelfMark} onChange={(e) => setStateShelfMark(e.target.value)} className={inputCls + ' font-mono'} />
              </Field2Col>
            </Row>
            <Row>
              <Field2Col label="Present location">
                <input type="text" value={presentLocation} onChange={(e) => setPresentLocation(e.target.value)} className={inputCls} />
              </Field2Col>
              <Field2Col label="Object size (cm)">
                <input type="text" value={objectSizeCm} onChange={(e) => setObjectSizeCm(e.target.value)} className={inputCls} />
              </Field2Col>
            </Row>
            <Field label="Number of copies held">
              <input type="text" inputMode="numeric" value={numberOfCopies} onChange={(e) => setNumberOfCopies(e.target.value)} className={inputCls} />
            </Field>
          </Section>

          {/* 4. Content */}
          <Section title="Content" subtitle="Keywords, notes, language.">
            <Field label="Keywords" hint="Comma-separated.">
              <textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} rows={2} className={textareaCls} />
            </Field>
            <Field label="Language">
              <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. Dutch" className={inputCls} />
            </Field>
            <Row>
              <Field2Col label="Series title">
                <input type="text" value={seriesTitle} onChange={(e) => setSeriesTitle(e.target.value)} className={inputCls} />
              </Field2Col>
              <Field2Col label="Volume title">
                <input type="text" value={volumeTitle} onChange={(e) => setVolumeTitle(e.target.value)} className={inputCls} />
              </Field2Col>
            </Row>
            <Field label="Bibliography">
              <textarea value={bibliography} onChange={(e) => setBibliography(e.target.value)} rows={2} className={textareaCls} />
            </Field>
            <Field label="Remarks (notes)" hint="Multiple notes — one per line.">
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} className={textareaCls} />
            </Field>
            <Field label="Provenance / collection">
              <input type="text" value={provenance} onChange={(e) => setProvenance(e.target.value)} className={inputCls} />
            </Field>
          </Section>

          {error && (
            <div role="alert" className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}
          {savedSummary && !error && (
            <div role="status" className="p-3 bg-emerald-50 text-emerald-800 rounded-lg text-sm">
              {savedSummary}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-stone-200 bg-stone-50 sticky bottom-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-stone-700 hover:bg-stone-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- small layout helpers (kept local so the modal is self-contained) ----------

const inputCls =
  'w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus-visible:ring-accent-rust';
const textareaCls = inputCls + ' resize-y';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="border-b border-stone-200 pb-1">
        <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
        {subtitle && <p className="text-xs text-stone-500">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-stone-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-stone-500 mt-1">{hint}</span>}
    </label>
  );
}

function Field2Col({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-stone-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-stone-500 mt-1">{hint}</span>}
    </label>
  );
}
