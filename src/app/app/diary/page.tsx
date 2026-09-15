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
import { extractSelectablePdfText } from '@/lib/ocr/localOcr';
import { encodeToWav } from '@/lib/audio/wavEncoder';
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
  Camera,
  Type as TypeIcon,
  Upload,
} from 'lucide-react';

function UnifiedNotesContent() {
  const searchParams = useSearchParams();
  const matterFilterParam = searchParams.get('matter');

  const [notes, setNotes] = useState<DiaryEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);

  // Selected Diary Date (Defaults to Today)
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'voice' | 'text'>('all');

  // New Entry Fields
  const [title, setTitle] = useState('');
  const [typedBody, setTypedBody] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedMatterId, setSelectedMatterId] = useState(matterFilterParam || '');

  // Translation Panel (inside Diary)
  const [translateOpen, setTranslateOpen] = useState(false);
  const [translateMode, setTranslateMode] = useState<'text' | 'scan'>('text');
  const [translateSourceLang, setTranslateSourceLang] = useState<'te' | 'hi' | 'en'>('te');
  const [translateTargetLang, setTranslateTargetLang] = useState<'en' | 'te' | 'hi'>('en');
  const [translateInput, setTranslateInput] = useState('');
  const [translateResult, setTranslateResult] = useState('');
  const [translating, setTranslating] = useState(false);

  // Document Scan (Telugu → English) state
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanExtracted, setScanExtracted] = useState('');
  const [scanWarning, setScanWarning] = useState('');
  const scanInputRef = useRef<HTMLInputElement | null>(null);

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

  // Sarvam STT — explicit transcription state
  const [sttLang, setSttLang] = useState<'unknown' | 'te-IN' | 'hi-IN' | 'en-IN'>('unknown');
  const [transcribing, setTranscribing] = useState(false);
  const [sttDraft, setSttDraft] = useState('');
  const [sttError, setSttError] = useState('');

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
    setSttDraft('');
    setSttError('');
  };

  // ── Sarvam STT: explicit transcribe action ─────────────────────────────────
  const transcribeVoiceMemo = async () => {
    if (!audioBlob) return;
    setTranscribing(true);
    setSttError('');
    setSttDraft('');

    try {
      // Convert any browser-recorded audio (WebM/Opus, OGG) to genuine 16-bit PCM WAV.
      // Sarvam STT rejects "audio/webm;codecs=opus" — we must produce a real WAV.
      // The original audioBlob is kept untouched for playback.
      let audioToSend: Blob = audioBlob;

      if (audioBlob.type !== 'audio/wav' && audioBlob.type !== 'audio/wave') {
        try {
          audioToSend = await encodeToWav(audioBlob);
        } catch (convErr) {
          setSttError(convErr instanceof Error ? convErr.message : 'Could not convert the recording to WAV.');
          return;
        }
      }

      const form = new FormData();
      form.append('file', audioToSend, 'recording.wav');
      form.append('language_code', sttLang);
      form.append('mode', 'codemix');

      const res = await fetch('/api/voice/transcribe', { method: 'POST', body: form });
      const data = await res.json();

      if (res.ok && data.transcript) {
        setSttDraft(data.transcript);
      } else {
        const code = data.code ? ` [${data.code}]` : '';
        setSttError((data.error || 'Transcription failed. Please try again.') + code);
      }
    } catch {
      setSttError('Could not reach the transcription service. Check your connection.');
    } finally {
      setTranscribing(false);
    }
  };

  const insertSttDraftIntoNote = () => {
    if (!sttDraft.trim()) return;
    setTypedBody((prev) => (prev ? `${prev}\n\n${sttDraft.trim()}` : sttDraft.trim()));
    setSttDraft('');
    setSttError('');
  };

  // ── Unified Save (Written notes & Voice notes together) ─────────────────────
  const handleSaveEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const body = typedBody.trim();
    if (!body && !audioBlobUrl) return;

    const isVoice = !!audioBlobUrl;
    const initialContent = body || (isVoice ? 'Voice dictation recorded.' : '');
    createUnifiedNote({
      client_id: selectedClientId || null,
      matter_id: selectedMatterId || null,
      entry_type: isVoice ? 'voice' : 'text',
      title: title.trim() || `${isVoice ? 'Voice Memo' : 'Diary Entry'} (${formattedDayOfWeek})`,
      content: initialContent,
      transcript: initialContent,
      original_transcript: initialContent,
      audio_url: audioBlobUrl || null,
      duration_seconds: durationSec || null,
      language: 'en',
    });

    setTitle('');
    setTypedBody('');
    discardRecording();
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
    // Build a clean two block insert: the source text and the translated text,
    // labelled by human friendly language names. No wrappers, no notices.
    const langName: Record<string, string> = { te: 'Telugu', hi: 'Hindi', en: 'English' };
    const fromLabel = langName[translateSourceLang] || translateSourceLang.toUpperCase();
    const toLabel = langName[translateTargetLang] || translateTargetLang.toUpperCase();
    // Prefer scanned original if available (scan mode), otherwise the text the user typed.
    const original = (scanExtracted.trim() || translateInput.trim());
    const parts: string[] = [];
    if (original) parts.push(`${fromLabel}:\n${original}`);
    parts.push(`${toLabel}:\n${translateResult.trim()}`);
    const block = parts.join('\n\n');
    setTypedBody((prev) => (prev ? `${prev}\n\n${block}` : block));
    setTranslateOpen(false);
  };

  // ── Document Scan → OCR → Translate ────────────────────────────────────────
  const resetScan = () => {
    if (scanPreviewUrl) URL.revokeObjectURL(scanPreviewUrl);
    setScanFile(null);
    setScanPreviewUrl(null);
    setScanExtracted('');
    setScanWarning('');
    setTranslateResult('');
    if (scanInputRef.current) scanInputRef.current.value = '';
  };

  const handleScanPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (scanPreviewUrl) URL.revokeObjectURL(scanPreviewUrl);
    setScanFile(file);
    setScanPreviewUrl(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    setScanExtracted('');
    setScanWarning('');
    setTranslateResult('');
  };

  // Read a File into a data URL — used to send scanned pages to the server
  // enhanced OCR route when on-device OCR can't read the image (typical on
  // desktop Chrome / Safari, where TextDetector API is unavailable).
  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsDataURL(file);
    });

  const runSarvamDocAiOcr = async (
    file: File,
    sourceLang: string,
  ): Promise<{ text: string; warning?: string } | { text: ''; error: string; retryable?: boolean }> => {
    try {
      const form = new FormData();
      form.append('consent', 'true');
      form.append('file', file, file.name);
      // Pass the selected source language so Sarvam Document AI knows the script
      if (sourceLang) form.append('language', sourceLang);
      if (selectedMatterId) form.append('matterId', selectedMatterId);

      const res = await fetch('/api/ocr/enhanced', {
        method: 'POST',
        body: form,
      });

      const data = await res.json();
      if (!res.ok || !data.text) {
        // Include error code in message for debugging visibility (safe — no secrets exposed)
        const code = data.code ? ` [${data.code}]` : '';
        return {
          text: '',
          error: (data.error || 'Sarvam Document AI extraction failed. Please try again.') + code,
          retryable: data.retryable ?? true,
        };
      }

      return {
        text: String(data.text).trim(),
        warning: data.warning || '✦ Sarvam Document AI Draft — review against original document before use.',
      };
    } catch (err) {
      return {
        text: '',
        error: err instanceof Error ? err.message : 'Document AI connection failed. Check your network.',
        retryable: true,
      };
    }
  };

  const handleScanAndTranslate = async () => {
    if (!scanFile) return;
    setScanning(true);
    setScanWarning('');
    setTranslateResult('');

    try {
      let extracted = '';
      let ocrNotice = '';

      // 1. If PDF has selectable machine-readable text, extract locally and skip OCR
      const selectableText = await extractSelectablePdfText(scanFile);
      if (selectableText) {
        extracted = selectableText.trim();
        ocrNotice = 'Selectable text extracted directly from document byte stream (lossless). Review for formatting.';
      } else {
        // 2. Scanned image or scanned PDF: send directly to Sarvam Document AI with language hint
        const serverResult = await runSarvamDocAiOcr(scanFile, translateSourceLang);
        if (serverResult.text) {
          extracted = serverResult.text;
          ocrNotice = ('warning' in serverResult ? serverResult.warning : undefined) || '✦ Sarvam Document AI Draft — review against original document before use.';
        } else if ('error' in serverResult && serverResult.error) {
          setScanExtracted('');
          setScanWarning(serverResult.error);
          return;
        }
      }

      setScanExtracted(extracted);
      if (ocrNotice) setScanWarning(ocrNotice);

      if (!extracted) {
        setScanWarning('No text could be extracted from this document. Please try a clearer scan or type the text.');
        return;
      }

      // 3. Auto-translate the extracted text via chunked Sarvam translate
      setTranslating(true);
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: extracted,
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
    } catch (err) {
      setScanWarning(err instanceof Error ? err.message : 'Scan processing failed. Please try again.');
    } finally {
      setScanning(false);
      setTranslating(false);
    }
  };

  const translateExtractedText = async () => {
    if (!scanExtracted.trim()) return;
    setTranslating(true);
    setTranslateResult('');
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: scanExtracted.trim(),
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
                justifyContent: 'center',
                padding: 8,
                borderRadius: 8,
              }}
            >
              <ChevronLeft size={24} />
            </button>

            {/* Big Prominent Date Header */}
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
              {!isToday && (
                <button
                  type="button"
                  onClick={handleToday}
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '3px 10px',
                    borderRadius: 12,
                    background: 'var(--accent-primary)',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    marginTop: 6,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  Jump to Today
                </button>
              )}
            </div>

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
                justifyContent: 'center',
                padding: 8,
                borderRadius: 8,
              }}
            >
              <ChevronRight size={24} />
            </button>
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

            {/* Mode toggle: Type text vs Scan a document. Made prominent so both
                input methods are obviously available at a glance. */}
            <div style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                marginBottom: 6,
              }}>
                Choose input method
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
              }}>
                <button
                  type="button"
                  onClick={() => setTranslateMode('text')}
                  aria-pressed={translateMode === 'text'}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: '14px 10px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    border: translateMode === 'text'
                      ? '2px solid var(--accent-primary)'
                      : '2px solid var(--border-subtle)',
                    background: translateMode === 'text'
                      ? 'var(--accent-primary-dim)'
                      : 'var(--bg-app)',
                    color: translateMode === 'text'
                      ? 'var(--accent-primary)'
                      : 'var(--text-primary)',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <TypeIcon size={22} />
                  <span>Type Text</span>
                  <span style={{ fontSize: '0.68rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                    Paste or type
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setTranslateMode('scan')}
                  aria-pressed={translateMode === 'scan'}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: '14px 10px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    border: translateMode === 'scan'
                      ? '2px solid var(--accent-primary)'
                      : '2px solid var(--border-subtle)',
                    background: translateMode === 'scan'
                      ? 'var(--accent-primary-dim)'
                      : 'var(--bg-app)',
                    color: translateMode === 'scan'
                      ? 'var(--accent-primary)'
                      : 'var(--text-primary)',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Camera size={22} />
                  <span>Scan Document</span>
                  <span style={{ fontSize: '0.68rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                    Photo or PDF
                  </span>
                </button>
              </div>
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

            {/* ── Mode: Type text ── */}
            {translateMode === 'text' && (
              <>
                <textarea
                  className="input-field"
                  rows={3}
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
              </>
            )}

            {/* ── Mode: Scan document ── */}
            {translateMode === 'scan' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  ref={scanInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  onChange={handleScanPick}
                  style={{ display: 'none' }}
                />

                {!scanFile ? (
                  <>
                    <button
                      type="button"
                      onClick={() => scanInputRef.current?.click()}
                      className="action-btn"
                      style={{
                        justifyContent: 'center',
                        fontSize: '0.85rem',
                        padding: '18px 12px',
                        gap: 8,
                        border: '1px dashed var(--border-strong)',
                        background: 'var(--bg-app)',
                      }}
                    >
                      <Upload size={16} />
                      <span>Take a photo or upload a Telugu document</span>
                    </button>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
                      Scanned images and PDFs are digitized accurately using Sarvam Document AI
                      (Sarvam Vision 1.5). Text-based PDFs with selectable text are extracted directly.
                      All extracted drafts require advocate review.
                    </p>
                  </>
                ) : (
                  <div style={{
                    padding: 10,
                    borderRadius: 10,
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}>
                    {scanPreviewUrl ? (
                      <img
                        src={scanPreviewUrl}
                        alt="Scanned document preview"
                        style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                      />
                    ) : (
                      <div style={{
                        width: 56, height: 56, borderRadius: 6, background: 'var(--bg-surface-elevated)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <FileText size={22} color="var(--text-muted)" />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {scanFile.name}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {(scanFile.size / 1024).toFixed(0)} KB
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={resetScan}
                      title="Remove"
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleScanAndTranslate}
                    className="action-btn action-btn-primary"
                    style={{ flex: 1, justifyContent: 'center', fontSize: '0.82rem', padding: '8px 12px' }}
                    disabled={!scanFile || scanning || translating}
                  >
                    {scanning ? 'Scanning…' : translating ? 'Translating…' : 'Extract & Translate'}
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

                {scanWarning && (
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'rgba(255, 213, 79, 0.12)',
                    border: '1px solid rgba(255, 213, 79, 0.25)',
                    color: 'var(--status-warning, #b8860b)',
                    fontSize: '0.76rem',
                    lineHeight: 1.4,
                  }}>
                    {scanWarning}
                  </div>
                )}

                {scanExtracted && (
                  <div>
                    <label className="input-label" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Extracted original text (editable)</span>
                      <button
                        type="button"
                        onClick={translateExtractedText}
                        disabled={translating}
                        style={{
                          background: 'none', border: 'none', color: 'var(--accent-primary)',
                          fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', padding: 0,
                        }}
                      >
                        {translating ? 'Re-translating…' : 'Re-translate'}
                      </button>
                    </label>
                    <textarea
                      className="input-field"
                      rows={4}
                      value={scanExtracted}
                      onChange={(e) => setScanExtracted(e.target.value)}
                      style={{ fontSize: '0.85rem' }}
                    />
                  </div>
                )}
              </div>
            )}

            {translateResult && (
              <div style={{
                marginTop: 10,
                padding: '10px 12px',
                background: 'var(--bg-app)',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                fontSize: '0.85rem',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
              }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  Translation Result ({translateTargetLang.toUpperCase()}):
                </div>
                {translateResult}
              </div>
            )}
          </div>
        )}

        {/* ── Diary Notebook Entry Workspace ── */}
        <div style={{ padding: '16px 20px' }}>
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
            style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 12 }}
          />

          {/* Unified Journal Canvas Form */}
          <form onSubmit={handleSaveEntry}>
            <div style={{
              position: 'relative',
              borderLeft: '2px solid rgba(220, 38, 38, 0.45)',
              paddingLeft: 12,
              marginBottom: 12,
            }}>
              <textarea
                className="input-field"
                rows={14}
                placeholder="Write today's proceedings, case observations, ideas, or paste anything you want to save. Tap the mic to dictate."
                value={typedBody}
                onChange={(e) => {
                  setTypedBody(e.target.value);
                  // Auto-grow the canvas as you type (never shrinks below its base height)
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = Math.max(el.scrollHeight, 380) + 'px';
                }}
                style={{
                  lineHeight: '28px',
                  fontSize: '0.95rem',
                  background: 'transparent',
                  paddingRight: 48,
                  minHeight: 380,
                  resize: 'vertical',
                }}
              />

              {/* Dictate mic — anchored to the top-right of the canvas for quick access while writing */}
              <button
                type="button"
                onClick={recordingState === 'recording' ? stopRecording : startRecording}
                title={
                  recordingState === 'recording'
                    ? `Stop dictation (${formatSec(durationSec)})`
                    : recordingState === 'recorded'
                    ? 'Re-record'
                    : 'Dictate with microphone'
                }
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: recordingState === 'recording' ? '1px solid var(--status-danger)' : '1px solid var(--border-subtle)',
                  background: recordingState === 'recording' ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-surface-elevated)',
                  color: recordingState === 'recording' ? 'var(--status-danger)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {recordingState === 'recording' ? <Square size={15} /> : <Mic size={17} color="var(--status-danger)" />}
              </button>

              {recordingState === 'recording' && (
                <div style={{
                  position: 'absolute',
                  top: 46,
                  right: 8,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  color: 'var(--status-danger)',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: 8,
                  padding: '2px 6px',
                }}>
                  {formatSec(durationSec)}
                </div>
              )}
            </div>

            {/* Attached Audio Preview (Preserves original audio) + STT Transcribe Panel */}
            {audioBlobUrl && (
              <div style={{ marginBottom: 12 }}>
                {/* Audio player row */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: 12,
                  border: '1px solid var(--border-subtle)',
                  gap: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <Volume2 size={16} color="var(--accent-primary)" />
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Audio Dictation ({formatSec(durationSec)})
                    </span>
                    <audio src={audioBlobUrl} controls style={{ height: 32, flex: 1, maxWidth: 220 }} />
                  </div>
                  <button
                    type="button"
                    onClick={discardRecording}
                    className="action-btn"
                    style={{ padding: '6px 10px', fontSize: '0.78rem', color: 'var(--status-danger)', border: 'none' }}
                    title="Discard audio"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Transcribe panel */}
                <div style={{
                  marginTop: 8,
                  padding: '12px 14px',
                  background: 'var(--bg-app)',
                  borderRadius: 12,
                  border: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Sparkles size={15} color="var(--accent-primary)" />
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>Transcribe with Sarvam AI</span>
                    </div>
                    {/* Language selector */}
                    <select
                      value={sttLang}
                      onChange={(e) => setSttLang(e.target.value as typeof sttLang)}
                      className="input-field"
                      style={{ fontSize: '0.75rem', padding: '4px 8px', width: 'auto', minWidth: 140 }}
                    >
                      <option value="unknown">Auto-detect language</option>
                      <option value="te-IN">తెలుగు (Telugu)</option>
                      <option value="hi-IN">हिन्दी (Hindi)</option>
                      <option value="en-IN">English</option>
                    </select>
                  </div>

                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.45 }}>
                    Click below to convert your voice memo to text. The transcript is a draft — review it before saving.
                  </div>

                  <button
                    type="button"
                    onClick={transcribeVoiceMemo}
                    className="action-btn action-btn-primary"
                    disabled={transcribing}
                    style={{ width: '100%', justifyContent: 'center', fontSize: '0.84rem', padding: '8px 14px', marginBottom: 8 }}
                  >
                    {transcribing ? (
                      <><Sparkles size={15} style={{ animation: 'spin 1s linear infinite' }} /> Transcribing…</>
                    ) : (
                      <><Mic size={15} /> Transcribe Voice Memo</>
                    )}
                  </button>

                  {sttError && (
                    <div style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: 'rgba(239,68,68,0.1)',
                      border: '1px solid rgba(239,68,68,0.25)',
                      color: 'var(--status-danger)',
                      fontSize: '0.78rem',
                      marginBottom: 8,
                    }}>
                      {sttError}
                    </div>
                  )}

                  {sttDraft && (
                    <div>
                      <div style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        color: 'var(--accent-gold, #c8a03c)',
                        marginBottom: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}>
                        <Sparkles size={11} />
                        AI Transcript — Draft (review before saving)
                      </div>
                      <textarea
                        className="input-field"
                        rows={4}
                        value={sttDraft}
                        onChange={(e) => setSttDraft(e.target.value)}
                        style={{ fontSize: '0.88rem', lineHeight: '26px', marginBottom: 8 }}
                        placeholder="AI-generated transcript will appear here…"
                      />
                      <button
                        type="button"
                        onClick={insertSttDraftIntoNote}
                        className="action-btn"
                        style={{ width: '100%', justifyContent: 'center', fontSize: '0.82rem', padding: '7px 12px' }}
                      >
                        <Check size={14} /> Insert Transcript into Note ↓
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Save button — dictation now lives on the canvas above */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="submit"
                className="action-btn action-btn-primary"
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  fontSize: '0.9rem',
                  padding: '9px 16px',
                }}
                disabled={!typedBody.trim() && !audioBlobUrl}
              >
                Record in Daily Diary →
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ── Ruled Lined Notebook Entries Feed ── */}
      <div>
        {filteredNotes.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            marginBottom: 10,
          }}>
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
        )}

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
