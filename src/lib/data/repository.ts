export {
  loadClients,
  saveClients,
  loadClientFees,
  saveClientFees,
  loadMatters,
  saveMatters,
  loadBookings,
  loadUnifiedNotes,
  saveUnifiedNotes,
  loadTranslatedDocuments,
  saveTranslatedDocuments,
  createClientInvite,
  createUnifiedNote,
  updateUnifiedNote,
  deleteUnifiedNote,
  createTranslatedDocument,
  deleteTranslatedDocument,
  getMattersByClientId,
  getMatterById,
  generateCryptographicToken,
  persistReminderPreferences,
  loadReminderPreferences,
  loadReminders,
  hydrateWorkspace,
  getWorkspaceState,
  upsertClient,
  removeClient,
  createDirectClient,
  createMatterRecord as createMatter,
  updateMatterRecord,
  type InviteClientParams,
  type InviteClientResult,
} from '@/lib/data/workspace';

import { loadClients, saveClients, loadClientFees } from '@/lib/data/workspace';
import type { Client, ClientFee, SupportedLanguage } from '@/lib/types/database';

export function getClientByToken(token: string): { client: Client; fees: ClientFee[] } | null {
  if (!token) return null;
  const client = loadClients().find((c) => c.registration_token === token && c.status === 'pending');
  if (!client) return null;
  if (client.token_expires_at && new Date(client.token_expires_at) < new Date()) return null;
  const fees = loadClientFees().filter((f) => f.client_id === client.id && f.amount > 0);
  return { client, fees };
}

export interface SubmitKycParams {
  name: string;
  phone_1: string;
  phone_2?: string;
  aadhaarNumber: string;
  current_address: string;
  permanent_address: string;
  preferred_language?: SupportedLanguage;
}

export function submitClientKyc(token: string, data: SubmitKycParams): { success: boolean; error?: string; client?: Client } {
  const result = getClientByToken(token);
  if (!result) return { success: false, error: 'Registration token is invalid or has expired.' };
  const { client } = result;
  const trimmedName = data.name?.trim();
  if (!trimmedName) return { success: false, error: 'Full name is required.' };
  const cleanPhone1 = data.phone_1?.replace(/\D/g, '');
  if (!cleanPhone1 || cleanPhone1.length < 10) return { success: false, error: 'A valid 10-digit Phone No. 1 is required.' };
  const cleanAadhaar = data.aadhaarNumber?.replace(/\s+/g, '');
  if (!cleanAadhaar || !/^\d{12}$/.test(cleanAadhaar)) return { success: false, error: 'Aadhaar must be an exact 12-digit number.' };
  const currentAddr = data.current_address?.trim();
  const permAddr = data.permanent_address?.trim();
  if (!currentAddr) return { success: false, error: 'Current address is required.' };
  if (!permAddr) return { success: false, error: 'Permanent address is required.' };

  const allClients = loadClients();
  const idx = allClients.findIndex((c) => c.id === client.id);
  if (idx === -1) return { success: false, error: 'Client record not found.' };
  const updatedClient: Client = {
    ...allClients[idx],
    name: trimmedName,
    phone: cleanPhone1,
    phone_2: data.phone_2?.trim() || null,
    current_address: currentAddr,
    permanent_address: permAddr,
    aadhaar_last4: cleanAadhaar.slice(-4),
    status: 'active',
    registration_token: null,
    token_expires_at: null,
    preferred_language: data.preferred_language || client.preferred_language || 'en',
    updated_at: new Date().toISOString(),
  };
  allClients[idx] = updatedClient;
  void saveClients(allClients);
  return { success: true, client: updatedClient };
}

export function migrateLegacyDiaryNotesIfNeeded(): void {
  // Legacy localStorage migration is handled during hydrateWorkspace for real users only.
}
