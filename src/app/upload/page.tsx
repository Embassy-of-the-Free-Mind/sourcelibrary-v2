'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Upload,
  BookOpen,
  Loader2,
  CheckCircle,
  X,
  Image as ImageIcon,
  AlertCircle,
  Search,
  ExternalLink,
  Info,
} from 'lucide-react';
import { IMAGE_LICENSES, type ImageSourceProvider } from '@/lib/types';

interface UploadedPage {
  id: string;
  page_number: number;
  photo: string;
}

interface CatalogResult {
  id: string;
  title: string;
  author: string;
  year: string;
  language: string;
  description: string;
  publisher?: string;
  placeOfPublication?: string;
  printer?: string;
  source: 'ia' | 'bph';
  iaIdentifier?: string;
  imageUrl?: string;
}

type UploadStep = 'metadata' | 'upload' | 'complete';

export default function UploadPage() {
  const router = useRouter();
  const [step, setStep] = useState<UploadStep>('metadata');

  // Catalog search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CatalogResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchSource, setSearchSource] = useState<'all' | 'ia' | 'bph'>('all');
  const [selectedCatalogItem, setSelectedCatalogItem] = useState<CatalogResult | null>(null);

  // Book metadata
  const [title, setTitle] = useState('');
  const [displayTitle, setDisplayTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [language, setLanguage] = useState('Unknown');
  const [published, setPublished] = useState('');
  const [publisher, setPublisher] = useState('');
  const [placeOfPublication, setPlaceOfPublication] = useState('');
  const [printer, setPrinter] = useState('');
  const [iaIdentifier, setIaIdentifier] = useState('');

  // Image source & license
  const [imageSourceProvider, setImageSourceProvider] = useState<ImageSourceProvider>('internet_archive');
  const [imageSourceUrl, setImageSourceUrl] = useState('');
  const [imageLicense, setImageLicense] = useState('publicdomain');
  const [imageAttribution, setImageAttribution] = useState('');

  // Upload state
  const [bookId, setBookId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedPages, setUploadedPages] = useState<UploadedPage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Create book
  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);

    try {
      const response = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          display_title: displayTitle || undefined,
          author,
          language,
          published,
          publisher: publisher || undefined,
          place_of_publication: placeOfPublication || undefined,
          printer: printer || undefined,
          ia_identifier: iaIdentifier || undefined,
          image_source: {
            provider: imageSourceProvider,
            provider_name: imageSourceProvider === 'efm' ? 'Embassy of the Free Mind' :
                          imageSourceProvider === 'internet_archive' ? 'Internet Archive' :
                          imageSourceProvider === 'google_books' ? 'Google Books' :
                          imageSourceProvider === 'hathi_trust' ? 'HathiTrust' :
                          imageSourceProvider === 'biodiversity_heritage_library' ? 'Biodiversity Heritage Library' :
                          imageSourceProvider === 'gallica' ? 'Bibliothèque nationale de France' :
                          imageSourceProvider === 'e_rara' ? 'e-rara.ch' :
                          imageSourceProvider === 'mdz' ? 'Münchener DigitalisierungsZentrum' :
                          imageSourceProvider === 'user_upload' ? 'User Upload' : undefined,
            source_url: imageSourceUrl || undefined,
            identifier: iaIdentifier || undefined,
            license: imageLicense,
            attribution: imageAttribution || undefined,
            access_date: new Date(),
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create book');
      }

      const book = await response.json();
      setBookId(book.id);
      setStep('upload');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create book');
    } finally {
      setCreating(false);
    }
  };

  // Search catalogs
  const handleSearch = async () => {
    if (searchQuery.length < 2) return;

    setSearching(true);
    try {
      const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(searchQuery)}&source=${searchSource}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results);
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setSearching(false);
    }
  };

  // Select a catalog item to pre-fill form
  const selectCatalogItem = (item: CatalogResult) => {
    setSelectedCatalogItem(item);
    setTitle(item.title);
    setAuthor(item.author);
    setPublished(item.year);
    setLanguage(item.language || 'Latin');
    setPublisher(item.publisher || '');
    setPlaceOfPublication(item.placeOfPublication || '');
    setPrinter(item.printer || '');
    if (item.iaIdentifier) {
      setIaIdentifier(item.iaIdentifier);
      setImageSourceUrl(`https://archive.org/details/${item.iaIdentifier}`);
    }
    // Set image source based on catalog source
    if (item.source === 'ia') {
      setImageSourceProvider('internet_archive');
      setImageLicense('publicdomain'); // IA items are typically public domain
    } else if (item.source === 'bph') {
      setImageSourceProvider('biodiversity_heritage_library');
      setImageLicense('publicdomain');
    }
    setSearchResults([]);
    setSearchQuery('');
  };

  // Handle file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    // Sort files by name to maintain page order
    selectedFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    setFiles(prev => [...prev, ...selectedFiles]);
  }, []);

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    droppedFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    setFiles(prev => [...prev, ...droppedFiles]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Remove file from queue
  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Upload files
  const handleUpload = async () => {
    if (!bookId || files.length === 0) return;

    setUploading(true);
    setError(null);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('bookId', bookId);
      files.forEach(file => formData.append('files', file));

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      const result = await response.json();
      setUploadedPages(result.pages);
      setUploadProgress(100);
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // Languages commonly found in historical manuscripts
  const languages = ['Unknown', 'Latin', 'German', 'French', 'English', 'Italian', 'Dutch', 'Greek', 'Hebrew', 'Arabic'];

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link href="/" className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900">
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 ${step === 'metadata' ? 'text-amber-700' : 'text-green-700'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step === 'metadata' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
              }`}>
                {step === 'metadata' ? '1' : <CheckCircle className="w-5 h-5" />}
              </div>
              <span className="text-sm font-medium hidden sm:inline">Book Details</span>
            </div>
            <div className="w-12 h-px bg-stone-300" />
            <div className={`flex items-center gap-2 ${step === 'upload' ? 'text-amber-700' : step === 'complete' ? 'text-green-700' : 'text-stone-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step === 'upload' ? 'bg-amber-100 text-amber-700' :
                step === 'complete' ? 'bg-green-100 text-green-700' : 'bg-stone-100'
              }`}>
                {step === 'complete' ? <CheckCircle className="w-5 h-5" /> : '2'}
              </div>
              <span className="text-sm font-medium hidden sm:inline">Upload Pages</span>
            </div>
            <div className="w-12 h-px bg-stone-300" />
            <div className={`flex items-center gap-2 ${step === 'complete' ? 'text-green-700' : 'text-stone-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step === 'complete' ? 'bg-green-100 text-green-700' : 'bg-stone-100'
              }`}>
                {step === 'complete' ? <CheckCircle className="w-5 h-5" /> : '3'}
              </div>
              <span className="text-sm font-medium hidden sm:inline">Done</span>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-800 font-medium">Error</p>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Step 1: Book Metadata */}
        {step === 'metadata' && (
          <div className="space-y-6">
            {/* Instructions */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <p className="font-medium mb-1">Two ways to add a book:</p>
              <ol className="list-decimal list-inside space-y-1 text-amber-700">
                <li><strong>Search catalogs</strong> — Find the book in Internet Archive or BPH to pre-fill metadata</li>
                <li><strong>Enter manually</strong> — Skip the search and fill in the form below</li>
              </ol>
            </div>

            {/* Catalog Search */}
            <div className="bg-white rounded-xl border border-stone-200 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <Search className="w-5 h-5 text-blue-700" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-stone-900">Search Catalogs</h2>
                  <p className="text-sm text-stone-500">~37k books from Internet Archive and BPH</p>
                </div>
              </div>

              <div className="flex gap-2 mb-3">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search by title, author, or keyword..."
                    className="w-full px-4 py-2.5 pr-10 border border-stone-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-stone-400" />
                  )}
                </div>
                <select
                  value={searchSource}
                  onChange={(e) => setSearchSource(e.target.value as 'all' | 'ia' | 'bph')}
                  className="px-3 py-2 border border-stone-300 rounded-lg text-sm"
                >
                  <option value="all">All</option>
                  <option value="ia">Internet Archive</option>
                  <option value="bph">BPH</option>
                </select>
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={searching || searchQuery.length < 2}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Search
                </button>
              </div>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="max-h-80 overflow-y-auto border border-stone-200 rounded-lg divide-y divide-stone-100">
                  {searchResults.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => selectCatalogItem(item)}
                      className="w-full text-left p-3 hover:bg-stone-50 flex gap-3"
                    >
                      {item.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="w-12 h-16 object-cover rounded bg-stone-100 flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-stone-900 truncate">{item.title}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                            item.source === 'ia' ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {item.source === 'ia' ? 'IA' : 'BPH'}
                          </span>
                        </div>
                        <p className="text-sm text-stone-600">{item.author} • {item.year}</p>
                        {item.description && (
                          <p className="text-xs text-stone-500 mt-1 line-clamp-2">{item.description}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Selected item indicator */}
              {selectedCatalogItem && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <span className="text-sm text-green-800">
                      Selected: <strong>{selectedCatalogItem.title}</strong>
                    </span>
                  </div>
                  {selectedCatalogItem.iaIdentifier && (
                    <a
                      href={`https://archive.org/details/${selectedCatalogItem.iaIdentifier}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      View on IA <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Book Metadata Form */}
            <div className="bg-white rounded-xl border border-stone-200 p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-amber-700" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-stone-900">Book Details</h2>
                  <p className="text-sm text-stone-500">{selectedCatalogItem ? 'Edit the pre-filled details' : 'Enter the book metadata'}</p>
                </div>
              </div>

              <form onSubmit={handleCreateBook} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Original Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="e.g., Fons Sapientiae"
                  className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
                <p className="text-xs text-stone-500 mt-1">The title in the original language</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Display Title
                </label>
                <input
                  type="text"
                  value={displayTitle}
                  onChange={(e) => setDisplayTitle(e.target.value)}
                  placeholder="e.g., Fountain of Wisdom"
                  className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
                <p className="text-xs text-stone-500 mt-1">English title for display (optional)</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Author
                  </label>
                  <input
                    type="text"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="e.g., Anonymous"
                    className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Date/Period
                  </label>
                  <input
                    type="text"
                    value={published}
                    onChange={(e) => setPublished(e.target.value)}
                    placeholder="e.g., c. 1650"
                    className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Source Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                >
                  {languages.map(lang => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>

              {/* Publication Details */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Place of Publication
                  </label>
                  <input
                    type="text"
                    value={placeOfPublication}
                    onChange={(e) => setPlaceOfPublication(e.target.value)}
                    placeholder="e.g., Venice"
                    className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Publisher
                  </label>
                  <input
                    type="text"
                    value={publisher}
                    onChange={(e) => setPublisher(e.target.value)}
                    placeholder="e.g., Aldus Manutius"
                    className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Printer
                </label>
                <input
                  type="text"
                  value={printer}
                  onChange={(e) => setPrinter(e.target.value)}
                  placeholder="e.g., Johann Froben"
                  className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              {/* Image Source & License Section */}
              <div className="border-t border-stone-200 pt-6 mt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Info className="w-4 h-4 text-stone-400" />
                  <h3 className="text-sm font-medium text-stone-700">Image Source & License</h3>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">
                      Image Source
                    </label>
                    <select
                      value={imageSourceProvider}
                      onChange={(e) => setImageSourceProvider(e.target.value as ImageSourceProvider)}
                      className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    >
                      <option value="efm">Embassy of the Free Mind (BPH)</option>
                      <option value="internet_archive">Internet Archive</option>
                      <option value="google_books">Google Books</option>
                      <option value="hathi_trust">HathiTrust</option>
                      <option value="biodiversity_heritage_library">Biodiversity Heritage Library</option>
                      <option value="gallica">Gallica (BnF)</option>
                      <option value="e_rara">e-rara.ch</option>
                      <option value="mdz">MDZ (Munich)</option>
                      <option value="library">Library/Archive</option>
                      <option value="user_upload">My Own Scans</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">
                      Image License
                    </label>
                    <select
                      value={imageLicense}
                      onChange={(e) => setImageLicense(e.target.value)}
                      className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    >
                      {IMAGE_LICENSES.map(lic => (
                        <option key={lic.id} value={lic.id}>{lic.name} - {lic.description}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Source URL
                  </label>
                  <input
                    type="url"
                    value={imageSourceUrl}
                    onChange={(e) => setImageSourceUrl(e.target.value)}
                    placeholder="e.g., https://archive.org/details/..."
                    className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                  <p className="text-xs text-stone-500 mt-1">Link to the original source of the scans</p>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Attribution Text <span className="text-stone-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={imageAttribution}
                    onChange={(e) => setImageAttribution(e.target.value)}
                    placeholder="e.g., Scans courtesy of British Library"
                    className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                  <p className="text-xs text-stone-500 mt-1">Required credit text (if any)</p>
                </div>
              </div>

              <button
                type="submit"
                disabled={creating || !title}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    Continue to Upload
                    <ArrowLeft className="w-5 h-5 rotate-180" />
                  </>
                )}
              </button>
            </form>
            </div>
          </div>
        )}

        {/* Step 2: Upload Pages */}
        {step === 'upload' && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Upload className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-stone-900">Upload Pages</h1>
                <p className="text-sm text-stone-500">Add page images to your book</p>
              </div>
            </div>

            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="border-2 border-dashed border-stone-300 rounded-xl p-8 text-center hover:border-amber-400 transition-colors cursor-pointer"
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <ImageIcon className="w-12 h-12 text-stone-400 mx-auto mb-4" />
              <p className="text-stone-700 font-medium mb-1">
                Drop images here or click to browse
              </p>
              <p className="text-sm text-stone-500">
                Supports JPG, PNG, TIFF. Files will be sorted by name.
              </p>
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-stone-700">
                    {files.length} file{files.length !== 1 ? 's' : ''} selected
                  </h3>
                  <button
                    onClick={() => setFiles([])}
                    className="text-sm text-stone-500 hover:text-stone-700"
                  >
                    Clear all
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto border border-stone-200 rounded-lg divide-y divide-stone-200">
                  {files.map((file, index) => (
                    <div key={index} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-xs font-mono text-stone-400 w-6">
                        {index + 1}
                      </span>
                      <span className="flex-1 text-sm text-stone-700 truncate">
                        {file.name}
                      </span>
                      <span className="text-xs text-stone-400">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <button
                        onClick={() => removeFile(index)}
                        className="p-1 text-stone-400 hover:text-stone-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upload button */}
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setStep('metadata')}
                className="px-6 py-3 border border-stone-300 text-stone-700 rounded-lg font-medium hover:bg-stone-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || files.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    Upload {files.length} Page{files.length !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Complete */}
        {step === 'complete' && bookId && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 sm:p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-semibold text-stone-900 mb-2">Book Created!</h1>
            <p className="text-stone-600 mb-6">
              Successfully uploaded {uploadedPages.length} page{uploadedPages.length !== 1 ? 's' : ''}.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href={`/book/${bookId}/split`}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors"
              >
                Split Pages
              </Link>
              <Link
                href={`/book/${bookId}`}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-stone-300 text-stone-700 rounded-lg font-medium hover:bg-stone-50 transition-colors"
              >
                View Book
              </Link>
              <button
                onClick={() => {
                  setStep('metadata');
                  setBookId(null);
                  setTitle('');
                  setDisplayTitle('');
                  setAuthor('');
                  setLanguage('German');
                  setPublished('');
                  setFiles([]);
                  setUploadedPages([]);
                }}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 text-stone-600 hover:text-stone-900 transition-colors"
              >
                Add Another Book
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
