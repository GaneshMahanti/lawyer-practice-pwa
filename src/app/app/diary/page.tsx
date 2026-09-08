'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/context';
import {
  loadUnifiedNotes,
  saveUnifiedNotes,
  createUnifiedNote,
  deleteUnifiedNote,
  updateUnifiedNote,
  loadClients,
  loadMatters,
} from '@/lib/data/repository';
import type { DiaryEntry, Client, Matter } from '@/lib/types/database';

type InputMode = 'type' | 'voice';

function UnifiedNotesContent() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const matterFilterParam = searchParams.get('matter');

  const [notes, setNotes] = useState<DiaryEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);

  // Input Mode: 'type' vs 'voice'
  const [inputMode, setInputMode] = useState<InputMode>('type');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'voice' | 'text'>('all');

  // Common Entry Fields
  const [title, setTitle] = useState('');
  const [typedBody, setTypedBody] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedMatterId, setSelectedMatterId] = useState(matterFilterParam || '');

  // Translate panel
  const [translateOpen, setTranslateOpen] = React.useState(false);
  const [translateInput, setTranslateInput] = React.useState('');
  const [translateResult, setTranslateResult] = React.useState('');
  const [translating, setTranslating] = React.useState(false);

  // Edit State
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  // Voice Recording states
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'recorded'>('idle');
  const [durationSec, setDurationSec] = useState(0);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [whisperNotice, setWhisperNotice] = useState(false);

  // Audio Playback
  const [playingNoteId, setPlayingNoteId] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const refreshData = () => {
    setNotes(loadUnifiedNotes());
    setClients(loadClients().filter((c) => c.status === 'active'));
    setMatters(loadMatters());
  };

  useEffect(() => {
    refreshData();
    const handleUpdate = () => refreshData();
    window.addEventListener('vakildesk-notes-update', handleUpdate);
    return () => window.removeEventListener('vakildesk-notes-update', handleUpdate);
  }, []);

  // Filter matters based on selected client
  const clientMatters = selectedClientId
    ? matters.filter((m) => m.client_id === selectedClientId)
    : matters;

  // ── Voice Recording Logic ─────────────────────────────────────────────────
  const startTimer = () => {
    setDurationSec(0);
    timerIntervalRef.current = setInterval(() => {
      setDurationSec((prev) => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mr = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioBlobUrl(url);
        setRecordingState('recorded');
      };

      mr.start(250);
      setRecordingState('recording');
      startTimer();
    } catch (err) {
      console.error('Microphone access failed:', err);
      alert('Microphone access denied or not supported on this browser.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recordingState === 'recording') {
      mediaRecorderRef.current.stop();
      stopTimer();
    }
  };

  const resetRecording = () => {
    stopTimer();
    setRecordingState('idle');
    setDurationSec(0);
    setAudioBlobUrl(null);
    setAudioBlob(null);
    audioChunksRef.current = [];
  };

  // Save Note (Typed or Voice)
  const handleSaveNote = (e: React.FormEvent) => {
    e.preventDefault();

    if (inputMode === 'type') {
      if (!typedBody.trim()) return;
      createUnifiedNote({
        entry_type: 'text',
        title: title.trim() || 'Typed Note',
        content: typedBody.trim(),
        client_id: selectedClientId || null,
        matter_id: selectedMatterId || null,
      });
      setTitle('');
      setTypedBody('');
    } else {
      // Voice mode
      if (!audioBlobUrl) return;
      createUnifiedNote({
        entry_type: 'voice',
        title: title.trim() || `Voice Memo (${formatDuration(durationSec)})`,
        content: 'Audio recorded. Ready for Whisper transcription processing.',
        audio_url: audioBlobUrl,
        duration_seconds: durationSec,
        client_id: selectedClientId || null,
        matter_id: selectedMatterId || null,
        transcription_status: 'recorded',
      });
      setWhisperNotice(true);
      setTimeout(() => setWhisperNotice(false), 5000);
      resetRecording();
      setTitle('');
    }

    refreshData();
  };

  // Playback helper
  const handlePlayVoice = (noteId: string, url?: string | null) => {
    if (!url) return;
    if (playingNoteId === noteId) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current.currentTime = 0;
      }
      setPlayingNoteId(null);
      return;
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.src = url;
      audioPlayerRef.current.play();
      setPlayingNoteId(noteId);
      audioPlayerRef.current.onended = () => setPlayingNoteId(null);
      audioPlayerRef.current.onerror = () => setPlayingNoteId(null);
    }
  };

  // Formatters
  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Filtered Notes
  const filteredNotes = notes.filter((n) => {
    if (matterFilterParam && n.matter_id !== matterFilterParam) return false;
    if (filterType !== 'all' && n.entry_type !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (n.title || '').toLowerCase().includes(q);
      const matchContent = (n.content || '').toLowerCase().includes(q);
      if (!matchTitle && !matchContent) return false;
    }
    return true;
  });

  const getClientName = (cid?: string | null) => {
    if (!cid) return null;
    const c = clients.find((item) => item.id === cid);
    return c ? c.name : null;
  };

  const getMatterTitle = (mid?: string | null) => {
    if (!mid) return null;
    const m = matters.find((item) => item.id === mid);
    return m ? `${m.matter_number} - ${m.title}` : null;
  };


  // ── Telugu Translation Utility Panel ────────────────────────────────────
  function TranslatePanel() {
    const handleTranslate = async () => {
      if (!translateInput.trim()) return;
      setTranslating(true);
      setTranslateResult('');
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teluguText: translateInput }),
        });
        const data = await res.json();
        setTranslateResult(data.englishText || data.error || 'Translation failed.');
      } catch {
        setTranslateResult('Network error. Please try again.');
      } finally {
        setTranslating(false);
      }
    };

    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => setTranslateOpen((o) => !o)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.9rem' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/>
              <path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>
            </svg>
            Telugu Translation
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ transform: translateOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {translateOpen && (
          <div style={{ marginTop: 14 }}>
            <label className="input-label">Paste Telugu text to translate</label>
            <textarea
              className="input-field"
              rows={4}
              placeholder="Type or paste Telugu legal text here…"
              value={translateInput}
              onChange={(e) => setTranslateInput(e.target.value)}
              style={{ fontFamily: "'Noto Sans Telugu', system-ui, sans-serif", fontSize: '0.95rem', lineHeight: 1.6 }}
            />
            <button
              type="button"
              className="action-btn action-btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginBottom: translateResult ? 14 : 0 }}
              disabled={translating || !translateInput.trim()}
              onClick={handleTranslate}
            >
              {translating ? 'Translating…' : 'Translate to English →'}
            </button>

            {translateResult && (
              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', fontWeight: 700 }}>
                  English Translation:
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {translateResult}
                </div>
                <button
                  type="button"
                  className="action-btn"
                  style={{ marginTop: 10, fontSize: '0.8rem' }}
                  onClick={() => {
                    setTypedBody((prev) => prev ? prev + '\n\n[Translation]\n' + translateResult : '[Translation]\n' + translateResult);
                    setTranslateOpen(false);
                  }}
                >
                  Append to note
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="section-label">{t('diary')}</div>

      {/* Hidden audio element for playback */}
      <audio ref={audioPlayerRef} style={{ display: 'none' }} />

      {/* Whisper Notification Banner */}
      {whisperNotice && (
        <div style={{ backgroundColor: 'var(--accent-primary-dim)', color: 'var(--accent-primary)', padding: '10px 14px', borderRadius: 8, fontSize: '0.84rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>✓</span>
          <span>Voice memo saved. Pipeline ready for Whisper transcription processing.</span>
        </div>
      )}

      {/* ── Unified Entry Card ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>Add Note / Voice Memo</div>

          {/* Mode Switcher: Type vs Voice */}
          <div style={{ display: 'flex', gap: 4, backgroundColor: 'var(--bg-app)', padding: 3, borderRadius: 8 }}>
            <button
              type="button"
              onClick={() => setInputMode('type')}
              style={{
                background: inputMode === 'type' ? 'var(--bg-surface-elevated)' : 'transparent',
                color: inputMode === 'type' ? 'var(--text-primary)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'inline',verticalAlign:'middle',marginRight:4}} aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10"/></svg> Type
            </button>
            <button
              type="button"
              onClick={() => setInputMode('voice')}
              style={{
                background: inputMode === 'voice' ? 'var(--bg-surface-elevated)' : 'transparent',
                color: inputMode === 'voice' ? 'var(--text-primary)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'inline',verticalAlign:'middle',marginRight:4}} aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg> Voice
            </button>
          </div>
        </div>

        <form onSubmit={handleSaveNote}>
          {/* Note Title */}
          <label className="input-label">Note Title (Optional)</label>
          <input
            type="text"
            className="input-field"
            placeholder={inputMode === 'type' ? 'e.g. Cross-examination pointers' : 'e.g. Client conference memo'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {/* Client Link (Optional) */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="input-label">Link Client (Optional)</label>
              <select
                className="input-field"
                value={selectedClientId}
                onChange={(e) => {
                  setSelectedClientId(e.target.value);
                  setSelectedMatterId('');
                }}
                style={{ margin: 0 }}
              >
                <option value="">-- General Note --</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Case Link (Optional) */}
            <div style={{ flex: 1 }}>
              <label className="input-label">Link Case (Optional)</label>
              <select
                className="input-field"
                value={selectedMatterId}
                onChange={(e) => setSelectedMatterId(e.target.value)}
                style={{ margin: 0 }}
              >
                <option value="">-- General Case --</option>
                {clientMatters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.matter_number}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Mode 1: Direct Typing */}
          {inputMode === 'type' && (
            <div>
              <label className="input-label">Note Content *</label>
              <textarea
                className="input-field"
                rows={5}
                placeholder="Type your notes, hearing points, statutory citations, or reminders…"
                required
                value={typedBody}
                onChange={(e) => setTypedBody(e.target.value)}
              />

              <button
                type="submit"
                className="action-btn action-btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Save Typed Note
              </button>
            </div>
          )}

          {/* Mode 2: Voice Recording */}
          {inputMode === 'voice' && (
            <div>
              <div
                style={{
                  backgroundColor: 'var(--bg-app)',
                  borderRadius: 10,
                  padding: 20,
                  textAlign: 'center',
                  marginBottom: 14,
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {recordingState === 'idle' && (
                  <div>
                    <button
                      type="button"
                      onClick={startRecording}
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: '50%',
                        backgroundColor: 'var(--status-danger)',
                        color: '#fff',
                        border: 'none',
                        fontSize: '1.6rem', // record button
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 12px rgba(239,83,80,0.4)',
                      }}
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                    </button>
                    <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: 10 }}>
                      Tap to record voice note
                    </div>
                  </div>
                )}

                {recordingState === 'recording' && (
                  <div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--status-danger)', marginBottom: 12 }}>
                      ⏺ {formatDuration(durationSec)}
                    </div>
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="action-btn"
                      style={{
                        backgroundColor: 'var(--status-danger)',
                        color: '#fff',
                        border: 'none',
                        margin: '0 auto',
                        padding: '10px 24px',
                      }}
                    >
                      Stop Recording
                    </button>
                  </div>
                )}

                {recordingState === 'recorded' && (
                  <div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--status-success)', fontWeight: 600, marginBottom: 8 }}>
                      ✓ Audio Recorded ({formatDuration(durationSec)})
                    </div>
                    {audioBlobUrl && (
                      <audio controls src={audioBlobUrl} style={{ width: '100%', maxWidth: 300, height: 36, margin: '8px 0' }} />
                    )}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 }}>
                      <button
                        type="button"
                        className="action-btn"
                        style={{ fontSize: '0.8rem' }}
                        onClick={resetRecording}
                      >
                        Discard & Re-record
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="action-btn action-btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={recordingState !== 'recorded'}
              >
                Save Voice Memo
              </button>
            </div>
          )}
        </form>
      </div>


      {/* ── Telugu Translation Utility ── */}
      <TranslatePanel />

      {/* ── Chronological Feed Filter & Search ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button
          type="button"
          className={`action-btn ${filterType === 'all' ? 'action-btn-primary' : ''}`}
          style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem', padding: '6px 0' }}
          onClick={() => setFilterType('all')}
        >
          All Notes ({notes.length})
        </button>
        <button
          type="button"
          className={`action-btn ${filterType === 'text' ? 'action-btn-primary' : ''}`}
          style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem', padding: '6px 0' }}
          onClick={() => setFilterType('text')}
        >
          Typed ({notes.filter((n) => n.entry_type === 'text').length})
        </button>
        <button
          type="button"
          className={`action-btn ${filterType === 'voice' ? 'action-btn-primary' : ''}`}
          style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem', padding: '6px 0' }}
          onClick={() => setFilterType('voice')}
        >
          Voice ({notes.filter((n) => n.entry_type === 'voice').length})
        </button>
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: 14 }}>
        <input
          type="text"
          className="input-field"
          placeholder="Search notes by title or keywords…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ margin: 0 }}
        />
      </div>

      {/* Case filter active notice */}
      {matterFilterParam && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--bg-surface-elevated)', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: '0.82rem' }}>
          <span>Filtered for case: <strong>{getMatterTitle(matterFilterParam)}</strong></span>
          <a href="/app/diary" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 600 }}>
            Clear ✕
          </a>
        </div>
      )}

      {/* ── Unified Chronological Feed ── */}
      {filteredNotes.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            {searchQuery
              ? 'No notes match your search.'
              : 'No notes yet. Type a note or record a voice memo above.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredNotes.map((note) => {
            const isVoice = note.entry_type === 'voice';
            const clientName = getClientName(note.client_id);
            const matterTitle = getMatterTitle(note.matter_id);

            return (
              <div key={note.id} className="card" style={{ marginBottom: 0 }}>
                {/* Header with Source Tag (Voice vs Typed) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 4,
                        backgroundColor: isVoice ? 'var(--status-danger-bg)' : 'var(--accent-primary-dim)',
                        color: isVoice ? 'var(--status-danger)' : 'var(--accent-primary)',
                        marginBottom: 4,
                      }}
                    >
                      {isVoice ? (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:4}} aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>Voice Memo</>) : (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:4}} aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10"/></svg>Typed Note</>)}
                    </span>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                      {note.title}
                    </div>
                  </div>

                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {formatDate(note.created_at)}
                  </span>
                </div>

                {/* Linked Client and Case Tags */}
                {(clientName || matterTitle) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {clientName && (
                      <span style={{ fontSize: '0.74rem', padding: '2px 8px', borderRadius: 4, backgroundColor: 'var(--bg-surface-elevated)', color: 'var(--text-secondary)' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'inline',verticalAlign:'middle',marginRight:3}} aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>{clientName}
                      </span>
                    )}
                    {matterTitle && (
                      <span style={{ fontSize: '0.74rem', padding: '2px 8px', borderRadius: 4, backgroundColor: 'var(--bg-surface-elevated)', color: 'var(--text-secondary)' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:'inline',verticalAlign:'middle',marginRight:3}} aria-hidden="true"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21H17"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>{matterTitle}
                      </span>
                    )}
                  </div>
                )}

                {/* Content / Transcript */}
                <p style={{ fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: 10 }}>
                  {note.content}
                </p>

                {/* Voice Player (if voice memo) */}
                {isVoice && note.audio_url && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, backgroundColor: 'var(--bg-app)', padding: '6px 12px', borderRadius: 8, marginBottom: 10 }}>
                    <button
                      type="button"
                      onClick={() => handlePlayVoice(note.id, note.audio_url)}
                      style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '1.2rem',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      {playingNoteId === note.id ? (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>) : (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>)}
                    </button>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {playingNoteId === note.id ? 'Playing audio…' : `Audio Recording (${formatDuration(note.duration_seconds || 0)})`}
                    </span>
                  </div>
                )}

                {/* Action Footer */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
                  <button
                    type="button"
                    onClick={() => deleteUnifiedNote(note.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--status-danger)', fontSize: '0.78rem', cursor: 'pointer' }}
                  >
                    Delete Note
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function UnifiedNotesPage() {
  return (
    <Suspense fallback={<div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading unified notes…</div>}>
      <UnifiedNotesContent />
    </Suspense>
  );
}
