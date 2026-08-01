'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  ChevronLeft,
  Send,
  Clock,
  CheckCircle,
  XCircle,
  Trash2,
  Sparkles,
  Users,
  Eye,
  Mail,
  FileText,
  History,
  Edit2,
} from 'lucide-react';

import { email } from '@/lib/api-client';
import RichEmailEditor from '@/components/admin/RichEmailEditor';
import ProseField from '@/components/ui/ProseField';
import type { EmailDraft, SubscriberStats } from '@/lib/api-client/types/email';

// A half-written letter should survive a refresh or a misclick. The compose
// buffer is mirrored to localStorage and restored on mount; it is cleared once
// the draft is saved to the server, which is the real store.
const COMPOSE_BUFFER_KEY = 'sl_email_compose_buffer';

type TabId = 'compose' | 'drafts' | 'sent' | 'subscribers';

const STATUS_ICONS: Record<string, React.ReactNode> = {
  draft: <FileText className="w-4 h-4 text-stone-400" />,
  sending: <Clock className="w-4 h-4 text-accent-gold animate-spin" />,
  sent: <CheckCircle className="w-4 h-4 text-status-success" />,
  failed: <XCircle className="w-4 h-4 text-status-error" />,
};

export default function EmailAdminPage() {
  const [activeTab, setActiveTab] = useState<TabId>('compose');
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailDraft[]>([]);
  const [stats, setStats] = useState<SubscriberStats | null>(null);
  const [loading, setLoading] = useState(false);

  // Compose state
  const [composeMode, setComposeMode] = useState<'digest' | 'manual'>('digest');
  const [periodDays, setPeriodDays] = useState(14);
  const [manualSubject, setManualSubject] = useState('');
  const [manualHtml, setManualHtml] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewDraft, setPreviewDraft] = useState<EmailDraft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  // Editing state
  const [editingDraft, setEditingDraft] = useState<EmailDraft | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editHtml, setEditHtml] = useState('');

  const loadDrafts = useCallback(async () => {
    try {
      const [draftRes, sentRes] = await Promise.all([
        email.drafts('draft'),
        email.drafts('sent'),
      ]);
      setDrafts(draftRes.drafts);
      setSentEmails(sentRes.drafts);
    } catch (err) {
      console.error('Failed to load drafts:', err);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const s = await email.subscribers();
      setStats(s);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }, []);

  useEffect(() => {
    loadDrafts();
    loadStats();
  }, [loadDrafts, loadStats]);

  // Restore an unsaved compose buffer once, on mount. Runs before the user can
  // type, so it cannot clobber live input.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COMPOSE_BUFFER_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { subject?: string; html?: string };
      if (saved.subject) setManualSubject(saved.subject);
      if (saved.html) setManualHtml(saved.html);
      if (saved.subject || saved.html) {
        setComposeMode('manual');
        toast('Restored your unsaved draft');
      }
    } catch {
      /* a corrupt buffer must never block the page */
    }
  }, []);

  // Mirror the buffer as it changes. Writing an empty buffer would wipe the
  // restore point the moment the page loads with both fields blank, so only a
  // non-empty compose is persisted, and clearing both removes the key.
  useEffect(() => {
    try {
      if (manualSubject || manualHtml) {
        localStorage.setItem(
          COMPOSE_BUFFER_KEY,
          JSON.stringify({ subject: manualSubject, html: manualHtml }),
        );
      } else {
        localStorage.removeItem(COMPOSE_BUFFER_KEY);
      }
    } catch {
      /* private mode / quota — autosave is a convenience, never a gate */
    }
  }, [manualSubject, manualHtml]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await email.generate(periodDays);
      setPreviewDraft(res.draft);
      setPreviewHtml(res.draft.html);
      toast.success('Digest generated');
      loadDrafts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateManualDraft = async () => {
    if (!manualSubject || !manualHtml) {
      toast.error('Subject and body are required');
      return;
    }
    setLoading(true);
    try {
      // Preview to get wrapped HTML
      const preview = await email.preview(manualSubject, manualHtml);
      const res = await email.createDraft({
        subject: manualSubject,
        html: preview.html,
      });
      setPreviewDraft(res.draft);
      setPreviewHtml(res.draft.html);
      setManualSubject('');
      setManualHtml('');
      toast.success('Draft saved');
      loadDrafts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewManual = async () => {
    if (!manualSubject || !manualHtml) return;
    try {
      const res = await email.preview(manualSubject, manualHtml);
      setPreviewHtml(res.html);
      setPreviewDraft(null);
    } catch (err) {
      toast.error('Preview failed');
    }
  };

  const handleSend = async (draftId: string) => {
    if (!confirm('Send this email to all subscribers? This cannot be undone.')) return;
    setSending(draftId);
    try {
      const res = await email.send(draftId);
      if (res.success) {
        toast.success(`Sent to ${res.recipients_count} subscribers`);
        setPreviewDraft(null);
        setPreviewHtml('');
        loadDrafts();
      } else {
        toast.error(res.error || 'Send failed');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(null);
    }
  };

  const handleDelete = async (draftId: string) => {
    if (!confirm('Delete this draft?')) return;
    try {
      await email.deleteDraft(draftId);
      toast.success('Draft deleted');
      if (previewDraft?.id === draftId) {
        setPreviewDraft(null);
        setPreviewHtml('');
      }
      loadDrafts();
    } catch (err) {
      toast.error('Delete failed');
    }
  };

  const handleStartEdit = (draft: EmailDraft) => {
    setEditingDraft(draft);
    setEditSubject(draft.subject);
    setEditHtml(draft.html);
  };

  const handleSaveEdit = async () => {
    if (!editingDraft) return;
    try {
      const res = await email.updateDraft(editingDraft.id, {
        subject: editSubject,
        html: editHtml,
      });
      toast.success('Draft updated');
      setEditingDraft(null);
      setPreviewDraft(res.draft);
      setPreviewHtml(res.draft.html);
      loadDrafts();
    } catch (err) {
      toast.error('Update failed');
    }
  };

  const handleViewDraft = (draft: EmailDraft) => {
    setPreviewDraft(draft);
    setPreviewHtml(draft.html);
  };

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'compose', label: 'Compose', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'drafts', label: 'Drafts', icon: <FileText className="w-4 h-4" /> },
    { id: 'sent', label: 'Sent', icon: <History className="w-4 h-4" /> },
    { id: 'subscribers', label: 'Subscribers', icon: <Users className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      {/* Header */}
      <header className="border-b border-stone-800 bg-stone-900">
        <div className="max-w-[1500px] mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-stone-400 hover:text-white">
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl font-semibold flex items-center gap-2">
                  <Mail className="w-5 h-5 text-accent-rust" />
                  Email Newsletter
                </h1>
                <p className="text-sm text-stone-400">
                  {stats ? `${stats.total} subscribers` : 'Loading...'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-stone-800 bg-stone-900/50">
        <div className="max-w-[1500px] mx-auto px-4">
          <nav className="flex gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-accent-rust text-white'
                    : 'border-transparent text-stone-400 hover:text-stone-200'
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.id === 'drafts' && drafts.length > 0 && (
                  <span className="bg-stone-700 text-stone-300 text-xs px-1.5 py-0.5 rounded-full">{drafts.length}</span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[1500px] mx-auto px-4 py-6">
        {/* ===== COMPOSE TAB ===== */}
        {activeTab === 'compose' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: compose form */}
            <div>
              {/* Mode toggle */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setComposeMode('digest')}
                  className={`px-3 py-1.5 text-sm rounded-md ${
                    composeMode === 'digest'
                      ? 'bg-accent-rust text-white'
                      : 'bg-stone-800 text-stone-400 hover:text-white'
                  }`}
                >
                  AI Digest
                </button>
                <button
                  onClick={() => setComposeMode('manual')}
                  className={`px-3 py-1.5 text-sm rounded-md ${
                    composeMode === 'manual'
                      ? 'bg-accent-rust text-white'
                      : 'bg-stone-800 text-stone-400 hover:text-white'
                  }`}
                >
                  Manual
                </button>
              </div>

              {composeMode === 'digest' ? (
                <div className="bg-stone-900 rounded-lg p-4 border border-stone-800">
                  <h3 className="text-sm font-medium text-stone-300 mb-3">Generate AI Digest</h3>
                  <p className="text-sm text-stone-400 mb-4">
                    Pulls recent books, popular reads, and gallery stats to generate a newsletter.
                  </p>
                  <div className="flex items-center gap-3 mb-4">
                    <label className="text-sm text-stone-400">Period:</label>
                    <select
                      value={periodDays}
                      onChange={e => setPeriodDays(Number(e.target.value))}
                      className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-sm"
                    >
                      <option value={7}>Last 7 days</option>
                      <option value={14}>Last 14 days</option>
                      <option value={30}>Last 30 days</option>
                      <option value={60}>Last 60 days</option>
                    </select>
                  </div>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="flex items-center gap-2 px-4 py-2 bg-accent-rust hover:bg-accent-rust/80 text-white rounded-md text-sm disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    {generating ? 'Generating...' : 'Generate Digest'}
                  </button>
                </div>
              ) : (
                <div className="bg-stone-900 rounded-lg p-4 border border-stone-800">
                  <h3 className="text-sm font-medium text-stone-300 mb-3">Manual Compose</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm text-stone-400 block mb-1">Subject</label>
                      <input
                        type="text"
                        value={manualSubject}
                        onChange={e => setManualSubject(e.target.value)}
                        placeholder="Email subject line"
                        className="w-full bg-stone-800 border border-stone-700 rounded px-3 py-2 text-sm"
                      />
                    </div>
                    <ProseField
                      label="Body"
                      format="html"
                      value={manualHtml}
                      onChange={setManualHtml}
                      help="Wrapped in the Source Library template — leave out the header, logo and footer."
                    >
                      <RichEmailEditor
                        value={manualHtml}
                        onChange={setManualHtml}
                        idPrefix="compose"
                      />
                    </ProseField>
                    <div className="flex gap-2">
                      <button
                        onClick={handlePreviewManual}
                        className="flex items-center gap-2 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-md text-sm"
                      >
                        <Eye className="w-4 h-4" />
                        Preview
                      </button>
                      <button
                        onClick={handleCreateManualDraft}
                        disabled={loading || !manualSubject || !manualHtml}
                        className="flex items-center gap-2 px-3 py-1.5 bg-accent-rust hover:bg-accent-rust/80 text-white rounded-md text-sm disabled:opacity-50"
                      >
                        <FileText className="w-4 h-4" />
                        Save as Draft
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Preview draft actions */}
              {previewDraft && previewDraft.status === 'draft' && (
                <div className="mt-4 bg-stone-900 rounded-lg p-4 border border-stone-800">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-stone-300">{previewDraft.subject}</h3>
                    <span className="text-xs text-stone-500">
                      {previewDraft.type === 'digest' ? 'AI Generated' : 'Manual'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStartEdit(previewDraft)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-md text-sm"
                    >
                      <Edit2 className="w-3 h-3" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleSend(previewDraft.id)}
                      disabled={sending === previewDraft.id}
                      className="flex items-center gap-2 px-3 py-1.5 bg-status-success hover:bg-status-success/80 text-white rounded-md text-sm disabled:opacity-50"
                    >
                      <Send className="w-3 h-3" />
                      {sending === previewDraft.id ? 'Sending...' : 'Send to All'}
                    </button>
                    <button
                      onClick={() => handleDelete(previewDraft.id)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-400 rounded-md text-sm"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right: preview */}
            <div>
              {previewHtml ? (
                <div className="bg-white rounded-lg overflow-hidden">
                  <div className="bg-stone-800 px-3 py-2 text-xs text-stone-400 flex items-center gap-2">
                    <Eye className="w-3 h-3" />
                    Email Preview
                  </div>
                  <iframe
                    srcDoc={previewHtml}
                    className="w-full border-0"
                    style={{ height: '600px' }}
                    title="Email preview"
                  />
                </div>
              ) : (
                <div className="bg-stone-900 rounded-lg border border-stone-800 flex items-center justify-center" style={{ height: '400px' }}>
                  <p className="text-stone-500 text-sm">Generate or preview an email to see it here</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== DRAFTS TAB ===== */}
        {activeTab === 'drafts' && (
          <div>
            {editingDraft ? (
              <div className="bg-stone-900 rounded-lg p-4 border border-stone-800 max-w-2xl">
                <h3 className="text-sm font-medium text-stone-300 mb-3">Editing Draft</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-stone-400 block mb-1">Subject</label>
                    <input
                      type="text"
                      value={editSubject}
                      onChange={e => setEditSubject(e.target.value)}
                      className="w-full bg-stone-800 border border-stone-700 rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <ProseField
                    label="Body"
                    format="html"
                    value={editHtml}
                    onChange={setEditHtml}
                    help="A saved draft holds the FULL wrapped email, header and footer included."
                  >
                    <RichEmailEditor
                      value={editHtml}
                      onChange={setEditHtml}
                      minHeight={520}
                      idPrefix="edit-draft"
                    />
                  </ProseField>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      className="px-3 py-1.5 bg-accent-rust hover:bg-accent-rust/80 text-white rounded-md text-sm"
                    >
                      Save Changes
                    </button>
                    <button
                      onClick={() => setEditingDraft(null)}
                      className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-md text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : drafts.length === 0 ? (
              <div className="text-center py-12 text-stone-500">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No drafts. Generate a digest or compose a manual email.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {drafts.map(draft => (
                  <div key={draft.id} className="bg-stone-900 rounded-lg p-4 border border-stone-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {STATUS_ICONS[draft.status]}
                      <div>
                        <div className="text-sm font-medium">{draft.subject}</div>
                        <div className="text-xs text-stone-500">
                          {draft.type === 'digest' ? 'AI Digest' : 'Manual'} &middot;{' '}
                          {new Date(draft.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleViewDraft(draft)}
                        className="p-1.5 text-stone-400 hover:text-white rounded"
                        title="Preview"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleStartEdit(draft)}
                        className="p-1.5 text-stone-400 hover:text-white rounded"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleSend(draft.id)}
                        disabled={sending === draft.id}
                        className="flex items-center gap-1 px-2.5 py-1 bg-status-success/20 text-status-success hover:bg-status-success/30 rounded text-xs disabled:opacity-50"
                      >
                        <Send className="w-3 h-3" />
                        {sending === draft.id ? '...' : 'Send'}
                      </button>
                      <button
                        onClick={() => handleDelete(draft.id)}
                        className="p-1.5 text-stone-400 hover:text-status-error rounded"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Preview pane for drafts */}
            {previewHtml && !editingDraft && (
              <div className="mt-6 bg-white rounded-lg overflow-hidden max-w-xl mx-auto">
                <div className="bg-stone-800 px-3 py-2 text-xs text-stone-400 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Eye className="w-3 h-3" />
                    {previewDraft?.subject || 'Preview'}
                  </span>
                  <button onClick={() => { setPreviewHtml(''); setPreviewDraft(null); }} className="text-stone-500 hover:text-white">
                    &times;
                  </button>
                </div>
                <iframe
                  srcDoc={previewHtml}
                  className="w-full border-0"
                  style={{ height: '500px' }}
                  title="Email preview"
                />
              </div>
            )}
          </div>
        )}

        {/* ===== SENT TAB ===== */}
        {activeTab === 'sent' && (
          <div>
            {sentEmails.length === 0 ? (
              <div className="text-center py-12 text-stone-500">
                <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No emails sent yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sentEmails.map(e => (
                  <div key={e.id} className="bg-stone-900 rounded-lg p-4 border border-stone-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-4 h-4 text-status-success" />
                      <div>
                        <div className="text-sm font-medium">{e.subject}</div>
                        <div className="text-xs text-stone-500">
                          Sent {e.sent_at ? new Date(e.sent_at).toLocaleDateString() : ''} &middot;{' '}
                          {e.recipients_count || '?'} recipients
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleViewDraft(e)}
                      className="p-1.5 text-stone-400 hover:text-white rounded"
                      title="View"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {previewHtml && (
              <div className="mt-6 bg-white rounded-lg overflow-hidden max-w-xl mx-auto">
                <div className="bg-stone-800 px-3 py-2 text-xs text-stone-400 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Eye className="w-3 h-3" />
                    {previewDraft?.subject || 'Preview'}
                  </span>
                  <button onClick={() => { setPreviewHtml(''); setPreviewDraft(null); }} className="text-stone-500 hover:text-white">
                    &times;
                  </button>
                </div>
                <iframe
                  srcDoc={previewHtml}
                  className="w-full border-0"
                  style={{ height: '500px' }}
                  title="Email preview"
                />
              </div>
            )}
          </div>
        )}

        {/* ===== SUBSCRIBERS TAB ===== */}
        {activeTab === 'subscribers' && (
          <div>
            {!stats ? (
              <div className="text-center py-12 text-stone-500">Loading...</div>
            ) : (
              <div className="space-y-6">
                {/* Stats cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-stone-900 rounded-lg p-4 border border-stone-800 text-center">
                    <div className="text-2xl font-semibold text-accent-rust">{stats.total}</div>
                    <div className="text-xs text-stone-400 mt-1">Total Subscribers</div>
                  </div>
                  {Object.entries(stats.by_source).map(([source, count]) => (
                    <div key={source} className="bg-stone-900 rounded-lg p-4 border border-stone-800 text-center">
                      <div className="text-2xl font-semibold">{count}</div>
                      <div className="text-xs text-stone-400 mt-1">{source.replace(/_/g, ' ')}</div>
                    </div>
                  ))}
                  <div className="bg-stone-900 rounded-lg p-4 border border-stone-800 text-center">
                    <div className="text-2xl font-semibold text-accent-gold">{stats.efm_newsletter_opt_in ?? 0}</div>
                    <div className="text-xs text-stone-400 mt-1">EFM newsletter opt-in</div>
                  </div>
                </div>

                {/* Recent signups */}
                <div className="bg-stone-900 rounded-lg border border-stone-800">
                  <div className="px-4 py-3 border-b border-stone-800">
                    <h3 className="text-sm font-medium text-stone-300">Recent Signups</h3>
                  </div>
                  <div className="divide-y divide-stone-800">
                    {stats.recent.map((r, i) => (
                      <div key={i} className="px-4 py-2.5 flex items-center justify-between text-sm">
                        <span className="text-stone-300 font-mono text-xs">{r.email_masked}</span>
                        <div className="flex items-center gap-3 text-xs text-stone-500">
                          <span>{r.source?.replace(/_/g, ' ')}</span>
                          {r.country && <span>{r.country}</span>}
                          {r.efm_newsletter_opt_in && (
                            <span className="text-accent-gold" title="Opted into EFM newsletter">EFM</span>
                          )}
                          <span>{new Date(r.subscribed_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
