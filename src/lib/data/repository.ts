// ==============================================================================
// VakilDesk Data Repository
// Client Onboarding, Fees, Matters, Unified Notes, and Storage Synchronization
// ==============================================================================

import type { Client, ClientFee, FeeType, Matter, DiaryEntry, DocumentRecord, SupportedLanguage } from '@/lib/types/database';

const CLIENTS_STORAGE_KEY = 'vakildesk_clients_store';
const CLIENT_FEES_STORAGE_KEY = 'vakildesk_client_fees_store';
const MATTERS_STORAGE_KEY = 'vakildesk_matters_store';
const UNIFIED_NOTES_STORAGE_KEY = 'vakildesk_unified_notes';

// Legacy keys for migration
const LEGACY_NOTES_KEY = 'vakildesk_diary_notes';
const LEGACY_VOICE_KEY = 'vakildesk_diary_voice_meta';

/**
 * Generate a long, cryptographically random token (64 hex characters)
 * Works in both browser (Web Crypto) and Node.js environments.
 */
export function generateCryptographicToken(): string {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // Server-side / fallback
  try {
    const nodeCrypto = require('crypto');
    return nodeCrypto.randomBytes(32).toString('hex');
  } catch {
    // Math.random fallback with high entropy
    let str = '';
    for (let i = 0; i < 64; i++) {
      str += Math.floor(Math.random() * 16).toString(16);
    }
    return str;
  }
}

// -----------------------------------------------------------------------------
// CLIENTS & REGISTRATION
// -----------------------------------------------------------------------------

export function loadClients(): Client[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CLIENTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveClients(clients: Client[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(clients));
    window.dispatchEvent(new CustomEvent('vakildesk-clients-update'));
  } catch (err) {
    console.error('Failed to save clients:', err);
  }
}

export function loadClientFees(): ClientFee[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CLIENT_FEES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveClientFees(fees: ClientFee[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CLIENT_FEES_STORAGE_KEY, JSON.stringify(fees));
  } catch (err) {
    console.error('Failed to save client fees:', err);
  }
}

export interface InviteClientParams {
  provisionalName?: string;
  phone?: string;
  fees: {
    consultation?: number;
    legal_notice?: number;
    case_fee?: number;
  };
}

export interface InviteClientResult {
  client: Client;
  fees: ClientFee[];
  token: string;
  registrationUrl: string;
  totalFeeAmount: number;
}

/**
 * Creates a pending client invite with a long cryptographically random token
 * and records only non-zero fee rows.
 */
export function createClientInvite(params: InviteClientParams): InviteClientResult {
  const token = generateCryptographicToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000); // 72 hours
  const clientId = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const newClient: Client = {
    id: clientId,
    owner_id: 'owner_current',
    name: params.provisionalName?.trim() || 'Prospective Client',
    phone: params.phone?.trim() || '',
    phone_2: null,
    email: null,
    case_reference: null,
    notes: null,
    whatsapp_opt_in: false,
    whatsapp_opt_in_at: null,
    preferred_language: 'en',
    status: 'pending',
    registration_token: token,
    token_expires_at: expiresAt.toISOString(),
    aadhaar_last4: null,
    current_address: null,
    permanent_address: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  // Only store rows for non-zero fees
  const createdFees: ClientFee[] = [];
  const feeTypes: FeeType[] = ['consultation', 'legal_notice', 'case_fee'];

  for (const fType of feeTypes) {
    const val = params.fees[fType];
    if (typeof val === 'number' && val > 0) {
      createdFees.push({
        id: `fee_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        client_id: clientId,
        owner_id: 'owner_current',
        fee_type: fType,
        amount: val,
        razorpay_link_id: null,
        razorpay_link_url: null,
        payment_status: 'unpaid',
        created_at: now.toISOString(),
      });
    }
  }

  // Persist client
  const allClients = loadClients();
  allClients.unshift(newClient);
  saveClients(allClients);

  // Persist fees
  if (createdFees.length > 0) {
    const allFees = loadClientFees();
    saveClientFees([...allFees, ...createdFees]);
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lawyer-practice-pwa.vercel.app';
  const registrationUrl = `${origin}/portal/${token}`;
  const totalFeeAmount = createdFees.reduce((acc, f) => acc + f.amount, 0);

  return {
    client: newClient,
    fees: createdFees,
    token,
    registrationUrl,
    totalFeeAmount,
  };
}

/**
 * Validates and retrieves a pending client and fees by registration token.
 */
export function getClientByToken(token: string): { client: Client; fees: ClientFee[] } | null {
  if (!token || typeof token !== 'string') return null;
  const clients = loadClients();
  const client = clients.find(
    (c) => c.registration_token === token && c.status === 'pending'
  );

  if (!client) return null;

  // Check expiration
  if (client.token_expires_at && new Date(client.token_expires_at) < new Date()) {
    return null; // Expired
  }

  const allFees = loadClientFees();
  const fees = allFees.filter((f) => f.client_id === client.id && f.amount > 0);

  return { client, fees };
}

export interface SubmitKycParams {
  name: string;
  phone_1: string;
  phone_2?: string;
  aadhaarNumber: string; // 12-digit string
  current_address: string;
  permanent_address: string;
  preferred_language?: SupportedLanguage;
}

/**
 * Submits client KYC:
 * 1. Strictly validates 12-digit Aadhaar
 * 2. Masks to only last 4 digits (aadhaar_last4) and discards full Aadhaar from memory
 * 3. Immediately invalidates registration token (stops being valid upon submit)
 * 4. Transitions status from 'pending' to 'active'
 */
export function submitClientKyc(token: string, data: SubmitKycParams): { success: boolean; error?: string; client?: Client } {
  const result = getClientByToken(token);
  if (!result) {
    return { success: false, error: 'Registration token is invalid or has expired.' };
  }

  const { client } = result;

  // Validation
  const trimmedName = data.name?.trim();
  if (!trimmedName) {
    return { success: false, error: 'Full name is required.' };
  }

  const cleanPhone1 = data.phone_1?.replace(/\D/g, '');
  if (!cleanPhone1 || cleanPhone1.length < 10) {
    return { success: false, error: 'A valid 10-digit Phone No. 1 is required.' };
  }

  // Aadhaar 12-digit validation
  const cleanAadhaar = data.aadhaarNumber?.replace(/\s+/g, '');
  if (!cleanAadhaar || !/^\d{12}$/.test(cleanAadhaar)) {
    return { success: false, error: 'Aadhaar must be an exact 12-digit number.' };
  }

  const currentAddr = data.current_address?.trim();
  if (!currentAddr) {
    return { success: false, error: 'Current address is required.' };
  }

  const permAddr = data.permanent_address?.trim();
  if (!permAddr) {
    return { success: false, error: 'Permanent address is required.' };
  }

  // UIDAI Compliance: Store ONLY the last 4 digits
  const aadhaar_last4 = cleanAadhaar.slice(-4);

  // Update client record
  const allClients = loadClients();
  const idx = allClients.findIndex((c) => c.id === client.id);
  if (idx === -1) {
    return { success: false, error: 'Client record not found.' };
  }

  const updatedClient: Client = {
    ...allClients[idx],
    name: trimmedName,
    phone: cleanPhone1,
    phone_2: data.phone_2?.trim() || null,
    current_address: currentAddr,
    permanent_address: permAddr,
    aadhaar_last4: aadhaar_last4,
    status: 'active',
    // Registration token stops being valid immediately upon submit
    registration_token: null,
    token_expires_at: null,
    preferred_language: data.preferred_language || client.preferred_language || 'en',
    updated_at: new Date().toISOString(),
  };

  allClients[idx] = updatedClient;
  saveClients(allClients);

  return { success: true, client: updatedClient };
}

// -----------------------------------------------------------------------------
// UNIFIED NOTES STORAGE & AUTOMATIC MIGRATION
// -----------------------------------------------------------------------------

export function loadUnifiedNotes(): DiaryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    migrateLegacyDiaryNotesIfNeeded();
    const raw = localStorage.getItem(UNIFIED_NOTES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveUnifiedNotes(notes: DiaryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(UNIFIED_NOTES_STORAGE_KEY, JSON.stringify(notes));
    window.dispatchEvent(new CustomEvent('vakildesk-notes-update'));
  } catch (err) {
    console.error('Failed to save unified notes:', err);
  }
}

/**
 * Preserves legacy diary notes and voice recordings by migrating them
 * into the unified DiaryEntry schema if not already migrated.
 */
export function migrateLegacyDiaryNotesIfNeeded(): void {
  if (typeof window === 'undefined') return;

  const existingUnified = localStorage.getItem(UNIFIED_NOTES_STORAGE_KEY);
  if (existingUnified) {
    // Already initialized / migrated
    return;
  }

  const unifiedList: DiaryEntry[] = [];

  // 1. Migrate legacy typed notes
  try {
    const rawNotes = localStorage.getItem(LEGACY_NOTES_KEY);
    if (rawNotes) {
      const parsedNotes = JSON.parse(rawNotes);
      if (Array.isArray(parsedNotes)) {
        for (const n of parsedNotes) {
          unifiedList.push({
            id: n.id || `migrated_note_${Date.now()}_${Math.random()}`,
            owner_id: 'owner_current',
            client_id: null,
            matter_id: null,
            entry_type: 'text',
            title: n.title || 'Typed Note',
            content: n.body || '',
            audio_storage_path: null,
            audio_url: null,
            transcript: null,
            transcription_status: 'completed',
            transcription_model: null,
            language: 'en',
            duration_seconds: null,
            created_at: n.createdAt || new Date().toISOString(),
            updated_at: n.updatedAt || new Date().toISOString(),
          });
        }
      }
    }
  } catch (e) {
    console.warn('Error migrating legacy notes:', e);
  }

  // 2. Migrate legacy voice entries
  try {
    const rawVoice = localStorage.getItem(LEGACY_VOICE_KEY);
    if (rawVoice) {
      const parsedVoice = JSON.parse(rawVoice);
      if (Array.isArray(parsedVoice)) {
        for (const v of parsedVoice) {
          unifiedList.push({
            id: v.id || `migrated_voice_${Date.now()}_${Math.random()}`,
            owner_id: 'owner_current',
            client_id: null,
            matter_id: null,
            entry_type: 'voice',
            title: v.label || 'Voice Memo',
            content: v.transcript || '',
            audio_storage_path: null,
            audio_url: v.blobUrl || null,
            transcript: v.transcript || null,
            transcription_status: v.transcript ? 'completed' : 'recorded',
            transcription_model: 'whisper-1',
            language: 'en',
            duration_seconds: v.durationSec || null,
            created_at: v.createdAt || new Date().toISOString(),
            updated_at: v.createdAt || new Date().toISOString(),
          });
        }
      }
    }
  } catch (e) {
    console.warn('Error migrating legacy voice entries:', e);
  }

  // Save the migrated notes
  localStorage.setItem(UNIFIED_NOTES_STORAGE_KEY, JSON.stringify(unifiedList));
}

export function createUnifiedNote(data: Partial<DiaryEntry> & { content: string; entry_type: 'voice' | 'text' }): DiaryEntry {
  const now = new Date().toISOString();
  const newNote: DiaryEntry = {
    id: data.id || `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    owner_id: 'owner_current',
    client_id: data.client_id || null,
    matter_id: data.matter_id || null,
    entry_type: data.entry_type,
    title: data.title?.trim() || (data.entry_type === 'voice' ? 'Voice Memo' : 'Typed Note'),
    content: data.content.trim(),
    audio_storage_path: data.audio_storage_path || null,
    audio_url: data.audio_url || null,
    transcript: data.transcript || (data.entry_type === 'voice' ? data.content : null),
    transcription_status: data.transcription_status || (data.entry_type === 'voice' ? 'recorded' : 'completed'),
    transcription_model: data.transcription_model || 'whisper-1',
    language: data.language || 'en',
    duration_seconds: data.duration_seconds || null,
    created_at: data.created_at || now,
    updated_at: now,
  };

  const list = loadUnifiedNotes();
  list.unshift(newNote);
  saveUnifiedNotes(list);
  return newNote;
}

export function deleteUnifiedNote(id: string): void {
  const list = loadUnifiedNotes();
  const filtered = list.filter((n) => n.id !== id);
  saveUnifiedNotes(filtered);
}

export function updateUnifiedNote(id: string, updates: Partial<DiaryEntry>): void {
  const list = loadUnifiedNotes();
  const idx = list.findIndex((n) => n.id === id);
  if (idx !== -1) {
    list[idx] = {
      ...list[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    saveUnifiedNotes(list);
  }
}

// -----------------------------------------------------------------------------
// MATTERS & CASE CLASSIFICATION
// -----------------------------------------------------------------------------

export function loadMatters(): Matter[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MATTERS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveMatters(matters: Matter[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MATTERS_STORAGE_KEY, JSON.stringify(matters));
    window.dispatchEvent(new CustomEvent('vakildesk-matters-update'));
  } catch (err) {
    console.error('Failed to save matters:', err);
  }
}

export function createMatter(data: Partial<Matter> & { client_id: string; title: string; matter_number: string }): Matter {
  const now = new Date().toISOString();
  const newMatter: Matter = {
    id: data.id || `mat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    owner_id: 'owner_current',
    client_id: data.client_id,
    matter_number: data.matter_number,
    title: data.title,
    court_name: data.court_name || data.court_complex || 'District Court',
    matter_type: data.matter_type || data.category || 'Civil',
    case_type: data.case_type || 'OS',
    category: data.category || 'Civil',
    state: data.state || 'Andhra Pradesh',
    district: data.district || 'Visakhapatnam',
    court_complex: data.court_complex || 'Visakhapatnam District Court Complex',
    case_year: data.case_year || new Date().getFullYear(),
    filing_number: data.filing_number || null,
    cnr_number: data.cnr_number || null,
    status: data.status || 'Active',
    disposal_date: data.disposal_date || null,
    final_order_summary: data.final_order_summary || null,
    next_hearing_date: data.next_hearing_date || null,
    limitation_date: data.limitation_date || null,
    limitation_rule_ref: data.limitation_rule_ref || null,
    limitation_review_status: data.limitation_review_status || 'pending_review',
    fee_structure_json: data.fee_structure_json || {},
    created_at: now,
    updated_at: now,
  };

  const list = loadMatters();
  list.unshift(newMatter);
  saveMatters(list);
  return newMatter;
}

export function getMattersByClientId(clientId: string): Matter[] {
  const matters = loadMatters();
  return matters.filter((m) => m.client_id === clientId);
}

export function getMatterById(matterId: string): Matter | null {
  const matters = loadMatters();
  return matters.find((m) => m.id === matterId) || null;
}

// -----------------------------------------------------------------------------
// TRANSLATED DOCUMENTS & MEMOS
// -----------------------------------------------------------------------------

const TRANSLATED_DOCS_KEY = 'vakildesk_translated_documents_store';

export function loadTranslatedDocuments(): DocumentRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TRANSLATED_DOCS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTranslatedDocuments(docs: DocumentRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TRANSLATED_DOCS_KEY, JSON.stringify(docs));
    window.dispatchEvent(new CustomEvent('vakildesk-documents-update'));
  } catch (err) {
    console.error('Failed to save translated documents:', err);
  }
}

export function createTranslatedDocument(data: Partial<DocumentRecord> & { original_text: string; translated_text: string; title: string }): DocumentRecord {
  const now = new Date().toISOString();
  const newDoc: DocumentRecord = {
    id: data.id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    owner_id: 'owner_current',
    client_id: data.client_id || null,
    matter_id: data.matter_id || null,
    template_id: 'telugu_legal_memo',
    template_version: '1.0',
    title: data.title.trim() || 'Telugu Legal Memo',
    file_storage_path: '',
    form_data_json: {},
    statutory_basis: data.statutory_basis || null,
    image_url: data.image_url || null,
    original_text: data.original_text,
    translated_text: data.translated_text,
    generated_at: now,
    created_at: now,
  };

  const list = loadTranslatedDocuments();
  list.unshift(newDoc);
  saveTranslatedDocuments(list);
  return newDoc;
}

export function deleteTranslatedDocument(id: string): void {
  const list = loadTranslatedDocuments();
  const filtered = list.filter((d) => d.id !== id);
  saveTranslatedDocuments(filtered);
}
