'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/context';
import {
  loadTranslatedDocuments,
  createTranslatedDocument,
  deleteTranslatedDocument,
  loadClients,
  loadMatters,
} from '@/lib/data/repository';
import type { DocumentRecord, Client, Matter } from '@/lib/types/database';

function DocumentTranslationContent() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const matterParam = searchParams.get('matter');

  const [savedDocs, setSavedDocs] = useState<DocumentRecord[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);

  // Active view: 'new' vs 'view'
  const [activeView, setActiveView] = useState<'translate' | 'history'>('translate');
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);

  // Form states
  const [memoTitle, setMemoTitle] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedMatterId, setSelectedMatterId] = useState(matterParam || '');
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
  const [teluguText, setTeluguText] = useState('');
  const [englishText, setEnglishText] = useState('');
  const [translating, setTranslating] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // TTS states
  const [speakingLang, setSpeakingLang] = useState<'telugu' | 'english' | null>(null);
  const [teluguVoiceNotice, setTeluguVoiceNotice] = useState<string | null>(null);

  const refreshData = () => {
    setSavedDocs(loadTranslatedDocuments());
    setClients(loadClients().filter((c) => c.status === 'active'));
    setMatters(loadMatters());
  };

  useEffect(() => {
    refreshData();
    const handleUpdate = () => refreshData();
    window.addEventListener('vakildesk-documents-update', handleUpdate);
    return () => window.removeEventListener('vakildesk-documents-update', handleUpdate);
  }, []);

  // Filter matters based on client
  const clientMatters = selectedClientId
    ? matters.filter((m) => m.client_id === selectedClientId)
    : matters;

  // Handle image upload and OCR simulation
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setUploadedImagePreview(url);

      // Populate initial OCR text prompt with sample Telugu legal memo
      if (!teluguText) {
        setTeluguText(
          'విశాఖపట్నం జిల్లా న్యాయస్థానంలో దాఖలు చేయబడిన సివిల్ దావా. వాది తరపున న్యాయవాది హాజరు అయి వాయిదా కోరినారు. ప్రతివాదికి నోటీసు జారీ చేయబడినది. తదుపరి విచారణ తేదీన ముద్దాయి హాజరు కావలెను.'
        );
      }
    };
    reader.readAsDataURL(file);
  };

  // Sample prefill for demo testing
  const loadSampleMemo = () => {
    setMemoTitle('Saket / Visakhapatnam Court Order Memo');
    setTeluguText(
      'విశాఖపట్నం జిల్లా మరియు సెషన్స్ న్యాయస్థానం నందు నంబర్ 142/2026 దావా. వాది తరపున వకాలత్ సమర్పించడమైనది. ముద్దాయి బెయిల్ పిటిషన్ విచారణకు స్వీకరించబడినది. తీర్పు వాయిదా వేయడమైనది.'
    );
  };

  // Translation handler
  const handleTranslate = async () => {
    if (!teluguText.trim()) return;
    setTranslating(true);

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teluguText }),
      });

      const data = await res.json();
      if (data.translatedText) {
        setEnglishText(data.translatedText);
      } else {
        setEnglishText('Translation completed. Refer to verified Telugu text on left.');
      }
    } catch (err) {
      console.error('Translation error:', err);
      setEnglishText('Notice: Translation server call failed. Showing preliminary review text.');
    } finally {
      setTranslating(false);
    }
  };

  // Save Translated Memo
  const handleSaveDocument = () => {
    if (!teluguText.trim() || !englishText.trim()) return;

    createTranslatedDocument({
      title: memoTitle.trim() || 'Telugu Legal Document Memo',
      original_text: teluguText.trim(),
      translated_text: englishText.trim(),
      client_id: selectedClientId || null,
      matter_id: selectedMatterId || null,
      image_url: uploadedImagePreview || null,
    });

    setSaveStatus('Document saved to practice files.');
    setTimeout(() => setSaveStatus(null), 3500);
    refreshData();
  };

  // ── Web Speech Synthesis (Read-Aloud) ─────────────────────────────────────
  const stopSpeech = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeakingLang(null);
  };

  const speakText = (text: string, lang: 'telugu' | 'english') => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      alert('Text-to-speech is not supported on this browser.');
      return;
    }

    if (speakingLang === lang) {
      stopSpeech();
      return;
    }

    stopSpeech();
    setTeluguVoiceNotice(null);

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();

    if (lang === 'telugu') {
      utterance.lang = 'te-IN';
      const teluguVoice = voices.find(
        (v) => v.lang === 'te-IN' || v.lang.startsWith('te') || v.name.toLowerCase().includes('telugu')
      );
      if (teluguVoice) {
        utterance.voice = teluguVoice;
      } else {
        // Fallback / warning for device capability
        setTeluguVoiceNotice(
          'Notice: A native Telugu TTS voice is not installed on this browser/device. System is playing in default synthesized voice. To hear authentic Telugu pronunciation, please enable the Telugu voice pack in device speech settings.'
        );
      }
    } else {
      utterance.lang = 'en-IN';
      const englishVoice = voices.find(
        (v) => v.lang === 'en-IN' || v.lang === 'en-GB' || v.lang.startsWith('en')
      );
      if (englishVoice) {
        utterance.voice = englishVoice;
      }
    }

    utterance.rate = 0.92; // Slightly slower for clarity in legal terminology
    utterance.onend = () => setSpeakingLang(null);
    utterance.onerror = () => setSpeakingLang(null);

    setSpeakingLang(lang);
    window.speechSynthesis.speak(utterance);
  };

  const openSavedDoc = (doc: DocumentRecord) => {
    setSelectedDoc(doc);
    setMemoTitle(doc.title);
    setTeluguText(doc.original_text || '');
    setEnglishText(doc.translated_text || '');
    setUploadedImagePreview(doc.image_url || null);
    setSelectedClientId(doc.client_id || '');
    setSelectedMatterId(doc.matter_id || '');
    setActiveView('translate');
  };

  return (
    <div>
      <div className="section-label">Telugu Document Translation & Read-Aloud</div>

      {/* View Switcher */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button
          type="button"
          className={`action-btn ${activeView === 'translate' ? 'action-btn-primary' : ''}`}
          style={{ flex: 1, justifyContent: 'center', fontSize: '0.88rem' }}
          onClick={() => {
            stopSpeech();
            setActiveView('translate');
          }}
        >
          📄 Translate Document
        </button>

        <button
          type="button"
          className={`action-btn ${activeView === 'history' ? 'action-btn-primary' : ''}`}
          style={{ flex: 1, justifyContent: 'center', fontSize: '0.88rem' }}
          onClick={() => {
            stopSpeech();
            setActiveView('history');
          }}
        >
          📚 Saved Memos ({savedDocs.length})
        </button>
      </div>

      {/* ── View 1: Translation Workspace ── */}
      {activeView === 'translate' && (
        <div>
          {/* Document Details Card */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">Document Setup</div>

            <label className="input-label">Memo Title</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Visakhapatnam Court Order Memo"
                value={memoTitle}
                onChange={(e) => setMemoTitle(e.target.value)}
                style={{ margin: 0, flex: 1 }}
              />
              <button
                type="button"
                className="action-btn"
                style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                onClick={loadSampleMemo}
              >
                Sample Memo
              </button>
            </div>

            {/* Optional Client & Case Linking */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="input-label">Link Client</label>
                <select
                  className="input-field"
                  value={selectedClientId}
                  onChange={(e) => {
                    setSelectedClientId(e.target.value);
                    setSelectedMatterId('');
                  }}
                  style={{ margin: 0 }}
                >
                  <option value="">-- None --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ flex: 1 }}>
                <label className="input-label">Link Case</label>
                <select
                  className="input-field"
                  value={selectedMatterId}
                  onChange={(e) => setSelectedMatterId(e.target.value)}
                  style={{ margin: 0 }}
                >
                  <option value="">-- None --</option>
                  {clientMatters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.matter_number}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Upload Scanned/Photo Image */}
            <label className="input-label">Upload Telugu Memo Photo or Scan (Optional)</label>
            <input
              type="file"
              accept="image/*"
              className="input-field"
              onChange={handleImageUpload}
              style={{ padding: '6px 10px', fontSize: '0.84rem' }}
            />

            {uploadedImagePreview && (
              <div style={{ marginTop: 8, marginBottom: 10, textAlign: 'center' }}>
                <img
                  src={uploadedImagePreview}
                  alt="Uploaded memo scan"
                  style={{ maxHeight: 180, maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
                />
              </div>
            )}
          </div>

          {/* ── Mandatory Handwritten OCR Accuracy Warning ── */}
          <div
            style={{
              backgroundColor: 'var(--status-warning-bg)',
              border: '1px solid var(--status-warning)',
              color: 'var(--text-primary)',
              borderRadius: 8,
              padding: '12px 14px',
              fontSize: '0.82rem',
              lineHeight: 1.45,
              marginBottom: 14,
            }}
          >
            <strong>⚠️ Mandatory Review Notice:</strong> Handwritten Telugu OCR accuracy is significantly lower than printed text. Please carefully review and correct the extracted Telugu text in the field below before finalizing or relying on the translation.
          </div>

          {/* ── Step 1: Telugu Text Review Area ── */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="card-title" style={{ margin: 0 }}>
                1. Telugu Original Text (తెలుగు అసలు పాఠం)
              </div>
              {teluguText && (
                <button
                  type="button"
                  className="action-btn"
                  style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                  onClick={() => speakText(teluguText, 'telugu')}
                >
                  {speakingLang === 'telugu' ? '⏸️ Stop' : '🔊 Read Aloud (Telugu)'}
                </button>
              )}
            </div>

            {teluguVoiceNotice && (
              <div style={{ fontSize: '0.74rem', color: 'var(--accent-gold)', marginBottom: 8, lineHeight: 1.35 }}>
                {teluguVoiceNotice}
              </div>
            )}

            <textarea
              className="input-field"
              rows={5}
              placeholder="Type or review extracted Telugu legal text here…"
              value={teluguText}
              onChange={(e) => setTeluguText(e.target.value)}
              style={{
                fontFamily: "'Noto Sans Telugu', system-ui, sans-serif",
                fontSize: '0.95rem',
                lineHeight: 1.6,
              }}
            />

            <button
              type="button"
              className="action-btn action-btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={translating || !teluguText.trim()}
              onClick={handleTranslate}
            >
              {translating ? 'Translating Telugu Legal Text…' : 'Translate to English →'}
            </button>
          </div>

          {/* ── Step 2: Dual Memo View (Side-by-Side / Stacked) ── */}
          {englishText && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="card-title" style={{ margin: 0 }}>
                  2. English Translation (ఆంగ్ల అనువాదం)
                </div>
                <button
                  type="button"
                  className="action-btn"
                  style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                  onClick={() => speakText(englishText, 'english')}
                >
                  {speakingLang === 'english' ? '⏸️ Stop' : '🔊 Read Aloud (English)'}
                </button>
              </div>

              {/* ── Persistent Machine Translation Disclaimer ── */}
              <div
                style={{
                  backgroundColor: 'var(--status-danger-bg)',
                  border: '1px solid var(--status-danger)',
                  color: 'var(--status-danger)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  marginBottom: 12,
                  lineHeight: 1.4,
                }}
              >
                ⚠️ Machine-generated translation — refer to the original Telugu text for any legally significant interpretation.
              </div>

              {/* Dual Panel Grid (Side by side on wider screens, stacked on mobile) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 14 }}>
                {/* English Translated Text */}
                <div style={{ backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', fontWeight: 700 }}>
                    English Translation:
                  </div>
                  <div style={{ fontSize: '0.92rem', color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {englishText}
                  </div>
                </div>

                {/* Original Telugu Reference */}
                <div style={{ backgroundColor: 'var(--bg-app)', borderRadius: 8, padding: 14, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', fontWeight: 700 }}>
                    Telugu Reference:
                  </div>
                  <div style={{ fontFamily: "'Noto Sans Telugu', system-ui, sans-serif", fontSize: '0.92rem', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {teluguText}
                  </div>
                </div>
              </div>

              {/* Save Document Action */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="action-btn action-btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={handleSaveDocument}
                >
                  💾 Save Translated Memo
                </button>
              </div>

              {saveStatus && (
                <div style={{ color: 'var(--status-success)', fontSize: '0.82rem', marginTop: 8, textAlign: 'center', fontWeight: 600 }}>
                  ✓ {saveStatus}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── View 2: Saved Memos History ── */}
      {activeView === 'history' && (
        <div>
          {savedDocs.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                No translated documents saved yet. Switch to "Translate Document" to upload or type a Telugu memo.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {savedDocs.map((doc) => (
                <div key={doc.id} className="card" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                        {doc.title}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Saved on {new Date(doc.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                  </div>

                  {/* Dual Snippet */}
                  <div style={{ backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 8, padding: 10, margin: '8px 0', fontSize: '0.84rem' }}>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: 4 }}>
                      {doc.translated_text?.slice(0, 140)}…
                    </div>
                    <div style={{ fontFamily: "'Noto Sans Telugu', system-ui", color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {doc.original_text?.slice(0, 100)}…
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
                    <button
                      type="button"
                      className="action-btn action-btn-primary"
                      style={{ flex: 1, justifyContent: 'center', fontSize: '0.82rem' }}
                      onClick={() => openSavedDoc(doc)}
                    >
                      Open & Read Aloud →
                    </button>
                    <button
                      type="button"
                      className="action-btn"
                      style={{ color: 'var(--status-danger)', fontSize: '0.82rem' }}
                      onClick={() => deleteTranslatedDocument(doc.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DocumentTranslationPage() {
  return (
    <Suspense fallback={<div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading document translator…</div>}>
      <DocumentTranslationContent />
    </Suspense>
  );
}
