'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/context';
import {
  loadUnifiedNotes,
  createUnifiedNote,
  deleteUnifiedNote,
  updateUnifiedNote,
  loadClients,
  loadMatters,
} from '@/lib/data/repository';
import type { DiaryEntry, Client, Matter } from '@/lib/types/database';
import {
  BookOpen,
  Edit3,
  Mic,
  Square,
  Play,
  Pause,
  Trash2,
  Check,
  X,
  Languages,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  FileText,
  Volume2,
  Sparkles,
  History,
} from 'lucide-react';

type InputMode = 'type' | 'voice';

function UnifiedNotesContent() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const matterFilterParam = searchParams.get('matter');

  const [notes, setNotes] = useState<DiaryEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);

  // Selected Diary Date (Defaults to Today)
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Input Mode: 'type' vs 'voice'
  const [inputMode, setInputMode] = useState<InputMode>('type');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'voice' | 'text'>('all');

  // New Entry Fields
  const [title, setTitle] = useState('');
  const [typedBody, setTypedBody] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedMatterId, setSelectedMatterId] = useState(matterFilterParam || '');

  // Translation Panel (inside Diary)
  const [translateOpen, setTranslateOpen] = useState(false);
  const [translateSourceLang, setTranslateSourceLang] = useState<'te' | 'hi' | 'en'>('te');
  const [translateTargetLang, setTranslateTargetLang] = useState<'en' | 'te' | 'hi'>('en');
  const [translateInput, setTranslateInput] = useState('');
  const [translateResult, setTranslateResult] = useState('');
  const [translating, setTranslating] = useState(false);

  // Edit Note State (Written notes & Voice transcripts)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editType, setEditType] = useState<'text' | 'voice'>('text');
  const [viewingOriginalTranscriptId, setViewingOriginalTranscriptId] = useState<string | null>(null);

  // Voice Recording states
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'recorded'>('idle');
  const [durationSec, setDurationSec] = useState(0);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

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

  const clientMatters = selectedClientId
    ? matters.filter((m) => m.client_id === selectedClientId)
    : matters;

  // ── Date Navigation ──────────────────────────────────────────────────────────
  const handlePrevDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    setSelectedDate(prev);
  };

  const handleNextDay = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    setSelectedDate(next);
  };

  const handleToday = () => {
    setSelectedDate(new Date());
  };

  const formattedDayOfWeek = selectedDate.toLocaleDateString('en-IN', { weekday: 'long' }).toUpperCase();
  const formattedDayNum = selectedDate.toLocaleDateString('en-IN', { day: '2-digit' });
  const formattedMonthYear = selectedDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }).toUpperCase();
  const dateKey = selectedDate.toISOString().slice(0, 10);
  const isToday = new Date().toISOString().slice(0, 10) === dateKey;

  // Filter notes by date (or search)
  const filteredNotes = notes.filter((n) => {
    const noteDate = (n.created_at || '').slice(0, 10);
    const matchesDate = noteDate === dateKey;
    const matchesFilter = filterType === 'all' || n.entry_type === filterType;
    const matchesSearch = !searchQuery.trim() ||
      (n.title && n.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (n.content && n.content.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesDate && matchesFilter && matchesSearch;
  });

  // ── Voice Recording Logic ───────────────────────────────────────────────────
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

      mr.start();
      setRecordingState('recording');
      startTimer();
    } catch {
      alert('Microphone access denied or unavailable.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recordingState === 'recording') {
      mediaRecorderRef.current.stop();
      stopTimer();
    }
  };

  const discardRecording = () => {
    stopTimer();
    if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
    setAudioBlob(null);
    setAudioBlobUrl(null);
    setDurationSec(0);
    setRecordingState('idle');
  };

  // ── Save Voice Entry ────────────────────────────────────────────────────────
  const handleSaveVoice = () => {
    if (!audioBlobUrl) return;

    const initialTranscript = typedBody.trim() || 'Voice dictation recorded.';
    createUnifiedNote({
      client_id: selectedClientId || null,
      matter_id: selectedMatterId || null,
      entry_type: 'voice',
      title: title.trim() || `Voice Memo (${formattedDayOfWeek})`,
      content: initialTranscript,
      transcript: initialTranscript,
      original_transcript: initialTranscript,
      audio_url: audioBlobUrl,
      duration_seconds: durationSec,
      language: 'en',
    });

    // Reset fields
    setTitle('');
    setTypedBody('');
    discardRecording();
    refreshData();
  };

  // ── Save Typed Note ─────────────────────────────────────────────────────────
  const handleSaveTyped = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedBody.trim()) return;

    createUnifiedNote({
      client_id: selectedClientId || null,
      matter_id: selectedMatterId || null,
      entry_type: 'text',
      title: title.trim() || `Diary Entry (${formattedDayOfWeek})`,
      content: typedBody.trim(),
      language: 'en',
    });

    setTitle('');
    setTypedBody('');
    refreshData();
  };

  // ── Edit Note Logic (Written notes AND Voice Transcripts) ────────────────────
  const startEditing = (note: DiaryEntry) => {
    setEditingNoteId(note.id);
    setEditTitle(note.title || '');
    setEditContent(note.content || note.transcript || '');
    setEditType(note.entry_type);
  };

  const cancelEditing = () => {
    setEditingNoteId(null);
    setEditTitle('');
    setEditContent('');
  };

  const saveEditing = (note: DiaryEntry) => {
    if (!editContent.trim()) return;

    if (note.entry_type === 'voice') {
      // Voice Note Editing: Preserve original audio URL and original transcript
      const originalTranscript = note.original_transcript || note.transcript || note.content || '';
      updateUnifiedNote(note.id, {
        title: editTitle.trim() || note.title,
        content: editContent.trim(),
        transcript: editContent.trim(),
        original_transcript: originalTranscript,
        edited_transcript: editContent.trim(),
        transcript_edited_at: new Date().toISOString(),
      });
    } else {
      // Written Note Editing
      updateUnifiedNote(note.id, {
        title: editTitle.trim() || note.title,
        content: editContent.trim(),
      });
    }

    cancelEditing();
    refreshData();
  };

  // ── Translation Workflow ───────────────────────────────────────────────────
  const handleTranslate = async () => {
    if (!translateInput.trim()) return;
    setTranslating(true);
    setTranslateResult('');

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: translateInput.trim(),
          source_lang: translateSourceLang,
          target_lang: translateTargetLang,
        }),
      });

      const data = await res.json();
      if (res.ok && data.translated_text) {
        setTranslateResult(data.translated_text);
      } else {
        setTranslateResult(data.error || 'Translation failed.');
      }
    } catch {
      setTranslateResult('Translation service unavailable.');
    } finally {
      setTranslating(false);
    }
  };

  const appendTranslationToNote = () => {
    if (!translateResult) return;
    const formatted = `\n\n[Translation (${translateSourceLang.toUpperCase()} → ${translateTargetLang.toUpperCase()})]:\n${translateResult}`;
    setTypedBody((prev) => (prev ? prev + formatted : translateResult));
    setTranslateOpen(false);
  };

  // ── Audio Playback ──────────────────────────────────────────────────────────
  const togglePlayAudio = (noteId: string, url?: string | null) => {
    if (!url) return;

    if (playingNoteId === noteId) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      setPlayingNoteId(null);
    } else {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      const audio = new Audio(url);
      audioPlayerRef.current = audio;
      audio.onended = () => setPlayingNoteId(null);
      audio.play();
      setPlayingNoteId(noteId);
    }
  };

  const formatSec = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div style={{ paddingBottom: 64 }}>
      {/* ── Diary Notebook Cover & Header ── */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 20,
        border: '1px solid var(--border-subtle)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        overflow: 'hidden',
        marginBottom: 20,
      }}>
        {/* Notebook Top Leather Binding Strip */}
        <div style={{
          background: 'linear-gradient(90deg, #8a5a22, #b8860b, #8a5a22)',
          height: 8,
          width: '100%',
        }} />

        {/* Diary Page Header */}
        <div style={{
          padding: '20px 20px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BookOpen size={20} color="var(--accent-gold, #c8a03c)" />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent-gold, #c8a03c)', textTransform: 'uppercase' }}>
                Advocate&apos;s Legal Diary
              </span>
            </div>

            {/* Translation Bookmark Button */}
            <button
              type="button"
              onClick={() => setTranslateOpen(!translateOpen)}
              className="action-btn"
              style={{
                fontSize: '0.8rem',
                padding: '6px 12px',
                gap: 6,
                borderColor: translateOpen ? 'var(--accent-primary)' : 'var(--border-subtle)',
                color: translateOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
              }}
            >
              <Languages size={15} />
              <span>Translate</span>
            </button>
          </div>

          {/* Date Stamp & Navigation Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-surface-elevated)',
            borderRadius: 14,
            padding: '12px 14px',
          }}>
            <button
              type="button"
              onClick={handlePrevDay}
              aria-label="Previous day"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: 6,
              }}
            >
              <ChevronLeft size={22} />
            </button>

            {/* Big Prominent Date Header */}
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '0.76rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                color: 'var(--accent-primary)',
              }}>
                {formattedDayOfWeek}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'serif', lineHeight: 1, color: 'var(--text-primary)' }}>
                  {formattedDayNum}
                </span>
                <span style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
                  {formattedMonthYear}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {!isToday && (
                <button
                  type="button"
                  onClick={handleToday}
                  style={{
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    padding: '4px 8px',
                    borderRadius: 6,
                    background: 'var(--accent-primary)',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Today
                </button>
              )}
              <button
                type="button"
                onClick={handleNextDay}
                aria-label="Next day"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 6,
                }}
              >
                <ChevronRight size={22} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Collapsible Translate Panel (Inside Diary Workflow) ── */}
        {translateOpen && (
          <div style={{
            background: 'var(--bg-surface-elevated)',
            borderBottom: '1px solid var(--border-subtle)',
            padding: '16px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Languages size={16} color="var(--accent-primary)" />
                <span>Bidirectional Legal Translation</span>
              </div>
              <button
                type="button"
                onClick={() => setTranslateOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                <label className="input-label" style={{ fontSize: '0.75rem' }}>From Language</label>
                <select
                  className="input-field"
                  style={{ fontSize: '0.82rem', padding: '6px 8px' }}
                  value={translateSourceLang}
                  onChange={(e) => setTranslateSourceLang(e.target.value as any)}
                >
                  <option value="te">తెలుగు (Telugu)</option>
                  <option value="hi">हिन्दी (Hindi)</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div>
                <label className="input-label" style={{ fontSize: '0.75rem' }}>To Language</label>
                <select
                  className="input-field"
                  style={{ fontSize: '0.82rem', padding: '6px 8px' }}
                  value={translateTargetLang}
                  onChange={(e) => setTranslateTargetLang(e.target.value as any)}
                >
                  <option value="en">English</option>
                  <option value="te">తెలుగు (Telugu)</option>
                  <option value="hi">हिन्दी (Hindi)</option>
                </select>
              </div>
            </div>

            <textarea
              className="input-field"
              rows={2}
              placeholder="Enter text to translate…"
              value={translateInput}
              onChange={(e) => setTranslateInput(e.target.value)}
              style={{ fontSize: '0.85rem', marginBottom: 8 }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleTranslate}
                className="action-btn action-btn-primary"
                style={{ flex: 1, justifyContent: 'center', fontSize: '0.82rem', padding: '8px 12px' }}
                disabled={translating || !translateInput.trim()}
              >
                {translating ? 'Translating…' : 'Translate Text'}
              </button>
              {translateResult && (
                <button
                  type="button"
                  onClick={appendTranslationToNote}
                  className="action-btn"
                  style={{ fontSize: '0.82rem', padding: '8px 12px' }}
                >
                  Insert into Note ↓
                </button>
              )}
            </div>

            {translateResult && (
              <div style={{
                marginTop: 10,
                padding: '10px 12px',
                background: 'var(--bg-app)',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                fontSize: '0.85rem',
                lineHeight: 1.4,
              }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>Translation Result:</div>
                {translateResult}
              </div>
            )}
          </div>
        )}

        {/* ── Diary Notebook Entry Workspace ── */}
        <div style={{ padding: '16px 20px' }}>
          {/* Mode Switcher */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => setInputMode('type')}
              className={`action-btn ${inputMode === 'type' ? 'action-btn-primary' : ''}`}
              style={{ flex: 1, justifyContent: 'center', fontSize: '0.85rem', gap: 6 }}
            >
              <FileText size={16} />
              <span>Written Entry</span>
            </button>
            <button
              type="button"
              onClick={() => setInputMode('voice')}
              className={`action-btn ${inputMode === 'voice' ? 'action-btn-primary' : ''}`}
              style={{ flex: 1, justifyContent: 'center', fontSize: '0.85rem', gap: 6 }}
            >
              <Mic size={16} />
              <span>Voice Dictation</span>
            </button>
          </div>

          {/* Client / Case Selectors */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <select
              className="input-field"
              style={{ fontSize: '0.82rem', padding: '6px 8px' }}
              value={selectedClientId}
              onChange={(e) => {
                setSelectedClientId(e.target.value);
                setSelectedMatterId('');
              }}
            >
              <option value="">General (No Client)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <select
              className="input-field"
              style={{ fontSize: '0.82rem', padding: '6px 8px' }}
              value={selectedMatterId}
              onChange={(e) => setSelectedMatterId(e.target.value)}
            >
              <option value="">Case / Matter (Optional)</option>
              {clientMatters.map((m) => (
                <option key={m.id} value={m.id}>{m.title || m.matter_number}</option>
              ))}
            </select>
          </div>

          <input
            type="text"
            className="input-field"
            placeholder="Docket Title / Court Hearing Reference…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 10 }}
          />

          {/* Type Mode */}
          {inputMode === 'type' && (
            <form onSubmit={handleSaveTyped}>
              <div style={{
                position: 'relative',
                borderLeft: '2px solid rgba(220, 38, 38, 0.45)',
                paddingLeft: 12,
                marginBottom: 12,
              }}>
                <textarea
                  className="input-field"
                  rows={4}
                  placeholder="Record today's proceedings, daily case observations, or notes…"
                  value={typedBody}
                  onChange={(e) => setTypedBody(e.target.value)}
                  style={{
                    lineHeight: '28px',
                    fontSize: '0.92rem',
                    background: 'transparent',
                  }}
                />
              </div>

              <button
                type="submit"
                className="action-btn action-btn-primary"
                style={{ width: '100%', justifyContent: 'center', fontSize: '0.9rem', padding: '10px 0' }}
                disabled={!typedBody.trim()}
              >
                Record in Daily Diary →
              </button>
            </form>
          )}

          {/* Voice Dictation Mode */}
          {inputMode === 'voice' && (
            <div>
              <div style={{
                background: 'var(--bg-surface-elevated)',
                borderRadius: 14,
                padding: '16px 14px',
                textAlign: 'center',
                marginBottom: 12,
              }}>
                {recordingState === 'idle' && (
                  <div>
                    <button
                      type="button"
                      onClick={startRecording}
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: '50%',
                        background: 'var(--status-danger)',
                        color: '#fff',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 8px',
                        cursor: 'pointer',
                        boxShadow: '0 4px 12px rgba(220, 38, 38, 0.3)',
                      }}
                    >
                      <Mic size={24} />
                    </button>
                    <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                      Tap to record voice entry
                    </div>
                  </div>
                )}

                {recordingState === 'recording' && (
                  <div>
                    <button
                      type="button"
                      onClick={stopRecording}
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: '50%',
                        background: 'var(--status-danger)',
                        color: '#fff',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 8px',
                        cursor: 'pointer',
                      }}
                    >
                      <Square size={20} />
                    </button>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--status-danger)' }}>
                      Recording: {formatSec(durationSec)}
                    </div>
                  </div>
                )}

                {recordingState === 'recorded' && (
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--status-success)', marginBottom: 8 }}>
                      Dictation recorded ({formatSec(durationSec)})
                    </div>
                    <audio src={audioBlobUrl || undefined} controls style={{ width: '100%', height: 36, marginBottom: 8 }} />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                      <button
                        type="button"
                        onClick={discardRecording}
                        className="action-btn"
                        style={{ fontSize: '0.78rem', color: 'var(--status-danger)' }}
                      >
                        <Trash2 size={14} /> Discard
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Optional text or transcript note alongside audio */}
              <textarea
                className="input-field"
                rows={2}
                placeholder="Add initial notes or keywords for this recording…"
                value={typedBody}
                onChange={(e) => setTypedBody(e.target.value)}
                style={{ fontSize: '0.85rem', marginBottom: 12 }}
              />

              <button
                type="button"
                onClick={handleSaveVoice}
                className="action-btn action-btn-primary"
                style={{ width: '100%', justifyContent: 'center', fontSize: '0.9rem', padding: '10px 0' }}
                disabled={recordingState !== 'recorded'}
              >
                Save Voice Entry to Diary →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Ruled Lined Notebook Entries Feed ── */}
      <div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
            Entries for {formattedDayNum} {formattedMonthYear} ({filteredNotes.length})
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'text', 'voice'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilterType(f)}
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 12,
                  border: filterType === f ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  background: filterType === f ? 'var(--accent-primary)' : 'var(--bg-card)',
                  color: filterType === f ? '#fff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {filteredNotes.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 16,
            border: '1px solid var(--border-subtle)',
            padding: '32px 16px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.88rem',
          }}>
            No diary entries recorded for {selectedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {filteredNotes.map((note) => {
              const isEditing = editingNoteId === note.id;
              const isVoice = note.entry_type === 'voice';
              const isPlaying = playingNoteId === note.id;
              const hasEditedTranscript = Boolean(note.edited_transcript);
              const showingOriginal = viewingOriginalTranscriptId === note.id;

              return (
                <div
                  key={note.id}
                  style={{
                    background: 'var(--bg-card)',
                    borderRadius: 16,
                    border: '1px solid var(--border-subtle)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  {/* Notebook Left Red Margin Line */}
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 36,
                    width: 2,
                    background: 'rgba(220, 38, 38, 0.35)',
                    pointerEvents: 'none',
                  }} />

                  <div style={{ padding: '16px 16px 14px 48px' }}>
                    {/* Header Row */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div>
                        {isEditing ? (
                          <input
                            type="text"
                            className="input-field"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            style={{ fontSize: '0.95rem', fontWeight: 700, padding: '4px 8px', marginBottom: 6 }}
                          />
                        ) : (
                          <div style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {note.title}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          <Clock size={12} />
                          <span>{new Date(note.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                          {isVoice && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--accent-primary)', fontWeight: 600 }}>
                              • <Mic size={12} /> Voice Entry {note.duration_seconds ? `(${formatSec(note.duration_seconds)})` : ''}
                            </span>
                          )}
                          {note.updated_at && note.updated_at !== note.created_at && (
                            <span style={{ color: 'var(--text-muted)' }}>• Edited</span>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => startEditing(note)}
                            title={isVoice ? 'Edit Transcript' : 'Edit Note'}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              padding: 4,
                            }}
                          >
                            <Edit3 size={16} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm('Delete this diary entry?')) {
                              deleteUnifiedNote(note.id);
                              refreshData();
                            }
                          }}
                          title="Delete Entry"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 4,
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    {/* Audio Player for Voice Entries (Immutable Audio) */}
                    {isVoice && note.audio_url && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        background: 'var(--bg-surface-elevated)',
                        borderRadius: 10,
                        margin: '8px 0 10px',
                      }}>
                        <button
                          type="button"
                          onClick={() => togglePlayAudio(note.id, note.audio_url)}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: 'var(--accent-primary)',
                            color: '#fff',
                            border: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Original Audio Recording (Preserved)
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {isPlaying ? 'Playing dictation…' : 'Tap to listen to original audio'}
                          </div>
                        </div>
                        <Volume2 size={16} color="var(--text-muted)" />
                      </div>
                    )}

                    {/* Content / Transcript */}
                    {isEditing ? (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                          {isVoice ? 'Edit Transcript (Original audio remains preserved):' : 'Edit Note Content:'}
                        </div>
                        <textarea
                          className="input-field"
                          rows={4}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          style={{ lineHeight: '26px', fontSize: '0.9rem', marginBottom: 8 }}
                        />
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={cancelEditing}
                            className="action-btn"
                            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                          >
                            <X size={14} /> Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => saveEditing(note)}
                            className="action-btn action-btn-primary"
                            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                          >
                            <Check size={14} /> Save Changes
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        lineHeight: '26px',
                        fontSize: '0.9rem',
                        color: 'var(--text-primary)',
                        whiteSpace: 'pre-wrap',
                      }}>
                        {showingOriginal && note.original_transcript ? (
                          <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-gold, #c8a03c)', marginBottom: 4 }}>
                              [ORIGINAL UNEDITED TRANSCRIPT]:
                            </div>
                            {note.original_transcript}
                          </div>
                        ) : (
                          note.content
                        )}

                        {/* Version Toggle for Edited Voice Transcripts */}
                        {isVoice && hasEditedTranscript && (
                          <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              Transcript edited • Audio intact
                            </span>
                            <button
                              type="button"
                              onClick={() => setViewingOriginalTranscriptId(showingOriginal ? null : note.id)}
                              style={{
                                background: 'none',
                                border: 'none',
                                fontSize: '0.75rem',
                                color: 'var(--accent-primary)',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <History size={12} />
                              <span>{showingOriginal ? 'Show Edited Transcript' : 'View Original Transcript'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DiaryPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading Advocate Diary…</div>}>
      <UnifiedNotesContent />
    </Suspense>
  );
}
