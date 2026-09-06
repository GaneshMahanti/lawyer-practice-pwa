'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLanguage } from '@/lib/i18n/context';

/* ─── Types ────────────────────────────────────────────────────── */
type DiaryTab = 'notes' | 'voice';

interface NoteEntry {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface VoiceEntry {
  id: string;
  label: string;
  durationSec: number;
  createdAt: string;
  /** Placeholder: will be populated by Whisper once connected */
  transcript: string | null;
  blobUrl?: string;
}

/* ─── Helpers ──────────────────────────────────────────────────── */
const NOTES_KEY = 'vakildesk_diary_notes';
const VOICE_KEY = 'vakildesk_diary_voice_meta';

function loadNotes(): NoteEntry[] {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveNotes(notes: NoteEntry[]) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function loadVoiceMeta(): VoiceEntry[] {
  try {
    return JSON.parse(localStorage.getItem(VOICE_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveVoiceMeta(entries: VoiceEntry[]) {
  localStorage.setItem(VOICE_KEY, JSON.stringify(entries));
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/* ─── Note Editor ──────────────────────────────────────────────── */
function NoteEditor({
  note,
  onSave,
  onCancel,
}: {
  note: Partial<NoteEntry>;
  onSave: (n: NoteEntry) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(note.title || '');
  const [body, setBody] = useState(note.body || '');

  const handleSave = () => {
    if (!body.trim()) return;
    const now = new Date().toISOString();
    onSave({
      id: note.id || `note_${Date.now()}`,
      title: title.trim() || 'Untitled note',
      body: body.trim(),
      createdAt: note.createdAt || now,
      updatedAt: now,
    });
  };

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="card-title" style={{ marginBottom: 10 }}>
        {note.id ? 'Edit Note' : 'New Note'}
      </div>

      <label className="input-label">Title (optional)</label>
      <input
        type="text"
        className="input-field"
        placeholder="e.g. Pre-trial instructions for Sharma case"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={100}
      />

      <label className="input-label">Note</label>
      <textarea
        className="input-field"
        placeholder="Write your diary entry here…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={7}
        style={{ resize: 'vertical', minHeight: 120 }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          type="button"
          className="action-btn action-btn-primary"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={handleSave}
          disabled={!body.trim()}
        >
          Save note
        </button>
        <button
          type="button"
          className="action-btn"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ─── Voice Recorder ────────────────────────────────────────────── */
type RecordingState = 'idle' | 'recording' | 'stopped';

function VoiceRecorder({ onSave }: { onSave: (entry: VoiceEntry) => void }) {
  const [state, setState] = useState<RecordingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [label, setLabel] = useState('');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = async () => {
    setError(null);
    setBlobUrl(null);
    setElapsed(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setBlobUrl(URL.createObjectURL(blob));
        setState('stopped');
      };

      mr.start(200);
      setState('recording');
      timerRef.current = setInterval(() => setElapsed((p) => p + 1), 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Microphone access denied';
      setError(msg);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRef.current?.stop();
  };

  const discardRecording = () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setElapsed(0);
    setState('idle');
    setLabel('');
  };

  const saveRecording = () => {
    if (!blobUrl) return;
    const entry: VoiceEntry = {
      id: `voice_${Date.now()}`,
      label: label.trim() || `Recording ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
      durationSec: elapsed,
      createdAt: new Date().toISOString(),
      transcript: null, // Whisper will populate this later
      blobUrl,
    };
    onSave(entry);
    setBlobUrl(null);
    setElapsed(0);
    setState('idle');
    setLabel('');
  };

  // Cleanup on unmount
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  return (
    <div className="card">
      <div className="card-title">Voice Recorder</div>

      {/* Whisper integration notice */}
      <div
        style={{
          background: 'var(--bg-surface-elevated)',
          border: '1px solid var(--border-subtle)',
          borderLeft: '3px solid var(--accent-gold)',
          borderRadius: 'var(--radius-sm)',
          padding: '9px 12px',
          marginBottom: 14,
          fontSize: '0.78rem',
          color: 'var(--text-secondary)',
        }}
      >
        <strong style={{ color: 'var(--accent-gold)' }}>Whisper AI — coming soon</strong>
        <br />
        Recordings are saved locally. Once connected to WhisperFlow, transcription will be generated automatically.
      </div>

      {error && (
        <div style={{ color: 'var(--status-danger)', fontSize: '0.82rem', marginBottom: 10 }}>
          ⚠ {error}
        </div>
      )}

      {/* Recording controls */}
      {state === 'idle' && (
        <button
          type="button"
          className="action-btn action-btn-primary"
          style={{ width: '100%', justifyContent: 'center', gap: 8 }}
          onClick={startRecording}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          Start recording
        </button>
      )}

      {state === 'recording' && (
        <div style={{ textAlign: 'center' }}>
          {/* Animated waveform indicator */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, height: 40, marginBottom: 12 }}>
            {[1, 2, 3, 4, 5, 4, 3, 2, 1].map((h, i) => (
              <div
                key={i}
                style={{
                  width: 4,
                  height: h * 6,
                  background: 'var(--status-danger)',
                  borderRadius: 2,
                  animation: `wave ${0.4 + i * 0.07}s ease-in-out infinite alternate`,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--status-danger)', marginBottom: 12, letterSpacing: '0.04em' }}>
            {formatDuration(elapsed)}
          </div>
          <button
            type="button"
            className="action-btn"
            style={{ width: '100%', justifyContent: 'center', borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}
            onClick={stopRecording}
          >
            ■ Stop recording
          </button>
        </div>
      )}

      {state === 'stopped' && blobUrl && (
        <div>
          <label className="input-label">Recording label</label>
          <input
            type="text"
            className="input-field"
            placeholder="e.g. Sharma case — client instructions"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <audio src={blobUrl} controls style={{ width: '100%', marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="action-btn action-btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={saveRecording}
            >
              Save recording
            </button>
            <button
              type="button"
              className="action-btn"
              style={{ flex: 1, justifyContent: 'center', color: 'var(--status-danger)' }}
              onClick={discardRecording}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Wave animation keyframes */}
      <style>{`
        @keyframes wave {
          from { transform: scaleY(0.6); }
          to   { transform: scaleY(1.4); }
        }
      `}</style>
    </div>
  );
}

/* ─── Main Diary Page ──────────────────────────────────────────── */
export default function DiaryPage() {
  const { t } = useLanguage();

  const [tab, setTab] = useState<DiaryTab>('notes');
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [voices, setVoices] = useState<VoiceEntry[]>([]);
  const [editingNote, setEditingNote] = useState<Partial<NoteEntry> | null>(null);
  const [viewNoteId, setViewNoteId] = useState<string | null>(null);

  useEffect(() => {
    setNotes(loadNotes());
    setVoices(loadVoiceMeta());
  }, []);

  /* ── Notes handlers ─────────────────────────────────────────── */
  const handleSaveNote = useCallback((note: NoteEntry) => {
    setNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === note.id);
      const updated = idx >= 0
        ? prev.map((n) => (n.id === note.id ? note : n))
        : [note, ...prev];
      saveNotes(updated);
      return updated;
    });
    setEditingNote(null);
  }, []);

  const handleDeleteNote = (id: string) => {
    setNotes((prev) => {
      const updated = prev.filter((n) => n.id !== id);
      saveNotes(updated);
      return updated;
    });
    if (viewNoteId === id) setViewNoteId(null);
  };

  /* ── Voice handlers ─────────────────────────────────────────── */
  const handleSaveVoice = useCallback((entry: VoiceEntry) => {
    setVoices((prev) => {
      const updated = [entry, ...prev];
      saveVoiceMeta(updated);
      return updated;
    });
  }, []);

  const handleDeleteVoice = (id: string) => {
    setVoices((prev) => {
      const updated = prev.filter((v) => v.id !== id);
      saveVoiceMeta(updated);
      return updated;
    });
  };

  const viewingNote = viewNoteId ? notes.find((n) => n.id === viewNoteId) : null;

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div>
      {/* Page title */}
      <div className="section-label">{t('diary')}</div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 14, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 4 }}>
        {(['notes', 'voice'] as DiaryTab[]).map((tabId) => (
          <button
            key={tabId}
            type="button"
            style={{
              flex: 1,
              padding: '9px 0',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.88rem',
              fontFamily: 'var(--font-family)',
              background: tab === tabId ? 'var(--bg-surface-elevated)' : 'transparent',
              color: tab === tabId ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: tab === tabId ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
              transition: 'all 0.15s',
            }}
            onClick={() => {
              setTab(tabId);
              setEditingNote(null);
              setViewNoteId(null);
            }}
          >
            {tabId === 'notes' ? '📝 Notes' : '🎙️ Voice'}
          </button>
        ))}
      </div>

      {/* ── NOTES TAB ── */}
      {tab === 'notes' && (
        <>
          {editingNote ? (
            <NoteEditor
              note={editingNote}
              onSave={handleSaveNote}
              onCancel={() => setEditingNote(null)}
            />
          ) : viewingNote ? (
            <div className="card">
              <div className="card-title">
                <span style={{ flex: 1, fontWeight: 700 }}>{viewingNote.title}</span>
                <button
                  type="button"
                  onClick={() => setViewNoteId(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', fontSize: '0.82rem' }}
                >
                  ← Back
                </button>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.74rem', marginBottom: 12 }}>
                {formatDate(viewingNote.updatedAt)}
              </p>
              <div style={{ color: 'var(--text-primary)', lineHeight: 1.65, whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>
                {viewingNote.body}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button
                  type="button"
                  className="action-btn action-btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => { setEditingNote(viewingNote); setViewNoteId(null); }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="action-btn"
                  style={{ flex: 1, justifyContent: 'center', color: 'var(--status-danger)' }}
                  onClick={() => handleDeleteNote(viewingNote.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="action-btn action-btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginBottom: 14 }}
                onClick={() => setEditingNote({})}
              >
                + New note
              </button>

              {notes.length === 0 ? (
                <div className="card">
                  <div className="empty-state">
                    No notes yet. Tap <strong>+ New note</strong> to start your diary.
                  </div>
                </div>
              ) : (
                notes.map((n) => (
                  <div
                    key={n.id}
                    className="card"
                    style={{ marginBottom: 10, cursor: 'pointer' }}
                    onClick={() => setViewNoteId(n.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3, fontSize: '0.92rem' }}>
                          {n.title}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          {n.body}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 4 }}>
                          {formatDate(n.updatedAt)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteNote(n.id); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', flexShrink: 0 }}
                        aria-label="Delete note"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </>
      )}

      {/* ── VOICE TAB ── */}
      {tab === 'voice' && (
        <>
          <VoiceRecorder onSave={handleSaveVoice} />

          {/* Saved voice entries */}
          {voices.length === 0 ? (
            <div className="card">
              <div className="empty-state">No recordings yet. Tap <strong>Start recording</strong> above.</div>
            </div>
          ) : (
            voices.map((v) => (
              <div key={v.id} className="card" style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{v.label}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 2 }}>
                      {formatDate(v.createdAt)} · {formatDuration(v.durationSec)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteVoice(v.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}
                    aria-label="Delete recording"
                  >
                    ✕
                  </button>
                </div>

                {/* Whisper transcript placeholder */}
                <div
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    border: '1px dashed var(--border-strong)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 10px',
                    fontSize: '0.8rem',
                    color: v.transcript ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontStyle: v.transcript ? 'normal' : 'italic',
                  }}
                >
                  {v.transcript
                    ? v.transcript
                    : '⏳ Transcript pending — Whisper AI will process this recording once connected.'}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
