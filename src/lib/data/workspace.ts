import { createClient } from '@/lib/supabase/client';
import { isAnonymousUser } from '@/lib/supabase/auth';
import { readSnapshot, writeSnapshot } from '@/lib/data/offlineStore';
import { buildInAppReminders, DEFAULT_REMINDER_PREFERENCES, type ReminderPreferences } from '@/lib/reminders/engine';
import type {
  Booking,
  Client,
  ClientFee,
  DiaryEntry,
  DocumentRecord,
  Matter,
  Reminder,
} from '@/lib/types/database';

type Memory = {
  ownerId: string | null;
  isDemo: boolean;
  hydrated: boolean;
  clients: Client[];
  matters: Matter[];
  bookings: Booking[];
  fees: ClientFee[];
  notes: DiaryEntry[];
  documents: DocumentRecord[];
  reminders: Reminder[];
  reminderPreferences: ReminderPreferences;
};

const memory: Memory = {
  ownerId: null,
  isDemo: false,
  hydrated: false,
  clients: [],
  matters: [],
  bookings: [],
  fees: [],
  notes: [],
  documents: [],
  reminders: [],
  reminderPreferences: DEFAULT_REMINDER_PREFERENCES,
};

function notify(name: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(name));
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return '00000000-0000-4000-8000-000000000000'.replace(/[08]/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

function ownerIdOrThrow(): string {
  if (!memory.ownerId) {
    throw new Error('Workspace is not ready. Sign in and retry.');
  }
  return memory.ownerId;
}

async function persistSnapshot() {
  if (!memory.ownerId || typeof window === 'undefined') return;
  await writeSnapshot({
    ownerId: memory.ownerId,
    clients: memory.clients,
    matters: memory.matters,
    bookings: memory.bookings,
    fees: memory.fees,
    notes: memory.notes,
    documents: memory.documents,
    reminders: memory.reminders,
    reminderPreferences: memory.reminderPreferences,
    updatedAt: new Date().toISOString(),
  });
}

function applyReminders() {
  if (!memory.ownerId) return;
  memory.reminders = buildInAppReminders(memory.ownerId, memory.bookings, memory.reminderPreferences);
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

function hasLiveSupabase(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !!url && url !== 'https://placeholder.supabase.co';
}

async function pullFromSupabase() {
  if (!hasLiveSupabase() || !isOnline()) return false;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== memory.ownerId) return false;

  const [
    clients,
    matters,
    bookings,
    fees,
    notes,
    documents,
    prefs,
  ] = await Promise.all([
    supabase.from('clients').select('*').order('created_at', { ascending: false }),
    supabase.from('matters').select('*').order('created_at', { ascending: false }),
    supabase.from('bookings').select('*').order('start_at', { ascending: true }),
    supabase.from('client_fees').select('*'),
    supabase.from('diary_entries').select('*').order('created_at', { ascending: false }),
    supabase.from('documents').select('*').order('created_at', { ascending: false }),
    supabase.from('reminder_preferences').select('*').eq('owner_id', user.id).maybeSingle(),
  ]);

  if (clients.error || matters.error || bookings.error) {
    console.warn('Workspace pull failed', clients.error || matters.error || bookings.error);
    return false;
  }

  memory.clients = (clients.data || []) as Client[];
  memory.matters = (matters.data || []) as Matter[];
  memory.bookings = (bookings.data || []) as Booking[];
  memory.fees = (fees.data || []) as ClientFee[];
  memory.notes = (notes.data || []) as DiaryEntry[];
  memory.documents = (documents.data || []) as DocumentRecord[];
  if (prefs.data) {
    memory.reminderPreferences = {
      offsets_minutes: prefs.data.offsets_minutes || DEFAULT_REMINDER_PREFERENCES.offsets_minutes,
      in_app_enabled: prefs.data.in_app_enabled !== false,
    };
  }
  applyReminders();
  return true;
}

async function upsertRow(table: string, row: Record<string, unknown>) {
  if (!hasLiveSupabase() || !isOnline()) return;
  const supabase = createClient();
  const owner_id = ownerIdOrThrow();
  const { error } = await supabase.from(table).upsert({ ...row, owner_id });
  if (error) console.warn(`Failed to persist ${table}:`, error.message);
}

async function deleteRow(table: string, id: string) {
  if (!hasLiveSupabase() || !isOnline()) return;
  const supabase = createClient();
  const { error } = await supabase.from(table).delete().eq('id', id).eq('owner_id', ownerIdOrThrow());
  if (error) console.warn(`Failed to delete ${table}:`, error.message);
}

export function getWorkspaceState() {
  return memory;
}

export async function hydrateWorkspace(): Promise<void> {
  if (typeof window === 'undefined') return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    memory.ownerId = null;
    memory.hydrated = true;
    memory.clients = [];
    memory.matters = [];
    memory.bookings = [];
    memory.fees = [];
    memory.notes = [];
    memory.documents = [];
    memory.reminders = [];
    notify('vakildesk-workspace-ready');
    return;
  }

  memory.ownerId = user.id;
  memory.isDemo = isAnonymousUser(user);

  const cached = await readSnapshot(user.id);
  if (cached) {
    memory.clients = cached.clients as Client[];
    memory.matters = cached.matters as Matter[];
    memory.bookings = cached.bookings as Booking[];
    memory.fees = cached.fees as ClientFee[];
    memory.notes = cached.notes as DiaryEntry[];
    memory.documents = cached.documents as DocumentRecord[];
    memory.reminders = cached.reminders as Reminder[];
    memory.reminderPreferences = cached.reminderPreferences || DEFAULT_REMINDER_PREFERENCES;
  }

  const pulled = await pullFromSupabase();
  if (!pulled && !cached && !memory.isDemo) {
    // One-time migration of legacy localStorage into this owner's workspace only.
    try {
      const legacyClients = localStorage.getItem('vakildesk_clients_store');
      if (legacyClients) memory.clients = JSON.parse(legacyClients);
      const legacyMatters = localStorage.getItem('vakildesk_matters_store');
      if (legacyMatters) memory.matters = JSON.parse(legacyMatters);
      const legacyFees = localStorage.getItem('vakildesk_client_fees_store');
      if (legacyFees) memory.fees = JSON.parse(legacyFees);
      const legacyNotes = localStorage.getItem('vakildesk_unified_notes');
      if (legacyNotes) memory.notes = JSON.parse(legacyNotes);
      localStorage.removeItem('vakildesk_clients_store');
      localStorage.removeItem('vakildesk_matters_store');
      localStorage.removeItem('vakildesk_client_fees_store');
      localStorage.removeItem('vakildesk_unified_notes');
    } catch {}
  }

  applyReminders();
  memory.hydrated = true;
  await persistSnapshot();
  notify('vakildesk-workspace-ready');
  notify('vakildesk-clients-update');
  notify('vakildesk-matters-update');
  notify('vakildesk-bookings-update');
  notify('vakildesk-notes-update');
  notify('vakildesk-documents-update');
}

export function loadClients(): Client[] {
  return memory.clients;
}

export function loadMatters(): Matter[] {
  return memory.matters;
}

export function loadBookings(): Booking[] {
  return memory.bookings.filter((b) => b.status !== 'cancelled');
}

export function loadClientFees(): ClientFee[] {
  return memory.fees;
}

export function loadUnifiedNotes(): DiaryEntry[] {
  return memory.notes;
}

export function loadTranslatedDocuments(): DocumentRecord[] {
  return memory.documents;
}

export function loadReminders(): Reminder[] {
  return memory.reminders;
}

export function loadReminderPreferences(): ReminderPreferences {
  return memory.reminderPreferences;
}

export async function saveClients(clients: Client[]): Promise<void> {
  const owner_id = ownerIdOrThrow();
  memory.clients = clients.map((c) => ({ ...c, owner_id }));
  await persistSnapshot();
  notify('vakildesk-clients-update');
}

export async function saveMatters(matters: Matter[]): Promise<void> {
  const owner_id = ownerIdOrThrow();
  memory.matters = matters.map((m) => ({ ...m, owner_id }));
  await persistSnapshot();
  notify('vakildesk-matters-update');
}

export async function saveClientFees(fees: ClientFee[]): Promise<void> {
  const owner_id = ownerIdOrThrow();
  memory.fees = fees.map((f) => ({ ...f, owner_id }));
  await persistSnapshot();
}

export async function saveUnifiedNotes(notes: DiaryEntry[]): Promise<void> {
  const owner_id = ownerIdOrThrow();
  memory.notes = notes.map((n) => ({ ...n, owner_id }));
  await persistSnapshot();
  notify('vakildesk-notes-update');
}

export async function saveTranslatedDocuments(docs: DocumentRecord[]): Promise<void> {
  const owner_id = ownerIdOrThrow();
  memory.documents = docs.map((d) => ({ ...d, owner_id }));
  await persistSnapshot();
  notify('vakildesk-documents-update');
}

export async function persistReminderPreferences(prefs: ReminderPreferences): Promise<void> {
  const owner_id = ownerIdOrThrow();
  memory.reminderPreferences = prefs;
  applyReminders();
  await persistSnapshot();
  await upsertRow('reminder_preferences', {
    owner_id,
    offsets_minutes: prefs.offsets_minutes,
    in_app_enabled: prefs.in_app_enabled,
    updated_at: new Date().toISOString(),
  });
  notify('vakildesk-reminders-update');
}

export async function upsertClient(client: Client): Promise<Client> {
  const owner_id = ownerIdOrThrow();
  const record: Client = { ...client, owner_id };
  const idx = memory.clients.findIndex((c) => c.id === record.id);
  if (idx === -1) memory.clients.unshift(record);
  else memory.clients[idx] = record;
  await persistSnapshot();
  await upsertRow('clients', record as unknown as Record<string, unknown>);
  notify('vakildesk-clients-update');
  return record;
}

export async function removeClient(id: string): Promise<void> {
  memory.clients = memory.clients.filter((c) => c.id !== id);
  memory.fees = memory.fees.filter((f) => f.client_id !== id);
  await persistSnapshot();
  await deleteRow('clients', id);
  notify('vakildesk-clients-update');
}

export async function createDirectClient(input: Omit<Client, 'id' | 'owner_id' | 'created_at' | 'updated_at'>): Promise<Client> {
  const now = new Date().toISOString();
  return upsertClient({
    ...input,
    id: newId(),
    owner_id: ownerIdOrThrow(),
    created_at: now,
    updated_at: now,
  });
}

export async function createMatterRecord(data: Partial<Matter> & { client_id: string; title: string; matter_number: string }): Promise<Matter> {
  const owner_id = ownerIdOrThrow();
  const now = new Date().toISOString();
  const matter: Matter = {
    id: data.id || newId(),
    owner_id,
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
  memory.matters.unshift(matter);

  // Hearing booking synchronization: Next court date immediately appears in Calendar
  if (matter.next_hearing_date && matter.status !== 'Disposed/Closed') {
    const bookingId = newId();
    const hearingBooking: Booking = {
      id: bookingId,
      owner_id,
      client_id: matter.client_id,
      matter_id: matter.id,
      start_at: matter.next_hearing_date,
      end_at: new Date(new Date(matter.next_hearing_date).getTime() + 60 * 60 * 1000).toISOString(),
      timezone: 'Asia/Kolkata',
      purpose: matter.title || 'Court hearing',
      status: 'scheduled',
      notes: 'Hearing derived from matter next court date',
      source: 'matter_hearing',
      created_at: now,
      updated_at: now,
    };
    memory.bookings.unshift(hearingBooking);
    await upsertRow('bookings', hearingBooking as unknown as Record<string, unknown>);
  }

  const clientIdx = memory.clients.findIndex((c) => c.id === matter.client_id);
  if (clientIdx !== -1) {
    memory.clients[clientIdx] = {
      ...memory.clients[clientIdx],
      case_reference: matter.matter_number,
      is_practice_active: true,
      updated_at: now,
    };
    await upsertRow('clients', memory.clients[clientIdx] as unknown as Record<string, unknown>);
  }

  await persistSnapshot();
  await upsertRow('matters', matter as unknown as Record<string, unknown>);
  applyReminders();
  await persistSnapshot();
  notify('vakildesk-matters-update');
  notify('vakildesk-clients-update');
  notify('vakildesk-bookings-update');
  notify('vakildesk-reminders-update');
  return matter;
}

export async function updateMatterRecord(id: string, updates: Partial<Matter>): Promise<void> {
  const idx = memory.matters.findIndex((m) => m.id === id);
  if (idx === -1) return;
  const owner_id = ownerIdOrThrow();
  const now = new Date().toISOString();
  const existing = memory.matters[idx];
  const updatedMatter: Matter = {
    ...existing,
    ...updates,
    owner_id,
    updated_at: now,
  };
  memory.matters[idx] = updatedMatter;

  // 1. Hearing Booking Synchronization: Calendar reflects next hearing date from Bookings
  const bookingIdx = memory.bookings.findIndex(
    (b) => b.matter_id === id && b.source === 'matter_hearing'
  );

  if (updatedMatter.status === 'Disposed/Closed' || !updatedMatter.next_hearing_date) {
    // Cancel hearing booking when matter is disposed or next date cleared
    if (bookingIdx !== -1) {
      memory.bookings[bookingIdx] = {
        ...memory.bookings[bookingIdx],
        status: 'cancelled',
        updated_at: now,
      };
      await upsertRow('bookings', memory.bookings[bookingIdx] as unknown as Record<string, unknown>);
    }
  } else if (updatedMatter.next_hearing_date) {
    // Upsert scheduled booking for hearing date
    if (bookingIdx !== -1) {
      memory.bookings[bookingIdx] = {
        ...memory.bookings[bookingIdx],
        client_id: updatedMatter.client_id,
        start_at: updatedMatter.next_hearing_date,
        end_at: new Date(new Date(updatedMatter.next_hearing_date).getTime() + 60 * 60 * 1000).toISOString(),
        purpose: updatedMatter.title || 'Court hearing',
        status: 'scheduled',
        updated_at: now,
      };
      await upsertRow('bookings', memory.bookings[bookingIdx] as unknown as Record<string, unknown>);
    } else {
      const newBooking: Booking = {
        id: newId(),
        owner_id,
        client_id: updatedMatter.client_id,
        matter_id: updatedMatter.id,
        start_at: updatedMatter.next_hearing_date,
        end_at: new Date(new Date(updatedMatter.next_hearing_date).getTime() + 60 * 60 * 1000).toISOString(),
        timezone: 'Asia/Kolkata',
        purpose: updatedMatter.title || 'Court hearing',
        status: 'scheduled',
        notes: 'Hearing derived from matter next court date',
        source: 'matter_hearing',
        created_at: now,
        updated_at: now,
      };
      memory.bookings.unshift(newBooking);
      await upsertRow('bookings', newBooking as unknown as Record<string, unknown>);
    }
  }

  // 2. Client Practice Active Status Synchronization: Closing/completing a matter updates client status everywhere
  const clientIdx = memory.clients.findIndex((c) => c.id === updatedMatter.client_id);
  if (clientIdx !== -1) {
    if (updatedMatter.status === 'Disposed/Closed') {
      const hasOtherActive = memory.matters.some(
        (m) => m.client_id === updatedMatter.client_id && m.id !== id && m.status !== 'Disposed/Closed'
      );
      memory.clients[clientIdx] = {
        ...memory.clients[clientIdx],
        is_practice_active: hasOtherActive,
        updated_at: now,
      };
      await upsertRow('clients', memory.clients[clientIdx] as unknown as Record<string, unknown>);
    } else {
      memory.clients[clientIdx] = {
        ...memory.clients[clientIdx],
        is_practice_active: true,
        case_reference: updatedMatter.matter_number,
        updated_at: now,
      };
      await upsertRow('clients', memory.clients[clientIdx] as unknown as Record<string, unknown>);
    }
  }

  await persistSnapshot();
  await upsertRow('matters', updatedMatter as unknown as Record<string, unknown>);
  applyReminders();
  await persistSnapshot();
  notify('vakildesk-matters-update');
  notify('vakildesk-clients-update');
  notify('vakildesk-bookings-update');
  notify('vakildesk-reminders-update');
}

export async function createUnifiedNote(data: Partial<DiaryEntry> & { content: string; entry_type: 'voice' | 'text' }): Promise<DiaryEntry> {
  const owner_id = ownerIdOrThrow();
  const now = new Date().toISOString();
  const note: DiaryEntry = {
    id: data.id || newId(),
    owner_id,
    client_id: data.client_id || null,
    matter_id: data.matter_id || null,
    entry_type: data.entry_type,
    title: data.title?.trim() || (data.entry_type === 'voice' ? 'Voice note' : 'Typed note'),
    content: data.content.trim(),
    audio_storage_path: data.audio_storage_path || null,
    audio_url: data.audio_url || null,
    transcript: data.transcript || (data.entry_type === 'voice' ? data.content : null),
    original_transcript: data.original_transcript || data.transcript || (data.entry_type === 'voice' ? data.content : null),
    edited_transcript: data.edited_transcript || null,
    transcript_edited_at: data.transcript_edited_at || null,
    transcription_status: data.transcription_status || (data.entry_type === 'voice' ? 'recorded' : 'completed'),
    transcription_model: data.transcription_model || null,
    language: data.language || 'en',
    duration_seconds: data.duration_seconds || null,
    created_at: data.created_at || now,
    updated_at: now,
  };
  memory.notes.unshift(note);
  await persistSnapshot();
  await upsertRow('diary_entries', {
    id: note.id,
    owner_id,
    client_id: note.client_id,
    matter_id: note.matter_id,
    entry_type: note.entry_type,
    title: note.title,
    content: note.content,
    audio_storage_path: note.audio_storage_path,
    transcript: note.transcript,
    original_transcript: note.original_transcript,
    edited_transcript: note.edited_transcript,
    transcript_edited_at: note.transcript_edited_at,
    transcription_status: note.transcription_status,
    transcription_model: note.transcription_model,
    language: note.language,
    duration_seconds: note.duration_seconds,
  });
  notify('vakildesk-notes-update');
  return note;
}

export async function updateUnifiedNote(id: string, updates: Partial<DiaryEntry>): Promise<void> {
  const idx = memory.notes.findIndex((n) => n.id === id);
  if (idx === -1) return;
  memory.notes[idx] = {
    ...memory.notes[idx],
    ...updates,
    owner_id: ownerIdOrThrow(),
    updated_at: new Date().toISOString(),
  };
  await persistSnapshot();
  await upsertRow('diary_entries', memory.notes[idx] as unknown as Record<string, unknown>);
  notify('vakildesk-notes-update');
}

export async function deleteUnifiedNote(id: string): Promise<void> {
  memory.notes = memory.notes.filter((n) => n.id !== id);
  await persistSnapshot();
  await deleteRow('diary_entries', id);
  notify('vakildesk-notes-update');
}

export async function createTranslatedDocument(data: Partial<DocumentRecord> & { original_text: string; translated_text: string; title: string }): Promise<DocumentRecord> {
  const owner_id = ownerIdOrThrow();
  const now = new Date().toISOString();
  const doc: DocumentRecord = {
    id: data.id || newId(),
    owner_id,
    client_id: data.client_id || null,
    matter_id: data.matter_id || null,
    template_id: 'legal_memo',
    template_version: '1.0',
    title: data.title.trim() || 'Legal memo',
    file_storage_path: data.file_storage_path || `memos/${owner_id}/${now}`,
    form_data_json: data.form_data_json || {},
    statutory_basis: data.statutory_basis || null,
    image_url: data.image_url || null,
    original_text: data.original_text,
    translated_text: data.translated_text,
    generated_at: now,
    created_at: now,
  };
  memory.documents.unshift(doc);
  await persistSnapshot();
  await upsertRow('documents', doc as unknown as Record<string, unknown>);
  notify('vakildesk-documents-update');
  return doc;
}

export async function deleteTranslatedDocument(id: string): Promise<void> {
  memory.documents = memory.documents.filter((d) => d.id !== id);
  await persistSnapshot();
  await deleteRow('documents', id);
  notify('vakildesk-documents-update');
}

export function generateCryptographicToken(): string {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return newId().replace(/-/g, '') + newId().replace(/-/g, '');
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

export async function createClientInvite(
  params: InviteClientParams,
  serverInvite?: { token: string; expiresAt: string },
): Promise<InviteClientResult> {
  if (memory.isDemo) {
    throw new Error('Portal invites are not available in Demo Mode.');
  }
  const owner_id = ownerIdOrThrow();
  const token = serverInvite?.token || generateCryptographicToken();
  const now = new Date();
  const expiresAt = serverInvite ? new Date(serverInvite.expiresAt) : new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const clientId = newId();
  const client: Client = {
    id: clientId,
    owner_id,
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
    is_practice_active: true,
    registration_token: token,
    token_expires_at: expiresAt.toISOString(),
    aadhaar_last4: null,
    current_address: null,
    permanent_address: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  const createdFees: ClientFee[] = [];
  const feeTypes = ['consultation', 'legal_notice', 'case_fee'] as const;
  for (const fType of feeTypes) {
    const val = params.fees[fType];
    if (typeof val === 'number' && val > 0) {
      createdFees.push({
        id: newId(),
        client_id: clientId,
        owner_id,
        fee_type: fType,
        amount: val,
        razorpay_link_id: null,
        razorpay_link_url: null,
        payment_status: 'unpaid',
        created_at: now.toISOString(),
      });
    }
  }
  memory.clients.unshift(client);
  memory.fees.push(...createdFees);
  await persistSnapshot();
  await upsertRow('clients', client as unknown as Record<string, unknown>);
  for (const fee of createdFees) {
    await upsertRow('client_fees', fee as unknown as Record<string, unknown>);
  }
  notify('vakildesk-clients-update');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return {
    client,
    fees: createdFees,
    token,
    registrationUrl: `${origin}/portal/${token}`,
    totalFeeAmount: createdFees.reduce((acc, f) => acc + f.amount, 0),
  };
}

export function getMattersByClientId(clientId: string): Matter[] {
  return memory.matters.filter((m) => m.client_id === clientId);
}

export function getMatterById(matterId: string): Matter | null {
  return memory.matters.find((m) => m.id === matterId) || null;
}

export { newId };
